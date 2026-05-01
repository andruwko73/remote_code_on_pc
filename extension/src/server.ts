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
    isStreaming?: boolean;
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
    private selectedAgent: string = 'auto';
    private agentCache?: { timestamp: number; agents: ChatAgent[] };
    private codexHistory: CodexChatMessage[] = [];

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

    async openOfficialCodex(): Promise<void> {
        const extension = vscode.extensions.getExtension('openai.chatgpt');
        if (!extension) {
            throw new Error('Official Codex extension openai.chatgpt is not installed.');
        }
        if (!extension.isActive) {
            await extension.activate();
        }
        await vscode.commands.executeCommand('chatgpt.openSidebar');
    }

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
                    this.restoreChatHistory();

                    // Запускаем слежение за изменениями JSONL-файлов чатов
                    this.startChatSessionWatcher();

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
                    return this.handleCodexHistoryFast(req, res);
                case pathname === '/api/codex/events':
                    return this.handleCodexEvents(req, res);
                case pathname === '/api/codex/actions':
                    return this.handleCodexActionResponse(req, res);
                case pathname === '/api/codex/models' && req.method === 'GET':
                    return this.handleCodexModels(req, res);
                case pathname === '/api/codex/models' && req.method === 'POST':
                    return this.handleCodexSelectModel(req, res);
                case pathname === '/api/codex/threads':
                    return this.handleCodexThreadsFast(req, res);
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
        // Получаем доступные chat-агенты из VS Code
        const agents = await this.getAvailableAgents();
        const chats = this.getAllVSCodeChats();
        if ((this.currentChatId === 'default' || this.getVSCodeChatHistory(this.currentChatId).length === 0) && chats.length > 0) {
            this.currentChatId = chats[0].id;
        }
        this.jsonResponse(res, 200, {
            agents,
            selected: this.selectedAgent,
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
        if ((this.currentChatId === 'default' || this.getVSCodeChatHistory(this.currentChatId).length === 0) && jsonlChats.length > 0) {
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
                            threads: this.getCodexSessionsFromFiles().map(s => ({
                                id: s.id,
                                title: s.title,
                                timestamp: s.timestamp
                            })),
                            timestamp: Date.now()
                        });
                    }, 500);
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
                { name: 'gpt-4o', displayName: 'GPT-4o', vendor: 'openai', model: 'GPT-4o' },
                { name: 'gpt-4o-mini', displayName: 'GPT-4o-mini', vendor: 'openai', model: 'GPT-4o-mini' },
                { name: 'deepseek-v3', displayName: 'DeepSeek V3', vendor: 'deepseek', model: 'DeepSeek V3' },
                { name: 'o3-mini', displayName: 'o3-mini', vendor: 'openai', model: 'o3-mini' },
                { name: 'o4-mini', displayName: 'o4-mini', vendor: 'openai', model: 'o4-mini' },
                { name: 'claude-sonnet', displayName: 'Claude Sonnet', vendor: 'anthropic', model: 'Claude 3.5 Sonnet' },
            );
        }

        // Если selected agent не в списке, сбрасываем на первый
        if (!agents.find(a => a.name === this.selectedAgent)) {
            this.selectedAgent = agents[0]?.name || 'auto';
        }

        this.agentCache = { timestamp: Date.now(), agents };
        return agents;
    }

    private async sendToChat(message: string, agentName: string): Promise<string> {
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

            // Ищем модель, соответствующую выбранному агенту
            let model = models[0];
            if (agentName && agentName !== 'auto') {
                const found = models.find(m => {
                    const mId = (m as any).id || (m as any).name || '';
                    const mVendor = (m as any).vendor || '';
                    return mId.includes(agentName) || mVendor.includes(agentName);
                });
                if (found) model = found;
            }

            const messages = [
                new vscode.LanguageModelChatMessage(
                    vscode.LanguageModelChatMessageRole.User,
                    message
                )
            ];

            // Отправляем запрос и собираем стриминг-ответ
            const response = await model.sendRequest(messages, {});

            let result = '';
            for await (const chunk of response.text) {
                result += chunk;
            }
            return result || '(пустой ответ)';
        } catch (err: any) {
            const errorMessage = err?.message || String(err);
            console.warn('[RemoteCodeOnPC] VS Code LM request failed:', errorMessage);
            throw new Error(`VS Code language model request failed: ${errorMessage}`);
        }
    }

    private async sendToOfficialCodexComposer(message: string): Promise<void> {
        await this.openOfficialCodex();
        await new Promise(resolve => setTimeout(resolve, 500));

        let previousClipboard = '';
        try {
            previousClipboard = await vscode.env.clipboard.readText();
        } catch {
            previousClipboard = '';
        }
        await vscode.env.clipboard.writeText(message);

        try {
            await this.sendKeysToVSCode('^v', '{ENTER}');
        } finally {
            setTimeout(() => {
                vscode.env.clipboard.writeText(previousClipboard).then(undefined, () => undefined);
            }, 1500);
        }
    }

    private sendKeysToVSCode(...keys: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            if (process.platform !== 'win32') {
                reject(new Error('Official Codex UI automation is currently implemented for Windows only.'));
                return;
            }

            const sendKeys = keys
                .map((key, index) => `$wshell.SendKeys('${key}')${index < keys.length - 1 ? '\nStart-Sleep -Milliseconds 150' : ''}`)
                .join('\n');
            const script = [
                'Start-Sleep -Milliseconds 350',
                '$wshell = New-Object -ComObject WScript.Shell',
                "$null = $wshell.AppActivate('Visual Studio Code')",
                'Start-Sleep -Milliseconds 350',
                sendKeys
            ].join('\n');
            const encoded = Buffer.from(script, 'utf16le').toString('base64');
            const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stderr = '';
            proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
            proc.on('error', reject);
            proc.on('close', (code: number | null) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(stderr.trim() || `PowerShell SendKeys failed with code ${code ?? 'unknown'}`));
                }
            });
        });
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
            const savedAgent = this._context.globalState.get<string>('selected_agent', 'default');
            this.selectedAgent = savedAgent;

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
    private async handleCodexHistory(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        this.jsonResponse(res, 200, {
            messages: this.codexHistory.slice(-100)
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
                messages: selected.messages.slice(-120)
            });
        } catch (err: any) {
            this.jsonResponse(res, 200, { threadId: '', title: '', messages: [], error: err.message });
        }
    }

    private async handleCodexEvents(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const params = url.parse(req.url || '', true).query;
        this.jsonResponse(res, 200, {
            threadId: (params.threadId as string) || '',
            events: []
        });
    }

    private async handleCodexActionResponse(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { actionId, approve } = JSON.parse(body || '{}');
        this.broadcast({
            type: 'codex:action-update',
            actionId,
            approve,
            timestamp: Date.now()
        });
        this.jsonResponse(res, 200, {
            success: true,
            actionId,
            status: approve === true || approve === 'true' ? 'approved' : 'denied'
        });
    }

    // POST /api/codex/send
    private async handleCodexSendRealtime(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { message, model, threadId, attachments } = JSON.parse(body);

        if (!message) {
            this.jsonResponse(res, 400, { error: 'Message is required' });
            return;
        }

        try {
            const attachmentFiles = this.saveMobileAttachments(Array.isArray(attachments) ? attachments : []);
            const messageForCodex = this.withAttachmentInstructions(message, attachmentFiles);
            await this.sendToOfficialCodexComposer(messageForCodex);

            const userMessage: CodexChatMessage = {
                id: `codex_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                role: 'user',
                content: messageForCodex,
                timestamp: Date.now(),
                model: typeof model === 'string' && model ? model : undefined
            };
            this.codexHistory.push(userMessage);
            this.codexHistory = this.codexHistory.slice(-100);
            this.broadcast({ type: 'codex:message', message: userMessage, threadId, timestamp: Date.now() });
            this.broadcast({ type: 'codex:sent', message: messageForCodex, model, threadId, timestamp: Date.now() });

            this.jsonResponse(res, 200, {
                success: true,
                method: 'official-vscode-codex-ui',
                message: 'Sent to the official Codex VS Code extension',
                note: 'Response streaming is owned by the official Codex sidebar.'
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
            const codexPath = this.findCodexCli();
            if (!codexPath) {
                this.jsonResponse(res, 200, {
                    models: this.getDefaultCodexModels(),
                    selected: null,
                    note: 'Codex CLI не установлен.'
                });
                return;
            }

            // Читаем текущую модель из конфиг-файла
            let selected = '';
            const configPath = this.getCodexConfigPath();
            const configFile = path.join(configPath, 'config.toml');
            if (fs.existsSync(configFile)) {
                const config = fs.readFileSync(configFile, 'utf-8');
                const modelMatch = config.match(/^model\s*=\s*"([^"]+)"/m);
                if (modelMatch) selected = modelMatch[1];
            }

            this.jsonResponse(res, 200, {
                models: this.getDefaultCodexModels(),
                selected,
                note: 'Модели предоставляются через Codex CLI (ChatGPT подписка)'
            });
        } catch (err: any) {
            this.jsonResponse(res, 200, {
                models: this.getDefaultCodexModels(),
                selected: '',
                error: err.message
            });
        }
    }

    // POST /api/codex/models
    private async handleCodexSelectModel(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const { modelId } = JSON.parse(body);

        if (!modelId) {
            this.jsonResponse(res, 400, { error: 'modelId is required' });
            return;
        }

        try {
            const codexPath = this.findCodexCli();
            if (!codexPath) {
                this.jsonResponse(res, 400, { error: 'Codex CLI не установлен' });
                return;
            }

            // Обновляем модель в конфиг-файле напрямую
            const configPath = this.getCodexConfigPath();
            const configFile = path.join(configPath, 'config.toml');
            if (fs.existsSync(configFile)) {
                let config = fs.readFileSync(configFile, 'utf-8');
                if (config.includes('model =')) {
                    config = config.replace(/^model\s*=.*$/m, `model = "${modelId}"`);
                } else {
                    config = `model = "${modelId}"\n` + config;
                }
                fs.writeFileSync(configFile, config, 'utf-8');
            }

            this.jsonResponse(res, 200, { success: true, model: modelId, result: `Модель изменена на ${modelId}` });
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
            this.jsonResponse(res, 200, { threads: threads.slice(0, 80) });
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
            await this.openOfficialCodex();
            this.jsonResponse(res, 200, {
                success: true,
                method: 'official-vscode-codex',
                note: 'Official Codex Sidebar opened in VS Code'
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
            { id: 'o4-mini', name: 'o4-mini (быстрый)' },
            { id: 'o3-mini', name: 'o3-mini (средний)' },
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
            { id: 'gpt-4.1', name: 'GPT-4.1' },
            { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
            { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
            { id: 'deepseek-chat', name: 'DeepSeek V3' },
            { id: 'deepseek-reasoner', name: 'DeepSeek R1' },
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
