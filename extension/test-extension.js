/**
 * Скрипт тестирования расширения Remote Code on PC
 * Запуск: node test-extension.js
 * Проверяет HTTP и WebSocket API без VS Code (проверка синтаксиса и логики)
 */

const http = require('http');

const TESTS = {
    passed: 0,
    failed: 0,
    total: 0
};

function assert(condition, name, detail) {
    TESTS.total++;
    if (condition) {
        TESTS.passed++;
        console.log(`  ✅ ${name}`);
    } else {
        TESTS.failed++;
        console.log(`  ❌ ${name}: ${detail}`);
    }
}

console.log('\n🔍 ===== ТЕСТИРОВАНИЕ Remote Code on PC =====\n');

// ===== Тест 1: Проверка файлов =====
console.log('📁 Тест 1: Проверка структуры файлов');

const fs = require('fs');
const path = require('path');
const Module = require('module');

const requiredFiles = [
    'src/server.ts',
    'src/extension.ts',
    'build.js',
    'LICENSE',
    'package.json',
    'tsconfig.json',
];

for (const f of requiredFiles) {
    assert(fs.existsSync(path.join(__dirname, f)), `Файл существует: ${f}`, `Не найден: ${f}`);
}

// ===== Тест 2: Проверка импортов в server.ts =====
console.log('\n📦 Тест 2: Проверка импортов server.ts');

const serverContent = fs.readFileSync(path.join(__dirname, 'src', 'server.ts'), 'utf-8');
const assertWebviewInteractionWiring = () => {
    assert(serverContent.includes("data-change-action=\"review\"") && serverContent.includes("case 'reviewChangeBlock'"), 'Change-card review button works', 'review action missing');
    assert(serverContent.includes("data-change-action=\"undo\"") && serverContent.includes("case 'undoChangeBlock'"), 'Change-card undo button works', 'undo action missing');
    assert(serverContent.includes("data-change-action=\"toggle\"") && serverContent.includes("setChangeCardExpanded") && serverContent.includes("expandedChangeCards"), 'Change-card expand button works', 'toggle action/state persistence missing');
    assert(
        serverContent.includes("message-tool") &&
        serverContent.includes("case 'copyMessage'") &&
        serverContent.includes("case 'deleteMessage'") &&
        serverContent.includes("case 'regenerateMessage'") &&
        serverContent.includes("case 'messageFeedback'"),
        'Message hover buttons work',
        'copy/edit/delete/regenerate/feedback handlers missing'
    );
    assert(serverContent.includes("data-action-id=") && serverContent.includes("actionResponse"), 'Approve/deny action buttons work', 'action response wiring missing');
    assert(serverContent.includes("prompt.addEventListener('paste'") && serverContent.includes("pasteFiles"), 'Paste attachment flow works', 'paste attachment wiring missing');
assert(serverContent.includes("prompt.addEventListener('keydown'") && serverContent.includes("event.key === 'Enter'"), 'Enter sends message in extension', 'Enter send wiring missing');
assert(serverContent.includes("case 'stopGeneration'") && serverContent.includes("id=\"send\"") && serverContent.includes("document.getElementById('send').addEventListener"), 'Stop/run buttons are wired', 'stop/run wiring missing');
assert(serverContent.includes("codex:preferences-changed") && serverContent.includes("Composer preferences changed"), 'Composer preferences sync over API/WebSocket', 'preference sync missing');
assert(serverContent.includes('actionTimelineSummary') && serverContent.includes('buildExternalCodexWorkSummaryEvent') && serverContent.includes("type: 'work_summary'") && serverContent.includes('work-summary-line') && serverContent.includes('на протяжении'), 'Extension shows Codex-like work summary', 'work summary row missing from extension chat');
};
assertWebviewInteractionWiring();

function runChatRenderFixture() {
    const compiledServer = path.join(__dirname, 'out', 'server.js');
    const fixturePath = path.join(__dirname, 'test-fixtures', 'chat-render-regression.json');
    if (!fs.existsSync(compiledServer) || !fs.existsSync(fixturePath)) {
        assert(false, 'Chat render fixture is available', 'compile output or fixture file is missing');
        return;
    }
    const extensionPackage = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    const repoRoot = path.resolve(__dirname, '..');
    const fakeVscode = {
        version: 'fixture-vscode',
        env: { appName: 'VS Code Fixture' },
        workspace: {
            workspaceFolders: [{ uri: { fsPath: repoRoot } }],
            getConfiguration: () => ({
                get: (_key, fallback) => fallback,
                update: () => Promise.resolve()
            })
        },
        window: {},
        extensions: {
            getExtension: () => ({ packageJSON: { version: extensionPackage.version } })
        },
        ConfigurationTarget: { Global: true },
        CancellationTokenSource: class {
            constructor() { this.token = { isCancellationRequested: false }; }
            cancel() { this.token.isCancellationRequested = true; }
            dispose() {}
        },
        Disposable: class {
            dispose() {}
        }
    };
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'vscode') return fakeVscode;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const { RemoteServer } = require(compiledServer);
        const server = new RemoteServer({
            extensionPath: __dirname,
            globalStorageUri: { fsPath: path.join(__dirname, '.fixture-storage') }
        });
        const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
        const messageHtml = server.renderMessageContent(fixture.message.content, fixture.message.changeSummary);
        const timelineHtml = server.renderActionTimeline(fixture.actions);
        assert(messageHtml.includes('class="change-card collapsed"') && messageHtml.includes('Изменено 2 файла'), 'Fixture renders change-card from changeSummary', 'renderMessageContent should preserve the changed-files card');
        assert(messageHtml.includes('class="code-block"') && !messageHtml.includes('::git-commit'), 'Fixture renders code blocks and strips git directives', 'code block or directive cleanup regressed');
        assert(timelineHtml.includes('work-summary-line') && timelineHtml.includes('30м 20с') && timelineHtml.includes('Выполнено 6'), 'Fixture renders Codex work summary and command count', 'work summary DOM smoke failed');
    } catch (error) {
        assert(false, 'Chat render fixture executes renderer', error && error.stack ? error.stack : String(error));
    } finally {
        Module._load = originalLoad;
    }
}
runChatRenderFixture();

assert(serverContent.includes("from 'ws'"), 'WebSocket импорт', 'ws не найден');
assert(serverContent.includes("class RemoteServer"), 'Класс RemoteServer', 'Не найден');
assert(serverContent.includes("handleRequest"), 'Метод handleRequest', 'Не найден');
assert(serverContent.includes("handleWsConnection"), 'Метод handleWsConnection', 'Не найден');

// ===== Тест 3: Проверка API-эндпоинтов =====
console.log('\n🛣️  Тест 3: Проверка API-роутов server.ts');

const routes = [
    '/api/status',
    '/api/workspace/folders',
    '/api/workspace/open',
    '/api/workspace/tree',
    '/api/workspace/read-file',
    '/api/search',
    '/api/chat/agents',
    '/api/chat/send',
    '/api/chat/history',
    '/api/chat/select-agent',
    '/api/chat/new',
    '/api/chat/conversations',
    '/api/diagnostics',
    '/api/terminal/exec',
    '/api/codex/status',
    '/api/codex/send',
    '/api/codex/history',
    '/api/codex/events',
    '/api/codex/actions',
    '/api/codex/message',
    '/api/codex/change',
    '/api/codex/models',
    '/api/codex/threads',
    '/api/codex/launch',
    '/api/tunnel/status',
    '/api/tunnel/start',
    '/api/tunnel/stop',
];

