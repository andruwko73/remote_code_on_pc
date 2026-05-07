import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URL } from 'url';
import { ChildProcessWithoutNullStreams, execSync, spawn, spawnSync } from 'child_process';
import { WebSocket, WebSocketServer } from 'ws';

type JsonValue = any;

interface CodexChatMessage {
    id: string;
    role: string;
    content: string;
    timestamp: number;
    model?: string;
    isStreaming?: boolean;
}

interface CodexThread {
    id: string;
    title: string;
    timestamp: number;
    path: string;
}

interface ChatMessage {
    id: string;
    role: string;
    content: string;
    timestamp: number;
    agentName?: string;
}

interface CodexActionEvent {
    id: string;
    type: string;
    title: string;
    detail: string;
    status: string;
    timestamp: number;
    callId?: string;
    source?: string;
    actionable?: boolean;
}

interface ManagedApproval {
    requestId: string | number;
    method: string;
    eventId: string;
    threadId: string;
}

interface ManagedThreadState {
    id: string;
    title: string;
    history: CodexChatMessage[];
    events: CodexActionEvent[];
}

interface FileTreeItem {
    name: string;
    path: string;
    isDirectory: boolean;
    extension?: string;
    size: number;
    children?: FileTreeItem[];
    truncated?: boolean;
    error?: string;
}

export class StandaloneRemoteServer {
    public readonly port: number;
    public readonly localIp: string;
    private readonly host: string;
    private readonly authToken: string;
    private readonly startedAt = Date.now();
    private readonly workspaceRoot: string;
    private readonly clients = new Set<WebSocket>();
    private httpServer?: http.Server;
    private wss?: WebSocketServer;
    private codexHistory: CodexChatMessage[] = [];
    private codexWatcher?: fs.FSWatcher;
    private codexWatchTimer?: NodeJS.Timeout;
    private codexPollTimer?: NodeJS.Timeout;
    private codexSessionsSignature = '';
    private vscodePollTimer?: NodeJS.Timeout;
    private vscodeSessionsSignature = '';
    private currentChatId = 'standalone';
    private codexAppServerProcess?: ChildProcessWithoutNullStreams;
    private codexAppSocket?: WebSocket;
    private codexAppConnecting?: Promise<void>;
    private codexAppRpcId = 1;
    private readonly codexAppRpcPending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    private readonly managedApprovals = new Map<string, ManagedApproval>();
    private managedThreadId = '';
    private readonly managedThreads = new Map<string, ManagedThreadState>();

    constructor(workspaceRoot: string = process.cwd()) {
        this.port = Number(process.env.REMOTE_CODE_PORT || process.env.PORT || 8799);
        this.host = process.env.REMOTE_CODE_HOST || '127.0.0.1';
        this.authToken = process.env.REMOTE_CODE_AUTH_TOKEN || '';
        this.workspaceRoot = path.resolve(process.env.REMOTE_CODE_WORKSPACE || workspaceRoot);
        this.localIp = this.getLocalIp();
    }

    async start(): Promise<void> {
        if (this.httpServer) {
            return;
        }

        this.httpServer = http.createServer((req, res) => {
            this.handleHttp(req, res).catch(error => {
                this.sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
            });
        });

        this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
        this.wss.on('connection', (socket, req) => {
            if (!this.isWsAuthorized(req)) {
                socket.close(1008, 'Unauthorized');
                return;
            }

            this.clients.add(socket);
            socket.on('close', () => this.clients.delete(socket));
            socket.on('error', () => this.clients.delete(socket));
            this.sendSocket(socket, 'connected', {
                state: {
                    connected: true,
                    workspaceRoot: this.workspaceRoot,
                    currentChatId: 'standalone',
                    standalone: true,
                    codexAvailable: this.findCodexPath() !== null
                }
            });
        });

        this.startCodexWatcher();
        this.startCodexPoller();
        this.startVSCodePoller();

        await new Promise<void>((resolve, reject) => {
            this.httpServer!.once('error', reject);
            this.httpServer!.listen(this.port, this.host, () => resolve());
        });
    }

    async stop(): Promise<void> {
        this.codexWatcher?.close();
        if (this.codexWatchTimer) {
            clearTimeout(this.codexWatchTimer);
        }
        if (this.codexPollTimer) {
            clearInterval(this.codexPollTimer);
        }
        if (this.vscodePollTimer) {
            clearInterval(this.vscodePollTimer);
        }
        this.codexAppSocket?.close();
        this.codexAppServerProcess?.kill();
        for (const client of this.clients) {
            client.close();
        }
        await new Promise<void>(resolve => this.httpServer?.close(() => resolve()));
        this.httpServer = undefined;
    }

    private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        this.setCors(res, req);
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = requestUrl.pathname;

        if (!this.isHttpAuthorized(req, pathname)) {
            const statusCode = !this.authToken && this.isAuthRequired(pathname) ? 403 : 401;
            this.sendJson(res, statusCode, { error: statusCode === 403 ? 'Auth token is required before exposing standalone server.' : 'Unauthorized' });
            return;
        }

