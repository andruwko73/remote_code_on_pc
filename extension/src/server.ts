import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, execSync } from 'child_process';

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
}

interface RemoteCodeThreadSummary {
    id: string;
    title: string;
    timestamp: number;
}

interface MobileAttachment {
    name?: string;
    mimeType?: string;
    size?: number;
    base64?: string;
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
    diff?: string;
    stdout?: string;
    stderr?: string;
}

export class RemoteServer {
    private httpServer?: http.Server;
    private wss?: WebSocketServer;
    private wsClients: Set<WebSocket> = new Set();
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
    private codexHistory: CodexChatMessage[] = [];
    private codexActionEvents: RemoteCodeActionEvent[] = [];
    private currentRemoteThreadId: string = 'remote-code-default';
    private pcChatPanel?: vscode.WebviewPanel;
    private workspaceStorageCache?: { timestamp: number; dirs: string[] };

    // Internet tunnel
    private _tunnelUrl: string | null = null;
    private _tunnelProcess: any = null;
    private _localIp: string = '';

    // WebSocket event listeners cleanup
    private diagnosticDisposable: vscode.Disposable | undefined;
    private _chatSessionWatchers: fs.FSWatcher[] = [];

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        const config = vscode.workspace.getConfiguration('remoteCodeOnPC');
        this._port = config.get<number>('port', 8799);
        this._host = config.get<string>('host', '0.0.0.0');
        this._authToken = config.get<string>('authToken', '');
    }

    get port() { return this._port; }
    get host() { return this._host; }
    get isRunning() { return this._isRunning; }
    get tunnelUrl() { return this._tunnelUrl; }
    get localIp() { return this._localIp; }
    get authToken() { return this._authToken; }

    /** Публичный запуск туннеля */
    async startTunnelPublic(): Promise<string> {
        return this.startTunnel();
    }

    /** Публичная остановка туннеля */
    stopTunnelPublic(): void {
        this.stopTunnel();
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

                this.httpServer.listen(this._port, this._host, () => {
                    this._isRunning = true;
                    this.detectLocalIp();
                    console.log(`[RemoteCodeOnPC] Сервер запущен на ${this._host}:${this._port}`);

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
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Content-Length': 0,
                'Connection': 'close'
            });
            res.end();
            return;
        }

        // Auth check
        if (this._authToken && !this.checkAuth(req)) {
            this.jsonResponse(res, 401, { error: 'Unauthorized' });
            return;
        }

        const parsedUrl = url.parse(req.url || '/', true);
        const pathname = parsedUrl.pathname || '/';

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
                case pathname === '/api/codex/models' && req.method === 'GET':
                    return this.handleCodexModels(req, res);
                case pathname === '/api/codex/models' && req.method === 'POST':
                    return this.handleCodexSelectModel(req, res);
                case pathname === '/api/codex/threads':
                    return this.handleRemoteCodeThreads(req, res);
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
    private async handleStatus(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const activeEditor = vscode.window.activeTextEditor;

        this.jsonResponse(res, 200, {
            version: vscode.version,
            appName: vscode.env.appName,
            isRunning: true,
            platform: process.platform,
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
        const dirPath = params.path as string || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        if (!dirPath) {
            this.jsonResponse(res, 400, { error: 'No path and no workspace open' });
            return;
        }

        try {
            const tree = await this.scanDirectory(dirPath, 0, 3); // max depth 3
            this.jsonResponse(res, 200, tree);
        } catch (err: any) {
            this.jsonResponse(res, 500, { error: err.message });
        }
    }

    // GET /api/workspace/read-file?path=...
    private async handleReadFile(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const params = url.parse(req.url || '', true).query;
        const filePath = params.path as string;

        if (!filePath) {
            this.jsonResponse(res, 400, { error: 'File path required' });
            return;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const ext = path.extname(filePath);
            this.jsonResponse(res, 200, {
                path: filePath,
                content,
                extension: ext,
                size: Buffer.byteLength(content, 'utf-8'),
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
        const { command } = JSON.parse(body);

        if (!command) {
            this.jsonResponse(res, 400, { error: 'Command is required' });
            return;
        }

        try {
            // Пытаемся выполнить команду и получить вывод
            let output = '';
            try {
                output = this.execSync(command, 15000).trim();
            } catch (execErr: any) {
                output = execErr.message || 'Command failed';
                if (execErr.stdout) output = execErr.stdout.toString().trim();
                if (!output) output = execErr.message || 'Command failed';
            }

            // Также отправляем команду в активный терминал VS Code
            try {
                const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Remote');
                terminal.show();
                terminal.sendText(command);
            } catch (e) {
                // Терминал VS Code — опционально
            }

            this.jsonResponse(res, 200, {
                success: true,
                output: output || `✅ Команда выполнена: ${command}`,
                command
            });
        } catch (err: any) {
            this.jsonResponse(res, 500, { error: err.message, output: err.message });
        }
    }

    // ========== WEBSOCKET ==========

    private async handleWsConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
        if (!this.checkAuth(req)) {
            ws.close(1008, 'Unauthorized');
            return;
        }

        this.wsClients.add(ws);
        console.log('[RemoteCodeOnPC] WebSocket клиент подключился');

        ws.on('close', () => {
            this.wsClients.delete(ws);
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
                        this.broadcast({
                            type: 'codex:sessions-update',
                            threads: this.getCodexThreadSummariesFast(),
                            timestamp: Date.now()
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
            }
        }
    }

    // ========== HELPERS ==========

    private checkAuth(req: http.IncomingMessage): boolean {
        if (!this._authToken) return true;
        const authHeader = req.headers['authorization'];
        if (authHeader === `Bearer ${this._authToken}`) return true;
        const parsed = url.parse(req.url || '/', true);
        return parsed.query.token === this._authToken;
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
            const entry = `[${new Date().toISOString()}] ${line}\n`;
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

    private async handleAppApk(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const apkPath = path.resolve(__dirname, '..', '..', 'apk', 'app-debug.apk');
        if (!fs.existsSync(apkPath)) {
            this.jsonResponse(res, 404, { error: 'APK not found', path: apkPath });
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
            const lmModels = await vscode.lm.selectChatModels({});
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
            const savedThreadId = this._context.globalState.get<string>('remote_code_current_thread_id', 'remote-code-default');
            const savedAgent = this._context.globalState.get<string>('remote_code_selected_agent', this.selectedAgent);
            const savedEffort = this._context.globalState.get<string>('remote_code_reasoning_effort', this.selectedReasoningEffort);
            const savedIncludeContext = this._context.globalState.get<boolean>('remote_code_include_context', this.selectedIncludeContext);
            const savedWorkMode = this._context.globalState.get<string>('remote_code_work_mode', this.selectedWorkMode);
            const savedProfile = this._context.globalState.get<string>('remote_code_profile', this.selectedProfile);
            const allowedModelIds = new Set(this.getDefaultCodexModels().map(model => model.id));
            this.codexHistory = Array.isArray(savedHistory) ? savedHistory.slice(-200) : [];
            this.codexActionEvents = Array.isArray(savedActions) ? savedActions.slice(-250) : [];
            this.currentRemoteThreadId = savedThreadId || 'remote-code-default';
            this.selectedAgent = allowedModelIds.has(savedAgent) ? savedAgent : 'gpt-5.5';
            this.selectedReasoningEffort = savedEffort || this.selectedReasoningEffort;
            this.selectedIncludeContext = savedIncludeContext !== false;
            this.selectedWorkMode = savedWorkMode === 'workspace' ? 'workspace' : 'local';
            this.selectedProfile = ['user', 'review', 'fast'].includes(savedProfile || '') ? savedProfile : 'user';
            if (this.codexHistory.length === 0) {
                this.codexHistory.push({
                    id: `remote_system_${Date.now()}`,
                    role: 'system',
                    content: 'Remote Code Agent is ready. Messages from Android and VS Code stay in this shared thread.',
                    timestamp: Date.now(),
                    threadId: this.currentRemoteThreadId
                });
                this.saveRemoteCodeState();
            }
        } catch (err) {
            console.warn('[RemoteCodeOnPC] Failed to restore Remote Code state:', err);
        }
    }

    private saveRemoteCodeState(): void {
        void this._context.globalState.update('remote_code_history', this.codexHistory.slice(-200));
        void this._context.globalState.update('remote_code_actions', this.codexActionEvents.slice(-250));
        void this._context.globalState.update('remote_code_current_thread_id', this.currentRemoteThreadId);
        void this._context.globalState.update('remote_code_selected_agent', this.selectedAgent);
        void this._context.globalState.update('remote_code_reasoning_effort', this.selectedReasoningEffort);
        void this._context.globalState.update('remote_code_include_context', this.selectedIncludeContext);
        void this._context.globalState.update('remote_code_work_mode', this.selectedWorkMode);
        void this._context.globalState.update('remote_code_profile', this.selectedProfile);
    }

    private getRemoteCodeThreads(): RemoteCodeThreadSummary[] {
        const byThread = new Map<string, RemoteCodeThreadSummary>();
        for (const message of this.codexHistory) {
            const id = message.threadId || this.currentRemoteThreadId || 'remote-code-default';
            const existing = byThread.get(id);
            const titleSource = message.role === 'user' && message.content.trim()
                ? message.content
                : existing?.title || 'Remote Code';
            const title = titleSource.replace(/\s+/g, ' ').slice(0, 80) || 'Remote Code';
            const timestamp = Math.max(existing?.timestamp || 0, Math.round(message.timestamp || 0));
            byThread.set(id, { id, title, timestamp });
        }
        if (!byThread.has(this.currentRemoteThreadId)) {
            byThread.set(this.currentRemoteThreadId, {
                id: this.currentRemoteThreadId,
                title: 'Remote Code',
                timestamp: Date.now()
            });
        }
        return Array.from(byThread.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    private getWorkspaceContextForPrompt(): string {
        const folders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath).join('\n') || 'No workspace folder is open.';
        const active = vscode.window.activeTextEditor;
        const activeFile = active ? `${active.document.uri.fsPath} (${active.document.languageId})` : 'No active editor.';
        return [
            'You are Remote Code Agent running inside VS Code.',
            'Help with code, files, diagnostics, terminal commands, and IDE context.',
            'When an action needs user approval, do not claim it was done.',
            'Request terminal approval with a single line: ::run-command{"command":"...","cwd":"optional path"}',
            'Request file replacement approval with a single line: ::write-file{"path":"absolute path","contentBase64":"base64 utf8 content"}',
            'The extension will show approve/deny controls on PC and phone, run the action only after approval, and stream the result back into this chat.',
            'Workspace folders:',
            folders,
            'Active editor:',
            activeFile
        ].join('\n');
    }

    private async sendToChat(message: string, agentName: string): Promise<string> {
        return this.sendToChatStreaming(message, agentName);
    }

    private async sendToChatStreaming(
        message: string,
        agentName: string,
        onChunk?: (content: string) => void,
        includeContext: boolean = true
    ): Promise<string> {
        // Используем VS Code LanguageModel API для отправки в Copilot Chat
        try {
            // Сначала пробуем найти модель GitHub Copilot
            let models = await vscode.lm.selectChatModels({
                vendor: 'copilot'
            });

            // Если Copilot не найден, пробуем все модели
            if (!models || models.length === 0) {
                models = await vscode.lm.selectChatModels({});
            }

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
                new vscode.LanguageModelChatMessage(
                    vscode.LanguageModelChatMessageRole.User,
                    prompt
                )
            ];

            // Отправляем запрос и собираем стриминг-ответ
            const response = await model.sendRequest(messages, {});

            let result = '';
            for await (const chunk of response.text) {
                result += chunk;
                onChunk?.(result);
            }
            return result || '(пустой ответ)';
        } catch (err: any) {
            const errorMessage = err?.message || String(err);
            console.warn('[RemoteCodeOnPC] VS Code LM request failed:', errorMessage);
            throw new Error(`VS Code language model request failed: ${errorMessage}`);
        }
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

    private async answerInPcMirror(message: string, threadId: string, model?: string, reasoningEffort?: string, includeContext: boolean = true): Promise<void> {
        const effort = this.normalizeReasoningEffort(reasoningEffort || this.selectedReasoningEffort);
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

        const response = await this.sendToChatStreaming(
            `${message}\n\nReasoning effort: ${this.reasoningEffortLabel(effort)} (${effort}).\nProfile: ${this.selectedProfile}.\nWork mode: ${this.selectedWorkMode}.`,
            model || this.selectedAgent || 'auto',
            (content) => {
            thinking.content = content || '...';
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
            includeContext
        );
        const done: CodexChatMessage = {
            ...thinking,
            id: `codex_assistant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            content: response,
            timestamp: Date.now(),
            isStreaming: false
        };
        this.codexHistory = this.codexHistory.filter(m => m.id !== thinking.id).concat(done).slice(-200);
        this.createActionsFromAssistantResponse(response, threadId);
        this.saveRemoteCodeState();
        this.refreshPcChatPanel();
        this.broadcast({ type: 'codex:message', message: done, threadId, timestamp: Date.now() });
    }

    private async enqueueRemoteCodeMessage(
        message: string,
        model: string,
        threadId: string,
        attachments: MobileAttachment[],
        reasoningEffort?: string,
        includeContext?: boolean
    ): Promise<string> {
        const targetThreadId = threadId.trim() || this.currentRemoteThreadId || 'remote-code-default';
        this.currentRemoteThreadId = targetThreadId;
        const effort = this.normalizeReasoningEffort(reasoningEffort || this.selectedReasoningEffort);
        this.selectedReasoningEffort = effort;
        this.selectedIncludeContext = includeContext !== false;
        if (model) this.selectedAgent = model;
        const attachmentFiles = this.saveMobileAttachments(attachments);
        const messageForAgent = this.withAttachmentInstructions(message, attachmentFiles);
        const userMessage: CodexChatMessage = {
            id: `remote_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            role: 'user',
            content: messageForAgent,
            timestamp: Date.now(),
            model: model || undefined,
            reasoningEffort: effort,
            includeContext: this.selectedIncludeContext,
            threadId: targetThreadId
        };
        this.codexHistory.push(userMessage);
        this.codexHistory = this.codexHistory.slice(-200);
        this.saveRemoteCodeState();
        this.openPcChatPanel();
        this.refreshPcChatPanel();
        this.broadcast({ type: 'codex:message', message: userMessage, threadId: targetThreadId, timestamp: Date.now() });
        this.broadcast({ type: 'codex:sent', message: messageForAgent, model, reasoningEffort: effort, includeContext: this.selectedIncludeContext, threadId: targetThreadId, timestamp: Date.now() });
        this.broadcast({ type: 'codex:threads-update', threads: this.getRemoteCodeThreads(), timestamp: Date.now() });

        this.answerInPcMirror(messageForAgent, targetThreadId, model, effort, this.selectedIncludeContext).catch(err => {
            const errorMessage: CodexChatMessage = {
                id: `remote_assistant_error_${Date.now()}`,
                role: 'assistant',
                content: `Remote Code Agent error: ${err?.message || String(err)}`,
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

    private openPcChatPanel(): void {
        if (this.pcChatPanel) {
            this.pcChatPanel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }
        this.pcChatPanel = vscode.window.createWebviewPanel(
            'remoteCodePcChat',
            'Remote Code',
            vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        this.pcChatPanel.webview.onDidReceiveMessage(async msg => {
            if (msg?.type === 'send' && typeof msg.message === 'string' && msg.message.trim()) {
                if (typeof msg.profile === 'string') this.selectedProfile = msg.profile;
                if (typeof msg.workMode === 'string') this.selectedWorkMode = msg.workMode;
                await this.enqueueRemoteCodeMessage(
                    msg.message,
                    typeof msg.model === 'string' ? msg.model : this.selectedAgent,
                    '',
                    [],
                    typeof msg.reasoningEffort === 'string' ? msg.reasoningEffort : this.selectedReasoningEffort,
                    msg.includeContext !== false
                );
            } else if (msg?.type === 'action' && typeof msg.action === 'string') {
                await this.handlePcChatAction(msg.action, msg);
            } else if (msg?.type === 'actionResponse' && typeof msg.actionId === 'string') {
                await this.applyActionResponse(msg.actionId, msg.decision === 'approve');
            }
        });
        this.pcChatPanel.onDidDispose(() => {
            this.pcChatPanel = undefined;
        });
        this.refreshPcChatPanel();
    }

    private refreshPcChatPanel(): void {
        if (!this.pcChatPanel) return;
        const messages = this.codexHistory
            .filter(m => (m.threadId || this.currentRemoteThreadId) === this.currentRemoteThreadId)
            .slice(-80);
        const actions = this.getActionEventsForThread(this.currentRemoteThreadId);
        this.pcChatPanel.webview.html = this.renderPcChatHtml(messages, actions);
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
                const text = uris.map(uri => `@${uri.fsPath}`).join('\n');
                await this.pcChatPanel?.webview.postMessage({ type: 'appendPrompt', text: `${text}\n` });
                return;
            }
            case 'newChat':
                this.currentRemoteThreadId = `remote-code-${Date.now()}`;
                this.saveRemoteCodeState();
                this.refreshPcChatPanel();
                this.broadcast({ type: 'codex:threads-update', threads: this.getRemoteCodeThreads(), timestamp: Date.now() });
                return;
            case 'clearChat':
                this.codexHistory = this.codexHistory.filter(message => message.threadId !== this.currentRemoteThreadId);
                this.codexActionEvents = this.codexActionEvents.filter(event => event.threadId !== this.currentRemoteThreadId);
                this.saveRemoteCodeState();
                this.refreshPcChatPanel();
                return;
            case 'openTerminal':
                (vscode.window.activeTerminal || vscode.window.createTerminal('Remote Code')).show();
                return;
            case 'openSettings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'remoteCodeOnPC');
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
            default:
                await vscode.window.showInformationMessage(`Remote Code: ${action}`);
        }
    }

    private async showLocalUsageStatus(): Promise<void> {
        let models: readonly vscode.LanguageModelChat[] = [];
        try {
            models = await vscode.lm.selectChatModels({});
        } catch {
            models = [];
        }
        const workspace = vscode.workspace.workspaceFolders?.[0]?.name || '??? ??????? ?????';
        const modelNames = models
            .map((model: any) => model.name || model.id || model.family || '')
            .filter(Boolean)
            .slice(0, 6)
            .join(', ') || '??? ????????? ??????? VS Code LM';
        await vscode.window.showInformationMessage(
            [
                '?????: ???????? ????????',
                `Workspace: ${workspace}`,
                `?????: ${this.getGitBranchLabel()}`,
                `??????? ??????: ${this.selectedAgent}`,
                `????????? ??????: ${modelNames}`,
                '??????: VS Code API ?? ????????????? ?????? ??????? ???????; ???????? ??????????? ??????? ? ?????? ????????.'
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
            } else if (event.type === 'patch_approval' && event.filePath && event.contentBase64) {
                const text = Buffer.from(event.contentBase64, 'base64').toString('utf8');
                fs.mkdirSync(path.dirname(event.filePath), { recursive: true });
                fs.writeFileSync(event.filePath, text, 'utf8');
                event.detail = `Файл изменен:\n${event.filePath}\n\n${event.diff || ''}`.slice(0, 5000);
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
        this.appendActionResultMessage(event);
        return event;
    }

    private async runApprovedCommand(command: string, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const finalCwd = cwd && path.isAbsolute(cwd) ? cwd : workspace || process.cwd();
        return new Promise(resolve => {
            const child = spawn(command, {
                cwd: finalCwd,
                shell: true,
                windowsHide: true
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', chunk => { stdout += chunk.toString(); });
            child.stderr.on('data', chunk => { stderr += chunk.toString(); });
            child.on('close', code => resolve({ code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() }));
            child.on('error', err => resolve({ code: 1, stdout: stdout.trim(), stderr: err.message || String(err) }));
        });
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
            role: 'system',
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
        const directiveRegex = /::(run-command|write-file)(\{[^\n]+\})/g;
        let match: RegExpExecArray | null;
        const created: RemoteCodeActionEvent[] = [];
        while ((match = directiveRegex.exec(response)) !== null) {
            try {
                const kind = match[1];
                const payload = JSON.parse(match[2]);
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
                }
            } catch (err) {
                console.warn('[RemoteCodeOnPC] Failed to parse action directive:', err);
            }
        }
        if (created.length === 0) return;
        this.codexActionEvents = this.codexActionEvents.concat(created).slice(-250);
        this.saveRemoteCodeState();
        for (const event of created) {
            this.broadcast({
                type: 'codex:approval-request',
                threadId,
                event,
                events: this.getActionEventsForThread(threadId),
                timestamp: Date.now()
            });
        }
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
        return this.codexActionEvents
            .filter(event => !target || event.threadId === target)
            .slice(-80);
    }

    private getCurrentThreadTitle(): string {
        const firstUserMessage = this.codexHistory.find(message =>
            (message.threadId || this.currentRemoteThreadId) === this.currentRemoteThreadId &&
            message.role === 'user' &&
            message.content.trim()
        );
        return firstUserMessage?.content.replace(/\s+/g, ' ').slice(0, 80) || 'Remote Code';
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

    private renderPcChatHtml(messages: CodexChatMessage[], actions: RemoteCodeActionEvent[] = []): string {
        const modelOptions = this.getDefaultCodexModels();
        const selectedModel = modelOptions.some(model => model.id === this.selectedAgent) ? this.selectedAgent : 'gpt-5.5';
        const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'Нет рабочей папки';
        const branchLabel = this.getGitBranchLabel();
        const title = this.getCurrentThreadTitle();
        const effortOptions = [
            { id: 'medium', name: 'Средний' },
            { id: 'low', name: 'Низкий' },
            { id: 'high', name: 'Высокий' },
            { id: 'xhigh', name: 'Очень высокий' }
        ];
        const profileOptions = [
            { id: 'user', name: 'Пользовательские' },
            { id: 'review', name: 'Проверка' },
            { id: 'fast', name: 'Быстрый режим' }
        ];
        const workModeOptions = [
            { id: 'local', name: 'Работать локально' },
            { id: 'workspace', name: workspaceName }
        ];
        const selectedEffort = effortOptions.some(option => option.id === this.selectedReasoningEffort)
            ? this.selectedReasoningEffort
            : 'medium';
        const rows = messages.map(message => {
            const role = message.role === 'user' ? '??' : message.role === 'assistant' ? '' : '???????';
            const cls = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system';
            const meta = [message.model, message.reasoningEffort ? this.reasoningEffortLabel(message.reasoningEffort) : '']
                .filter(Boolean)
                .join(' - ');
            return `<section class="msg ${cls}">
                ${role ? `<div class="role">${this.escapeHtml(role)}</div>` : ''}
                <pre>${this.escapeHtml(message.content)}</pre>
                ${message.role === 'assistant' && meta ? `<div class="meta meta-bottom">${this.escapeHtml(meta)}</div>` : ''}
            </section>`;
        }).join('');
        const actionRows = actions.map(event => `<section class="action ${this.escapeHtml(event.status)}">
            <div class="action-head"><strong>${this.escapeHtml(event.title)}</strong><span>${this.escapeHtml(event.status)}</span></div>
            <pre>${this.escapeHtml(event.detail || event.diff || '')}</pre>
            ${event.actionable && event.status === 'pending' ? `<div class="action-buttons">
                <button type="button" data-action-id="${this.escapeHtml(event.id)}" data-decision="deny">Отклонить</button>
                <button type="button" data-action-id="${this.escapeHtml(event.id)}" data-decision="approve">Разрешить</button>
            </div>` : ''}
        </section>`).join('');
        return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<style>
html,body{height:100%}
body{margin:0;background:#101112;color:#d7d7d7;font:14px/1.48 var(--vscode-font-family);display:flex;flex-direction:column}
.top{height:44px;border-bottom:1px solid #202224;background:#101112;display:flex;align-items:center;gap:10px;padding:0 16px}
.edit-icon{color:#9a9a9a;font-size:18px}
.thread-title{font-size:16px;color:#f0f0f0;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.toolbar-spacer{flex:1}
.icon-btn{width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:#aaa;font:inherit;font-size:16px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.icon-btn:hover{background:#1f2123;color:#e7e7e7}
.pill-btn{height:30px;border:1px solid #2b2d30;border-radius:9px;background:#17191b;color:#bdbdbd;padding:0 10px;font:inherit;cursor:pointer}
.pill-btn:hover{background:#222426;color:#e5e5e5}
.messages{flex:1;overflow:auto;padding:18px min(3.8vw,42px) 12px}
.msg{padding:4px 0 16px;margin:0;background:transparent;border:0;max-width:1040px}
.msg.user{max-width:620px;margin-left:auto;color:#f0f0f0}
.msg.user .role,.msg.user .meta{display:none}
.msg.user pre{background:#2a2b2d;border:1px solid #303235;border-radius:18px;padding:12px 16px}
.msg.system pre{color:#aeb0b3}
.role{font-weight:600;color:#dcdcdc;margin-bottom:5px}
.meta{font-size:12px;color:#8e8e8e;margin:-1px 0 6px}
.meta-bottom{margin:8px 0 0;color:#858585}
.assistant .role{color:#dcdcdc}.system .role{color:#e8b66b}
pre{margin:0;white-space:pre-wrap;word-wrap:break-word;font:inherit}
.action{max-width:980px;margin:0 0 14px;padding:10px 12px;background:#202123;border:1px solid #303236;border-radius:10px}
.action-head{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#e2e2e2;margin-bottom:8px}
.action-head span{font-size:12px;color:#999}
.action pre{max-height:220px;overflow:auto;color:#cfcfcf;font:12px/1.45 var(--vscode-editor-font-family, monospace)}
.action-buttons{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.action-buttons button{border:1px solid #3a3d42;background:#2c2e31;color:#d9d9d9;border-radius:8px;padding:6px 10px;cursor:pointer}
.action-buttons button:hover{background:#383b3f}
.composer-wrap{padding:8px min(3.8vw,42px) 14px;background:#101112}
.composer{max-width:1040px;margin:0 auto;border:1px solid #282a2d;background:#2b2b2d;border-radius:22px;padding:12px 14px 9px;display:flex;flex-direction:column;gap:8px;box-shadow:none}
.controls{display:flex;gap:8px;align-items:center;min-width:0}
.subcontrols{display:flex;gap:14px;align-items:center;margin:4px auto 0;max-width:1040px;color:#8e8e8e;font-size:13px}
.plus{font-size:25px;line-height:1;color:#b8b8b8;background:transparent;border:0;width:34px;padding:0;cursor:pointer}
textarea{width:100%;box-sizing:border-box;resize:none;min-height:58px;max-height:170px;border:0;background:transparent;color:#e8e8e8;padding:2px 0;font:inherit;font-size:14px;outline:none}
textarea::placeholder{color:#707070}
.dropdown{position:relative;flex:0 1 142px;min-width:0}
.dropdown.effort{flex-basis:112px}
.dropdown.profile{flex-basis:168px}
.dropdown.workmode{flex:0 1 172px}
.dropdown-btn{height:32px;width:100%;border:0;background:transparent;color:#bdbdbd;padding:0 7px;font:inherit;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:7px;border-radius:8px;cursor:pointer}
.dropdown-btn:hover,.dropdown.open .dropdown-btn{background:#343537;color:#e0e0e0}
.chev{font-size:16px;color:#9a9a9a}
.menu{display:none;position:absolute;left:0;bottom:40px;min-width:100%;max-height:260px;overflow:auto;background:#252526;border:1px solid #3a3a3a;border-radius:10px;padding:6px;box-shadow:0 10px 30px rgba(0,0,0,.45);z-index:5}
.dropdown.open .menu{display:block}
.item{width:100%;text-align:left;border:0;background:transparent;color:#d7d7d7;padding:8px 10px;border-radius:7px;font:inherit;cursor:pointer;white-space:nowrap}
.item:hover{background:#343638}
.item.selected{color:#f1f1f1;background:#313438}
.context{margin-left:auto;color:#4bb4ff;font-weight:500;white-space:nowrap;border:0;background:transparent;font:inherit;font-size:13px;cursor:pointer;border-radius:8px;padding:7px 8px}
.context.off{color:#8e8e8e}
.context:hover{background:#343537}
.context .spark{padding-right:4px}
button.send{border:0;border-radius:50%;background:#b7b7b7;color:#111;width:44px;height:44px;font-size:22px;font-weight:700;cursor:pointer;white-space:nowrap}
.link-btn{border:0;background:transparent;color:#8e8e8e;font:inherit;cursor:pointer;padding:4px 0}
.link-btn:hover{color:#d0d0d0}
@media (max-width: 680px){.messages{padding-left:18px;padding-right:18px}.composer-wrap{padding-left:12px;padding-right:12px}.controls{flex-wrap:wrap}.context{margin-left:0}button.send{margin-left:auto}.toolbar{padding:0 10px}.subcontrols{gap:10px;flex-wrap:wrap}}
</style>
</head>
<body>
<div class="top">
  <button class="icon-btn edit-icon" type="button" data-action="newChat" title="Новый чат">&#9633;</button>
  <div class="thread-title">${this.escapeHtml(title)}</div>
  <button class="icon-btn" type="button" data-action="clearChat" title="Очистить чат">...</button>
  <div class="toolbar-spacer"></div>
  <button class="icon-btn" type="button" id="topRun" title="Отправить">&triangleright;</button>
  <button class="pill-btn" type="button" data-action="showUsageStatus" title="?????? ????????? ??????">VS Code</button>
  <button class="icon-btn" type="button" data-action="openTerminal" title="Терминал">&#9633;</button>
  <button class="icon-btn" type="button" data-action="openSettings" title="Настройки">&#9881;</button>
</div>
<main class="messages" id="messages">
${rows || '<div class="msg system"><div class="role">Система</div><pre>Жду сообщение с телефона или из VS Code.</pre></div>'}
${actionRows}
</main>
<div class="composer-wrap">
  <form class="composer" id="composer">
    <textarea id="prompt" placeholder="Запросите внесение дополнительных изменений"></textarea>
    <div class="controls">
      <button class="plus" type="button" data-action="addFile" title="Добавить файл">+</button>
      <div class="dropdown profile" id="profileDrop">
        <button class="dropdown-btn" type="button"><span>&#9881;</span><span id="profileLabel"></span><span class="chev">&#8964;</span></button>
        <div class="menu" id="profileMenu"></div>
      </div>
      <div class="dropdown" id="modelDrop">
        <button class="dropdown-btn" type="button"><span id="modelLabel"></span><span class="chev">&#8964;</span></button>
        <div class="menu" id="modelMenu"></div>
      </div>
      <div class="dropdown effort" id="effortDrop">
        <button class="dropdown-btn" type="button"><span id="effortLabel"></span><span class="chev">&#8964;</span></button>
        <div class="menu" id="effortMenu"></div>
      </div>
      <button class="context" id="contextToggle" type="button"><span class="spark">*</span>Контекст IDE</button>
      <button class="send" id="send" type="submit">&uarr;</button>
    </div>
  </form>
  <div class="subcontrols">
    <div class="dropdown workmode" id="workModeDrop">
      <button class="dropdown-btn" type="button"><span id="workModeLabel"></span><span class="chev">&#8964;</span></button>
      <div class="menu" id="workModeMenu"></div>
    </div>
    <button class="link-btn" type="button" data-action="showBranch">ветка ${this.escapeHtml(branchLabel)}</button>
  </div>
</div>
<script>
const vscode = acquireVsCodeApi();
const form = document.getElementById('composer');
const prompt = document.getElementById('prompt');
const messages = document.getElementById('messages');
const modelOptions = ${JSON.stringify(modelOptions)};
const effortOptions = ${JSON.stringify(effortOptions)};
const profileOptions = ${JSON.stringify(profileOptions)};
const workModeOptions = ${JSON.stringify(workModeOptions)};
let selectedModel = ${JSON.stringify(selectedModel)};
let selectedEffort = ${JSON.stringify(selectedEffort)};
let selectedProfile = ${JSON.stringify(this.selectedProfile)};
let selectedWorkMode = ${JSON.stringify(this.selectedWorkMode)};
let includeContext = ${JSON.stringify(this.selectedIncludeContext)};
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
function refreshControls() {
  renderDropdown('modelDrop', 'modelMenu', 'modelLabel', modelOptions, selectedModel, value => {
    selectedModel = value;
    refreshControls();
  });
  renderDropdown('effortDrop', 'effortMenu', 'effortLabel', effortOptions, selectedEffort, value => {
    selectedEffort = value;
    refreshControls();
  });
  renderDropdown('profileDrop', 'profileMenu', 'profileLabel', profileOptions, selectedProfile, value => {
    selectedProfile = value;
    vscode.postMessage({ type: 'action', action: 'selectProfile', profile: selectedProfile });
    refreshControls();
  });
  renderDropdown('workModeDrop', 'workModeMenu', 'workModeLabel', workModeOptions, selectedWorkMode, value => {
    selectedWorkMode = value;
    vscode.postMessage({ type: 'action', action: 'selectWorkMode', mode: selectedWorkMode });
    refreshControls();
  });
  document.getElementById('contextToggle').classList.toggle('off', !includeContext);
}
document.querySelectorAll('.dropdown-btn').forEach(button => {
  button.addEventListener('click', event => {
    const root = event.currentTarget.closest('.dropdown');
    const isOpen = root.classList.contains('open');
    document.querySelectorAll('.dropdown.open').forEach(drop => drop.classList.remove('open'));
    if (!isOpen) root.classList.add('open');
  });
});
document.addEventListener('click', event => {
  if (!event.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown.open').forEach(drop => drop.classList.remove('open'));
  }
});
document.getElementById('contextToggle').addEventListener('click', () => {
  includeContext = !includeContext;
  refreshControls();
});
document.querySelectorAll('[data-action]').forEach(button => {
  button.addEventListener('click', () => {
    vscode.postMessage({ type: 'action', action: button.dataset.action });
  });
});
document.querySelectorAll('[data-action-id]').forEach(button => {
  button.addEventListener('click', () => {
    vscode.postMessage({ type: 'actionResponse', actionId: button.dataset.actionId, decision: button.dataset.decision });
  });
});
document.getElementById('topRun').addEventListener('click', () => form.requestSubmit());
window.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'appendPrompt' && typeof data.text === 'string') {
    prompt.value = prompt.value ? prompt.value + '\\n' + data.text : data.text;
    prompt.focus();
  }
});
refreshControls();
messages.scrollTop = messages.scrollHeight;
form.addEventListener('submit', event => {
  event.preventDefault();
  const message = prompt.value.trim();
  if (!message) return;
  vscode.postMessage({ type: 'send', message, model: selectedModel, reasoningEffort: selectedEffort, includeContext, profile: selectedProfile, workMode: selectedWorkMode });
  prompt.value = '';
});
prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    form.requestSubmit();
  }
});
</script>
</body>
</html>`;
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
    private async handleTunnelStatus(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        this.jsonResponse(res, 200, {
            tunnelActive: !!this._tunnelUrl,
            tunnelUrl: this._tunnelUrl,
            localIp: this._localIp,
            port: this._port,
            localUrl: `http://${this._localIp}:${this._port}`,
            publicUrl: this._tunnelUrl
        });
    }

    // POST /api/tunnel/start
    private async handleTunnelStart(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (this._tunnelUrl) {
            this.jsonResponse(res, 200, { success: true, url: this._tunnelUrl, message: 'Туннель уже активен' });
            return;
        }
        try {
            const url = await this.startTunnel();
            this.jsonResponse(res, 200, { success: true, url, message: 'Туннель запущен через ngrok' });
        } catch (err: any) {
            this.jsonResponse(res, 500, { success: false, error: err.message });
        }
    }

    // POST /api/tunnel/stop
    private async handleTunnelStop(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        this.stopTunnel();
        this.jsonResponse(res, 200, { success: true, message: 'Туннель остановлен' });
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
        const params = url.parse(req.url || '', true).query;
        const requestedThreadId = typeof params.threadId === 'string' && params.threadId.trim()
            ? params.threadId.trim()
            : this.currentRemoteThreadId;
        this.currentRemoteThreadId = requestedThreadId || 'remote-code-default';
        const messages = this.codexHistory
            .filter(m => (m.threadId || this.currentRemoteThreadId) === this.currentRemoteThreadId)
            .slice(-120);
        this.jsonResponse(res, 200, {
            threadId: this.currentRemoteThreadId,
            title: this.getRemoteCodeThreads().find(t => t.id === this.currentRemoteThreadId)?.title || 'Remote Code',
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
        const { message, model, threadId, attachments, reasoningEffort, includeContext } = JSON.parse(body);

        if (!message) {
            this.jsonResponse(res, 400, { error: 'Message is required' });
            return;
        }

        try {
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
                method: 'remote-code-agent',
                message: 'Sent to Remote Code Agent',
                threadId: targetThreadId,
                reasoningEffort: this.selectedReasoningEffort,
                includeContext: this.selectedIncludeContext,
                note: 'Remote Code Agent owns this cross-device chat.'
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
                note: 'Only Codex/OpenAI-compatible VS Code models are shown.'
            });
        } catch (err: any) {
            this.jsonResponse(res, 200, {
                models: this.getDefaultCodexModels(),
                selected: this.selectedAgent,
                error: err.message
            });
        }
    }

    // POST /api/codex/models
    private async handleCodexSelectModel(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { modelId } = JSON.parse(body || '{}');

        if (!modelId) {
            this.jsonResponse(res, 400, { error: 'modelId is required' });
            return;
        }

        try {
            const agents = this.getRemoteCodeModelAgents(await this.getAvailableAgents());
            if (!agents.find(agent => agent.name === modelId)) {
                this.jsonResponse(res, 400, { error: `Model ${modelId} is not available for Remote Code Agent` });
                return;
            }
            this.selectedAgent = modelId;
            this.saveRemoteCodeState();
            this.broadcast({ type: 'codex:model-changed', model: modelId, timestamp: Date.now() });
            this.jsonResponse(res, 200, { success: true, model: modelId, result: `Model changed to ${modelId}` });
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
            this.jsonResponse(res, 200, { threads: this.getRemoteCodeThreads() });
        } catch (err: any) {
            this.jsonResponse(res, 200, { threads: [], error: err.message });
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
                method: 'remote-code-agent',
                note: 'Remote Code Agent chat opened in VS Code'
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

    private async startTunnel(): Promise<string> {
        // Сначала пробуем найти установленный ngrok
        const ngrokPaths = [
            'ngrok',
            path.join(process.env.LOCALAPPDATA || '', 'ngrok', 'ngrok.exe'),
            path.join(process.env.PROGRAMFILES || '', 'ngrok', 'ngrok.exe'),
            'C:\\tools\\ngrok.exe',
            path.join(process.env.USERPROFILE || '', 'ngrok.exe'),
        ];

        let ngrokCmd: string | null = null;
        for (const p of ngrokPaths) {
            try {
                const test = this.execSync(`where ${p} 2>nul || echo NOT_FOUND`).trim();
                if (!test.includes('NOT_FOUND')) {
                    ngrokCmd = p;
                    break;
                }
            } catch { continue; }
        }

        // Если ngrok не найден — пробуем npx ngrok
        if (!ngrokCmd) {
            try {
                const test = this.execSync(`npx ngrok version 2>&1`).trim();
                if (test && !test.includes('not found')) {
                    ngrokCmd = 'npx ngrok';
                }
            } catch { /* ignore */ }
        }

        if (!ngrokCmd) {
            throw new Error('ngrok не найден. Скачайте: https://ngrok.com/download или установите: npm i -g ngrok');
        }

        return new Promise((resolve, reject) => {
            const args = ['http', String(this._port), '--log=stdout'];
            
            // Добавляем файл конфига если есть
            const ngrokConfig = path.join(process.env.USERPROFILE || '', '.ngrok2', 'ngrok.yml');
            if (fs.existsSync(ngrokConfig)) {
                args.push('--config', ngrokConfig);
            }

            const proc = spawn(ngrokCmd, args, {
                windowsHide: true,
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this._tunnelProcess = proc;
            let output = '';

            proc.stdout.on('data', (data: Buffer) => {
                const text = data.toString();
                output += text;
                // Ищем URL в выводе
                const urlMatch = text.match(/https?:\/\/[a-zA-Z0-9_-]+\.ngrok[-a-zA-Z0-9]*\.(io|app)/);
                if (urlMatch) {
                    this._tunnelUrl = urlMatch[0];
                    console.log(`[RemoteCodeOnPC] Туннель ngrok: ${this._tunnelUrl}`);
                    // Сохраняем URL и сообщаем пользователю
                    vscode.window.showInformationMessage(`🌐 Интернет-доступ: ${this._tunnelUrl}`);
                    resolve(this._tunnelUrl);
                }
            });

            proc.stderr.on('data', (data: Buffer) => {
                output += data.toString();
                const urlMatch = data.toString().match(/https?:\/\/[a-zA-Z0-9_-]+\.ngrok[-a-zA-Z0-9]*\.(io|app)/);
                if (urlMatch) {
                    this._tunnelUrl = urlMatch[0];
                    vscode.window.showInformationMessage(`🌐 Интернет-доступ: ${this._tunnelUrl}`);
                    resolve(this._tunnelUrl);
                }
            });

            proc.on('close', (code: number) => {
                if (!this._tunnelUrl) {
                    this._tunnelProcess = null;
                    reject(new Error(`ngrok завершился с кодом ${code}. Вывод: ${output.slice(0, 500)}`));
                }
            });

            proc.on('error', (err: Error) => {
                this._tunnelProcess = null;
                reject(new Error(`Ошибка запуска ngrok: ${err.message}`));
            });

            // Таймаут 15 секунд
            setTimeout(() => {
                if (!this._tunnelUrl) {
                    proc.kill();
                    this._tunnelProcess = null;
                    reject(new Error('Таймаут запуска ngrok (15 сек)'));
                }
            }, 15000);
        });
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

    private getCodexThreadSummariesFast(): Array<{ id: string; title: string; timestamp: number }> {
        const index = this.getCodexSessionIndex();
        let threads = Array.from(index.entries()).map(([id, meta]) => ({
            id,
            title: meta.title || 'Codex',
            timestamp: Math.round(meta.timestamp || 0)
        }));

        if (threads.length === 0) {
            threads = this.getCodexSessionFiles(60).map(filePath => ({
                id: this.codexIdFromFilePath(filePath),
                title: path.basename(filePath, '.jsonl'),
                timestamp: Math.round(fs.statSync(filePath).mtimeMs)
            }));
        }

        threads.sort((a, b) => b.timestamp - a.timestamp);
        return threads.slice(0, 80);
    }

    private codexIdFromFilePath(filePath: string): string {
        return path.basename(filePath, '.jsonl').replace(/^rollout-[^-]+-\d\d-\d\dT\d\d-\d\d-\d\d-/, '');
    }

    private findCodexSessionFile(threadId: string): string | undefined {
        return this.getCodexSessionFiles(300).find(filePath => this.codexIdFromFilePath(filePath) === threadId);
    }

    private parseCodexSessionFile(
        filePath: string,
        index: Map<string, { title: string; timestamp: number }>
    ): { id: string; title: string; timestamp: number; messages: CodexChatMessage[]; filePath: string } | null {
        try {
            const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
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

                if (item.type === 'event_msg' && payload.type === 'agent_message' && payload.message) {
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

            return { id, title, timestamp: Math.round(timestamp), messages, filePath };
        } catch {
            return null;
        }
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
                mimeType: attachment.mimeType || 'application/octet-stream',
                size: data.length
            });
        }
        return saved;
    }

    private withAttachmentInstructions(message: string, attachments: Array<{ name: string; path: string; mimeType: string; size: number }>): string {
        if (attachments.length === 0) return message;
        const lines = attachments.map((file, index) =>
            `${index + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes): ${file.path}`
        );
        return `${message}\n\nAttached files from Android were saved on this PC. Use these local paths when needed:\n${lines.join('\n')}`;
    }

    private formatCommandExecutable(command: string): string {
        if (command.startsWith('npx ')) return command;
        return this.quoteShellArg(command);
    }

    private quoteShellArg(value: string): string {
        return JSON.stringify(value);
    }
}