for (const route of routes) {
    const escaped = route.replace(/\//g, '\\/').replace(/\?/g, '\\?').replace(/\*/g, '\\*');
    const regex = new RegExp(`pathname\\s*===\\s*['\`]${route}['\`]`);
    assert(regex.test(serverContent), `Роут: ${route}`, `Не найден маршрут ${route}`);
}

// ===== Тест 4: Проверка хендлеров VS Code и Codex =====
console.log('\n🎯 Тест 4: Проверка хендлеров');

const handlers = [
    'handleStatus',
    'handleGetFolders',
    'handleOpenFolder',
    'handleFileTree',
    'handleReadFile',
    'handleRemoteSearch',
    'handleGetAgents',
    'handleChatSend',
    'handleChatHistory',
    'handleSelectAgent',
    'handleNewChat',
    'handleGetConversations',
    'handleDiagnostics',
    'handleTerminalExec',
    'handleCodexStatus',
    'handleCodexSend',
    'handleCodexHistory',
    'handleCodexEvents',
    'handleCodexActionResponse',
    'handleRemoteCodeMessageAction',
    'handleRemoteCodeChangeAction',
    'handleCodexModels',
    'handleCodexSelectModel',
    'handleCodexThreads',
    'handleCodexLaunch',
    'handleTunnelStatus',
    'handleTunnelStart',
    'handleTunnelStop',
];

for (const handler of handlers) {
    assert(serverContent.includes(handler), `Хендлер: ${handler}`, `Не найден метод ${handler}`);
}

// ===== Тест 5: Проверка WebSocket функционала =====
console.log('\n🔌 Тест 5: Проверка WebSocket');

assert(serverContent.includes('wss.on('), 'WebSocketServer listener', 'Не найден');
assert(serverContent.includes('wsClients.add'), 'WebSocket client tracking', 'Не найден');
assert(serverContent.includes('broadcast'), 'Broadcast метод', 'Не найден');
assert(serverContent.includes('broadcastDiagnostics'), 'Broadcast diagnostics метод', 'Не найден');

// ===== Тест 6: Проверка Tunnel функционала =====
console.log('\n🌐 Тест 6: Проверка Tunnel/Интернет');

assert(serverContent.includes('detectLocalIp'), 'detectLocalIp метод', 'Не найден');
assert(serverContent.includes('startTunnel'), 'startTunnel метод', 'Не найден');
assert(serverContent.includes('stopTunnel'), 'stopTunnel метод', 'Не найден');
assert(serverContent.includes('_tunnelUrl'), '_tunnelUrl поле', 'Не найдено');
assert(serverContent.includes('ngrok'), 'Поддержка ngrok', 'Не найдена');
assert(serverContent.includes('discoverUpnpLocations') && serverContent.includes('AddPortMapping') && serverContent.includes('openRouterPortViaUpnp'), 'UPnP port forwarding helper', 'UPnP auto port mapping missing');
assert(serverContent.includes('buildKeeneticForwardingInstructions') && serverContent.includes("case 'copyKeeneticCommands'") && serverContent.includes("case 'openRouterPage'") && serverContent.includes('my.keenetic.net'), 'Keenetic manual forwarding helper', 'manual Keenetic fallback actions missing');
assert(serverContent.includes('configureKeeneticPortForward') && serverContent.includes("case 'configureKeeneticRouter'") && serverContent.includes('/rci/ip/nat') && serverContent.includes('buildDigestAuthHeader') && serverContent.includes('createKeeneticSessionCookie') && serverContent.includes('x-ndw2-interactive'), 'Keenetic automatic router configuration', 'automatic Keenetic RCI setup missing');
assert(serverContent.includes('data-action="configureKeeneticRouter"') && serverContent.includes('data-action="copyKeeneticCommands"') && serverContent.includes('data-action="openRouterPage"') && serverContent.includes('Настроить Keenetic'), 'Keenetic buttons are visible in webview', 'Keenetic actions should be directly visible in extension UI');
assert(serverContent.includes('isUnsupportedKeeneticServiceHost') && serverContent.includes('isUnsupportedKeeneticServiceUrl') && serverContent.includes('promptForStableKeeneticPublicUrl'), 'Keenetic service hosts are not used as phone public URL', 'unsupported router service URL guard missing');

// ===== Тест 7: Проверка extension.ts =====
console.log('\n🧩 Тест 7: Проверка extension.ts');

const extContent = fs.readFileSync(path.join(__dirname, 'src', 'extension.ts'), 'utf-8');

assert(extContent.includes('statusBarItem'), 'StatusBarItem', 'Не найден');
assert(extContent.includes('remoteCodeOnPC.start'), 'start команда', 'Не найдена');
assert(extContent.includes('remoteCodeOnPC.stop'), 'stop команда', 'Не найдена');
assert(extContent.includes('remoteCodeOnPC.tunnel'), 'tunnel команда', 'Не найдена');
assert(extContent.includes('remoteCodeOnPC.status'), 'status команда', 'Не найдена');
assert(extContent.includes('remoteCodeOnPC.openChat'), 'openChat команда', 'Не найдена');
assert(extContent.includes('remoteCodeOnPC.token') && extContent.includes('showAuthTokenMenu'), 'token команда', 'Не найдена');
assert(extContent.includes('server.openRemoteCodeChat'), 'собственный Remote Code чат', 'Не найден');
assert(extContent.includes('updateStatusBar'), 'updateStatusBar функция', 'Не найдена');

// ===== Тест 7.1: Проверка безопасности и webview-кнопок =====
console.log('\n🔐 Тест 7.1: Безопасность внешнего доступа и webview actions');

assert(serverContent.includes('requestUsesPublicAccess'), 'Определение внешнего Host', 'requestUsesPublicAccess не найден');
assert(serverContent.includes('publicAuthRequiredStatus'), 'Минимальный статус без токена', 'publicAuthRequiredStatus не найден');
assert(serverContent.includes('isPublicAssetEndpoint') && serverContent.includes("pathname === '/api/app/apk' || pathname === '/api/app/apk/status'") && serverContent.includes('!this.isPublicAssetEndpoint(pathname)'), 'APK updater endpoint is public', 'Android updater APK endpoints should not require a token because stale clients may need them before reconnecting');
assert(serverContent.includes("case pathname === '/api/app/apk/status'") && serverContent.includes('handleAppApkStatus') && serverContent.includes('sizeBytes: metadata.sizeBytes') && serverContent.includes('sha256: metadata.sha256') && serverContent.includes('versionName: metadata.versionName') && serverContent.includes('getPublicAppApkMetadata') && !serverContent.includes('apkPath: metadata.apkPath'), 'APK status endpoint exposes safe diagnostics', 'APK status should expose availability, version, size, sha256, and serverVersion without leaking local file paths');
assert(serverContent.includes("path.join(this._context.extensionPath, 'apk', 'app-debug.apk')") && serverContent.includes('vscode.workspace.workspaceFolders') && !serverContent.includes("path.resolve(__dirname, '..', '..', 'apk', 'app-debug.apk')") && fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8').includes('prepare:apk'), 'APK endpoint uses packaged/current workspace artifact', 'APK status must not fall through to stale global .vscode/extensions/apk artifacts');
assert(serverContent.includes('sanitizeLogText'), 'Маскирование логов расширения', 'sanitizeLogText не найден');
assert(serverContent.includes('if (!this._authToken) return !requireConfiguredToken'), 'Внешний доступ требует настроенный токен', 'checkAuth не требует токен для public access');
assert(
    serverContent.includes('const authRequired = this.isAuthRequiredForRequest(req, \'/ws\', publicAccess);') &&
    serverContent.includes('if (authRequired && !this.checkAuth(req, true))'),
    'WebSocket public access requires token',
    'public WebSocket must use the same token gate as HTTP'
);
assert(serverContent.includes('data-action="createOrCopyToken"') && serverContent.includes("case 'createOrCopyToken'") && serverContent.includes('showAuthTokenMenu'), 'Token menu action works', 'token menu action missing in webview');
assert(serverContent.includes('copyPairingPayload') && serverContent.includes('remote-code-pair:') && serverContent.includes('data-action="copyPairingPayload"'), 'Extension can copy Android pairing payload', 'pairing payload copy action missing');
assert(serverContent.includes('showPairingQr') && serverContent.includes("require('qrcode')") && serverContent.includes('data-action="showPairingQr"') && serverContent.includes('QR для телефона'), 'Extension shows Android pairing QR', 'pairing QR panel/action missing');
assert(serverContent.includes('Создать новый токен') && serverContent.includes('forceNew') && serverContent.includes('data-action="createOrCopyToken"'), 'Token can be regenerated explicitly', 'token regeneration/menu label missing');
assert(serverContent.includes('liveDraftThreadIds'), 'Пустые чаты не закрепляются навсегда', 'liveDraftThreadIds не найден');
assert(serverContent.includes("private currentRemoteThreadId: string = '';"), 'Нет скрытого default-чата при старте', 'currentRemoteThreadId не должен стартовать с remote-code-default');
assert(serverContent.includes('if (!targetThreadId)') && serverContent.includes('targetThreadId = this.createRemoteCodeThread()'), 'Сообщение без thread создаёт реальный чат', 'fallback thread должен создаваться явно');
assert(
    serverContent.includes('getRemoteCodeThreadsUpdatePayload') &&
    serverContent.includes('projects: this.getRemoteCodeProjects(threads)') &&
    serverContent.includes('currentProjectId: this.getCurrentRemoteCodeProjectId(rawThreads)') &&
    serverContent.includes('projectId?: string') &&
    serverContent.includes('getRemoteCodeThreadsWithProjectIds') &&
    serverContent.includes('workspaceName: workspace.workspaceName') &&
    serverContent.includes('workspacePath: workspace.workspacePath'),
    'Extension groups chats by project',
    'codex thread API must expose project groups, per-thread project IDs, and workspace metadata'
);
assert(serverContent.includes('isCorruptedThreadTitle') && serverContent.includes('pickThreadTitle(existing?.title, thread.title'), 'Повреждённые заголовки чатов чинятся из Codex index', 'corrupted saved thread titles should not override Codex thread titles');
assert(serverContent.includes('decodeBasicHtmlEntities') && serverContent.includes('isTechnicalProgressLine'), 'Прогресс не показывает технические строки вложений', 'Фильтрация технических progress-строк не найдена');
assert(serverContent.includes('.msg.user{max-width:var(--chat-max);margin:0 auto 23px;color:var(--codex-bright);display:flex;justify-content:flex-end') && serverContent.includes('border-radius:16px 16px 4px 16px') && serverContent.includes('.msg.user .msg-tools{right:0;left:auto'), 'Extension user messages align right', 'user prompt bubble and toolbar should sit on the right in the webview');
const compactWebviewChecks = [
    '--codex-sidebar:#17191d',
    '--codex-selected:#303039',
    'font:13px/1.46 var(--codex-font)',
    '.version-chip,.live-chip{height:26px',
    '.sidebar-thread{min-height:36px',
    '.sidebar-thread.selected{background:var(--codex-selected)}',
    '.message-text{margin:0;white-space:normal;word-wrap:break-word;font:inherit;color:var(--codex-text);font-size:14px;line-height:1.5}',
    '.change-card{margin:10px 0 12px',
    '.change-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:38px',
    '.change-action{border:0;background:transparent;color:#9a9a9a;height:26px',
    '.change-row{display:flex;align-items:center;gap:8px;min-height:28px',
    '.change-card.collapsed .change-row{display:none}',
    '.composer{max-width:var(--composer-max);margin:0 auto;border:1px solid var(--codex-strong-border);background:#2d2d2d;border-radius:18px',
    'font-size:14px;outline:none;line-height:1.5',
];
assert(compactWebviewChecks.every((snippet) => serverContent.includes(snippet)), 'Extension webview uses compact Codex-like density', 'webview sidebar/message/change-card/composer density drifted from Codex target');
assert(!serverContent.includes('id="topRun"') && !serverContent.includes('id="connectorDrop"') && serverContent.includes('id="progressToggle"') && serverContent.includes('data-progress-toggle') && serverContent.includes('.content-shell.progress-open .progress-panel{display:block') && serverContent.includes('setProgressPanelOpen(progressOpen, false)') && serverContent.includes('savedViewState.progressOpen || isBusy') && serverContent.includes('enterCodexFocusMode') && serverContent.includes('workbench.action.closeSidebar') && serverContent.includes('min-height:40px;max-height:152px'), 'Extension top bar matches Codex surface', 'Remote Code utility buttons should stay out of the main chat surface and the progress sidebar should be user-toggleable');
assert(serverContent.includes('latestAssistantIndex') && serverContent.includes('isTimelineRunning ? visibleMessages.length - 1') && serverContent.includes('compactActionOutput(event)') && serverContent.includes('class="action-detail'), 'Extension timeline stays next to active work', 'activity timeline should be placed under the active turn and expose stdout/stderr/diff details');
assert(serverContent.includes('liveChipLabel') && serverContent.includes('liveChipTitle') && serverContent.includes('Live-канал') && serverContent.includes('this.wsClients.size'), 'Extension shows live update status', 'webview should expose WebSocket/live status without opening diagnostics');
assert(serverContent.includes('pcCodexMirrorTimer') && serverContent.includes('refreshPcChatPanelForExternalCodexChange') && serverContent.includes("type: 'codex:message-refresh'") && serverContent.includes('getExternalCodexActionEventsForThread') && serverContent.includes('sanitizeActionText') && serverContent.includes('readUtf8FileTailLines') && serverContent.includes('parseCodexSessionFileTail') && serverContent.includes('codexSessionFilesCache'), 'Extension mirrors live Codex chat updates', 'VS Code webview should live-refresh current Codex JSONL and show public tool/action events without leaking tokens or repeatedly scanning full session files');
assert(serverContent.includes('wsCodexMirrorTimer') && serverContent.includes('startWsCodexMirrorPolling') && serverContent.includes('refreshWsCodexMirrorForExternalCodexChange') && serverContent.includes('extractPublicCodexProgressMessage') && serverContent.includes("phase !== 'commentary'") && serverContent.includes('codex_external_commentary_'), 'Extension streams public Codex progress to connected phones', 'Android clients should receive Codex commentary/status updates over WebSocket without showing hidden reasoning');
assert(serverContent.includes('codexSessionsListSignature') && serverContent.includes('latestCodexThreadIdFromFiles') && serverContent.includes('maybeSwitchToLatestCodexThread(true)') && serverContent.includes('maybeSwitchToLatestCodexThread(false)') && serverContent.includes('wsCodexSessionsSignature') && serverContent.includes('pcCodexSessionsSignature') && serverContent.includes('sessionsChanged'), 'Extension detects new live Codex sessions', 'PC and WebSocket mirrors should notice new Codex JSONL sessions, not only writes to the already-selected thread');
assert(serverContent.includes('.code-block') && serverContent.includes('data-preview-src') && serverContent.includes('imageDataUri') && serverContent.includes('imagePreview') && serverContent.includes('isAttachmentPreviewPathAllowed'), 'Extension renders Codex-style code blocks and image previews', 'webview chat should render fenced code blocks and tappable image thumbnails');
assert(
    serverContent.includes('remote_code_hidden_messages') &&
    serverContent.includes('deleteRemoteMessage') &&
    serverContent.includes('regenerateRemoteMessage') &&
    serverContent.includes('prompt.value = text') &&
    serverContent.includes('prompt.setSelectionRange(prompt.value.length, prompt.value.length)') &&
    !serverContent.includes('prompt.textContent = text') &&
    serverContent.includes("if (action === 'feedback')") &&
    serverContent.includes("feedback must be up or down") &&
    serverContent.includes("type: 'codex:message-deleted'"),
    'Extension message actions persist and broadcast',
    'message edit/delete/regenerate/feedback API should fill the composer, persist hidden messages and notify clients'
);
assert(
    serverContent.includes("pathname === '/api/codex/change'") &&
    serverContent.includes('readRemoteCodeChangeDiff') &&
    serverContent.includes('requestRemoteCodeUndoChange') &&
    serverContent.includes("type: 'command_approval'") &&
    serverContent.includes('git restore --'),
    'Change cards expose diff/review/undo through the remote API',
    'change-card API should support diff and create an approval-gated undo action'
);
assert(
    serverContent.includes('renderMessageContent(message.content, message.changeSummary)') &&
    serverContent.includes('getGitChangeSummaryFromMessage(message.content || \'\', message.timestamp)') &&
    serverContent.includes('extractCommitHashCandidates') &&
    serverContent.includes('resolveGitCommitNearTimestamp') &&
    serverContent.includes("const binary = parts[0] === '-' || parts[1] === '-'"),
    'Change cards use stable git stats from Codex messages',
    'change summaries should use server-provided summaries, recover the commit for git directives and detect binary files'
);
assert(
    serverContent.includes('renderChangeHeader(summary.fileCount || summary.files.length, summary.additions, summary.deletions)') &&
    serverContent.includes('parseChangeHeaderTotals(header, changes)') &&
    serverContent.includes('fileCount: files.length') &&
    serverContent.includes('if (binary) continue;') &&
    serverContent.includes('class="change-title"'),
    'Change-card header matches Codex reviewable-file summary',
    'change cards should use a structured one-line header and skip binary APK/VSIX artifacts from reviewable file counts'
);

const terminalExecBody = serverContent.match(/private async handleTerminalExec[\s\S]*?\/\/ ========== WEBSOCKET ==========/)?.[0] || '';
assert(
    terminalExecBody.includes("type: 'command_approval'") &&
    terminalExecBody.includes('pendingApproval: true') &&
    !terminalExecBody.includes('execSync') &&
    !terminalExecBody.includes('sendText') &&
    !terminalExecBody.includes('createTerminal'),
    'Terminal exec идёт только через approval flow',
    'terminal exec must not run commands directly'
);
const standaloneContent = fs.readFileSync(path.join(__dirname, 'src', 'standalone-server.ts'), 'utf-8');
assert(!serverContent.includes('parsed.query.token') && !standaloneContent.includes("searchParams.get('token')"), 'Access token is not accepted in URL query', 'tokens should be sent in Authorization headers, not query strings');
assert(standaloneContent.includes('extractCodexProgressMessage') && standaloneContent.includes("phase !== 'commentary'") && standaloneContent.includes("type: 'model_progress'"), 'Standalone server exposes public Codex progress events', 'standalone history should turn Codex commentary into model_progress events');
assert(
    standaloneContent.includes("pathname === '/api/terminal/exec'") &&
    standaloneContent.includes('Terminal execution is disabled in standalone mode') &&
    !standaloneContent.match(/terminal\/exec[\s\S]{0,800}(execSync|spawn|sendText)/),
    'Standalone terminal exec disabled',
    'standalone terminal exec must not execute commands'
);
assert(
    serverContent.includes('Terminal commands are still routed through explicit user approval') &&
    serverContent.includes('private shouldAutoApproveAction') &&
    serverContent.includes('return false;') &&
    serverContent.includes('/[\\r\\n;&|`<>]/'),
    'Fast profile does not auto-run shell commands',
    'fast mode must not auto-approve shell strings'
);
assert(
    standaloneContent.includes('getStatus(this.canExposeFullStatus(req))') &&
    standaloneContent.includes('private canExposeFullStatus') &&
    standaloneContent.includes('if (!includePrivateDetails) return publicStatus') &&
    standaloneContent.includes('tokenConfigured: Boolean(this.authToken)'),
    'Standalone public status hides private workspace details',
    'standalone /api/status should not expose workspace paths before auth on public binds'
);

const webviewActions = [...serverContent.matchAll(/data-action=\"([^\"]+)\"/g)].map(match => match[1]);
const uniqueWebviewActions = [...new Set(webviewActions)].sort();
const handlerCases = new Set([...serverContent.matchAll(/case\s+'([^']+)'\s*:/g)].map(match => match[1]));
const missingWebviewHandlers = uniqueWebviewActions.filter(action => !handlerCases.has(action));
assert(missingWebviewHandlers.length === 0, 'Все data-action имеют обработчик', missingWebviewHandlers.join(', ') || 'OK');

// ===== Тест 8: Проверка package.json =====
console.log('\n📦 Тест 8: Проверка package.json');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const pkgRaw = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8');
const vscodeIgnore = fs.readFileSync(path.join(__dirname, '.vscodeignore'), 'utf-8');
const installScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-local-extension.ps1'), 'utf-8');
const visualRegressionScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'capture-visual-regression.ps1'), 'utf-8');
const codexParityScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'capture-codex-parity.ps1'), 'utf-8');
const e2eSmokeScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-e2e-smoke.ps1'), 'utf-8');
assert(!!pkg.name, 'name поле', 'Отсутствует');
assert(!!pkg.contributes?.commands, 'commands в contributes', 'Отсутствуют');
assert(pkg.scripts?.['install:local']?.includes('install-local-extension.ps1'), 'Local extension install script is wired', 'package.json should expose a local install script for the VS Code extension copy');
assert(pkg.scripts?.bundle === 'node build.js' && pkg.scripts?.['vscode:prepublish']?.includes('npm run bundle') && pkg.devDependencies?.esbuild, 'Extension bundle build is wired', 'VSIX should be built through esbuild before packaging');
assert(pkg.repository?.url?.includes('github.com/andruwko73/remote_code_on_pc') && fs.existsSync(path.join(__dirname, 'LICENSE')), 'VSIX metadata is complete', 'package should include repository metadata and LICENSE');
assert(vscodeIgnore.includes('node_modules/**') && vscodeIgnore.includes('out/server.js') && vscodeIgnore.includes('build.js'), 'VSIX excludes unbundled payload', 'node_modules, build script, and unbundled server output should not ship in the VSIX');
assert(installScript.includes('Restart-RemoteCodeExtensionHost') && installScript.includes('Restart-VsCodeWindow') && installScript.includes('vscode://command/workbench.action.reloadWindow') && installScript.includes('Get-NetTCPConnection') && installScript.includes('CloseMainWindow'), 'Local installer can activate the new extension', 'install script should request a VS Code reload and recover from a stale extension host/window');
assert(
    visualRegressionScript.includes('screencap') &&
    visualRegressionScript.includes('Save-WindowScreenshot') &&
    visualRegressionScript.includes('Compare-VisualBaseline') &&
    visualRegressionScript.includes('test-fixtures\\visual-baseline') &&
    visualRegressionScript.includes('UpdateBaseline') &&
    visualRegressionScript.includes('VsCodeFullscreen') &&
    visualRegressionScript.includes('vscode-fullscreen.png') &&
    visualRegressionScript.includes('ShowWindow($window.MainWindowHandle, 3)') &&
    visualRegressionScript.includes('PrintWindow($window.MainWindowHandle'),
    'Visual regression capture script is available',
    'visual regression script should capture Android, normal VS Code, and fullscreen VS Code chat screenshots and compare them with baselines'
);
assert(
    codexParityScript.includes('Find-WindowCandidate @("Codex")') &&
    codexParityScript.includes('Find-WindowCandidate @("Code")') &&
    codexParityScript.includes('PrintWindow($Window.MainWindowHandle') &&
    codexParityScript.includes('Codex and VS Code resolved to the same window handle') &&
    codexParityScript.includes('codex-vs-vscode-parity') &&
    codexParityScript.includes('pixelDeltaPercent'),
    'Codex parity capture uses separate real windows',
    'Codex/VS Code comparison must capture different process handles and write a side-by-side artifact'
);
assert(e2eSmokeScript.includes('/api/search') && e2eSmokeScript.includes('/api/tunnel/status') && e2eSmokeScript.includes('ClientWebSocket') && e2eSmokeScript.includes('configured public URL'), 'E2E smoke script covers live API surfaces', 'smoke script should cover status, search, tunnel status, public URL and WebSocket greeting');
assert(pkg.dependencies?.qrcode, 'QR code dependency is declared', 'extension package should include qrcode for Android pairing QR panels');
assert(!/[\u0080-\u009f\ufffd]/.test(pkgRaw), 'package.json has no mojibake control characters', 'package metadata should be valid UTF-8 without C1 controls');
assert(pkg.contributes?.configuration?.properties?.['remoteCodeOnPC.keeneticHost']?.description?.startsWith('Имя KeenDNS'), 'Keenetic host setting description is readable', 'keeneticHost description is corrupted');
const cmds = pkg.contributes.commands.map(c => c.command);
assert(cmds.includes('remoteCodeOnPC.start'), 'start в commands', 'Нет');
assert(cmds.includes('remoteCodeOnPC.stop'), 'stop в commands', 'Нет');
assert(cmds.includes('remoteCodeOnPC.tunnel'), 'tunnel в commands', 'Нет');
assert(cmds.includes('remoteCodeOnPC.openChat'), 'openChat в commands', 'Нет');
assert(cmds.includes('remoteCodeOnPC.token'), 'token в commands', 'Нет');

// ===== Тест 9: Проверка Android файлов =====
console.log('\n🤖 Тест 9: Проверка Android проекта');

const androidBase = path.join(__dirname, '..', 'android');
const androidFiles = [
    'app/src/main/java/com/remotecodeonpc/app/Models.kt',
    'app/src/main/java/com/remotecodeonpc/app/SecureTokenStore.kt',
    'app/src/main/java/com/remotecodeonpc/app/RemoteCodeApp.kt',
    'app/src/main/java/com/remotecodeonpc/app/viewmodel/MainViewModel.kt',
    'app/src/main/java/com/remotecodeonpc/app/network/ApiClient.kt',
    'app/src/main/java/com/remotecodeonpc/app/network/WebSocketClient.kt',
    'app/src/main/java/com/remotecodeonpc/app/ui/screens/CodexScreen.kt',
    'app/src/main/java/com/remotecodeonpc/app/ui/navigation/Screen.kt',
    'app/src/main/java/com/remotecodeonpc/app/ui/theme/Color.kt',
    'app/build.gradle.kts',
    'settings.gradle.kts',
    'gradle/wrapper/gradle-wrapper.properties',
    'gradlew.bat',
];
const remoteCodeApp = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'RemoteCodeApp.kt'), 'utf-8');
const codexScreen = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'ui', 'screens', 'CodexScreen.kt'), 'utf-8');
const apiClient = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'network', 'ApiClient.kt'), 'utf-8');
const simpleHttpClient = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'network', 'SimpleHttpClient.kt'), 'utf-8');
const webSocketClient = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'network', 'WebSocketClient.kt'), 'utf-8');
const connectionUrl = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'network', 'ConnectionUrl.kt'), 'utf-8');
const mainVm = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'viewmodel', 'MainViewModel.kt'), 'utf-8');
const modelsFile = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'Models.kt'), 'utf-8');
const mainActivity = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'MainActivity.kt'), 'utf-8');
const androidManifest = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf-8');
const secureTokenStore = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'SecureTokenStore.kt'), 'utf-8');
const androidBuildGradle = fs.readFileSync(path.join(androidBase, 'app', 'build.gradle.kts'), 'utf-8');
assert(!remoteCodeApp.includes('.verticalScroll(rememberScrollState())'), 'Android connection screen avoids forced startup scroll', 'startup screen still has verticalScroll');
assert(remoteCodeApp.includes('Arrangement.spacedBy(7.dp, Alignment.CenterVertically)'), 'Android connection screen is compact', 'compact connection layout missing');
assert(remoteCodeApp.includes('Text("Логи"') && remoteCodeApp.includes('Text("Очистить"') && remoteCodeApp.includes('Text("Обновить"'), 'Android startup action buttons are present', 'startup action row missing');
assert(remoteCodeApp.includes('PasswordVisualTransformation') && remoteCodeApp.includes('showToken') && remoteCodeApp.includes('showCompactToken'), 'Android token fields are masked by default', 'token field must not show secrets by default');
assert(!connectionUrl.includes('withKeeneticPort') && !remoteCodeApp.includes('Text("Порт"') && !remoteCodeApp.includes('порт'), 'Android hides manual port from connection UI', 'external URLs should not get an implicit app port and Android should not mention a manual port in the main UI');
assert(connectionUrl.includes('isUnsafePublicHttp') && mainVm.includes('Для внешней сети нужен HTTPS URL') && apiClient.includes('Public connections require HTTPS') && simpleHttpClient.includes('Public connections require HTTPS') && webSocketClient.includes('Public WebSocket connections require HTTPS'), 'Android blocks public HTTP with tokens', 'external mode must require HTTPS before sending auth tokens');
assert(!webSocketClient.includes('?token=') && webSocketClient.includes('addHeader("Authorization", "Bearer ${config.authToken}")'), 'Android WebSocket avoids query-string token', 'WebSocket token should not be placed in the URL');
assert(secureTokenStore.includes('AndroidKeyStore') && secureTokenStore.includes('AES/GCM/NoPadding') && mainVm.includes('SecureTokenStore.migratePlaintextToken') && mainVm.includes('.remove("authToken")') && mainActivity.includes('SecureTokenStore.clear'), 'Android stores access token with Keystore encryption', 'authToken should migrate out of plain SharedPreferences');
assert(mainActivity.includes('buildUpdateSources') && mainActivity.includes('statusUrl = "$base/api/app/apk/status?ts=$ts"') && mainActivity.includes('apkUrl = "$base/api/app/apk?ts=$ts"') && mainActivity.indexOf('addExtensionSource(ConnectionUrl.httpBase(config') < mainActivity.indexOf('apkUrl = "$publicUpdateUrl?ts=$ts"'), 'Android updater tries connected extension before GitHub', 'update button should prefer the current extension APK endpoint before public fallback');
assert(mainActivity.includes('preflightUpdateSource') && mainActivity.includes('currentInstalledApkSha256') && mainActivity.includes('Уже установлена актуальная версия приложения') && mainActivity.includes('UpdateManifest'), 'Android updater preflights APK status', 'updater should query APK status/SHA before downloading and skip already-installed APKs');
assert(
    serverContent.includes('X-Remote-Code-Apk-Sha256') &&
    standaloneContent.includes('X-Remote-Code-Apk-Sha256') &&
    mainActivity.includes('validateDownloadedApk') &&
    mainActivity.includes('SHA-256 APK не совпал') &&
    mainActivity.includes('Подпись APK не совпадает'),
    'APK updater verifies hash and signature',
    'APK downloads must be verified before install'
);
assert(androidManifest.includes('REQUEST_INSTALL_PACKAGES') && mainActivity.includes('canRequestPackageInstalls') && mainActivity.includes('ACTION_MANAGE_UNKNOWN_APP_SOURCES'), 'Android updater declares and gates APK install permission', 'PackageInstaller requires REQUEST_INSTALL_PACKAGES and an unknown-source settings gate');
assert(androidBuildGradle.includes('versionCode = 124') && androidBuildGradle.includes('versionName = "1.0.124"') && androidBuildGradle.includes('signingConfig = signingConfigs.getByName("debug")'), 'Android release artifact can update existing sideload installs', 'release APK should be version-bumped and signed for sideload updates');
assert(mainActivity.includes('foundInstalledMatch') && mainActivity.includes('checking next source') && mainActivity.indexOf('continue') < mainActivity.indexOf('Уже установлена актуальная версия приложения'), 'Android updater keeps checking fallback sources after installed SHA match', 'stale extension APK must not stop the updater before GitHub fallback is checked');
assert(mainActivity.includes('UpdateReadyDialog') && mainActivity.includes('UpdateStatusDialog') && mainActivity.includes('onStatus("Скачивание обновления') && mainActivity.includes('onStatus("Проверка APK') && mainActivity.includes('PendingVerifiedApk') && mainActivity.includes('onReadyDialogFinished = { pendingVerifiedApk = null }') && mainActivity.includes('onInstallPermissionRequired = { pendingVerifiedApk = update }') && mainActivity.includes('Handler(Looper.getMainLooper()).post') && mainActivity.includes('Intent.ACTION_VIEW') && mainActivity.includes('Intent.ACTION_INSTALL_PACKAGE') && !mainActivity.includes('Intent.EXTRA_RETURN_RESULT') && mainActivity.includes('startActivityForResult(intent, updateInstallRequestCode)') && mainActivity.includes('startActivityForResult(installIntent, updateInstallRequestCode)') && !mainActivity.includes('Intent.FLAG_ACTIVITY_NEW_TASK'), 'Android updater uses the Package Installer handoff style without forced return-result', 'verified APK should open through ACTION_VIEW and keep ACTION_INSTALL_PACKAGE as fallback without forcing result mode');
assert(mainActivity.includes('onInstallPermissionRequired()') && mainActivity.includes('ACTION_MANAGE_UNKNOWN_APP_SOURCES') && mainActivity.indexOf('onInstallPermissionRequired()') > mainActivity.indexOf('startActivity(settingsIntent)'), 'Android updater preserves APK after unknown-source permission handoff', 'permission settings should keep the verified APK ready for a second install tap');
assert(codexScreen.includes('CodexNavigationPanel') && codexScreen.includes('CodexDrawerProjectRow') && codexScreen.includes('buildMobileCodexProjects') && modelsFile.includes('workspaceName'), 'Android exposes projects in Codex chat list', 'project drawer/thread workspace metadata should be visible to Android');
assert(
    !remoteCodeApp.includes('VSCodeScreen(') &&
    !remoteCodeApp.includes('ChatScreen(') &&
    remoteCodeApp.includes('"codex", "vscode", "chat" -> CodexScreen(') &&
    !fs.existsSync(path.join(androidBase, 'app/src/main/java/com/remotecodeonpc/app/ui/screens/VSCodeScreen.kt')) &&
    !fs.existsSync(path.join(androidBase, 'app/src/main/java/com/remotecodeonpc/app/ui/screens/ChatScreen.kt')),
    'Android uses one Codex work surface',
    'legacy VSCode/Chat UI files should be removed and old routes should route into CodexScreen'
);
assert(codexScreen.includes('LocalConfiguration.current.screenWidthDp >= 840') && codexScreen.includes('VerticalDivider') && codexScreen.includes('ModalNavigationDrawer'), 'Android sidebar is adaptive', 'wide screens should keep a persistent project sidebar while phones use a drawer');
assert(
    remoteCodeApp.includes('parsePairingPayload') &&
    remoteCodeApp.includes('remote-code-pair:') &&
    remoteCodeApp.includes('Код подключения') &&
    remoteCodeApp.includes('QR и код берутся в VS Code') &&
    remoteCodeApp.includes('Text("Код"') &&
    remoteCodeApp.includes('QR для телефона') &&
    remoteCodeApp.includes('Base64.URL_SAFE') &&
    remoteCodeApp.includes('scanPairingQrBitmap') &&
    remoteCodeApp.includes('QrCodeScanner') &&
    androidManifest.includes('android.permission.CAMERA') &&
    androidBuildGradle.includes('com.google.mlkit:barcode-scanning'),
    'Android can import and scan pairing payloads',
    'pairing paste/import or QR scanning UI missing from connection screen'
);
assert(codexScreen.includes('Icons.Outlined.Extension') && codexScreen.includes('Icons.Outlined.Schedule') && codexScreen.includes('Плагины') && codexScreen.includes('Автоматизации') && codexScreen.includes('PaddingValues(bottom = 64.dp)'), 'Android drawer mirrors Codex navigation actions', 'drawer should expose Codex-like plugins and automations entries');
assert(connectionUrl.includes('trimmed.startsWith("//")') && connectionUrl.includes('"http:$trimmed"'), 'Android normalizes protocol-relative public URLs', 'protocol-relative public URL should become http://host');
assert(
    !apiClient.includes('KeeneticCloudDns') &&
    !simpleHttpClient.includes('KeeneticCloudDns') &&
    !webSocketClient.includes('KeeneticCloudDns') &&
    !mainActivity.includes('KeeneticCloudDns') &&
    simpleHttpClient.includes('HttpURLConnection') &&
    simpleHttpClient.includes('connection.disconnect()'),
    'Android uses platform DNS and legacy HTTP fallback',
    'Connection code should stay close to the known-working 1.0.77 path instead of hardcoding Keenetic Cloud IPs in the app'
);
assert(
    !mainVm.includes('tryKeeneticHttpFallback') &&
    !mainVm.includes('tryKeeneticProxyIpFallback') &&
    !modelsFile.includes('hostHeader') &&
    mainVm.includes('connect() exception, trying simple HTTP fallback') &&
    mainVm.includes('SimpleHttpClient.getStatus(config)'),
    'Android avoids experimental Keenetic connection rewrites',
    'Android should not rewrite a saved public URL to http:// or a hardcoded proxy IP after a failed HTTPS attempt'
);
assert(
    apiClient.includes('bypass-tunnel-reminder') &&
    simpleHttpClient.includes('bypass-tunnel-reminder') &&
    webSocketClient.includes('bypass-tunnel-reminder') &&
    mainActivity.includes('bypass-tunnel-reminder'),
    'Android supports LocalTunnel reminder bypass',
    'LocalTunnel public URLs require bypass-tunnel-reminder on HTTP and WebSocket requests'
);
assert(mainVm.includes('isUnsupportedExternalUrl') && mainVm.includes('Расширение вернуло служебный адрес'), 'Android rejects unsupported service public URLs', 'Android should reject service URLs before connecting');
assert(codexScreen.includes('item(key = "bottom-anchor")'), 'Android chat scrolls to a true bottom anchor', 'bottom anchor missing');
assert(codexScreen.includes('showCurrentThreadMenu') && codexScreen.includes('pendingDeleteThread') && codexScreen.includes('onNavigateToSettings()'), 'Android current-chat menu buttons work', 'current chat menu wiring missing');
assert(!codexScreen.includes('showThreads') && !codexScreen.includes('История Codex') && codexScreen.includes('onOpenNavigation()'), 'Android chat history uses the Codex drawer only', 'chat history should not be duplicated in a separate modal dialog');
assert(codexScreen.includes('attachmentPicker.launch') && codexScreen.includes('startVoiceInput'), 'Android composer file and voice buttons work', 'composer media/voice wiring missing');
assert(codexScreen.includes('onStopGeneration') && codexScreen.includes('onRespondToAction'), 'Android stop and approve/deny actions are wired', 'stop/approval wiring missing');
assert(mainVm.includes('autoConnectSavedConfig') && mainVm.includes('hasUsableSavedConnection') && remoteCodeApp.includes('isRealtimeConnected = state.isWebSocketConnected') && codexScreen.includes('if (isRealtimeConnected) "Live" else "HTTP"'), 'Android auto-connects and shows live status', 'saved connections should open straight into the live chat and expose WebSocket state');
assert(serverContent.includes('liveClientCount') && serverContent.includes('getWsClientKey') && webSocketClient.includes('X-Remote-Code-Client'), 'Live badge counts unique clients', 'Live should not inflate from reconnects or duplicate WebSocket sockets');
assert(!serverContent.includes('Remote Code ' + 'Agent') && serverContent.includes("method: 'remote-code'"), 'Remote Code labels do not imply a separate agent', 'user-facing API/prompt text should not call the VS Code bridge Remote Code ' + 'Agent');
assert(serverContent.includes('searchRemoteCode') && serverContent.includes('searchRemoteMessages') && serverContent.includes('searchWorkspaceTextFiles') && serverContent.includes('showRemoteCodeSearchQuickPick') && serverContent.includes("case 'openSearch'"), 'Extension deep search covers messages and files', 'extension should expose one search flow for chat messages and workspace text files');
assert(serverContent.includes('withTimeout') && serverContent.includes('finalizeStaleStreamingMessages') && serverContent.includes('Модель не начала отвечать за 45 секунд'), 'Model turns cannot stay stuck forever', 'VS Code LM lookup/streaming should have timeouts and stale streaming cleanup');
assert(modelsFile.includes('data class AppApkStatus') && modelsFile.includes('val appApk: AppApkStatus?') && remoteCodeApp.includes('APK в расширении') && remoteCodeApp.includes('APK SHA') && codexScreen.includes('mobileChatVersionLabel(workspaceStatus)'), 'Android shows explicit app/extension versions', 'chat and settings should expose installed APK, served APK, extension version and APK SHA');
assert(codexScreen.includes('contentAlignment = Alignment.CenterEnd') && codexScreen.includes('alignEnd = true') && codexScreen.includes('bottomEnd = 4.dp') && codexScreen.includes('modifier = Modifier.widthIn(max = userBubbleMaxWidth)'), 'Android user messages align right', 'user prompt bubble and toolbar should sit on the right and stay constrained');
assert(!codexScreen.includes('folders: FoldersResponse?') && !codexScreen.includes('currentFiles: FileTreeItem?') && !codexScreen.includes('fileContent: FileContent?') && !codexScreen.includes('onNavigateToDir: (String) -> Unit') && !codexScreen.includes('onGoUp: () -> Unit'), 'Android CodexScreen has no stale file-surface params', 'unused file params/callbacks should stay in FilesScreen, not CodexScreen');
assert(codexScreen.includes('BasicTextField') && codexScreen.includes('heightIn(min = 40.dp, max = 108.dp)') && codexScreen.includes('Modifier.size(37.dp)') && codexScreen.includes('navigationBarsPadding()'), 'Android composer is compact like Codex', 'mobile composer should avoid excessive vertical height and gesture bar overlap');
assert(codexScreen.includes('startNumber: Int = 1') && codexScreen.includes('"${startNumber + index}."') && codexScreen.includes('nextListItemIndex') && codexScreen.includes('val startNumber = ordered.groupValues[1]'), 'Android ordered lists preserve sequential numbering', 'ordered list blocks should not restart at 1 after item descriptions');
assert(codexScreen.includes('summaryEvent?.detail ?: mobileWorkSummary(timelineEvents, running)') && codexScreen.includes('type == "work_summary"') && codexScreen.includes('takeLast(120)') && codexScreen.includes('на протяжении'), 'Android shows Codex-like work summary', 'mobile work summary should match Codex wording');
assert(codexScreen.includes('val previewEvents = visibleEvents.takeLast(if (running) 4 else 3)') && codexScreen.includes('val hasFreshOutput = visibleEvents.any') && codexScreen.includes('mutableStateOf(running || hasFreshOutput)') && codexScreen.includes('MobileTimelineEventPreview(event)') && codexScreen.includes('title.isNotBlank() && !event.isCommandActionEvent()'), 'Android action timeline shows public work steps', 'mobile chat should expose recent public action/model progress lines without requiring expansion');
assert(modelsFile.includes('val command: String? = null') && modelsFile.includes('val stdout: String? = null') && mainVm.includes('command = this["command"] as? String') && codexScreen.includes('compactActionOutput(event)') && codexScreen.includes('event.command ?: event.filePath'), 'Android keeps full Codex action details', 'mobile action events should preserve command/cwd/path/stdout/stderr/diff so the timeline can match Codex detail');
assert(
    serverContent.includes('turnId?: string') &&
    serverContent.includes('sequence?: number') &&
    serverContent.includes('latestSequence') &&
    serverContent.includes('afterSequence') &&
    serverContent.includes('activeRemoteCodeTurnIds') &&
    serverContent.includes('relinkTurnEvents') &&
    modelsFile.includes('val turnId: String? = null') &&
    modelsFile.includes('val sequence: Long = 0') &&
    modelsFile.includes('val latestSequence: Long = 0') &&
    mainVm.includes('sortedByCodexActionOrder') &&
    codexScreen.includes('latestTurnId') &&
    codexScreen.includes('compactActionMeta(event)'),
    'Codex chat uses turn/event schema v2',
    'chat action output should be tied to a turn, ordered by sequence, replayable by afterSequence, and rendered with command metadata'
);
assert(codexScreen.includes('timelineWorkEvents') && codexScreen.includes('recentMobileWorkEvents(events.filterNot { it.type == "work_summary" })'), 'Android timeline ignores stale work events', 'mobile running state and visible timeline should use the same recent-turn filtering as the Codex-like work summary');
assert(mainVm.includes('"codex:message-refresh"') && mainVm.includes('data["messages"]') && mainVm.includes('data["events"]') && mainVm.includes('codexActionEvents = nextEvents'), 'Android applies live Codex message refresh events', 'mobile WebSocket handler should update chat messages and action timeline from codex:message-refresh');
assert(mainVm.includes('shouldApplyCodexThreadResponse') && mainVm.includes('requestCurrentThreadId') && mainVm.includes('val effectiveThreadId = responseThreadId') && mainVm.includes('val threadId = _uiState.value.currentCodexThreadId') && !mainVm.includes('current.isNotBlank() && _uiState.value.codexThreads.any'), 'Android keeps requests attached to the selected Codex chat', 'history/events responses must not overwrite a newer selected thread and sends must not fall back from a pending current thread to the first thread');
assert(codexScreen.includes('val visibleFiles = if (expanded) summary.files else emptyList()') && codexScreen.includes('fontSize = 14.sp') && codexScreen.includes('modifier = Modifier.width(24.dp)'), 'Android answer and change-card density matches Codex', 'mobile assistant text, ordered markers, and collapsed change cards should stay close to Codex density');
assert(codexScreen.includes('changeHeaderTitle(summary)') && codexScreen.includes('changeFileCount(summary)') && codexScreen.includes('ChangeDeltaStrip(') && codexScreen.includes('heightIn(min = 42.dp)') && codexScreen.includes('Icon(Icons.AutoMirrored.Filled.Undo, contentDescription =') && codexScreen.includes('Icon(Icons.Default.NorthEast, contentDescription =') && codexScreen.includes('horizontalArrangement = Arrangement.spacedBy(7.dp)') && codexScreen.includes('alwaysShowZero = true') && codexScreen.includes('modifier.widthIn(min = 74.dp)') && codexScreen.includes('AnimatedVisibility(visible = expanded)') && codexScreen.includes('fileCount = headerTotals') && codexScreen.includes('extractMobileCommitHash(content)') && modelsFile.includes('val fileCount: Int = 0') && mainVm.includes('fileCount = (this["fileCount"]'), 'Android change-card stats fit and match Codex totals', 'mobile change cards should keep +/- totals visible in a compact one-line Codex-like collapsed header and prefer Codex/header totals over partial row sums');
assert(codexScreen.includes('MobileCodeBlock') && codexScreen.includes('MobileTextBlockKind.Code') && codexScreen.includes('previewBitmap()') && codexScreen.includes('MobileImagePreviewDialog'), 'Android renders Codex-style code blocks and image previews', 'mobile chat should render fenced code blocks and tappable image attachments');
assert(remoteCodeApp.includes('ConnectionDiagnosticsCard') && remoteCodeApp.includes('/api/status') && remoteCodeApp.includes('APK endpoint'), 'Android shows external connection diagnostics', 'failed external connections should show URL/token/status/WebSocket/APK diagnostic steps');
assert(mainActivity.includes('sourceLabel') && mainActivity.includes('Источник: ${update.sourceLabel}') && mainActivity.includes('SHA-256: ${update.sha256.take(12)}'), 'Android updater explains verified APK before install', 'update dialog should show source, version, size and SHA before opening the system installer');
assert(apiClient.includes('selectCodexModel(@Body body: Map<String, @JvmSuppressWildcards Any>)'), 'Android composer preference API accepts booleans', 'selectCodexModel body type is too narrow');
assert(
    apiClient.includes('codexMessageAction') &&
    mainVm.includes('deleteCodexMessage') &&
    mainVm.includes('regenerateCodexMessage') &&
    mainVm.includes('sendCodexMessageFeedback') &&
    mainVm.includes('codex:message-deleted') &&
    codexScreen.includes('MobileMessageToolbar') &&
    codexScreen.includes('Icons.Outlined.ThumbUp') &&
    codexScreen.includes('Icons.Outlined.ThumbDown') &&
    modelsFile.includes('CodexMessageActionResponse'),
    'Android message actions match Codex chat controls',
    'Android should expose copy/edit/delete/regenerate/feedback actions and call the extension message API'
);
assert(
    apiClient.includes('codexChangeAction') &&
    modelsFile.includes('CodexChangeActionResponse') &&
    mainVm.includes('loadCodexChangeDiff') &&
    mainVm.includes('undoCodexChanges') &&
    codexScreen.includes('MobileChangeDiffDialog') &&
    codexScreen.includes('findMobileChangeSummaryForDiff') &&
    codexScreen.includes('LazyRow') &&
    codexScreen.includes('highlightedDiffText') &&
    codexScreen.includes('onLoadDiff(file.path, summary.commit, summary.cwd)') &&
    codexScreen.includes('actionKindLabel(event)'),
    'Android change cards expose multi-file diff/review/undo and richer timeline labels',
    'Android should show multi-file diffs from change cards and route undo through approval'
);
assert(
    modelsFile.includes('val projectId: String? = null') &&
    mainVm.includes('thread.projectId?.takeIf') &&
    mainVm.includes('codexProjectKey(it.projectId, it.workspaceName, it.workspacePath)') &&
    codexScreen.includes('mobileProjectKey(it.projectId, it.workspaceName, it.workspacePath)'),
    'Android chats stay attached to projects',
    'thread projectId should be modeled and preferred when selecting a project'
);
assert(
    mainVm.includes('fun selectCodexProject') &&
    remoteCodeApp.includes('onSelectProject = { viewModel.selectCodexProject(it) }') &&
    codexScreen.includes('showProjectSelector') &&
    codexScreen.includes('Выберите проект') &&
    codexScreen.includes('onSelectProject(project.id)'),
    'Android has a persistent project switcher',
    'mobile chat top bar should let the user explicitly switch the active project before creating a new chat'
);
assert(
    codexScreen.includes('CodexDrawerSearchField') &&
    codexScreen.includes('filterMobileProjects') &&
    codexScreen.includes('projectSearchQuery') &&
    codexScreen.includes('Поиск не нашёл проекты или чаты') &&
    !codexScreen.includes('label = "Поиск",\n                enabled = false'),
    'Android filters projects and chats in drawer',
    'Codex drawer search should be enabled and filter project/thread rows instead of being a disabled placeholder'
);
assert(
    apiClient.includes('suspend fun search') &&
    modelsFile.includes('RemoteSearchResponse') &&
    mainVm.includes('fun searchRemoteCode') &&
    mainVm.includes('clearRemoteSearch') &&
    remoteCodeApp.includes('onSearch = { viewModel.searchRemoteCode(it) }') &&
    codexScreen.includes('MobileSearchDialog') &&
    codexScreen.includes('MobileSearchResultRow') &&
    codexScreen.includes('Поиск по чату и файлам') &&
    codexScreen.includes('result.threadId') &&
    codexScreen.includes('result.path'),
    'Android deep search opens messages and files',
    'mobile chat should call /api/search and route message results to chats and file results to file viewer'
);
assert(
    mainVm.includes('codexProjectId') &&
    mainVm.includes('savedCodexProjectId()') &&
    mainVm.includes('saveCodexProjectId(nextProject)') &&
    mainVm.includes('saveCodexProjectId(nextProjectId)') &&
    mainVm.includes('saveCodexProjectId(project.id)'),
    'Android persists selected Codex project',
    'selected project should survive app restart and be restored before choosing the first available thread'
);
assert(
    apiClient.includes('newCodexThread(@Body body: Map<String, String>)') &&
    mainVm.includes('currentCodexProjectForNewThread') &&
    mainVm.includes('codexNewThreadRequest') &&
    serverContent.includes('resolveRequestedRemoteCodeWorkspace') &&
    serverContent.includes('this.currentRemoteThreadId ? this.getWorkspaceForThread(this.currentRemoteThreadId)') &&
    serverContent.includes('createRemoteCodeThread(workspace)'),
    'New Android chat is created inside the selected project',
    'new chat should send or inherit project/workspace metadata and extension should preserve it on the thread'
);

