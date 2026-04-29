import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';

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
    private selectedAgent: string = 'default';

    // WebSocket event listeners cleanup
    private diagnosticDisposable: vscode.Disposable | undefined;

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

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.httpServer = http.createServer((req, res) => this.handleRequest(req, res));

                this.wss = new WebSocketServer({ server: this.httpServer });
                this.wss.on('connection', (ws) => this.handleWsConnection(ws));

                this.httpServer.listen(this._port, this._host, () => {
                    this._isRunning = true;
                    console.log(`[RemoteCodeOnPC] Сервер запущен на ${this._host}:${this._port}`);

                    // Следим за диагностикой
                    this.diagnosticDisposable = vscode.languages.onDidChangeDiagnostics(() => {
                        this.broadcastDiagnostics();
                    });

                    resolve();
                });

                this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
                    this._isRunning = false;
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    async stop(): Promise<void> {
        this._isRunning = false;
        this.diagnosticDisposable?.dispose();

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
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
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
        const agents = this.getAvailableAgents();
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
    private async handleChatHistory(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const params = url.parse(req.url || '', true).query;
        const chatId = (params.chatId as string) || this.currentChatId;

        const history = this.chatHistory.get(chatId) || [];
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

        const available = this.getAvailableAgents();
        const agent = available.find(a => a.name === agentName);

        if (!agent) {
            this.jsonResponse(res, 400, { error: `Agent '${agentName}' not found`, available: available.map(a => a.name) });
            return;
        }

        this.selectedAgent = agentName;

        // Пробуем переключить агента в VS Code
        try {
            await vscode.commands.executeCommand('github.copilot.chat.focus');
            // Отправляем команду смены агента через вставку текста
            const chatAgentCmd = agent.displayName || agent.name;
            vscode.env.clipboard.writeText(`@${chatAgentCmd} `);
        } catch (e) {
            // Игнорируем, если команда недоступна
        }

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
        this.jsonResponse(res, 200, { chatId: newId });
    }

    // GET /api/chat/conversations
    private async handleGetConversations(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const conversations = Array.from(this.chatHistory.keys()).map(id => {
            const msgs = this.chatHistory.get(id) || [];
            return {
                id,
                messageCount: msgs.length,
                lastMessage: msgs.length > 0 ? msgs[msgs.length - 1].content.slice(0, 100) : '',
                lastTimestamp: msgs.length > 0 ? msgs[msgs.length - 1].timestamp : 0,
                isCurrent: id === this.currentChatId
            };
        });

        this.jsonResponse(res, 200, {
            conversations: conversations.sort((a, b) => b.lastTimestamp - a.lastTimestamp),
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
            const terminal = vscode.window.activeTerminal || vscode.window.createTerminal('Remote');
            terminal.show();
            terminal.sendText(command);
            this.jsonResponse(res, 200, { success: true, message: 'Command sent to terminal' });
        } catch (err: any) {
            this.jsonResponse(res, 500, { error: err.message });
        }
    }

    // ========== WEBSOCKET ==========

    private handleWsConnection(ws: WebSocket): void {
        this.wsClients.add(ws);
        console.log(`[RemoteCodeOnPC] WebSocket клиент подключился. Всего: ${this.wsClients.size}`);

        // Отправляем приветствие
        ws.send(JSON.stringify({
            type: 'connected',
            message: 'Connected to Remote Code on PC',
            timestamp: Date.now()
        }));

        ws.on('close', () => {
            this.wsClients.delete(ws);
            console.log(`[RemoteCodeOnPC] WebSocket клиент отключился. Осталось: ${this.wsClients.size}`);
        });

        ws.on('error', (err) => {
            console.error('[RemoteCodeOnPC] WebSocket error:', err.message);
            this.wsClients.delete(ws);
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                console.log('[RemoteCodeOnPC] WS сообщение:', msg.type);
                // Можно обрабатывать входящие WS сообщения
            } catch (e) {
                console.error('[RemoteCodeOnPC] Invalid WS message');
            }
        });
    }

    private broadcast(data: any): void {
        const payload = JSON.stringify(data);
        for (const ws of this.wsClients) {
            try {
                ws.send(payload);
            } catch (e) {
                // ignore
            }
        }
    }

    private async broadcastDiagnostics(): Promise<void> {
        const items: DiagnosticItem[] = [];
        const allDiagnostics = vscode.languages.getDiagnostics();

        for (const [uri, diagnostics] of allDiagnostics) {
            for (const d of diagnostics) {
                items.push({
                    file: uri.fsPath,
                    line: d.range.start.line + 1,
                    column: d.range.start.character + 1,
                    message: d.message,
                    severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' :
                             d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : 'info'
                });
            }
        }

        this.broadcast({
            type: 'diagnostics:update',
            total: items.length,
            errors: items.filter(i => i.severity === 'error').length,
            warnings: items.filter(i => i.severity === 'warning').length,
            items: items.slice(0, 50) // первые 50
        });
    }

    // ========== HELPERS ==========

    private checkAuth(req: http.IncomingMessage): boolean {
        const authHeader = req.headers['authorization'];
        if (!authHeader) return false;
        return authHeader === `Bearer ${this._authToken}`;
    }

    private jsonResponse(res: http.ServerResponse, status: number, data: any): void {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data, null, 2));
    }

    private readBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', () => resolve(Buffer.concat(chunks).toString()));
            req.on('error', reject);
        });
    }

    private getAvailableAgents(): ChatAgent[] {
        // VS Code Chat participants / агенты
        const agents: ChatAgent[] = [
            { name: 'default', displayName: 'Default (Copilot)', vendor: 'GitHub', isDefault: true },
            { name: 'ask', displayName: 'Ask', vendor: 'GitHub' },
            { name: 'explain', displayName: 'Explain', vendor: 'GitHub' },
            { name: 'fix', displayName: 'Fix', vendor: 'GitHub' },
            { name: 'test', displayName: 'Generate Tests', vendor: 'GitHub' },
            { name: 'edit', displayName: 'Edit Code', vendor: 'GitHub' },
            { name: 'review', displayName: 'Review', vendor: 'GitHub' },
            { name: 'doc', displayName: 'Generate Docs', vendor: 'GitHub' },
            { name: 'explore', displayName: 'Explore', vendor: 'GitHub' },
        ];

        // Пытаемся получить агентов из Copilot Chat API
        try {
            const config = vscode.workspace.getConfiguration('github.copilot');
            const model = config.get<string>('model', '');
            if (model) {
                agents.push({ name: 'custom', displayName: `Model: ${model}`, model, vendor: 'GitHub' });
            }
        } catch (e) {
            // ignore
        }

        return agents;
    }

    private async sendToChat(message: string, agentName: string): Promise<string> {
        // Пробуем использовать VS Code Copilot API
        try {
            // Фокусируем чат
            await vscode.commands.executeCommand('github.copilot.chat.focus');

            // Если выбран не дефолтный агент, вставляем @agent префикс
            let fullMessage = message;
            if (agentName && agentName !== 'default') {
                const agent = this.getAvailableAgents().find(a => a.name === agentName);
                if (agent) {
                    fullMessage = `@${agent.displayName} ${message}`;
                }
            }

            // Отправляем через команду Copilot
            await vscode.commands.executeCommand('github.copilot.chat.sendMessage', fullMessage);

            // Возвращаем подтверждение
            return `✅ Запрос отправлен агенту **${agentName}**.\n\n_Полный ответ появится в VS Code Chat. Подключитесь к WebSocket для получения ответа в реальном времени._`;
        } catch (err: any) {
            console.error('[RemoteCodeOnPC] Chat error:', err);
            throw new Error(`Не удалось отправить запрос в Copilot Chat: ${err.message}. Убедитесь, что GitHub Copilot установлен и активирован.`);
        }
    }

    private getRecentProjects(): Array<{ name: string; path: string }> {
        const projects: Array<{ name: string; path: string }> = [];

        // Читаем из storage VS Code
        const storagePath = this._context.globalStorageUri.fsPath;
        // Пробуем прочитать недавние проекты из глобального состояния
        try {
            const globalState = this._context.globalState;
            // Используем alternative подход — сканируем типичные места
            const homeDir = process.env.USERPROFILE || process.env.HOME || '';
            const searchPaths = [
                path.join(homeDir, 'source'),
                path.join(homeDir, 'projects'),
                path.join(homeDir, 'Desktop'),
                path.join(homeDir, 'Documents'),
            ];

            for (const dir of searchPaths) {
                if (fs.existsSync(dir)) {
                    try {
                        const entries = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.isDirectory()) {
                                const gitPath = path.join(dir, entry.name, '.git');
                                if (fs.existsSync(gitPath)) {
                                    projects.push({
                                        name: entry.name,
                                        path: path.join(dir, entry.name)
                                    });
                                }
                            }
                        }
                    } catch (e) {
                        // ignore permission errors
                    }
                }
            }
        } catch (e) {
            // ignore
        }

        return projects.slice(0, 20);
    }

    private getSystemDrives(): string[] {
        if (process.platform === 'win32') {
            const drives: string[] = [];
            for (const d of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
                const drivePath = `${d}:\\`;
                if (fs.existsSync(drivePath)) {
                    drives.push(drivePath);
                }
            }
            return drives;
        }
        return ['/'];
    }

    private async scanDirectory(dirPath: string, depth: number, maxDepth: number): Promise<any> {
        if (depth > maxDepth) {
            return { name: path.basename(dirPath), path: dirPath, isDirectory: true, truncated: true };
        }

        const result: any = {
            name: path.basename(dirPath),
            path: dirPath,
            isDirectory: true,
            children: []
        };

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                // Пропускаем скрытые и node_modules
                if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') {
                    continue;
                }

                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    if (depth < maxDepth) {
                        const sub = await this.scanDirectory(fullPath, depth + 1, maxDepth);
                        result.children.push(sub);
                    } else {
                        result.children.push({
                            name: entry.name,
                            path: fullPath,
                            isDirectory: true
                        });
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    const codeExts = ['.ts', '.js', '.py', '.java', '.cpp', '.c', '.h', '.cs', '.go',
                        '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.dart', '.html', '.css',
                        '.scss', '.less', '.json', '.xml', '.yaml', '.yml', '.md', '.sql', '.sh',
                        '.bat', '.ps1', '.vue', '.svelte', '.jsx', '.tsx', '.mjs', '.cjs'];
                    if (codeExts.includes(ext) || entry.name === 'Dockerfile' || entry.name === 'Makefile') {
                        result.children.push({
                            name: entry.name,
                            path: fullPath,
                            isDirectory: false,
                            extension: ext,
                            size: entry.isFile() ? fs.statSync(fullPath).size : 0
                        });
                    }
                }
            }

            // Сортируем: папки выше, потом файлы, всё по алфавиту
            result.children.sort((a: any, b: any) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
            });

            // Лимит на количество элементов
            if (result.children.length > 50) {
                result.children = result.children.slice(0, 50);
                result.truncated = true;
            }
        } catch (e) {
            result.error = 'Permission denied';
        }

        return result;
    }

    private saveChatHistory(chatId: string, messages: ChatMessage[]): void {
        // Сохраняем в глобальное состояние расширения
        try {
            const key = `chat_history_${chatId}`;
            const data = JSON.stringify(messages.slice(-100)); // последние 100 сообщений
            this._context.globalState.update(key, data);
        } catch (e) {
            // ignore
        }
    }

    private getLanguageFromExt(ext: string): string {
        const map: Record<string, string> = {
            '.ts': 'typescript', '.js': 'javascript', '.py': 'python',
            '.java': 'java', '.cpp': 'cpp', '.c': 'c', '.cs': 'csharp',
            '.go': 'go', '.rs': 'rust', '.rb': 'ruby', '.php': 'php',
            '.swift': 'swift', '.kt': 'kotlin', '.html': 'html', '.css': 'css',
            '.json': 'json', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml',
            '.md': 'markdown', '.sql': 'sql', '.sh': 'shellscript',
            '.dart': 'dart', '.vue': 'vue', '.svelte': 'svelte',
            '.jsx': 'javascriptreact', '.tsx': 'typescriptreact'
        };
        return map[ext] || 'plaintext';
    }
}