        if (req.method === 'GET' && pathname === '/api/status') {
            this.sendJson(res, 200, this.getStatus());
            return;
        }
        if (req.method === 'GET' && pathname === '/api/workspace/folders') {
            this.sendJson(res, 200, this.getFolders());
            return;
        }
        if (req.method === 'POST' && pathname === '/api/workspace/open') {
            const body = await this.readBody(req);
            const folderPath = String(body.path || '');
            this.sendJson(res, 200, { success: fs.existsSync(folderPath), path: folderPath });
            return;
        }
        if (req.method === 'GET' && pathname === '/api/workspace/tree') {
            this.sendJson(res, 200, this.getFileTree(requestUrl.searchParams.get('path') || this.workspaceRoot));
            return;
        }
        if (req.method === 'GET' && pathname === '/api/workspace/read-file') {
            this.sendJson(res, 200, this.readFile(requestUrl.searchParams.get('path') || ''));
            return;
        }
        if (req.method === 'GET' && pathname === '/api/app/apk') {
            this.sendApk(res);
            return;
        }
        if (req.method === 'GET' && pathname === '/api/chat/agents') {
            const chats = this.getAllVSCodeChats();
            if ((this.currentChatId === 'standalone' || !chats.some(chat => chat.id === this.currentChatId)) && chats.length > 0) {
                this.currentChatId = chats[0].id;
            }
            this.sendJson(res, 200, {
                agents: [
                    { name: 'vscode-history', displayName: 'VS Code History', model: 'read-only', vendor: 'standalone', isDefault: true }
                ],
                selected: 'vscode-history',
                currentChatId: this.currentChatId
            });
            return;
        }
        if (req.method === 'GET' && pathname === '/api/chat/history') {
            const chatId = requestUrl.searchParams.get('chatId') || this.currentChatId;
            this.currentChatId = chatId;
            this.sendJson(res, 200, {
                chatId,
                messages: this.getVSCodeChatHistory(chatId),
                agentName: 'VS Code History'
            });
            return;
        }
        if (req.method === 'GET' && pathname === '/api/chat/conversations') {
            const chats = this.getAllVSCodeChats();
            if ((this.currentChatId === 'standalone' || !chats.some(chat => chat.id === this.currentChatId)) && chats.length > 0) {
                this.currentChatId = chats[0].id;
            }
            this.sendJson(res, 200, {
                conversations: chats.map(chat => ({
                    id: chat.id,
                    title: chat.title,
                    messageCount: chat.messageCount,
                    lastMessage: chat.lastMessage,
                    lastTimestamp: chat.lastTimestamp,
                    isCurrent: chat.id === this.currentChatId
                })),
                current: this.currentChatId
            });
            return;
        }
        if (req.method === 'POST' && pathname === '/api/chat/send') {
            this.sendJson(res, 503, { error: 'VS Code send requires the VS Code extension host. History is available in standalone mode.', chatId: this.currentChatId });
            return;
        }
        if (req.method === 'POST' && pathname === '/api/chat/select-agent') {
            this.sendJson(res, 200, { success: false, selected: '', agent: null });
            return;
        }
        if (req.method === 'POST' && pathname === '/api/chat/new') {
            this.sendJson(res, 200, { chatId: 'standalone' });
            return;
        }
        if (req.method === 'GET' && pathname === '/api/diagnostics') {
            this.sendJson(res, 200, { total: 0, errors: 0, warnings: 0, items: [] });
            return;
        }
        if (req.method === 'POST' && pathname === '/api/terminal/exec') {
            this.sendJson(res, 403, {
                success: false,
                pendingApproval: false,
                error: 'Terminal execution is disabled in standalone mode. Use the VS Code extension approval flow.'
            });
            return;
        }
        if (req.method === 'GET' && pathname === '/api/codex/status') {
            this.sendJson(res, 200, this.getCodexStatus());
            return;
        }
        if (req.method === 'GET' && pathname === '/api/codex/models') {
            this.sendJson(res, 200, this.getCodexModels());
            return;
        }
        if (req.method === 'POST' && pathname === '/api/codex/models') {
            const body = await this.readBody(req);
            this.sendJson(res, 200, this.selectCodexModel(String(body.modelId || body.model || '')));
            return;
        }
        if (req.method === 'GET' && pathname === '/api/codex/threads') {
            this.sendJson(res, 200, { threads: this.getCodexThreadList() });
            return;
        }
        if (req.method === 'GET' && pathname === '/api/codex/history') {
            this.sendJson(res, 200, this.getCodexHistory(requestUrl.searchParams.get('threadId') || undefined));
            return;
        }
        if (req.method === 'GET' && pathname === '/api/codex/events') {
            this.sendJson(res, 200, this.getCodexEvents(requestUrl.searchParams.get('threadId') || undefined));
            return;
        }
        if (req.method === 'POST' && pathname === '/api/codex/actions') {
            const body = await this.readBody(req);
            this.sendJson(res, 200, this.handleCodexAction(String(body.actionId || ''), String(body.decision || '')));
            return;
        }
        if (req.method === 'POST' && pathname === '/api/codex/send') {
            const body = await this.readBody(req);
            await this.handleCodexSend(res, String(body.message || ''), String(body.model || ''), String(body.threadId || ''));
            return;
        }
        if (req.method === 'POST' && pathname === '/api/codex/launch') {
            this.sendJson(res, 200, this.launchCodex());
            return;
        }
        if (req.method === 'GET' && pathname === '/api/tunnel/status') {
            this.sendJson(res, 200, {
                tunnelActive: false,
                tunnelUrl: null,
                localIp: this.localIp,
                port: this.port,
                localUrl: `http://${this.localIp}:${this.port}`,
                publicUrl: null
            });
            return;
        }
        if (req.method === 'POST' && (pathname === '/api/tunnel/start' || pathname === '/api/tunnel/stop')) {
            this.sendJson(res, 200, { success: false, url: null, message: 'Tunnel is not configured in standalone mode' });
            return;
        }