for (const f of androidFiles) {
    const fullPath = path.join(androidBase, f);
    assert(fs.existsSync(fullPath), `Android файл: ${f}`, `Не найден: ${fullPath}`);
}

// ===== Тест 10: Проверка Codex интегрции =====
console.log('\n🤖 Тест 10: Проверка Codex интеграции');

assert(serverContent.includes('CodexStatus'), 'CodexStatus интерфейс', 'Не найден');
assert(serverContent.includes('findCodexCli'), 'findCodexCli метод', 'Не найден');
assert(serverContent.includes('isCodexDesktopAppInstalled'), 'isCodexDesktopAppInstalled', 'Не найден');
assert(serverContent.includes('getCodexDesktopPath'), 'getCodexDesktopPath', 'Не найден');
assert(serverContent.includes('getDefaultCodexModels'), 'getDefaultCodexModels', 'Не найден');

// Проверка Android Codex
assert(mainVm.includes('syncCodexComposerPreferences') && mainVm.includes('codex:preferences-changed'), 'Android composer buttons sync with extension', 'composer sync missing in ViewModel');
assert(mainVm.includes('dedupeCodexMessages') && mainVm.includes('mobile_user_') && mainVm.includes('isDuplicateCodexMessage'), 'Android chat history deduplicates optimistic/WebSocket/history messages', 'chat dedupe missing in ViewModel');
assert(mainVm.includes('unexpected end of stream') && mainVm.includes('KeenDNS/HTTPS-прокси') && mainVm.includes('готовый HTTPS Keenetic/DDNS'), 'Android external connection errors explain Keenetic routing', 'external connection hint missing in ViewModel');
assert(mainVm.includes('Для внешней сети нужен токен доступа') && mainVm.includes('config.useTunnel && config.authToken.isBlank()'), 'Android blocks external mode without token', 'external mode must require token before connecting');
assert(mainVm.includes('loadCodexStatus'), 'loadCodexStatus в MainViewModel', 'Не найден');
assert(mainVm.includes('loadCodexModels'), 'loadCodexModels в MainViewModel', 'Не найден');
assert(mainVm.includes('sendCodexMessage'), 'sendCodexMessage в MainViewModel', 'Не найден');
assert(mainVm.includes('loadCodexThreads'), 'loadCodexThreads в MainViewModel', 'Не найден');
assert(mainVm.includes('launchCodex'), 'launchCodex в MainViewModel', 'Не найден');

// ===== ИТОГИ =====
console.log('\n' + '='.repeat(50));
console.log(`📊 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ:`);
console.log(`   Всего тестов: ${TESTS.total}`);
console.log(`   ✅ Пройдено: ${TESTS.passed}`);
console.log(`   ❌ Провалено: ${TESTS.failed}`);

if (TESTS.failed === 0) {
    console.log('\n🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ!');
} else {
    console.log(`\n⚠️  ${TESTS.failed} тестов не пройдено`);
}

console.log('='.repeat(50));
process.exitCode = TESTS.failed === 0 ? 0 : 1;
