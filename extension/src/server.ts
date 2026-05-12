import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import * as dgram from 'dgram';
import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, spawnSync, execSync } from 'child_process';

const QRCode = require('qrcode') as {
    toString(value: string, options?: Record<string, unknown>): Promise<string>;
};

interface ChatAgent {
    name: string;
    displayName: string;
    model?: string;
    vendor?: string;
    isDefault?: boolean;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    agentName?: string;
}

interface CodexChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    model?: string;
    reasoningEffort?: string;
    includeContext?: boolean;
    isStreaming?: boolean;
    threadId?: string;
    attachments?: LocalAttachment[];
    changeSummary?: GitChangeSummary;
    workspaceName?: string;
    workspacePath?: string;
}

interface RemoteCodeThreadSummary {
    id: string;
    title: string;
    timestamp: number;
    source?: 'remote' | 'codex';
    projectId?: string;
    workspaceName?: string;
    workspacePath?: string;
}

interface RemoteCodeProjectSummary {
    id: string;
    name: string;
    path?: string;
    active?: boolean;
    threadCount: number;
    timestamp: number;
    threads: RemoteCodeThreadSummary[];
}

interface WorkspaceSummary {
    workspaceName?: string;
    workspacePath?: string;
}

interface MobileAttachment {
    name?: string;
    mimeType?: string;
    size?: number;
    base64?: string;
}

interface LocalAttachment {
    name: string;
    path: string;
    mimeType: string;
    size: number;
}

interface GitChangeFile {
    path: string;
    additions: number;
    deletions: number;
}

interface GitChangeSummary {
    commit?: string;
    cwd?: string;
    fileCount?: number;
    files: GitChangeFile[];
    additions: number;
    deletions: number;
}

interface AppApkMetadata {
    apkPath: string;
    sizeBytes: number;
    sha256: string;
    versionName?: string;
    versionCode?: number;
}

interface DiagnosticItem {
    file: string;
    line: number;
    column: number;
    message: string;
    severity: 'error' | 'warning' | 'info';
    code?: string;
}

interface RemoteCodeActionEvent {
    id: string;
    type: string;
    title: string;
    detail: string;
    status: 'pending' | 'approved' | 'denied' | 'running' | 'completed' | 'failed';
    timestamp: number;
    threadId: string;
    actionable: boolean;
    command?: string;
    cwd?: string;
    filePath?: string;
    contentBase64?: string;
    patchBase64?: string;
    diff?: string;
    stdout?: string;
    stderr?: string;
    startedAt?: number;
    completedAt?: number;
    completedCommandCount?: number;
}

interface TunnelLauncher {
    command: string;
    prefixArgs: string[];
    shell: boolean;
    label: string;
    provider: 'ngrok' | 'cloudflared';
}

type PublicAccessProvider = 'keenetic' | 'ngrok' | 'cloudflared';

interface UpnpGatewayService {
    location: string;
    controlUrl: string;
    serviceType: string;
}

export class RemoteServer {
    private httpServer?: http.Server;
    private wss?: WebSocketServer;
    private wsClients: Set<WebSocket> = new Set();
    private wsClientKeys: Map<WebSocket, string> = new Map();
    private _isRunning = false;
    private _port: number;
    private _host: string;
    private _authToken: string;
    private _context: vscode.ExtensionContext;

    private chatHistory: Map<string, ChatMessage[]> = new Map();
    private currentChatId: string = 'default';
    private selectedAgent: string = 'gpt-5.5';
    private selectedReasoningEffort: string = 'medium';
    private selectedIncludeContext: boolean = true;
    private selectedWorkMode: string = 'local';
    private selectedProfile: string = 'user';
    private agentCache?: { timestamp: number; agents: ChatAgent[] };
    private lmModelsCache?: { timestamp: number; models: readonly vscode.LanguageModelChat[] };
    private lmModelsInflight?: Promise<readonly vscode.LanguageModelChat[]>;
    private lmModelsBlockedUntil = 0;
    private codexHistory: CodexChatMessage[] = [];
    private codexActionEvents: RemoteCodeActionEvent[] = [];
    private remoteCodeThreads: RemoteCodeThreadSummary[] = [];
    private currentRemoteThreadId: string = '';
    private liveDraftThreadIds: Set<string> = new Set();
    private pcChatPanel?: vscode.WebviewPanel;
    private pcChatRefreshTimer?: ReturnType<typeof setTimeout>;
    private pcCodexMirrorTimer?: ReturnType<typeof setInterval>;
    private pcCodexMirrorSignature = '';
    private wsCodexMirrorTimer?: ReturnType<typeof setInterval>;
    private wsCodexMirrorSignature = '';
    private remoteCodeStateSaveTimer?: ReturnType<typeof setTimeout>;
    private remoteCodeThreadsCache?: { timestamp: number; threads: RemoteCodeThreadSummary[] };
    private gitChangeSummaryCache: Map<string, GitChangeSummary | undefined> = new Map();
    private activeChatCancellation?: vscode.CancellationTokenSource;
    private activeChatThreadId?: string;
    private hiddenCodexThreadIds: Set<string> = new Set();
    private hiddenRemoteMessageIds: Set<string> = new Set();
    private pinnedThreadIds: Set<string> = new Set();
    private archivedThreadIds: Set<string> = new Set();
    private workspaceStorageCache?: { timestamp: number; dirs: string[] };
    private workspaceFileHintsCache?: { timestamp: number; limit: number; hints: string };
    private codexSessionFilesCache?: { timestamp: number; maxFiles: number; files: string[] };
    private appApkMetadataCache?: {
        apkPath: string;
        sizeBytes: number;
        mtimeMs: number;
        metadata: AppApkMetadata;
    };

    // Internet tunnel
    private _tunnelUrl: string | null = null;
    private _tunnelProvider: PublicAccessProvider | null = null;
    private _tunnelProcess: any = null;
    private tunnelStartPromise: Promise<string> | null = null;
    private _localIp: string = '';

    // WebSocket event listeners cleanup
    private diagnosticDisposable: vscode.Disposable | undefined;
    private _chatSessionWatchers: fs.FSWatcher[] = [];

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        const config = vscode.workspace.getConfiguration('remoteCodeOnPC');
        this._port = config.get<number>('port', 8799);
        this._host = this.getRemoteCodeStringSetting('host', '127.0.0.1');
        this._authToken = this.getRemoteCodeStringSetting('authToken', '');
    }

    get port() { return this._port; }
    get host() { return this._host; }
    get isRunning() { return this._isRunning; }
    get tunnelUrl() { return this.getPublicUrl(); }
    get tunnelProvider() { return this.getPublicProvider(); }
    get localIp() { return this._localIp; }
    get authToken() { return this._authToken; }

    /** Публичный адрес для подключения из внешней сети. */
    async startTunnelPublic(): Promise<string> {
        const publicUrl = this.getPublicUrl();
        if (!publicUrl) {
            throw new Error('Keenetic URL не задан. Откройте Remote Code: Подключение и укажите публичный KeenDNS/Keenetic адрес.');
        }
        return publicUrl;
    }

    /** Публичная остановка туннеля */
    stopTunnelPublic(): void {
        this.stopTunnel();
    }

    private getRemoteCodeStringSetting(key: string, fallback = ''): string {
        const configValue = (vscode.workspace.getConfiguration('remoteCodeOnPC').get<string>(key, '') || '').trim();
        if (configValue) return configValue;
        return this.readUserSettingsString(`remoteCodeOnPC.${key}`) || fallback;
    }

    private readUserSettingsString(key: string): string {
        const candidateFiles = new Set<string>();
        try {
            const storagePath = this._context.globalStorageUri.fsPath;
            candidateFiles.add(path.join(path.dirname(storagePath), 'settings.json'));
            candidateFiles.add(path.join(path.dirname(path.dirname(storagePath)), 'settings.json'));
        } catch {
            // Fall back to APPDATA below.
        }
        if (process.env.APPDATA) {
            candidateFiles.add(path.join(process.env.APPDATA, 'Code', 'User', 'settings.json'));
        }
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`"${escapedKey}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
        for (const filePath of candidateFiles) {
            try {
                if (!fs.existsSync(filePath)) continue;
                const match = fs.readFileSync(filePath, 'utf8').match(pattern);
                if (!match) continue;
                const parsed = JSON.parse(`"${match[1]}"`);
                return typeof parsed === 'string' ? parsed.trim() : '';
            } catch {
                // Settings can be JSONC or temporarily malformed while VS Code writes them.
            }
        }
        return '';
    }

    private normalizePublicUrl(raw: string | undefined | null): string {
        const trimmed = (raw || '').trim();
        if (!trimmed) return '';
        const withScheme = /^https?:\/\//i.test(trimmed)
            ? trimmed
            : trimmed.startsWith('//')
                ? `http:${trimmed}`
                : `http://${trimmed}`;
        try {
            const parsed = new URL(withScheme);
            const protocol = parsed.protocol === 'https:' ? 'https:' : 'http:';
            return `${protocol}//${parsed.host}`.replace(/\/+$/, '');
        } catch {
            return withScheme.replace(/\/+$/, '');
        }
    }

    private getConfiguredPublicUrl(): string {
        const publicUrl = this.normalizePublicUrl(this.getRemoteCodeStringSetting('publicUrl', ''));
        return this.isUnsupportedKeeneticServiceUrl(publicUrl) ? '' : publicUrl;
    }

    private async setConfiguredPublicUrl(raw: string): Promise<string> {
        const publicUrl = this.normalizePublicUrl(raw);
        const safePublicUrl = this.isUnsupportedKeeneticServiceUrl(publicUrl) ? '' : publicUrl;
        await vscode.workspace.getConfiguration('remoteCodeOnPC').update('publicUrl', safePublicUrl, vscode.ConfigurationTarget.Global);
        return safePublicUrl;
    }

    private getConfiguredKeeneticHost(): string {
        const host = this.getRemoteCodeStringSetting('keeneticHost', '');
        const hostname = this.extractHost(host) || host.replace(/:\d{1,5}$/, '').toLowerCase();
        return this.isUnsupportedKeeneticServiceHost(hostname) ? '' : host;
    }

    private isUnsupportedKeeneticServiceHost(host: string | undefined | null): boolean {
        const normalized = (host || '').trim().toLowerCase().replace(/\.$/, '');
        return normalized === 'netcraze.io' || normalized.endsWith('.netcraze.io');
    }

    private isUnsupportedKeeneticServiceUrl(raw: string | undefined | null): boolean {
        return this.isUnsupportedKeeneticServiceHost(this.extractHost(raw));
    }

    private getKeeneticZone(): string {
        return (this.getRemoteCodeStringSetting('keeneticZone', 'keenetic.link') || 'keenetic.link')
            .trim()
            .replace(/^\.+|\.+$/g, '')
            .toLowerCase();
    }

    private getKeeneticScheme(): 'http' | 'https' {
        return this.getRemoteCodeStringSetting('keeneticScheme', 'http') === 'https' ? 'https' : 'http';
    }

    private getKeeneticZones(): string[] {
        return Array.from(new Set([
            this.getKeeneticZone(),
            'keenetic.link',
            'keenetic.name',
            'keenetic.pro',
            'keenetic.io',
            'keenetic.net'
        ].filter(Boolean)));
    }

    private looksLikeKeeneticHost(host: string): boolean {
        const normalized = host.trim().toLowerCase().replace(/\.$/, '');
        if (!normalized || normalized === 'my.keenetic.net' || this.isUnsupportedKeeneticServiceHost(normalized)) return false;
        return normalized.includes('.keenetic.') ||
            this.getKeeneticZones().some(zone => normalized === zone || normalized.endsWith(`.${zone}`));
    }

    private normalizeKeeneticHost(raw: string | undefined | null): string {
        let trimmed = (raw || '').trim();
        if (!trimmed) return '';
        try {
            const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
            trimmed = parsed.host;
        } catch {
            trimmed = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
        }
        const portMatch = trimmed.match(/:(\d{1,5})$/);
        const port = portMatch ? portMatch[1] : '';
        let host = (portMatch ? trimmed.slice(0, -portMatch[0].length) : trimmed)
            .trim()
            .replace(/^\.+|\.+$/g, '')
            .toLowerCase();
        if (!host) return '';
        if (this.isUnsupportedKeeneticServiceHost(host)) return '';
        if (!host.includes('.')) {
            host = `${host}.${this.getKeeneticZone()}`;
        }
        return port ? `${host}:${port}` : host;
    }

    private buildKeeneticPublicUrl(rawHost: string): string {
        const host = this.normalizeKeeneticHost(rawHost);
        if (!host) return '';
        const rawScheme = (rawHost || '').trim().match(/^(https?)/i)?.[1]?.toLowerCase();
        const scheme = rawScheme === 'https' || rawScheme === 'http' ? rawScheme : this.getKeeneticScheme();
        const hasPort = /:\d{1,5}$/.test(host);
        return `${scheme}://${hasPort ? host : `${host}:${this._port}`}`;
    }

    private async setConfiguredKeeneticHost(raw: string): Promise<string> {
        const host = this.normalizeKeeneticHost(raw);
        await vscode.workspace.getConfiguration('remoteCodeOnPC').update('keeneticHost', host, vscode.ConfigurationTarget.Global);
        return host;
    }

    private async readRedirectLocation(targetUrl: string, timeoutMs = 2500): Promise<string | null> {
        return new Promise(resolve => {
            let settled = false;
            const finish = (location: string | null) => {
                if (settled) return;
                settled = true;
                resolve(location);
            };
            try {
                const parsed = new URL(targetUrl);
                const client = parsed.protocol === 'https:' ? https : http;
                const req = client.request(parsed, {
                    method: 'GET',
                    timeout: timeoutMs,
                    headers: { 'User-Agent': 'Remote Code on PC' }
                }, response => {
                    const header = response.headers.location;
                    response.resume();
                    finish(Array.isArray(header) ? header[0] || null : header || null);
                });
                req.on('timeout', () => {
                    req.destroy();
                    finish(null);
                });
                req.on('error', () => finish(null));
                req.end();
            } catch {
                finish(null);
            }
        });
    }

    private async requestText(targetUrl: string, options: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        timeoutMs?: number;
    } = {}): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
        return new Promise((resolve, reject) => {
            try {
                const parsed = new URL(targetUrl);
                const client = parsed.protocol === 'https:' ? https : http;
                const req = client.request(parsed, {
                    method: options.method || 'GET',
                    timeout: options.timeoutMs || 4500,
                    headers: options.headers || {}
                }, response => {
                    const chunks: Buffer[] = [];
                    response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                    response.on('end', () => {
                        resolve({
                            statusCode: response.statusCode || 0,
                            body: Buffer.concat(chunks).toString('utf8'),
                            headers: response.headers
                        });
                    });
                });
                req.on('timeout', () => {
                    req.destroy(new Error(`timeout ${options.timeoutMs || 4500}ms`));
                });
                req.on('error', reject);
                if (options.body) req.write(options.body);
                req.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    private async detectKeeneticHostFromRouter(): Promise<string | null> {
        const candidates = ['http://my.keenetic.net/', 'http://192.168.1.1/', 'http://192.168.0.1/'];
        for (const candidate of candidates) {
            let current = candidate;
            const seen = new Set<string>();
            for (let depth = 0; depth < 4; depth++) {
                if (seen.has(current)) break;
                seen.add(current);
                const location = await this.readRedirectLocation(current);
                if (!location) break;
                let next: URL;
                try {
                    next = new URL(location, current);
                } catch {
                    break;
                }
                const host = next.hostname.toLowerCase();
                if (this.looksLikeKeeneticHost(host)) {
                    return host;
                }
                current = next.toString();
            }
        }
        return null;
    }

    private extractXmlTag(xml: string, tag: string): string {
        const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = xml.match(new RegExp(`<[^:>]*:?${escaped}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${escaped}>`, 'i'));
        return match ? match[1].trim() : '';
    }

    private resolveUpnpControlUrl(location: string, controlUrl: string): string {
        return new URL(controlUrl.trim(), location).toString();
    }

    private async discoverUpnpLocations(timeoutMs = 3500): Promise<string[]> {
        return new Promise(resolve => {
            const socket = dgram.createSocket('udp4');
            const locations = new Set<string>();
            const finish = () => {
                try { socket.close(); } catch { /* ignore */ }
                resolve(Array.from(locations));
            };
            const searches = [
                'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
                'urn:schemas-upnp-org:service:WANIPConnection:1',
                'urn:schemas-upnp-org:service:WANPPPConnection:1'
            ];
            socket.on('message', msg => {
                const text = msg.toString('utf8');
                const match = text.match(/^location:\s*(.+)$/im);
                if (match?.[1]) locations.add(match[1].trim());
            });
            socket.on('error', finish);
            socket.bind(() => {
                for (const st of searches) {
                    const payload = [
                        'M-SEARCH * HTTP/1.1',
                        'HOST: 239.255.255.250:1900',
                        'MAN: "ssdp:discover"',
                        'MX: 2',
                        `ST: ${st}`,
                        '',
                        ''
                    ].join('\r\n');
                    const buffer = Buffer.from(payload, 'utf8');
                    socket.send(buffer, 0, buffer.length, 1900, '239.255.255.250');
                }
                setTimeout(finish, timeoutMs);
            });
        });
    }

    private async findUpnpGatewayService(): Promise<UpnpGatewayService | null> {
        const locations = await this.discoverUpnpLocations();
        const serviceTypes = [
            'urn:schemas-upnp-org:service:WANIPConnection:2',
            'urn:schemas-upnp-org:service:WANIPConnection:1',
            'urn:schemas-upnp-org:service:WANPPPConnection:1'
        ];
        for (const location of locations) {
            try {
                const response = await this.requestText(location, { timeoutMs: 4500 });
                if (response.statusCode < 200 || response.statusCode >= 300) continue;
                for (const serviceType of serviceTypes) {
                    const serviceRegex = new RegExp(`<service>[\\s\\S]*?<serviceType>\\s*${serviceType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<\\/serviceType>[\\s\\S]*?<controlURL>\\s*([^<]+)\\s*<\\/controlURL>[\\s\\S]*?<\\/service>`, 'i');
                    const match = response.body.match(serviceRegex);
                    if (match?.[1]) {
                        return {
                            location,
                            serviceType,
                            controlUrl: this.resolveUpnpControlUrl(location, match[1])
                        };
                    }
                }
            } catch {
                // Try the next discovered gateway.
            }
        }
        return null;
    }

    private buildUpnpEnvelope(serviceType: string, action: string, args: Record<string, string | number>): string {
        const body = Object.entries(args)
            .map(([key, value]) => `<${key}>${String(value)}</${key}>`)
            .join('');
        return [
            '<?xml version="1.0"?>',
            '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
            `<s:Body><u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body>`,
            '</s:Envelope>'
        ].join('');
    }

    private async callUpnpAction(service: UpnpGatewayService, action: string, args: Record<string, string | number>): Promise<string> {
        const body = this.buildUpnpEnvelope(service.serviceType, action, args);
        const response = await this.requestText(service.controlUrl, {
            method: 'POST',
            timeoutMs: 7000,
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                'SOAPAction': `"${service.serviceType}#${action}"`,
                'Content-Length': String(Buffer.byteLength(body, 'utf8'))
            },
            body
        });
        if (response.statusCode < 200 || response.statusCode >= 300) {
            const fault = this.extractXmlTag(response.body, 'errorDescription') || response.body.slice(0, 200);
            throw new Error(`UPnP ${action} failed: HTTP ${response.statusCode} ${fault}`);
        }
        return response.body;
    }

    private async openRouterPortViaUpnp(): Promise<{ externalIp?: string; message: string }> {
        if (!this._authToken) {
            throw new Error('Для внешней сети сначала создайте токен доступа.');
        }
        if (!this._localIp || this._localIp === '127.0.0.1') {
            this.detectLocalIp();
        }
        if (!this._localIp || this._localIp === '127.0.0.1') {
            throw new Error('Не удалось определить LAN IP этого ПК.');
        }
        const service = await this.findUpnpGatewayService();
        if (!service) {
            throw new Error('UPnP IGD на роутере не найден. В Keenetic включите компонент UPnP или настройте проброс порта вручную.');
        }
        await this.callUpnpAction(service, 'AddPortMapping', {
            NewRemoteHost: '',
            NewExternalPort: this._port,
            NewProtocol: 'TCP',
            NewInternalPort: this._port,
            NewInternalClient: this._localIp,
            NewEnabled: 1,
            NewPortMappingDescription: 'Remote Code on PC',
            NewLeaseDuration: 0
        });
        let externalIp = '';
        try {
            const body = await this.callUpnpAction(service, 'GetExternalIPAddress', {});
            externalIp = this.extractXmlTag(body, 'NewExternalIPAddress');
        } catch {
            // Mapping is enough; external IP is diagnostic only.
        }
        return {
            externalIp: externalIp || undefined,
            message: `TCP ${this._port} -> ${this._localIp}:${this._port}`
        };
    }

    private buildKeeneticForwardingInstructions(): string {
        if (!this._localIp || this._localIp === '127.0.0.1') {
            this.detectLocalIp();
        }
        const lanIp = this._localIp && this._localIp !== '127.0.0.1' ? this._localIp : '<IP-ПК>';
        const publicUrl = this.getPublicUrl() || this.buildKeeneticPublicUrl(this.getConfiguredKeeneticHost()) || '<публичный KeenDNS URL>';
        return [
            'Remote Code on PC: ручная настройка внешнего доступа Keenetic',
            '',
            'Что должно получиться:',
            `- Публичный URL в приложении: ${publicUrl}`,
            `- Правило проброса: TCP ${this._port} -> ${lanIp}:${this._port}`,
            '- Токен доступа должен быть создан в VS Code и вставлен в APK.',
            '',
            'В веб-интерфейсе Keenetic:',
            '1. Откройте http://my.keenetic.net/ или IP роутера.',
            '2. Перейдите: Сетевые правила -> Переадресация.',
            '3. Добавьте правило:',
            '   - Описание: Remote Code on PC',
            '   - Протокол: TCP',
            `   - Внешний порт: ${this._port}`,
            `   - Внутренний IP: ${lanIp}`,
            `   - Внутренний порт: ${this._port}`,
            '4. Сохраните правило и убедитесь, что KeenDNS работает в режиме Direct/прямого доступа.',
            '',
            'Шаблон Keenetic CLI, если вы настраиваете через командную строку роутера:',
            '# Если внешний интерфейс называется не ISP, замените ISP на имя вашего WAN-интерфейса.',
            'configure',
            `ip static tcp ISP ${this._port} ${lanIp} ${this._port}`,
            'system configuration save',
            '',
            'После настройки проверьте с телефона внешний URL и токен.'
        ].join('\n');
    }

    private normalizeRouterBase(raw: string): string {
        const value = raw.trim();
        if (!value) return 'http://my.keenetic.net/';
        const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
        try {
            const parsed = new URL(withScheme);
            parsed.pathname = parsed.pathname || '/';
            parsed.search = '';
            parsed.hash = '';
            return parsed.toString();
        } catch {
            return 'http://my.keenetic.net/';
        }
    }

    private buildRouterApiUrl(routerBase: string, apiPath: string): string {
        return new URL(apiPath.replace(/^\/+/, ''), this.normalizeRouterBase(routerBase)).toString();
    }

    private parseHttpAuthChallenge(header: string): Record<string, string> {
        const challenge = header.replace(/^Digest\s+/i, '');
        const result: Record<string, string> = {};
        const regex = /(\w+)=("([^"]*)"|([^,\s]+))/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(challenge))) {
            result[match[1]] = match[3] ?? match[4] ?? '';
        }
        return result;
    }

    private buildDigestAuthHeader(method: string, targetUrl: string, username: string, password: string, challengeHeader: string): string {
        const challenge = this.parseHttpAuthChallenge(challengeHeader);
        const parsed = new URL(targetUrl);
        const uri = `${parsed.pathname}${parsed.search}`;
        const realm = challenge.realm || '';
        const nonce = challenge.nonce || '';
        const qopValue = (challenge.qop || '').split(',').map(s => s.trim()).find(s => s === 'auth') || '';
        const algorithm = challenge.algorithm || 'MD5';
        const cnonce = crypto.randomBytes(8).toString('hex');
        const nc = '00000001';
        const md5 = (value: string) => crypto.createHash('md5').update(value).digest('hex');
        const ha1 = md5(`${username}:${realm}:${password}`);
        const ha2 = md5(`${method.toUpperCase()}:${uri}`);
        const response = qopValue
            ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qopValue}:${ha2}`)
            : md5(`${ha1}:${nonce}:${ha2}`);
        const parts = [
            `username="${username.replace(/"/g, '\\"')}"`,
            `realm="${realm.replace(/"/g, '\\"')}"`,
            `nonce="${nonce.replace(/"/g, '\\"')}"`,
            `uri="${uri.replace(/"/g, '\\"')}"`,
            `response="${response}"`,
            `algorithm=${algorithm}`
        ];
        if (challenge.opaque) parts.push(`opaque="${challenge.opaque.replace(/"/g, '\\"')}"`);
        if (qopValue) {
            parts.push(`qop=${qopValue}`);
            parts.push(`nc=${nc}`);
            parts.push(`cnonce="${cnonce}"`);
        }
        return `Digest ${parts.join(', ')}`;
    }

    private headerToString(value: string | string[] | undefined): string {
        if (Array.isArray(value)) return value.join(', ');
        return value || '';
    }

    private getWsClientKey(req: http.IncomingMessage): string {
        const clientHeader = this.headerToString(req.headers['x-remote-code-client']).trim();
        const forwarded = this.headerToString(req.headers['x-forwarded-for']).split(',')[0]?.trim() || '';
        const ip = forwarded || req.socket.remoteAddress || 'unknown';
        const userAgent = this.headerToString(req.headers['user-agent']).trim() || 'unknown';
        return `${clientHeader || userAgent}|${ip}`;
    }

    private liveClientCount(): number {
        for (const ws of Array.from(this.wsClients)) {
            if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
                this.wsClients.delete(ws);
                this.wsClientKeys.delete(ws);
            }
        }
        const keys = Array.from(this.wsClients, ws => this.wsClientKeys.get(ws) || 'unknown');
        return new Set(keys).size;
    }

    private async withTimeout<T>(
        promise: PromiseLike<T>,
        timeoutMs: number,
        message: string,
        cancellationToken?: vscode.CancellationToken
    ): Promise<T> {
        if (cancellationToken?.isCancellationRequested) {
            throw new Error('cancelled');
        }

        let timer: ReturnType<typeof setTimeout> | undefined;
        let disposable: vscode.Disposable | undefined;
        const timeoutPromise = new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        });
        const cancellationPromise = cancellationToken
            ? new Promise<T>((_, reject) => {
                disposable = cancellationToken.onCancellationRequested(() => reject(new Error('cancelled')));
            })
            : new Promise<T>(() => undefined);

        try {
            return await Promise.race([promise, timeoutPromise, cancellationPromise]);
        } finally {
            if (timer) clearTimeout(timer);
            disposable?.dispose();
        }
    }

    private async createKeeneticSessionCookie(targetUrl: string, username: string, password: string): Promise<string> {
        const parsed = new URL(targetUrl);
        const authUrl = new URL('/auth', `${parsed.protocol}//${parsed.host}`).toString();
        const first = await this.requestText(authUrl, { timeoutMs: 7000 });
        const challengeHeader = this.headerToString(first.headers['www-authenticate']);
        const challengeParts = this.parseHttpAuthChallenge(challengeHeader);
        const challenge = this.headerToString(first.headers['x-ndm-challenge']) || challengeParts.challenge;
        const realm = this.headerToString(first.headers['x-ndm-realm']) || challengeParts.realm;
        const setCookie = this.headerToString(first.headers['set-cookie']);
        const cookie = setCookie.split(',')[0]?.split(';')[0]?.trim();
        if (!challenge || !realm || !cookie) {
            throw new Error('Keenetic не вернул challenge/session cookie для авторизации.');
        }
        const md5Password = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
        const authPassword = crypto.createHash('sha256').update(`${challenge}${md5Password}`).digest('hex');
        const payload = JSON.stringify({ login: username, password: authPassword });
        const second = await this.requestText(authUrl, {
            method: 'POST',
            timeoutMs: 7000,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
                'Cookie': cookie
            },
            body: payload
        });
        if (second.statusCode < 200 || second.statusCode >= 300) {
            throw new Error(`Keenetic отклонил логин или пароль: HTTP ${second.statusCode}`);
        }
        const nextCookie = this.headerToString(second.headers['set-cookie']).split(',')[0]?.split(';')[0]?.trim();
        return nextCookie || cookie;
    }

    private async requestTextWithRouterAuth(targetUrl: string, options: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        timeoutMs?: number;
    }, username: string, password: string): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
        const method = options.method || 'GET';
        const first = await this.requestText(targetUrl, { ...options, method });
        if (first.statusCode !== 401) return first;
        const challengeHeader = this.headerToString(first.headers['www-authenticate']);
        const headers = { ...(options.headers || {}) };
        if (/x-ndw2-interactive/i.test(challengeHeader)) {
            headers['Cookie'] = await this.createKeeneticSessionCookie(targetUrl, username, password);
        } else if (/Digest/i.test(challengeHeader)) {
            headers['Authorization'] = this.buildDigestAuthHeader(method, targetUrl, username, password, challengeHeader);
        } else {
            headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
        }
        return this.requestText(targetUrl, { ...options, method, headers });
    }

    private async postKeeneticRci(routerBase: string, apiPath: string, body: any, username: string, password: string): Promise<{ statusCode: number; body: string }> {
        const targetUrl = this.buildRouterApiUrl(routerBase, apiPath);
        const payload = JSON.stringify(body);
        const response = await this.requestTextWithRouterAuth(targetUrl, {
            method: 'POST',
            timeoutMs: 9000,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': String(Buffer.byteLength(payload, 'utf8'))
            },
            body: payload
        }, username, password);
        return { statusCode: response.statusCode, body: response.body };
    }

    private async configureKeeneticPortForward(routerBase: string, username: string, password: string, wanInterface: string): Promise<string> {
        if (!this._authToken) {
            throw new Error('Для внешней сети сначала создайте токен доступа.');
        }
        if (!this._localIp || this._localIp === '127.0.0.1') {
            this.detectLocalIp();
        }
        if (!this._localIp || this._localIp === '127.0.0.1') {
            throw new Error('Не удалось определить LAN IP этого ПК.');
        }
        const iface = (wanInterface || 'ISP').trim() || 'ISP';
        const rule = {
            index: this._port,
            description: 'Remote Code on PC',
            protocol: 'tcp',
            interface: iface,
            port: this._port,
            'to-host': this._localIp,
            'to-port': this._port,
            enabled: true
        };
        let lastError = '';
        for (const payload of [rule, [rule]]) {
            try {
                const response = await this.postKeeneticRci(routerBase, '/rci/ip/nat', payload, username, password);
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    try {
                        await this.postKeeneticRci(routerBase, '/rci/system/configuration/save', {}, username, password);
                    } catch {
                        // Some firmware saves RCI NAT changes immediately; surface the rule success below.
                    }
                    return `TCP ${this._port} -> ${this._localIp}:${this._port}`;
                }
                lastError = `HTTP ${response.statusCode}: ${response.body.slice(0, 240)}`;
            } catch (err: any) {
                lastError = err?.message || String(err);
            }
        }
        throw new Error(`Keenetic RCI не применил правило: ${lastError || 'unknown error'}`);
    }

    private async resolveKeeneticPublicUrl(persist: boolean): Promise<{ url: string; source: string } | null> {
        const configuredUrl = this.getConfiguredPublicUrl();
        if (configuredUrl) return { url: configuredUrl, source: 'saved' };

        const configuredHost = this.getConfiguredKeeneticHost();
        if (configuredHost) {
            const url = this.buildKeeneticPublicUrl(configuredHost);
            if (url && persist) await this.setConfiguredPublicUrl(url);
            return url ? { url, source: 'keeneticHost' } : null;
        }

        const detectedHost = await this.detectKeeneticHostFromRouter();
        if (detectedHost) {
            const url = this.buildKeeneticPublicUrl(detectedHost);
            if (url && persist) {
                await this.setConfiguredKeeneticHost(detectedHost);
                await this.setConfiguredPublicUrl(url);
            }
            return url ? { url, source: 'my.keenetic.net' } : null;
        }

        return null;
    }

    private getPublicUrl(): string | null {
        const liveUrl = this._tunnelUrl && !this.isUnsupportedKeeneticServiceUrl(this._tunnelUrl) ? this._tunnelUrl : '';
        return liveUrl || this.getConfiguredPublicUrl() || null;
    }

    private getPublicProvider(): PublicAccessProvider | null {
        if (this._tunnelUrl && !this.isUnsupportedKeeneticServiceUrl(this._tunnelUrl)) return this._tunnelProvider || 'cloudflared';
        return this.getConfiguredPublicUrl() ? 'keenetic' : null;
    }

    private getProviderLabel(provider: PublicAccessProvider | null | undefined): string {
        if (provider === 'cloudflared') return 'Cloudflare';
        if (provider === 'ngrok') return 'ngrok';
        if (provider === 'keenetic') return 'Keenetic';
        return 'не задан';
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.httpServer = http.createServer((req, res) => this.handleRequest(req, res));
                this.httpServer.headersTimeout = 15000;
                this.httpServer.requestTimeout = 15000;
                this.httpServer.keepAliveTimeout = 1000;

                this.wss = new WebSocketServer({ server: this.httpServer });
                this.wss.on('connection', (ws, req) => {
                    this.handleWsConnection(ws, req).catch(err => {
                        console.error('[RemoteCodeOnPC] WS connection error:', err);
                    });
                });

                const configuredHost = this._host;
                const bindHost = this.bindHost;
                this.httpServer.listen(this._port, bindHost, () => {
                    this._isRunning = true;
                    this.detectLocalIp();
                    this._host = bindHost;
                    if (bindHost !== (configuredHost || '').trim()) {
                        console.log(`[RemoteCodeOnPC] Host binding was adjusted to ${bindHost} for public access.`);
                    }
                    console.log(`[RemoteCodeOnPC] Сервер запущен на ${bindHost}:${this._port}`);

                    // Следим за диагностикой
                    this.diagnosticDisposable = vscode.languages.onDidChangeDiagnostics(() => {
                        this.broadcastDiagnostics();
                    });

                    // Следим за активным редактором (активный файл)
                    vscode.window.onDidChangeActiveTextEditor((editor) => {
                        this.broadcast({
                            type: 'status:update',
                            activeFile: editor?.document.uri.fsPath || null,
                            activeFileLanguage: editor?.document.languageId || null
                        });
                    });

                    // Следим за изменением рабочей папки
                    vscode.workspace.onDidChangeWorkspaceFolders(() => {
                        const workspaceFolders = vscode.workspace.workspaceFolders || [];
                        this.broadcast({
                            type: 'folders:update',
                            folders: workspaceFolders.map(f => ({
                                name: f.name,
                                uri: f.uri.toString(),
                                path: f.uri.fsPath
                            }))
                        });
                    });

                    // Восстанавливаем историю чатов из сохранённых данных
                    this.restoreRemoteCodeState();
                    this.restoreChatHistory();

                    // Запускаем слежение за изменениями JSONL-файлов чатов
                    const enableFileWatchers = vscode.workspace.getConfiguration('remoteCodeOnPC').get<boolean>('enableFileWatchers', false);
                    if (enableFileWatchers) {
                        this.startChatSessionWatcher();
                    } else {
                        console.log('[RemoteCodeOnPC] File watchers disabled; mobile refresh loads chat data on demand.');
                    }

                    resolve();
                });

                this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
                    this._isRunning = false;
                    reject(err);
                });
                this.httpServer.on('clientError', (err, socket) => {
                    this.logHttpRequest(`CLIENT_ERROR ${err.message}`);
                    if (socket.writable) {
                        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    async stop(): Promise<void> {
        this._isRunning = false;
        this.diagnosticDisposable?.dispose();
        this.stopPcCodexMirrorPolling();
        this.stopWsCodexMirrorPolling();
        this.stopTunnel(); // останавливаем туннель

        // Останавливаем File Watcher'ы
        for (const w of this._chatSessionWatchers) {
            try { w.close(); } catch {}
        }
        this._chatSessionWatchers = [];

        // Закрываем WS клиентов
        for (const ws of this.wsClients) {
            ws.close(1001, 'Server shutting down');
        }
        this.wsClients.clear();
        this.wsClientKeys.clear();

        return new Promise((resolve) => {
            if (this.wss) {
                this.wss.close(() => {
                    if (this.httpServer) {
                        this.httpServer.close(() => resolve());
                    } else {
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }

    // ========== HTTP ROUTER ==========

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        this.logHttpRequest(`${req.socket.remoteAddress}:${req.socket.remotePort} ${req.method} ${req.url} ua=${req.headers['user-agent'] || ''}`);
        this.setCorsHeaders(req, res);

        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Content-Length': 0,
                'Connection': 'close'
            });
            res.end();
            return;
        }

        const parsedUrl = url.parse(req.url || '/', true);
        const pathname = parsedUrl.pathname || '/';

        // Public status endpoints let the Android app distinguish "PC not found"
        // from "PC found, token required" without exposing protected data.
        const publicAccess = this.requestUsesPublicAccess(req);
        const authRequired = !this.isPublicAssetEndpoint(pathname)
            && this.isAuthRequiredForRequest(req, pathname, publicAccess);
        if (authRequired && !this._authToken && !this.isPublicStatusEndpoint(pathname)) {
            this.jsonResponse(res, 403, {
                error: 'Access token is required before LAN or public access is enabled.'
            });
            return;
        }
        if (authRequired && !this.checkAuth(req, true)) {
            this.jsonResponse(res, 401, { error: 'Unauthorized' });
            return;
        }

        try {
            switch (true) {
                // ---- Status ----
                case pathname === '/api/status':
                    return this.handleStatus(req, res);

                // ---- Workspace / Folders ----
                case pathname === '/api/workspace/folders':
                    return this.handleGetFolders(req, res);
                case pathname === '/api/workspace/open':
                    return this.handleOpenFolder(req, res);
                case pathname === '/api/workspace/tree':
                    return this.handleFileTree(req, res);
                case pathname === '/api/workspace/read-file':
                    return this.handleReadFile(req, res);
                case pathname === '/api/app/apk/status':
                    return this.handleAppApkStatus(req, res);
                case pathname === '/api/app/apk':
                    return this.handleAppApk(req, res);

                // ---- Chat ----
                case pathname === '/api/chat/agents':
                    return this.handleGetAgents(req, res);
                case pathname === '/api/chat/send':
                    return this.handleChatSend(req, res);
                case pathname === '/api/chat/history':
                    return this.handleChatHistory(req, res);
                case pathname === '/api/chat/select-agent':
                    return this.handleSelectAgent(req, res);
                case pathname === '/api/chat/new':
                    return this.handleNewChat(req, res);
                case pathname === '/api/chat/conversations':
                    return this.handleGetConversations(req, res);

                // ---- Diagnostics ----
                case pathname === '/api/diagnostics':
                    return this.handleDiagnostics(req, res);

                // ---- Terminal ----
                case pathname === '/api/terminal/exec':
                    return this.handleTerminalExec(req, res);

                // ---- Tunnel (Internet) ----
                case pathname === '/api/tunnel/status':
                    return this.handleTunnelStatus(req, res);
                case pathname === '/api/tunnel/start':
                    return this.handleTunnelStart(req, res);
                case pathname === '/api/tunnel/stop':
                    return this.handleTunnelStop(req, res);

                // ---- Codex (OpenAI) ----
                case pathname === '/api/codex/status':
                    return this.handleCodexStatus(req, res);
                case pathname === '/api/codex/send':
                    return this.handleCodexSendRealtime(req, res);
                case pathname === '/api/codex/history':
                    return this.handleCodexHistory(req, res);
                case pathname === '/api/codex/events':
                    return this.handleCodexEvents(req, res);
                case pathname === '/api/codex/actions':
                    return this.handleCodexActionResponse(req, res);
                case pathname === '/api/codex/message':
                    return this.handleRemoteCodeMessageAction(req, res);
                case pathname === '/api/codex/change':
                    return this.handleRemoteCodeChangeAction(req, res);
                case pathname === '/api/codex/models' && req.method === 'GET':
                    return this.handleCodexModels(req, res);
                case pathname === '/api/codex/models' && req.method === 'POST':
                    return this.handleCodexSelectModel(req, res);
                case pathname === '/api/codex/threads':
                    return this.handleRemoteCodeThreads(req, res);
                case pathname === '/api/codex/new':
                    return this.handleRemoteCodeNewThread(req, res);
                case pathname === '/api/codex/delete':
                    return this.handleRemoteCodeDeleteThread(req, res);
                case pathname === '/api/codex/stop':
                    return this.handleRemoteCodeStopGeneration(req, res);
                case pathname === '/api/codex/launch':
                    return this.handleCodexLaunch(req, res);

                default:
                    this.jsonResponse(res, 404, { error: 'Not found' });
            }
        } catch (err: any) {
            console.error('[RemoteCodeOnPC] Ошибка обработки:', err);
            this.jsonResponse(res, 500, { error: err.message });
        }
    }

    // ========== API HANDLERS ==========

    // GET /api/status
    private async handleStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const activeEditor = vscode.window.activeTextEditor;
        const publicAccess = this.requestUsesPublicAccess(req);
        const authRequired = this.isAuthRequiredForRequest(req, '/api/status', publicAccess);
        const authOk = this.checkAuth(req, authRequired);
        const publicUrl = this.getPublicUrl();
        const publicProvider = this.getPublicProvider();
        if (authRequired && !authOk) {
            this.jsonResponse(res, 200, this.publicAuthRequiredStatus(publicUrl, publicProvider));
            return;
        }

        this.jsonResponse(res, 200, {
            version: vscode.version,
            serverVersion: this.getExtensionVersion(),
            appApk: this.getPublicAppApkMetadata(),
            appName: vscode.env.appName,
            isRunning: true,
            platform: process.platform,
            remoteCode: {
                port: this._port,
                host: this._host,
                localIp: this._localIp,
                localUrl: `http://${this._localIp}:${this._port}`,
                publicUrl,
                tunnelUrl: publicUrl,
                activeUrl: publicUrl || `http://${this._localIp}:${this._port}`,
                tunnelActive: !!publicUrl,
                tunnelProvider: publicProvider,
                keeneticHost: this.getConfiguredKeeneticHost(),
                keeneticZone: this.getKeeneticZone(),
                keeneticScheme: this.getKeeneticScheme(),
                autoUrlSupported: true,
                authRequired,
                authOk,
                tokenConfigured: !!this._authToken
            },
            workspace: {
                folders: workspaceFolders.map(f => ({
                    name: f.name,
                    uri: f.uri.toString(),
                    path: f.uri.fsPath
                })),
                activeFile: activeEditor?.document.uri.fsPath || null,
                activeFileLanguage: activeEditor?.document.languageId || null
            },
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage().rss
        });
    }

    // GET /api/workspace/folders
    private async handleGetFolders(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];

        // Также сканируем недавние проекты
        const recentProjects = this.getRecentProjects();

        this.jsonResponse(res, 200, {
            current: workspaceFolders.map(f => ({
                name: f.name,
                uri: f.uri.toString(),
                path: f.uri.fsPath
            })),
            recent: recentProjects,
            // Системные диски для навигации
            systemDrives: this.getSystemDrives()
        });
    }

    // POST /api/workspace/open
    private async handleOpenFolder(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { path: folderPath } = JSON.parse(body);

        if (!folderPath) {
            this.jsonResponse(res, 400, { error: 'Path is required' });
            return;
        }

        const uri = vscode.Uri.file(folderPath);
        try {
            await vscode.commands.executeCommand('vscode.openFolder', uri);
            this.jsonResponse(res, 200, { success: true, path: folderPath });
        } catch (err: any) {
            this.jsonResponse(res, 500, { error: err.message });
        }
    }

    // GET /api/workspace/tree?path=...
    private async handleFileTree(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const params = url.parse(req.url || '', true).query;
        const requestedPath = typeof params.path === 'string' ? params.path : '';
        const dirPath = this.resolveWorkspaceApiPath(requestedPath, true);

        if (!dirPath) {
            this.jsonResponse(res, 400, { error: 'Path must stay inside an opened workspace folder.' });
            return;
        }

        try {
            const stat = fs.statSync(dirPath);
            if (!stat.isDirectory()) {
                this.jsonResponse(res, 400, { error: 'Path is not a directory' });
                return;
            }
            const tree = await this.scanDirectory(dirPath, 0, 3); // max depth 3
            this.jsonResponse(res, 200, tree);
        } catch (err: any) {
            this.jsonResponse(res, 500, { error: err.message });
        }
    }

    // GET /api/workspace/read-file?path=...
    private async handleReadFile(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const params = url.parse(req.url || '', true).query;
        const requestedPath = params.path as string;

        if (!requestedPath) {
            this.jsonResponse(res, 400, { error: 'File path required' });
            return;
        }

        try {
            const filePath = this.resolveWorkspaceApiPath(requestedPath, false);
            if (!filePath) {
                this.jsonResponse(res, 403, { error: 'File path is outside the opened workspace.' });
                return;
            }
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) {
                this.jsonResponse(res, 400, { error: 'Path is not a file' });
                return;
            }
            const maxBytes = 1024 * 1024;
            if (stat.size > maxBytes) {
                this.jsonResponse(res, 413, { error: 'File is too large to read over the remote API.', maxBytes });
                return;
            }
            const buffer = fs.readFileSync(filePath);
            if (this.looksBinary(buffer)) {
                this.jsonResponse(res, 415, { error: 'Binary files are not returned by the remote text API.' });
                return;
            }
            const content = buffer.toString('utf-8');
            const ext = path.extname(filePath);
            this.jsonResponse(res, 200, {
                path: filePath,
                content,
                extension: ext,
                size: stat.size,
                language: this.getLanguageFromExt(ext)
            });
        } catch (err: any) {
            this.jsonResponse(res, 500, { error: err.message });
        }
    }

    // GET /api/chat/agents
    private async handleGetAgents(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const agents: ChatAgent[] = [
            { name: 'codex', displayName: 'Codex', vendor: 'openai', model: 'Codex', isDefault: true }
        ];
        this.jsonResponse(res, 200, {
            agents,
            selected: 'codex',
            currentChatId: this.currentChatId
        });
    }

    // POST /api/chat/send
    private async handleChatSend(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { message, chatId, agentName } = JSON.parse(body);
        const targetChat = chatId || this.currentChatId;

        if (!message) {
            this.jsonResponse(res, 400, { error: 'Message is required' });
            return;
        }

        if (!this.chatHistory.has(targetChat)) {
            this.chatHistory.set(targetChat, []);
        }

        const history = this.chatHistory.get(targetChat)!;

        // Добавляем сообщение пользователя
        const userMsg: ChatMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            role: 'user',
            content: message,
            timestamp: Date.now(),
            agentName: agentName || this.selectedAgent
        };
        history.push(userMsg);

        // Отправляем через WebSocket, что началась генерация
        this.broadcast({
            type: 'chat:thinking',
            chatId: targetChat,
            messageId: `thinking_${Date.now()}`
        });

        try {
            // Используем VS Code API для отправки в Copilot Chat
            const response = await this.sendToChat(message, agentName || this.selectedAgent);

            const assistantMsg: ChatMessage = {
                id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                role: 'assistant',
                content: response,
                timestamp: Date.now(),
                agentName: agentName || this.selectedAgent
            };
            history.push(assistantMsg);

            // Сохраняем историю
            this.saveChatHistory(targetChat, history);

            this.jsonResponse(res, 200, {
                response: assistantMsg,
                chatId: targetChat
            });

            // Уведомляем WS клиентов
            this.broadcast({
                type: 'chat:response',
                chatId: targetChat,
                message: assistantMsg
            });
        } catch (err: any) {
            const errorMsg: ChatMessage = {
                id: `msg_error_${Date.now()}`,
                role: 'assistant',
                content: `❌ Ошибка: ${err.message}`,
                timestamp: Date.now(),
                agentName: agentName || this.selectedAgent
            };
            history.push(errorMsg);

            this.jsonResponse(res, 500, {
                error: err.message,
                response: errorMsg,
                chatId: targetChat
            });
        }
    }

    // GET /api/chat/history?chatId=...
    /**
     * Возвращает ВСЕ папки workspaceStorage, содержащие chatSessions с .jsonl файлами
     */
    private getAllWorkspaceStorageDirs(): string[] {
        try {
            if (this.workspaceStorageCache && Date.now() - this.workspaceStorageCache.timestamp < 15000) {
                return this.workspaceStorageCache.dirs;
            }
            const appData = process.env.APPDATA || '';
            const wsRoot = path.join(appData, 'Code', 'User', 'workspaceStorage');
            const results: string[] = [];
            const candidates = fs.readdirSync(wsRoot)
                .map(id => path.join(wsRoot, id))
                .filter(dir => fs.existsSync(path.join(dir, 'chatSessions')));
            for (const dir of candidates) {
                const files = fs.readdirSync(path.join(dir, 'chatSessions'));
                if (files.some(f => f.endsWith('.jsonl'))) {
                    results.push(dir);
                }
            }
            this.workspaceStorageCache = { timestamp: Date.now(), dirs: results };
            return results;
        } catch {
            return [];
        }
    }

    /**
     * @deprecated Используйте getAllWorkspaceStorageDirs()
     */
    private getWorkspaceStorageDir(): string | null {
        const dirs = this.getAllWorkspaceStorageDirs();
        return dirs.length > 0 ? dirs[0] : null;
    }

    /**
     * Парсит JSONL-файл сессии VS Code Chat.
     * Возвращает { id, title, messages }.
     * 
     * Реальный формат JSONL (CRDT-лог):
     * - kind:0 — заголовок сессии {sessionId, customTitle}
     * - kind:1 — инкрементальные патчи (customTitle, inputState.inputText и т.д.)
     * - kind:2 с k=["requests"] — ЗАПРОС + ОТВЕТ вместе:
     *     v[0] = {requestId, timestamp, agent, modelId, responseId,
     *             result: {metadata: {renderedUserMessage: [{type:1, text:"..."}]},
     *                      response: [{kind:"thinking",value:"..."}, {kind:"content",value:"..."}, {value:"Текст ответа"}]}}
     *     user message: result.metadata.renderedUserMessage[0].text (или inputState.inputText из kind:1)
     *     assistant response: result.response[?].value, пропуская элементы с kind="thinking"|"mcpServersStarting"
     */
    private parseVSCodeSession(filePath: string): { id: string, title: string, messages: ChatMessage[] } | null {
        try {
            if (!fs.existsSync(filePath)) return null;
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split(/\r?\n/).filter(Boolean);
            if (lines.length === 0) return null;

            // Header (kind:0)
            const header = JSON.parse(lines[0]);
            const sessionId = header?.v?.sessionId || path.basename(filePath, '.jsonl');
            const title = header?.v?.customTitle || header?.v?.title || 'Чат';

            // Отслеживаем inputText из kind:1 патчей (пользовательский ввод)
            let lastInputText = '';

            // Парсим kind:2 entry
            interface ParsedRequest {
                userMessage: string;
                timestamp: number;
                responseChunks: string[];
            }
            const parsedRequests: ParsedRequest[] = [];

            for (const line of lines) {
                try {
                    const obj = JSON.parse(line);
                    
                    if (obj.kind === 1) {
                        // Инкрементальный патч — отслеживаем inputText
                        const k: any[] = obj.k || [];
                        const kStr = JSON.stringify(k);
                        if (kStr.includes('inputState') && kStr.includes('inputText')) {
                            lastInputText = String(obj.v || '');
                        }
                        continue;
                    }
                    
                    if (obj.kind !== 2) continue;
                    
                    const k: any[] = obj.k || [];
                    const v = obj.v;
                    const kStr = JSON.stringify(k);
                    
                    // Только k=["requests"] — основной entry с запросом+ответом
                    if (kStr === JSON.stringify(['requests']) && Array.isArray(v)) {
                        for (const req of v) {
                            if (!req || typeof req !== 'object') continue;
                            if (!req.requestId) continue;
                            
                            const ts = req.timestamp || Date.now();
                            
                            // 1) Извлекаем сообщение пользователя
                            let userMsg = '';
                            
                            // Сначала пробуем renderedUserMessage (самый надёжный)
                            if (req.result?.metadata?.renderedUserMessage) {
                                const rendered = req.result.metadata.renderedUserMessage;
                                for (const part of rendered) {
                                    if (part && part.type === 1 && part.text) {
                                        userMsg = this.cleanCodexMessage(part.text);
                                        break;
                                    }
                                }
                            }
                            
                            // Fallback: используем lastInputText из kind:1 патчей
                            if (!userMsg && lastInputText) {
                                userMsg = lastInputText;
                            }
                            
                            // 2) Извлекаем ответ ассистента из result.response
                            const responseStrings: string[] = [];
                            if (req.result?.response && Array.isArray(req.result.response)) {
                                for (const resPart of req.result.response) {
                                    if (resPart && typeof resPart === 'object') {
                                        // Пропускаем thinking, mcpServersStarting и т.д.
                                        const rKind = resPart.kind;
                                        if (rKind === 'thinking' || rKind === 'mcpServersStarting') continue;
                                        // Берём value — это текст ответа
                                        if (typeof resPart.value === 'string' && resPart.value) {
                                            responseStrings.push(resPart.value);
                                        }
                                    }
                                }
                            }
                            
                            parsedRequests.push({
                                userMessage: userMsg,
                                timestamp: ts,
                                responseChunks: responseStrings
                            });
                        }
                    }
                } catch { /* skip parse errors */ }
            }

            // Собираем сообщения
            const messages: ChatMessage[] = [];
            for (const req of parsedRequests) {
                if (req.userMessage) {
                    messages.push({
                        id: `user_${messages.length}`,
                        role: 'user',
                        content: req.userMessage,
                        timestamp: req.timestamp,
                        agentName: undefined
                    });
                }
                if (req.responseChunks.length > 0) {
                    messages.push({
                        id: `assistant_${messages.length}`,
                        role: 'assistant',
                        content: req.responseChunks.join(''),
                        timestamp: req.timestamp,
                        agentName: undefined
                    });
                }
            }

            return { id: sessionId, title, messages };
        } catch {
            return null;
        }
    }

    /**
     * Возвращает список всех чатов (id, title, lastMessage, lastTimestamp) из ВСЕХ workspaceStorage
     */
    private getAllVSCodeChats(): Array<{ id: string, title: string, lastMessage: string, lastTimestamp: number }> {
        const result: Array<{ id: string, title: string, lastMessage: string, lastTimestamp: number }> = [];
        const wsDirs = this.getAllWorkspaceStorageDirs();
        for (const wsDir of wsDirs) {
            const chatDir = path.join(wsDir, 'chatSessions');
            if (!fs.existsSync(chatDir)) continue;
            const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.jsonl'));
            for (const file of files) {
                try {
                    const fullPath = path.join(chatDir, file);
                    const parsed = this.parseVSCodeSession(fullPath);
                    if (!parsed) continue;
                    // Пропускаем дубликаты sessionId (берём из первой папки)
                    if (result.some(r => r.id === parsed.id)) continue;
                    const msgs = parsed.messages;
                    let lastMessage = '';
                    let lastTimestamp = 0;
                    if (msgs.length > 0) {
                        const last = msgs[msgs.length - 1];
                        lastMessage = last.content.slice(0, 100);
                        lastTimestamp = last.timestamp;
                    }
                    result.push({ id: parsed.id, title: parsed.title || 'Чат', lastMessage, lastTimestamp });
                } catch {}
            }
        }
        return result.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    }

    /**
     * Возвращает историю сообщений для чата (объединяя JSONL + in-memory)
     */
    private getVSCodeChatHistory(chatId: string): ChatMessage[] {
        // 1. Сначала собираем сообщения из ВСЕХ JSONL-файлов, 
        //    где sessionId совпадает с chatId
        const jsonlMessages: ChatMessage[] = [];
        const wsDirs = this.getAllWorkspaceStorageDirs();
        for (const wsDir of wsDirs) {
            const chatDir = path.join(wsDir, 'chatSessions');
            if (!fs.existsSync(chatDir)) continue;
            const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.jsonl'));
            for (const file of files) {
                try {
                    const fullPath = path.join(chatDir, file);
                    const parsed = this.parseVSCodeSession(fullPath);
                    if (parsed && parsed.id === chatId) {
                        jsonlMessages.push(...parsed.messages);
                    }
                } catch {}
            }
        }

        // 2. Добавляем in-memory сообщения (с телефона) 
        const inMemory = this.chatHistory.get(chatId) || [];
        
        // Объединяем: JSONL сообщения + in-memory, 
        // in-memory перезаписывают JSONL (они новее / с телефона)
        const seenIds = new Set<string>();
        const merged: ChatMessage[] = [];
        
        // Сначала все JSONL сообщения
        for (const msg of jsonlMessages) {
            if (!seenIds.has(msg.id)) {
                seenIds.add(msg.id);
                merged.push(msg);
            }
        }
        // Потом in-memory (перезаписывают дубликаты)
        for (const msg of inMemory) {
            if (!seenIds.has(msg.id)) {
                seenIds.add(msg.id);
                merged.push(msg);
            }
        }

        return merged;
    }

    // GET /api/chat/history?chatId=...
    private async handleChatHistory(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const params = url.parse(req.url || '', true).query;
        const chatId = (params.chatId as string) || this.currentChatId;
        // Читаем историю из chatSessions
        const history = this.getVSCodeChatHistory(chatId);
        this.jsonResponse(res, 200, {
            chatId,
            messages: history,
            agentName: this.selectedAgent
        });
    }

    // POST /api/chat/select-agent
    private async handleSelectAgent(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { agentName } = JSON.parse(body);

        const available = await this.getAvailableAgents();
        const agent = available.find(a => a.name === agentName);

        if (!agent) {
            this.jsonResponse(res, 400, { error: `Agent '${agentName}' not found`, available: available.map(a => a.name) });
            return;
        }

        this.selectedAgent = agentName;

        // Сохраняем выбранного агента
        try {
            this._context.globalState.update('selected_agent', agentName);
        } catch (e) { /* ignore */ }

        // Уведомляем WS клиентов о смене агента
        this.broadcast({
            type: 'chat:agent-changed',
            agentName,
            agent
        });

        this.jsonResponse(res, 200, {
            success: true,
            selected: agentName,
            agent
        });
    }

    // POST /api/chat/new
    private async handleNewChat(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const newId = `chat_${Date.now()}`;
        this.chatHistory.set(newId, []);
        this.currentChatId = newId;

        // Сохраняем текущий чат
        try {
            this._context.globalState.update('current_chat_id', newId);
        } catch (e) { /* ignore */ }

        // Уведомляем WS клиентов о новом чате
        this.broadcast({
            type: 'chat:new',
            chatId: newId,
            currentChatId: this.currentChatId
        });

        this.jsonResponse(res, 200, { chatId: newId });
    }

    // GET /api/chat/conversations
    private async handleGetConversations(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        // Читаем реальные чаты из ВСЕХ chatSessions
        const jsonlChats = this.getAllVSCodeChats();
        if (this.currentChatId === 'default' && jsonlChats.length > 0) {
            this.currentChatId = jsonlChats[0].id;
        }
        const conversations: Array<{
            id: string;
            title: string;
            messageCount: number;
            lastMessage: string;
            lastTimestamp: number;
            isCurrent: boolean;
        }> = jsonlChats.map(c => ({
            id: c.id,
            title: c.title,
            messageCount: 0,
            lastMessage: c.lastMessage,
            lastTimestamp: c.lastTimestamp,
            isCurrent: c.id === this.currentChatId
        }));

        // Добавляем in-memory чаты (созданные с телефона)
        for (const [chatId, messages] of this.chatHistory.entries()) {
            if (!conversations.some(c => c.id === chatId) && messages.length > 0) {
                const lastMsg = messages[messages.length - 1];
                conversations.push({
                    id: chatId,
                    title: chatId.startsWith('chat_') ? 'Чат с телефона' : chatId,
                    messageCount: messages.length,
                    lastMessage: lastMsg.content.slice(0, 100),
                    lastTimestamp: lastMsg.timestamp,
                    isCurrent: chatId === this.currentChatId
                });
            }
        }

        // Сортируем по времени (сначала новые)
        conversations.sort((a, b) => b.lastTimestamp - a.lastTimestamp);

        this.jsonResponse(res, 200, {
            conversations,
            current: this.currentChatId
        });
    }

    // GET /api/diagnostics
    private async handleDiagnostics(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const items: DiagnosticItem[] = [];
        const allDiagnostics = vscode.languages.getDiagnostics();

        for (const [uri, diagnostics] of allDiagnostics) {
            for (const d of diagnostics) {
                const severity: 'error' | 'warning' | 'info' =
                    d.severity === vscode.DiagnosticSeverity.Error ? 'error' :
                    d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : 'info';

                items.push({
                    file: uri.fsPath,
                    line: d.range.start.line + 1,
                    column: d.range.start.character + 1,
                    message: d.message,
                    severity,
                    code: typeof d.code === 'string' ? d.code : String(d.code || '')
                });
            }
        }

        // Группируем
        const errors = items.filter(i => i.severity === 'error');
        const warnings = items.filter(i => i.severity === 'warning');

        this.jsonResponse(res, 200, {
            total: items.length,
            errors: errors.length,
            warnings: warnings.length,
            items: items.slice(0, 200), // максимум 200
        });
    }

    // POST /api/terminal/exec
    private async handleTerminalExec(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { command, cwd } = JSON.parse(body);

        if (!command || typeof command !== 'string') {
            this.jsonResponse(res, 400, { error: 'Command is required' });
            return;
        }

        const threadId = this.currentRemoteThreadId || this.createRemoteCodeThread();
        const event: RemoteCodeActionEvent = {
            id: `terminal_action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'command_approval',
            title: 'Run terminal command',
            detail: command.trim(),
            status: 'pending',
            timestamp: Date.now(),
            threadId,
            actionable: true,
            command: command.trim(),
            cwd: typeof cwd === 'string' && cwd.trim() ? cwd.trim() : undefined
        };
        this.codexActionEvents = this.codexActionEvents.concat(event).slice(-250);
        this.saveRemoteCodeState();
        this.refreshPcChatPanel();
        this.broadcast({
            type: 'codex:approval-request',
            threadId,
            event,
            events: this.getActionEventsForThread(threadId),
            timestamp: Date.now()
        });
        this.jsonResponse(res, 202, {
            success: false,
            pendingApproval: true,
            actionId: event.id,
            command: event.command,
            message: 'Command queued for approval in Remote Code chat.'
        });
    }

    // ========== WEBSOCKET ==========

    private async handleWsConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
        const publicAccess = this.requestUsesPublicAccess(req);
        const authRequired = this.isAuthRequiredForRequest(req, '/ws', publicAccess);
        if (authRequired && !this.checkAuth(req, true)) {
            ws.close(1008, 'Unauthorized');
            return;
        }

        this.wsClients.add(ws);
        this.wsClientKeys.set(ws, this.getWsClientKey(req));
        console.log('[RemoteCodeOnPC] WebSocket клиент подключился');
        this.startWsCodexMirrorPolling();

        ws.on('close', () => {
            this.wsClients.delete(ws);
            this.wsClientKeys.delete(ws);
            if (this.wsClients.size === 0) {
                this.stopWsCodexMirrorPolling();
            }
            console.log('[RemoteCodeOnPC] WebSocket клиент отключился');
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                // Можно обрабатывать входящие WS сообщения
                if (msg.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                }
            } catch (e) {
                // ignore
            }
        });

        // Отправляем приветственное сообщение с полным состоянием
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const activeEditor = vscode.window.activeTextEditor;
        ws.send(JSON.stringify({
            type: 'connected',
            timestamp: Date.now(),
            state: {
                selectedAgent: this.selectedAgent,
                currentChatId: this.currentChatId,
                activeFile: activeEditor?.document.uri.fsPath || null,
                activeFileLanguage: activeEditor?.document.languageId || null,
                folders: workspaceFolders.map(f => ({
                    name: f.name,
                    uri: f.uri.toString(),
                    path: f.uri.fsPath
                }))
            }
        }));
    }

    private broadcastDiagnostics(): void {
        // Собираем диагностику и отправляем всем WS клиентам
        const items: DiagnosticItem[] = [];
        const allDiagnostics = vscode.languages.getDiagnostics();

        for (const [uri, diagnostics] of allDiagnostics) {
            for (const d of diagnostics) {
                const severity: 'error' | 'warning' | 'info' =
                    d.severity === vscode.DiagnosticSeverity.Error ? 'error' :
                    d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : 'info';

                items.push({
                    file: uri.fsPath,
                    line: d.range.start.line + 1,
                    column: d.range.start.character + 1,
                    message: d.message,
                    severity,
                    code: typeof d.code === 'string' ? d.code : String(d.code || '')
                });
            }
        }

        this.broadcast({
            type: 'diagnostics:update',
            total: items.length,
            errors: items.filter(i => i.severity === 'error').length,
            warnings: items.filter(i => i.severity === 'warning').length
        });
    }

    /**
     * Запускает FileSystem Watcher за chatSessions/*.jsonl.
     * При изменении любого JSONL-файла уведомляем WS клиентов.
     */
    private startChatSessionWatcher(): void {
        try {
            const dirs = this.getAllWorkspaceStorageDirs();
            for (const wsDir of dirs) {
                const chatDir = path.join(wsDir, 'chatSessions');
                if (!fs.existsSync(chatDir)) continue;
                const watcher = fs.watch(chatDir, (eventType, filename) => {
                    if (!filename) return;
                    if (filename.endsWith('.jsonl')) {
                        // Даём время на завершение записи
                        setTimeout(() => {
                            this.broadcastChatSessionsUpdate();
                        }, 500);
                    }
                });
                this._chatSessionWatchers.push(watcher);
                console.log(`[RemoteCodeOnPC] File watcher запущен: ${chatDir}`);
            }
            const codexRoot = this.getCodexSessionsRoot();
            if (fs.existsSync(codexRoot)) {
                const codexWatcher = fs.watch(codexRoot, { recursive: true }, (_eventType, filename) => {
                    if (!filename || !filename.toString().endsWith('.jsonl')) return;
                    setTimeout(() => {
                        this.codexSessionFilesCache = undefined;
                        this.remoteCodeThreadsCache = undefined;
                        this.refreshPcChatPanelForExternalCodexChange();
                        this.broadcast({
                            ...this.getRemoteCodeThreadsUpdatePayload(),
                            type: 'codex:sessions-update'
                        });
                    }, 2000);
                });
                this._chatSessionWatchers.push(codexWatcher);
                console.log(`[RemoteCodeOnPC] Codex watcher started: ${codexRoot}`);
            }
        } catch (err) {
            console.error('[RemoteCodeOnPC] Ошибка запуска file watcher:', err);
        }
    }

    /**
     * Уведомляет всех WS клиентов об обновлении чатов (JSONL + in-memory).
     */
    private broadcastChatSessionsUpdate(): void {
        try {
            const jsonlChats = this.getAllVSCodeChats();
            const conversations: Array<{
                id: string; title: string; messageCount: number;
                lastMessage: string; lastTimestamp: number; isCurrent: boolean;
            }> = jsonlChats.map(c => ({
                id: c.id,
                title: c.title,
                messageCount: 0,
                lastMessage: c.lastMessage,
                lastTimestamp: c.lastTimestamp,
                isCurrent: c.id === this.currentChatId
            }));
            // Добавляем in-memory чаты
            for (const [chatId, messages] of this.chatHistory.entries()) {
                if (!conversations.some(c => c.id === chatId) && messages.length > 0) {
                    const lastMsg = messages[messages.length - 1];
                    conversations.push({
                        id: chatId,
                        title: chatId.startsWith('chat_') ? 'Чат с телефона' : chatId,
                        messageCount: messages.length,
                        lastMessage: lastMsg.content.slice(0, 100),
                        lastTimestamp: lastMsg.timestamp,
                        isCurrent: chatId === this.currentChatId
                    });
                }
            }
            conversations.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
            this.broadcast({
                type: 'chat:sessions-update',
                conversations,
                timestamp: Date.now()
            });
        } catch (err) {
            console.error('[RemoteCodeOnPC] broadcastChatSessionsUpdate error:', err);
        }
    }

    private broadcast(data: any): void {
        const message = JSON.stringify(data);
        for (const ws of this.wsClients) {
            try {
                ws.send(message);
            } catch (e) {
                this.wsClients.delete(ws);
                this.wsClientKeys.delete(ws);
            }
        }
    }

    // ========== HELPERS ==========

    private setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
        const origin = this.headerToString(req.headers.origin).trim();
        res.setHeader('Vary', 'Origin');
        if (origin && this.isAllowedCorsOrigin(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    private isAllowedCorsOrigin(origin: string): boolean {
        if (!origin) return false;
        try {
            const parsed = new URL(origin);
            if (parsed.protocol === 'vscode-webview:') return true;
            const host = parsed.hostname.toLowerCase();
            if (this.isLocalOrPrivateHost(host)) return true;
            const allowedPublicHosts = [
                this.getConfiguredPublicUrl(),
                this._tunnelUrl || '',
                this.getConfiguredKeeneticHost()
            ]
                .map(value => this.extractHost(value))
                .filter(Boolean);
            return allowedPublicHosts.includes(host);
        } catch {
            return false;
        }
    }

    private isLocalOnlyBind(): boolean {
        const host = (this._host || '').trim().toLowerCase();
        return host === '127.0.0.1' || host === 'localhost' || host === '::1';
    }

    private isAuthRequiredForRequest(req: http.IncomingMessage, pathname: string, publicAccess = this.requestUsesPublicAccess(req)): boolean {
        if (this.isPublicStatusEndpoint(pathname)) {
            return !!this._authToken || publicAccess || !this.isLocalOnlyBind();
        }
        return !!this._authToken || publicAccess || !this.isLocalOnlyBind();
    }

    private checkAuth(req: http.IncomingMessage, requireConfiguredToken = false): boolean {
        if (!this._authToken) return !requireConfiguredToken;
        const authHeader = req.headers['authorization'];
        return authHeader === `Bearer ${this._authToken}`;
    }

    private isPublicStatusEndpoint(pathname: string): boolean {
        return pathname === '/api/status' || pathname === '/api/tunnel/status';
    }

    private isPublicAssetEndpoint(pathname: string): boolean {
        return pathname === '/api/app/apk' || pathname === '/api/app/apk/status';
    }

    private getExtensionVersion(): string {
        try {
            const packagePath = path.join(this._context.extensionPath, 'package.json');
            const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            if (typeof parsed.version === 'string' && parsed.version.trim()) {
                return parsed.version;
            }
        } catch {
            // Fall back to VS Code's cached package metadata below.
        }
        return vscode.extensions.getExtension('remote-code-on-pc.remote-code-on-pc')?.packageJSON?.version
            || (this._context as any).extension?.packageJSON?.version
            || 'dev';
    }

    private publicAuthRequiredStatus(publicUrl: string | null, publicProvider: PublicAccessProvider | null): any {
        return {
            version: vscode.version,
            serverVersion: this.getExtensionVersion(),
            appApk: this.getPublicAppApkMetadata(),
            appName: vscode.env.appName,
            isRunning: true,
            platform: process.platform,
            remoteCode: {
                port: this._port,
                host: this._host,
                localIp: '',
                localUrl: '',
                publicUrl: null,
                tunnelUrl: null,
                activeUrl: '',
                tunnelActive: !!publicUrl,
                tunnelProvider: publicProvider,
                keeneticHost: '',
                keeneticZone: this.getKeeneticZone(),
                keeneticScheme: this.getKeeneticScheme(),
                autoUrlSupported: true,
                authRequired: true,
                authOk: false,
                tokenConfigured: !!this._authToken
            },
            workspace: {
                folders: [],
                activeFile: null,
                activeFileLanguage: null
            },
            uptime: process.uptime(),
            memoryUsage: 0
        };
    }

    private requestUsesPublicAccess(req: http.IncomingMessage): boolean {
        const hostHeader = String(req.headers.host || '').trim().toLowerCase();
        const host = this.extractHost(hostHeader);
        if (!host || this.isLocalOrPrivateHost(host)) return false;
        const publicHosts = [
            this.getConfiguredPublicUrl(),
            this._tunnelUrl || '',
            this.getConfiguredKeeneticHost()
        ]
            .map(value => this.extractHost(value))
            .filter(Boolean);
        if (publicHosts.some(publicHost => publicHost === host)) return true;
        if (this.looksLikeKeeneticHost(host)
            || host.endsWith('.trycloudflare.com')
            || host.endsWith('.netcraze.io')
            || host.endsWith('.netcraze.pro')
            || host.endsWith('.ngrok-free.app')
            || host.endsWith('.ngrok.io')) {
            return true;
        }
        return true;
    }

    private extractHost(value: string | null | undefined): string {
        const raw = (value || '').trim();
        if (!raw) return '';
        try {
            return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname.toLowerCase();
        } catch {
            return raw.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();
        }
    }

    private isLocalOrPrivateHost(host: string): boolean {
        const normalized = host.toLowerCase();
        const machineName = os.hostname().toLowerCase();
        if (normalized === 'localhost' || normalized === '::1' || normalized === '0.0.0.0') return true;
        if (normalized === machineName || normalized === `${machineName}.local`) return true;
        if (normalized.startsWith('127.')) return true;
        if (normalized.startsWith('10.')) return true;
        if (normalized.startsWith('192.168.')) return true;
        const match = normalized.match(/^172\.(\d{1,2})\./);
        if (match) {
            const second = Number(match[1]);
            if (second >= 16 && second <= 31) return true;
        }
        return normalized === (this._localIp || '').toLowerCase();
    }

    private isLoopbackHost(host: string): boolean {
        const normalized = (host || '').trim().toLowerCase();
        return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
    }

    private shouldExposePubliclyFromSettings(): boolean {
        return !!(
            this.getConfiguredPublicUrl()
            || this.getConfiguredKeeneticHost()
            || (this._tunnelUrl && !this.isUnsupportedKeeneticServiceUrl(this._tunnelUrl))
        );
    }

    private get bindHost(): string {
        const configuredHost = (this._host || '').trim();
        const shouldExpose = this.shouldExposePubliclyFromSettings();
        if (!configuredHost) {
            return shouldExpose ? '0.0.0.0' : '127.0.0.1';
        }
        if (!this.isLocalOrPrivateHost(configuredHost) && shouldExpose) {
            return '0.0.0.0';
        }
        if (this.isLoopbackHost(configuredHost) && shouldExpose) {
            return '0.0.0.0';
        }
        return configuredHost;
    }

    private enrichCodexMessageForClient(message: CodexChatMessage): CodexChatMessage {
        const content = message.role === 'assistant' || message.role === 'system'
            ? this.normalizeRemoteCodeDisplayText(message.content || '')
            : message.content;
        const normalized = content === message.content ? message : { ...message, content };
        if (normalized.changeSummary?.files?.length) return normalized;
        const summary = this.getGitChangeSummaryFromMessage(message.content || '', message.timestamp);
        return summary ? { ...normalized, changeSummary: summary } : normalized;
    }

    private normalizeRemoteCodeDisplayText(content: string): string {
        const legacyAgentLabel = ['Remote Code', 'Agent'].join(' ');
        const legacyMethodLabel = ['remote-code', 'agent'].join('-');
        return content
            .split(legacyAgentLabel).join('Remote Code')
            .split(legacyMethodLabel).join('remote-code');
    }

    private jsonResponse(res: http.ServerResponse, status: number, data: any): void {
        const body = JSON.stringify(data);
        const bytes = Buffer.byteLength(body, 'utf8');
        res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': bytes,
            'Connection': 'close',
            'Cache-Control': 'no-store'
        });
        res.end(body);
    }

    private logHttpRequest(line: string): void {
        try {
            const dir = this._context.globalStorageUri.fsPath;
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, 'remote-http.log');
            const entry = `[${new Date().toISOString()}] ${this.sanitizeLogText(line)}\n`;
            fs.appendFileSync(file, entry, 'utf8');
            const maxBytes = 256 * 1024;
            const stat = fs.statSync(file);
            if (stat.size > maxBytes) {
                const text = fs.readFileSync(file, 'utf8');
                fs.writeFileSync(file, text.slice(-maxBytes), 'utf8');
            }
        } catch {
            // Logging must never break the server.
        }
    }

    private sanitizeLogText(value: string): string {
        return String(value || '')
            .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[redacted]')
            .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi, '$1[redacted]')
            .replace(/([?&]token=)[^&\s]+/gi, '$1[redacted]')
            .replace(/(authToken["'\s:=]+)[A-Za-z0-9._~+/-]{12,}/gi, '$1[redacted]')
            .replace(/\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[private-ip]')
            .replace(/\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g, '[private-ip]')
            .replace(/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, '[private-ip]')
            .replace(/https?:\/\/[^\s"'<>]+(?:trycloudflare\.com|netcraze\.(?:io|pro)|keenetic\.(?:link|name|pro|io|net))[^\s"'<>]*/gi, '[public-url]');
    }

    private findAppApkPath(): string | undefined {
        const candidates = new Set<string>();
        const addCandidate = (candidate?: string) => {
            if (candidate) candidates.add(path.resolve(candidate));
        };

        addCandidate(path.join(this._context.extensionPath, 'apk', 'app-debug.apk'));
        for (const folder of vscode.workspace.workspaceFolders || []) {
            addCandidate(path.join(folder.uri.fsPath, 'apk', 'app-debug.apk'));
        }
        addCandidate(path.join(process.cwd(), 'apk', 'app-debug.apk'));

        return Array.from(candidates).find(candidate => fs.existsSync(candidate));
    }

    private getAppApkMetadata(): AppApkMetadata | undefined {
        const apkPath = this.findAppApkPath();
        if (!apkPath) return undefined;
        const stat = fs.statSync(apkPath);
        const cached = this.appApkMetadataCache;
        if (cached && cached.apkPath === apkPath && cached.sizeBytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
            return cached.metadata;
        }
        const sha256 = crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
        const version = this.getAndroidBuildVersion();
        const metadata: AppApkMetadata = {
            apkPath,
            sizeBytes: stat.size,
            sha256,
            versionName: version.versionName,
            versionCode: version.versionCode
        };
        this.appApkMetadataCache = { apkPath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs, metadata };
        return metadata;
    }

    private getPublicAppApkMetadata(): Omit<AppApkMetadata, 'apkPath'> | undefined {
        const metadata = this.getAppApkMetadata();
        if (!metadata) return undefined;
        const { apkPath: _apkPath, ...safe } = metadata;
        return safe;
    }

    private getAndroidBuildVersion(): { versionName?: string; versionCode?: number } {
        const roots = new Set<string>();
        for (const folder of vscode.workspace.workspaceFolders || []) {
            roots.add(folder.uri.fsPath);
        }
        roots.add(path.resolve(this._context.extensionPath, '..'));
        roots.add(process.cwd());
        for (const root of roots) {
            try {
                const filePath = path.join(root, 'android', 'app', 'build.gradle.kts');
                if (!fs.existsSync(filePath)) continue;
                const content = fs.readFileSync(filePath, 'utf8');
                const versionName = content.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
                const versionCode = Number(content.match(/versionCode\s*=\s*(\d+)/)?.[1]);
                return {
                    versionName,
                    versionCode: Number.isFinite(versionCode) ? versionCode : undefined
                };
            } catch {
                // Try the next likely repo root.
            }
        }
        return {};
    }

    private async handleAppApkStatus(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const metadata = this.getAppApkMetadata();
        if (!metadata) {
            this.jsonResponse(res, 404, { available: false, error: 'APK not found' });
            return;
        }
        this.jsonResponse(res, 200, {
            available: true,
            filename: 'remote-code-on-pc.apk',
            sizeBytes: metadata.sizeBytes,
            sha256: metadata.sha256,
            versionName: metadata.versionName,
            versionCode: metadata.versionCode,
            serverVersion: this.getExtensionVersion()
        });
    }

    private async handleAppApk(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const metadata = this.getAppApkMetadata();
        if (!metadata) {
            this.jsonResponse(res, 404, { error: 'APK not found' });
            return;
        }
        const { apkPath, sizeBytes, sha256 } = metadata;
        const headers: Record<string, string | number> = {
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Length': sizeBytes,
            'Content-Disposition': 'attachment; filename="remote-code-on-pc.apk"',
            'Cache-Control': 'no-store',
            'X-Remote-Code-Apk-Sha256': sha256,
            'X-Remote-Code-Apk-Size': String(sizeBytes)
        };
        if (metadata.versionName) headers['X-Remote-Code-Apk-Version'] = metadata.versionName;
        if (metadata.versionCode) headers['X-Remote-Code-Apk-Version-Code'] = String(metadata.versionCode);
        res.writeHead(200, headers);
        fs.createReadStream(apkPath).pipe(res);
    }

    private readBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk: string) => {
                body += chunk;
                if (body.length > 40 * 1024 * 1024) {
                    reject(new Error('Request body too large'));
                    req.destroy();
                }
            });
            req.on('end', () => resolve(body));
            req.on('error', reject);
        });
    }

    private async getAvailableAgents(): Promise<ChatAgent[]> {
        if (this.agentCache && Date.now() - this.agentCache.timestamp < 30000) {
            return this.agentCache.agents;
        }

        // Динамически получаем модели из VS Code LM API
        const agents: ChatAgent[] = [];

        // Пробуем получить реальные модели от VS Code Language Model API
        try {
            const lmModels = await this.getCachedLanguageModels();
            if (lmModels) {
                for (const model of lmModels) {
                    const name = (model as any).id || (model as any).name || '';
                    const displayName = (model as any).name || name;
                    const vendor = (model as any).vendor || 'unknown';
                    const modelId = (model as any).id || (model as any).family || '';
                    if (name && !agents.find(a => a.name === name)) {
                        agents.push({
                            name,
                            displayName,
                            vendor,
                            model: modelId,
                            isDefault: agents.length === 0
                        });
                    }
                }
            }
        } catch (e) {
            // VS Code LM API недоступен — используем fallback
        }

        // Если LM API не дал результатов — используем стандартные Copilot модели
        if (agents.length === 0) {
            agents.push(
                { name: 'auto', displayName: 'Auto', vendor: 'github', isDefault: true, model: 'Автовыбор модели' },
                { name: 'gpt-5.3-codex', displayName: 'GPT-5.3-Codex', vendor: 'openai', model: 'GPT-5.3-Codex' },
                { name: 'gpt-5.2-codex', displayName: 'GPT-5.2-Codex', vendor: 'openai', model: 'GPT-5.2-Codex' },
                { name: 'gpt-5.4', displayName: 'GPT-5.4', vendor: 'openai', model: 'GPT-5.4' },
                { name: 'gpt-5.4-mini', displayName: 'GPT-5.4 mini', vendor: 'openai', model: 'GPT-5.4 mini' },
                { name: 'gpt-4o', displayName: 'GPT-4o', vendor: 'openai', model: 'GPT-4o' },
                { name: 'gpt-4o-mini', displayName: 'GPT-4o-mini', vendor: 'openai', model: 'GPT-4o-mini' },
                { name: 'o3-mini', displayName: 'o3-mini', vendor: 'openai', model: 'o3-mini' },
                { name: 'o4-mini', displayName: 'o4-mini', vendor: 'openai', model: 'o4-mini' },
            );
        }

        // Если selected agent не в списке, сбрасываем на первый
        if (!agents.find(a => a.name === this.selectedAgent)) {
            this.selectedAgent = agents[0]?.name || 'auto';
        }

        this.agentCache = { timestamp: Date.now(), agents };
        return agents;
    }

    private async getCachedLanguageModels(forceRefresh = false): Promise<readonly vscode.LanguageModelChat[]> {
        const now = Date.now();
        const cacheTtlMs = 5 * 60 * 1000;
        if (!forceRefresh && this.lmModelsCache && now - this.lmModelsCache.timestamp < cacheTtlMs) {
            return this.lmModelsCache.models;
        }

        if (this.lmModelsBlockedUntil > now) {
            if (this.lmModelsCache) return this.lmModelsCache.models;
            throw new Error(this.getLanguageModelBlockedMessage());
        }

        if (this.lmModelsInflight) return this.lmModelsInflight;

        this.lmModelsInflight = (async () => {
            try {
                let models: readonly vscode.LanguageModelChat[] = [];
                try {
                    models = await this.withTimeout(
                        vscode.lm.selectChatModels({ vendor: 'copilot' }),
                        7000,
                        'VS Code не вернул список моделей за 7 секунд.'
                    );
                } catch (err: any) {
                    console.warn('[RemoteCodeOnPC] VS Code LM vendor lookup timed out or failed:', err?.message || String(err));
                }
                if (!models || models.length === 0) {
                    models = await this.withTimeout(
                        vscode.lm.selectChatModels({}),
                        7000,
                        'VS Code не вернул список моделей за 7 секунд.'
                    );
                }
                this.lmModelsCache = { timestamp: Date.now(), models };
                return models;
            } catch (err: any) {
                if (this.isLanguageModelRateLimitError(err)) {
                    this.lmModelsBlockedUntil = Date.now() + 2 * 60 * 1000;
                }
                if (this.lmModelsCache) return this.lmModelsCache.models;
                throw err;
            } finally {
                this.lmModelsInflight = undefined;
            }
        })();

        return this.lmModelsInflight;
    }

    private isLanguageModelRateLimitError(err: any): boolean {
        const text = `${err?.message || ''} ${err?.name || ''} ${String(err || '')}`.toLowerCase();
        return text.includes('too many requests')
            || text.includes('temporarily blocked')
            || text.includes('rate limit')
            || text.includes('429');
    }

    private getLanguageModelBlockedMessage(): string {
        const seconds = Math.max(1, Math.ceil((this.lmModelsBlockedUntil - Date.now()) / 1000));
        return `VS Code/Copilot временно ограничил запросы из-за слишком частых обращений. Подождите примерно ${seconds} сек. и отправьте снова.`;
    }

    private isRemoteCodeModel(agent: ChatAgent): boolean {
        const id = (agent.name || '').toLowerCase();
        const display = (agent.displayName || '').toLowerCase();
        const model = (agent.model || '').toLowerCase();
        const vendor = (agent.vendor || '').toLowerCase();
        const text = `${id} ${display} ${model} ${vendor}`;

        if (id === 'auto') return true;
        if (/(claude|anthropic|gemini|google|grok|xai|deepseek|mistral|llama)/.test(text)) return false;
        return (
            text.includes('codex') ||
            vendor === 'openai' ||
            /^gpt[-_.]/.test(id) ||
            /^o\d/.test(id)
        );
    }

    private getRemoteCodeModelAgents(_agents: ChatAgent[]): ChatAgent[] {
        return this.getDefaultCodexModels().map((model, index) => ({
            name: model.id,
            displayName: model.name,
            vendor: 'openai',
            model: model.name,
            isDefault: index === 0
        }));
    }

    private ensureRemoteCodeSelectedAgent(agents: ChatAgent[]): string {
        if (!agents.find(agent => agent.name === this.selectedAgent)) {
            this.selectedAgent = 'gpt-5.5';
            this.saveRemoteCodeState();
        }
        return this.selectedAgent;
    }

    private restoreRemoteCodeState(): void {
        try {
            const savedHistory = this._context.globalState.get<CodexChatMessage[]>('remote_code_history', []);
            const savedActions = this._context.globalState.get<RemoteCodeActionEvent[]>('remote_code_actions', []);
            const savedThreads = this._context.globalState.get<RemoteCodeThreadSummary[]>('remote_code_threads', []);
            const savedThreadId = this._context.globalState.get<string>('remote_code_current_thread_id', 'remote-code-default');
            const savedAgent = this._context.globalState.get<string>('remote_code_selected_agent', this.selectedAgent);
            const savedEffort = this._context.globalState.get<string>('remote_code_reasoning_effort', this.selectedReasoningEffort);
            const savedIncludeContext = this._context.globalState.get<boolean>('remote_code_include_context', this.selectedIncludeContext);
            const savedWorkMode = this._context.globalState.get<string>('remote_code_work_mode', this.selectedWorkMode);
            const savedProfile = this._context.globalState.get<string>('remote_code_profile', this.selectedProfile);
            const savedHiddenCodexThreads = this._context.globalState.get<string[]>('remote_code_hidden_codex_threads', []);
            const savedHiddenMessages = this._context.globalState.get<string[]>('remote_code_hidden_messages', []);
            const savedPinnedThreads = this._context.globalState.get<string[]>('remote_code_pinned_threads', []);
            const savedArchivedThreads = this._context.globalState.get<string[]>('remote_code_archived_threads', []);
            const allowedModelIds = new Set(this.getDefaultCodexModels().map(model => model.id));
            this.codexHistory = Array.isArray(savedHistory) ? savedHistory.slice(-200) : [];
            this.codexActionEvents = Array.isArray(savedActions) ? savedActions.slice(-250) : [];
            this.remoteCodeThreads = Array.isArray(savedThreads)
                ? savedThreads
                    .filter(thread => thread && typeof thread.id === 'string' && thread.id.trim())
                    .map(thread => ({
                        id: thread.id.trim(),
                        title: this.cleanThreadTitle(thread.title) || 'Новый чат',
                        timestamp: Number.isFinite(thread.timestamp) ? thread.timestamp : Date.now(),
                        source: thread.source || (thread.id.startsWith('codex-file:') ? 'codex' : 'remote'),
                        workspaceName: thread.workspaceName,
                        workspacePath: thread.workspacePath
                    }))
                    .slice(-80)
                : [];
            this.currentRemoteThreadId = savedThreadId || 'remote-code-default';
            this.selectedAgent = allowedModelIds.has(savedAgent) ? savedAgent : 'gpt-5.5';
            this.selectedReasoningEffort = savedEffort || this.selectedReasoningEffort;
            this.selectedIncludeContext = savedIncludeContext !== false;
            this.selectedWorkMode = savedWorkMode === 'workspace' ? 'workspace' : 'local';
            this.selectedProfile = ['user', 'review', 'fast'].includes(savedProfile || '') ? savedProfile : 'user';
            this.hiddenCodexThreadIds = new Set(Array.isArray(savedHiddenCodexThreads) ? savedHiddenCodexThreads.filter(Boolean) : []);
            this.hiddenRemoteMessageIds = new Set(Array.isArray(savedHiddenMessages) ? savedHiddenMessages.filter(Boolean) : []);
            this.pinnedThreadIds = new Set(Array.isArray(savedPinnedThreads) ? savedPinnedThreads.filter(Boolean) : []);
            this.archivedThreadIds = new Set(Array.isArray(savedArchivedThreads) ? savedArchivedThreads.filter(Boolean) : []);
            this.pruneEmptyRemoteCodeThreads(false);
            if (this.isHiddenThread(this.currentRemoteThreadId)) {
                this.currentRemoteThreadId = this.remoteCodeThreads.find(thread => thread.id && !this.isHiddenThread(thread.id))?.id || '';
            }
            if (this.currentRemoteThreadId && !this.remoteCodeThreads.some(thread => thread.id === this.currentRemoteThreadId) && !this.hasVisibleRemoteThreadContent(this.currentRemoteThreadId)) {
                this.currentRemoteThreadId = this.remoteCodeThreads.find(thread => thread.id && !this.isHiddenThread(thread.id))?.id || '';
            }
            if (this.currentRemoteThreadId && !this.currentRemoteThreadId.startsWith('codex-file:') && this.hasVisibleRemoteThreadContent(this.currentRemoteThreadId)) {
                this.upsertRemoteCodeThread(this.currentRemoteThreadId, this.getCurrentThreadTitle(), Date.now());
            }
        } catch (err) {
            console.warn('[RemoteCodeOnPC] Failed to restore Remote Code state:', err);
        }
    }

    private saveRemoteCodeState(immediate = false): void {
        if (!immediate) {
            if (this.remoteCodeStateSaveTimer) return;
            this.remoteCodeStateSaveTimer = setTimeout(() => {
                this.remoteCodeStateSaveTimer = undefined;
                this.persistRemoteCodeState();
            }, 350);
            return;
        }
        if (this.remoteCodeStateSaveTimer) {
            clearTimeout(this.remoteCodeStateSaveTimer);
            this.remoteCodeStateSaveTimer = undefined;
        }
        this.persistRemoteCodeState();
    }

    private persistRemoteCodeState(): void {
        void this._context.globalState.update('remote_code_history', this.codexHistory.slice(-200));
        void this._context.globalState.update('remote_code_actions', this.codexActionEvents.slice(-250));
        void this._context.globalState.update('remote_code_threads', this.remoteCodeThreads.slice(-80));
        void this._context.globalState.update('remote_code_current_thread_id', this.currentRemoteThreadId);
        void this._context.globalState.update('remote_code_selected_agent', this.selectedAgent);
        void this._context.globalState.update('remote_code_reasoning_effort', this.selectedReasoningEffort);
        void this._context.globalState.update('remote_code_include_context', this.selectedIncludeContext);
        void this._context.globalState.update('remote_code_work_mode', this.selectedWorkMode);
        void this._context.globalState.update('remote_code_profile', this.selectedProfile);
        void this._context.globalState.update('remote_code_hidden_codex_threads', Array.from(this.hiddenCodexThreadIds).slice(-250));
        void this._context.globalState.update('remote_code_hidden_messages', Array.from(this.hiddenRemoteMessageIds).slice(-500));
        void this._context.globalState.update('remote_code_pinned_threads', Array.from(this.pinnedThreadIds).slice(-250));
        void this._context.globalState.update('remote_code_archived_threads', Array.from(this.archivedThreadIds).slice(-250));
    }

    private upsertRemoteCodeThread(threadId: string, title?: string, timestamp?: number, workspaceOverride?: WorkspaceSummary): void {
        const id = threadId.trim();
        if (!id) return;
        this.archivedThreadIds.delete(id);
        const existing = this.remoteCodeThreads.find(thread => thread.id === id);
        const workspace = this.normalizeWorkspaceSummary(workspaceOverride);
        const fallbackWorkspace = this.getCurrentWorkspaceSummary();
        const cleanTitle = this.cleanThreadTitle(title);
        const existingTitle = this.cleanThreadTitle(existing?.title);
        const next: RemoteCodeThreadSummary = {
            id,
            title: cleanTitle || existingTitle || 'Новый чат',
            timestamp: Math.max(existing?.timestamp || 0, Math.round(timestamp || Date.now())),
            source: existing?.source || (id.startsWith('codex-file:') ? 'codex' : 'remote'),
            workspaceName: workspace?.workspaceName || existing?.workspaceName || fallbackWorkspace.workspaceName,
            workspacePath: workspace?.workspacePath || existing?.workspacePath || fallbackWorkspace.workspacePath
        };
        this.remoteCodeThreads = [
            next,
            ...this.remoteCodeThreads.filter(thread => thread.id !== id)
        ]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 80);
        this.remoteCodeThreadsCache = undefined;
    }

    private getCurrentWorkspaceSummary(): WorkspaceSummary {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return {};
        return {
            workspaceName: folder.name,
            workspacePath: folder.uri.fsPath
        };
    }

    private normalizeWorkspaceSummary(workspace?: WorkspaceSummary): WorkspaceSummary | undefined {
        const workspacePath = this.normalizeWorkspacePath(workspace?.workspacePath);
        const workspaceName = workspace?.workspaceName?.trim()
            || this.workspaceNameFromPath(workspacePath)
            || undefined;
        if (!workspaceName && !workspacePath) return undefined;
        return { workspaceName, workspacePath };
    }

    private workspaceNameFromPath(workspacePath?: string): string | undefined {
        const clean = workspacePath?.trim();
        if (!clean) return undefined;
        return path.basename(clean);
    }

    private normalizeWorkspacePath(workspacePath?: string): string | undefined {
        const clean = workspacePath?.trim();
        if (!clean) return undefined;
        try {
            return path.resolve(clean);
        } catch {
            return clean;
        }
    }

    private getWorkspaceProjectId(workspaceName?: string, workspacePath?: string): string {
        const normalizedPath = this.normalizeWorkspacePath(workspacePath);
        if (normalizedPath) return `path:${normalizedPath.toLowerCase()}`;
        const cleanName = workspaceName?.trim();
        return cleanName ? `name:${cleanName.toLowerCase()}` : 'unassigned';
    }

    private getWorkspaceProjectName(workspaceName?: string, workspacePath?: string): string {
        return workspaceName?.trim()
            || this.workspaceNameFromPath(workspacePath)
            || 'Без проекта';
    }

    private getRemoteCodeProjects(threads = this.getRemoteCodeThreads()): RemoteCodeProjectSummary[] {
        const byProject = new Map<string, RemoteCodeProjectSummary>();
        const seedProject = (name?: string, workspacePath?: string, active = false) => {
            const projectName = this.getWorkspaceProjectName(name, workspacePath);
            const normalizedPath = this.normalizeWorkspacePath(workspacePath);
            const id = this.getWorkspaceProjectId(projectName, normalizedPath);
            const existing = byProject.get(id);
            byProject.set(id, {
                id,
                name: existing?.name || projectName,
                path: existing?.path || normalizedPath,
                active: Boolean(existing?.active || active),
                threadCount: existing?.threadCount || 0,
                timestamp: existing?.timestamp || 0,
                threads: existing?.threads || []
            });
            return id;
        };

        for (const folder of vscode.workspace.workspaceFolders || []) {
            seedProject(folder.name, folder.uri.fsPath, true);
        }
        for (const project of this.getRecentProjects().slice(0, 8)) {
            seedProject(project.name, project.path, false);
        }

        for (const thread of threads) {
            const id = this.getWorkspaceProjectId(thread.workspaceName, thread.workspacePath);
            const threadWithProject = { ...thread, projectId: id };
            const project = byProject.get(id) || {
                id,
                name: this.getWorkspaceProjectName(thread.workspaceName, thread.workspacePath),
                path: this.normalizeWorkspacePath(thread.workspacePath),
                active: false,
                threadCount: 0,
                timestamp: 0,
                threads: []
            };
            project.threads = [...project.threads, threadWithProject].sort((a, b) => b.timestamp - a.timestamp);
            project.threadCount = project.threads.length;
            project.timestamp = Math.max(project.timestamp, thread.timestamp || 0);
            byProject.set(id, project);
        }

        return Array.from(byProject.values())
            .filter(project => project.active || project.threadCount > 0)
            .sort((a, b) => {
                const activeDelta = Number(b.active) - Number(a.active);
                return activeDelta || b.timestamp - a.timestamp || a.name.localeCompare(b.name);
            });
    }

    private getCurrentRemoteCodeProjectId(threads = this.getRemoteCodeThreads()): string {
        const current = threads.find(thread => thread.id === this.currentRemoteThreadId);
        if (current) return this.getWorkspaceProjectId(current.workspaceName, current.workspacePath);
        const workspace = this.getCurrentWorkspaceSummary();
        return this.getWorkspaceProjectId(workspace.workspaceName, workspace.workspacePath);
    }

    private getWorkspaceForThread(threadId: string): WorkspaceSummary {
        const thread = this.getRemoteCodeThreads().find(item => item.id === threadId);
        return this.normalizeWorkspaceSummary({
            workspaceName: thread?.workspaceName,
            workspacePath: thread?.workspacePath
        }) || this.getCurrentWorkspaceSummary();
    }

    private resolveRequestedRemoteCodeWorkspace(body: any): WorkspaceSummary | undefined {
        const requestedProjectId = typeof body?.projectId === 'string' ? body.projectId.trim() : '';
        const requestedPath = this.normalizeWorkspacePath(typeof body?.workspacePath === 'string' ? body.workspacePath : undefined);
        const requestedName = typeof body?.workspaceName === 'string' ? body.workspaceName.trim() : '';
        const projects = this.getRemoteCodeProjects();
        const project = requestedProjectId
            ? projects.find(item => item.id === requestedProjectId)
            : undefined;
        if (project) {
            return this.normalizeWorkspaceSummary({
                workspaceName: project.name || requestedName,
                workspacePath: project.path || requestedPath
            });
        }
        if (requestedPath) {
            const projectByPath = projects.find(item => {
                const projectPath = this.normalizeWorkspacePath(item.path);
                return projectPath?.toLowerCase() === requestedPath.toLowerCase();
            });
            if (projectByPath) {
                return this.normalizeWorkspaceSummary({
                    workspaceName: projectByPath.name || requestedName,
                    workspacePath: projectByPath.path || requestedPath
                });
            }
        }
        if (requestedName) {
            const projectByName = projects.find(item => item.name.toLowerCase() === requestedName.toLowerCase());
            if (projectByName) {
                return this.normalizeWorkspaceSummary({
                    workspaceName: projectByName.name,
                    workspacePath: projectByName.path || requestedPath
                });
            }
        }
        return undefined;
    }

    private getRemoteCodeThreadsWithProjectIds(threads = this.getRemoteCodeThreads()): RemoteCodeThreadSummary[] {
        return threads.map(thread => ({
            ...thread,
            projectId: this.getWorkspaceProjectId(thread.workspaceName, thread.workspacePath)
        }));
    }

    private getRemoteCodeThreadsUpdatePayload(currentThreadId = this.currentRemoteThreadId): Record<string, any> {
        const rawThreads = this.getRemoteCodeThreads();
        const threads = this.getRemoteCodeThreadsWithProjectIds(rawThreads);
        return {
            type: 'codex:threads-update',
            threads,
            projects: this.getRemoteCodeProjects(threads),
            currentThreadId,
            currentProjectId: this.getCurrentRemoteCodeProjectId(rawThreads),
            timestamp: Date.now()
        };
    }

    private isUntitledRemoteThread(title?: string): boolean {
        const normalized = (title || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return !normalized || normalized === 'новый чат' || normalized === 'new chat' || normalized === 'remote code';
    }

    private isCorruptedThreadTitle(title?: string): boolean {
        const normalized = (title || '').replace(/\s+/g, ' ').trim();
        if (!normalized) return false;
        if (normalized.includes('\uFFFD')) return true;
        const compact = normalized.replace(/\s+/g, '');
        const questionMarks = (compact.match(/\?/g) || []).length;
        return questionMarks >= 3 && questionMarks / Math.max(1, compact.length) > 0.25;
    }

    private cleanThreadTitle(title?: string): string {
        const normalized = (title || '').replace(/\s+/g, ' ').trim();
        if (!normalized || this.isCorruptedThreadTitle(normalized)) return '';
        return normalized.slice(0, 80);
    }

    private pickThreadTitle(...candidates: Array<string | undefined>): string {
        for (const candidate of candidates) {
            const clean = this.cleanThreadTitle(candidate);
            if (clean && !this.isUntitledRemoteThread(clean)) return clean;
        }
        for (const candidate of candidates) {
            const clean = this.cleanThreadTitle(candidate);
            if (clean) return clean;
        }
        return 'Новый чат';
    }

    private hasVisibleRemoteThreadContent(threadId: string): boolean {
        if (!threadId) return false;
        return this.codexHistory.some(message =>
            (message.threadId || this.currentRemoteThreadId) === threadId &&
            message.role !== 'system' &&
            !!message.content.trim()
        ) || this.codexActionEvents.some(event => event.threadId === threadId);
    }

    private pruneEmptyRemoteCodeThreads(keepLiveDrafts = true): void {
        const before = this.remoteCodeThreads.length;
        this.remoteCodeThreads = this.remoteCodeThreads.filter(thread => {
            if (!thread?.id) return false;
            if (thread.id.startsWith('codex-file:')) return true;
            if (keepLiveDrafts && this.liveDraftThreadIds.has(thread.id)) return true;
            if (!this.isUntitledRemoteThread(thread.title)) return true;
            return this.hasVisibleRemoteThreadContent(thread.id);
        });
        if (this.remoteCodeThreads.length !== before) {
            this.remoteCodeThreadsCache = undefined;
        }
    }

    private toCodexThreadId(codexId: string): string {
        return `codex-file:${codexId}`;
    }

    private fromCodexThreadId(threadId: string): string | undefined {
        return threadId.startsWith('codex-file:') ? threadId.slice('codex-file:'.length) : undefined;
    }

    private isHiddenThread(threadId: string): boolean {
        return this.archivedThreadIds.has(threadId) ||
            (threadId.startsWith('codex-file:') && this.hiddenCodexThreadIds.has(threadId));
    }

    private getRemoteCodeThreads(): RemoteCodeThreadSummary[] {
        if (this.remoteCodeThreadsCache && Date.now() - this.remoteCodeThreadsCache.timestamp < 5000) {
            return this.remoteCodeThreadsCache.threads;
        }
        const byThread = new Map<string, RemoteCodeThreadSummary>();
        for (const thread of this.remoteCodeThreads) {
            if (!thread?.id) continue;
            if (this.isHiddenThread(thread.id)) continue;
            if (this.isUntitledRemoteThread(thread.title) && !this.liveDraftThreadIds.has(thread.id) && !this.hasVisibleRemoteThreadContent(thread.id)) continue;
            byThread.set(thread.id, {
                id: thread.id,
                title: this.cleanThreadTitle(thread.title) || 'Новый чат',
                timestamp: Math.round(thread.timestamp || 0),
                source: thread.source || (thread.id.startsWith('codex-file:') ? 'codex' : 'remote'),
                workspaceName: thread.workspaceName,
                workspacePath: thread.workspacePath
            });
        }
        for (const thread of this.getCodexThreadSummariesFast()) {
            const id = this.toCodexThreadId(thread.id);
            if (this.isHiddenThread(id)) continue;
            const existing = byThread.get(id);
            byThread.set(id, {
                id,
                title: this.pickThreadTitle(existing?.title, thread.title, 'Codex'),
                timestamp: Math.max(existing?.timestamp || 0, Math.round(thread.timestamp || 0)),
                source: 'codex',
                workspaceName: existing?.workspaceName || thread.workspaceName,
                workspacePath: existing?.workspacePath || thread.workspacePath
            });
        }
        for (const message of this.codexHistory.filter(item => item.role !== 'system')) {
            const id = message.threadId || this.currentRemoteThreadId || 'remote-code-default';
            if (this.isHiddenThread(id)) continue;
            const existing = byThread.get(id);
            const titleSource = message.role === 'user' && message.content.trim()
                ? message.content
                : existing?.title || 'Remote Code';
            const title = this.pickThreadTitle(titleSource, existing?.title, 'Remote Code');
            const timestamp = Math.max(existing?.timestamp || 0, Math.round(message.timestamp || 0));
            byThread.set(id, {
                id,
                title,
                timestamp,
                source: existing?.source || (id.startsWith('codex-file:') ? 'codex' : 'remote'),
                workspaceName: existing?.workspaceName || message.workspaceName,
                workspacePath: existing?.workspacePath || message.workspacePath
            });
        }
        if (this.currentRemoteThreadId && !this.isHiddenThread(this.currentRemoteThreadId) && !byThread.has(this.currentRemoteThreadId)) {
            byThread.set(this.currentRemoteThreadId, {
                id: this.currentRemoteThreadId,
                title: 'Новый чат',
                timestamp: Date.now(),
                source: this.currentRemoteThreadId.startsWith('codex-file:') ? 'codex' : 'remote',
                ...this.getCurrentWorkspaceSummary()
            });
        }
        const threads = Array.from(byThread.values())
            .filter(thread => !this.isHiddenThread(thread.id))
            .sort((a, b) => {
                const pinnedDelta = Number(this.pinnedThreadIds.has(b.id)) - Number(this.pinnedThreadIds.has(a.id));
                return pinnedDelta || b.timestamp - a.timestamp;
            });
        this.remoteCodeThreadsCache = { timestamp: Date.now(), threads };
        return threads;
    }

    private getMessagesForRemoteThread(threadId: string, limit = 120): CodexChatMessage[] {
        const fileId = this.fromCodexThreadId(threadId);
        let fileMessages: CodexChatMessage[] = [];
        if (fileId) {
            const filePath = this.findCodexSessionFile(fileId);
            const parsed = filePath ? this.parseCodexSessionFileTail(filePath, this.getCodexSessionIndex(), limit) : undefined;
            fileMessages = parsed?.messages.map(message => ({ ...message, threadId })) || [];
        }
        const localMessages = this.codexHistory.filter(message =>
            (message.threadId || this.currentRemoteThreadId) === threadId
        );
        const merged: CodexChatMessage[] = [];
        const seen = new Set<string>();
        for (const message of [...fileMessages, ...localMessages].sort((a, b) => a.timestamp - b.timestamp)) {
            if (this.isRemoteMessageHidden(message)) continue;
            const key = `${message.role}:${message.timestamp}:${message.content}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(message);
        }
        return this.dedupeAdjacentCodexMessages(merged)
            .slice(-limit)
            .map(message => this.enrichCodexMessageForClient(message));
    }

    private isRemoteMessageHidden(message: CodexChatMessage): boolean {
        const id = (message.id || '').trim();
        if (id && this.hiddenRemoteMessageIds.has(id)) return true;
        return this.hiddenRemoteMessageIds.has(this.remoteMessageStableKey(message));
    }

    private remoteMessageStableKey(message: CodexChatMessage): string {
        return [
            message.threadId || '',
            message.role || '',
            Math.round(Number(message.timestamp || 0)),
            (message.content || '').replace(/\s+/g, ' ').trim()
        ].join('\u0000');
    }

    private findRemoteMessage(threadId: string, messageId: string): CodexChatMessage | undefined {
        return this.getMessagesForRemoteThread(threadId, 200)
            .find(message => message.id === messageId);
    }

    private deleteRemoteMessage(threadId: string, messageId: string): { success: boolean; message?: CodexChatMessage } {
        const message = this.findRemoteMessage(threadId, messageId);
        if (!message) return { success: false };
        const hiddenId = (message.id || '').trim();
        const hiddenStableKey = this.remoteMessageStableKey(message);
        if (hiddenId) this.hiddenRemoteMessageIds.add(hiddenId);
        this.hiddenRemoteMessageIds.add(hiddenStableKey);
        this.codexHistory = this.codexHistory.filter(item =>
            !(hiddenId && item.id === hiddenId) && this.remoteMessageStableKey(item) !== hiddenStableKey
        );
        this.saveRemoteCodeState(true);
        this.refreshPcChatPanel(true);
        this.broadcast({
            type: 'codex:message-deleted',
            threadId,
            messageId,
            messages: this.getMessagesForRemoteThread(threadId, 120),
            timestamp: Date.now()
        });
        return { success: true, message };
    }

    private async regenerateRemoteMessage(threadId: string, messageId: string): Promise<{ success: boolean; error?: string; source?: CodexChatMessage }> {
        const messages = this.getMessagesForRemoteThread(threadId, 200);
        const index = messages.findIndex(message => message.id === messageId);
        if (index < 0) return { success: false, error: 'Message not found' };
        const source = messages[index].role === 'user'
            ? messages[index]
            : messages.slice(0, index).reverse().find(message => message.role === 'user');
        if (!source || !source.content.trim()) {
            return { success: false, error: 'No user prompt found to regenerate from' };
        }
        await this.enqueueRemoteCodeMessage(
            source.content,
            source.model || this.selectedAgent,
            threadId,
            [],
            source.reasoningEffort || this.selectedReasoningEffort,
            source.includeContext !== false,
            source.attachments || []
        );
        return { success: true, source };
    }

    private dedupeAdjacentCodexMessages(messages: CodexChatMessage[]): CodexChatMessage[] {
        const result: CodexChatMessage[] = [];
        for (const message of messages) {
            const normalized = this.normalizeCodexMessageForDedupe(message);
            const previous = result[result.length - 1];
            if (previous && this.normalizeCodexMessageForDedupe(previous) === normalized) {
                continue;
            }
            result.push(message);
        }
        return result;
    }

    private normalizeCodexMessageForDedupe(message: CodexChatMessage): string {
        return [
            message.role,
            (message.content || '').replace(/\s+/g, ' ').trim()
        ].join('\u0000');
    }

    private createRemoteCodeThread(workspaceOverride?: WorkspaceSummary): string {
        const workspace = workspaceOverride
            || (this.currentRemoteThreadId ? this.getWorkspaceForThread(this.currentRemoteThreadId) : this.getCurrentWorkspaceSummary());
        const threadId = `remote-code-${Date.now()}`;
        this.currentRemoteThreadId = threadId;
        this.liveDraftThreadIds.add(threadId);
        this.upsertRemoteCodeThread(threadId, 'Новый чат', Date.now(), workspace);
        this.codexActionEvents = this.codexActionEvents.filter(event => event.threadId !== threadId);
        this.saveRemoteCodeState();
        this.refreshPcChatPanel();
        this.broadcast(this.getRemoteCodeThreadsUpdatePayload(threadId));
        return threadId;
    }

    private getWorkspaceContextForPrompt(): string {
        const folders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath).join('\n') || 'No workspace folder is open.';
        const active = vscode.window.activeTextEditor;
        const activeFile = active ? `${active.document.uri.fsPath} (${active.document.languageId})` : 'No active editor.';
        const fileHints = this.getWorkspaceFileHints(120);
        return [
            'You are Remote Code running inside VS Code through the selected VS Code language model.',
            'Do not introduce yourself as a separate agent; if a label is needed, use Remote Code or the selected model name.',
            'Help with code, files, diagnostics, terminal commands, and IDE context.',
            'When an action needs user approval, do not claim it was done.',
            'Use only real project files. Do not invent source paths.',
            'Before requesting ::read-file, prefer paths from Project file hints below or paths explicitly provided by the user/history.',
            'If a file is not listed and you are unsure, request a directory listing with ::run-command{"command":"dir","cwd":"absolute folder"} or ask for the exact path.',
            'Important: this project currently renders the Remote Code VS Code chat webview in extension/src/server.ts. There is no extension/src/webview/chat/ChatView.tsx unless Project file hints list it.',
            'Request terminal approval with a single line: ::run-command{"command":"...","cwd":"optional path"}',
            'Read a project file with a single line: ::read-file{"path":"absolute path"}',
            'Request current VS Code diagnostics with a single line: ::show-diagnostics{}',
            'Request file replacement approval with a single line: ::write-file{"path":"absolute path","contentBase64":"base64 utf8 content"}',
            'Request unified patch approval with a single line: ::apply-patch{"path":"absolute path","patchBase64":"base64 utf8 unified diff"}',
            'The extension will show approve/deny controls on PC and phone, run the action only after approval, and stream the result back into this chat.',
            'Workspace folders:',
            folders,
            'Active editor:',
            activeFile,
            'Project file hints:',
            fileHints
        ].join('\n');
    }

    private getWorkspaceFileHints(limit = 100): string {
        const roots = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath).filter(folder => fs.existsSync(folder)) || [];
        if (roots.length === 0) return 'No workspace files are available.';
        const cached = this.workspaceFileHintsCache;
        if (cached && cached.limit >= limit && Date.now() - cached.timestamp < 30_000) {
            return cached.hints.split('\n').slice(0, limit).join('\n') || 'No source-like project files found.';
        }

        const seen = new Set<string>();
        const files: string[] = [];
        const addFile = (absolutePath: string): void => {
            if (!fs.existsSync(absolutePath)) return;
            try {
                const stat = fs.statSync(absolutePath);
                if (!stat.isFile()) return;
            } catch {
                return;
            }
            const rel = this.toWorkspaceDisplayPath(absolutePath);
            if (seen.has(rel)) return;
            seen.add(rel);
            files.push(rel);
        };

        const importantFiles = [
            'extension/src/server.ts',
            'extension/src/extension.ts',
            'extension/package.json',
            'README.md',
            'android/app/build.gradle.kts',
            'android/app/src/main/java/com/remotecodeonpc/app/RemoteCodeApp.kt',
            'android/app/src/main/java/com/remotecodeonpc/app/MainActivity.kt',
            'android/app/src/main/java/com/remotecodeonpc/app/Models.kt',
            'android/app/src/main/java/com/remotecodeonpc/app/viewmodel/MainViewModel.kt',
            'android/app/src/main/java/com/remotecodeonpc/app/network/ApiClient.kt',
            'android/app/src/main/java/com/remotecodeonpc/app/network/WebSocketClient.kt',
            'android/app/src/main/java/com/remotecodeonpc/app/ui/navigation/Screen.kt',
            'android/app/src/main/java/com/remotecodeonpc/app/ui/screens/CodexScreen.kt',
            'android/app/src/main/java/com/remotecodeonpc/app/ui/screens/FilesScreen.kt',
            'android/app/src/main/java/com/remotecodeonpc/app/ui/screens/DiagnosticsScreen.kt',
            'android/app/src/main/java/com/remotecodeonpc/app/ui/screens/TerminalScreen.kt'
        ];

        for (const root of roots) {
            for (const rel of importantFiles) {
                addFile(path.join(root, rel));
            }
        }

        const walk = (dir: string, depth: number): void => {
            if (files.length >= limit || depth > 6) return;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            entries.sort((a, b) => {
                if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            for (const entry of entries) {
                if (files.length >= limit) return;
                if (this.shouldSkipWorkspaceEntry(entry.name)) continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath, depth + 1);
                } else if (entry.isFile() && this.isWorkspaceHintFile(entry.name)) {
                    addFile(fullPath);
                }
            }
        };

        for (const root of roots) {
            walk(root, 0);
            if (files.length >= limit) break;
        }

        const result = files.slice(0, limit).join('\n') || 'No source-like project files found.';
        this.workspaceFileHintsCache = { timestamp: Date.now(), limit, hints: result };
        return result;
    }

    private shouldSkipWorkspaceEntry(name: string): boolean {
        return new Set([
            '.git',
            '.gradle',
            '.idea',
            '.remote-code-uploads',
            '.vscode-test',
            'apk',
            'build',
            'coverage',
            'dist',
            'node_modules',
            'out'
        ]).has(name);
    }

    private isWorkspaceHintFile(name: string): boolean {
        return /\.(ts|tsx|js|json|kt|kts|md|xml|yml|yaml|toml|properties|gradle)$/i.test(name);
    }

    private toWorkspaceDisplayPath(filePath: string): string {
        const roots = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || [];
        const normalized = path.resolve(filePath);
        for (const root of roots) {
            const rel = path.relative(root, normalized);
            if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
                return rel.replace(/[\\/]+/g, '/');
            }
        }
        return normalized;
    }

    private getWorkspaceRoots(): string[] {
        return (vscode.workspace.workspaceFolders || [])
            .map(folder => path.resolve(folder.uri.fsPath))
            .filter(root => {
                try {
                    return fs.existsSync(root) && fs.statSync(root).isDirectory();
                } catch {
                    return false;
                }
            });
    }

    private isInsideWorkspaceRoot(candidate: string, root: string): boolean {
        const relative = path.relative(path.resolve(root), path.resolve(candidate));
        return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    }

    private resolveWorkspaceApiPath(rawPath: string | undefined, defaultToFirstRoot: boolean): string | undefined {
        const roots = this.getWorkspaceRoots();
        if (roots.length === 0) return undefined;
        const trimmed = (rawPath || '').trim();
        if (!trimmed && defaultToFirstRoot) return roots[0];
        if (!trimmed) return undefined;

        const candidates = path.isAbsolute(trimmed)
            ? [path.resolve(trimmed)]
            : roots.map(root => path.resolve(root, trimmed));
        for (const candidate of candidates) {
            if (!roots.some(root => this.isInsideWorkspaceRoot(candidate, root))) continue;
            try {
                if (fs.existsSync(candidate)) return candidate;
            } catch {
                // Continue with other candidates.
            }
        }
        return undefined;
    }

    private looksBinary(buffer: Buffer): boolean {
        const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
        if (sample.includes(0)) return true;
        let suspicious = 0;
        for (const byte of sample) {
            if (byte < 7 || (byte > 14 && byte < 32)) suspicious++;
        }
        return sample.length > 0 && suspicious / sample.length > 0.08;
    }

    private async sendToChat(message: string, agentName: string): Promise<string> {
        return this.sendToChatStreaming(message, agentName);
    }

    private async sendToChatStreaming(
        message: string,
        agentName: string,
        onChunk?: (content: string) => void,
        includeContext: boolean = true,
        cancellationToken?: vscode.CancellationToken,
        attachments: LocalAttachment[] = [],
        history: CodexChatMessage[] = []
    ): Promise<string> {
        // Используем VS Code LanguageModel API для отправки в Copilot Chat
        try {
            let models = await this.getCachedLanguageModels();

            if (!models || models.length === 0) {
                throw new Error('Нет доступных моделей чата. Проверьте подключение Copilot.');
            }

            const allowedAgents = models
                .map((m: any) => ({
                    name: m.id || m.name || '',
                    displayName: m.name || m.id || '',
                    vendor: m.vendor || '',
                    model: m.family || m.id || m.name || ''
                }))
                .filter(agent => this.isRemoteCodeModel(agent));
            const allowedNames = new Set(allowedAgents.map(agent => agent.name));
            const aliases: Record<string, string[]> = {
                'gpt-5.5': ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2'],
                'gpt-5.4': ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2-codex'],
                'gpt-5.4-mini': ['gpt-5.4-mini', 'gpt-5-mini', 'gpt-4o-mini'],
                'gpt-5.3-codex': ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.4'],
                'gpt-5.3-codex-spark': ['gpt-5.3-codex-spark', 'gpt-5.3-codex', 'gpt-5.2-codex'],
                'gpt-5.2': ['gpt-5.2', 'gpt-5.2-codex', 'gpt-5.4']
            };

            // Ищем модель, соответствующую выбранному агенту
            let model = models.find((m: any) => allowedNames.has(m.id || m.name || '')) || models[0];
            if (agentName && agentName !== 'auto') {
                const desired = aliases[agentName] || [agentName];
                const found = models.find(m => {
                    const mId = (m as any).id || (m as any).name || '';
                    const mVendor = (m as any).vendor || '';
                    return allowedNames.has(mId) && desired.some(name => mId === name || mId.includes(name) || mVendor.includes(name));
                });
                if (found) model = found;
            }

            const prompt = includeContext
                ? `${this.getWorkspaceContextForPrompt()}\n\nUser request:\n${message}`
                : message;
            const messages = [
                ...this.buildLanguageModelHistory(history),
                new vscode.LanguageModelChatMessage(
                    vscode.LanguageModelChatMessageRole.User,
                    this.createLanguageModelContent(prompt, attachments)
                )
            ];

            // Отправляем запрос и собираем стриминг-ответ
            const response = await this.withTimeout(
                model.sendRequest(messages, {}, cancellationToken),
                45000,
                'Модель не начала отвечать за 45 секунд. Проверьте авторизацию VS Code/Copilot и попробуйте ещё раз.',
                cancellationToken
            );

            let result = '';
            const iterator = response.text[Symbol.asyncIterator]();
            while (true) {
                if (cancellationToken?.isCancellationRequested) {
                    throw new Error('cancelled');
                }
                const next = await this.withTimeout(
                    iterator.next(),
                    result ? 60000 : 45000,
                    result
                        ? 'Модель перестала присылать ответ больше чем на 60 секунд.'
                        : 'Модель не прислала первый фрагмент ответа за 45 секунд.',
                    cancellationToken
                );
                if (next.done) break;
                const chunk = next.value || '';
                result += chunk;
                onChunk?.(result);
            }
            return result || '(пустой ответ)';
        } catch (err: any) {
            const errorMessage = err?.message || String(err);
            if (cancellationToken?.isCancellationRequested || errorMessage === 'cancelled') {
                throw new Error('cancelled');
            }
            if (this.isLanguageModelRateLimitError(err)) {
                this.lmModelsBlockedUntil = Date.now() + 2 * 60 * 1000;
            }
            console.warn('[RemoteCodeOnPC] VS Code LM request failed:', errorMessage);
            throw new Error(`VS Code language model request failed: ${this.isLanguageModelRateLimitError(err) ? this.getLanguageModelBlockedMessage() : errorMessage}`);
        }
    }

    private buildLanguageModelHistory(history: CodexChatMessage[]): vscode.LanguageModelChatMessage[] {
        return history
            .filter(message =>
                (message.role === 'user' || message.role === 'assistant') &&
                !message.isStreaming &&
                typeof message.content === 'string' &&
                message.content.trim().length > 0
            )
            .slice(-12)
            .map(message => new vscode.LanguageModelChatMessage(
                message.role === 'assistant'
                    ? vscode.LanguageModelChatMessageRole.Assistant
                    : vscode.LanguageModelChatMessageRole.User,
                this.trimLanguageModelHistoryContent(this.stripActionDirectives(message.content))
            ));
    }

    private trimLanguageModelHistoryContent(content: string): string {
        const clean = content.replace(/\n{4,}/g, '\n\n\n').trim();
        if (clean.length <= 12000) return clean;
        return `${clean.slice(0, 6000)}\n\n...[history truncated]...\n\n${clean.slice(-6000)}`;
    }

    private normalizeReasoningEffort(value?: string): string {
        const allowed = new Set(['low', 'medium', 'high', 'xhigh']);
        return value && allowed.has(value) ? value : 'medium';
    }

    private reasoningEffortLabel(value?: string): string {
        switch (this.normalizeReasoningEffort(value)) {
            case 'low': return 'Низкий';
            case 'high': return 'Высокий';
            case 'xhigh': return 'Очень высокий';
            default: return 'Средний';
        }
    }

    private profileInstruction(value?: string): string {
        switch (value) {
            case 'fast':
                return [
                    'Profile: fast.',
                    'You may request safe read-only terminal checks such as dir, ls, pwd, git status, git diff, git log, and diagnostics.',
                    'Terminal commands are still routed through explicit user approval.',
                    'For file writes, patches, installs, deletes, moves, network changes, or long-running commands, request approval and explain why.'
                ].join(' ');
            case 'review':
                return [
                    'Profile: review/read-only.',
                    'Prioritize concrete bugs, risks, regressions, and missing tests.',
                    'Prefer diagnostics, reading files, and git diff/status.',
                    'Do not request file writes or destructive terminal commands unless the user explicitly asks.'
                ].join(' ');
            default:
                return [
                    'Profile: custom/user.',
                    'Follow the user request and use the available VS Code context when relevant.',
                    'Request approval for terminal commands, file writes, and patches before they run.'
                ].join(' ');
        }
    }

    private async answerInPcMirror(
        message: string,
        threadId: string,
        model?: string,
        reasoningEffort?: string,
        includeContext: boolean = true,
        attachments: LocalAttachment[] = [],
        priorHistory?: CodexChatMessage[]
    ): Promise<void> {
        const effort = this.normalizeReasoningEffort(reasoningEffort || this.selectedReasoningEffort);
        this.stopActiveGeneration(false);
        const cancellation = new vscode.CancellationTokenSource();
        this.activeChatCancellation = cancellation;
        this.activeChatThreadId = threadId;
        const thinking: CodexChatMessage = {
            id: `codex_assistant_thinking_${Date.now()}`,
            role: 'assistant',
            content: '...',
            timestamp: Date.now(),
            model: typeof model === 'string' && model ? model : undefined,
            reasoningEffort: effort,
            includeContext,
            isStreaming: true,
            threadId
        };
        this.codexHistory.push(thinking);
        this.codexHistory = this.codexHistory.slice(-200);
        this.saveRemoteCodeState();
        this.refreshPcChatPanel();
        this.broadcast({ type: 'codex:message', message: thinking, threadId, timestamp: Date.now() });

        const progressBase = `progress_${thinking.id}`;
        const contextProgressId = `${progressBase}_context`;
        const modelProgressId = `${progressBase}_model`;
        const streamProgressId = `${progressBase}_stream`;
        this.upsertProgressEvent(
            threadId,
            contextProgressId,
            'Сбор контекста IDE',
            includeContext ? 'Рабочие папки, активный редактор, история чата и вложения.' : 'Контекст отключен для этого запроса.',
            'completed'
        );
        this.upsertProgressEvent(
            threadId,
            modelProgressId,
            'Ожидание модели',
            `${model || this.selectedAgent || 'auto'} · ${effort}`,
            'running'
        );
        let streamStarted = false;

        try {
            const historyForModel = priorHistory ?? this.getMessagesForRemoteThread(threadId, 24)
                    .filter(item => item.id !== thinking.id && item.role !== 'system');
            const response = await this.sendToChatStreaming(
                `${message}\n\nReasoning effort: ${this.reasoningEffortLabel(effort)} (${effort}).\n${this.profileInstruction(this.selectedProfile)}`,
                model || this.selectedAgent || 'auto',
                (content) => {
                if (!streamStarted) {
                    streamStarted = true;
                    this.upsertProgressEvent(
                        threadId,
                        modelProgressId,
                        'Модель ответила',
                        `${model || this.selectedAgent || 'auto'} · ${effort}`,
                        'completed'
                    );
                    this.upsertProgressEvent(
                        threadId,
                        streamProgressId,
                        'Поток ответа',
                        'Получаем видимый текст ответа.',
                        'running'
                    );
                }
                thinking.content = this.stripActionDirectives(content || '...');
                thinking.timestamp = Date.now();
                this.codexHistory = this.codexHistory.map(m => m.id === thinking.id ? { ...thinking } : m);
                this.saveRemoteCodeState();
                this.refreshPcChatPanel();
                this.broadcast({
                    type: 'codex:chunk',
                    messageId: thinking.id,
                    content: thinking.content,
                    threadId,
                    timestamp: thinking.timestamp
                });
            },
                includeContext,
                cancellation.token,
                attachments,
                historyForModel
            );
            const cleanResponse = this.stripActionDirectives(response);
            const changeSummary = this.getGitChangeSummaryFromMessage(cleanResponse);
            const done: CodexChatMessage = {
                ...thinking,
                id: `codex_assistant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                content: cleanResponse,
                timestamp: Date.now(),
                isStreaming: false,
                changeSummary
            };
            this.codexHistory = this.codexHistory.filter(m => m.id !== thinking.id).concat(done).slice(-200);
            this.createActionsFromAssistantResponse(response, threadId);
            this.upsertProgressEvent(
                threadId,
                streamStarted ? streamProgressId : modelProgressId,
                streamStarted ? 'Ответ готов' : 'Модель ответила',
                'Финальное сообщение доступно.',
                'completed'
            );
            this.saveRemoteCodeState();
            this.refreshPcChatPanel();
            this.broadcast({ type: 'codex:message', message: done, threadId, timestamp: Date.now() });
        } catch (err: any) {
            if (cancellation.token.isCancellationRequested || err?.message === 'cancelled') {
                const stopped: CodexChatMessage = {
                    ...thinking,
                    id: `codex_assistant_stopped_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    content: thinking.content && thinking.content !== '...'
                        ? `${thinking.content}\n\nОстановлено.`
                        : 'Остановлено.',
                    timestamp: Date.now(),
                    isStreaming: false
                };
                this.codexHistory = this.codexHistory.filter(m => m.id !== thinking.id).concat(stopped).slice(-200);
                this.upsertProgressEvent(
                    threadId,
                    streamStarted ? streamProgressId : modelProgressId,
                    'Остановлено',
                    'Активная генерация остановлена.',
                    'denied'
                );
                this.saveRemoteCodeState();
                this.refreshPcChatPanel(true);
                this.broadcast({ type: 'codex:message', message: stopped, threadId, timestamp: Date.now() });
                return;
            }
            this.upsertProgressEvent(
                threadId,
                streamStarted ? streamProgressId : modelProgressId,
                'Ошибка запроса к модели',
                err?.message || String(err),
                'failed'
            );
            const errorText = err?.message || String(err);
            const failed: CodexChatMessage = {
                ...thinking,
                id: `codex_assistant_failed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                content: `Не удалось получить ответ модели.\n\n${errorText}\n\nПопробуйте отправить сообщение ещё раз или выберите другую модель.`,
                timestamp: Date.now(),
                isStreaming: false
            };
            this.codexHistory = this.codexHistory.filter(m => m.id !== thinking.id).concat(failed).slice(-200);
            this.saveRemoteCodeState();
            this.refreshPcChatPanel(true);
            this.broadcast({ type: 'codex:message', message: failed, threadId, timestamp: Date.now() });
            return;
        } finally {
            if (this.activeChatCancellation === cancellation) {
                this.activeChatCancellation = undefined;
                this.activeChatThreadId = undefined;
            }
            cancellation.dispose();
            this.refreshPcChatPanel(true);
        }
    }

    private finalizeStaleStreamingMessages(maxAgeMs = 2 * 60 * 1000, notify = true): boolean {
        const now = Date.now();
        const activeThreadId = this.activeChatThreadId || '';
        const hasActiveGeneration = !!this.activeChatCancellation
            && !this.activeChatCancellation.token.isCancellationRequested
            && !!activeThreadId;
        const staleIds = new Set<string>();
        const staleThreadIds = new Set<string>();

        for (const message of this.codexHistory) {
            if (!message.isStreaming) continue;
            const threadId = message.threadId || this.currentRemoteThreadId || '';
            if (hasActiveGeneration && threadId === activeThreadId) continue;
            const timestamp = Number.isFinite(message.timestamp) ? message.timestamp : now;
            if (now - timestamp < maxAgeMs) continue;
            staleIds.add(message.id);
            if (threadId) staleThreadIds.add(threadId);
        }

        if (staleIds.size === 0) return false;

        let replacementIndex = 0;
        this.codexHistory = this.codexHistory.map(message => {
            if (!staleIds.has(message.id)) return message;
            const prefix = message.content && message.content.trim() && message.content.trim() !== '...'
                ? `${message.content.trim()}\n\n`
                : '';
            return {
                ...message,
                id: `codex_assistant_timeout_${now}_${replacementIndex++}`,
                content: `${prefix}Запрос к модели не завершился и был остановлен по таймауту. Отправьте сообщение ещё раз.`,
                timestamp: now,
                isStreaming: false
            };
        });

        this.codexActionEvents = this.codexActionEvents.map(event => {
            const belongsToStaleMessage = Array.from(staleIds).some(id => event.id.includes(id));
            if (!belongsToStaleMessage || !['pending', 'approved', 'running'].includes(event.status)) {
                return event;
            }
            return {
                ...event,
                title: 'Запрос к модели не завершился',
                detail: 'Таймаут ожидания ответа модели.',
                status: 'failed' as const,
                timestamp: now
            };
        });

        this.saveRemoteCodeState(true);
        if (notify) {
            this.refreshPcChatPanel(true);
        }
        for (const threadId of staleThreadIds) {
            this.broadcast({
                type: 'codex:message-refresh',
                threadId,
                messages: this.getMessagesForRemoteThread(threadId, 120).filter(m => m.role !== 'system'),
                events: this.getActionEventsForThread(threadId),
                timestamp: Date.now()
            });
        }
        return true;
    }

    private async enqueueRemoteCodeMessage(
        message: string,
        model: string,
        threadId: string,
        attachments: MobileAttachment[],
        reasoningEffort?: string,
        includeContext?: boolean,
        localAttachments: LocalAttachment[] = []
    ): Promise<string> {
        if (this.activeChatCancellation && !this.activeChatCancellation.token.isCancellationRequested) {
            throw new Error('Remote Code уже выполняет запрос. Дождитесь ответа или нажмите Stop перед новой отправкой.');
        }
        let targetThreadId = threadId.trim() || this.currentRemoteThreadId;
        if (!targetThreadId) {
            targetThreadId = this.createRemoteCodeThread();
        }
        this.currentRemoteThreadId = targetThreadId;
        const workspace = this.getWorkspaceForThread(targetThreadId);
        const effort = this.normalizeReasoningEffort(reasoningEffort || this.selectedReasoningEffort);
        this.selectedReasoningEffort = effort;
        this.selectedIncludeContext = includeContext !== false;
        if (model) this.selectedAgent = model;
        const attachmentFiles = [
            ...this.saveMobileAttachments(attachments),
            ...this.normalizeLocalAttachments(localAttachments)
        ];
        const priorHistory = this.getMessagesForRemoteThread(targetThreadId, 24)
            .filter(item => item.role !== 'system' && !item.isStreaming);
        const displayMessage = message.trim() || (attachmentFiles.length ? 'Проверь вложения.' : message);
        const messageForAgent = this.withAttachmentInstructions(displayMessage, attachmentFiles);
        const userMessage: CodexChatMessage = {
            id: `remote_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            role: 'user',
            content: displayMessage,
            timestamp: Date.now(),
            model: model || undefined,
            reasoningEffort: effort,
            includeContext: this.selectedIncludeContext,
            threadId: targetThreadId,
            attachments: attachmentFiles,
            workspaceName: workspace.workspaceName,
            workspacePath: workspace.workspacePath
        };
        this.codexHistory.push(userMessage);
        this.codexHistory = this.codexHistory.slice(-200);
        this.saveRemoteCodeState();
        this.openPcChatPanel();
        this.refreshPcChatPanel();
        this.broadcast({ type: 'codex:message', message: userMessage, threadId: targetThreadId, timestamp: Date.now() });
        this.broadcast({ type: 'codex:sent', message: messageForAgent, model, reasoningEffort: effort, includeContext: this.selectedIncludeContext, threadId: targetThreadId, timestamp: Date.now() });
        this.broadcast(this.getRemoteCodeThreadsUpdatePayload());

        this.answerInPcMirror(messageForAgent, targetThreadId, model, effort, this.selectedIncludeContext, attachmentFiles, priorHistory).catch(err => {
            const errorMessage: CodexChatMessage = {
                id: `remote_assistant_error_${Date.now()}`,
                role: 'assistant',
                content: `Remote Code error: ${err?.message || String(err)}`,
                timestamp: Date.now(),
                threadId: targetThreadId
            };
            this.codexHistory.push(errorMessage);
            this.codexHistory = this.codexHistory.slice(-200);
            this.saveRemoteCodeState();
            this.refreshPcChatPanel();
            this.broadcast({ type: 'codex:message', message: errorMessage, threadId: targetThreadId, timestamp: Date.now() });
        });
        return targetThreadId;
    }

    public openRemoteCodeChat(): void {
        this.openPcChatPanel();
    }

    public async showConnectionSettings(): Promise<void> {
        const localUrl = `http://${this._localIp || '127.0.0.1'}:${this._port}`;
        const publicUrl = this.getPublicUrl() || '';
        const tokenState = this._authToken ? 'токен включен' : 'токен не задан';
        const providerLabel = this.getProviderLabel(this.getPublicProvider());
        const keeneticHost = this.getConfiguredKeeneticHost();
        const tokenLabel = this._authToken ? 'Токен доступа' : 'Создать токен доступа';
        const tokenDetail = this._authToken
            ? 'Откроет меню: скопировать текущий токен или создать новый. При создании нового старый перестанет работать.'
            : 'Создаст токен для внешней сети и скопирует его в буфер обмена.';
        const items: Array<vscode.QuickPickItem & { action: string }> = [
            { label: tokenLabel, description: tokenState, detail: tokenDetail, action: 'tokenMenu' },
            { label: 'QR для телефона', description: publicUrl || localUrl, detail: 'Открывает QR для Android-приложения и копирует тот же код подключения.', action: 'showPairingQr' },
            { label: 'Код для телефона', description: publicUrl || localUrl, detail: 'Копирует URL и токен как одну строку remote-code-pair.', action: 'copyPairingPayload' },
            { label: 'Скопировать локальный URL', description: localUrl, action: 'copyLocal' },
            { label: 'Сформировать Keenetic URL', description: publicUrl || keeneticHost || 'my.keenetic.net / name.keenetic.link', detail: publicUrl ? `Сохранено: ${publicUrl}` : 'Соберет адрес из KeenDNS-имени или попробует найти его через my.keenetic.net', action: 'autoPublic' },
            { label: 'Открыть порт на роутере (UPnP)', description: `TCP ${this._port} -> ${this._localIp || 'IP ПК'}:${this._port}`, detail: 'Попросит Keenetic/роутер автоматически создать проброс порта. Для внешней сети токен должен быть включен.', action: 'openUpnpPort' },
            { label: 'Настроить Keenetic автоматически', description: `TCP ${this._port} -> ${this._localIp || 'IP ПК'}:${this._port}`, detail: 'Попросит логин/пароль роутера, создаст правило проброса через RCI и не сохранит пароль.', action: 'configureKeeneticRouter' },
            { label: 'Скопировать инструкцию Keenetic', description: `TCP ${this._port} -> ${this._localIp || 'IP ПК'}:${this._port}`, detail: 'Скопирует поля для ручного проброса порта и CLI-шаблон. Расширение не меняет настройки роутера без вашего входа.', action: 'copyKeeneticCommands' },
            { label: 'Открыть Keenetic', description: 'my.keenetic.net', detail: 'Откроет локальный веб-интерфейс роутера в браузере.', action: 'openRouterPage' },
            ...(publicUrl ? [
                { label: 'Скопировать публичный Keenetic URL', description: publicUrl, detail: `Провайдер: ${providerLabel}`, action: 'copyPublic' }
            ] : []),
            ...(publicUrl ? [
                { label: 'Изменить публичный Keenetic URL', description: providerLabel, action: 'setPublic' },
                { label: 'Очистить публичный Keenetic URL', description: publicUrl, action: 'clearPublic' }
            ] : []),
            { label: 'Сменить роутер / KeenDNS', description: keeneticHost || 'name или name.keenetic.link', detail: 'По имени расширение само сформирует публичный URL с портом сервера.', action: 'setKeeneticHost' },
            { label: 'Как подключиться извне', description: 'Keenetic/KeenDNS + токен', detail: 'Настройте KeenDNS/проброс порта 8799 на ПК, затем вставьте публичный URL в APK.', action: 'showHelp' },
            { label: 'Открыть настройки расширения', description: 'порт, host, token, public URL', action: 'openSettings' }
        ];
        const picked = await vscode.window.showQuickPick(items, {
            title: 'Remote Code: подключение',
            placeHolder: `${localUrl}${publicUrl ? ` / ${publicUrl}` : ''} · ${providerLabel} · ${tokenState}`
        });
        if (!picked) return;
        switch (picked.action) {
            case 'showPairingQr':
                await this.showPairingQr();
                return;
            case 'copyPairingPayload':
                await this.copyPairingPayload();
                return;
            case 'copyLocal':
                await vscode.env.clipboard.writeText(localUrl);
                await vscode.window.setStatusBarMessage('Remote Code: локальный URL скопирован', 1800);
                return;
            case 'copyPublic':
                await vscode.env.clipboard.writeText(publicUrl);
                await vscode.window.setStatusBarMessage('Remote Code: публичный URL скопирован', 1800);
                return;
            case 'autoPublic': {
                let resolved = await this.resolveKeeneticPublicUrl(true);
                if (!resolved) {
                    const nextUrl = await this.promptForStableKeeneticPublicUrl(keeneticHost);
                    if (nextUrl) resolved = { url: nextUrl, source: 'input' };
                }
                if (resolved?.url) {
                    await vscode.env.clipboard.writeText(resolved.url);
                    await vscode.window.showInformationMessage(`Remote Code: Keenetic URL сформирован и скопирован: ${resolved.url}`);
                } else {
                    await vscode.window.showWarningMessage('Remote Code: не удалось сформировать Keenetic URL. Укажите стабильный KeenDNS/DDNS адрес вида http://name.keenetic.link:8799.');
                }
                return;
            }
            case 'openUpnpPort': {
                try {
                    const result = await this.openRouterPortViaUpnp();
                    await vscode.window.showInformationMessage(`Remote Code: проброс через UPnP создан (${result.message}). Если у провайдера белый IP и KeenDNS в режиме Direct, внешний URL должен заработать.`);
                } catch (err: any) {
                    await vscode.window.showWarningMessage(`Remote Code: UPnP не открыл порт: ${err?.message || String(err)}. В этом же меню можно скопировать инструкцию Keenetic для ручного проброса.`);
                }
                return;
            }
            case 'copyKeeneticCommands': {
                await this.copyKeeneticForwardingInstructions();
                return;
            }
            case 'configureKeeneticRouter': {
                await this.configureKeeneticRouterFromUi();
                return;
            }
            case 'openRouterPage':
                await this.openKeeneticRouterPage();
                return;
            case 'setPublic': {
                const value = await vscode.window.showInputBox({
                    title: 'Remote Code: публичный Keenetic URL',
                    prompt: 'Введите готовый KeenDNS/Keenetic адрес, который ведет на порт 8799 этого ПК',
                    placeHolder: 'http://name.keenetic.link:8799',
                    value: publicUrl
                });
                if (value === undefined) return;
                const nextUrl = await this.setConfiguredPublicUrl(value);
                if (nextUrl) {
                    try {
                        const parsed = new URL(nextUrl);
                        await this.setConfiguredKeeneticHost(this.looksLikeKeeneticHost(parsed.hostname) ? parsed.host : '');
                    } catch {
                        await this.setConfiguredKeeneticHost('');
                    }
                    await vscode.env.clipboard.writeText(nextUrl);
                    await vscode.window.showInformationMessage(`Remote Code: Keenetic URL сохранен и скопирован: ${nextUrl}`);
                } else if (this.isUnsupportedKeeneticServiceUrl(value)) {
                    await this.setConfiguredKeeneticHost('');
                    await vscode.window.showWarningMessage('Remote Code: служебный адрес *.netcraze.io не подходит для подключения телефона. Укажите KeenDNS/DDNS URL вида http://name.keenetic.link:8799.');
                } else {
                    await this.setConfiguredKeeneticHost('');
                    await vscode.window.showInformationMessage('Remote Code: публичный URL очищен.');
                }
                return;
            }
            case 'clearPublic':
                await this.setConfiguredPublicUrl('');
                await this.setConfiguredKeeneticHost('');
                await vscode.window.setStatusBarMessage('Remote Code: публичный Keenetic URL очищен', 1800);
                return;
            case 'setKeeneticHost': {
                const value = await vscode.window.showInputBox({
                    title: 'Remote Code: имя KeenDNS',
                    prompt: 'Введите короткое имя KeenDNS или полный домен. URL будет сформирован автоматически с портом Remote Code.',
                    placeHolder: 'name или name.keenetic.link',
                    value: keeneticHost
                });
                if (value === undefined) return;
                const host = await this.setConfiguredKeeneticHost(value);
                const nextUrl = this.buildKeeneticPublicUrl(host);
                await this.setConfiguredPublicUrl(nextUrl);
                if (nextUrl) {
                    await vscode.env.clipboard.writeText(nextUrl);
                    await vscode.window.showInformationMessage(`Remote Code: KeenDNS сохранен, URL сформирован и скопирован: ${nextUrl}`);
                } else if (this.isUnsupportedKeeneticServiceUrl(value)) {
                    await vscode.window.showWarningMessage('Remote Code: служебный адрес *.netcraze.io не подходит для подключения телефона. Укажите KeenDNS/DDNS URL вида http://name.keenetic.link:8799.');
                } else {
                    await vscode.window.showInformationMessage('Remote Code: имя KeenDNS очищено.');
                }
                return;
            }
            case 'tokenMenu':
            case 'copyToken':
            case 'createToken':
            case 'rotateToken': {
                await this.showAuthTokenMenu();
                return;
            }
            case 'stopTunnel':
                this.stopTunnel();
                await vscode.window.setStatusBarMessage('Remote Code: внешний туннель остановлен', 1800);
                return;
            case 'showHelp':
                await vscode.window.showInformationMessage(
                    'Remote Code: локально используйте IP ПК и порт 8799. Для внешней сети настройте KeenDNS/переадресацию TCP-порта 8799 на IP этого ПК, сохраните Keenetic URL здесь и вставьте его в APK. Для внешнего доступа лучше включить токен.'
                );
                return;
            case 'openSettings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'remoteCodeOnPC');
                return;
        }
    }

    private async copyKeeneticForwardingInstructions(): Promise<void> {
        await vscode.env.clipboard.writeText(this.buildKeeneticForwardingInstructions());
        await vscode.window.showInformationMessage('Remote Code: инструкция Keenetic скопирована. Откройте веб-интерфейс роутера и добавьте правило TCP-проброса.');
    }

    private async openKeeneticRouterPage(): Promise<void> {
        await vscode.env.openExternal(vscode.Uri.parse('http://my.keenetic.net/'));
    }

    private async promptForStableKeeneticPublicUrl(currentValue = ''): Promise<string | null> {
        const value = await vscode.window.showInputBox({
            title: 'Remote Code: публичный URL для телефона',
            prompt: 'Введите стабильный KeenDNS/DDNS адрес, который ведет на TCP 8799 этого ПК. Служебные адреса *.netcraze.io не используются как публичный URL приложения.',
            placeHolder: 'http://name.keenetic.link:8799',
            value: currentValue,
            ignoreFocusOut: true
        });
        if (value === undefined) return null;
        const nextUrl = this.buildKeeneticPublicUrl(value);
        if (!nextUrl || this.isUnsupportedKeeneticServiceUrl(nextUrl)) {
            await this.setConfiguredPublicUrl('');
            await this.setConfiguredKeeneticHost('');
            await vscode.window.showWarningMessage('Remote Code: этот адрес не подходит для подключения телефона. Вставьте KeenDNS/Keenetic URL вида http://name.keenetic.link:8799.');
            return null;
        }
        await this.setConfiguredKeeneticHost(value);
        await this.setConfiguredPublicUrl(nextUrl);
        await vscode.env.clipboard.writeText(nextUrl);
        return nextUrl;
    }

    private async ensureStableKeeneticPublicUrlFromUi(): Promise<string | null> {
        const publicUrl = this.getPublicUrl();
        if (publicUrl && !this.isUnsupportedKeeneticServiceUrl(publicUrl)) {
            await vscode.env.clipboard.writeText(publicUrl);
            return publicUrl;
        }
        return this.promptForStableKeeneticPublicUrl(this.getConfiguredKeeneticHost());
    }

    private async configureKeeneticRouterFromUi(): Promise<void> {
        if (!this._authToken) {
            const action = await vscode.window.showWarningMessage(
                'Remote Code: для внешнего доступа сначала нужен токен. Создать или скопировать токен сейчас?',
                'Токен доступа',
                'Отмена'
            );
            if (action === 'Токен доступа') await this.showAuthTokenMenu();
            return;
        }
        const routerBase = await vscode.window.showInputBox({
            title: 'Remote Code: адрес Keenetic',
            prompt: 'Введите локальный адрес веб-интерфейса роутера. Пароль не сохраняется.',
            placeHolder: 'http://my.keenetic.net/',
            value: 'http://my.keenetic.net/',
            ignoreFocusOut: true
        });
        if (routerBase === undefined) return;
        const username = await vscode.window.showInputBox({
            title: 'Remote Code: логин Keenetic',
            prompt: 'Логин администратора роутера',
            value: 'admin',
            ignoreFocusOut: true
        });
        if (username === undefined) return;
        const password = await vscode.window.showInputBox({
            title: 'Remote Code: пароль Keenetic',
            prompt: 'Пароль администратора роутера. Он используется только для этой операции и не сохраняется.',
            password: true,
            ignoreFocusOut: true
        });
        if (password === undefined) return;
        const wanInterface = await vscode.window.showInputBox({
            title: 'Remote Code: внешний интерфейс Keenetic',
            prompt: 'Обычно это ISP. Если у вас другое имя WAN-интерфейса, укажите его.',
            value: 'ISP',
            ignoreFocusOut: true
        });
        if (wanInterface === undefined) return;
        const lanIp = this._localIp || 'IP ПК';
        const confirm = await vscode.window.showWarningMessage(
            `Remote Code создаст на Keenetic правило TCP ${this._port} -> ${lanIp}:${this._port}. Продолжить?`,
            { modal: true },
            'Настроить',
            'Отмена'
        );
        if (confirm !== 'Настроить') return;
        try {
            const mapping = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Remote Code: настройка Keenetic',
                cancellable: false
            }, async progress => {
                progress.report({ message: 'создаю правило проброса порта...' });
                return this.configureKeeneticPortForward(routerBase, username.trim() || 'admin', password, wanInterface);
            });
            const publicUrl = await this.ensureStableKeeneticPublicUrlFromUi();
            if (publicUrl) {
                await vscode.window.showInformationMessage(`Remote Code: Keenetic настроен (${mapping}). Публичный URL сохранен и скопирован. Проверьте подключение с телефона.`);
            } else {
                await vscode.window.showWarningMessage(`Remote Code: Keenetic настроен (${mapping}), но публичный URL не сохранен. Укажите KeenDNS/DDNS адрес вида http://name.keenetic.link:8799 в меню подключения.`);
            }
        } catch (err: any) {
            await vscode.window.showErrorMessage(`Remote Code: не удалось настроить Keenetic: ${err?.message || String(err)}`);
        }
    }

    public async showAuthTokenMenu(): Promise<string | undefined> {
        const items: Array<vscode.QuickPickItem & { action: 'copy' | 'create' | 'rotate' | 'connection' }> = this._authToken
            ? [
                {
                    label: 'Скопировать текущий токен',
                    description: 'старый токен останется действующим',
                    detail: 'Используйте это, если нужно снова вставить тот же токен в APK.',
                    action: 'copy'
                },
                {
                    label: 'Создать новый токен',
                    description: 'старый токен перестанет работать',
                    detail: 'После создания вставьте новый токен в поле "Токен" в приложении и сохраните/подключитесь заново.',
                    action: 'rotate'
                },
                {
                    label: 'Открыть меню подключения',
                    description: 'URL, Keenetic, порт и настройки',
                    action: 'connection'
                }
            ]
            : [
                {
                    label: 'Создать токен доступа',
                    description: 'обязателен для внешней сети',
                    detail: 'Токен будет сохранен в настройках расширения и скопирован в буфер обмена.',
                    action: 'create'
                },
                {
                    label: 'Открыть меню подключения',
                    description: 'URL, Keenetic, порт и настройки',
                    action: 'connection'
                }
            ];
        const picked = await vscode.window.showQuickPick(items, {
            title: 'Remote Code: токен доступа',
            placeHolder: this._authToken
                ? 'Выберите: скопировать текущий токен или создать новый'
                : 'Создайте токен и вставьте его в приложение'
        });
        if (!picked) return undefined;
        if (picked.action === 'connection') {
            await this.showConnectionSettings();
            return undefined;
        }
        if (picked.action === 'rotate') {
            const confirmed = await vscode.window.showWarningMessage(
                'Создать новый токен доступа? Старый токен сразу перестанет работать, и его нужно будет заменить в приложении.',
                { modal: true },
                'Создать новый токен'
            );
            if (confirmed !== 'Создать новый токен') return undefined;
            return this.createOrCopyAuthToken(true);
        }
        return this.createOrCopyAuthToken(picked.action === 'create');
    }

    public async createOrCopyAuthToken(forceNew = false): Promise<string> {
        if (!this._authToken || forceNew) {
            const replacing = !!this._authToken;
            const token = crypto.randomBytes(24).toString('hex');
            await vscode.workspace.getConfiguration('remoteCodeOnPC').update('authToken', token, vscode.ConfigurationTarget.Global);
            this._authToken = token;
            await vscode.env.clipboard.writeText(token);
            this.refreshPcChatPanel();
            await vscode.window.showInformationMessage(
                replacing
                    ? 'Remote Code: новый токен создан и скопирован. Старый токен больше не работает. Вставьте новый токен в приложении.'
                    : 'Remote Code: токен создан и скопирован. Вставьте его в поле "Токен" в приложении.'
            );
            return token;
        }
        await vscode.env.clipboard.writeText(this._authToken);
        await vscode.window.showInformationMessage('Remote Code: текущий токен скопирован. Для замены выберите "Создать новый токен".');
        return this._authToken;
    }

    private async ensurePairingToken(): Promise<string> {
        if (this._authToken) return this._authToken;
        const token = crypto.randomBytes(24).toString('hex');
        await vscode.workspace.getConfiguration('remoteCodeOnPC').update('authToken', token, vscode.ConfigurationTarget.Global);
        this._authToken = token;
        this.refreshPcChatPanel();
        await vscode.window.showInformationMessage('Remote Code: token created for Android pairing.');
        return token;
    }

    private buildPairingPayload(token: string): string {
        const localUrl = `http://${this._localIp || '127.0.0.1'}:${this._port}`;
        const publicUrl = this.getPublicUrl() || '';
        const payload = {
            type: 'remote-code-pairing',
            version: 1,
            url: publicUrl || localUrl,
            localUrl,
            publicUrl,
            token
        };
        const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
        return `remote-code-pair:${encoded}`;
    }

    private async getPairingPayload(): Promise<string> {
        return this.buildPairingPayload(await this.ensurePairingToken());
    }

    public async copyPairingPayload(): Promise<string> {
        const value = await this.getPairingPayload();
        await vscode.env.clipboard.writeText(value);
        await vscode.window.setStatusBarMessage('Remote Code: Android pairing code copied', 2200);
        return value;
    }

    public async showPairingQr(): Promise<void> {
        const value = await this.getPairingPayload();
        await vscode.env.clipboard.writeText(value);
        const localUrl = `http://${this._localIp || '127.0.0.1'}:${this._port}`;
        const publicUrl = this.getPublicUrl() || '';
        const targetUrl = publicUrl || localUrl;
        const qrSvg = await QRCode.toString(value, {
            type: 'svg',
            margin: 1,
            width: 320,
            color: { dark: '#111827', light: '#ffffff' }
        });
        const panel = vscode.window.createWebviewPanel(
            'remoteCodePairingQr',
            'Remote Code Android QR',
            vscode.ViewColumn.Beside,
            { enableScripts: false, retainContextWhenHidden: false }
        );
        panel.webview.html = this.renderPairingQrHtml(qrSvg, value, targetUrl, publicUrl ? 'External URL' : 'Local URL');
        await vscode.window.setStatusBarMessage('Remote Code: Android QR opened and pairing code copied', 2600);
    }

    private renderPairingQrHtml(qrSvg: string, pairingCode: string, targetUrl: string, urlLabel: string): string {
        const safeCode = this.escapeHtml(pairingCode);
        const safeUrl = this.escapeHtml(targetUrl);
        const safeLabel = this.escapeHtml(urlLabel);
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{margin:0;padding:28px;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);line-height:1.45}
.wrap{max-width:720px;margin:0 auto}
h1{font-size:24px;margin:0 0 8px}
p{color:var(--vscode-descriptionForeground);font-size:14px;margin:8px 0}
.panel{margin-top:18px;padding:18px;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-sideBar-background)}
.qr{display:flex;justify-content:center;margin:12px 0 18px}.qr svg{width:min(320px,72vw);height:auto;background:#fff;border-radius:8px;padding:14px}
.meta{display:grid;gap:8px;margin-top:14px}.label{font-size:12px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.04em}
code{display:block;white-space:pre-wrap;word-break:break-all;padding:10px;border-radius:6px;background:var(--vscode-textCodeBlock-background);font-family:var(--vscode-editor-font-family);font-size:12px}
ol{padding-left:20px}li{margin:6px 0}.note{margin-top:12px;font-size:13px;color:var(--vscode-descriptionForeground)}
</style>
</head>
<body>
<main class="wrap">
<h1>QR для телефона</h1>
<p>В Android-приложении нажмите <strong>QR</strong> и наведите камеру на этот код.</p>
<section class="panel">
<div class="qr">${qrSvg}</div>
<ol>
<li>Если подключение будет снаружи домашней сети, выберите в приложении внешнюю сеть.</li>
<li>Нажмите <strong>QR</strong>. Приложение заполнит URL и токен автоматически.</li>
<li>Если камера недоступна, нажмите <strong>Код</strong> и вставьте строку ниже.</li>
</ol>
<div class="meta">
<div><div class="label">${safeLabel}</div><code>${safeUrl}</code></div>
<div><div class="label">Код подключения скопирован в буфер</div><code>${safeCode}</code></div>
</div>
<p class="note">QR содержит URL подключения и токен доступа. Не публикуйте его.</p>
</section>
</main>
</body>
</html>`;
    }

    private openPcChatPanel(): void {
        if (this.pcChatPanel) {
            this.pcChatPanel.reveal(vscode.ViewColumn.One, true);
            this.startPcCodexMirrorPolling();
            return;
        }
        this.pcChatPanel = vscode.window.createWebviewPanel(
            'remoteCodePcChat',
            'Remote Code',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        this.pcChatPanel.webview.onDidReceiveMessage(async msg => {
            if (msg?.type === 'send') {
                const localAttachments = this.normalizeLocalAttachments(Array.isArray(msg.attachments) ? msg.attachments : []);
                const text = typeof msg.message === 'string' ? msg.message.trim() : '';
                if (!text && localAttachments.length === 0) return;
                if (typeof msg.profile === 'string') this.selectedProfile = msg.profile;
                if (typeof msg.workMode === 'string') this.selectedWorkMode = msg.workMode;
                try {
                    await this.enqueueRemoteCodeMessage(
                        text,
                        typeof msg.model === 'string' ? msg.model : this.selectedAgent,
                        '',
                        [],
                        typeof msg.reasoningEffort === 'string' ? msg.reasoningEffort : this.selectedReasoningEffort,
                        msg.includeContext !== false,
                        localAttachments
                    );
                } catch (err: any) {
                    await vscode.window.setStatusBarMessage(`Remote Code: ${err?.message || String(err)}`, 3500);
                    this.refreshPcChatPanel(true);
                }
            } else if (msg?.type === 'action' && typeof msg.action === 'string') {
                await this.handlePcChatAction(msg.action, msg);
            } else if (msg?.type === 'actionResponse' && typeof msg.actionId === 'string') {
                await this.applyActionResponse(msg.actionId, msg.decision === 'approve');
            }
        });
        this.pcChatPanel.onDidDispose(() => {
            if (this.pcChatRefreshTimer) {
                clearTimeout(this.pcChatRefreshTimer);
                this.pcChatRefreshTimer = undefined;
            }
            if (this.remoteCodeStateSaveTimer) {
                clearTimeout(this.remoteCodeStateSaveTimer);
                this.remoteCodeStateSaveTimer = undefined;
                this.persistRemoteCodeState();
            }
            this.stopPcCodexMirrorPolling();
            this.pcChatPanel = undefined;
        });
        this.refreshPcChatPanel(true);
        this.startPcCodexMirrorPolling();
    }

    private refreshPcChatPanel(immediate = false): void {
        if (!this.pcChatPanel) return;
        if (immediate) {
            if (this.pcChatRefreshTimer) {
                clearTimeout(this.pcChatRefreshTimer);
                this.pcChatRefreshTimer = undefined;
            }
            this.renderPcChatPanelNow();
            return;
        }
        if (this.pcChatRefreshTimer) return;
        this.pcChatRefreshTimer = setTimeout(() => {
            this.pcChatRefreshTimer = undefined;
            this.renderPcChatPanelNow();
        }, 180);
    }

    private renderPcChatPanelNow(): void {
        if (!this.pcChatPanel) return;
        this.finalizeStaleStreamingMessages(2 * 60 * 1000, false);
        const messages = this.getMessagesForRemoteThread(this.currentRemoteThreadId, 80)
            .filter(m => m.role !== 'system');
        const actions = this.getActionEventsForThread(this.currentRemoteThreadId);
        this.pcChatPanel.webview.html = this.renderPcChatHtml(messages, actions);
        this.updatePcCodexMirrorSignature();
    }

    private currentCodexSessionSignature(): string | undefined {
        const threadId = this.currentRemoteThreadId || '';
        const fileId = this.fromCodexThreadId(threadId);
        if (!fileId) return undefined;
        const filePath = this.findCodexSessionFile(fileId);
        if (!filePath) return undefined;
        try {
            const stat = fs.statSync(filePath);
            return `${threadId}|${filePath}|${Math.round(stat.mtimeMs)}|${stat.size}`;
        } catch {
            return undefined;
        }
    }

    private updatePcCodexMirrorSignature(): void {
        const signature = this.currentCodexSessionSignature();
        this.pcCodexMirrorSignature = signature || '';
    }

    private startPcCodexMirrorPolling(): void {
        if (this.pcCodexMirrorTimer) return;
        this.updatePcCodexMirrorSignature();
        this.pcCodexMirrorTimer = setInterval(() => {
            this.refreshPcChatPanelForExternalCodexChange();
        }, 1500);
    }

    private stopPcCodexMirrorPolling(): void {
        if (this.pcCodexMirrorTimer) {
            clearInterval(this.pcCodexMirrorTimer);
            this.pcCodexMirrorTimer = undefined;
        }
        this.pcCodexMirrorSignature = '';
    }

    private startWsCodexMirrorPolling(): void {
        if (this.wsCodexMirrorTimer) return;
        this.wsCodexMirrorSignature = this.currentCodexSessionSignature() || '';
        this.wsCodexMirrorTimer = setInterval(() => {
            this.refreshWsCodexMirrorForExternalCodexChange();
        }, 1500);
    }

    private stopWsCodexMirrorPolling(): void {
        if (this.wsCodexMirrorTimer) {
            clearInterval(this.wsCodexMirrorTimer);
            this.wsCodexMirrorTimer = undefined;
        }
        this.wsCodexMirrorSignature = '';
    }

    private refreshWsCodexMirrorForExternalCodexChange(): void {
        if (this.wsClients.size === 0) {
            this.stopWsCodexMirrorPolling();
            return;
        }
        const signature = this.currentCodexSessionSignature();
        if (!signature) {
            this.wsCodexMirrorSignature = '';
            return;
        }
        if (signature === this.wsCodexMirrorSignature) return;

        this.wsCodexMirrorSignature = signature;
        this.codexSessionFilesCache = undefined;
        this.remoteCodeThreadsCache = undefined;
        this.broadcastCodexCurrentThreadRefresh();
    }

    private refreshPcChatPanelForExternalCodexChange(): void {
        if (!this.pcChatPanel) {
            this.stopPcCodexMirrorPolling();
            return;
        }
        const signature = this.currentCodexSessionSignature();
        if (!signature) {
            this.pcCodexMirrorSignature = '';
            return;
        }
        if (signature === this.pcCodexMirrorSignature) return;

        this.pcCodexMirrorSignature = signature;
        this.remoteCodeThreadsCache = undefined;
        this.refreshPcChatPanel(true);
        this.broadcastCodexCurrentThreadRefresh();
    }

    private broadcastCodexCurrentThreadRefresh(): void {
        const threadId = this.currentRemoteThreadId;
        if (!threadId) return;
        this.broadcast({
            ...this.getRemoteCodeThreadsUpdatePayload(),
            type: 'codex:sessions-update'
        });
        this.broadcast({
            type: 'codex:message-refresh',
            threadId,
            messages: this.getMessagesForRemoteThread(threadId, 120).filter(m => m.role !== 'system'),
            events: this.getActionEventsForThread(threadId),
            timestamp: Date.now()
        });
    }

    private async handlePcChatAction(action: string, msg: any): Promise<void> {
        switch (action) {
            case 'addFile': {
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: true,
                title: 'Добавить файлы в запрос Remote Code'
                });
                if (!uris || uris.length === 0) return;
                const files = this.normalizeLocalAttachments(uris.map(uri => ({
                    name: path.basename(uri.fsPath),
                    path: uri.fsPath,
                    mimeType: this.guessMimeType(uri.fsPath),
                    size: 0
                })));
                await this.pcChatPanel?.webview.postMessage({ type: 'attachFiles', files });
                return;
            }
            case 'pasteFiles': {
                const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
                const files = this.saveMobileAttachments(attachments);
                if (files.length === 0) {
                    await vscode.window.setStatusBarMessage('Remote Code: в буфере не найдено файлов для вставки', 1800);
                    return;
                }
                await this.pcChatPanel?.webview.postMessage({ type: 'attachFiles', files });
                await vscode.window.setStatusBarMessage(`Remote Code: добавлено файлов: ${files.length}`, 1800);
                return;
            }
            case 'selectModel':
                if (typeof msg.model === 'string' && this.getDefaultCodexModels().some(model => model.id === msg.model)) {
                    this.selectedAgent = msg.model;
                    this.saveRemoteCodeState();
                    this.broadcast({ type: 'codex:model-changed', model: msg.model, timestamp: Date.now() });
                }
                return;
            case 'selectEffort':
                if (typeof msg.effort === 'string') {
                    this.selectedReasoningEffort = this.normalizeReasoningEffort(msg.effort);
                    this.saveRemoteCodeState();
                }
                return;
            case 'toggleContext':
                this.selectedIncludeContext = msg.includeContext !== false;
                this.saveRemoteCodeState();
                return;
            case 'newChat':
                this.createRemoteCodeThread();
                return;
            case 'renameThread':
                await this.renameCurrentThread();
                return;
            case 'pinCurrentThread':
                await this.toggleCurrentThreadPinned();
                return;
            case 'archiveCurrentThread':
                await this.archiveCurrentThread();
                return;
            case 'copyWorkspaceDirectory':
                await this.copyWorkspaceDirectory();
                return;
            case 'copySessionId':
                await vscode.env.clipboard.writeText(this.currentRemoteThreadId);
                await vscode.window.setStatusBarMessage('Remote Code: идентификатор сеанса скопирован', 1600);
                return;
            case 'copyDeeplink': {
                const link = `http://127.0.0.1:${this._port}/codex?threadId=${encodeURIComponent(this.currentRemoteThreadId)}`;
                await vscode.env.clipboard.writeText(link);
                await vscode.window.setStatusBarMessage('Remote Code: диплинк скопирован', 1600);
                return;
            }
            case 'copyCurrentThreadMarkdown':
                await this.copyCurrentThreadMarkdown();
                return;
            case 'openSideChat':
                this.openPcChatPanel();
                await vscode.window.setStatusBarMessage('Remote Code: чат открыт', 1200);
                return;
            case 'openMiniWindow':
                try {
                    await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
                } catch {
                    await vscode.window.showInformationMessage('Remote Code: мини-окно недоступно в этой версии VS Code.');
                }
                return;
            case 'switchThread':
                if (typeof msg.threadId === 'string' && msg.threadId.trim()) {
                    this.currentRemoteThreadId = msg.threadId.trim();
                    this.saveRemoteCodeState();
                    this.refreshPcChatPanel();
                this.broadcast(this.getRemoteCodeThreadsUpdatePayload());
                }
                return;
            case 'deleteThread':
                if (typeof msg.threadId === 'string' && msg.threadId.trim()) {
                    await this.confirmAndDeleteThread(msg.threadId.trim());
                }
                return;
            case 'deleteCurrentThread':
                await this.confirmAndDeleteCurrentThread();
                return;
            case 'clearChat':
                await this.confirmAndClearCurrentThread();
                return;
            case 'openTerminal':
                (vscode.window.activeTerminal || vscode.window.createTerminal('Remote Code')).show();
                return;
            case 'openSearch':
                await vscode.commands.executeCommand('workbench.action.findInFiles');
                return;
            case 'openExtensions':
                await vscode.commands.executeCommand('workbench.view.extensions');
                return;
            case 'openPlugins':
                await vscode.commands.executeCommand('workbench.view.extensions');
                return;
            case 'openAutomations':
                await vscode.window.showInformationMessage('Remote Code: автоматизации Codex пока доступны в основном приложении.');
                return;
            case 'openCommandPalette':
                await vscode.commands.executeCommand('workbench.action.showCommands');
                return;
            case 'openWorkspace':
                if (typeof msg.path === 'string' && msg.path.trim()) {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.path.trim()), false);
                }
                return;
            case 'showProblems':
                await vscode.commands.executeCommand('workbench.actions.view.problems');
                return;
            case 'openScm':
                await vscode.commands.executeCommand('workbench.view.scm');
                return;
            case 'showConnectionSettings':
                await this.showConnectionSettings();
                return;
            case 'configureKeeneticRouter':
                await this.configureKeeneticRouterFromUi();
                return;
            case 'copyKeeneticCommands':
                await this.copyKeeneticForwardingInstructions();
                return;
            case 'openRouterPage':
                await this.openKeeneticRouterPage();
                return;
            case 'createOrCopyToken':
                await this.showAuthTokenMenu();
                return;
            case 'showPairingQr':
                await this.showPairingQr();
                return;
            case 'copyPairingPayload':
                await this.copyPairingPayload();
                return;
            case 'openSettings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'remoteCodeOnPC');
                return;
            case 'toggleLayout':
                try {
                    await vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
                } catch {
                    await vscode.commands.executeCommand('workbench.action.togglePanel');
                }
                return;
            case 'copyMessage':
                if (typeof msg.text === 'string' && msg.text.trim()) {
                    await vscode.env.clipboard.writeText(msg.text);
                    await vscode.window.setStatusBarMessage('Remote Code: сообщение скопировано', 1600);
                }
                return;
            case 'deleteMessage':
                if (typeof msg.messageId === 'string' && msg.messageId.trim()) {
                    const result = this.deleteRemoteMessage(this.currentRemoteThreadId, msg.messageId.trim());
                    await vscode.window.setStatusBarMessage(result.success ? 'Remote Code: сообщение удалено' : 'Remote Code: сообщение не найдено', 1600);
                }
                return;
            case 'regenerateMessage':
                if (typeof msg.messageId === 'string' && msg.messageId.trim()) {
                    const result = await this.regenerateRemoteMessage(this.currentRemoteThreadId, msg.messageId.trim());
                    if (!result.success) {
                        await vscode.window.setStatusBarMessage(`Remote Code: ${result.error || 'не удалось повторить ответ'}`, 1800);
                    }
                }
                return;
            case 'messageFeedback':
                if (typeof msg.messageId === 'string' && typeof msg.feedback === 'string') {
                    const feedback = this._context.globalState.get<Record<string, string>>('remote_code_message_feedback', {});
                    feedback[msg.messageId] = msg.feedback;
                    await this._context.globalState.update('remote_code_message_feedback', feedback);
                    await vscode.window.setStatusBarMessage(`Remote Code: оценка сохранена (${msg.feedback})`, 1600);
                }
                return;
            case 'selectProfile':
                if (typeof msg.profile === 'string' && ['user', 'review', 'fast'].includes(msg.profile)) {
                    this.selectedProfile = msg.profile;
                    this.saveRemoteCodeState();
                    this.refreshPcChatPanel();
                }
                return;
            case 'selectWorkMode':
                if (typeof msg.mode === 'string' && ['local', 'workspace'].includes(msg.mode)) {
                    this.selectedWorkMode = msg.mode;
                    this.saveRemoteCodeState();
                    this.refreshPcChatPanel();
                    if (msg.mode === 'local') {
                        await this.showLocalUsageStatus();
                    }
                }
                return;
            case 'showUsageStatus':
                await this.showLocalUsageStatus();
                return;
            case 'showBranch':
                await vscode.window.showInformationMessage(`Ветка Remote Code: ${this.getGitBranchLabel()}`);
                return;
            case 'openProgressFile':
                if (typeof msg.path === 'string' && msg.path.trim()) {
                    await this.openChangeFile(msg.path);
                }
                return;
            case 'copyProgressUrl':
                if (typeof msg.url === 'string' && msg.url.trim()) {
                    await vscode.env.clipboard.writeText(msg.url.trim());
                    await vscode.window.setStatusBarMessage('Remote Code: ссылка скопирована', 1600);
                }
                return;
            case 'openChangeFile':
                if (typeof msg.path === 'string' && msg.path.trim()) {
                    await this.openChangeFile(msg.path);
                }
                return;
            case 'reviewChangeBlock':
                await vscode.commands.executeCommand('workbench.view.scm');
                if (typeof msg.commit === 'string' && msg.commit.trim()) {
                    await vscode.window.setStatusBarMessage(`Remote Code: изменения коммита ${msg.commit.trim()} показаны в блоке чата`, 1800);
                }
                return;
            case 'undoChangeBlock':
                this.requestRemoteCodeUndoChange(
                    typeof msg.path === 'string' ? msg.path : '',
                    typeof msg.commit === 'string' ? msg.commit : '',
                    typeof msg.cwd === 'string' ? msg.cwd : ''
                );
                await vscode.window.setStatusBarMessage('Remote Code: undo request is waiting for approval', 1800);
                return;
            case 'stopGeneration':
                this.stopActiveGeneration(true);
                return;
            case 'dismissActionEvent':
                if (typeof msg.actionId === 'string' && msg.actionId.trim()) {
                    this.dismissActionEvent(msg.actionId.trim());
                }
                return;
            default:
                await vscode.window.showInformationMessage(`Remote Code: ${action}`);
        }
    }

    private async renameCurrentThread(): Promise<void> {
        const current = this.getRemoteCodeThreads().find(thread => thread.id === this.currentRemoteThreadId);
        const value = await vscode.window.showInputBox({
            title: 'Переименовать чат',
            prompt: 'Название чата Remote Code',
            value: current?.title || this.getCurrentThreadTitle(),
            valueSelection: [0, (current?.title || this.getCurrentThreadTitle()).length]
        });
        const title = value?.replace(/\s+/g, ' ').trim();
        if (!title) return;
        this.upsertRemoteCodeThread(this.currentRemoteThreadId, title, Date.now());
        this.saveRemoteCodeState(true);
        this.refreshPcChatPanel(true);
        this.broadcast(this.getRemoteCodeThreadsUpdatePayload());
    }

    private async toggleCurrentThreadPinned(): Promise<void> {
        if (this.pinnedThreadIds.has(this.currentRemoteThreadId)) {
            this.pinnedThreadIds.delete(this.currentRemoteThreadId);
            await vscode.window.setStatusBarMessage('Remote Code: чат откреплен', 1400);
        } else {
            this.pinnedThreadIds.add(this.currentRemoteThreadId);
            await vscode.window.setStatusBarMessage('Remote Code: чат закреплен', 1400);
        }
        this.remoteCodeThreadsCache = undefined;
        this.saveRemoteCodeState(true);
        this.refreshPcChatPanel(true);
        this.broadcast(this.getRemoteCodeThreadsUpdatePayload());
    }

    private async archiveCurrentThread(): Promise<void> {
        const threadId = this.currentRemoteThreadId;
        if (!threadId) return;
        this.stopActiveGeneration(false);
        this.archivedThreadIds.add(threadId);
        this.pinnedThreadIds.delete(threadId);
        this.liveDraftThreadIds.delete(threadId);
        this.remoteCodeThreadsCache = undefined;
        const next = this.getRemoteCodeThreads().find(thread => thread.id !== threadId);
        this.currentRemoteThreadId = next?.id || '';
        this.saveRemoteCodeState(true);
        this.refreshPcChatPanel(true);
        this.broadcast(this.getRemoteCodeThreadsUpdatePayload());
        await vscode.window.setStatusBarMessage('Remote Code: чат архивирован', 1600);
    }

    private async copyWorkspaceDirectory(): Promise<void> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        if (!workspace) {
            await vscode.window.showWarningMessage('Remote Code: рабочая директория не открыта.');
            return;
        }
        await vscode.env.clipboard.writeText(workspace);
        await vscode.window.setStatusBarMessage('Remote Code: рабочая директория скопирована', 1600);
    }

    private async copyCurrentThreadMarkdown(): Promise<void> {
        const current = this.getRemoteCodeThreads().find(thread => thread.id === this.currentRemoteThreadId);
        const messages = this.getMessagesForRemoteThread(this.currentRemoteThreadId, 120)
            .filter(message => message.role !== 'system');
        const body = messages.map(message => {
            const name = message.role === 'user' ? 'Вы' : message.role === 'assistant' ? 'Remote Code' : 'Система';
            return `## ${name}\n\n${message.content.trim()}`;
        }).join('\n\n');
        await vscode.env.clipboard.writeText(`# ${current?.title || this.getCurrentThreadTitle()}\n\n${body}`.trim());
        await vscode.window.setStatusBarMessage('Remote Code: чат скопирован как Markdown', 1600);
    }

    private async confirmAndDeleteCurrentThread(): Promise<void> {
        await this.confirmAndDeleteThread(this.currentRemoteThreadId);
    }

    private async confirmAndDeleteThread(threadId: string): Promise<void> {
        if (!threadId) return;
        const current = this.getRemoteCodeThreads().find(thread => thread.id === this.currentRemoteThreadId);
        const target = this.getRemoteCodeThreads().find(thread => thread.id === threadId);
        const result = await vscode.window.showWarningMessage(
            `Удалить чат "${target?.title || current?.title || this.getCurrentThreadTitle()}" из Remote Code?`,
            { modal: true },
            'Удалить'
        );
        if (result !== 'Удалить') return;
        await this.deleteRemoteThread(threadId);
    }

    private async confirmAndClearCurrentThread(): Promise<void> {
        if (!this.currentRemoteThreadId) {
            await vscode.window.setStatusBarMessage('Remote Code: нет выбранного чата для очистки', 1600);
            return;
        }
        const current = this.getRemoteCodeThreads().find(thread => thread.id === this.currentRemoteThreadId);
        const result = await vscode.window.showWarningMessage(
            `Очистить сообщения и действия в чате "${current?.title || this.getCurrentThreadTitle()}"?`,
            { modal: true },
            'Очистить'
        );
        if (result !== 'Очистить') return;
        this.codexHistory = this.codexHistory.filter(message => message.threadId !== this.currentRemoteThreadId);
        this.codexActionEvents = this.codexActionEvents.filter(event => event.threadId !== this.currentRemoteThreadId);
        this.upsertRemoteCodeThread(this.currentRemoteThreadId, 'Новый чат', Date.now());
        this.saveRemoteCodeState();
        this.refreshPcChatPanel(true);
        this.broadcast(this.getRemoteCodeThreadsUpdatePayload());
    }

    private async deleteRemoteThread(threadId: string): Promise<void> {
        if (!threadId) return;
        if (this.currentRemoteThreadId === threadId) {
            this.stopActiveGeneration(false);
        }
        if (threadId.startsWith('codex-file:')) {
            this.hiddenCodexThreadIds.add(threadId);
        }
        this.pinnedThreadIds.delete(threadId);
        this.liveDraftThreadIds.delete(threadId);
        this.archivedThreadIds.delete(threadId);
        this.remoteCodeThreads = this.remoteCodeThreads.filter(thread => thread.id !== threadId);
        this.codexHistory = this.codexHistory.filter(message => (message.threadId || this.currentRemoteThreadId) !== threadId);
        this.codexActionEvents = this.codexActionEvents.filter(event => event.threadId !== threadId);
        this.remoteCodeThreadsCache = undefined;
        if (this.currentRemoteThreadId === threadId) {
            const next = this.getRemoteCodeThreads().find(thread => thread.id !== threadId);
            if (next?.id) {
                this.currentRemoteThreadId = next.id;
            } else {
                this.currentRemoteThreadId = '';
            }
            this.remoteCodeThreadsCache = undefined;
        }
        this.saveRemoteCodeState(true);
        this.refreshPcChatPanel(true);
        this.broadcast(this.getRemoteCodeThreadsUpdatePayload());
        await vscode.window.setStatusBarMessage('Remote Code: чат удалён из списка', 1600);
    }

    private dismissActionEvent(actionId: string): void {
        this.codexActionEvents = this.codexActionEvents.filter(event => event.id !== actionId);
        this.saveRemoteCodeState(true);
        this.refreshPcChatPanel(true);
        this.broadcast({ type: 'codex:action-update', events: this.getActionEventsForThread(this.currentRemoteThreadId), timestamp: Date.now() });
    }

    private stopActiveGeneration(showStatus: boolean): void {
        if (!this.activeChatCancellation || this.activeChatCancellation.token.isCancellationRequested) {
            if (showStatus) void vscode.window.setStatusBarMessage('Remote Code: сейчас нет активной задачи', 1400);
            return;
        }
        this.activeChatCancellation.cancel();
        if (showStatus) void vscode.window.setStatusBarMessage('Remote Code: задача остановлена', 1800);
        this.refreshPcChatPanel(true);
    }

    private readRemoteCodeChangeDiff(
        filePath: string,
        commit?: string,
        cwd?: string
    ): { success: boolean; action: string; path: string; commit?: string; cwd: string; diff?: string; message?: string; error?: string } {
        const finalCwd = this.resolveRemoteCodeChangeCwd(cwd);
        const relativePath = this.normalizeGitFilePath(filePath, finalCwd);
        if (!relativePath) {
            return {
                success: false,
                action: 'diff',
                path: filePath,
                cwd: finalCwd,
                error: 'Path must stay inside the active workspace.'
            };
        }

        const safeCommit = commit && /^[0-9a-f]{7,40}$/i.test(commit) ? commit : '';
        const attempts: string[][] = [];
        if (safeCommit) attempts.push(['show', '--format=', '--find-renames', safeCommit, '--', relativePath]);
        attempts.push(['diff', '--', relativePath]);
        attempts.push(['diff', '--cached', '--', relativePath]);

        let lastError = '';
        for (const args of attempts) {
            const result = spawnSync('git', args, {
                cwd: finalCwd,
                encoding: 'utf8',
                windowsHide: true,
                timeout: 3500
            });
            const stdout = (result.stdout || '').trim();
            const stderr = (result.stderr || '').trim();
            if (stdout) {
                return {
                    success: true,
                    action: 'diff',
                    path: relativePath,
                    commit: safeCommit || undefined,
                    cwd: finalCwd,
                    diff: stdout.slice(0, 30000)
                };
            }
            if (stderr) lastError = stderr;
        }

        return {
            success: true,
            action: 'diff',
            path: relativePath,
            commit: safeCommit || undefined,
            cwd: finalCwd,
            message: lastError || 'No diff available for this file.'
        };
    }

    private requestRemoteCodeUndoChange(filePath?: string, commit?: string, cwd?: string): RemoteCodeActionEvent {
        const finalCwd = this.resolveRemoteCodeChangeCwd(cwd);
        const relativePath = filePath ? this.normalizeGitFilePath(filePath, finalCwd) : '';
        const command = relativePath
            ? `git restore -- ${this.quoteShellArg(relativePath)}`
            : 'git restore -- .';
        const event: RemoteCodeActionEvent = {
            id: `change_undo_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
            type: 'command_approval',
            title: 'Undo change',
            detail: commit ? `${command}\ncommit: ${commit}` : command,
            status: 'pending',
            timestamp: Date.now(),
            threadId: this.currentRemoteThreadId,
            actionable: true,
            command,
            cwd: finalCwd,
            filePath: relativePath || undefined
        };
        this.upsertActionEvent(event);
        return event;
    }

    private resolveRemoteCodeChangeCwd(rawCwd?: string): string {
        const roots = this.getWorkspaceRoots();
        const fallback = roots[0] || process.cwd();
        if (!rawCwd || !path.isAbsolute(rawCwd) || !fs.existsSync(rawCwd)) return fallback;
        const resolved = path.resolve(rawCwd);
        return roots.some(root => this.isInsideWorkspaceRoot(resolved, root)) ? resolved : fallback;
    }

    private normalizeGitFilePath(filePath: string, cwd: string): string | undefined {
        const trimmed = filePath.trim();
        if (!trimmed) return undefined;
        const absolute = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(cwd, trimmed);
        if (!this.isInsideWorkspaceRoot(absolute, cwd)) return undefined;
        const relative = path.relative(cwd, absolute).replace(/\\/g, '/');
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
        return relative;
    }

    private async openChangeFile(filePath: string): Promise<void> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const absolute = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(workspace || process.cwd(), filePath);
        if (!fs.existsSync(absolute)) {
            await vscode.window.showWarningMessage(`Remote Code: файл не найден: ${absolute}`);
            return;
        }
        const document = await vscode.workspace.openTextDocument(absolute);
        await vscode.window.showTextDocument(document, { preview: true });
    }

    private async showLocalUsageStatus(): Promise<void> {
        let models: readonly vscode.LanguageModelChat[] = [];
        try {
            models = await this.getCachedLanguageModels();
        } catch {
            models = [];
        }
        const workspace = vscode.workspace.workspaceFolders?.[0]?.name || 'нет рабочей папки';
        const modelNames = models
            .map((model: any) => model.name || model.id || model.family || '')
            .filter(Boolean)
            .slice(0, 6)
            .join(', ') || 'нет доступных моделей VS Code LM';
        await vscode.window.showInformationMessage(
            [
                'Режим: работать локально',
                `Workspace: ${workspace}`,
                `Ветка: ${this.getGitBranchLabel()}`,
                `Текущая модель: ${this.selectedAgent}`,
                `Доступные модели: ${modelNames}`,
                'Лимиты: VS Code API не отдаёт остаток лимитов модели; проверяйте лимиты в аккаунте/официальном интерфейсе.'
            ].join('\n'),
            { modal: true }
        );
    }

    private async applyActionResponse(actionId: string, approve: boolean): Promise<RemoteCodeActionEvent | undefined> {
        const event = this.codexActionEvents.find(item => item.id === actionId);
        if (!event) return undefined;
        if (!approve) {
            event.status = 'denied';
            event.actionable = false;
            event.timestamp = Date.now();
            this.saveRemoteCodeState();
            this.refreshPcChatPanel();
            this.broadcastActionUpdate(event);
            return event;
        }
        event.status = 'running';
        event.actionable = false;
        event.timestamp = Date.now();
        this.saveRemoteCodeState();
        this.refreshPcChatPanel();
        this.broadcastActionUpdate(event);
        try {
            if (event.type === 'command_approval' && event.command) {
                const result = await this.runApprovedCommand(event.command, event.cwd);
                event.stdout = result.stdout;
                event.stderr = result.stderr;
                event.detail = [
                    event.command,
                    result.stdout ? `stdout:\n${result.stdout}` : '',
                    result.stderr ? `stderr:\n${result.stderr}` : ''
                ].filter(Boolean).join('\n\n').slice(0, 5000);
                event.status = result.code === 0 ? 'completed' : 'failed';
            } else if (event.type === 'patch_approval' && event.filePath && (event.contentBase64 || event.patchBase64)) {
                if (event.patchBase64) {
                    const patch = Buffer.from(event.patchBase64, 'base64').toString('utf8');
                    await this.applyApprovedPatch(event.filePath, patch);
                    event.detail = `Patch applied:\n${event.filePath}\n\n${event.diff || patch}`.slice(0, 5000);
                } else if (event.contentBase64) {
                    const text = Buffer.from(event.contentBase64, 'base64').toString('utf8');
                    fs.mkdirSync(path.dirname(event.filePath), { recursive: true });
                    fs.writeFileSync(event.filePath, text, 'utf8');
                    event.detail = `File changed:\n${event.filePath}\n\n${event.diff || ''}`.slice(0, 5000);
                }
                event.status = 'completed';
            }
        } catch (err: any) {
            event.status = 'failed';
            event.stderr = err?.message || String(err);
            event.detail = event.stderr || event.detail;
        }
        event.timestamp = Date.now();
        this.saveRemoteCodeState();
        this.refreshPcChatPanel();
        this.broadcastActionUpdate(event);
        if (event.status === 'failed') {
            this.appendActionResultMessage(event);
        }
        return event;
    }

    private async runApprovedCommand(command: string, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const finalCwd = cwd && path.isAbsolute(cwd) ? cwd : workspace || process.cwd();
        const finalCommand = process.platform === 'win32'
            ? `chcp 65001>nul & ${command}`
            : command;
        return new Promise(resolve => {
            const child = spawn(finalCommand, {
                cwd: finalCwd,
                shell: true,
                windowsHide: true,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                    PYTHONUTF8: '1'
                }
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', chunk => { stdout += chunk.toString(); });
            child.stderr.on('data', chunk => { stderr += chunk.toString(); });
            child.on('close', code => resolve({ code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() }));
            child.on('error', err => resolve({ code: 1, stdout: stdout.trim(), stderr: err.message || String(err) }));
        });
    }

    private async applyApprovedPatch(filePath: string, patch: string): Promise<void> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || path.dirname(filePath);
        this.assertPatchOnlyTouchesTarget(filePath, patch, workspace);
        await new Promise<void>((resolve, reject) => {
            const child = spawn('git', ['apply', '--whitespace=nowarn', '-'], {
                cwd: workspace,
                shell: false,
                windowsHide: true
            });
            let stderr = '';
            child.stderr.on('data', chunk => { stderr += chunk.toString(); });
            child.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(stderr.trim() || `git apply failed with code ${code}`));
            });
            child.on('error', reject);
            child.stdin.end(patch);
        });
    }

    private assertPatchOnlyTouchesTarget(filePath: string, patch: string, workspace: string): void {
        const target = path.resolve(filePath).toLowerCase();
        const refs: string[] = [];
        const addRef = (raw: string) => {
            let value = raw.trim().split(/\t/)[0].trim();
            if (!value || value === '/dev/null') return;
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (value.startsWith('a/') || value.startsWith('b/')) {
                value = value.slice(2);
            }
            const absolute = path.isAbsolute(value) ? value : path.resolve(workspace, value);
            refs.push(path.resolve(absolute).toLowerCase());
        };

        for (const line of patch.split(/\r?\n/)) {
            const gitMatch = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/);
            if (gitMatch) {
                addRef(gitMatch[1]);
                addRef(gitMatch[2]);
                continue;
            }
            const fileMatch = line.match(/^(?:---|\+\+\+)\s+(.+)$/);
            if (fileMatch) {
                addRef(fileMatch[1]);
            }
        }

        if (refs.length === 0) {
            throw new Error('Patch rejected: no target file references found.');
        }
        const unexpected = refs.find(ref => ref !== target);
        if (unexpected) {
            throw new Error(`Patch rejected: expected only ${filePath}, got ${unexpected}.`);
        }
    }

    private broadcastActionUpdate(event: RemoteCodeActionEvent): void {
        this.broadcast({
            type: 'codex:action-update',
            threadId: event.threadId,
            event,
            events: this.getActionEventsForThread(event.threadId),
            timestamp: Date.now()
        });
    }

    private appendActionResultMessage(event: RemoteCodeActionEvent): void {
        const content = event.status === 'completed'
            ? `Действие выполнено: ${event.title}\n\n${event.detail || ''}`
            : `Действие завершилось ошибкой: ${event.title}\n\n${event.detail || event.stderr || ''}`;
        const message: CodexChatMessage = {
            id: `action_result_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            role: 'assistant',
            content: content.slice(0, 6000),
            timestamp: Date.now(),
            threadId: event.threadId
        };
        this.codexHistory.push(message);
        this.codexHistory = this.codexHistory.slice(-200);
        this.saveRemoteCodeState();
        this.refreshPcChatPanel();
        this.broadcast({ type: 'codex:message', message, threadId: event.threadId, timestamp: Date.now() });
    }

    private createActionsFromAssistantResponse(response: string, threadId: string): void {
        const directiveRegex = /::(run-command|write-file|apply-patch|read-file|show-diagnostics)(\{[^\n]*\})/g;
        let match: RegExpExecArray | null;
        const created: RemoteCodeActionEvent[] = [];
        const toolResults: string[] = [];
        while ((match = directiveRegex.exec(response)) !== null) {
            try {
                const kind = match[1];
                const payload = match[2].trim() ? JSON.parse(match[2]) : {};
                const id = `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                if (kind === 'run-command' && typeof payload.command === 'string' && payload.command.trim()) {
                    created.push({
                        id,
                        type: 'command_approval',
                        title: 'Выполнить команду',
                        detail: payload.command,
                        status: 'pending',
                        timestamp: Date.now(),
                        threadId,
                        actionable: true,
                        command: payload.command,
                        cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined
                    });
                } else if (kind === 'write-file' && typeof payload.path === 'string' && typeof payload.contentBase64 === 'string') {
                    const nextText = Buffer.from(payload.contentBase64, 'base64').toString('utf8');
                    const currentText = fs.existsSync(payload.path) ? fs.readFileSync(payload.path, 'utf8') : '';
                    const diff = this.createSimpleDiff(payload.path, currentText, nextText);
                    created.push({
                        id,
                        type: 'patch_approval',
                        title: 'Изменить файл',
                        detail: diff.slice(0, 4000),
                        status: 'pending',
                        timestamp: Date.now(),
                        threadId,
                        actionable: true,
                        filePath: payload.path,
                        contentBase64: payload.contentBase64,
                        diff
                    });
                } else if (kind === 'apply-patch' && typeof payload.path === 'string' && typeof payload.patchBase64 === 'string') {
                    const patch = Buffer.from(payload.patchBase64, 'base64').toString('utf8');
                    created.push({
                        id,
                        type: 'patch_approval',
                        title: 'Применить patch',
                        detail: patch.slice(0, 4000),
                        status: 'pending',
                        timestamp: Date.now(),
                        threadId,
                        actionable: true,
                        filePath: payload.path,
                        patchBase64: payload.patchBase64,
                        diff: patch
                    });
                } else if (kind === 'read-file' && typeof payload.path === 'string') {
                    toolResults.push(this.readFileToolResult(payload.path));
                } else if (kind === 'show-diagnostics') {
                    toolResults.push(this.diagnosticsToolResult());
                }
            } catch (err) {
                console.warn('[RemoteCodeOnPC] Failed to parse action directive:', err);
            }
        }
        if (toolResults.length > 0) {
            this.appendToolResultMessage(toolResults.join('\n\n'), threadId);
        }
        if (created.length === 0) return;
        this.codexActionEvents = this.codexActionEvents.concat(created).slice(-250);
        this.saveRemoteCodeState();
        this.refreshPcChatPanel();
        for (const event of created) {
            this.broadcast({
                type: 'codex:approval-request',
                threadId,
                event,
                events: this.getActionEventsForThread(threadId),
                timestamp: Date.now()
            });
            if (this.shouldAutoApproveAction(event)) {
                void this.applyActionResponse(event.id, true);
            }
        }
    }

    private shouldAutoApproveAction(event: RemoteCodeActionEvent): boolean {
        // Shell strings are hard to prove safe across cmd, PowerShell, and Git aliases.
        // Keep the fast profile fast in prompting, but require an explicit tap to run.
        return false;
    }

    private isSafeReadOnlyCommand(command: string): boolean {
        const normalized = command
            .trim()
            .replace(/^cmd\s+\/c\s+/i, '')
            .replace(/^powershell(?:\.exe)?\s+(-command\s+)?/i, '')
            .trim();
        if (!normalized) return false;
        const lower = normalized.toLowerCase();
        if (/[\r\n;&|`<>]/.test(lower)) return false;
        if (/\b(start|invoke-expression|iex|curl|wget|ssh|scp|sftp|ftp|pwsh|powershell|cmd|bash|wsl)\b/i.test(lower)) return false;
        if (/\s--output(?:=|\s)|\s-o\s/i.test(lower)) return false;
        if (/\b(del|erase|rd|rmdir|rm|remove-item|move|mv|copy|cp|set-content|add-content|out-file|new-item|mkdir|ni|git\s+(?:add|commit|push|pull|reset|checkout|switch|merge|rebase|clean|apply)|npm\s+(?:install|i|update|run)|pnpm|yarn|pip|python|node)\b/i.test(lower)) {
            return false;
        }
        return /^(dir(?:\s+[\w./\\:-]+)?|ls(?:\s+[\w./\\:-]+)?|pwd|cd(?:\s+[\w./\\:-]+)?|git\s+(status|diff|log|show|branch)(?:\s+[\w./\\:-]+)?|type\s+[\w./\\:-]+|cat\s+[\w./\\:-]+|get-content\s+[\w./\\:-]+)$/i.test(lower);
    }

    private stripActionDirectives(content: string): string {
        return content
            .replace(/::run-command\{[^\n]+\}/g, '')
            .replace(/::write-file\{[^\n]+\}/g, '')
            .replace(/::apply-patch\{[^\n]+\}/g, '')
            .replace(/::read-file\{[^\n]+\}/g, '')
            .replace(/::show-diagnostics\{[^\n]*\}/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim() || 'Запросил данные у VS Code. Результат ниже.';
    }

    private appendToolResultMessage(content: string, threadId: string): void {
        const message: CodexChatMessage = {
            id: `tool_result_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            role: 'assistant',
            content: content.slice(0, 9000),
            timestamp: Date.now(),
            threadId
        };
        this.codexHistory.push(message);
        this.codexHistory = this.codexHistory.slice(-200);
        this.saveRemoteCodeState();
        this.refreshPcChatPanel();
        this.broadcast({ type: 'codex:message', message, threadId, timestamp: Date.now() });
    }

    private readFileToolResult(filePath: string): string {
        const resolved = this.resolveWorkspaceFilePath(filePath);
        if (!resolved) {
            const baseName = path.basename(filePath);
            const matches = baseName ? this.findWorkspaceFilesByBasename(baseName, 8) : [];
            const hints = matches.length > 0
                ? matches.map(match => `- ${match}`).join('\n')
                : this.getWorkspaceFileHints(35).split('\n').map(hint => `- ${hint}`).join('\n');
            return [
                `read-file failed: file not found: ${filePath}`,
                'Use an existing path from the workspace. Current project file hints:',
                hints,
                'For this project, the VS Code Remote Code chat UI is currently implemented in extension/src/server.ts.'
            ].join('\n');
        }
        const finalPath = resolved.path;
        const stat = fs.statSync(finalPath);
        if (!stat.isFile()) {
            return `read-file failed: not a file: ${finalPath}`;
        }
        const maxBytes = 160_000;
        const content = fs.readFileSync(finalPath, 'utf8');
        const clipped = content.length > maxBytes ? `${content.slice(0, maxBytes)}\n\n... truncated ...` : content;
        const note = resolved.note ? `\nResolved from requested path: ${filePath}` : '';
        return `read-file result: ${finalPath}${note}\n\n${clipped}`;
    }

    private resolveWorkspaceFilePath(filePath: string): { path: string; note?: string } | undefined {
        const roots = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath).filter(folder => fs.existsSync(folder)) || [];
        const candidates: string[] = [];
        if (path.isAbsolute(filePath)) {
            candidates.push(filePath);
        } else {
            for (const root of roots) {
                candidates.push(path.join(root, filePath));
            }
            candidates.push(path.resolve(filePath));
        }

        for (const candidate of candidates) {
            try {
                if (
                    roots.some(root => this.isInsideWorkspaceRoot(candidate, root)) &&
                    fs.existsSync(candidate) &&
                    fs.statSync(candidate).isFile()
                ) {
                    return { path: candidate };
                }
            } catch {
                // Continue with other candidates.
            }
        }

        const normalizedSuffix = filePath.replace(/[\\/]+/g, '/').replace(/^\.\//, '').toLowerCase();
        const baseName = path.basename(filePath);
        if (!baseName) return undefined;
        const matches = this.findWorkspaceFilesByBasename(baseName, 16);
        const suffixMatch = matches.find(match => match.replace(/[\\/]+/g, '/').toLowerCase().endsWith(normalizedSuffix));
        if (suffixMatch) return { path: suffixMatch, note: 'suffix-match' };
        if (matches.length === 1) return { path: matches[0], note: 'basename-match' };
        return undefined;
    }

    private findWorkspaceFilesByBasename(fileName: string, limit = 12): string[] {
        const roots = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath).filter(folder => fs.existsSync(folder)) || [];
        const matches: string[] = [];
        const target = fileName.toLowerCase();
        const walk = (dir: string, depth: number): void => {
            if (matches.length >= limit || depth > 7) return;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                if (matches.length >= limit) return;
                if (this.shouldSkipWorkspaceEntry(entry.name)) continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath, depth + 1);
                } else if (entry.isFile() && entry.name.toLowerCase() === target) {
                    matches.push(fullPath);
                }
            }
        };
        for (const root of roots) {
            walk(root, 0);
            if (matches.length >= limit) break;
        }
        return matches;
    }

    private diagnosticsToolResult(): string {
        const diagnostics = vscode.languages.getDiagnostics()
            .flatMap(([uri, items]) => items.map(item => ({
                file: uri.fsPath,
                line: item.range.start.line + 1,
                column: item.range.start.character + 1,
                severity: vscode.DiagnosticSeverity[item.severity] || 'Unknown',
                message: item.message
            })))
            .slice(0, 80);
        if (diagnostics.length === 0) {
            return 'diagnostics result: no current VS Code diagnostics.';
        }
        return `diagnostics result:\n${diagnostics.map(item =>
            `${item.file}:${item.line}:${item.column} [${item.severity}] ${item.message}`
        ).join('\n')}`;
    }

    private createSimpleDiff(filePath: string, before: string, after: string): string {
        const beforeLines = before.split(/\r?\n/);
        const afterLines = after.split(/\r?\n/);
        const out = [`--- ${filePath}`, `+++ ${filePath}`];
        const max = Math.max(beforeLines.length, afterLines.length);
        for (let i = 0; i < max; i++) {
            if (beforeLines[i] === afterLines[i]) {
                if (beforeLines[i] !== undefined) out.push(` ${beforeLines[i]}`);
            } else {
                if (beforeLines[i] !== undefined) out.push(`-${beforeLines[i]}`);
                if (afterLines[i] !== undefined) out.push(`+${afterLines[i]}`);
            }
            if (out.length > 240) {
                out.push('... diff truncated ...');
                break;
            }
        }
        return out.join('\n');
    }

    private getActionEventsForThread(threadId?: string): RemoteCodeActionEvent[] {
        const target = threadId || this.currentRemoteThreadId;
        const localEvents = this.codexActionEvents
            .filter(event => !target || event.threadId === target);
        const externalEvents = this.getExternalCodexActionEventsForThread(target);
        const byId = new Map<string, RemoteCodeActionEvent>();
        for (const event of [...localEvents, ...externalEvents]) {
            byId.set(event.id, event);
        }
        return Array.from(byId.values())
            .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
            .slice(-160);
    }

    private getExternalCodexActionEventsForThread(threadId?: string): RemoteCodeActionEvent[] {
        const target = threadId || this.currentRemoteThreadId;
        const fileId = target ? this.fromCodexThreadId(target) : undefined;
        if (!target || !fileId) return [];
        const filePath = this.findCodexSessionFile(fileId);
        if (!filePath) return [];

        try {
            const lines = this.readUtf8FileTailLines(filePath, 16 * 1024 * 1024).slice(-6000);
            const events = new Map<string, RemoteCodeActionEvent>();
            let reasoningIndex = 0;
            let commentaryIndex = 0;
            const seenCommentary = new Set<string>();
            let currentTurnStartedAt = 0;
            let currentTurnEndedAt = 0;
            let currentTurnHasFinalAnswer = false;
            const currentTurnCommandCallIds = new Set<string>();
            const currentTurnCompletedCommandCallIds = new Set<string>();

            for (const line of lines) {
                let item: any;
                try { item = JSON.parse(line); } catch { continue; }
                const payload = item.payload || {};
                const itemTime = Math.round(item.timestamp ? new Date(item.timestamp).getTime() : Date.now());
                const startsUserTurn = this.isExternalCodexUserTurnStart(item, payload);
                if (startsUserTurn) {
                    currentTurnStartedAt = itemTime;
                    currentTurnEndedAt = itemTime;
                    currentTurnHasFinalAnswer = false;
                    currentTurnCommandCallIds.clear();
                    currentTurnCompletedCommandCallIds.clear();
                }
                const isCurrentTurnActivity = currentTurnStartedAt > 0
                    && itemTime >= currentTurnStartedAt
                    && this.isExternalCodexWorkActivity(item, payload);
                if (isCurrentTurnActivity) {
                    currentTurnEndedAt = Math.max(currentTurnEndedAt, itemTime);
                    if (this.isExternalCodexFinalAnswer(item, payload)) {
                        currentTurnHasFinalAnswer = true;
                    }
                }

                const commentary = this.extractPublicCodexProgressMessage(item, payload);
                if (commentary) {
                    const dedupeKey = commentary.replace(/\s+/g, ' ').trim();
                    if (!seenCommentary.has(dedupeKey)) {
                        seenCommentary.add(dedupeKey);
                        const id = `codex_external_commentary_${itemTime}_${commentaryIndex++}`;
                        events.set(id, {
                            id,
                            type: 'model_progress',
                            title: 'Статус Codex',
                            detail: commentary,
                            status: 'completed',
                            timestamp: itemTime,
                            threadId: target,
                            actionable: false
                        });
                    }
                    continue;
                }

                if (item.type === 'response_item' && payload.type === 'reasoning') {
                    const id = `codex_external_reasoning_${itemTime}_${reasoningIndex++}`;
                    events.set(id, {
                        id,
                        type: 'model_progress',
                        title: 'Модель думает',
                        detail: 'Анализирует задачу и выбирает следующий шаг',
                        status: 'completed',
                        timestamp: itemTime,
                        threadId: target,
                        actionable: false
                    });
                    continue;
                }

                if (item.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call')) {
                    const callId = payload.call_id || payload.id || `${payload.name || 'tool'}_${itemTime}_${events.size}`;
                    const id = `codex_external_${callId}`;
                    const info = this.describeExternalCodexToolCall(payload);
                    if (isCurrentTurnActivity && this.isCommandTimelineEvent({ type: info.type } as RemoteCodeActionEvent)) {
                        currentTurnCommandCallIds.add(callId);
                    }
                    events.set(id, {
                        id,
                        type: info.type,
                        title: info.title,
                        detail: info.detail,
                        status: 'running',
                        timestamp: itemTime,
                        threadId: target,
                        actionable: false,
                        command: info.command,
                        cwd: info.cwd,
                        filePath: info.filePath
                    });
                    continue;
                }

                if (item.type === 'response_item' && (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output')) {
                    const callId = payload.call_id || payload.id;
                    if (!callId) continue;
                    const id = `codex_external_${callId}`;
                    const existing = events.get(id);
                    const output = this.compactExternalCodexToolOutput(payload);
                    if (isCurrentTurnActivity && (currentTurnCommandCallIds.has(callId) || /^Exit code:/i.test(output))) {
                        currentTurnCompletedCommandCallIds.add(callId);
                    }
                    events.set(id, {
                        ...(existing || {
                            id,
                            type: 'tool_call',
                            title: 'Инструмент',
                            detail: 'Внешнее действие завершено',
                            threadId: target,
                            actionable: false
                        } as RemoteCodeActionEvent),
                        status: this.externalToolOutputFailed(payload, output) ? 'failed' : 'completed',
                        timestamp: itemTime,
                        stdout: output
                    });
                    continue;
                }

                if (item.type === 'event_msg' && (payload.type === 'patch_apply_begin' || payload.type === 'patch_apply_end')) {
                    const id = `codex_external_patch_${payload.call_id || itemTime}`;
                    const existing = events.get(id);
                    events.set(id, {
                        ...(existing || {
                            id,
                            type: 'patch_apply',
                            title: 'Правка файлов',
                            detail: 'Применение patch',
                            threadId: target,
                            actionable: false
                        } as RemoteCodeActionEvent),
                        status: payload.type === 'patch_apply_begin'
                            ? 'running'
                            : (payload.success === false ? 'failed' : 'completed'),
                        timestamp: itemTime
                    });
                }
            }

            const summaryEvent = this.buildExternalCodexWorkSummaryEvent(
                target,
                currentTurnStartedAt,
                currentTurnEndedAt,
                currentTurnCompletedCommandCallIds.size,
                !currentTurnHasFinalAnswer
            );
            if (summaryEvent) {
                events.set(summaryEvent.id, summaryEvent);
            }

            return Array.from(events.values()).slice(-160);
        } catch {
            return [];
        }
    }

    private readUtf8FileTailLines(filePath: string, maxBytes: number): string[] {
        const stat = fs.statSync(filePath);
        const size = Math.max(0, Number(stat.size || 0));
        const start = Math.max(0, size - maxBytes);
        const length = Math.max(0, size - start);
        if (length === 0) return [];

        const fd = fs.openSync(filePath, 'r');
        try {
            const buffer = Buffer.alloc(length);
            const bytesRead = fs.readSync(fd, buffer, 0, length, start);
            const text = buffer.toString('utf8', 0, bytesRead);
            const lines = text.split(/\r?\n/).filter(Boolean);
            if (start > 0 && lines.length > 0) lines.shift();
            return lines;
        } finally {
            fs.closeSync(fd);
        }
    }

    private isExternalCodexUserTurnStart(item: any, payload: any): boolean {
        return (item.type === 'event_msg' && payload.type === 'user_message')
            || (item.type === 'response_item' && payload.type === 'message' && payload.role === 'user');
    }

    private isExternalCodexWorkActivity(item: any, payload: any): boolean {
        if (item.type === 'event_msg' && payload.type === 'token_count') return false;
        if (item.type === 'session_meta' || item.type === 'turn_context') return false;
        return true;
    }

    private isExternalCodexFinalAnswer(item: any, payload: any): boolean {
        const phase = typeof payload?.phase === 'string' ? payload.phase.toLowerCase() : '';
        return (item.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant' && (phase === 'final_answer' || phase === 'final'))
            || (item.type === 'event_msg' && payload.type === 'task_complete');
    }

    private buildExternalCodexWorkSummaryEvent(
        threadId: string,
        startedAt: number,
        endedAt: number,
        completedCommandCount: number,
        isRunning: boolean
    ): RemoteCodeActionEvent | undefined {
        if (!Number.isFinite(startedAt) || startedAt <= 0) return undefined;
        const completedAt = Number.isFinite(endedAt) && endedAt >= startedAt ? endedAt : startedAt;
        const id = `codex_external_work_summary_${startedAt}`;
        return {
            id,
            type: 'work_summary',
            title: 'Итоги работы Codex',
            detail: this.actionTimelineSummaryFromDuration(completedAt - startedAt, completedCommandCount, isRunning),
            status: isRunning ? 'running' : 'completed',
            timestamp: completedAt,
            threadId,
            actionable: false,
            startedAt,
            completedAt,
            completedCommandCount
        };
    }

    private extractPublicCodexProgressMessage(item: any, payload: any): string {
        const phase = typeof payload?.phase === 'string' ? payload.phase.toLowerCase() : '';
        if (phase !== 'commentary') return '';
        let content = '';
        if (item.type === 'event_msg' && payload.type === 'agent_message') {
            content = String(payload.message || '');
        } else if (item.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
            content = this.extractResponseItemContent(payload);
        }
        return this.sanitizeActionText(this.cleanCodexMessage(content)).slice(0, 700);
    }

    private describeExternalCodexToolCall(payload: any): {
        type: string;
        title: string;
        detail: string;
        command?: string;
        cwd?: string;
        filePath?: string;
    } {
        const name = String(payload?.name || payload?.tool_name || payload?.type || 'tool');
        const args = this.parseExternalCodexToolArguments(payload?.arguments ?? payload?.input);
        const rawArgs = typeof payload?.arguments === 'string'
            ? payload.arguments
            : (typeof payload?.input === 'string' ? payload.input : JSON.stringify(args || {}));
        const lowerName = name.toLowerCase();

        if (lowerName.includes('shell') || lowerName.includes('terminal') || lowerName.includes('exec')) {
            const command = this.sanitizeActionText(String(args?.command || args?.cmd || rawArgs || name));
            return {
                type: 'command_approval',
                title: 'Команда',
                detail: command,
                command,
                cwd: this.sanitizeActionText(String(args?.workdir || args?.cwd || ''))
            };
        }

        if (lowerName.includes('apply_patch') || rawArgs.includes('*** Begin Patch')) {
            const files: string[] = [];
            for (const match of String(rawArgs).matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\r\n]+)/g)) {
                files.push(match[1].trim());
                if (files.length >= 4) break;
            }
            return {
                type: 'patch_apply',
                title: 'Правка файлов',
                detail: files.length > 0 ? files.join(', ') : 'Применение patch'
            };
        }

        if (lowerName.includes('multi_tool')) {
            const toolUses = Array.isArray(args?.tool_uses) ? args.tool_uses : [];
            const labels = toolUses
                .map((tool: any) => String(tool?.recipient_name || '').split('.').pop())
                .filter(Boolean)
                .slice(0, 4);
            return {
                type: 'tool_call',
                title: 'Параллельные действия',
                detail: this.sanitizeActionText(labels.length > 0 ? labels.join(', ') : 'Несколько проверок одновременно')
            };
        }

        if (lowerName.includes('view_image')) {
            const filePath = this.sanitizeActionText(String(args?.path || ''));
            return {
                type: 'file_view',
                title: 'Просмотр изображения',
                detail: filePath || name,
                filePath
            };
        }

        if (lowerName.includes('browser') || lowerName.includes('screenshot')) {
            return {
                type: 'tool_call',
                title: 'Проверка интерфейса',
                detail: this.sanitizeActionText(String(args?.url || args?.target || name))
            };
        }

        const detail = this.sanitizeActionText(String(args?.title || args?.description || args?.path || name));
        return {
            type: 'tool_call',
            title: this.humanizeExternalCodexToolName(name),
            detail
        };
    }

    private parseExternalCodexToolArguments(value: any): any {
        if (!value) return {};
        if (typeof value !== 'string') return value;
        try {
            return JSON.parse(value);
        } catch {
            return {};
        }
    }

    private compactExternalCodexToolOutput(payload: any): string {
        const raw = typeof payload?.output === 'string'
            ? payload.output
            : (typeof payload?.content === 'string' ? payload.content : '');
        return this.sanitizeActionText(raw.replace(/\s+$/g, '').slice(0, 1800));
    }

    private externalToolOutputFailed(payload: any, output: string): boolean {
        const status = String(payload?.status || '').toLowerCase();
        return status === 'failed' || status === 'error' || /\b(exit code|error)\s*[:=]\s*[1-9]\d*/i.test(output);
    }

    private sanitizeActionText(value: string): string {
        return value
            .replace(/(Authorization:\s*Bearer\s+)[^\s"']+/gi, '$1***')
            .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
            .replace(/((?:authToken|token|password)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1***')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private humanizeExternalCodexToolName(name: string): string {
        const compact = name.replace(/^functions\./, '').replace(/[_-]+/g, ' ').trim();
        return compact ? compact[0].toUpperCase() + compact.slice(1) : 'Инструмент';
    }

    private upsertActionEvent(event: RemoteCodeActionEvent, refresh = true): void {
        const index = this.codexActionEvents.findIndex(item => item.id === event.id);
        if (index >= 0) {
            this.codexActionEvents = this.codexActionEvents.map(item => item.id === event.id ? event : item);
        } else {
            this.codexActionEvents = this.codexActionEvents.concat(event);
        }
        this.codexActionEvents = this.codexActionEvents.slice(-250);
        this.saveRemoteCodeState();
        if (refresh) this.refreshPcChatPanel();
        this.broadcastActionUpdate(event);
    }

    private upsertProgressEvent(
        threadId: string,
        id: string,
        title: string,
        detail: string,
        status: RemoteCodeActionEvent['status']
    ): RemoteCodeActionEvent {
        const existing = this.codexActionEvents.find(event => event.id === id);
        const event: RemoteCodeActionEvent = {
            ...(existing || {
                type: 'model_progress',
                actionable: false,
                threadId
            } as RemoteCodeActionEvent),
            id,
            type: 'model_progress',
            title,
            detail,
            status,
            timestamp: Date.now(),
            threadId,
            actionable: false
        };
        this.upsertActionEvent(event);
        return event;
    }

    private getCurrentThreadTitle(): string {
        const summary = this.getRemoteCodeThreads().find(thread => thread.id === this.currentRemoteThreadId);
        const summaryTitle = this.cleanThreadTitle(summary?.title);
        if (summaryTitle && !this.isUntitledRemoteThread(summaryTitle)) return summaryTitle;
        const firstUserMessage = this.codexHistory.find(message =>
            (message.threadId || this.currentRemoteThreadId) === this.currentRemoteThreadId &&
            message.role === 'user' &&
            message.content.trim()
        );
        return this.pickThreadTitle(firstUserMessage?.content, summaryTitle, 'Новый чат');
    }

    private getGitBranchLabel(): string {
        try {
            const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!folder) return 'нет ветки';
            const branch = execSync('git branch --show-current', {
                cwd: folder,
                encoding: 'utf8',
                timeout: 1500,
                windowsHide: true
            }).trim();
            return branch || 'detached';
        } catch {
            return 'нет ветки';
        }
    }

    private formatThreadAge(timestamp: number): string {
        const value = Number.isFinite(timestamp) ? timestamp : Date.now();
        const diffMs = Math.max(0, Date.now() - value);
        const minute = 60_000;
        const hour = 60 * minute;
        const day = 24 * hour;
        if (diffMs < minute) return 'сейчас';
        if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}м`;
        if (diffMs < day) return `${Math.max(1, Math.round(diffMs / hour))}ч`;
        return `${Math.max(1, Math.round(diffMs / day))}д`;
    }

    private renderPcChatHtml(messages: CodexChatMessage[], actions: RemoteCodeActionEvent[] = []): string {
        const modelOptions = this.getDefaultCodexModels();
        const selectedModel = modelOptions.some(model => model.id === this.selectedAgent) ? this.selectedAgent : 'gpt-5.5';
        const branchLabel = this.getGitBranchLabel();
        const title = this.getCurrentThreadTitle();
        const threadOptions = this.getRemoteCodeThreads();
        const isBusy = !!this.activeChatCancellation && !this.activeChatCancellation.token.isCancellationRequested;
        const isPinned = this.pinnedThreadIds.has(this.currentRemoteThreadId);
        const apkMetadata = this.getAppApkMetadata();
        const versionChipLabel = this.versionChipLabel(apkMetadata);
        const versionChipTitle = this.versionChipTitle(apkMetadata);
        const liveChipLabel = this.liveChipLabel(isBusy);
        const liveChipTitle = this.liveChipTitle(isBusy);
        const effortOptions = [
            { id: 'low', name: 'Низкий' },
            { id: 'medium', name: 'Средний' },
            { id: 'high', name: 'Высокий' },
            { id: 'xhigh', name: 'Очень высокий' }
        ];
        const profileOptions = [
            { id: 'fast', name: 'Быстрый режим' },
            { id: 'review', name: 'Проверка' },
            { id: 'user', name: 'Пользовательские' }
        ];
        const selectedEffort = effortOptions.some(option => option.id === this.selectedReasoningEffort)
            ? this.selectedReasoningEffort
            : 'medium';
        const icon = {
            edit: this.webIcon('edit'),
            more: this.webIcon('more'),
            search: this.webIcon('search'),
            extensions: this.webIcon('extensions'),
            command: this.webIcon('command'),
            pin: this.webIcon('pin'),
            archive: this.webIcon('archive'),
            external: this.webIcon('external'),
            play: this.webIcon('play'),
            terminal: this.webIcon('terminal'),
            trash: this.webIcon('trash'),
            settings: this.webIcon('settings'),
            plus: this.webIcon('plus'),
            chevron: this.webIcon('chevronDown'),
            send: this.webIcon('send'),
            stop: this.webIcon('stop'),
            sparkle: this.webIcon('sparkle'),
            branch: this.webIcon('branch'),
            folder: this.webIcon('folder'),
            laptop: this.webIcon('laptop'),
            globe: this.webIcon('globe'),
            lock: this.webIcon('lock'),
            copy: this.webIcon('copy'),
            qr: this.webIcon('qr'),
            up: this.webIcon('thumbUp'),
            down: this.webIcon('thumbDown'),
            scrollDown: this.webIcon('scrollDown'),
            layout: this.webIcon('panel'),
            panel: this.webIcon('panel'),
            vscode: '<svg class="vscode-icon" viewBox="0 0 24 24"><path d="M17.8 3 8.4 12l9.4 9 2.2-.9V3.9Z"/><path d="m8.4 12-4 3.2L2.5 14 6.4 12 2.5 10 4.4 8.8Z"/></svg>'
        };
        const projectOptions = this.getRemoteCodeProjects(threadOptions);
        const currentProjectId = this.getCurrentRemoteCodeProjectId(threadOptions);
        const renderSidebarThreadRow = (thread: RemoteCodeThreadSummary) => {
            const selected = thread.id === this.currentRemoteThreadId;
            const pinned = this.pinnedThreadIds.has(thread.id);
            const age = this.formatThreadAge(thread.timestamp);
            const subtitle = this.getWorkspaceProjectName(thread.workspaceName, thread.workspacePath);
            return `<div class="sidebar-thread ${selected ? 'selected' : ''}">
                <button class="sidebar-thread-btn" type="button" data-thread-id="${this.escapeHtml(thread.id)}" title="${this.escapeHtml(thread.title)}">
                    <span class="sidebar-thread-main">
                        <span class="sidebar-thread-title">${pinned ? '• ' : ''}${this.escapeHtml(thread.title)}</span>
                        <span class="sidebar-thread-age">${this.escapeHtml(age)}</span>
                    </span>
                    <span class="sidebar-thread-subtitle">${this.escapeHtml(subtitle)}</span>
                </button>
                <button class="sidebar-thread-delete" type="button" data-delete-thread-id="${this.escapeHtml(thread.id)}" title="Удалить чат">${icon.trash}</button>
            </div>`;
        };
        const sidebarProjectRows = projectOptions.map(project => {
            const selected = project.id === currentProjectId;
            const latestThread = project.threads[0];
            const mainAttrs = latestThread
                ? `data-thread-id="${this.escapeHtml(latestThread.id)}"`
                : (project.path ? `data-action="openWorkspace" data-path="${this.escapeHtml(project.path)}"` : '');
            const threadRows = project.threads.map(renderSidebarThreadRow).join('');
            return `<section class="sidebar-project-group ${selected ? 'selected' : ''}">
                <div class="sidebar-project ${project.active ? 'active' : ''}">
                    <button class="sidebar-project-btn" type="button" ${mainAttrs} title="${this.escapeHtml(project.path || project.name)}">
                        ${icon.folder}
                        <span class="sidebar-project-text"><span>${this.escapeHtml(project.name)}</span></span>
                    </button>
                    ${project.path ? `<button class="sidebar-project-open" type="button" data-action="openWorkspace" data-path="${this.escapeHtml(project.path)}" title="Открыть проект">${icon.external}</button>` : ''}
                </div>
                <div class="sidebar-project-threads">${threadRows || '<div class="sidebar-empty compact">Нет чатов в проекте</div>'}</div>
            </section>`;
        }).join('');
        const threadMenuRows = projectOptions.map(project => {
            const rows = project.threads.map(thread => `<div class="thread-row ${thread.id === this.currentRemoteThreadId ? 'selected' : ''}">
                <button class="thread-item" type="button" data-thread-id="${this.escapeHtml(thread.id)}">${this.escapeHtml(thread.title)}<small>${this.escapeHtml(thread.source === 'codex' ? 'Codex' : 'Remote Code')} · ${this.escapeHtml(new Date(thread.timestamp || Date.now()).toLocaleString())}</small></button>
                <button class="thread-delete" type="button" data-delete-thread-id="${this.escapeHtml(thread.id)}" title="Удалить чат">${icon.trash}</button>
            </div>`).join('');
            if (!rows) return '';
            return `<div class="thread-menu-project">
                <div class="thread-menu-project-title">${icon.folder}<span>${this.escapeHtml(project.name)}</span></div>
                ${rows}
            </div>`;
        }).join('');
        const sidebarHtml = `<aside class="wide-sidebar" aria-label="Навигация Codex">
            <div class="sidebar-actions">
                <button class="sidebar-action" type="button" data-action="newChat">${icon.edit}<span>Новый чат</span></button>
                <button class="sidebar-action" type="button" data-action="openSearch">${icon.search}<span>Поиск</span></button>
                <button class="sidebar-action" type="button" data-action="openPlugins">${icon.extensions}<span>Плагины</span></button>
                <button class="sidebar-action" type="button" data-action="openAutomations">${this.webIcon('clock')}<span>Автоматизации</span></button>
            </div>
            <div class="sidebar-section-title">Проекты</div>
            <div class="sidebar-projects">${sidebarProjectRows || '<div class="sidebar-empty">Нет проектов с чатами</div>'}</div>
            <div class="sidebar-bottom">
                <button class="sidebar-action" type="button" data-action="openSettings">${icon.settings}<span>Настройки</span></button>
            </div>
        </aside>`;
        const visibleMessages = messages.filter(message => !this.isActionResultMessage(message));
        const actionTimelineRows = this.renderActionTimeline(actions);
        const timelineInsertIndex = actionTimelineRows
            ? Math.max(visibleMessages.map(message => message.role).lastIndexOf('assistant'), 0)
            : -1;
        const rows = visibleMessages.map((message, index) => {
            const role = message.role === 'system' ? 'Система' : '';
            const cls = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system';
            const meta = [message.model, message.reasoningEffort ? this.reasoningEffortLabel(message.reasoningEffort) : '']
                .filter(Boolean)
                .join(' - ');
            const content = this.renderMessageContent(message.content, message.changeSummary);
            const attachments = this.renderMessageAttachments(message.attachments);
            const userMessageTools = message.role === 'user'
                ? `<button type="button" class="hover-btn message-tool" data-message-action="edit" title="Редактировать">${icon.edit}</button>`
                : '';
            const assistantMessageTools = message.role === 'assistant'
                ? `<button type="button" class="hover-btn message-tool" data-message-action="regenerate" title="Повторить ответ">${this.webIcon('undo')}</button>
                    <button type="button" class="hover-btn message-tool" data-message-action="up" title="&#1061;&#1086;&#1088;&#1086;&#1096;&#1080;&#1081; &#1086;&#1090;&#1074;&#1077;&#1090;">${icon.up}</button>
                    <button type="button" class="hover-btn message-tool" data-message-action="down" title="&#1055;&#1083;&#1086;&#1093;&#1086;&#1081; &#1086;&#1090;&#1074;&#1077;&#1090;">${icon.down}</button>`
                : '';
            const row = `<section class="msg ${cls} ${message.isStreaming ? 'streaming' : ''}" data-message-id="${this.escapeHtml(message.id)}">
                ${role ? `<div class="role">${this.escapeHtml(role)}</div>` : ''}
                <div class="message-text">${content}</div>
                ${attachments}
                ${message.role === 'assistant' && meta ? `<div class="meta meta-bottom">${this.escapeHtml(meta)}</div>` : ''}
                <div class="msg-tools">
                    ${userMessageTools}
                    <button type="button" class="hover-btn message-tool" data-message-action="copy" title="&#1050;&#1086;&#1087;&#1080;&#1088;&#1086;&#1074;&#1072;&#1090;&#1100;">${icon.copy}</button>
                    ${assistantMessageTools}
                    <button type="button" class="hover-btn message-tool danger" data-message-action="delete" title="Удалить сообщение">${icon.trash}</button>
                </div>
            </section>`;
            return index === timelineInsertIndex ? `${actionTimelineRows}${row}` : row;
        }).join('');
        const actionRows = actions.filter(event => event.actionable && event.status === 'pending').map(event => {
            const resolved = !event.actionable && event.status !== 'running' && event.status !== 'pending';
            const body = this.escapeHtml(event.detail || event.diff || '');
            return `<section class="action ${this.escapeHtml(event.status)} ${resolved ? 'resolved collapsed' : ''}" data-action-event-id="${this.escapeHtml(event.id)}">
            <div class="action-head">
                <strong>${this.escapeHtml(event.title)}</strong>
                <span class="action-status">${this.escapeHtml(event.status)}</span>
                ${resolved ? `<button type="button" class="action-toggle" data-action-toggle="${this.escapeHtml(event.id)}">Показать</button><button type="button" class="action-dismiss" data-dismiss-action-id="${this.escapeHtml(event.id)}" title="Убрать">${this.webIcon('x')}</button>` : ''}
            </div>
            <pre>${body}</pre>
            ${event.actionable && event.status === 'pending' ? `<div class="action-buttons">
                <button type="button" data-action-id="${this.escapeHtml(event.id)}" data-decision="deny">Отклонить</button>
                <button type="button" data-action-id="${this.escapeHtml(event.id)}" data-decision="approve">Разрешить</button>
            </div>` : ''}
        </section>`;
        }).join('');
        const progressPanel = this.renderProgressPanel(messages, actions, isBusy, branchLabel);
        return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<style>
html,body{height:100%}
:root{--codex-bg:#181818;--codex-sidebar:#17191d;--codex-sidebar-2:#1c1d22;--codex-surface:#242424;--codex-surface-2:#2b2b2b;--codex-selected:#303039;--codex-chip:#232323;--codex-border:#2d2d32;--codex-strong-border:#37373c;--codex-text:#d8d8d8;--codex-bright:#f5f5f5;--codex-muted:#96999a;--codex-green:#50cf8e;--codex-red:#ee7070;--codex-blue:#5aa7ff;--codex-font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;--codex-mono:var(--vscode-editor-font-family,"Cascadia Mono",Consolas,monospace);--chat-max:850px;--composer-max:880px;--bubble-max:680px}
body{margin:0;background:var(--codex-bg);color:var(--codex-text);font:13px/1.46 var(--codex-font);display:flex;flex-direction:column;letter-spacing:0;-webkit-font-smoothing:antialiased}
button{font:inherit}
svg{width:15px;height:15px;display:block;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;shape-rendering:geometricPrecision}
.top{height:44px;border-bottom:1px solid var(--codex-border);background:var(--codex-bg);display:flex;align-items:center;gap:7px;padding:0 min(3vw,30px)}
.edit-icon{color:#a5a6a8}
.thread-title{font-size:13px;color:var(--codex-bright);font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:660px;line-height:1.2}
.toolbar-spacer{flex:1}
.version-chip,.live-chip{height:26px;border:1px solid var(--codex-border);background:transparent;color:#8f9297;border-radius:999px;padding:0 9px;font-size:11.5px;line-height:1;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;cursor:pointer}
.version-chip:hover,.live-chip:hover{background:var(--codex-surface);color:#d8d8d8}
.live-chip::before{content:'';width:7px;height:7px;border-radius:999px;background:var(--codex-green);box-shadow:0 0 0 3px rgba(80,207,142,.14);flex:0 0 auto}
.live-chip.busy::before{animation:pulse 1.1s ease-in-out infinite}
.icon-btn{width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:#9ea0a4;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.icon-btn svg{width:16px;height:16px;stroke-width:1.65}
.icon-btn:hover,.icon-btn.active{background:var(--codex-surface);color:var(--codex-bright)}
.progress-toggle.active{box-shadow:inset 0 0 0 1px var(--codex-strong-border)}
.thread-menu-wrap{position:relative;min-width:0;display:flex;align-items:center;gap:7px}
.thread-menu-btn{border:0;background:transparent;color:var(--codex-bright);display:flex;align-items:center;gap:6px;min-width:0;max-width:680px;cursor:pointer;border-radius:8px;padding:5px 6px}
.thread-menu-btn:hover,.thread-menu-wrap.open .thread-menu-btn{background:var(--codex-surface)}
.thread-menu{display:none;position:absolute;left:0;top:36px;width:min(430px,74vw);max-height:360px;overflow:auto;background:var(--codex-surface);border:1px solid var(--codex-border);border-radius:10px;padding:6px;z-index:10;box-shadow:0 18px 44px rgba(0,0,0,.46)}
.thread-menu-wrap.open .thread-menu{display:block}
.top-menu-wrap{position:relative;display:inline-flex}
.top-menu,.toolbar-menu{display:none;position:absolute;right:0;top:34px;width:320px;background:var(--codex-surface);border:1px solid var(--codex-border);border-radius:10px;padding:6px;z-index:12;box-shadow:0 18px 44px rgba(0,0,0,.46)}
.top-menu-wrap.open .top-menu{display:block}
.connector-menu-wrap{position:relative;display:inline-flex}
.connector-menu-wrap.open .toolbar-menu{display:block}
.connector-btn{height:30px;border:1px solid var(--codex-border);background:var(--codex-bg);color:#d4d4d4;border-radius:10px;display:inline-flex;align-items:center;gap:7px;padding:0 9px;cursor:pointer}
.connector-btn:hover,.connector-menu-wrap.open .connector-btn{background:var(--codex-surface);color:var(--codex-bright)}
.connector-btn svg{width:15px;height:15px}
.connector-btn span{white-space:nowrap}
.vscode-icon path{fill:#7eb6ff;stroke:none}
.top-menu .item{font-size:12.5px}
.icon-item{display:flex;align-items:center;gap:9px}
.icon-item svg{width:15px;height:15px;flex:0 0 auto}
.menu-separator{height:1px;background:var(--codex-border);margin:6px 4px}
.thread-menu-project{display:flex;flex-direction:column;gap:2px;margin-bottom:6px}
.thread-menu-project-title{display:flex;align-items:center;gap:7px;color:#8f8f8f;font-size:11.5px;font-weight:600;padding:5px 8px 3px}
.thread-menu-project-title svg{width:13px;height:13px;flex:0 0 auto}
.thread-menu-project-title span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thread-row{display:flex;align-items:stretch;gap:4px;border-radius:8px;position:relative}
.thread-row:hover{background:#2a292e}
.thread-row.selected{background:var(--codex-selected);color:var(--codex-bright)}
.thread-row.selected::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:999px;background:var(--codex-blue)}
.thread-item{flex:1;min-width:0;border:0;background:transparent;color:var(--codex-text);text-align:left;border-radius:8px;padding:7px 10px 7px 12px;cursor:pointer;font-size:12.5px;line-height:1.25}
.thread-item small{display:block;color:var(--codex-muted);margin-top:3px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thread-delete{width:30px;border:0;background:transparent;color:#85878b;border-radius:7px;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.7}
.thread-delete svg{width:13px;height:13px}
.thread-row:hover .thread-delete{opacity:1}
.thread-delete:hover{background:#463033;color:#f2b0b0}
.content-shell{flex:1;min-height:0;display:flex;overflow:hidden}
.wide-sidebar{width:246px;flex:0 0 246px;background:var(--codex-sidebar);border-right:1px solid var(--codex-border);display:flex;flex-direction:column;min-height:0;color:#cfcfcf;padding:11px 10px 10px;box-sizing:border-box}
.sidebar-actions{display:flex;flex-direction:column;gap:2px;margin-bottom:18px}
.sidebar-action{width:100%;height:29px;border:0;background:transparent;color:#cfd0d2;border-radius:8px;display:flex;align-items:center;gap:9px;padding:0 9px;cursor:pointer;text-align:left;font:inherit;font-size:12.5px}
.sidebar-action:hover{background:rgba(255,255,255,.055);color:#fff}
.sidebar-action svg{width:15px;height:15px;flex:0 0 auto;color:#aeb0b4}
.sidebar-section-title{font-size:12px;color:#858585;margin:9px 8px 7px;display:flex;align-items:center;justify-content:space-between}
.sidebar-projects{display:flex;flex-direction:column;gap:4px;min-height:0;overflow:auto;padding-right:2px}
.sidebar-project-group{display:flex;flex-direction:column;gap:2px}
.sidebar-project{display:flex;align-items:center;border-radius:8px}
.sidebar-project.active,.sidebar-project-group.selected>.sidebar-project{background:var(--codex-selected)}
.sidebar-project-btn{flex:1;min-width:0;min-height:30px;border:0;background:transparent;color:#c9c9ca;border-radius:8px;display:flex;align-items:center;gap:8px;padding:3px 8px;cursor:pointer;text-align:left;font:inherit;font-size:12.5px}
.sidebar-project-btn:hover,.sidebar-project-open:hover{background:rgba(255,255,255,.055);color:#fff}
.sidebar-project-btn svg{width:15px;height:15px;color:#9fa1a5;flex:0 0 auto}
.sidebar-project-text{display:flex;flex-direction:column;min-width:0;line-height:1.2}
.sidebar-project-text span,.sidebar-project-text small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sidebar-project-text small{color:#85888e;font-size:11px;margin-top:2px;font-weight:400}
.sidebar-project-open{width:27px;height:27px;border:0;background:transparent;color:#85878b;border-radius:7px;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.55;padding:0;margin-right:3px}
.sidebar-project-open svg{width:13px;height:13px}
.sidebar-project:hover .sidebar-project-open{opacity:.9}
.sidebar-project-threads{display:flex;flex-direction:column;gap:2px;margin:1px 0 7px 18px}
.sidebar-thread{min-height:36px;display:flex;align-items:center;gap:2px;border-radius:8px;position:relative}
.sidebar-thread.selected{background:var(--codex-selected)}
.sidebar-thread.selected::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:999px;background:var(--codex-blue)}
.sidebar-thread-btn{flex:1;min-width:0;min-height:36px;border:0;background:transparent;color:#d8d8d8;border-radius:8px;display:flex;flex-direction:column;justify-content:center;gap:2px;padding:3px 7px 4px 10px;cursor:pointer;text-align:left;font:inherit;font-size:12.5px}
.sidebar-thread:not(.selected) .sidebar-thread-btn:hover{background:rgba(255,255,255,.05)}
.sidebar-thread-main{width:100%;display:flex;align-items:center;gap:8px;min-width:0}
.sidebar-thread-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sidebar-thread-age{color:#8b8d91;font-size:11.5px;flex:0 0 auto}
.sidebar-thread-subtitle{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#85888e;font-size:11px;line-height:1.2}
.sidebar-thread-delete{width:26px;height:26px;border:0;background:transparent;color:#7f8287;border-radius:7px;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:.35;padding:0;margin-right:3px}
.sidebar-thread-delete svg{width:13px;height:13px}
.sidebar-thread:hover .sidebar-thread-delete{opacity:.9}
.sidebar-thread-delete:hover{background:#473036;color:#f3b4b4}
.sidebar-mini-btn{width:24px;height:24px;border:0;background:transparent;color:#9fa1a5;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.sidebar-mini-btn:hover{background:rgba(255,255,255,.06);color:#fff}
.sidebar-mini-btn svg{width:14px;height:14px}
.sidebar-empty{font-size:12.5px;color:#777;padding:7px 10px}.sidebar-empty.compact{padding:3px 8px 6px;font-size:11.5px}
.sidebar-bottom{margin-top:auto;padding-top:10px;border-top:1px solid rgba(255,255,255,.055)}
.messages{flex:1;min-width:0;overflow:auto;padding:18px clamp(18px,4vw,70px) 138px;scrollbar-gutter:stable}
.progress-panel{display:none;width:240px;max-width:20vw;align-self:flex-start;margin:18px min(1vw,14px) 18px 0;background:rgba(36,36,36,.97);border:1px solid var(--codex-border);border-radius:8px;padding:12px;box-shadow:0 12px 30px rgba(0,0,0,.22);max-height:calc(100% - 36px);overflow:auto;color:#cfcfcf}
.progress-title{font-size:13px;font-weight:650;color:#9e9e9e;margin-bottom:8px}
.progress-list,.progress-section{display:flex;flex-direction:column;gap:7px}
.progress-item{display:grid;grid-template-columns:20px 1fr;gap:8px;align-items:start;color:#b9b9b9;font-size:12.25px;line-height:1.38}
.progress-dot{width:14px;height:14px;border:1.7px solid #8f9094;border-radius:999px;margin-top:2px;display:inline-flex;align-items:center;justify-content:center;color:#cacaca}
.progress-item.done .progress-dot::after{content:'✓';font-size:11px;line-height:1}
.progress-item.done .progress-dot{border-color:#a6a7aa}
.progress-item.running .progress-dot{border-color:#a6a7aa;border-left-color:transparent;animation:spin .9s linear infinite}
.progress-item.pending{color:#aaa}
.progress-divider{height:1px;background:var(--codex-border);margin:12px 0}
.progress-subtitle{font-size:12.5px;color:#8f8f8f;font-weight:650;margin:0 0 8px}
.progress-button,.progress-artifact{border:0;background:transparent;color:#f0f0f0;width:100%;display:flex;align-items:center;gap:8px;text-align:left;padding:4px 2px;border-radius:8px;cursor:pointer;font:inherit;font-size:12.5px;line-height:1.25}
.progress-button:hover,.progress-artifact:hover{background:var(--codex-selected)}
.progress-button svg,.progress-artifact svg{width:15px;height:15px;flex:0 0 auto}
.progress-muted{color:#9a9a9a}
.progress-artifact span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.progress-empty{font-size:12.5px;color:#888}
.work-summary-line{max-width:var(--chat-max);margin:0 auto 9px;display:flex;align-items:center;gap:8px;color:#8f9094;font-size:12.5px;line-height:1.35}
.work-summary-line strong{font-weight:600;color:#a9aaad}
.work-summary-line .work-dot{width:15px;height:15px;border:1.7px solid #8f9094;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.work-summary-line.done .work-dot::after{content:'✓';font-size:11px;line-height:1}
.work-summary-line.running .work-dot{border-left-color:transparent;animation:spin .9s linear infinite}
.msg{position:relative;padding:0;margin:0 auto 22px;background:transparent;border:0;max-width:var(--chat-max)}
.msg.user{max-width:var(--chat-max);margin:0 auto 23px;color:var(--codex-bright);display:flex;justify-content:flex-end;flex-wrap:wrap}
.msg.user .role,.msg.user .meta{display:none}
.msg.user .message-text{background:#2b2b2d;border:1px solid #313134;border-radius:16px 16px 4px 16px;padding:9px 13px;color:var(--codex-bright);max-width:min(74%,var(--bubble-max));box-sizing:border-box}
.msg.system .message-text{color:#aeb0b3}
.role{font-weight:600;color:var(--codex-text);margin-bottom:4px}
.meta{font-size:12px;color:#8e8e8e;margin:-1px 0 5px}
.meta-bottom{margin:8px 0 0;color:#858585}
.assistant .role{color:var(--codex-text)}.system .role{color:#e8b66b}
.msg.streaming .meta-bottom::before{content:'Думаю';display:inline-flex;margin-right:8px;color:var(--codex-muted)}
.msg.streaming .meta-bottom::after{content:'';display:inline-block;width:6px;height:6px;margin-left:6px;border-radius:999px;background:var(--codex-muted);vertical-align:middle;animation:pulse 1.1s ease-in-out infinite}
.message-text{margin:0;white-space:normal;word-wrap:break-word;font:inherit;color:var(--codex-text);font-size:14px;line-height:1.5}
.message-text p{margin:0 0 12px}
.message-text p:last-child,.message-text ul:last-child,.message-text ol:last-child{margin-bottom:0}
.message-text ul,.message-text ol{margin:0 0 12px 1.25em;padding:0}
.message-text li{margin:3px 0;padding-left:2px}
.message-text .plain-line{white-space:pre-wrap}
.msg.user .message-text{white-space:pre-wrap}
.message-text code,.message-text .inline-chip{font-family:var(--codex-mono);font-size:.9em;background:var(--codex-chip);color:#e4e4e4;border-radius:5px;padding:1px 5px;white-space:break-spaces}
.code-block{margin:10px 0 12px;border:1px solid var(--codex-border);border-radius:8px;overflow:hidden;background:#171717;color:#dedede}
.code-head{height:28px;display:flex;align-items:center;padding:0 10px;border-bottom:1px solid var(--codex-border);background:#202020;color:#8f9094;font:12px/1 var(--codex-font)}
.code-block pre{padding:10px 12px;overflow:auto;font:12.5px/1.5 var(--codex-mono);white-space:pre;color:#d8d8d8}
.msg.user .message-text code,.msg.user .message-text .inline-chip{background:#303030}
.attachments-list,.message-file-cards{display:flex;flex-direction:column;gap:8px;margin:12px 0 0;width:100%;max-width:var(--chat-max)}
.msg.user .attachments-list,.msg.user .message-file-cards{max-width:min(74%,var(--bubble-max));margin-left:auto;margin-right:0}
.attachment-card{border:1px solid var(--codex-strong-border);background:var(--codex-surface);color:#dcdcdc;border-radius:8px;padding:9px 10px;display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;max-width:100%;text-align:left;font:inherit}
.attachment-card.clickable{cursor:pointer}
.attachment-card.clickable:hover{background:var(--codex-surface-2)}
.attachment-card.image-card{grid-template-columns:82px minmax(0,1fr) auto;cursor:default}
.image-thumb{width:82px;height:58px;border:0;border-radius:8px;background:#171717;overflow:hidden;padding:0;cursor:pointer;display:block}
.image-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.attachment-card-icon{width:34px;height:34px;border-radius:8px;background:#171717;display:flex;align-items:center;justify-content:center;color:#bfc1c5}
.attachment-card-icon svg{width:19px;height:19px}
.attachment-card-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e7e7e7;font-weight:600;font-size:13px}
.attachment-card-subtitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#909399;font-size:12px;margin-top:2px}
.attachment-card-action{border:1px solid var(--codex-strong-border);background:transparent;color:#dcdcdc;border-radius:8px;padding:5px 9px;font-size:12.5px}
.image-preview-overlay{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:40;display:none;align-items:center;justify-content:center;padding:24px}
.image-preview-overlay.open{display:flex}
.image-preview-panel{max-width:min(1100px,96vw);max-height:92vh;display:flex;flex-direction:column;gap:10px}
.image-preview-panel img{max-width:100%;max-height:82vh;object-fit:contain;border-radius:8px;background:#111}
.image-preview-caption{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#d8d8d8;font-size:13px}
.image-preview-close{border:1px solid var(--codex-strong-border);background:var(--codex-surface);color:#f3f3f3;border-radius:8px;padding:6px 10px;cursor:pointer}
.inline-file-link{border:0;background:var(--codex-chip);color:#e4e4e4;border-radius:6px;padding:1px 6px;font:inherit;font-family:var(--codex-mono);cursor:pointer}
.inline-file-link:hover{background:var(--codex-selected);color:#fff}
.change-card{margin:10px 0 12px;background:var(--codex-surface);border:1px solid var(--codex-border);border-radius:8px;overflow:hidden;color:var(--codex-text);white-space:normal;box-shadow:0 8px 18px rgba(0,0,0,.1)}
.change-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:38px;padding:0 9px 0 12px;background:#242424;border-bottom:1px solid var(--codex-border);font-weight:600;line-height:1.2;white-space:normal}
.change-card.collapsed .change-head{border-bottom:0}
.change-summary{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 auto;color:#dedede;font-size:13px;white-space:normal}
.change-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.change-actions{display:flex;align-items:center;gap:10px;color:#9a9a9a;font-weight:600;white-space:normal;flex:0 0 auto}
.change-action{border:0;background:transparent;color:#9a9a9a;height:26px;padding:0 3px;border-radius:6px;cursor:pointer;font:inherit;font-size:12.5px;line-height:1;display:inline-flex;align-items:center;justify-content:center;gap:5px;opacity:.9}
.change-action svg{width:14px;height:14px;stroke-width:1.8}
.change-action.icon-only{width:22px;padding:0}
.change-card:not(.collapsed) .change-action.icon-only svg{transform:rotate(180deg)}
.change-action:hover{background:transparent;color:#d8d8d8;opacity:1}
.change-row{display:flex;align-items:center;gap:8px;min-height:28px;padding:0 8px 0 10px;border:0;border-top:1px solid var(--codex-border);background:transparent;color:var(--codex-text);width:100%;text-align:left;cursor:pointer;font:inherit;font-size:12px;line-height:1.2;white-space:normal}
.change-row:hover{background:var(--codex-surface-2)}
.change-row:first-of-type{border-top:0}
.change-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.delta{font-family:var(--codex-mono);font-size:11.5px}.change-summary>.delta{font-size:12.5px;font-weight:500}
.delta.plus{color:var(--codex-green)}.delta.minus{color:var(--codex-red)}
.chev{color:#9b9b9b}
.row-chev{width:20px;height:24px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;color:#a2a4a8;flex:0 0 auto}
.row-chev svg{width:14px;height:14px;stroke-width:1.7}
.change-row:hover .row-chev{color:#d1d1d1;background:transparent}
.change-card.collapsed .change-row{display:none}
pre{margin:0;white-space:pre-wrap;word-wrap:break-word;font:inherit}
.msg-tools{position:absolute;right:0;bottom:-20px;display:flex;gap:5px;opacity:0;transform:translateY(2px);transition:opacity .12s ease, transform .12s ease}
.msg.assistant .msg-tools,.msg.system .msg-tools{right:auto;left:0}
.msg.user .msg-tools{right:0;left:auto;transform:translateY(2px)}
.msg:hover .msg-tools{opacity:1;transform:translateY(0)}
.msg.user:hover .msg-tools{transform:translateY(0)}
.hover-btn{width:23px;height:23px;border:0;border-radius:6px;background:var(--codex-bg);color:#909399;display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.hover-btn svg{width:14px;height:14px}
.hover-btn:hover{background:var(--codex-surface);color:#e6e6e6}
.hover-btn.danger:hover{background:#463033;color:#f3b4b4}
.action-timeline{max-width:var(--chat-max);margin:0 auto 16px;color:#8f9094;font-size:12.75px;line-height:1.38}
.action-line,.action-log-summary{display:flex;align-items:center;gap:8px;min-height:26px;color:#8f9094}
.action-line strong,.action-log-summary strong{color:#aeb0b3;font-weight:500}
.action-line svg,.action-log-summary svg{width:14px;height:14px;color:#8f9094;flex:0 0 auto}
.action-line.running svg{animation:spin .9s linear infinite}
.action-line.pending strong{color:#d2d2d2}
.action-line.failed strong{color:var(--codex-red)}
.action-line.denied strong{color:#c7a0a0}
.action-log{margin:2px 0 4px}
.action-log summary{list-style:none;cursor:pointer}
.action-log summary::-webkit-details-marker{display:none}
.action-log-body{margin:3px 0 2px 22px;border-left:1px solid var(--codex-border);padding-left:10px}
.action-log-entry{padding:4px 0;color:#aeb0b3}
.action-log-entry pre{margin:4px 0 0;max-height:130px;overflow:auto;color:#9fa1a5;font:12px/1.45 var(--codex-mono)}
.action{max-width:var(--chat-max);margin:0 auto 16px;padding:10px 12px;background:var(--codex-surface);border:1px solid var(--codex-border);border-radius:9px;color:var(--codex-text)}
.action.resolved{padding:8px 10px}
.action-head{display:flex;align-items:center;gap:10px;color:var(--codex-text);margin-bottom:8px}
.action-head strong{flex:1}
.action-status{font-size:12px;color:#999}
.action.running .action-status::before,.action.pending .action-status::before{content:'';display:inline-block;width:7px;height:7px;border-radius:999px;background:#9da0a5;margin-right:7px;animation:pulse 1.1s ease-in-out infinite}
.action.completed .action-status{color:var(--codex-green)}.action.failed .action-status{color:var(--codex-red)}
.action pre{max-height:220px;overflow:auto;color:#cfcfcf;font:12px/1.45 var(--codex-mono)}
.action.resolved.collapsed pre{display:none}
.action-toggle,.action-dismiss{border:0;background:transparent;color:#9b9b9b;border-radius:6px;cursor:pointer;padding:2px 5px;font:inherit;font-size:12px;display:inline-flex;align-items:center;justify-content:center}
.action-toggle:hover,.action-dismiss:hover{background:var(--codex-selected);color:#e8e8e8}
.action-dismiss{width:24px;height:24px;padding:0}
.action-dismiss svg{width:14px;height:14px;stroke-width:1.65}
.action-buttons{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.action-buttons button{border:1px solid var(--codex-strong-border);background:var(--codex-selected);color:var(--codex-text);border-radius:8px;padding:6px 10px;cursor:pointer}
.action-buttons button:hover{background:#3a3740}
.composer-wrap{padding:8px clamp(18px,4vw,72px) 10px;background:var(--codex-bg)}
.composer{max-width:var(--composer-max);margin:0 auto;border:1px solid var(--codex-strong-border);background:#2d2d2d;border-radius:18px;padding:9px 11px 8px;display:flex;flex-direction:column;gap:5px;box-shadow:0 10px 26px rgba(0,0,0,.18);transition:border-color .12s ease,box-shadow .12s ease}
.composer:focus-within{border-color:#4a4a4f;box-shadow:0 12px 32px rgba(0,0,0,.26)}
.controls{display:flex;gap:8px;align-items:center;min-width:0}
.controls-spacer{flex:1 1 auto;min-width:16px}
.subcontrols{display:flex;gap:12px;align-items:center;margin:5px auto 0;max-width:var(--composer-max);color:#8e8e8e;font-size:12px}
.plus{color:#c0c0c0;background:transparent;border:0;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer;border-radius:8px;flex:0 0 auto}
.plus:hover{background:var(--codex-selected);color:#ededed}
textarea{width:100%;box-sizing:border-box;resize:none;min-height:40px;max-height:152px;overflow:hidden;border:0;background:transparent;color:#e9e9e9;padding:0;font:inherit;font-size:14px;outline:none;line-height:1.5}
textarea.scroll{overflow:auto}
textarea::placeholder{color:#818389}
.composer-attachments{display:none;flex-wrap:wrap;gap:6px;margin:-1px 0 2px}
.composer-attachments.visible{display:flex}
.composer-attachment{border:1px solid var(--codex-strong-border);background:var(--codex-surface);color:#dcdcdc;border-radius:999px;display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 7px;font-size:12px}
.composer-attachment span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.composer-attachment button{border:0;background:transparent;color:#a5a5a5;padding:0;width:16px;height:16px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.composer-attachment button svg{width:12px;height:12px;stroke-width:1.75}
.composer-attachment button:hover{background:var(--codex-selected);color:#fff}
.dropdown{position:relative;flex:0 0 auto;min-width:0}
.dropdown.model-effort{width:max-content;min-width:156px;max-width:230px}
.dropdown.profile{width:178px}
.dropdown-btn{height:29px;width:100%;border:0;background:transparent;color:#c9c9c9;padding:0 7px;font-size:13px;display:flex;align-items:center;justify-content:flex-start;gap:6px;border-radius:8px;cursor:pointer;white-space:nowrap}
.dropdown-btn:hover,.dropdown.open .dropdown-btn{background:var(--codex-selected);color:#e0e0e0}
.dropdown-btn .label{min-width:0;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto}
.model-effort-btn{width:max-content;min-width:156px;max-width:230px}
.model-effort-btn .label{overflow:visible;text-overflow:clip}
.bolt{display:inline-flex;color:#a9a9a9}
.bolt svg{width:14px;height:14px;fill:currentColor;stroke:none}
.chev{color:#9a9a9a;display:inline-flex;align-items:center}
.chev svg{width:13px;height:13px}
.menu{display:none;position:absolute;left:0;bottom:36px;min-width:100%;max-height:270px;overflow:auto;background:var(--codex-surface);border:1px solid var(--codex-border);border-radius:10px;padding:6px;box-shadow:0 14px 38px rgba(0,0,0,.48);z-index:5}
.dropdown.open .menu{display:block}
.menu-label{padding:6px 9px 4px;color:#8f8f8f;font-size:12px}
.item{width:100%;text-align:left;border:0;background:transparent;color:#d9d9d9;padding:7px 10px;border-radius:8px;cursor:pointer;white-space:nowrap;font-size:13.25px;line-height:1.32}
.item:hover{background:var(--codex-selected)}
.item.selected{color:var(--codex-bright);background:var(--codex-selected)}
.item.check{display:flex;align-items:center;justify-content:space-between;gap:12px}
.item.check::after{content:'';color:#dcdcdc}
.item.check.selected::after{content:'✓'}
button.send{border:0;border-radius:999px;background:#d9d9d9;color:#111;width:33px;height:33px;min-width:33px;max-width:33px;aspect-ratio:1/1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;white-space:nowrap;padding:0;flex:0 0 33px;margin-left:4px}
button.send:hover{background:#fff}
button.send.stop{background:#f0f0f0;color:#111}
button.send.stop:hover{background:#fff}
button.send:disabled{opacity:.55;cursor:default}
.link-btn{border:0;background:transparent;color:#8e8e8e;cursor:pointer;padding:3px 0;display:inline-flex;align-items:center;gap:5px}
.link-btn:hover{color:#d0d0d0}
.scroll-bottom{position:fixed;right:calc(min(4vw,42px) + var(--progress-offset,0px));bottom:calc(var(--composer-height, 132px) + 12px);z-index:4;width:34px;height:34px;border:1px solid var(--codex-strong-border);border-radius:999px;background:rgba(45,45,45,.78);color:#e2e2e2;display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer;box-shadow:0 10px 26px rgba(0,0,0,.32);backdrop-filter:blur(5px);opacity:1;transform:translateY(0);transition:opacity .15s ease,transform .15s ease,background .15s ease}
.scroll-bottom svg{width:17px;height:17px}
.scroll-bottom:hover{background:rgba(57,58,61,.95);color:#fff}
.scroll-bottom.hidden{opacity:0;pointer-events:none;transform:translateY(8px)}
@keyframes pulse{0%,100%{opacity:.35;transform:scale(.82)}50%{opacity:1;transform:scale(1)}}
@keyframes spin{to{transform:rotate(360deg)}}
@media (min-width: 760px){.composer-wrap{margin-left:246px}.messages{padding-left:clamp(20px,3vw,64px);padding-right:clamp(20px,3vw,64px)}}
@media (min-width: 1120px){:root{--progress-offset:0}.content-shell.progress-open .progress-panel{display:block}.content-shell.progress-open ~ .composer-wrap{margin-right:252px}}
@media (min-width: 1500px){:root{--chat-max:900px;--composer-max:940px}.progress-panel{width:246px}.content-shell.progress-open ~ .composer-wrap{margin-right:258px}}
@media (max-width: 1119px){:root{--progress-offset:0}.content-shell.progress-open .progress-panel{display:block;position:fixed;right:12px;top:56px;bottom:calc(var(--composer-height,132px) + 12px);width:min(340px,calc(100vw - 24px));max-width:none;max-height:none;margin:0;z-index:7}}
@media (max-width: 759px){.wide-sidebar{display:none}.content-shell{display:flex;overflow:hidden}.messages{height:auto;overflow:auto}.scroll-bottom{display:none}}
@media (max-width: 760px){.change-head{min-height:38px;padding:0 8px 0 10px;gap:8px}.change-summary{font-size:12.5px;gap:7px}.change-summary>.delta{font-size:12px}.change-actions{gap:8px}.change-action{font-size:0;width:24px;gap:0}.change-action span{display:none}.change-action svg{width:14px;height:14px}}
@media (max-width: 680px){.top{padding:0 10px}.messages{padding-left:14px;padding-right:14px;padding-bottom:132px}.composer-wrap{padding-left:8px;padding-right:8px}.controls{flex-wrap:wrap}button.send{margin-left:auto}.subcontrols{gap:8px;flex-wrap:wrap}.dropdown.profile{flex-basis:132px}.msg.user .message-text,.msg.user .attachments-list,.msg.user .message-file-cards{max-width:88%}}
</style>
</head>
<body>
<div class="top">
  <button class="icon-btn edit-icon" type="button" data-action="newChat" title="&#1053;&#1086;&#1074;&#1099;&#1081; &#1095;&#1072;&#1090;">${icon.edit}</button>
  <div class="thread-menu-wrap" id="threadDrop">
    <button class="thread-menu-btn" type="button" title="&#1048;&#1089;&#1090;&#1086;&#1088;&#1080;&#1103; &#1095;&#1072;&#1090;&#1086;&#1074;">
      <span class="thread-title">${this.escapeHtml(title)}</span>
      <span class="chev">${icon.chevron}</span>
    </button>
    <div class="thread-menu" id="threadMenu">
      ${threadMenuRows || '<div class="sidebar-empty">Нет чатов</div>'}
    </div>
  </div>
  <div class="toolbar-spacer"></div>
  <button class="live-chip ${isBusy ? 'busy' : ''}" type="button" data-action="showUsageStatus" title="${this.escapeHtml(liveChipTitle)}">${this.escapeHtml(liveChipLabel)}</button>
  <button class="version-chip" type="button" data-action="showUsageStatus" title="${this.escapeHtml(versionChipTitle)}">${this.escapeHtml(versionChipLabel)}</button>
  <button class="icon-btn progress-toggle" type="button" id="progressToggle" data-progress-toggle title="Панель работы" aria-pressed="false">${icon.panel}</button>
  <div class="top-menu-wrap" id="topMoreDrop">
    <button class="icon-btn" type="button" id="topMoreBtn" title="&#1052;&#1077;&#1085;&#1102;">${icon.more}</button>
    <div class="top-menu">
      <button class="item icon-item" type="button" data-action="pinCurrentThread">${icon.pin}<span>${isPinned ? 'Открепить чат' : 'Закрепить чат'}</span></button>
      <button class="item" type="button" data-action="renameThread">&#1055;&#1077;&#1088;&#1077;&#1080;&#1084;&#1077;&#1085;&#1086;&#1074;&#1072;&#1090;&#1100; &#1095;&#1072;&#1090;</button>
      <button class="item icon-item" type="button" data-action="archiveCurrentThread">${icon.archive}<span>Архивировать чат</span></button>
      <div class="menu-separator"></div>
      <button class="item" type="button" data-action="copyWorkspaceDirectory">Скопировать рабочую директорию</button>
      <button class="item" type="button" data-action="copyCurrentThreadMarkdown">Скопировать как Markdown</button>
      <div class="menu-separator"></div>
      <button class="item" type="button" data-action="clearChat">&#1054;&#1095;&#1080;&#1089;&#1090;&#1080;&#1090;&#1100; &#1095;&#1072;&#1090;</button>
      <button class="item" type="button" data-action="deleteCurrentThread">&#1059;&#1076;&#1072;&#1083;&#1080;&#1090;&#1100; &#1095;&#1072;&#1090;</button>
      <div class="menu-separator"></div>
      <button class="item icon-item" type="button" data-action="createOrCopyToken">${icon.lock}<span>${this._authToken ? 'Токен доступа' : 'Создать токен доступа'}</span></button>
      <button class="item icon-item" type="button" data-action="showPairingQr">${icon.qr}<span>QR для телефона</span></button>
      <button class="item icon-item" type="button" data-action="copyPairingPayload">${icon.copy}<span>Код для телефона</span></button>
      <div class="menu-separator"></div>
      <button class="item icon-item" type="button" data-progress-toggle>${icon.panel}<span>Панель работы</span></button>
      <button class="item icon-item" type="button" data-action="showProblems">${icon.panel}<span>Диагностика</span></button>
      <button class="item icon-item" type="button" data-action="openScm">${icon.branch}<span>Изменения Git</span></button>
      <button class="item icon-item" type="button" data-action="openTerminal">${icon.terminal}<span>Терминал</span></button>
      <div class="menu-separator"></div>
      <button class="item icon-item" type="button" data-action="configureKeeneticRouter">${icon.globe}<span>Настроить Keenetic</span></button>
      <button class="item icon-item" type="button" data-action="copyKeeneticCommands">${icon.copy}<span>Скопировать инструкцию Keenetic</span></button>
      <button class="item icon-item" type="button" data-action="openRouterPage">${icon.globe}<span>Открыть Keenetic</span></button>
      <button class="item" type="button" data-action="showConnectionSettings">&#1055;&#1086;&#1076;&#1082;&#1083;&#1102;&#1095;&#1077;&#1085;&#1080;&#1077;</button>
      <button class="item" type="button" data-action="openSettings">&#1053;&#1072;&#1089;&#1090;&#1088;&#1086;&#1081;&#1082;&#1080;</button>
    </div>
  </div>
</div>
<div class="content-shell" id="contentShell">
  ${sidebarHtml}
  <main class="messages" id="messages">
${rows || (actionTimelineRows || actionRows ? actionTimelineRows : '<div class="msg system"><div class="role">Система</div><pre>Жду сообщение с телефона или из VS Code.</pre></div>')}
${actionRows}
  </main>
  ${progressPanel}
</div>
<button class="scroll-bottom hidden" id="scrollBottom" type="button" title="&#1050; &#1085;&#1086;&#1074;&#1099;&#1084; &#1089;&#1086;&#1086;&#1073;&#1097;&#1077;&#1085;&#1080;&#1103;&#1084;">${icon.scrollDown}</button>
<div class="image-preview-overlay" id="imagePreview" role="dialog" aria-modal="true">
  <div class="image-preview-panel">
    <img id="imagePreviewImg" alt="">
    <div class="image-preview-caption"><span id="imagePreviewCaption"></span><button class="image-preview-close" id="imagePreviewClose" type="button">Закрыть</button></div>
  </div>
</div>
<div class="composer-wrap">
  <form class="composer" id="composer">
    <textarea id="prompt" placeholder="Запросите внесение дополнительных изменений" spellcheck="true" lang="ru" autocomplete="on" autocapitalize="sentences" autocorrect="on" inputmode="text" autofocus></textarea>
    <div class="composer-attachments" id="attachments"></div>
    <div class="controls">
      <button class="plus" type="button" data-action="addFile" title="&#1044;&#1086;&#1073;&#1072;&#1074;&#1080;&#1090;&#1100; &#1092;&#1072;&#1081;&#1083;">${icon.plus}</button>
      <div class="dropdown profile" id="profileDrop">
        <button class="dropdown-btn" type="button"><span>${icon.settings}</span><span id="profileLabel" class="label"></span><span class="chev">${icon.chevron}</span></button>
        <div class="menu" id="profileMenu"></div>
      </div>
      <div class="controls-spacer"></div>
      <div class="dropdown model-effort" id="modelEffortDrop">
        <button class="dropdown-btn model-effort-btn" type="button"><span class="bolt">${icon.sparkle}</span><span id="modelEffortLabel" class="label"></span><span class="chev">${icon.chevron}</span></button>
        <div class="menu" id="modelEffortMenu"></div>
      </div>
      <button class="send ${isBusy ? 'stop' : ''}" id="send" type="${isBusy ? 'button' : 'submit'}" title="${isBusy ? 'Остановить' : 'Отправить'}">${isBusy ? icon.stop : icon.send}</button>
    </div>
  </form>
  <div class="subcontrols">
    <button class="link-btn" type="button" data-action="showBranch">${icon.branch} ${this.escapeHtml(branchLabel)} <span class="chev">${icon.chevron}</span></button>
  </div>
</div>
<script>
const vscode = acquireVsCodeApi();
const form = document.getElementById('composer');
const prompt = document.getElementById('prompt');
const messages = document.getElementById('messages');
const scrollBottom = document.getElementById('scrollBottom');
prompt.spellcheck = true;
prompt.lang = navigator.language || 'ru';
const modelOptions = ${JSON.stringify(modelOptions)};
const effortOptions = ${JSON.stringify(effortOptions)};
const profileOptions = ${JSON.stringify(profileOptions)};
let selectedModel = ${JSON.stringify(selectedModel)};
let selectedEffort = ${JSON.stringify(selectedEffort)};
let selectedProfile = ${JSON.stringify(this.selectedProfile)};
let attachedFiles = [];
const isBusy = ${JSON.stringify(isBusy)};
const includeContext = true;
const savedViewState = vscode.getState?.() || {};
let progressOpen = Boolean(savedViewState.progressOpen);
let expandedChangeCards = new Set(Array.isArray(savedViewState.expandedChangeCards) ? savedViewState.expandedChangeCards : []);
let submitLocked = false;
function formatBytes(bytes) {
  if (!bytes || bytes < 1) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function renderAttachments() {
  const root = document.getElementById('attachments');
  root.innerHTML = '';
  root.classList.toggle('visible', attachedFiles.length > 0);
  attachedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'composer-attachment';
    item.title = file.path || file.name || '';
    const label = document.createElement('span');
    const size = formatBytes(file.size);
    label.textContent = size ? (file.name + ' · ' + size) : file.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.innerHTML = ${JSON.stringify(this.webIcon('x'))};
    remove.title = 'Убрать вложение';
    remove.addEventListener('click', () => {
      attachedFiles = attachedFiles.filter((_, itemIndex) => itemIndex !== index);
      renderAttachments();
    });
    item.appendChild(label);
    item.appendChild(remove);
    root.appendChild(item);
  });
}
function addAttachments(files) {
  const next = Array.isArray(files) ? files.filter(file => file && file.path && file.name) : [];
  if (!next.length) return;
  const known = new Set(attachedFiles.map(file => file.path));
  next.forEach(file => {
    if (!known.has(file.path)) {
      attachedFiles.push(file);
      known.add(file.path);
    }
  });
  attachedFiles = attachedFiles.slice(0, 6);
  renderAttachments();
  prompt.focus();
}
function renderDropdown(rootId, menuId, labelId, options, selected, onSelect) {
  const root = document.getElementById(rootId);
  const menu = document.getElementById(menuId);
  const label = document.getElementById(labelId);
  const selectedOption = options.find(option => option.id === selected) || options[0];
  label.textContent = selectedOption ? selectedOption.name : '';
  menu.innerHTML = '';
  options.forEach(option => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'item' + (option.id === selected ? ' selected' : '');
    item.textContent = option.name;
    item.addEventListener('click', () => {
      onSelect(option.id);
      root.classList.remove('open');
    });
    menu.appendChild(item);
  });
}
function shortModelName(name) {
  return String(name || '').replace(/^gpt-/i, '').replace(/^GPT-/i, '');
}
function renderModelEffortMenu() {
  const root = document.getElementById('modelEffortDrop');
  const menu = document.getElementById('modelEffortMenu');
  const label = document.getElementById('modelEffortLabel');
  const model = modelOptions.find(option => option.id === selectedModel) || modelOptions[0];
  const effort = effortOptions.find(option => option.id === selectedEffort) || effortOptions[1] || effortOptions[0];
  label.textContent = [shortModelName(model?.name || selectedModel), effort?.name].filter(Boolean).join(' ');
  menu.innerHTML = '';
  const modelLabel = document.createElement('div');
  modelLabel.className = 'menu-label';
  modelLabel.textContent = 'Модель';
  menu.appendChild(modelLabel);
  modelOptions.forEach(option => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'item check' + (option.id === selectedModel ? ' selected' : '');
    item.textContent = option.name;
    item.addEventListener('click', () => {
      selectedModel = option.id;
      vscode.postMessage({ type: 'action', action: 'selectModel', model: selectedModel });
      root.classList.remove('open');
      refreshControls();
    });
    menu.appendChild(item);
  });
  const effortLabel = document.createElement('div');
  effortLabel.className = 'menu-label';
  effortLabel.textContent = 'Усилие';
  menu.appendChild(effortLabel);
  effortOptions.forEach(option => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'item check' + (option.id === selectedEffort ? ' selected' : '');
    item.textContent = option.name;
    item.addEventListener('click', () => {
      selectedEffort = option.id;
      vscode.postMessage({ type: 'action', action: 'selectEffort', effort: selectedEffort });
      root.classList.remove('open');
      refreshControls();
    });
    menu.appendChild(item);
  });
}
function refreshControls() {
  renderDropdown('profileDrop', 'profileMenu', 'profileLabel', profileOptions, selectedProfile, value => {
    selectedProfile = value;
    vscode.postMessage({ type: 'action', action: 'selectProfile', profile: selectedProfile });
    refreshControls();
  });
  renderModelEffortMenu();
}
document.querySelectorAll('.dropdown-btn').forEach(button => {
  button.addEventListener('click', event => {
    const root = event.currentTarget.closest('.dropdown');
    const isOpen = root.classList.contains('open');
    document.querySelectorAll('.dropdown.open').forEach(drop => drop.classList.remove('open'));
    if (!isOpen) root.classList.add('open');
  });
});
document.querySelector('#threadDrop .thread-menu-btn').addEventListener('click', event => {
  event.stopPropagation();
  document.getElementById('threadDrop').classList.toggle('open');
});
document.getElementById('topMoreBtn').addEventListener('click', event => {
  event.stopPropagation();
  document.getElementById('topMoreDrop').classList.toggle('open');
});
const contentShell = document.getElementById('contentShell');
const progressToggleButtons = Array.from(document.querySelectorAll('[data-progress-toggle]'));
function saveViewState() {
  const previous = vscode.getState?.() || {};
  vscode.setState?.({ ...previous, progressOpen, expandedChangeCards: Array.from(expandedChangeCards).slice(-60) });
}
function updateProgressOffset() {
  const offset = progressOpen && window.matchMedia('(min-width: 1120px)').matches ? '252px' : '0px';
  document.documentElement.style.setProperty('--progress-offset', offset);
}
function setProgressPanelOpen(open, persist = true) {
  progressOpen = Boolean(open);
  contentShell?.classList.toggle('progress-open', progressOpen);
  progressToggleButtons.forEach(button => {
    button.classList.toggle('active', progressOpen);
    button.setAttribute('aria-pressed', progressOpen ? 'true' : 'false');
    if (button.id === 'progressToggle') button.title = progressOpen ? 'Скрыть панель работы' : 'Панель работы';
  });
  updateProgressOffset();
  if (persist) saveViewState();
  updateComposerHeight();
  updateScrollBottomButton();
}
progressToggleButtons.forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('topMoreDrop')?.classList.remove('open');
    setProgressPanelOpen(!progressOpen);
  });
});
function changeCardKey(card) {
  if (!card) return '';
  const rows = Array.from(card.querySelectorAll('.change-row'))
    .map(row => row.dataset.path || '')
    .filter(Boolean)
    .join('|');
  return [card.dataset.commit || '', card.dataset.cwd || '', rows || card.querySelector('.change-title')?.textContent || ''].join('::');
}
function setChangeCardExpanded(card, expanded) {
  const key = changeCardKey(card);
  card?.classList.toggle('collapsed', !expanded);
  if (key) {
    if (expanded) expandedChangeCards.add(key);
    else expandedChangeCards.delete(key);
    saveViewState();
  }
}
document.querySelectorAll('.change-card').forEach(card => {
  if (expandedChangeCards.has(changeCardKey(card))) {
    card.classList.remove('collapsed');
  }
});
document.querySelectorAll('[data-thread-id]').forEach(button => {
  button.addEventListener('click', () => {
    vscode.postMessage({ type: 'action', action: 'switchThread', threadId: button.dataset.threadId });
  });
});
document.querySelectorAll('[data-delete-thread-id]').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const threadId = button.dataset.deleteThreadId;
    if (!threadId) return;
    vscode.postMessage({ type: 'action', action: 'deleteThread', threadId });
  });
});
document.addEventListener('click', event => {
  if (!event.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown.open').forEach(drop => drop.classList.remove('open'));
  }
  if (!event.target.closest('#threadDrop')) {
    document.getElementById('threadDrop').classList.remove('open');
  }
  if (!event.target.closest('#topMoreDrop')) {
    document.getElementById('topMoreDrop').classList.remove('open');
  }
});
document.querySelectorAll('[data-action]').forEach(button => {
  button.addEventListener('click', () => {
    document.getElementById('topMoreDrop')?.classList.remove('open');
    const payload = { type: 'action', action: button.dataset.action };
    if (button.dataset.path) payload.path = button.dataset.path;
    if (button.dataset.url) payload.url = button.dataset.url;
    vscode.postMessage(payload);
  });
});
document.querySelectorAll('[data-action-id]').forEach(button => {
  button.addEventListener('click', () => {
    vscode.postMessage({ type: 'actionResponse', actionId: button.dataset.actionId, decision: button.dataset.decision });
  });
});
document.querySelectorAll('[data-action-toggle]').forEach(button => {
  button.addEventListener('click', event => {
    const card = event.currentTarget.closest('.action');
    card?.classList.toggle('collapsed');
    event.currentTarget.textContent = card?.classList.contains('collapsed') ? 'Показать' : 'Скрыть';
  });
});
document.querySelectorAll('[data-dismiss-action-id]').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    const actionId = event.currentTarget.dataset.dismissActionId;
    if (!actionId) return;
    vscode.postMessage({ type: 'action', action: 'dismissActionEvent', actionId });
  });
});
document.getElementById('send').addEventListener('click', event => {
  if (!isBusy) return;
  event.preventDefault();
  vscode.postMessage({ type: 'action', action: 'stopGeneration' });
});
window.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'appendPrompt' && typeof data.text === 'string') {
    prompt.value = prompt.value ? prompt.value + '\\n' + data.text : data.text;
    autoGrowPrompt();
    prompt.focus();
  }
  if (data.type === 'attachFiles' && Array.isArray(data.files)) {
    addAttachments(data.files);
  }
});
refreshControls();
renderAttachments();
function isNearBottom() {
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 110;
}
function updateComposerHeight() {
  const wrap = document.querySelector('.composer-wrap');
  const height = wrap ? Math.ceil(wrap.getBoundingClientRect().height) : 132;
  document.documentElement.style.setProperty('--composer-height', height + 'px');
}
function updateScrollBottomButton() {
  scrollBottom?.classList.toggle('hidden', isNearBottom());
}
function scrollMessagesToBottom(behavior = 'auto') {
  messages.scrollTo({ top: messages.scrollHeight, behavior });
  updateScrollBottomButton();
}
function scheduleScrollMessagesToBottom() {
  requestAnimationFrame(() => {
    scrollMessagesToBottom();
    requestAnimationFrame(() => scrollMessagesToBottom());
  });
}
scrollBottom?.addEventListener('click', () => {
  scrollMessagesToBottom('smooth');
});
messages.addEventListener('scroll', updateScrollBottomButton, { passive: true });
updateComposerHeight();
updateScrollBottomButton();
setProgressPanelOpen(progressOpen, false);
scheduleScrollMessagesToBottom();
window.addEventListener('resize', () => {
  updateComposerHeight();
  updateProgressOffset();
  scheduleScrollMessagesToBottom();
}, { passive: true });
function autoGrowPrompt() {
  prompt.style.height = 'auto';
  const max = 190;
  const next = Math.min(prompt.scrollHeight, max);
  prompt.style.height = next + 'px';
  prompt.classList.toggle('scroll', prompt.scrollHeight > max);
  updateComposerHeight();
  updateScrollBottomButton();
}
prompt.addEventListener('input', autoGrowPrompt);
autoGrowPrompt();
scheduleScrollMessagesToBottom();
setTimeout(() => prompt.focus(), 0);
function readClipboardFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      resolve({
        name: file.name || 'clipboard-file',
        mimeType: file.type || 'application/octet-stream',
        size: file.size || 0,
        base64
      });
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read clipboard file'));
    reader.readAsDataURL(file);
  });
}
prompt.addEventListener('paste', event => {
  const files = Array.from(event.clipboardData?.files || []);
  if (!files.length) return;
  event.preventDefault();
  Promise.all(files.slice(0, 6).map(readClipboardFile))
    .then(attachments => {
      vscode.postMessage({ type: 'action', action: 'pasteFiles', attachments });
    })
    .catch(error => {
      console.error('Remote Code paste failed:', error);
    });
});
document.querySelectorAll('.message-tool').forEach(button => {
  button.addEventListener('click', event => {
    const msg = event.currentTarget.closest('.msg');
    const text = msg?.querySelector('.message-text')?.innerText || '';
    const messageId = msg?.dataset.messageId || '';
    const action = event.currentTarget.dataset.messageAction;
    if (action === 'copy') {
      if (!text) return;
      vscode.postMessage({ type: 'action', action: 'copyMessage', text, messageId });
      return;
    }
    if (action === 'edit') {
      prompt.value = text;
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      prompt.focus();
      prompt.setSelectionRange(prompt.value.length, prompt.value.length);
      scrollMessagesToBottom('smooth');
      return;
    }
    if (action === 'delete' || action === 'regenerate') {
      vscode.postMessage({
        type: 'action',
        action: action === 'delete' ? 'deleteMessage' : 'regenerateMessage',
        messageId
      });
      return;
    }
    if (action === 'up' || action === 'down') {
      vscode.postMessage({ type: 'action', action: 'messageFeedback', feedback: action, messageId });
    }
  });
});
document.querySelectorAll('.change-row').forEach(button => {
  button.addEventListener('click', event => {
    const row = event.currentTarget;
    vscode.postMessage({ type: 'action', action: 'openChangeFile', path: row.dataset.path || '' });
  });
});
document.querySelectorAll('.change-action').forEach(button => {
  button.addEventListener('click', event => {
    const action = event.currentTarget.dataset.changeAction;
    const card = event.currentTarget.closest('.change-card');
    if (action === 'toggle') {
      setChangeCardExpanded(card, card?.classList.contains('collapsed'));
      return;
    }
    if (action === 'undo') {
      vscode.postMessage({ type: 'action', action: 'undoChangeBlock', commit: card?.dataset.commit || '', cwd: card?.dataset.cwd || '' });
      return;
    }
    if (action === 'review') {
      vscode.postMessage({ type: 'action', action: 'reviewChangeBlock', commit: card?.dataset.commit || '', cwd: card?.dataset.cwd || '' });
    }
  });
});
const imagePreview = document.getElementById('imagePreview');
const imagePreviewImg = document.getElementById('imagePreviewImg');
const imagePreviewCaption = document.getElementById('imagePreviewCaption');
function closeImagePreview() {
  imagePreview?.classList.remove('open');
  if (imagePreviewImg) imagePreviewImg.removeAttribute('src');
}
document.querySelectorAll('[data-preview-src]').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const source = event.currentTarget.dataset.previewSrc;
    if (!source || !imagePreviewImg) return;
    imagePreviewImg.src = source;
    imagePreviewImg.alt = event.currentTarget.dataset.previewName || '';
    if (imagePreviewCaption) imagePreviewCaption.textContent = event.currentTarget.dataset.previewName || '';
    imagePreview?.classList.add('open');
  });
});
document.getElementById('imagePreviewClose')?.addEventListener('click', closeImagePreview);
imagePreview?.addEventListener('click', event => {
  if (event.target === imagePreview) closeImagePreview();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeImagePreview();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  if (submitLocked) return;
  if (isBusy) {
    vscode.postMessage({ type: 'action', action: 'stopGeneration' });
    return;
  }
  const message = prompt.value.trim();
  if (!message && attachedFiles.length === 0) return;
  submitLocked = true;
  const sendButton = document.getElementById('send');
  if (sendButton) sendButton.disabled = true;
  vscode.postMessage({ type: 'send', message, attachments: attachedFiles, model: selectedModel, reasoningEffort: selectedEffort, includeContext, profile: selectedProfile });
  prompt.value = '';
  attachedFiles = [];
  renderAttachments();
  autoGrowPrompt();
});
prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});
</script>
</body>
</html>`;
    }

    private renderProgressPanel(
        messages: CodexChatMessage[],
        actions: RemoteCodeActionEvent[],
        isBusy: boolean,
        branchLabel: string
    ): string {
        const progressItems = this.getProgressItems(messages, actions, isBusy);
        const gitInfo = this.getGitPanelStatus();
        const artifacts = this.getProgressArtifacts(messages);
        const progressHtml = progressItems.map(item => `
            <div class="progress-item ${this.escapeHtml(item.status)}">
                <span class="progress-dot"></span>
                <span>${this.escapeHtml(item.label)}</span>
            </div>
        `).join('');
        const artifactsHtml = artifacts.length > 0
            ? artifacts.map(item => {
                const actionAttr = item.kind === 'file'
                    ? `data-action="openProgressFile" data-path="${this.escapeHtml(item.value)}"`
                    : `data-action="copyProgressUrl" data-url="${this.escapeHtml(item.value)}"`;
                const icon = item.kind === 'file' ? this.webIcon('file') : this.webIcon('globe');
                return `<button class="progress-artifact" type="button" ${actionAttr} title="${this.escapeHtml(item.value)}">${icon}<span>${this.escapeHtml(item.label)}</span></button>`;
            }).join('')
            : '<div class="progress-empty">Артефактов пока нет</div>';
        const gitStatusClass = gitInfo.changes === 0 ? 'done' : 'pending';
        const gitHubClass = gitInfo.githubCli ? 'done' : 'pending';
        const gitHubLabel = gitInfo.githubCli ? 'GitHub CLI доступен' : 'GitHub CLI недоступен';
        const apkMetadata = this.getAppApkMetadata();
        const apkVersion = apkMetadata?.versionName
            ? `APK ${apkMetadata.versionName}${apkMetadata.versionCode ? ` (${apkMetadata.versionCode})` : ''}`
            : 'APK не найден';
        const apkSha = apkMetadata?.sha256 ? `SHA ${apkMetadata.sha256.slice(0, 12)}…${apkMetadata.sha256.slice(-8)}` : 'SHA недоступен';
        const wsClientCount = this.liveClientCount();
        const liveLabel = wsClientCount === 1 ? 'Подключен 1 клиент' : `Подключено клиентов: ${wsClientCount}`;

        return `<aside class="progress-panel" aria-label="Прогресс задачи">
            <div class="progress-title">Прогресс</div>
            <div class="progress-list">${progressHtml}</div>
            <div class="progress-divider"></div>
            <div class="progress-subtitle">Live-канал</div>
            <div class="progress-section">
                <div class="progress-item done"><span class="progress-dot"></span><span>WebSocket обновления включены</span></div>
                <div class="progress-item ${wsClientCount > 0 ? 'done' : 'pending'}"><span class="progress-dot"></span><span>${this.escapeHtml(liveLabel)}</span></div>
            </div>
            <div class="progress-divider"></div>
            <div class="progress-subtitle">Версии</div>
            <div class="progress-section">
                <div class="progress-item done"><span class="progress-dot"></span><span>${this.escapeHtml(`EXT ${this.getExtensionVersion()}`)}</span></div>
                <div class="progress-item ${apkMetadata ? 'done' : 'pending'}"><span class="progress-dot"></span><span>${this.escapeHtml(apkVersion)}</span></div>
                <div class="progress-item ${apkMetadata?.sha256 ? 'done' : 'pending'}"><span class="progress-dot"></span><span>${this.escapeHtml(apkSha)}</span></div>
            </div>
            <div class="progress-divider"></div>
            <div class="progress-subtitle">Сведения о ветке</div>
            <div class="progress-section">
                <div class="progress-item ${gitStatusClass}">
                    <span class="progress-dot"></span>
                    <span>${this.escapeHtml(gitInfo.changes === 0 ? 'Нет изменений' : `Изменений: ${gitInfo.changes}`)}</span>
                </div>
                <button class="progress-button" type="button" data-action="openScm">${this.webIcon('branch')}<span>Действия Git</span></button>
                <button class="progress-button" type="button" data-action="showBranch">${this.webIcon('branch')}<span>${this.escapeHtml(branchLabel)}</span></button>
                <div class="progress-item ${gitHubClass}">
                    <span class="progress-dot"></span>
                    <span>${this.escapeHtml(gitHubLabel)}</span>
                </div>
            </div>
            <div class="progress-divider"></div>
            <div class="progress-subtitle">Артефакты</div>
            <div class="progress-section">${artifactsHtml}</div>
        </aside>`;
    }

    private versionChipLabel(apkMetadata?: AppApkMetadata): string {
        const extensionVersion = this.getExtensionVersion();
        const apkVersion = apkMetadata?.versionName || 'n/a';
        return `EXT ${extensionVersion} · APK ${apkVersion}`;
    }

    private versionChipTitle(apkMetadata?: AppApkMetadata): string {
        const parts = [
            `VS Code extension: ${this.getExtensionVersion()}`,
            `Android APK: ${apkMetadata?.versionName || 'unknown'}${apkMetadata?.versionCode ? ` (${apkMetadata.versionCode})` : ''}`,
            apkMetadata?.sha256 ? `SHA-256: ${apkMetadata.sha256}` : '',
            apkMetadata?.sizeBytes ? `Size: ${this.formatBytes(apkMetadata.sizeBytes)}` : ''
        ].filter(Boolean);
        return parts.join('\n');
    }

    private liveChipLabel(isBusy: boolean): string {
        const clients = this.liveClientCount();
        if (isBusy) return clients > 0 ? `Live · ${clients}` : 'Live';
        return clients > 0 ? `Live · ${clients}` : 'Live';
    }

    private liveChipTitle(isBusy: boolean): string {
        const clients = this.liveClientCount();
        const state = isBusy ? 'Codex работает сейчас' : 'Готов к live-обновлениям';
        const phoneLine = clients === 1
            ? 'Подключен телефон/web-клиент: 1'
            : `Подключено телефонов/web-клиентов: ${clients}`;
        return [state, phoneLine, 'Чат, действия и прогресс передаются через WebSocket.'].join('\n');
    }

    private isActionResultMessage(message: CodexChatMessage): boolean {
        const content = (message.content || '').trimStart();
        return content.startsWith('Действие выполнено:') || content.startsWith('Действие завершилось ошибкой:');
    }

    private renderActionTimeline(actions: RemoteCodeActionEvent[]): string {
        const summaryEvent = this.latestWorkSummaryEvent(actions);
        const timelineActions = actions.filter(event => event.type !== 'work_summary');
        const recent = this.recentActionTimelineEvents(timelineActions).slice(-18);
        if (recent.length === 0 && !summaryEvent) return '';
        const completedCommands = recent.filter(event => this.isCommandTimelineEvent(event) && event.status === 'completed');
        const summaryCommandCount = summaryEvent?.completedCommandCount && summaryEvent.completedCommandCount > 0
            ? summaryEvent.completedCommandCount
            : completedCommands.length;
        const isRunning = summaryEvent?.status === 'running'
            || recent.some(event => event.status === 'running' || event.status === 'approved');
        const visibleEvents = recent
            .filter(event => !(this.isCommandTimelineEvent(event) && event.status === 'completed'))
            .slice(-8);
        const summary = summaryEvent?.detail || this.actionTimelineSummary(recent, summaryCommandCount, isRunning);
        const parts: string[] = [];
        parts.push(`<div class="work-summary-line ${isRunning ? 'running' : 'done'}"><span class="work-dot"></span><strong>${this.escapeHtml(summary)}</strong></div>`);
        if (summaryCommandCount > 0) {
            const word = this.pluralRu(summaryCommandCount, 'команда', 'команды', 'команд');
            const entries = completedCommands.slice(-6).map(event => {
                const command = this.compactActionDetail(event);
                const detail = (event.stdout || event.stderr || '').trim();
                return `<div class="action-log-entry"><strong>${this.escapeHtml(command)}</strong>${detail ? `<pre>${this.escapeHtml(detail).slice(0, 1800)}</pre>` : ''}</div>`;
            }).join('');
            parts.push(`<details class="action-log">
                <summary class="action-log-summary">${this.webIcon('terminal')}<strong>Выполнено ${summaryCommandCount} ${word}</strong></summary>
                <div class="action-log-body">${entries}</div>
            </details>`);
        }
        for (const event of visibleEvents) {
            const label = this.actionTimelineLabel(event);
            const detail = this.compactActionDetail(event);
            parts.push(`<div class="action-line ${this.escapeHtml(event.status)}">${this.webIcon(this.actionTimelineIcon(event))}<strong>${this.escapeHtml(label)}</strong>${detail ? `<span>${this.escapeHtml(detail)}</span>` : ''}</div>`);
        }
        return parts.length ? `<div class="action-timeline">${parts.join('')}</div>` : '';
    }

    private latestWorkSummaryEvent(events: RemoteCodeActionEvent[]): RemoteCodeActionEvent | undefined {
        return events
            .filter(event => event.type === 'work_summary' && event.detail)
            .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
            .pop();
    }

    private isCommandTimelineEvent(event: Pick<RemoteCodeActionEvent, 'type'>): boolean {
        return String(event.type || '').toLowerCase().includes('command');
    }

    private actionTimelineSummary(events: RemoteCodeActionEvent[], completedCommandCount: number, isRunning: boolean): string {
        const timestamps = events
            .map(event => Number(event.timestamp || 0))
            .filter(timestamp => Number.isFinite(timestamp) && timestamp > 0);
        const rawDuration = timestamps.length >= 2
            ? Math.max(...timestamps) - Math.min(...timestamps)
            : 0;
        return this.actionTimelineSummaryFromDuration(rawDuration, completedCommandCount, isRunning);
    }

    private actionTimelineSummaryFromDuration(rawDuration: number, completedCommandCount: number, isRunning: boolean): string {
        const maxSummaryDurationMs = 3 * 60 * 60 * 1000;
        const duration = rawDuration > 0 && rawDuration <= maxSummaryDurationMs
            ? this.formatWorkDuration(rawDuration)
            : '';
        const verb = isRunning ? 'Работает' : 'Работал';
        const durationText = duration ? ` на протяжении ${duration}` : '';
        const commandText = completedCommandCount > 0
            ? `, выполнено ${completedCommandCount} ${this.pluralRu(completedCommandCount, 'команда', 'команды', 'команд')}`
            : '';
        return `${verb}${durationText}${commandText}`;
    }

    private recentActionTimelineEvents(events: RemoteCodeActionEvent[]): RemoteCodeActionEvent[] {
        const sorted = events
            .filter(event => Number.isFinite(Number(event.timestamp || 0)) && Number(event.timestamp || 0) > 0)
            .slice()
            .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
        if (sorted.length <= 1) return sorted;

        const idleGapMs = 30 * 60 * 1000;
        let startIndex = sorted.length - 1;
        for (let index = sorted.length - 1; index > 0; index--) {
            const gap = Number(sorted[index].timestamp || 0) - Number(sorted[index - 1].timestamp || 0);
            if (gap > idleGapMs) break;
            startIndex = index - 1;
        }
        return sorted.slice(startIndex);
    }

    private formatWorkDuration(durationMs: number): string {
        const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (minutes > 0 && seconds > 0) return `${minutes}м ${seconds}с`;
        if (minutes > 0) return `${minutes}м`;
        if (seconds > 0) return `${seconds}с`;
        return '';
    }

    private actionTimelineLabel(event: RemoteCodeActionEvent): string {
        if (event.type === 'model_progress') return event.title || 'Прогресс модели';
        switch (event.status) {
            case 'running': return 'Выполняется';
            case 'pending': return event.actionable ? 'Ожидает подтверждения' : 'Ожидает';
            case 'approved': return 'Разрешено';
            case 'completed': return 'Выполнено';
            case 'failed': return 'Ошибка';
            case 'denied': return 'Отклонено';
            default: return event.title || event.type;
        }
    }

    private actionTimelineIcon(event: RemoteCodeActionEvent): 'terminal' | 'file' | 'x' | 'play' {
        if (event.status === 'failed' || event.status === 'denied') return 'x';
        if (event.type.includes('patch')) return 'file';
        if (event.type.includes('command')) return 'terminal';
        return 'play';
    }

    private compactActionDetail(event: RemoteCodeActionEvent): string {
        const source = event.command || event.filePath || event.detail || event.title || event.type;
        return source
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 140);
    }

    private getProgressItems(
        messages: CodexChatMessage[],
        actions: RemoteCodeActionEvent[],
        isBusy: boolean
    ): Array<{ label: string; status: 'pending' | 'running' | 'done' }> {
        let latestLabels: string[] = [];
        const latestUserIndex = (() => {
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role !== 'user' || !messages[i].content.trim()) continue;
                const labels = this.extractProgressTaskLabels(messages[i].content);
                if (labels.length > 0) {
                    latestLabels = labels;
                    return i;
                }
            }
            return -1;
        })();
        const latestUser = latestUserIndex >= 0 ? messages[latestUserIndex] : undefined;
        const hasAssistantAfter = latestUserIndex >= 0
            ? messages.slice(latestUserIndex + 1).some(message => message.role === 'assistant' && message.content.trim())
            : false;
        const items = latestLabels.length > 0
            ? latestLabels.slice(0, 5).map((label, index) => ({
                label,
                status: (isBusy ? (index === 0 ? 'running' : 'pending') : (hasAssistantAfter ? 'done' : 'pending')) as 'pending' | 'running' | 'done'
            }))
            : [{
                label: latestUser ? 'Обработать текущий запрос' : 'Ожидание запроса',
                status: (isBusy ? 'running' : (hasAssistantAfter ? 'done' : 'pending')) as 'pending' | 'running' | 'done'
            }];

        const activeAction = actions.slice().reverse().find(action => action.status === 'pending' || action.status === 'running' || action.status === 'approved');
        if (activeAction) {
            items.push({
                label: activeAction.status === 'pending'
                    ? `Ожидает подтверждения: ${activeAction.title}`
                    : `Выполняется действие: ${activeAction.title}`,
                status: activeAction.status === 'pending' ? 'pending' : 'running'
            });
        } else {
            const completedAction = actions.slice().reverse().find(action => action.status === 'completed' || action.status === 'denied' || action.status === 'failed');
            if (completedAction) {
                items.push({
                    label: completedAction.status === 'completed'
                        ? `Действие выполнено: ${completedAction.title}`
                        : `Действие закрыто: ${completedAction.title}`,
                    status: 'done'
                });
            }
        }
        return items.slice(0, 6);
    }

    private extractProgressTaskLabels(content: string): string[] {
        const labels: string[] = [];
        let normalized = content.replace(/\r\n/g, '\n');
        const requestMatch = normalized.match(/##\s*My request for Codex:\s*/i);
        if (requestMatch?.index !== undefined) {
            normalized = normalized.slice(requestMatch.index + requestMatch[0].length);
        }
        for (const rawLine of normalized.split('\n')) {
            const line = rawLine.trim();
            if (!line || this.isTechnicalProgressLine(line) || line.startsWith('#') || /^Files mentioned by the user/i.test(line)) continue;
            if (/^[A-Za-z]:[\\/]/.test(line) || /^##\s+.+\.(?:png|jpe?g|webp|gif|txt|md|log|json):/i.test(line)) continue;
            const match = line.match(/^(?:\d+[\.)]|[-*•])\s+(.{3,})$/);
            if (match?.[1]) {
                labels.push(match[1].replace(/\s+/g, ' ').slice(0, 120));
            }
            if (labels.length >= 5) break;
        }
        if (labels.length === 0 && normalized.trim()) {
            const firstTextLine = normalized
                .split('\n')
                .map(line => line.trim())
                .find(line => line && !this.isTechnicalProgressLine(line) && !line.startsWith('#') && !/^[A-Za-z]:[\\/]/.test(line));
            if (firstTextLine) labels.push(firstTextLine.replace(/\s+/g, ' ').slice(0, 140));
        }
        return labels;
    }

    private isTechnicalProgressLine(line: string): boolean {
        const normalized = this.decodeBasicHtmlEntities(line)
            .replace(/`+/g, '')
            .trim();
        if (!normalized || /^[.\-_*•]+$/.test(normalized)) return true;
        return /^<\/?(?:image|video|audio|file|environment_context|attachments?|user|system)(?:\s|>|$)/i.test(normalized)
            || /^<[^>]+>$/.test(normalized)
            || /^!\[[^\]]*]\([^)]+\)$/.test(normalized)
            || /^##\s+.+\.(?:png|jpe?g|webp|gif|txt|md|log|json):/i.test(normalized)
            || /^#?\s*Files mentioned by the user/i.test(normalized)
            || /^My request for (?:Codex|Code):?$/i.test(normalized)
            || /^<environment_context>/i.test(normalized)
            || /^<\/environment_context>/i.test(normalized)
            || /^(?:path|file|image|photo|screenshot)\s*[:=]\s*/i.test(normalized);
    }

    private decodeBasicHtmlEntities(value: string): string {
        return value
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/g, "'");
    }

    private getGitPanelStatus(): { changes: number; githubCli: boolean } {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        let changes = 0;
        if (folder) {
            try {
                const output = execSync('git status --short', {
                    cwd: folder,
                    encoding: 'utf8',
                    timeout: 1500,
                    windowsHide: true
                }).trim();
                changes = output ? output.split(/\r?\n/).filter(Boolean).length : 0;
            } catch {
                changes = 0;
            }
        }
        const githubCli = (() => {
            try {
                const check = spawnSync('gh', ['--version'], {
                    encoding: 'utf8',
                    timeout: 1000,
                    windowsHide: true
                });
                return check.status === 0;
            } catch {
                return false;
            }
        })();
        return { changes, githubCli };
    }

    private getProgressArtifacts(messages: CodexChatMessage[]): Array<{ kind: 'file' | 'url'; label: string; value: string }> {
        const artifacts: Array<{ kind: 'file' | 'url'; label: string; value: string }> = [];
        const seen = new Set<string>();
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspace) {
            const readme = path.join(workspace, 'README.md');
            if (fs.existsSync(readme)) {
                artifacts.push({ kind: 'file', label: 'README.md', value: readme });
                seen.add(readme);
            }
        }
        for (const message of messages.slice().reverse()) {
            for (const attachment of this.normalizeLocalAttachments(message.attachments || [])) {
                if (seen.has(attachment.path)) continue;
                artifacts.push({ kind: 'file', label: attachment.name, value: attachment.path });
                seen.add(attachment.path);
                if (artifacts.length >= 4) break;
            }
            if (artifacts.length >= 4) break;
        }
        const localBase = `http://127.0.0.1:${this._port}`;
        const publicUrl = this.getPublicUrl();
        const urls = [
            `${localBase}/api/status`,
            `${localBase}/api/codex/send`,
            `${localBase}/api/tunnel/status`,
            ...(publicUrl ? [publicUrl] : [])
        ];
        for (const value of urls) {
            artifacts.push({ kind: 'url', label: value.replace(/^https?:\/\//, ''), value });
        }
        return artifacts.slice(0, 8);
    }

    private renderMessageAttachments(attachments?: LocalAttachment[]): string {
        const files = this.normalizeLocalAttachments(attachments || []);
        if (files.length === 0) return '';
        const cards = files.map(file => this.renderAttachmentCard({
            name: file.name,
            path: file.path,
            mimeType: file.mimeType,
            size: file.size
        })).join('');
        return `<div class="attachments-list">${cards}</div>`;
    }

    private renderMessageContent(content: string, changeSummary?: GitChangeSummary): string {
        const gitSummary = changeSummary?.files?.length
            ? changeSummary
            : this.getGitChangeSummaryFromMessage(content);
        const cleanedContent = content
            .replace(/^\s*::git-(?:stage|commit|push)\{[^\n]*\}\s*$/gmi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trimEnd();
        const lines = cleanedContent.replace(/\r\n/g, '\n').split('\n');
        const chunks: string[] = [];
        let buffer: string[] = [];
        let renderedExplicitChanges = false;
        const flush = () => {
            if (buffer.length === 0) return;
            chunks.push(this.renderMarkdownBlock(buffer));
            buffer = [];
        };

        for (let i = 0; i < lines.length; i++) {
            const header = lines[i];
            if (/^\s*Изменено\s+\d+\s+файл/i.test(header)) {
                const changes: Array<{ path: string; plus?: string; minus?: string }> = [];
                let j = i + 1;
                while (j < lines.length) {
                    if (!lines[j].trim()) {
                        j++;
                        continue;
                    }
                    const parsed = this.parseChangedFileLine(lines[j]);
                    if (!parsed) break;
                    changes.push(parsed);
                    j++;
                }
                if (changes.length > 0) {
                    flush();
                    chunks.push(this.renderExplicitChangeCard(header, changes));
                    renderedExplicitChanges = true;
                    i = j - 1;
                    continue;
                }
            }
            buffer.push(header);
        }
        flush();
        if (gitSummary && !renderedExplicitChanges) {
            chunks.push(this.renderGitChangeCard(gitSummary));
        }
        const linkedCards = this.renderLinkedFileCards(cleanedContent);
        return [chunks.join('\n'), linkedCards].filter(Boolean).join('\n');
    }

    private renderMarkdownBlock(lines: string[]): string {
        const parts: string[] = [];
        let paragraph: string[] = [];
        const flushParagraph = () => {
            const clean = paragraph.filter(line => line.trim().length > 0);
            if (clean.length > 0) {
                parts.push(`<p>${clean.map(line => `<span class="plain-line">${this.renderInlineContent(line.trim())}</span>`).join('<br>')}</p>`);
            }
            paragraph = [];
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const fenceMatch = line.match(/^\s*```([A-Za-z0-9_+.#-]*)\s*$/);
            if (fenceMatch) {
                flushParagraph();
                const language = fenceMatch[1]?.trim() || 'text';
                const codeLines: string[] = [];
                i++;
                while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
                    codeLines.push(lines[i]);
                    i++;
                }
                parts.push(`<div class="code-block"><div class="code-head">${this.escapeHtml(language)}</div><pre>${this.escapeHtml(codeLines.join('\n'))}</pre></div>`);
                continue;
            }
            if (!line.trim()) {
                flushParagraph();
                continue;
            }
            const bulletMatch = line.match(/^\s*[-*•]\s+(.+)$/);
            const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
            if (bulletMatch || orderedMatch) {
                flushParagraph();
                const ordered = Boolean(orderedMatch);
                const items: string[] = [];
                const matchListItem = (value: string) => ordered
                    ? value.match(/^\s*\d+[.)]\s+(.+)$/)
                    : value.match(/^\s*[-*•]\s+(.+)$/);
                while (i < lines.length) {
                    const current = lines[i];
                    if (!current.trim()) {
                        let next = i + 1;
                        while (next < lines.length && !lines[next].trim()) next++;
                        if (next < lines.length && matchListItem(lines[next])) {
                            i = next;
                            continue;
                        }
                        break;
                    }
                    const currentMatch = matchListItem(current);
                    if (!currentMatch) {
                        i--;
                        break;
                    }
                    items.push(`<li>${this.renderInlineContent(currentMatch[1].trim())}</li>`);
                    i++;
                }
                parts.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
                continue;
            }
            paragraph.push(line);
        }
        flushParagraph();
        return parts.join('');
    }

    private renderLinkedFileCards(content: string): string {
        const cards: string[] = [];
        const seen = new Set<string>();
        const linkRegex = /\[([^\]]+\.[A-Za-z0-9]{1,8})\]\(([^)]+)\)/g;
        let match: RegExpExecArray | null;
        while ((match = linkRegex.exec(content)) !== null && cards.length < 4) {
            const name = match[1].trim();
            const rawTarget = match[2].trim().replace(/^<|>$/g, '');
            const target = rawTarget.replace(/:\d+$/, '');
            if (!target || seen.has(target)) continue;
            if (!path.isAbsolute(target) && !/^[a-z]+:\/\//i.test(target)) continue;
            seen.add(target);
            cards.push(this.renderAttachmentCard({
                name,
                path: target,
                mimeType: this.fileKindLabel(name),
                size: 0
            }));
        }
        return cards.length ? `<div class="message-file-cards">${cards.join('')}</div>` : '';
    }

    private renderAttachmentCard(file: { name: string; path?: string; mimeType?: string; size?: number }): string {
        const dataUri = this.imageDataUri(file);
        const subtitle = [
            this.fileKindLabel(file.name, file.mimeType),
            file.size ? this.formatBytes(file.size) : ''
        ].filter(Boolean).join(' · ');
        const openAttrs = file.path
            ? `data-action="openProgressFile" data-path="${this.escapeHtml(file.path)}"`
            : '';
        if (dataUri) {
            return `<div class="attachment-card image-card" title="${this.escapeHtml(file.path || file.name)}">
                <button type="button" class="image-thumb" data-preview-src="${this.escapeHtml(dataUri)}" data-preview-name="${this.escapeHtml(file.name || 'image')}"><img src="${this.escapeHtml(dataUri)}" alt="${this.escapeHtml(file.name || 'image')}"></button>
                <span>
                    <span class="attachment-card-title">${this.escapeHtml(file.name || 'image')}</span>
                    <span class="attachment-card-subtitle">${this.escapeHtml(subtitle || 'Изображение')}</span>
                </span>
                ${file.path ? `<button type="button" class="attachment-card-action" ${openAttrs}>Открыть</button>` : ''}
            </div>`;
        }
        return `<button type="button" class="attachment-card ${file.path ? 'clickable' : ''}" ${openAttrs} title="${this.escapeHtml(file.path || file.name)}">
            <span class="attachment-card-icon">${this.webIcon('file')}</span>
            <span>
                <span class="attachment-card-title">${this.escapeHtml(file.name || 'attachment')}</span>
                <span class="attachment-card-subtitle">${this.escapeHtml(subtitle || 'Файл')}</span>
            </span>
            <span class="attachment-card-action">Открыть</span>
        </button>`;
    }

    private imageDataUri(file: { path?: string; mimeType?: string; size?: number }): string | undefined {
        if (!file.path || !file.mimeType?.startsWith('image/') || (file.size || 0) > 6 * 1024 * 1024) return undefined;
        try {
            const filePath = path.resolve(file.path);
            if (!this.isAttachmentPreviewPathAllowed(filePath)) return undefined;
            const stat = fs.statSync(filePath);
            if (!stat.isFile() || stat.size > 6 * 1024 * 1024) return undefined;
            const data = fs.readFileSync(filePath);
            return `data:${this.normalizeAttachmentMime(filePath, file.mimeType)};base64,${data.toString('base64')}`;
        } catch {
            return undefined;
        }
    }

    private isAttachmentPreviewPathAllowed(filePath: string): boolean {
        const resolved = path.resolve(filePath);
        const roots = [
            ...this.getWorkspaceRoots(),
            path.resolve(this._context.globalStorageUri.fsPath)
        ];
        return roots.some(root => this.isInsideWorkspaceRoot(resolved, root));
    }

    private fileKindLabel(name: string, mimeType?: string): string {
        const ext = path.extname(name || '').replace('.', '').toUpperCase();
        if (ext === 'MD') return 'Документ · MD';
        if (ext) return `Файл · ${ext}`;
        if (mimeType?.startsWith('image/')) return 'Изображение';
        return mimeType || 'Файл';
    }

    private parseChangedFileLine(line: string): { path: string; plus?: string; minus?: string } | undefined {
        const match = line.match(/^\s*(?:[-*•]\s*)?(.+?)\s+(\+\d+)(?:\s+(-\d+))?\s*$/);
        if (!match) return undefined;
        const filePath = match[1].trim();
        if (!/[\\/]/.test(filePath) && !/\.[a-z0-9]{1,8}$/i.test(filePath)) return undefined;
        return { path: filePath, plus: match[2], minus: match[3] };
    }

    private renderExplicitChangeCard(header: string, changes: Array<{ path: string; plus?: string; minus?: string }>): string {
        const totals = this.parseChangeHeaderTotals(header, changes);
        const rows = changes.map(change => this.renderChangeRow({
            path: change.path,
            additions: this.parseDelta(change.plus),
            deletions: Math.abs(this.parseDelta(change.minus))
        })).join('');
        return `<div class="change-card collapsed"><div class="change-head">${this.renderChangeHeader(totals.fileCount, totals.additions, totals.deletions)}<span class="change-actions"><button type="button" class="change-action" data-change-action="undo" title="Открыть Source Control для отмены изменений"><span>Отменить</span>${this.webIcon('undo')}</button><button type="button" class="change-action" data-change-action="review"><span>Проверить</span>${this.webIcon('external')}</button><button type="button" class="change-action icon-only" data-change-action="toggle" title="Свернуть/развернуть">${this.webIcon('expand')}</button></span></div>${rows}</div>`;
    }

    private renderGitChangeCard(summary: GitChangeSummary): string {
        const header = this.renderChangeHeader(summary.fileCount || summary.files.length, summary.additions, summary.deletions);
        const rows = summary.files.map(file => this.renderChangeRow(file)).join('');
        return `<div class="change-card collapsed" data-commit="${this.escapeHtml(summary.commit || '')}" data-cwd="${this.escapeHtml(summary.cwd || '')}"><div class="change-head">${header}<span class="change-actions"><button type="button" class="change-action" data-change-action="undo" title="Открыть Source Control для отмены изменений"><span>Отменить</span>${this.webIcon('undo')}</button><button type="button" class="change-action" data-change-action="review"><span>Проверить</span>${this.webIcon('external')}</button><button type="button" class="change-action icon-only" data-change-action="toggle" title="Свернуть/развернуть">${this.webIcon('expand')}</button></span></div>${rows}</div>`;
    }

    private renderChangeHeader(fileCount: number, additions: number, deletions: number): string {
        const fileWord = this.pluralRu(fileCount, 'файл', 'файла', 'файлов');
        return `<span class="change-summary"><span class="change-title">Изменено ${this.escapeHtml(String(fileCount))} ${fileWord}</span><span class="delta plus">+${this.escapeHtml(String(additions))}</span><span class="delta minus">-${this.escapeHtml(String(deletions))}</span></span>`;
    }

    private parseChangeHeaderTotals(header: string, changes: Array<{ plus?: string; minus?: string }>): { fileCount: number; additions: number; deletions: number } {
        const fallback = {
            fileCount: changes.length,
            additions: changes.reduce((sum, change) => sum + this.parseDelta(change.plus), 0),
            deletions: changes.reduce((sum, change) => sum + Math.abs(this.parseDelta(change.minus)), 0)
        };
        const match = header.match(/Изменено\s+(\d+)\s+файл\S*\s+\+(\d+)\s+-(\d+)/i);
        if (!match) return fallback;
        const fileCount = Number(match[1]);
        const additions = Number(match[2]);
        const deletions = Number(match[3]);
        return {
            fileCount: Number.isFinite(fileCount) ? fileCount : fallback.fileCount,
            additions: Number.isFinite(additions) ? additions : fallback.additions,
            deletions: Number.isFinite(deletions) ? deletions : fallback.deletions
        };
    }

    private renderChangeRow(change: GitChangeFile): string {
        const additions = change.additions ? `<span class="delta plus">+${this.escapeHtml(String(change.additions))}</span>` : '';
        const deletions = change.deletions ? `<span class="delta minus">-${this.escapeHtml(String(change.deletions))}</span>` : '';
        return `<button type="button" class="change-row" data-path="${this.escapeHtml(change.path)}"><span class="change-path">${this.escapeHtml(change.path)}</span>${additions}${deletions}<span class="row-chev">${this.webIcon('chevronDown')}</span></button>`;
    }

    private webIcon(name: 'archive' | 'branch' | 'chevronDown' | 'clock' | 'command' | 'copy' | 'edit' | 'expand' | 'extensions' | 'external' | 'file' | 'folder' | 'globe' | 'laptop' | 'lock' | 'more' | 'panel' | 'pin' | 'play' | 'plus' | 'qr' | 'scrollDown' | 'search' | 'send' | 'settings' | 'sparkle' | 'stop' | 'terminal' | 'thumbDown' | 'thumbUp' | 'trash' | 'undo' | 'x'): string {
        switch (name) {
            case 'archive':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="3" rx="1"/><path d="M4 6v7h8V6"/><path d="M6.25 9h3.5"/></svg>';
            case 'branch':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="4" r="1.9"/><circle cx="12" cy="12" r="1.9"/><path d="M4 6v1.4A4.6 4.6 0 0 0 8.6 12H10"/></svg>';
            case 'chevronDown':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.25 6.25 8 10l3.75-3.75"/></svg>';
            case 'clock':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.75"/><path d="M8 4.7V8l2.25 1.5"/></svg>';
            case 'command':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.75" y="2.75" width="4" height="4" rx="1.1"/><rect x="9.25" y="2.75" width="4" height="4" rx="1.1"/><rect x="2.75" y="9.25" width="4" height="4" rx="1.1"/><rect x="9.25" y="9.25" width="4" height="4" rx="1.1"/></svg>';
            case 'copy':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="6" y="5" width="7" height="8" rx="1.2"/><path d="M4 10.5H3.2A1.2 1.2 0 0 1 2 9.3V3.2A1.2 1.2 0 0 1 3.2 2h6.1A1.2 1.2 0 0 1 10.5 3.2V4"/></svg>';
            case 'edit':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.8 2.7a1.35 1.35 0 0 1 1.9 1.9L5.5 11.8 3 12.5l.7-2.5Z"/><path d="M9.8 3.7l2 2"/></svg>';
            case 'expand':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.25 2.75H3.5v2.75"/><path d="M3.5 2.75 7 6.25"/><path d="M9.75 13.25h2.75V10.5"/><path d="M12.5 13.25 9 9.75"/></svg>';
            case 'extensions':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.2h3.8V7H3z"/><path d="M9.2 3.2H13V7H9.2z"/><path d="M3 9h3.8v3.8H3z"/><path d="M9.2 9H13v3.8H9.2z"/></svg>';
            case 'external':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5"/><path d="M6.25 5H11v4.75"/></svg>';
            case 'file':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/><path d="M6 9h4"/><path d="M6 11h3"/></svg>';
            case 'folder':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.25h4.2l1.15-1.5H14v8.75a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5Z"/><path d="M2 6.25h12"/></svg>';
            case 'globe':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.75"/><path d="M2.5 8h11"/><path d="M8 2.25c1.55 1.6 2.25 3.5 2.25 5.75S9.55 12.15 8 13.75C6.45 12.15 5.75 10.25 5.75 8S6.45 3.85 8 2.25Z"/></svg>';
            case 'laptop':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3.5" width="10" height="7" rx="1.2"/><path d="M1.75 12.5h12.5"/></svg>';
            case 'lock':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.25" y="7" width="9.5" height="6.25" rx="1.25"/><path d="M5.25 7V5.25a2.75 2.75 0 0 1 5.5 0V7"/><path d="M8 9.25v1.75"/></svg>';
            case 'more':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r=".9"/><circle cx="8" cy="8" r=".9"/><circle cx="12.5" cy="8" r=".9"/></svg>';
            case 'panel':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.6"/><path d="M8 2.25v11.5"/></svg>';
            case 'pin':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6.2 2.4 7.4 7.4"/><path d="M9.4 3.1 6.1 6.4 3.4 6.2 2.6 7l6.4 6.4.8-.8-.2-2.7 3.3-3.3"/></svg>';
            case 'play':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.75 12 8l-6.5 4.25Z"/></svg>';
            case 'plus':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.25v9.5"/><path d="M3.25 8h9.5"/></svg>';
            case 'qr':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h4v4h-4z"/><path d="M9.5 2.5h4v4h-4z"/><path d="M2.5 9.5h4v4h-4z"/><path d="M9.5 9.5h1.5"/><path d="M12.5 9.5h1"/><path d="M9.5 12.5h4"/><path d="M12.5 10.5v3"/></svg>';
            case 'scrollDown':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v9"/><path d="m4.5 8.5 3.5 3.5 3.5-3.5"/></svg>';
            case 'search':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.1 3.1"/></svg>';
            case 'send':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5v-9"/><path d="M4.5 7 8 3.5 11.5 7"/></svg>';
            case 'settings':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.25"/><path d="M8 1.9v1.4"/><path d="M8 12.7v1.4"/><path d="m3.7 3.7 1 1"/><path d="m11.3 11.3 1 1"/><path d="M1.9 8h1.4"/><path d="M12.7 8h1.4"/><path d="m3.7 12.3 1-1"/><path d="m11.3 4.7 1-1"/></svg>';
            case 'sparkle':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.75 9.25 6.75 14.25 8 9.25 9.25 8 14.25 6.75 9.25 1.75 8 6.75 6.75Z"/></svg>';
            case 'stop':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="6" height="6" rx="1.1"/></svg>';
            case 'terminal':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.25" y="3" width="11.5" height="10" rx="1.4"/><path d="m5 6.25 2 1.75-2 1.75"/><path d="M8.5 10h3"/></svg>';
            case 'thumbDown':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 2.5v7"/><path d="M9.5 13.5 7.5 9.5H3.4a1.4 1.4 0 0 1-1.35-1.75l.8-3.8A1.4 1.4 0 0 1 4.2 2.9h7.3v7H9.2l1.25 2.55a.8.8 0 0 1-.95 1.05Z"/></svg>';
            case 'thumbUp':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 13.5v-7"/><path d="M9.5 2.5 7.5 6.5H3.4a1.4 1.4 0 0 0-1.35 1.75l.8 3.8A1.4 1.4 0 0 0 4.2 13.1h7.3v-7H9.2l1.25-2.55a.8.8 0 0 0-.95-1.05Z"/></svg>';
            case 'trash':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10"/><path d="M6 4.5V3.25h4V4.5"/><path d="m12 4.5-.6 8.25H4.6L4 4.5"/><path d="M6.5 6.75v3.8"/><path d="M9.5 6.75v3.8"/></svg>';
            case 'undo':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.2 5.2H3.2V2.2"/><path d="M3.45 5.2A5.4 5.4 0 1 1 5.1 11"/></svg>';
            case 'x':
                return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5 11.5 11.5"/><path d="M11.5 4.5 4.5 11.5"/></svg>';
        }
    }

    private parseDelta(value?: string): number {
        if (!value) return 0;
        const parsed = Number(value.replace(/[+-]/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    private pluralRu(count: number, one: string, few: string, many: string): string {
        const mod10 = count % 10;
        const mod100 = count % 100;
        if (mod10 === 1 && mod100 !== 11) return one;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
        return many;
    }

    private getGitChangeSummaryFromMessage(content: string, messageTimestamp?: number): GitChangeSummary | undefined {
        if (!/::git-(?:stage|commit|push)\{/.test(content)) return undefined;
        const cwd = this.extractDirectiveCwd(content) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const candidates = this.extractCommitHashCandidates(content);
        const nearbyCommit = this.resolveGitCommitNearTimestamp(cwd, messageTimestamp);
        if (nearbyCommit) candidates.push(nearbyCommit);
        if (candidates.length === 0 && /::git-(?:commit|push)\{/.test(content)) {
            const headCommit = this.resolveGitHeadCommit(cwd);
            if (headCommit) candidates.push(headCommit);
        }
        for (const commit of Array.from(new Set(candidates))) {
            const key = `${cwd}:${commit}`;
            if (this.gitChangeSummaryCache.has(key)) {
                const cached = this.gitChangeSummaryCache.get(key);
                if (cached) return cached;
                continue;
            }
            const summary = this.readGitChangeSummary(commit, cwd);
            this.gitChangeSummaryCache.set(key, summary);
            if (this.gitChangeSummaryCache.size > 40) {
                const first = this.gitChangeSummaryCache.keys().next().value;
                if (first) this.gitChangeSummaryCache.delete(first);
            }
            if (summary) return summary;
        }
        return undefined;
    }

    private extractCommitHash(content: string): string | undefined {
        return this.extractCommitHashCandidates(content)[0];
    }

    private extractCommitHashCandidates(content: string): string[] {
        const candidates: string[] = [];
        const add = (value?: string): void => {
            const hash = (value || '').trim();
            if (/^[0-9a-f]{7,40}$/i.test(hash) && !candidates.some(existing => existing.toLowerCase() === hash.toLowerCase())) {
                candidates.push(hash);
            }
        };
        const patterns = [
            /(?:commit|коммит)\s*:?\s*`?([0-9a-f]{7,40})`?/ig,
            /(?:github|push|pushed|запушено|залито|загружено)[^\n`]*`?([0-9a-f]{7,40})`?/ig,
            /`([0-9a-f]{7,40})`/ig
        ];
        for (const pattern of patterns) {
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(content)) !== null) {
                add(match[1]);
            }
        }
        return candidates;
    }

    private resolveGitCommitNearTimestamp(cwd: string, timestamp?: number): string | undefined {
        if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return undefined;
        const finalCwd = this.resolveGitSummaryCwd(cwd);
        const before = new Date(timestamp + 2 * 60 * 1000).toISOString();
        try {
            const output = execSync(`git log -1 --format=%H --before="${before}"`, {
                cwd: finalCwd,
                encoding: 'utf8',
                timeout: 2000,
                windowsHide: true
            }).trim();
            return /^[0-9a-f]{7,40}$/i.test(output) ? output : undefined;
        } catch {
            return undefined;
        }
    }

    private resolveGitHeadCommit(cwd: string): string | undefined {
        try {
            const output = execSync('git rev-parse HEAD', {
                cwd: this.resolveGitSummaryCwd(cwd),
                encoding: 'utf8',
                timeout: 1500,
                windowsHide: true
            }).trim();
            return /^[0-9a-f]{7,40}$/i.test(output) ? output : undefined;
        } catch {
            return undefined;
        }
    }

    private extractDirectiveCwd(content: string): string | undefined {
        const match = content.match(/::git-(?:stage|commit|push)\{[^}]*cwd="([^"]+)"/);
        if (!match?.[1]) return undefined;
        return match[1].replace(/\\\\/g, '\\');
    }

    private readGitChangeSummary(commit: string, cwd: string): GitChangeSummary | undefined {
        try {
            const safeCommit = /^[0-9a-f]{7,40}$/i.test(commit) ? commit : 'HEAD';
            const finalCwd = this.resolveGitSummaryCwd(cwd);
            const output = execSync(`git show --numstat --format= --find-renames ${safeCommit}`, {
                cwd: finalCwd,
                encoding: 'utf8',
                timeout: 2500,
                windowsHide: true
            }).trim();
            const files: GitChangeFile[] = [];
            for (const line of output.split(/\r?\n/)) {
                const parts = line.split('\t');
                if (parts.length < 3) continue;
                const binary = parts[0] === '-' || parts[1] === '-';
                if (binary) continue;
                const additions = Number(parts[0]);
                const deletions = Number(parts[1]);
                const filePath = parts.slice(2).join('\t').trim();
                if (!filePath) continue;
                if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue;
                files.push({
                    path: filePath,
                    additions,
                    deletions
                });
            }
            if (files.length === 0) return undefined;
            return {
                commit: safeCommit,
                cwd: finalCwd,
                files,
                fileCount: files.length,
                additions: files.reduce((sum, file) => sum + file.additions, 0),
                deletions: files.reduce((sum, file) => sum + file.deletions, 0)
            };
        } catch {
            return undefined;
        }
    }

    private resolveGitSummaryCwd(cwd: string): string {
        return cwd && path.isAbsolute(cwd) && fs.existsSync(cwd)
            ? cwd
            : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    }

    private renderInlineContent(value: string): string {
        const parts = value.split(/(`[^`]+`)/g);
        return parts.map(part => {
            if (part.startsWith('`') && part.endsWith('`')) {
                return `<code>${this.escapeHtml(part.slice(1, -1))}</code>`;
            }
            return this.renderInlinePlain(part);
        }).join('');
    }

    private renderInlinePlain(value: string): string {
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let html = '';
        let lastIndex = 0;
        let linkMatch: RegExpExecArray | null;
        while ((linkMatch = linkRegex.exec(value)) !== null) {
            html += this.renderInlinePlainTokens(value.slice(lastIndex, linkMatch.index));
            const label = linkMatch[1].trim();
            const rawTarget = linkMatch[2].trim().replace(/^<|>$/g, '').replace(/:\d+$/, '');
            if (rawTarget && (path.isAbsolute(rawTarget) || /^[a-z]+:\/\//i.test(rawTarget))) {
                html += `<button type="button" class="inline-file-link" data-action="openProgressFile" data-path="${this.escapeHtml(rawTarget)}">${this.escapeHtml(label)}</button>`;
            } else {
                html += this.escapeHtml(label);
            }
            lastIndex = linkMatch.index + linkMatch[0].length;
        }
        html += this.renderInlinePlainTokens(value.slice(lastIndex));
        return html;
    }

    private renderInlinePlainTokens(value: string): string {
        const tokenRegex = /(C:\\[^\s`]+|(?:[\w.-]+[\\/])+[\w.@%+\-()]+|\b\d+\.\d+\.\d+\b|\b[0-9a-f]{7,40}\b|\b(?:npm run compile|vsce package|assembleDebug|lintDebug|Developer: Reload Window|200 OK)\b)/gi;
        let html = '';
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = tokenRegex.exec(value)) !== null) {
            html += this.escapeHtml(value.slice(lastIndex, match.index));
            html += `<code>${this.escapeHtml(match[0])}</code>`;
            lastIndex = match.index + match[0].length;
        }
        html += this.escapeHtml(value.slice(lastIndex));
        return html;
    }

    private formatBytes(bytes: number): string {
        if (!Number.isFinite(bytes) || bytes <= 0) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }





    private saveChatHistory(chatId: string, messages: ChatMessage[]): void {
        // Сохраняем историю в контексте расширения
        try {
            const key = `chat_history_${chatId}`;
            this._context.globalState.update(key, messages.slice(-100)); // последние 100
        } catch (e) {
            // ignore
        }
    }

    private restoreChatHistory(): void {
        // Восстанавливаем сохранённые чаты при старте сервера
        try {
            const keys = this._context.globalState.keys();
            const chatKeys = keys.filter((k: string) => k.startsWith('chat_history_'));
            
            // Также проверяем currentChatId из storage
            const savedChatId = this._context.globalState.get<string>('current_chat_id', 'default');
            this.currentChatId = savedChatId;

            // Восстанавливаем последний выбранный агент
            // Legacy chat selection is intentionally not copied into the Remote Code model.

            for (const key of chatKeys) {
                const chatId = key.replace('chat_history_', '');
                const messages = this._context.globalState.get<ChatMessage[]>(key, []);
                if (messages.length > 0) {
                    this.chatHistory.set(chatId, messages);
                    console.log(`[RemoteCodeOnPC] Restored chat ${chatId} with ${messages.length} messages`);
                }
            }

            // Если история пуста — добавляем приветственное сообщение (для нового/standalone режима)
            if (this.chatHistory.size === 0) {
                const welcome: ChatMessage = {
                    id: 'msg_welcome',
                    role: 'assistant',
                    content: '✅ **Remote Code on PC** запущен и готов к работе!\n\nНапишите сообщение, чтобы начать чат с Copilot. Вы также можете:\n- Просматривать файлы проекта\n- Запускать команды в терминале\n- Смотреть диагностику\n\nВыберите модель в верхней панели.',
                    timestamp: Date.now(),
                    agentName: 'auto'
                };
                this.chatHistory.set('default', [welcome]);
                console.log('[RemoteCodeOnPC] Added welcome message to default chat');
            }
        } catch (e) {
            // ignore
        }
    }

    private getRecentProjects(): Array<{ name: string; path: string }> {
        // Получаем недавние проекты из VS Code
        const recent: Array<{ name: string; path: string }> = [];
        try {
            // Пробуем различные источники недавних проектов
            const historyPath = path.join(
                process.env.APPDATA || '',
                'Code', 'User', 'globalStorage', 'recentProjects.json'
            );
            if (fs.existsSync(historyPath)) {
                const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
                if (Array.isArray(data)) {
                    data.slice(0, 10).forEach((item: any) => {
                        const p = item.folderPath || item.path || item.uri || '';
                        recent.push({
                            name: path.basename(p),
                            path: p
                        });
                    });
                }
            }
        } catch (e) {
            // ignore
        }
        return recent;
    }

    private getSystemDrives(): string[] {
        // Возвращаем системные диски Windows
        const drives: string[] = [];
        for (let i = 65; i <= 90; i++) {
            const letter = String.fromCharCode(i);
            const drivePath = `${letter}:\\`;
            try {
                if (fs.existsSync(drivePath)) {
                    drives.push(drivePath);
                }
            } catch {
                // ignore
            }
        }
        return drives;
    }

    private scanDirectory(dirPath: string, depth: number, maxDepth: number): any {
        if (depth > maxDepth) {
            return { name: path.basename(dirPath), path: dirPath, isDirectory: true, truncated: true };
        }

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const children = entries
                .filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules')
                .sort((a, b) => {
                    // Папки выше
                    if (a.isDirectory() && !b.isDirectory()) return -1;
                    if (!a.isDirectory() && b.isDirectory()) return 1;
                    return a.name.localeCompare(b.name);
                })
                .map(entry => {
                    const fullPath = path.join(dirPath, entry.name);
                    if (entry.isDirectory()) {
                        return this.scanDirectory(fullPath, depth + 1, maxDepth);
                    } else {
                        const ext = path.extname(entry.name).toLowerCase();
                        return {
                            name: entry.name,
                            path: fullPath,
                            isDirectory: false,
                            extension: ext,
                            size: this.getFileSize(fullPath)
                        };
                    }
                });

            return {
                name: path.basename(dirPath),
                path: dirPath,
                isDirectory: true,
                children,
                size: children.reduce((acc: number, c: any) => acc + (c.size || 0), 0)
            };
        } catch (err: any) {
            return {
                name: path.basename(dirPath),
                path: dirPath,
                isDirectory: true,
                children: [],
                error: err.message
            };
        }
    }

    private getFileSize(filePath: string): number {
        try {
            const stats = fs.statSync(filePath);
            return stats.size;
        } catch {
            return 0;
        }
    }

    private getLanguageFromExt(ext: string): string {
        const langMap: Record<string, string> = {
            '.ts': 'TypeScript',
            '.tsx': 'TypeScript React',
            '.js': 'JavaScript',
            '.jsx': 'JavaScript React',
            '.json': 'JSON',
            '.html': 'HTML',
            '.css': 'CSS',
            '.scss': 'SCSS',
            '.less': 'Less',
            '.py': 'Python',
            '.java': 'Java',
            '.kt': 'Kotlin',
            '.kts': 'Kotlin',
            '.swift': 'Swift',
            '.go': 'Go',
            '.rs': 'Rust',
            '.rb': 'Ruby',
            '.php': 'PHP',
            '.c': 'C',
            '.cpp': 'C++',
            '.h': 'C/C++ Header',
            '.cs': 'C#',
            '.fs': 'F#',
            '.sql': 'SQL',
            '.sh': 'Shell',
            '.bat': 'Batch',
            '.ps1': 'PowerShell',
            '.yaml': 'YAML',
            '.yml': 'YAML',
            '.xml': 'XML',
            '.md': 'Markdown',
            '.txt': 'Plain Text',
            '.env': 'Environment',
            '.gitignore': 'Git Ignore',
            '.dockerfile': 'Dockerfile',
            '.svg': 'SVG',
            '.png': 'Image',
            '.jpg': 'Image',
            '.jpeg': 'Image',
            '.gif': 'Image',
            '.ico': 'Icon',
        };
        return langMap[ext.toLowerCase()] || 'Unknown';
    }

    // ========== TUNNEL (Internet access) HANDLERS ==========

    // GET /api/tunnel/status
    private async handleTunnelStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const publicAccess = this.requestUsesPublicAccess(req);
        const authOk = this.checkAuth(req, publicAccess);
        const publicUrl = this.getPublicUrl();
        const publicProvider = this.getPublicProvider();
        if ((this._authToken || publicAccess) && !authOk) {
            this.jsonResponse(res, 200, {
                tunnelActive: !!publicUrl,
                tunnelUrl: null,
                localIp: '',
                port: this._port,
                localUrl: '',
                publicUrl: null,
                tunnelProvider: publicProvider,
                keeneticHost: '',
                keeneticZone: this.getKeeneticZone(),
                keeneticScheme: this.getKeeneticScheme(),
                authRequired: true,
                authOk: false,
                tokenConfigured: !!this._authToken,
                manualUrlSupported: true,
                autoUrlSupported: true,
                externalMode: publicProvider === 'keenetic' ? 'keenetic' : publicProvider
            });
            return;
        }
        this.jsonResponse(res, 200, {
            tunnelActive: !!publicUrl,
            tunnelUrl: publicUrl,
            localIp: this._localIp,
            port: this._port,
            localUrl: `http://${this._localIp}:${this._port}`,
            publicUrl,
            tunnelProvider: publicProvider,
            keeneticHost: this.getConfiguredKeeneticHost(),
            keeneticZone: this.getKeeneticZone(),
            keeneticScheme: this.getKeeneticScheme(),
            authRequired: !!this._authToken,
            authOk,
            tokenConfigured: !!this._authToken,
            manualUrlSupported: true,
            autoUrlSupported: true,
            externalMode: publicProvider === 'keenetic' ? 'keenetic' : publicProvider
        });
    }

    // POST /api/tunnel/start
    private async handleTunnelStart(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (!this._authToken) {
            this.jsonResponse(res, 409, {
                success: false,
                provider: 'keenetic',
                error: 'Для внешней сети сначала создайте токен доступа в VS Code: Remote Code -> Подключение -> Создать токен доступа, затем вставьте его в приложении.',
                authRequired: true,
                tokenConfigured: false,
                manualUrlSupported: true,
                autoUrlSupported: true
            });
            return;
        }
        const resolved = await this.resolveKeeneticPublicUrl(true);
        if (resolved?.url) {
            this.jsonResponse(res, 200, {
                success: true,
                url: resolved.url,
                provider: 'keenetic',
                source: resolved.source,
                message: resolved.source === 'saved'
                    ? 'Используется сохраненный Keenetic URL. Запуск внешнего туннельного процесса не требуется.'
                    : 'Keenetic URL сформирован и сохранен в настройках расширения.'
            });
            return;
        }
        this.jsonResponse(res, 409, {
            success: false,
            provider: 'keenetic',
            error: 'Keenetic URL не удалось сформировать автоматически. В VS Code откройте Remote Code: Подключение -> Сформировать Keenetic URL и вставьте стабильный KeenDNS/DDNS адрес вида http://name.keenetic.link:8799. Служебные адреса *.netcraze.io для телефона не используются.',
            manualUrlSupported: true,
            autoUrlSupported: true
        });
    }

    // POST /api/tunnel/stop
    private async handleTunnelStop(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        this.stopTunnel();
        this.jsonResponse(res, 200, { success: true, provider: null, message: 'Временный туннель остановлен. Сохраненный Keenetic URL не изменен.' });
    }

    // ========== CODEX (OpenAI) HANDLERS ==========

    // GET /api/codex/status
    private async handleCodexStatus(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const officialExtension = vscode.extensions.getExtension('openai.chatgpt');
            const codexPath = this.findCodexCli();
            const isInstalled = !!codexPath;
            let version = '';

            if (isInstalled) {
                version = this.execSync(`${this.formatCommandExecutable(codexPath)} --version 2>&1`).trim();
                // v0.125.0 не имеет подкоманды status — используем --version как проверку
                if (version.startsWith('codex-cli') || version.includes('codex')) {
                    // работает
                }
            }

            this.jsonResponse(res, 200, {
                installed: isInstalled,
                version,
                isRunning: isInstalled,
                path: codexPath || null,
                officialVsCodeExtensionInstalled: !!officialExtension,
                officialVsCodeExtensionActive: !!officialExtension?.isActive,
                officialVsCodeExtensionVersion: officialExtension?.packageJSON?.version || null,
                desktopAppInstalled: this.isCodexDesktopAppInstalled(),
                configPath: this.getCodexConfigPath()
            });
        } catch (err: any) {
            this.jsonResponse(res, 200, {
                installed: false,
                version: '',
                isRunning: false,
                path: null,
                officialVsCodeExtensionInstalled: !!vscode.extensions.getExtension('openai.chatgpt'),
                desktopAppInstalled: this.isCodexDesktopAppInstalled(),
                error: err.message
            });
        }
    }

    // GET /api/codex/history
    private async handleCodexHistory(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        this.finalizeStaleStreamingMessages();
        const params = url.parse(req.url || '', true).query;
        const firstThreadId = this.getRemoteCodeThreads()[0]?.id || '';
        const requestedThreadId = typeof params.threadId === 'string' && params.threadId.trim()
            ? params.threadId.trim()
            : (this.currentRemoteThreadId || firstThreadId);
        this.currentRemoteThreadId = requestedThreadId || '';
        this.saveRemoteCodeState();
        this.refreshPcChatPanel();
        const messages = this.currentRemoteThreadId
            ? this.dedupeAdjacentCodexMessages(
                this.getMessagesForRemoteThread(this.currentRemoteThreadId, 120).filter(m => m.role !== 'system')
            )
            : [];
        const thread = this.getRemoteCodeThreads().find(t => t.id === this.currentRemoteThreadId);
        this.jsonResponse(res, 200, {
            threadId: this.currentRemoteThreadId,
            title: thread?.title || 'Новый чат',
            projectId: thread ? this.getWorkspaceProjectId(thread.workspaceName, thread.workspacePath) : undefined,
            workspaceName: thread?.workspaceName,
            workspacePath: thread?.workspacePath,
            messages
        });
    }

    private async handleCodexHistoryFromFiles(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const params = url.parse(req.url || '', true).query;
        const threadId = params.threadId as string | undefined;
        const sessions = this.getCodexSessionsFromFiles();
        const selected = threadId
            ? sessions.find(s => s.id === threadId)
            : sessions[0];

        if (!selected) {
            this.jsonResponse(res, 200, { threadId: '', title: '', messages: this.codexHistory.slice(-100) });
            return;
        }

        this.jsonResponse(res, 200, {
            threadId: selected.id,
            title: selected.title,
            messages: selected.messages
        });
    }

    private async handleCodexHistoryFast(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const params = url.parse(req.url || '', true).query;
            const threadId = params.threadId as string | undefined;
            const index = this.getCodexSessionIndex();
            const filePath = threadId
                ? this.findCodexSessionFile(threadId)
                : this.getCodexSessionFiles(1)[0];

            if (!filePath) {
                this.jsonResponse(res, 200, { threadId: '', title: '', messages: this.codexHistory.slice(-100) });
                return;
            }

            const selected = this.parseCodexSessionFile(filePath, index);
            if (!selected) {
                this.jsonResponse(res, 200, { threadId: threadId || '', title: '', messages: [] });
                return;
            }

            this.jsonResponse(res, 200, {
                threadId: selected.id,
                title: selected.title,
                messages: this.mergeLocalCodexMessages(selected.id, selected.messages).slice(-120)
            });
        } catch (err: any) {
            this.jsonResponse(res, 200, { threadId: '', title: '', messages: [], error: err.message });
        }
    }

    private async handleCodexEvents(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        this.finalizeStaleStreamingMessages();
        const params = url.parse(req.url || '', true).query;
        const threadId = (params.threadId as string) || this.currentRemoteThreadId;
        this.jsonResponse(res, 200, {
            threadId,
            events: this.getActionEventsForThread(threadId)
        });
    }

    private async handleCodexActionResponse(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { actionId, approve, decision } = JSON.parse(body || '{}');
        const shouldApprove = approve === true || approve === 'true' || decision === 'approve';
        const event = await this.applyActionResponse(actionId, shouldApprove);
        this.jsonResponse(res, 200, {
            success: !!event,
            actionId,
            status: event?.status || 'missing',
            error: event ? undefined : 'Action not found'
        });
    }

    // POST /api/codex/send
    private async handleCodexSendRealtime(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { message, model, threadId, attachments, reasoningEffort, includeContext, profile } = JSON.parse(body);

        if (!message) {
            this.jsonResponse(res, 400, { error: 'Message is required' });
            return;
        }

        try {
            if (typeof profile === 'string' && ['user', 'review', 'fast'].includes(profile)) {
                this.selectedProfile = profile;
                this.saveRemoteCodeState();
                this.refreshPcChatPanel();
            }
            const targetThreadId = await this.enqueueRemoteCodeMessage(
                message,
                typeof model === 'string' ? model : '',
                typeof threadId === 'string' ? threadId : '',
                Array.isArray(attachments) ? attachments : [],
                typeof reasoningEffort === 'string' ? reasoningEffort : undefined,
                includeContext !== false
            );

            this.jsonResponse(res, 200, {
                success: true,
                method: 'remote-code',
                message: 'Sent to Remote Code',
                threadId: targetThreadId,
                reasoningEffort: this.selectedReasoningEffort,
                includeContext: this.selectedIncludeContext,
                note: 'Remote Code routes this cross-device chat through the selected VS Code model.'
            });
        } catch (err: any) {
            this.jsonResponse(res, 500, { error: err.message });
        }
    }

    // POST /api/codex/send
    private async handleCodexSend(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { message, model, threadId } = JSON.parse(body);

        if (!message) {
            this.jsonResponse(res, 400, { error: 'Message is required' });
            return;
        }

        try {
            const codexPath = this.findCodexCli();
            if (!codexPath) {
                this.jsonResponse(res, 400, { error: 'Codex CLI не найден. Установите: npm i -g @openai/codex' });
                return;
            }

            // Формируем команду для Codex CLI v0.125.0: codex exec -- "prompt"
            let cmd = `${this.formatCommandExecutable(codexPath)} exec`;
            if (model) cmd += ` -m ${this.quoteShellArg(model)}`;
            cmd += ` -- ${JSON.stringify(message)}`;

            // Запускаем в терминале VS Code (не блокируя ответ)
            const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Codex');
            terminal.show();
            terminal.sendText(`# [RemoteCodeOnPC] Codex запрос от телефона:`);
            terminal.sendText(cmd);

            this.broadcast({
                type: 'codex:sent',
                message,
                model,
                threadId,
                timestamp: Date.now()
            });

            this.jsonResponse(res, 200, {
                success: true,
                message: '✅ Запрос отправлен в Codex CLI',
                command: cmd,
                note: 'Результат появится в терминале Codex в VS Code'
            });
        } catch (err: any) {
            this.jsonResponse(res, 500, { error: err.message });
        }
    }

    // GET /api/codex/models
    private async handleCodexModels(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const agents = this.getRemoteCodeModelAgents(await this.getAvailableAgents());
            const selected = this.ensureRemoteCodeSelectedAgent(agents);
            this.jsonResponse(res, 200, {
                models: agents.map(agent => ({
                    id: agent.name,
                    name: agent.displayName || agent.name
                })),
                selected,
                reasoningEffort: this.selectedReasoningEffort,
                profile: this.selectedProfile,
                includeContext: this.selectedIncludeContext,
                note: 'Only Codex/OpenAI-compatible VS Code models are shown.'
            });
        } catch (err: any) {
            this.jsonResponse(res, 200, {
                models: this.getDefaultCodexModels(),
                selected: this.selectedAgent,
                reasoningEffort: this.selectedReasoningEffort,
                profile: this.selectedProfile,
                includeContext: this.selectedIncludeContext,
                error: err.message
            });
        }
    }

    // POST /api/codex/models
    private async handleCodexSelectModel(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { modelId, reasoningEffort, profile, includeContext } = JSON.parse(body || '{}');
        const hasModel = typeof modelId === 'string' && modelId.trim().length > 0;
        const hasComposerPreference =
            typeof reasoningEffort === 'string' ||
            typeof profile === 'string' ||
            typeof includeContext === 'boolean';

        if (!hasModel && !hasComposerPreference) {
            this.jsonResponse(res, 400, { error: 'modelId or composer preference is required' });
            return;
        }

        try {
            if (hasModel) {
                const nextModel = modelId.trim();
                const agents = this.getRemoteCodeModelAgents(await this.getAvailableAgents());
                if (!agents.find(agent => agent.name === nextModel)) {
                    this.jsonResponse(res, 400, { error: `Model ${nextModel} is not available for Remote Code` });
                    return;
                }
                this.selectedAgent = nextModel;
            }
            if (typeof reasoningEffort === 'string') {
                this.selectedReasoningEffort = this.normalizeReasoningEffort(reasoningEffort);
            }
            if (typeof profile === 'string' && ['user', 'review', 'fast'].includes(profile)) {
                this.selectedProfile = profile;
            }
            if (typeof includeContext === 'boolean') {
                this.selectedIncludeContext = includeContext;
            }
            this.saveRemoteCodeState();
            this.refreshPcChatPanel();
            this.broadcast({
                type: 'codex:preferences-changed',
                model: this.selectedAgent,
                reasoningEffort: this.selectedReasoningEffort,
                profile: this.selectedProfile,
                includeContext: this.selectedIncludeContext,
                timestamp: Date.now()
            });
            if (hasModel) {
                this.broadcast({ type: 'codex:model-changed', model: this.selectedAgent, timestamp: Date.now() });
            }
            this.jsonResponse(res, 200, {
                success: true,
                model: this.selectedAgent,
                reasoningEffort: this.selectedReasoningEffort,
                profile: this.selectedProfile,
                includeContext: this.selectedIncludeContext,
                result: `Composer preferences changed`
            });
        } catch (err: any) {
            this.jsonResponse(res, 500, { error: err.message });
        }
    }

    // GET /api/codex/threads
    private async handleCodexThreadsFromFiles(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const sessions = this.getCodexSessionsFromFiles();
            this.jsonResponse(res, 200, {
                threads: sessions.map(s => ({
                    id: s.id,
                    title: s.title,
                    timestamp: s.timestamp
                }))
            });
        } catch (err: any) {
            this.jsonResponse(res, 200, { threads: [], error: err.message });
        }
    }

    private async handleCodexThreadsFast(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            this.jsonResponse(res, 200, { threads: this.getCodexThreadSummariesFast() });
        } catch (err: any) {
            this.jsonResponse(res, 200, { threads: [], error: err.message });
        }
    }

    private async handleRemoteCodeThreads(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const rawThreads = this.getRemoteCodeThreads();
            const threads = this.getRemoteCodeThreadsWithProjectIds(rawThreads);
            this.jsonResponse(res, 200, {
                threads,
                projects: this.getRemoteCodeProjects(threads),
                currentThreadId: this.currentRemoteThreadId,
                currentProjectId: this.getCurrentRemoteCodeProjectId(rawThreads)
            });
        } catch (err: any) {
            this.jsonResponse(res, 200, { threads: [], error: err.message });
        }
    }

    private async handleRemoteCodeNewThread(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = JSON.parse(await this.readBody(req) || '{}');
            const workspace = this.resolveRequestedRemoteCodeWorkspace(body);
            const threadId = this.createRemoteCodeThread(workspace);
            const thread = this.getRemoteCodeThreads().find(item => item.id === threadId);
            this.openPcChatPanel();
            this.jsonResponse(res, 200, {
                threadId,
                title: this.getCurrentThreadTitle(),
                projectId: thread ? this.getWorkspaceProjectId(thread.workspaceName, thread.workspacePath) : undefined,
                workspaceName: thread?.workspaceName,
                workspacePath: thread?.workspacePath,
                messages: this.getMessagesForRemoteThread(threadId, 120)
                    .filter(m => m.role !== 'system')
            });
        } catch (err: any) {
            this.jsonResponse(res, 500, { error: err.message });
        }
    }

    private async handleRemoteCodeDeleteThread(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = JSON.parse(await this.readBody(req) || '{}');
            const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
            if (!threadId) {
                this.jsonResponse(res, 400, { success: false, error: 'threadId is required' });
                return;
            }
            await this.deleteRemoteThread(threadId);
            const rawThreads = this.getRemoteCodeThreads();
            const threads = this.getRemoteCodeThreadsWithProjectIds(rawThreads);
            this.jsonResponse(res, 200, {
                success: true,
                currentThreadId: this.currentRemoteThreadId,
                currentProjectId: this.getCurrentRemoteCodeProjectId(rawThreads),
                threads,
                projects: this.getRemoteCodeProjects(threads)
            });
        } catch (err: any) {
            this.jsonResponse(res, 500, { success: false, error: err.message });
        }
    }

    private async handleRemoteCodeMessageAction(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = JSON.parse(await this.readBody(req) || '{}');
            const action = typeof body.action === 'string' ? body.action.trim() : '';
            const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
            const threadId = typeof body.threadId === 'string' && body.threadId.trim()
                ? body.threadId.trim()
                : this.currentRemoteThreadId;
            if (!threadId || !messageId) {
                this.jsonResponse(res, 400, { success: false, error: 'threadId and messageId are required' });
                return;
            }

            if (action === 'delete') {
                const result = this.deleteRemoteMessage(threadId, messageId);
                this.jsonResponse(res, result.success ? 200 : 404, {
                    success: result.success,
                    threadId,
                    messageId,
                    messages: this.getMessagesForRemoteThread(threadId, 120),
                    error: result.success ? undefined : 'Message not found'
                });
                return;
            }

            if (action === 'regenerate') {
                const result = await this.regenerateRemoteMessage(threadId, messageId);
                this.jsonResponse(res, result.success ? 200 : 404, {
                    success: result.success,
                    threadId,
                    messageId,
                    regeneratedFrom: result.source?.id,
                    messages: this.getMessagesForRemoteThread(threadId, 120),
                    error: result.error
                });
                return;
            }

            if (action === 'feedback') {
                const feedbackValue = typeof body.feedback === 'string' ? body.feedback.trim() : '';
                if (!['up', 'down'].includes(feedbackValue)) {
                    this.jsonResponse(res, 400, { success: false, error: 'feedback must be up or down' });
                    return;
                }
                const feedback = this._context.globalState.get<Record<string, string>>('remote_code_message_feedback', {});
                feedback[messageId] = feedbackValue;
                await this._context.globalState.update('remote_code_message_feedback', feedback);
                this.jsonResponse(res, 200, { success: true, threadId, messageId });
                return;
            }

            this.jsonResponse(res, 400, { success: false, error: 'Unsupported message action' });
        } catch (err: any) {
            this.jsonResponse(res, 500, { success: false, error: err.message });
        }
    }

    private async handleRemoteCodeChangeAction(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const body = JSON.parse(await this.readBody(req) || '{}');
            const action = typeof body.action === 'string' ? body.action.trim() : '';
            const filePath = typeof body.path === 'string' ? body.path.trim() : '';
            const commit = typeof body.commit === 'string' ? body.commit.trim() : '';
            const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : '';

            if (action === 'diff') {
                if (!filePath) {
                    this.jsonResponse(res, 400, { success: false, error: 'path is required for diff' });
                    return;
                }
                const result = this.readRemoteCodeChangeDiff(filePath, commit, cwd);
                this.jsonResponse(res, result.success ? 200 : 404, result);
                return;
            }

            if (action === 'open') {
                if (!filePath) {
                    this.jsonResponse(res, 400, { success: false, error: 'path is required for open' });
                    return;
                }
                await this.openChangeFile(filePath);
                this.jsonResponse(res, 200, { success: true, action, path: filePath, message: 'File opened in VS Code.' });
                return;
            }

            if (action === 'review') {
                await vscode.commands.executeCommand('workbench.view.scm');
                if (filePath) await this.openChangeFile(filePath);
                this.jsonResponse(res, 200, {
                    success: true,
                    action,
                    path: filePath || undefined,
                    commit: commit || undefined,
                    cwd: cwd || undefined,
                    message: 'Source Control opened for review.'
                });
                return;
            }

            if (action === 'undo') {
                const event = this.requestRemoteCodeUndoChange(filePath, commit, cwd);
                this.jsonResponse(res, 202, {
                    success: true,
                    action,
                    path: filePath || undefined,
                    commit: commit || undefined,
                    cwd: event.cwd,
                    actionId: event.id,
                    message: 'Undo request created. Approve it in the action timeline.'
                });
                return;
            }

            this.jsonResponse(res, 400, { success: false, error: 'Unsupported change action' });
        } catch (err: any) {
            this.jsonResponse(res, 500, { success: false, error: err.message });
        }
    }

    private async handleRemoteCodeStopGeneration(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const hadActiveTask = !!this.activeChatCancellation && !this.activeChatCancellation.token.isCancellationRequested;
            this.stopActiveGeneration(false);
            this.jsonResponse(res, 200, {
                success: true,
                stopped: hadActiveTask,
                threadId: this.activeChatThreadId || this.currentRemoteThreadId
            });
        } catch (err: any) {
            this.jsonResponse(res, 500, { success: false, error: err.message });
        }
    }

    private async handleCodexThreads(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            // Читаем session_index.jsonl из ~/.codex/
            const codexDir = path.join(os.homedir(), '.codex');
            const indexFile = path.join(codexDir, 'session_index.jsonl');
            const threads: Array<{ id: string; title: string; timestamp: number }> = [];

            if (fs.existsSync(indexFile)) {
                const content = fs.readFileSync(indexFile, 'utf-8');
                const lines = content.split(/\r?\n/).filter(Boolean);
                for (const line of lines) {
                    try {
                        const obj = JSON.parse(line);
                        const id = obj.id || '';
                        const title = obj.thread_name || obj.title || 'Codex thread';
                        // updated_at -> timestamp
                        let ts = 0;
                        if (obj.updated_at) {
                            ts = new Date(obj.updated_at).getTime();
                        }
                        if (id) {
                            threads.push({ id, title, timestamp: ts });
                        }
                    } catch { /* skip */ }
                }
            }

            // Сортируем по времени (сначала новые)
            threads.sort((a, b) => b.timestamp - a.timestamp);

            this.jsonResponse(res, 200, { threads });
        } catch (err: any) {
            this.jsonResponse(res, 200, {
                threads: [],
                error: err.message
            });
        }
    }

    // POST /api/codex/launch
    private async handleCodexLaunch(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            this.openRemoteCodeChat();
            this.jsonResponse(res, 200, {
                success: true,
                method: 'remote-code',
                note: 'Remote Code chat opened in VS Code'
            });
        } catch (err: any) {
            this.jsonResponse(res, 500, { error: err.message });
        }
    }

    // ========== TUNNEL HELPERS ==========

    private detectLocalIp(): void {
        try {
            const nets = os.networkInterfaces();
            let fallbackIp = '';
            for (const name of Object.keys(nets)) {
                const interfaces = nets[name];
                if (!interfaces) continue;
                for (const net of interfaces) {
                    // Пропускаем loopback, ipv6 и внутренние
                    if (net.family === 'IPv4' && !net.internal) {
                        const ip = net.address;
                        // Предпочитаем реальный LAN IP (192.168.x.x, 10.x.x.x)
                        if (ip.startsWith('192.168.') || ip.startsWith('10.')) {
                            this._localIp = ip;
                            console.log(`[RemoteCodeOnPC] Локальный IP: ${this._localIp}`);
                            return;
                        }
                        // Запоминаем как fallback, если это не 100.x.x.x (Hyper-V)
                        if (!ip.startsWith('100.') && fallbackIp === '') {
                            fallbackIp = ip;
                        }
                    }
                }
            }
            // Если не нашли 192.168.x.x или 10.x.x.x — используем fallback
            if (fallbackIp) {
                this._localIp = fallbackIp;
            } else {
                this._localIp = '127.0.0.1';
            }
            console.log(`[RemoteCodeOnPC] Локальный IP: ${this._localIp}`);
        } catch (e) {
            this._localIp = '127.0.0.1';
        }
    }

    private findTunnelLauncher(): TunnelLauncher | undefined {
        const candidates: TunnelLauncher[] = [
            { command: path.join(process.env['ProgramFiles(x86)'] || '', 'cloudflared', 'cloudflared.exe'), prefixArgs: [], shell: false, label: 'Program Files (x86) cloudflared.exe', provider: 'cloudflared' },
            { command: path.join(process.env.PROGRAMFILES || '', 'cloudflared', 'cloudflared.exe'), prefixArgs: [], shell: false, label: 'Program Files cloudflared.exe', provider: 'cloudflared' },
            { command: 'cloudflared.exe', prefixArgs: [], shell: true, label: 'cloudflared from PATH', provider: 'cloudflared' },
            { command: 'cloudflared', prefixArgs: [], shell: true, label: 'cloudflared from PATH', provider: 'cloudflared' },
            { command: path.join(process.env.LOCALAPPDATA || '', 'ngrok', 'ngrok.exe'), prefixArgs: [], shell: false, label: 'LOCALAPPDATA ngrok.exe', provider: 'ngrok' },
            { command: path.join(process.env.PROGRAMFILES || '', 'ngrok', 'ngrok.exe'), prefixArgs: [], shell: false, label: 'Program Files ngrok.exe', provider: 'ngrok' },
            { command: 'C:\\tools\\ngrok.exe', prefixArgs: [], shell: false, label: 'C:\\tools\\ngrok.exe', provider: 'ngrok' },
            { command: path.join(process.env.USERPROFILE || '', 'ngrok.exe'), prefixArgs: [], shell: false, label: 'USERPROFILE ngrok.exe', provider: 'ngrok' },
            { command: 'ngrok.cmd', prefixArgs: [], shell: true, label: 'ngrok from PATH', provider: 'ngrok' },
            { command: 'ngrok', prefixArgs: [], shell: true, label: 'ngrok from PATH', provider: 'ngrok' },
        ];

        for (const candidate of candidates) {
            if (candidate.command.toLowerCase().endsWith('.exe') && !fs.existsSync(candidate.command)) {
                continue;
            }
            try {
                const versionArgs = candidate.provider === 'cloudflared'
                    ? [...candidate.prefixArgs, '--version']
                    : [...candidate.prefixArgs, 'version'];
                const check = spawnSync(candidate.command, versionArgs, {
                    windowsHide: true,
                    shell: candidate.shell,
                    encoding: 'utf8',
                    timeout: 10000
                });
                const output = `${check.stdout || ''}\n${check.stderr || ''}`;
                if (check.status === 0 && new RegExp(candidate.provider, 'i').test(output)) {
                    return candidate;
                }
            } catch {
                // Try the next candidate. Broken npm shims are common on Windows.
            }
        }
        return undefined;
    }

    private startTunnelWithLauncher(launcher: TunnelLauncher): Promise<string> {
        return new Promise((resolve, reject) => {
            const args = launcher.provider === 'cloudflared'
                ? [...launcher.prefixArgs, 'tunnel', '--url', `http://127.0.0.1:${this._port}`, '--no-autoupdate', '--protocol', 'http2']
                : [...launcher.prefixArgs, 'http', String(this._port), '--log=stdout'];

            const ngrokConfig = path.join(process.env.USERPROFILE || '', '.ngrok2', 'ngrok.yml');
            if (launcher.provider === 'ngrok' && fs.existsSync(ngrokConfig)) {
                args.push('--config', ngrokConfig);
            }

            const proc = spawn(launcher.command, args, {
                windowsHide: true,
                shell: launcher.shell,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this._tunnelProcess = proc;
            let settled = false;
            let readyCheckStarted = false;

            const acceptOutput = (data: Buffer) => {
                const text = data.toString();
                const urlMatch = launcher.provider === 'cloudflared'
                    ? text.match(/https?:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/)
                    : text.match(/https?:\/\/[a-zA-Z0-9_-]+\.ngrok[-a-zA-Z0-9]*\.(io|app)/);
                if (urlMatch && !settled && !readyCheckStarted) {
                    readyCheckStarted = true;
                    const publicUrl = urlMatch[0];
                    this._tunnelUrl = publicUrl;
                    this._tunnelProvider = launcher.provider;
                    console.log(`[RemoteCodeOnPC] ${launcher.provider} tunnel detected: ${publicUrl}`);
                    this.waitForTunnelReady(publicUrl, launcher.provider)
                        .then(() => {
                            if (settled) return;
                            settled = true;
                            console.log(`[RemoteCodeOnPC] ${launcher.provider} tunnel ready: ${publicUrl}`);
                            vscode.window.showInformationMessage(`Интернет-доступ готов: ${publicUrl}`);
                            resolve(publicUrl);
                        })
                        .catch((err: Error) => {
                            if (settled) return;
                            settled = true;
                            this._tunnelUrl = null;
                            this._tunnelProvider = null;
                            try { proc.kill(); } catch { /* ignore */ }
                            reject(new Error(`${launcher.provider} URL найден, но /api/status не открылся: ${err.message}`));
                        });
                }
            };

            proc.stdout.on('data', acceptOutput);
            proc.stderr.on('data', acceptOutput);

            proc.on('close', (code: number) => {
                if (!settled) {
                    settled = true;
                    this._tunnelProcess = null;
                    this._tunnelUrl = null;
                    this._tunnelProvider = null;
                    const authHint = launcher.provider === 'ngrok' ? '/authtoken' : '';
                    reject(new Error(`${launcher.provider} не запустился (${launcher.label}, код ${code}). Проверьте установку${authHint} или укажите публичный URL вручную в настройках приложения.`));
                } else if (this._tunnelProcess === proc) {
                    this._tunnelProcess = null;
                    this._tunnelUrl = null;
                    this._tunnelProvider = null;
                    console.log(`[RemoteCodeOnPC] ${launcher.provider} tunnel exited with code ${code}`);
                }
            });

            proc.on('error', (err: Error) => {
                if (!settled) {
                    this._tunnelProcess = null;
                    this._tunnelProvider = null;
                    reject(new Error(`Ошибка запуска ${launcher.provider}: ${err.message}`));
                }
            });

            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    proc.kill();
                    this._tunnelProcess = null;
                    this._tunnelUrl = null;
                    this._tunnelProvider = null;
                    reject(new Error(`Таймаут запуска ${launcher.provider} (45 сек). Проверьте установку или вставьте публичный URL вручную.`));
                }
            }, 45000);
        });
    }

    private async waitForTunnelReady(publicUrl: string, provider: 'ngrok' | 'cloudflared'): Promise<void> {
        const attempts = provider === 'cloudflared' ? 18 : 8;
        const requiredOkStreak = provider === 'cloudflared' ? 3 : 1;
        let okStreak = 0;
        let lastError = 'not checked';
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const statusCode = await this.httpStatus(`${publicUrl.replace(/\/+$/, '')}/api/status`, 5000);
                if (statusCode >= 200 && statusCode < 300) {
                    okStreak += 1;
                    if (okStreak >= requiredOkStreak) return;
                    lastError = `HTTP ${statusCode}, stable ${okStreak}/${requiredOkStreak}`;
                } else {
                    okStreak = 0;
                    lastError = `HTTP ${statusCode}`;
                }
            } catch (err: any) {
                okStreak = 0;
                lastError = err?.message || String(err);
            }
            await this.sleep(attempt < 4 ? 1200 : 2200);
        }
        throw new Error(lastError);
    }

    private httpStatus(targetUrl: string, timeoutMs: number): Promise<number> {
        return new Promise((resolve, reject) => {
            const parsed = new URL(targetUrl);
            const client = parsed.protocol === 'https:' ? https : http;
            const req = client.request(parsed, { method: 'GET', timeout: timeoutMs }, res => {
                const statusCode = res.statusCode || 0;
                res.resume();
                res.on('end', () => resolve(statusCode));
            });
            req.on('timeout', () => {
                req.destroy(new Error('timeout'));
            });
            req.on('error', reject);
            req.end();
        });
    }

    private async isTunnelHealthy(publicUrl: string): Promise<boolean> {
        try {
            const statusCode = await this.httpStatus(`${publicUrl.replace(/\/+$/, '')}/api/status`, 5000);
            return statusCode >= 200 && statusCode < 300;
        } catch {
            return false;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async startTunnel(): Promise<string> {
        const resolved = await this.resolveKeeneticPublicUrl(true);
        if (resolved?.url) return resolved.url;
        throw new Error('Keenetic URL не удалось сформировать автоматически. Укажите имя KeenDNS или готовый публичный URL в Remote Code: Подключение.');
    }

    private stopTunnel(): void {
        if (this._tunnelProcess) {
            try {
                if (process.platform === 'win32') {
                    this.execSync(`taskkill /F /T /PID ${this._tunnelProcess.pid} 2>nul`);
                } else {
                    this._tunnelProcess.kill('SIGTERM');
                }
            } catch { /* ignore */ }
            this._tunnelProcess = null;
        }
        this._tunnelUrl = null;
        this._tunnelProvider = null;
        console.log('[RemoteCodeOnPC] Туннель остановлен');
    }

    // ========== CODEX HELPERS ==========

    private findCodexCli(): string | null {
        // Проверяем пути
        const candidates = [
            'codex',
            'npx @openai/codex',
            path.join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
            path.join(process.env.APPDATA || '', 'npm', 'codex'),
            path.join(process.env.LOCALAPPDATA || '', 'npm', 'codex.cmd'),
            'C:\\Program Files\\nodejs\\codex.cmd',
        ];

        for (const candidate of candidates) {
            try {
                const result = this.execSync(`${this.formatCommandExecutable(candidate)} --version 2>&1 || echo "NOT_FOUND"`).trim();
                if (result && !result.includes('NOT_FOUND') && !result.includes('not found')) {
                    return candidate;
                }
            } catch {
                continue;
            }
        }
        return null;
    }

    private isCodexDesktopAppInstalled(): boolean {
        // Проверяем типичные пути установки Codex Desktop
        const checkPaths = [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Codex', 'Codex.exe'),
            path.join(process.env.PROGRAMFILES || '', 'Codex', 'Codex.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Codex', 'Codex.exe'),
            path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Codex', 'Codex.exe'),
        ];
        // Проверяем также MSIX-пакет (Microsoft Store)
        const msixCheckPath = path.join(process.env.LOCALAPPDATA || '', 'Packages', 'OpenAI.Codex_*');
        try {
            const result = this.execSync(`dir "${msixCheckPath}" 2>nul || echo NOT_FOUND`).trim();
            if (!result.includes('NOT_FOUND') && !result.includes('File Not Found')) return true;
        } catch { /* ignore */ }

        return checkPaths.some(p => fs.existsSync(p));
    }

    private getCodexDesktopPath(): string | null {
        const checkPaths = [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Codex', 'Codex.exe'),
            path.join(process.env.PROGRAMFILES || '', 'Codex', 'Codex.exe'),
        ];
        for (const p of checkPaths) {
            if (fs.existsSync(p)) return p;
        }
        return null;
    }

    private getCodexConfigPath(): string {
        return path.join(process.env.USERPROFILE || '', '.codex');
    }

    private getCodexSessionsRoot(): string {
        return path.join(os.homedir(), '.codex', 'sessions');
    }

    private getCodexSessionIndex(): Map<string, { title: string; timestamp: number }> {
        const result = new Map<string, { title: string; timestamp: number }>();
        const indexFile = path.join(os.homedir(), '.codex', 'session_index.jsonl');
        if (!fs.existsSync(indexFile)) return result;
        for (const line of fs.readFileSync(indexFile, 'utf-8').split(/\r?\n/).filter(Boolean)) {
            try {
                const item = JSON.parse(line);
                if (!item.id) continue;
                result.set(item.id, {
                    title: item.thread_name || item.title || 'Codex',
                    timestamp: item.updated_at ? new Date(item.updated_at).getTime() : 0
                });
            } catch {
                // skip malformed index rows
            }
        }
        return result;
    }

    private getCodexSessionFiles(maxFiles = 200): string[] {
        if (
            this.codexSessionFilesCache &&
            this.codexSessionFilesCache.maxFiles >= maxFiles &&
            Date.now() - this.codexSessionFilesCache.timestamp < 3000
        ) {
            return this.codexSessionFilesCache.files.slice(0, maxFiles);
        }

        const root = this.getCodexSessionsRoot();
        const files: string[] = [];
        const walk = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            if (files.length >= maxFiles) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true })
                .sort((a, b) => b.name.localeCompare(a.name));
            for (const entry of entries) {
                if (files.length >= maxFiles) return;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                    files.push(fullPath);
                }
            }
        };
        walk(root);
        this.codexSessionFilesCache = { timestamp: Date.now(), maxFiles, files };
        return files;
    }

    private getCodexSessionsFromFiles(): Array<{ id: string; title: string; timestamp: number; messages: CodexChatMessage[]; filePath: string }> {
        const index = this.getCodexSessionIndex();
        const sessions = this.getCodexSessionFiles()
            .map(filePath => this.parseCodexSessionFile(filePath, index))
            .filter((s): s is { id: string; title: string; timestamp: number; messages: CodexChatMessage[]; filePath: string } => !!s);
        sessions.sort((a, b) => b.timestamp - a.timestamp);
        return sessions;
    }

    private mergeLocalCodexMessages(threadId: string, serverMessages: CodexChatMessage[]): CodexChatMessage[] {
        const localMessages = this.codexHistory.filter(local =>
            local.threadId === threadId &&
            !serverMessages.some(server => server.role === local.role && server.content === local.content)
        );
        return [...serverMessages, ...localMessages].sort((a, b) => a.timestamp - b.timestamp);
    }

    private getCodexThreadSummariesFast(): Array<{ id: string; title: string; timestamp: number; workspaceName?: string; workspacePath?: string }> {
        const index = this.getCodexSessionIndex();
        const byId = new Map<string, { id: string; title: string; timestamp: number; workspaceName?: string; workspacePath?: string }>();
        for (const [id, meta] of index.entries()) {
            byId.set(id, {
                id,
                title: meta.title || 'Codex',
                timestamp: Math.round(meta.timestamp || 0)
            });
        }

        for (const filePath of this.getCodexSessionFiles(160)) {
            const id = this.codexIdFromFilePath(filePath);
            const statTimestamp = Math.round(fs.statSync(filePath).mtimeMs);
            const existing = byId.get(id);
            const workspace = this.readCodexSessionWorkspace(filePath);
            byId.set(id, {
                id,
                title: existing?.title || path.basename(filePath, '.jsonl'),
                timestamp: Math.max(existing?.timestamp || 0, statTimestamp),
                workspaceName: existing?.workspaceName || workspace.workspaceName,
                workspacePath: existing?.workspacePath || workspace.workspacePath
            });
        }

        const threads = Array.from(byId.values())
            .filter(thread => !this.hiddenCodexThreadIds.has(this.toCodexThreadId(thread.id)));
        threads.sort((a, b) => b.timestamp - a.timestamp);
        return threads.slice(0, 80);
    }

    private readCodexSessionWorkspace(filePath: string): { workspaceName?: string; workspacePath?: string } {
        try {
            const fd = fs.openSync(filePath, 'r');
            try {
                const buffer = Buffer.alloc(64 * 1024);
                const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
                const head = buffer.toString('utf8', 0, bytesRead);
                for (const line of head.split(/\r?\n/)) {
                    if (!line.includes('"session_meta"')) continue;
                    const item = JSON.parse(line);
                    const cwd = typeof item?.payload?.cwd === 'string' ? item.payload.cwd : '';
                    if (!cwd) return {};
                    return {
                        workspacePath: cwd,
                        workspaceName: this.workspaceNameFromPath(cwd)
                    };
                }
            } finally {
                fs.closeSync(fd);
            }
        } catch {
            // best-effort metadata for grouping only
        }
        return {};
    }

    private codexIdFromFilePath(filePath: string): string {
        return path.basename(filePath, '.jsonl').replace(/^rollout-[^-]+-\d\d-\d\dT\d\d-\d\d-\d\d-/, '');
    }

    private findCodexSessionFile(threadId: string): string | undefined {
        return this.getCodexSessionFiles(300).find(filePath => this.codexIdFromFilePath(filePath) === threadId);
    }

    private parseCodexSessionFileTail(
        filePath: string,
        index: Map<string, { title: string; timestamp: number }>,
        minMessages: number
    ): { id: string; title: string; timestamp: number; messages: CodexChatMessage[]; filePath: string } | null {
        const stat = fs.statSync(filePath);
        let maxBytes = 2 * 1024 * 1024;
        let parsed: { id: string; title: string; timestamp: number; messages: CodexChatMessage[]; filePath: string } | null = null;
        const targetMessages = Math.max(20, Math.min(minMessages, 120));

        const maxTailBytes = 64 * 1024 * 1024;
        while (maxBytes < stat.size && maxBytes <= maxTailBytes) {
            parsed = this.parseCodexSessionFile(filePath, index, maxBytes);
            if ((parsed?.messages.length || 0) >= targetMessages) return parsed;
            maxBytes *= 2;
        }

        if (stat.size <= maxBytes) {
            return this.parseCodexSessionFile(filePath, index);
        }
        return parsed || this.parseCodexSessionFile(filePath, index, maxTailBytes);
    }

    private parseCodexSessionFile(
        filePath: string,
        index: Map<string, { title: string; timestamp: number }>,
        tailBytes = 0
    ): { id: string; title: string; timestamp: number; messages: CodexChatMessage[]; filePath: string } | null {
        try {
            const lines = tailBytes > 0
                ? this.readUtf8FileTailLines(filePath, tailBytes)
                : fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
            let id = this.codexIdFromFilePath(filePath);
            let title = 'Codex';
            let timestamp = Math.round(fs.statSync(filePath).mtimeMs);
            const messages: CodexChatMessage[] = [];

            for (const line of lines) {
                let item: any;
                try { item = JSON.parse(line); } catch { continue; }
                const payload = item.payload || {};
                const itemTime = Math.round(item.timestamp ? new Date(item.timestamp).getTime() : timestamp);

                if (item.type === 'session_meta') {
                    id = payload.id || id;
                    timestamp = Math.round(payload.timestamp ? new Date(payload.timestamp).getTime() : timestamp);
                    continue;
                }

                if (item.type === 'event_msg' && payload.type === 'thread_name_updated' && payload.thread_name) {
                    title = payload.thread_name;
                    timestamp = itemTime || timestamp;
                    continue;
                }

                if (item.type === 'event_msg' && payload.type === 'user_message') {
                    const content = payload.message || this.extractTextParts(payload.text_elements) || '';
                    if (content.trim()) {
                        messages.push({
                            id: `codex_user_${messages.length}_${itemTime}`,
                            role: 'user',
                            content: this.cleanCodexMessage(content),
                            timestamp: Math.round(itemTime)
                        });
                    }
                    timestamp = Math.round(itemTime || timestamp);
                    continue;
                }

                if (
                    item.type === 'event_msg' &&
                    payload.type === 'agent_message' &&
                    payload.message &&
                    this.shouldShowCodexAssistantMessage(payload)
                ) {
                    messages.push({
                        id: `codex_assistant_${messages.length}_${itemTime}`,
                        role: 'assistant',
                        content: this.cleanCodexMessage(payload.message),
                        timestamp: Math.round(itemTime)
                    });
                    timestamp = Math.round(itemTime || timestamp);
                    continue;
                }

                if (item.type === 'response_item' && payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
                    if (payload.role === 'user') {
                        continue;
                    }
                    if (payload.role === 'assistant' && !this.shouldShowCodexAssistantMessage(payload)) {
                        continue;
                    }
                    const content = this.extractResponseItemContent(payload);
                    if (content.trim()) {
                        messages.push({
                            id: `codex_${payload.role}_${messages.length}_${itemTime}`,
                            role: payload.role,
                            content: this.cleanCodexMessage(content),
                            timestamp: Math.round(itemTime)
                        });
                    }
                    timestamp = Math.round(itemTime || timestamp);
                }
            }

            const indexed = index.get(id);
            if (indexed) {
                title = indexed.title || title;
                timestamp = Math.round(Math.max(timestamp, indexed.timestamp || 0));
            }
            if (!title || title === 'Codex') {
                const firstUser = messages.find(m => m.role === 'user' && m.content.trim());
                title = firstUser ? firstUser.content.replace(/\s+/g, ' ').slice(0, 80) : 'Codex';
            }

            return { id, title, timestamp: Math.round(timestamp), messages: this.dedupeAdjacentCodexMessages(messages), filePath };
        } catch {
            return null;
        }
    }

    private shouldShowCodexAssistantMessage(payload: any): boolean {
        const phase = typeof payload?.phase === 'string' ? payload.phase.toLowerCase() : '';
        if (!phase) return true;
        return phase === 'final_answer';
    }

    private extractResponseItemContent(payload: any): string {
        const content = payload.content || [];
        if (!Array.isArray(content)) return '';
        return content.map((part: any) => part?.text || '').filter(Boolean).join('\n');
    }

    private extractTextParts(parts: any): string {
        if (!Array.isArray(parts)) return '';
        return parts.map((part: any) => typeof part === 'string' ? part : (part?.text || '')).filter(Boolean).join('\n');
    }

    private cleanCodexMessage(content: string): string {
        const userRequest = content.match(/<userRequest>\s*([\s\S]*?)\s*<\/userRequest>/);
        if (userRequest?.[1]) return userRequest[1].trim();
        const environmentContext = content.match(/<environment_context>[\s\S]*?<\/environment_context>\s*([\s\S]*)/);
        if (environmentContext?.[1]?.trim()) return environmentContext[1].trim();
        return content.trim();
    }

    private getDefaultCodexModels(): Array<{ id: string; name: string }> {
        return [
            { id: 'gpt-5.5', name: 'GPT-5.5' },
            { id: 'gpt-5.4', name: 'GPT-5.4' },
            { id: 'gpt-5.4-mini', name: 'GPT-5.4-Mini' },
            { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex' },
            { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3-Codex-Spark' },
            { id: 'gpt-5.2', name: 'GPT-5.2' },
        ];
    }

    private parseCodexModels(output: string): Array<{ id: string; name: string }> {
        const models: Array<{ id: string; name: string }> = [];
        const lines = output.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('*') && !trimmed.startsWith('─') && !trimmed.startsWith('╭') && !trimmed.startsWith('├') && !trimmed.startsWith('╰') && !trimmed.startsWith('Model')) {
                const parts = trimmed.split(/\s{2,}/);
                models.push({
                    id: parts[0]?.trim() || trimmed,
                    name: parts[1]?.trim() || trimmed
                });
            }
        }
        return models;
    }

    private execSync(cmd: string, timeoutMs?: number): string {
        return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs || 10000, windowsHide: true }).toString();
    }

    private normalizeLocalAttachments(attachments: Array<Partial<LocalAttachment>>): LocalAttachment[] {
        const normalized: LocalAttachment[] = [];
        for (const attachment of attachments.slice(0, 6)) {
            if (!attachment?.path || typeof attachment.path !== 'string') continue;
            const filePath = path.resolve(attachment.path);
            if (!fs.existsSync(filePath)) continue;
            let size = typeof attachment.size === 'number' && Number.isFinite(attachment.size) ? attachment.size : 0;
            try {
                const stat = fs.statSync(filePath);
                if (!stat.isFile()) continue;
                size = stat.size;
            } catch {
                continue;
            }
            normalized.push({
                name: typeof attachment.name === 'string' && attachment.name.trim()
                    ? attachment.name.trim()
                    : path.basename(filePath),
                path: filePath,
                mimeType: typeof attachment.mimeType === 'string' && attachment.mimeType.trim()
                    ? attachment.mimeType.trim()
                    : this.guessMimeType(filePath),
                size
            });
        }
        return normalized;
    }

    private guessMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
            case '.png': return 'image/png';
            case '.jpg':
            case '.jpeg': return 'image/jpeg';
            case '.gif': return 'image/gif';
            case '.webp': return 'image/webp';
            case '.svg': return 'image/svg+xml';
            case '.txt':
            case '.md':
            case '.log': return 'text/plain';
            case '.json': return 'application/json';
            case '.pdf': return 'application/pdf';
            default: return 'application/octet-stream';
        }
    }

    private saveMobileAttachments(attachments: MobileAttachment[]): Array<{ name: string; path: string; mimeType: string; size: number }> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || this._context.globalStorageUri.fsPath;
        const uploadDir = path.join(workspaceRoot, '.remote-code-uploads');
        fs.mkdirSync(uploadDir, { recursive: true });

        const saved: Array<{ name: string; path: string; mimeType: string; size: number }> = [];
        for (const attachment of attachments.slice(0, 6)) {
            if (!attachment?.base64) continue;
            const rawName = attachment.name || 'attachment';
            const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
            const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
            const filePath = path.join(uploadDir, fileName);
            const data = Buffer.from(attachment.base64, 'base64');
            if (data.length > 12 * 1024 * 1024) {
                throw new Error(`Attachment too large: ${rawName}`);
            }
            fs.writeFileSync(filePath, data);
            saved.push({
                name: rawName,
                path: filePath,
                mimeType: this.normalizeAttachmentMime(filePath, attachment.mimeType),
                size: data.length
            });
        }
        return saved;
    }

    private normalizeAttachmentMime(filePath: string, mimeType?: string): string {
        const value = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
        if (value && value !== 'application/octet-stream') return value;
        return this.guessMimeType(filePath);
    }

    private isImageAttachment(file: LocalAttachment): boolean {
        const mime = this.normalizeAttachmentMime(file.path, file.mimeType);
        return ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(mime);
    }

    private isTextAttachment(file: LocalAttachment): boolean {
        const mime = this.normalizeAttachmentMime(file.path, file.mimeType);
        return mime.startsWith('text/') || [
            'application/json',
            'application/xml',
            'application/javascript',
            'application/typescript'
        ].includes(mime);
    }

    private createLanguageModelContent(
        prompt: string,
        attachments: LocalAttachment[]
    ): string | Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> {
        const safeAttachments = this.normalizeLocalAttachments(attachments);
        if (safeAttachments.length === 0) return prompt;

        const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [
            new vscode.LanguageModelTextPart(prompt)
        ];
        let imageCount = 0;

        for (const file of safeAttachments.slice(0, 6)) {
            const mime = this.normalizeAttachmentMime(file.path, file.mimeType);
            const label = `\n\nAttachment: ${file.name} (${mime}, ${file.size} bytes)\nLocal path: ${file.path}`;

            if (this.isImageAttachment({ ...file, mimeType: mime })) {
                try {
                    const data = fs.readFileSync(file.path);
                    parts.push(new vscode.LanguageModelTextPart(`${label}\nThe next message part is the actual image data. Inspect it visually.`));
                    parts.push(vscode.LanguageModelDataPart.image(data, mime === 'image/jpg' ? 'image/jpeg' : mime));
                    imageCount++;
                    continue;
                } catch (err: any) {
                    parts.push(new vscode.LanguageModelTextPart(`${label}\nCould not attach image bytes: ${err?.message || String(err)}`));
                    continue;
                }
            }

            if (this.isTextAttachment({ ...file, mimeType: mime }) && file.size <= 128 * 1024) {
                try {
                    const text = fs.readFileSync(file.path, 'utf8');
                    parts.push(new vscode.LanguageModelTextPart(`${label}\n\nFile content:\n${text.slice(0, 120000)}`));
                    continue;
                } catch {
                    // Fall through to the path-only note below.
                }
            }

            parts.push(new vscode.LanguageModelTextPart(`${label}\nUse the local path if you need to inspect this file.`));
        }

        if (imageCount > 0) {
            parts.push(new vscode.LanguageModelTextPart('\n\nImportant: answer using the attached image content; do not ask the user to describe the screenshot unless the image is unreadable.'));
        }

        return parts;
    }

    private withAttachmentInstructions(message: string, attachments: Array<{ name: string; path: string; mimeType: string; size: number }>): string {
        if (attachments.length === 0) return message;
        const lines = attachments.map((file, index) =>
            `${index + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes): ${file.path}`
        );
        return `${message || 'Please inspect the attached files.'}\n\nAttached files are available on this PC. Use these local paths when needed:\n${lines.join('\n')}`;
    }

    private formatCommandExecutable(command: string): string {
        if (command.startsWith('npx ')) return command;
        return this.quoteShellArg(command);
    }

    private quoteShellArg(value: string): string {
        return JSON.stringify(value);
    }
}