        this.sendJson(res, 404, { error: 'Not found', path: pathname });
    }

    private getStatus(): JsonValue {
        const memory = process.memoryUsage();
        return {
            version: '1.0.0',
            appName: 'Remote Code on PC Standalone',
            isRunning: true,
            platform: process.platform,
            workspace: {
                folders: [{
                    name: path.basename(this.workspaceRoot),
                    uri: this.workspaceRoot,
                    path: this.workspaceRoot
                }],
                activeFile: null,
                activeFileLanguage: null
            },
            uptime: (Date.now() - this.startedAt) / 1000,
            memoryUsage: memory.rss
        };
    }

    private getFolders(): JsonValue {
        return {
            current: [{
                name: path.basename(this.workspaceRoot),
                uri: this.workspaceRoot,
                path: this.workspaceRoot
            }],
            recent: [],
            systemDrives: this.getSystemDrives()
        };
    }

    private getFileTree(inputPath: string): FileTreeItem {
        const target = this.resolvePath(inputPath || this.workspaceRoot);
        try {
            const stat = fs.statSync(target);
            if (!stat.isDirectory()) {
                return {
                    name: path.basename(target),
                    path: target,
                    isDirectory: false,
                    extension: path.extname(target),
                    size: stat.size
                };
            }

            const entries = fs.readdirSync(target, { withFileTypes: true })
                .filter(entry => !['.git', 'node_modules', '.gradle', 'build', 'out'].includes(entry.name))
                .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
                .slice(0, 200);

            return {
                name: path.basename(target) || target,
                path: target,
                isDirectory: true,
                size: stat.size,
                children: entries.map(entry => {
                    const childPath = path.join(target, entry.name);
                    const childStat = fs.statSync(childPath);
                    return {
                        name: entry.name,
                        path: childPath,
                        isDirectory: entry.isDirectory(),
                        extension: entry.isDirectory() ? undefined : path.extname(entry.name),
                        size: childStat.size,
                        children: entry.isDirectory() ? [] : undefined
                    };
                }),
                truncated: entries.length >= 200
            };
        } catch (error) {
            return {
                name: path.basename(target),
                path: target,
                isDirectory: false,
                size: 0,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private readFile(inputPath: string): JsonValue {
        const target = this.resolvePath(inputPath);
        const stat = fs.statSync(target);
        if (!stat.isFile()) {
            throw new Error('Path is not a file');
        }
        if (stat.size > 1024 * 1024) {
            throw new Error('File is too large to read over the API');
        }
        const bytes = fs.readFileSync(target);
        if (this.looksBinary(bytes)) {
            throw new Error('Binary files are not supported by the text read API');
        }
        const content = bytes.toString('utf8');
        return {
            path: target,
            content,
            extension: path.extname(target),
            size: stat.size,
            language: this.languageFromExtension(path.extname(target))
        };
    }

    private getCodexStatus(): JsonValue {
        const codexPath = this.findCodexPath();
        let version = '';
        let error: string | null = null;
        if (codexPath) {
            const result = spawnSync(codexPath, ['--version'], {
                encoding: 'utf8',
                timeout: 5000,
                shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(codexPath)
            });
            version = (result.stdout || '').trim();
            if (result.error && !version) {
                error = null;
            }
        }

        return {
            installed: Boolean(codexPath),
            version,
            isRunning: this.isProcessRunning('codex'),
            path: codexPath,
            desktopAppInstalled: fs.existsSync(path.join(os.homedir(), '.codex')),
            configPath: this.codexConfigPath(),
            error
        };
    }

    private getCodexModels(): JsonValue {
        const selected = this.getSelectedCodexModel();
        return {
            models: [
                { id: 'gpt-5.2', name: 'GPT-5.2' },
                { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
                { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark' },
                { id: 'gpt-5.4', name: 'GPT-5.4' },
                { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
                { id: 'gpt-5.5', name: 'GPT-5.5' }
            ],
            selected,
            note: 'Standalone server uses the Codex CLI installed on this PC'
        };
    }

    private selectCodexModel(model: string): JsonValue {
        if (!model.trim()) {
            return { success: false, model: '', error: 'Empty model' };
        }

        const configPath = this.codexConfigPath();
        let config = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
        if (/^model\s*=/m.test(config)) {
            config = config.replace(/^model\s*=.*$/m, `model = "${model}"`);
        } else {
            config = `model = "${model}"\n${config}`;
        }
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, config, 'utf8');
        return { success: true, model, result: 'Model saved to Codex config' };
    }

    private getCodexThreads(): CodexThread[] {
        const files = this.getCodexSessionFiles();
        return files.map(file => this.parseCodexThread(file))
            .filter((thread): thread is CodexThread => Boolean(thread))
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 100);
    }

    private getManagedState(threadId = this.managedThreadId): ManagedThreadState | undefined {
        return threadId ? this.managedThreads.get(threadId) : undefined;
    }

    private ensureManagedState(threadId: string, title = 'Managed Codex'): ManagedThreadState {
        const existing = this.managedThreads.get(threadId);
        if (existing) {
            if (title && title !== 'Managed Codex') {
                existing.title = title;
            }
            return existing;
        }
        const state: ManagedThreadState = { id: threadId, title, history: [], events: [] };
        this.managedThreads.set(threadId, state);
        return state;
    }

    private getCodexThreadList(): JsonValue[] {
        const logged = this.getCodexThreads().map(({ path: _path, ...thread }) => ({
            ...thread,
            source: 'session-log',
            isManaged: false
        }));
        const byId = new Map<string, JsonValue>();
        for (const thread of logged) {
            byId.set(thread.id, thread);
        }
        for (const state of this.managedThreads.values()) {
            const timestamp = Math.max(...state.history.map(message => message.timestamp), Date.now());
            const existing = byId.get(state.id);
            byId.set(state.id, {
                ...(existing || {}),
                id: state.id,
                title: existing?.title || state.title,
                timestamp: Math.max(Number(existing?.timestamp || 0), timestamp),
                source: existing ? 'session-log' : 'managed',
                isManaged: true
            });
        }
        return Array.from(byId.values()).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    }

    private getCodexHistory(threadId?: string): JsonValue {
        const managedState = threadId ? this.getManagedState(threadId) : undefined;
        if (managedState) {
            return {
                threadId: managedState.id,
                title: managedState.title,
                messages: managedState.history.map(message => this.normalizeCodexMessage(message))
            };
        }
        const threads = this.getCodexThreads();
        const selected = threadId ? threads.find(thread => thread.id === threadId || thread.path === threadId) : threads[0];
        const filePath = selected?.path;
        if (!filePath) {
            return { threadId: '', title: '', messages: this.codexHistory.map(message => this.normalizeCodexMessage(message)) };
        }

        return {
            threadId: selected.id,
            title: selected.title,
            messages: this.parseCodexSessionFile(filePath)
        };
    }

    private getCodexEvents(threadId?: string): JsonValue {
        const managedState = threadId ? this.getManagedState(threadId) : undefined;
        if (managedState) {
            return { threadId: managedState.id, events: managedState.events.slice(-250) };
        }
        const threads = this.getCodexThreads();
        const selected = threadId ? threads.find(thread => thread.id === threadId || thread.path === threadId) : threads[0];
        if (!selected?.path) {
            return { threadId: '', events: [] };
        }
        return {
            threadId: selected.id,
            events: this.parseCodexActionEvents(selected.path)
        };
    }

    private handleCodexAction(actionId: string, decision: string): JsonValue {
        if (!actionId || !['approve', 'deny'].includes(decision)) {
            return { success: false, error: 'actionId and decision=approve|deny are required' };
        }

        const approval = this.managedApprovals.get(actionId);
        if (approval && this.codexAppSocket?.readyState === WebSocket.OPEN) {
            const resultDecision = decision === 'approve' ? 'accept' : 'decline';
            this.codexAppSocket.send(JSON.stringify({
                jsonrpc: '2.0',
                id: approval.requestId,
                result: { decision: resultDecision }
            }));
            this.managedApprovals.delete(actionId);
            this.updateManagedEvent(actionId, {
                status: decision === 'approve' ? 'approved' : 'declined',
                actionable: false
            }, approval.threadId);
            const state = this.getManagedState(approval.threadId);
            this.broadcast('codex:action-update', { threadId: approval.threadId, actionId, decision, events: state?.events.slice(-250) || [] });
            return { success: true, actionId, decision, source: 'managed' };
        }

        return {
            success: false,
            actionId,
            decision,
            error: 'This action comes from the Codex desktop/session log. It can be displayed remotely, but approval must still be handled by the active Codex process until the managed runner bridge is enabled.'
        };
    }

    private async handleCodexSend(res: http.ServerResponse, message: string, model: string, threadId: string): Promise<void> {
        if (!message.trim()) {
            this.sendJson(res, 400, { success: false, error: 'Empty message' });
            return;
        }

        const codexPath = this.findCodexPath();
        if (!codexPath) {
            this.sendJson(res, 500, { success: false, error: 'Codex CLI is not installed or is not in PATH' });
            return;
        }

        try {
            const started = await this.sendManagedCodexTurn(message, model, threadId);
            this.sendJson(res, 200, {
                success: true,
                mode: 'managed',
                threadId: this.managedThreadId,
                message: 'Managed Codex request started',
                note: 'Response, tool calls, and approval requests are streamed over WebSocket',
                turn: started.turn || null
            });
            return;
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            const state = this.ensureManagedState(this.managedThreadId || this.normalizeRequestedCodexThreadId(threadId) || `managed-error-${Date.now()}`);
            this.addManagedEvent({
                id: `managed-error-${Date.now()}`,
                type: 'error',
                title: 'Managed Codex unavailable',
                detail: this.compactEventDetail(detail),
                status: 'failed',
                timestamp: Date.now(),
                source: 'managed',
                actionable: false
            }, state.id);
            this.broadcast('codex:error', { threadId: state.id, error: detail, fallback: 'cli' });
            this.sendJson(res, 503, {
                success: false,
                mode: 'managed',
                error: detail,
                message: 'Managed Codex bridge could not start. Plain Codex CLI fallback is disabled because it cannot provide realtime approvals.'
            });
            return;
        }
    }

    private async sendManagedCodexTurn(message: string, model: string, requestedThreadId: string): Promise<JsonValue> {
        await this.ensureCodexAppServer();
        const targetThreadId = this.normalizeRequestedCodexThreadId(requestedThreadId);
        if (targetThreadId && targetThreadId !== this.managedThreadId) {
            const resumeResponse = await this.codexAppRequest('thread/resume', {
                threadId: targetThreadId,
                cwd: this.workspaceRoot,
                model: model.trim() || null,
                approvalPolicy: 'on-request',
                approvalsReviewer: 'user',
                sandbox: 'workspace-write',
                excludeTurns: false
            });
            this.managedThreadId = String(resumeResponse?.thread?.id || targetThreadId);
            const state = this.ensureManagedState(this.managedThreadId, resumeResponse?.thread?.title || 'Managed Codex');
            state.history = this.threadResponseToMessages(resumeResponse?.thread);
            state.events = [];
            this.broadcast('codex:threads-update', { threads: this.getCodexThreadList() });
        }

        if (!this.managedThreadId) {
            const threadResponse = await this.codexAppRequest('thread/start', {
                cwd: this.workspaceRoot,
                model: model.trim() || this.getSelectedCodexModel(),
                approvalPolicy: 'on-request',
                approvalsReviewer: 'user',
                sandbox: 'workspace-write',
                sessionStartSource: 'startup',
                serviceName: 'Remote Code on PC'
            });
            this.managedThreadId = String(threadResponse?.thread?.id || '');
            if (!this.managedThreadId) {
                throw new Error('Codex app-server did not return a thread id');
            }
            this.ensureManagedState(this.managedThreadId, threadResponse?.thread?.title || 'Managed Codex');
            this.broadcast('codex:threads-update', { threads: this.getCodexThreadList() });
        }

        const state = this.ensureManagedState(this.managedThreadId);
        const now = Date.now();
        const userMessage: CodexChatMessage = {
            id: `managed-user-${now}`,
            role: 'user',
            content: message,
            timestamp: now,
            model
        };
        state.history.push(userMessage);
        this.broadcast('codex:message', { threadId: this.managedThreadId, message: userMessage });
        this.broadcast('codex:sent', { threadId: this.managedThreadId, message: userMessage });

        return this.codexAppRequest('turn/start', {
            threadId: this.managedThreadId,
            input: [{ type: 'text', text: message }],
            cwd: this.workspaceRoot,
            model: model.trim() || null,
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            sandboxPolicy: {
                type: 'workspaceWrite',
                writableRoots: [this.workspaceRoot],
                networkAccess: false
            }
        });
    }

    private normalizeRequestedCodexThreadId(threadId: string): string {
        const trimmed = threadId.trim();
        if (!trimmed || trimmed === this.managedThreadId) {
            return trimmed;
        }
        const fromRollout = trimmed.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
        return fromRollout?.[1] || trimmed;
    }

    private threadIdFromParams(params: any): string {
        const raw = params?.threadId || params?.thread_id || params?.thread?.id || params?.turn?.threadId || this.managedThreadId;
        const normalized = this.normalizeRequestedCodexThreadId(String(raw || ''));
        if (normalized) {
            return normalized;
        }
        if (!this.managedThreadId) {
            this.managedThreadId = `managed-${Date.now()}`;
        }
        return this.managedThreadId;
    }

    private threadResponseToMessages(thread: any): CodexChatMessage[] {
        const messages: CodexChatMessage[] = [];
        for (const turn of thread?.turns || []) {
            for (const item of turn.items || []) {
                if (item.type === 'userMessage') {
                    const content = this.extractManagedUserInput(item.content);
                    if (content) {
                        messages.push({
                            id: String(item.id || `user-${messages.length}`),
                            role: 'user',
                            content,
                            timestamp: Math.round((turn.startedAt || Date.now() / 1000) * 1000)
                        });
                    }
                } else if (item.type === 'agentMessage') {
                    messages.push({
                        id: String(item.id || `assistant-${messages.length}`),
                        role: 'assistant',
                        content: String(item.text || ''),
                        timestamp: Math.round((turn.completedAt || turn.startedAt || Date.now() / 1000) * 1000),
                        isStreaming: turn.status === 'inProgress'
                    });
                }
            }
        }
        return this.dedupeCodexMessages(messages);
    }

    private async ensureCodexAppServer(): Promise<void> {
        if (this.codexAppSocket?.readyState === WebSocket.OPEN) {
            return;
        }
        if (this.codexAppConnecting) {
            return this.codexAppConnecting;
        }
        this.codexAppConnecting = this.connectCodexAppServer().finally(() => {
            this.codexAppConnecting = undefined;
        });
        return this.codexAppConnecting;
    }

    private async connectCodexAppServer(): Promise<void> {
        const codexPath = this.findCodexPath();
        if (!codexPath) {
            throw new Error('Codex CLI not found');
        }

        const port = Number(process.env.REMOTE_CODE_CODEX_APP_PORT || 8801);
        const url = process.env.REMOTE_CODE_CODEX_APP_URL || `ws://127.0.0.1:${port}`;
        try {
            await this.openCodexAppSocket(url);
            await this.initializeCodexAppSocket(url);
            return;
        } catch {
            this.codexAppSocket = undefined;
        }

        if (!this.codexAppServerProcess || this.codexAppServerProcess.killed) {
            try {
                this.codexAppServerProcess = spawn(codexPath, ['app-server', '--listen', url], {
                    cwd: this.workspaceRoot,
                    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(codexPath),
                    windowsHide: true
                });
            } catch (error) {
                await this.openCodexAppSocket(url);
                await this.initializeCodexAppSocket(url);
                return;
            }
            this.codexAppServerProcess.stderr.on('data', chunk => {
                this.addManagedEvent({
                    id: `managed-stderr-${Date.now()}`,
                    type: 'status',
                    title: 'Codex app-server',
                    detail: this.compactEventDetail(chunk.toString()),
                    status: 'info',
                    timestamp: Date.now(),
                    source: 'managed',
                    actionable: false
                });
            });
            this.codexAppServerProcess.on('exit', code => {
                this.codexAppSocket?.close();
                this.codexAppSocket = undefined;
                this.codexAppServerProcess = undefined;
                this.broadcast('codex:managed-status', { connected: false, exitCode: code });
            });
        }

        await this.openCodexAppSocketWithRetry(url, 12, 500);
        await this.initializeCodexAppSocket(url);
    }

    private async initializeCodexAppSocket(url: string): Promise<void> {
        await this.codexAppRequest('initialize', {
            clientInfo: { name: 'remote-code-on-pc', title: 'Remote Code on PC', version: '1.0.0' },
            capabilities: { experimentalApi: true }
        });
        this.broadcast('codex:managed-status', { connected: true, url });
    }

    private openCodexAppSocket(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(url);
            const timer = setTimeout(() => {
                socket.close();
                reject(new Error(`Timed out connecting to Codex app-server at ${url}`));
            }, 5000);

            socket.on('open', () => {
                clearTimeout(timer);
                this.codexAppSocket = socket;
                resolve();
            });
            socket.on('message', chunk => this.handleCodexAppMessage(chunk.toString()));
            socket.on('close', () => {
                this.codexAppSocket = undefined;
                this.broadcast('codex:managed-status', { connected: false });
            });
            socket.on('error', error => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    private async openCodexAppSocketWithRetry(url: string, attempts: number, intervalMs: number): Promise<void> {
        let lastError: Error | undefined;
        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                await this.openCodexAppSocket(url);
                return;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                await this.delay(intervalMs);
            }
        }
        throw lastError || new Error(`Could not connect to Codex app-server at ${url}`);
    }

    private codexAppRequest(method: string, params: JsonValue): Promise<JsonValue> {
        if (this.codexAppSocket?.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('Codex app-server socket is not connected'));
        }

        const id = this.codexAppRpcId++;
        const payload = { jsonrpc: '2.0', id, method, params };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.codexAppRpcPending.delete(id);
                reject(new Error(`Codex app-server request timed out: ${method}`));
            }, 30000);
            this.codexAppRpcPending.set(id, {
                resolve: value => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: error => {
                    clearTimeout(timer);
                    reject(error);
                }
            });
            this.codexAppSocket!.send(JSON.stringify(payload));
        });
    }

    private handleCodexAppMessage(raw: string): void {
        let message: any;
        try {
            message = JSON.parse(raw);
        } catch {
            return;
        }

        if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
            const pending = this.codexAppRpcPending.get(Number(message.id));
            if (pending) {
                this.codexAppRpcPending.delete(Number(message.id));
                if (message.error) {
                    pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
                } else {
                    pending.resolve(message.result);
                }
            }
            return;
        }

        if (message.id !== undefined && message.method) {
            this.handleCodexAppServerRequest(message);
            return;
        }

        if (message.method) {
            this.handleCodexAppNotification(message.method, message.params || {});
        }
    }

    private handleCodexAppServerRequest(message: any): void {
        const method = String(message.method || '');
        const params = message.params || {};
        if (
            method === 'item/commandExecution/requestApproval' ||
            method === 'item/fileChange/requestApproval' ||
            method === 'execCommandApproval' ||
            method === 'applyPatchApproval'
        ) {
            const event = this.approvalRequestToEvent(method, params, message.id);
            const threadId = this.threadIdFromParams(params);
            this.managedApprovals.set(event.id, { requestId: message.id, method, eventId: event.id, threadId });
            this.addManagedEvent(event, threadId);
            this.broadcast('codex:approval-request', { event, threadId });
            return;
        }

        this.codexAppSocket?.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Remote Code cannot handle Codex server request: ${method}` }
        }));
    }

    private handleCodexAppNotification(method: string, params: any): void {
        if (method === 'thread/started' && params.threadId) {
            this.managedThreadId = String(params.threadId);
            this.ensureManagedState(this.managedThreadId);
            this.broadcast('codex:threads-update', { threads: this.getCodexThreadList() });
            return;
        }

        if (method === 'item/started' || method === 'item/completed') {
            this.ingestManagedItem(params.item, method === 'item/completed');
            return;
        }

        if (method === 'agent/message/delta') {
            const state = this.ensureManagedState(this.threadIdFromParams(params));
            const itemId = String(params.itemId || `managed-assistant-${Date.now()}`);
            let message = state.history.find(entry => entry.id === itemId);
            if (!message) {
                message = {
                    id: itemId,
                    role: 'assistant',
                    content: '',
                    timestamp: Date.now(),
                    isStreaming: true
                };
                state.history.push(message);
            }
            message.content += String(params.delta || '');
            message.timestamp = Date.now();
            this.broadcast('codex:chunk', {
                threadId: state.id,
                messageId: message.id,
                content: message.content,
                chunk: String(params.delta || ''),
                timestamp: Date.now()
            });
            return;
        }

        if (method === 'turn/completed') {
            const state = this.ensureManagedState(this.threadIdFromParams(params));
            for (const message of state.history) {
                message.isStreaming = false;
            }
            this.broadcast('codex:response', {
                threadId: state.id,
                messages: state.history.map(item => this.normalizeCodexMessage(item)),
                turn: params.turn
            });
            this.broadcast('codex:sessions-update', {});
            return;
        }

        if (method === 'error' || method.endsWith('/error')) {
            const threadId = this.threadIdFromParams(params);
            this.addManagedEvent({
                id: `managed-error-${Date.now()}`,
                type: 'error',
                title: 'Codex error',
                detail: this.compactEventDetail(params.message || JSON.stringify(params)),
                status: 'failed',
                timestamp: Date.now(),
                source: 'managed',
                actionable: false
            }, threadId);
        }
    }

    private ingestManagedItem(item: any, completed: boolean): void {
        if (!item?.type) {
            return;
        }
        const state = this.ensureManagedState(this.threadIdFromParams(item));
        if (item.type === 'userMessage') {
            const content = this.extractManagedUserInput(item.content);
            const last = state.history[state.history.length - 1];
            const isEcho = last?.role === 'user' && last.content === content;
            if (content && !isEcho && !state.history.some(message => message.id === item.id)) {
                state.history.push({
                    id: String(item.id),
                    role: 'user',
                    content,
                    timestamp: Date.now()
                });
            }
            return;
        }
        if (item.type === 'agentMessage') {
            const existing = state.history.find(message => message.id === item.id);
            if (existing) {
                existing.content = String(item.text || existing.content || '');
                existing.isStreaming = !completed;
                existing.timestamp = Date.now();
            } else {
                state.history.push({
                    id: String(item.id),
                    role: 'assistant',
                    content: String(item.text || ''),
                    timestamp: Date.now(),
                    isStreaming: !completed
                });
            }
            this.broadcast('codex:response', { threadId: state.id, message: state.history.find(message => message.id === item.id) });
            return;
        }
        if (item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
            const event = this.managedItemToEvent(item);
            this.addManagedEvent(event, state.id);
            this.broadcast('codex:action-update', { threadId: state.id, event, events: state.events.slice(-250) });
        }
    }

    private approvalRequestToEvent(method: string, params: any, requestId: string | number): CodexActionEvent {
        const type = method.includes('fileChange') || method.includes('applyPatch') ? 'patch_approval' : 'command_approval';
        const command = params.command || params.parsedCmd?.cmd || '';
        const fileChanges = params.fileChanges || params.changes;
        const detail = command || params.reason || (fileChanges ? JSON.stringify(fileChanges) : JSON.stringify(params));
        return {
            id: `managed-approval-${requestId}`,
            type,
            title: type === 'patch_approval' ? 'Approve file changes' : 'Approve command',
            detail: this.compactEventDetail(detail),
            status: 'pending',
            timestamp: Date.now(),
            callId: params.itemId || params.callId || params.approvalId || String(requestId),
            source: 'managed',
            actionable: true
        };
    }

    private managedItemToEvent(item: any): CodexActionEvent {
        if (item.type === 'commandExecution') {
            return {
                id: `managed-item-${item.id}`,
                type: 'command',
                title: item.command || 'Command',
                detail: this.compactEventDetail(item.aggregatedOutput || item.cwd || ''),
                status: this.normalizeManagedStatus(item.status),
                timestamp: Date.now(),
                callId: item.id,
                source: 'managed',
                actionable: false
            };
        }
        if (item.type === 'fileChange') {
            return {
                id: `managed-item-${item.id}`,
                type: 'patch',
                title: 'File changes',
                detail: this.compactEventDetail((item.changes || []).map((change: any) => change.path).join(', ')),
                status: this.normalizeManagedStatus(item.status),
                timestamp: Date.now(),
                callId: item.id,
                source: 'managed',
                actionable: false
            };
        }
        return {
            id: `managed-item-${item.id}`,
            type: item.type,
            title: item.tool || item.server || item.type,
            detail: this.compactEventDetail(JSON.stringify(item.arguments || item.result || item.error || '')),
            status: this.normalizeManagedStatus(item.status),
            timestamp: Date.now(),
            callId: item.id,
            source: 'managed',
            actionable: false
        };
    }

    private normalizeManagedStatus(status: string): string {
        if (status === 'inProgress') {
            return 'running';
        }
        if (status === 'declined') {
            return 'declined';
        }
        if (status === 'failed') {
            return 'failed';
        }
        return status || 'completed';
    }

    private addManagedEvent(event: CodexActionEvent, threadId = this.managedThreadId): void {
        const state = this.ensureManagedState(threadId || this.managedThreadId || `managed-${Date.now()}`);
        const existingIndex = state.events.findIndex(item => item.id === event.id);
        if (existingIndex >= 0) {
            state.events[existingIndex] = { ...state.events[existingIndex], ...event };
        } else {
            state.events.push(event);
        }
        state.events = state.events.slice(-250);
    }

    private updateManagedEvent(eventId: string, patch: Partial<CodexActionEvent>, threadId = this.managedThreadId): void {
        const event = this.getManagedState(threadId)?.events.find(item => item.id === eventId);
        if (event) {
            Object.assign(event, patch);
        }
    }

    private extractManagedUserInput(content: any): string {
        if (!Array.isArray(content)) {
            return '';
        }
        return content.map(part => {
            if (typeof part === 'string') {
                return part;
            }
            return part?.text || part?.url || part?.path || '';
        }).filter(Boolean).join('\n');
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private launchCodex(): JsonValue {
        const codexPath = this.findCodexPath();
        if (!codexPath) {
            return { success: false, method: 'standalone', path: null, error: 'Codex CLI not found' };
        }

        const terminal = process.env.ComSpec || 'cmd.exe';
        spawn(terminal, ['/c', 'start', 'Codex', codexPath], {
            cwd: this.workspaceRoot,
            detached: true,
            stdio: 'ignore',
            windowsHide: false
        }).unref();
        return { success: true, method: 'standalone', path: codexPath };
    }

    private parseCodexThread(filePath: string): CodexThread | null {
        try {
            const stat = fs.statSync(filePath);
            const firstUser = this.extractFirstCodexUserMessage(filePath);
            const title = firstUser ? this.compactTitle(firstUser) : path.basename(filePath, '.jsonl');
            const basename = path.basename(filePath, '.jsonl');
            const threadId = this.extractCodexThreadId(filePath) || basename;
            return {
                id: threadId,
                title,
                timestamp: Math.round(stat.mtimeMs),
                path: filePath
            };
        } catch {
            return null;
        }
    }

    private readInitialLines(filePath: string, maxBytes = 256 * 1024): string[] {
        const fd = fs.openSync(filePath, 'r');
        try {
            const buffer = Buffer.alloc(maxBytes);
            const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
            return buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/).filter(Boolean);
        } finally {
            fs.closeSync(fd);
        }
    }

    private extractFirstCodexUserMessage(filePath: string): string {
        for (const line of this.readInitialLines(filePath)) {
            try {
                const record = JSON.parse(line);
                const payload = record.payload || record;
                const extracted = this.extractCodexMessage(payload);
                if (extracted?.role === 'user') {
                    const content = this.cleanCodexMessage(extracted.content || '');
                    if (content.trim()) {
                        return content;
                    }
                }
            } catch {
                continue;
            }
        }
        return '';
    }

    private extractCodexThreadId(filePath: string): string | null {
        try {
            const firstLine = this.readInitialLines(filePath, 64 * 1024)[0];
            if (firstLine) {
                const record = JSON.parse(firstLine);
                const id = record.payload?.id || record.payload?.thread_id || record.id || record.thread_id;
                if (typeof id === 'string' && id.trim()) {
                    return id.trim();
                }
            }
        } catch {
            // Fall back to filename parsing.
        }
        const basename = path.basename(filePath, '.jsonl');
        return basename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1] || null;
    }

    private parseCodexSessionFile(filePath: string): CodexChatMessage[] {
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
        const messages: CodexChatMessage[] = [];

        for (let index = 0; index < lines.length; index++) {
            try {
                const record = JSON.parse(lines[index]);
                const payload = record.payload || record;
                const parsedTimestamp = Date.parse(record.timestamp || payload.timestamp || '');
                const fallbackTimestamp = fs.statSync(filePath).mtimeMs + index;
                const timestamp = Math.round(parsedTimestamp || fallbackTimestamp);
                const extracted = this.extractCodexMessage(payload);
                if (!extracted) {
                    continue;
                }
                const content = this.cleanCodexMessage(extracted.content);
                if (!content.trim()) {
                    continue;
                }
                messages.push({
                    id: `${path.basename(filePath, '.jsonl')}-${index}`,
                    role: extracted.role,
                    content,
                    timestamp
                });
            } catch {
                continue;
            }
        }

        return this.dedupeCodexMessages(messages);
    }

    private parseCodexActionEvents(filePath: string): CodexActionEvent[] {
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
        const events: CodexActionEvent[] = [];
        const byCallId = new Map<string, CodexActionEvent>();

        for (let index = 0; index < lines.length; index++) {
            try {
                const record = JSON.parse(lines[index]);
                const payload = record.payload || record;
                const timestamp = Math.round(Date.parse(record.timestamp || payload.timestamp || '') || fs.statSync(filePath).mtimeMs + index);
                const id = `${path.basename(filePath, '.jsonl')}-event-${index}`;

                if (record.type === 'response_item' && payload.type === 'function_call') {
                    const args = this.safeParseJson(payload.arguments);
                    const event: CodexActionEvent = {
                        id,
                        type: 'command',
                        title: payload.name || 'Tool call',
                        detail: this.compactEventDetail(args?.command || payload.arguments || ''),
                        status: payload.status || 'pending',
                        timestamp,
                        callId: payload.call_id,
                        source: 'session-log',
                        actionable: false
                    };
                    events.push(event);
                    if (payload.call_id) byCallId.set(payload.call_id, event);
                    continue;
                }

                if (record.type === 'response_item' && payload.type === 'custom_tool_call') {
                    const event: CodexActionEvent = {
                        id,
                        type: payload.name || 'custom_tool',
                        title: payload.name === 'apply_patch' ? 'Patch' : payload.name || 'Custom tool',
                        detail: this.compactEventDetail(payload.input || ''),
                        status: payload.status || 'pending',
                        timestamp,
                        callId: payload.call_id,
                        source: 'session-log',
                        actionable: false
                    };
                    events.push(event);
                    if (payload.call_id) byCallId.set(payload.call_id, event);
                    continue;
                }

                if (record.type === 'event_msg' && payload.type === 'exec_command_end') {
                    const pending = payload.call_id ? byCallId.get(payload.call_id) : undefined;
                    if (pending) {
                        pending.status = payload.exit_code === 0 ? 'completed' : 'failed';
                        pending.actionable = false;
                    }
                    events.push({
                        id,
                        type: 'command_result',
                        title: (payload.command || []).join(' '),
                        detail: this.compactEventDetail(payload.aggregated_output || payload.stderr || payload.stdout || ''),
                        status: payload.exit_code === 0 ? 'completed' : 'failed',
                        timestamp,
                        callId: payload.call_id,
                        source: 'session-log',
                        actionable: false
                    });
                    continue;
                }

                if (record.type === 'event_msg' && payload.type === 'patch_apply_end') {
                    const pending = payload.call_id ? byCallId.get(payload.call_id) : undefined;
                    if (pending) {
                        pending.status = payload.success ? 'completed' : 'failed';
                        pending.actionable = false;
                    }
                    events.push({
                        id,
                        type: 'patch_result',
                        title: 'Patch applied',
                        detail: this.compactEventDetail(payload.stdout || payload.stderr || ''),
                        status: payload.success ? 'completed' : 'failed',
                        timestamp,
                        callId: payload.call_id,
                        source: 'session-log',
                        actionable: false
                    });
                    continue;
                }

                if (record.type === 'event_msg' && payload.type === 'error') {
                    events.push({
                        id,
                        type: 'error',
                        title: 'Codex error',
                        detail: this.compactEventDetail(payload.message || payload.error || JSON.stringify(payload)),
                        status: 'failed',
                        timestamp,
                        callId: payload.call_id,
                        source: 'session-log',
                        actionable: false
                    });
                }
            } catch {
                continue;
            }
        }

        return events.slice(-250);
    }

    private safeParseJson(value: string): any {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    private compactEventDetail(value: string): string {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        return text.length > 500 ? `${text.slice(0, 497)}...` : text;
    }

    private normalizeCodexMessage(message: CodexChatMessage): CodexChatMessage {
        return {
            ...message,
            timestamp: Math.round(message.timestamp)
        };
    }

    private dedupeCodexMessages(messages: CodexChatMessage[]): CodexChatMessage[] {
        const result: CodexChatMessage[] = [];
        for (const message of messages) {
            const previous = result[result.length - 1];
            if (
                previous &&
                previous.role === message.role &&
                previous.content === message.content &&
                Math.abs(previous.timestamp - message.timestamp) < 25
            ) {
                continue;
            }
            result.push(message);
        }
        return result;
    }

    private extractCodexMessage(payload: any): { role: string; content: string } | null {
        if (payload.type === 'user_message') {
            return { role: 'user', content: String(payload.message || this.extractTextParts(payload.text_elements) || '') };
        }
        if (payload.type === 'agent_message') {
            return { role: 'assistant', content: String(payload.message || '') };
        }
        if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
            return { role: payload.role, content: this.extractResponseItemContent(payload.content) };
        }
        if (payload.item?.type === 'message' && (payload.item.role === 'user' || payload.item.role === 'assistant')) {
            return { role: payload.item.role, content: this.extractResponseItemContent(payload.item.content) };
        }
        return null;
    }

    private extractResponseItemContent(content: any): string {
        if (typeof content === 'string') {
            return content;
        }
        if (!Array.isArray(content)) {
            return '';
        }
        return content.map(part => {
            if (typeof part === 'string') {
                return part;
            }
            return part.text || part.content || '';
        }).filter(Boolean).join('\n');
    }

    private extractTextParts(parts: any): string {
        if (!Array.isArray(parts)) {
            return '';
        }
        return parts.map(part => typeof part === 'string' ? part : part.text || '').filter(Boolean).join('\n');
    }

    private cleanCodexMessage(content: string): string {
        let result = content || '';
        const userRequest = result.match(/<userRequest>([\s\S]*?)<\/userRequest>/);
        if (userRequest) {
            result = userRequest[1];
        }
        result = result.replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '').trim();
        return result;
    }

    private getCodexSessionFiles(maxFiles = 200): string[] {
        const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
        if (!fs.existsSync(sessionsRoot)) {
            return [];
        }
        const files: string[] = [];
        const walk = (dir: string): void => {
            if (files.length >= maxFiles) {
                return;
            }
            const entries = fs.readdirSync(dir, { withFileTypes: true })
                .sort((a, b) => b.name.localeCompare(a.name));
            for (const entry of entries) {
                if (files.length >= maxFiles) {
                    return;
                }
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                    files.push(fullPath);
                }
            }
        };
        walk(sessionsRoot);
        return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    }

    private startCodexWatcher(): void {
        const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
        if (!fs.existsSync(sessionsRoot)) {
            return;
        }
        try {
            this.codexWatcher = fs.watch(sessionsRoot, { recursive: true }, () => {
                if (this.codexWatchTimer) {
                    clearTimeout(this.codexWatchTimer);
                }
                this.codexWatchTimer = setTimeout(() => this.broadcast('codex:sessions-update', {}), 300);
            });
        } catch {
            // Watching is best-effort; API polling still works.
        }
    }

    private startCodexPoller(): void {
        this.codexSessionsSignature = this.getCodexSessionsSignature();
        this.codexPollTimer = setInterval(() => {
            const signature = this.getCodexSessionsSignature();
            if (signature !== this.codexSessionsSignature) {
                this.codexSessionsSignature = signature;
                this.broadcast('codex:sessions-update', {});
            }
        }, 2000);
    }

    private getCodexSessionsSignature(): string {
        try {
            return this.getCodexSessionFiles()
                .slice(0, 20)
                .map(file => {
                    const stat = fs.statSync(file);
                    return `${file}:${Math.round(stat.mtimeMs)}:${stat.size}`;
                })
                .join('|');
        } catch {
            return '';
        }
    }

    private getAllWorkspaceStorageDirs(): string[] {
        try {
            const roots = [
                path.join(process.env.APPDATA || '', 'Code', 'User', 'workspaceStorage'),
                path.join(process.env.APPDATA || '', 'Cursor', 'User', 'workspaceStorage'),
                path.join(process.env.APPDATA || '', 'Code - Insiders', 'User', 'workspaceStorage')
            ];
            const results: string[] = [];
            for (const root of roots) {
                if (!root || !fs.existsSync(root)) {
                    continue;
                }
                for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
                    const dir = path.join(root, entry.name);
                    const chatDir = path.join(dir, 'chatSessions');
                    if (entry.isDirectory() && fs.existsSync(chatDir) && fs.readdirSync(chatDir).some(file => file.endsWith('.jsonl'))) {
                        results.push(dir);
                    }
                }
            }
            return results;
        } catch {
            return [];
        }
    }

    private parseVSCodeSession(filePath: string): { id: string; title: string; messages: ChatMessage[] } | null {
        try {
            const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
            if (!lines.length) {
                return null;
            }
            const header = JSON.parse(lines[0]);
            const sessionId = header?.v?.sessionId || path.basename(filePath, '.jsonl');
            const title = header?.v?.customTitle || header?.v?.title || 'Chat';
            let lastInputText = '';
            const messages: ChatMessage[] = [];

            for (const line of lines) {
                try {
                    const item = JSON.parse(line);
                    if (item.kind === 1) {
                        const key = JSON.stringify(item.k || []);
                        if (key.includes('inputState') && key.includes('inputText')) {
                            lastInputText = String(item.v || '');
                        }
                        continue;
                    }
                    if (item.kind !== 2 || JSON.stringify(item.k || []) !== JSON.stringify(['requests']) || !Array.isArray(item.v)) {
                        continue;
                    }
                    for (const req of item.v) {
                        if (!req || typeof req !== 'object' || !req.requestId) {
                            continue;
                        }
                        const timestamp = Math.round(Number(req.timestamp) || fs.statSync(filePath).mtimeMs);
                        const userMessage = this.extractVSCodeUserMessage(req) || lastInputText;
                        const assistantMessage = this.extractVSCodeAssistantMessage(req);
                        if (userMessage.trim()) {
                            messages.push({
                                id: `${sessionId}-user-${messages.length}`,
                                role: 'user',
                                content: this.cleanCodexMessage(userMessage),
                                timestamp
                            });
                        }
                        if (assistantMessage.trim()) {
                            messages.push({
                                id: `${sessionId}-assistant-${messages.length}`,
                                role: 'assistant',
                                content: assistantMessage,
                                timestamp,
                                agentName: req.agent?.id || req.agent || undefined
                            });
                        }
                    }
                } catch {
                    continue;
                }
            }
            return { id: sessionId, title, messages };
        } catch {
            return null;
        }
    }

    private extractVSCodeUserMessage(req: any): string {
        const rendered = req.result?.metadata?.renderedUserMessage;
        if (Array.isArray(rendered)) {
            for (const part of rendered) {
                if (part?.text) {
                    return String(part.text);
                }
            }
        }
        return '';
    }

    private extractVSCodeAssistantMessage(req: any): string {
        const response = req.result?.response;
        if (!Array.isArray(response)) {
            return '';
        }
        return response.map((part: any) => {
            if (!part || typeof part !== 'object') {
                return '';
            }
            if (part.kind === 'thinking' || part.kind === 'mcpServersStarting') {
                return '';
            }
            return typeof part.value === 'string' ? part.value : '';
        }).filter(Boolean).join('');
    }

    private getVSCodeSessionFiles(maxFiles = 40): string[] {
        const files: Array<{ file: string; mtime: number }> = [];
        for (const wsDir of this.getAllWorkspaceStorageDirs()) {
            const chatDir = path.join(wsDir, 'chatSessions');
            if (!fs.existsSync(chatDir)) {
                continue;
            }
            for (const name of fs.readdirSync(chatDir).filter(file => file.endsWith('.jsonl'))) {
                const file = path.join(chatDir, name);
                try {
                    files.push({ file, mtime: fs.statSync(file).mtimeMs });
                } catch {
                    continue;
                }
            }
        }
        return files
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, maxFiles)
            .map(item => item.file);
    }

    private getAllVSCodeChats(): Array<{ id: string; title: string; messageCount: number; lastMessage: string; lastTimestamp: number }> {
        const result: Array<{ id: string; title: string; messageCount: number; lastMessage: string; lastTimestamp: number }> = [];
        for (const file of this.getVSCodeSessionFiles()) {
            const parsed = this.parseVSCodeSession(file);
            if (!parsed || result.some(chat => chat.id === parsed.id)) {
                continue;
            }
            const last = parsed.messages[parsed.messages.length - 1];
            result.push({
                id: parsed.id,
                title: parsed.title,
                messageCount: parsed.messages.length,
                lastMessage: last?.content?.slice(0, 100) || '',
                lastTimestamp: Math.round(last?.timestamp || fs.statSync(file).mtimeMs)
            });
        }
        return result.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    }

    private getVSCodeChatHistory(chatId: string): ChatMessage[] {
        const messages: ChatMessage[] = [];
        const seen = new Set<string>();
        for (const file of this.getVSCodeSessionFiles(200)) {
            const parsed = this.parseVSCodeSession(file);
            if (!parsed || parsed.id !== chatId) {
                continue;
            }
            for (const message of parsed.messages) {
                if (!seen.has(message.id)) {
                    seen.add(message.id);
                    messages.push(message);
                }
            }
        }
        return messages.sort((a, b) => a.timestamp - b.timestamp);
    }

    private startVSCodePoller(): void {
        this.vscodeSessionsSignature = this.getVSCodeSessionsSignature();
        this.vscodePollTimer = setInterval(() => {
            const signature = this.getVSCodeSessionsSignature();
            if (signature !== this.vscodeSessionsSignature) {
                this.vscodeSessionsSignature = signature;
                const chats = this.getAllVSCodeChats();
                if (!chats.some(chat => chat.id === this.currentChatId)) {
                    this.currentChatId = chats[0]?.id || 'standalone';
                }
                this.broadcast('chat:sessions-update', {
                    conversations: chats.map(chat => ({
                        ...chat,
                        isCurrent: chat.id === this.currentChatId
                    }))
                });
            }
        }, 2000);
    }

    private getVSCodeSessionsSignature(): string {
        try {
            return this.getVSCodeSessionFiles(100)
                .sort()
                .map(file => {
                    const stat = fs.statSync(file);
                    return `${file}:${Math.round(stat.mtimeMs)}:${stat.size}`;
                })
                .join('|');
        } catch {
            return '';
        }
    }

    private findCodexPath(): string | null {
        const candidates = [
            path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex.cmd'),
            path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'codex.ps1'),
            path.join(os.homedir(), '.local', 'bin', 'codex.exe'),
            'codex'
        ];
        for (const candidate of candidates) {
            try {
                if (candidate === 'codex') {
                    const resolved = execSync('where codex', { encoding: 'utf8', timeout: 3000 }).split(/\r?\n/)[0]?.trim();
                    if (resolved) {
                        return resolved;
                    }
                } else if (fs.existsSync(candidate)) {
                    return candidate;
                }
            } catch {
                continue;
            }
        }
        return null;
    }

    private getSelectedCodexModel(): string {
        const configPath = this.codexConfigPath();
        if (!fs.existsSync(configPath)) {
            return 'gpt-5.3-codex';
        }
        const match = fs.readFileSync(configPath, 'utf8').match(/^model\s*=\s*["']?([^"'\r\n]+)["']?/m);
        return match?.[1]?.trim() || 'gpt-5.3-codex';
    }

    private codexConfigPath(): string {
        return path.join(os.homedir(), '.codex', 'config.toml');
    }

    private isProcessRunning(processName: string): boolean {
        try {
            const output = execSync(`tasklist /FI "IMAGENAME eq ${processName}.exe"`, { encoding: 'utf8', timeout: 3000 });
            return output.toLowerCase().includes(`${processName}.exe`);
        } catch {
            return false;
        }
    }

    private resolvePath(inputPath: string): string {
        const target = inputPath
            ? (path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(this.workspaceRoot, inputPath))
            : this.workspaceRoot;
        if (!this.isInsideWorkspace(target)) {
            throw new Error('Path is outside workspace');
        }
        return target;
    }

    private isInsideWorkspace(targetPath: string): boolean {
        const target = path.resolve(targetPath).toLowerCase();
        const root = path.resolve(this.workspaceRoot).toLowerCase();
        return target === root || target.startsWith(root + path.sep);
    }

    private looksBinary(buffer: Buffer): boolean {
        const length = Math.min(buffer.length, 4096);
        if (length === 0) return false;
        for (let i = 0; i < length; i++) {
            if (buffer[i] === 0) return true;
        }
        return false;
    }

    private languageFromExtension(extension: string): string {
        const map: Record<string, string> = {
            '.ts': 'typescript',
            '.js': 'javascript',
            '.kt': 'kotlin',
            '.java': 'java',
            '.json': 'json',
            '.md': 'markdown',
            '.ps1': 'powershell',
            '.xml': 'xml',
            '.toml': 'toml'
        };
        return map[extension.toLowerCase()] || extension.replace(/^\./, '');
    }

    private getSystemDrives(): string[] {
        if (process.platform !== 'win32') {
            return ['/'];
        }
        const drives: string[] = [];
        for (let code = 65; code <= 90; code++) {
            const drive = `${String.fromCharCode(code)}:\\`;
            if (fs.existsSync(drive)) {
                drives.push(drive);
            }
        }
        return drives;
    }

    private getLocalIp(): string {
        const interfaces = os.networkInterfaces();
        for (const addresses of Object.values(interfaces)) {
            for (const address of addresses || []) {
                if (address.family === 'IPv4' && !address.internal) {
                    return address.address;
                }
            }
        }
        return '127.0.0.1';
    }

    private compactTitle(content: string): string {
        const singleLine = content.replace(/\s+/g, ' ').trim();
        return singleLine.length > 80 ? `${singleLine.slice(0, 77)}...` : singleLine;
    }

    private async readBody(req: http.IncomingMessage): Promise<Record<string, any>> {
        let body = '';
        for await (const chunk of req) {
            body += chunk;
            if (body.length > 1024 * 1024) {
                throw new Error('Request body too large');
            }
        }
        if (!body.trim()) {
            return {};
        }
        return JSON.parse(body);
    }

    private sendJson(res: http.ServerResponse, statusCode: number, payload: JsonValue): void {
        const json = JSON.stringify(payload);
        res.writeHead(statusCode, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(json)
        });
        res.end(json);
    }

    private sendApk(res: http.ServerResponse): void {
        const apkPath = path.join(this.workspaceRoot, 'apk', 'app-debug.apk');
        if (!fs.existsSync(apkPath)) {
            this.sendJson(res, 404, { error: 'APK not found', path: apkPath });
            return;
        }

        const stat = fs.statSync(apkPath);
        res.writeHead(200, {
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Length': stat.size,
            'Content-Disposition': 'attachment; filename="remote-code-on-pc.apk"',
            'Cache-Control': 'no-store'
        });
        fs.createReadStream(apkPath).pipe(res);
    }

    private setCors(res: http.ServerResponse, req: http.IncomingMessage): void {
        const origin = req.headers.origin;
        res.setHeader('Vary', 'Origin');
        if (typeof origin === 'string' && this.isAllowedCorsOrigin(origin, req)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }

    private isHttpAuthorized(req: http.IncomingMessage, pathname: string): boolean {
        if (!this.isAuthRequired(pathname)) return true;
        if (!this.authToken) return false;
        return req.headers.authorization === `Bearer ${this.authToken}`;
    }

    private isWsAuthorized(req: http.IncomingMessage): boolean {
        if (!this.authToken) return this.isLocalOnlyBind();
        const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        return requestUrl.searchParams.get('token') === this.authToken ||
            req.headers.authorization === `Bearer ${this.authToken}`;
    }

    private isAuthRequired(pathname: string): boolean {
        if (pathname === '/api/status') return false;
        return Boolean(this.authToken) || !this.isLocalOnlyBind();
    }

    private isLocalOnlyBind(): boolean {
        const host = this.host.trim().toLowerCase();
        return !host || host === '127.0.0.1' || host === 'localhost' || host === '::1';
    }

    private isAllowedCorsOrigin(origin: string, req: http.IncomingMessage): boolean {
        try {
            const parsed = new URL(origin);
            const originHost = parsed.hostname.toLowerCase();
            const requestHost = String(req.headers.host || '').split(':')[0].toLowerCase();
            return originHost === requestHost ||
                originHost === 'localhost' ||
                originHost === '127.0.0.1' ||
                originHost === '::1' ||
                /^10\./.test(originHost) ||
                /^192\.168\./.test(originHost) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(originHost);
        } catch {
            return false;
        }
    }

    private sendSocket(socket: WebSocket, type: string, data: JsonValue): void {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type, data, timestamp: Date.now() }));
        }
    }

    private broadcast(type: string, data: JsonValue): void {
        const payload = JSON.stringify({ type, data, timestamp: Date.now() });
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }
}

export { StandaloneRemoteServer as RemoteServer };
