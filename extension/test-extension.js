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

const requiredFiles = [
    'src/server.ts',
    'src/extension.ts',
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
    assert(serverContent.includes("data-change-action=\"toggle\"") && serverContent.includes("card?.classList.toggle('collapsed'"), 'Change-card expand button works', 'toggle action missing');
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
assert(serverContent.includes("case 'stopGeneration'") && serverContent.includes("id=\"topRun\"") && serverContent.includes("id=\"send\""), 'Stop/run buttons are wired', 'stop/run wiring missing');
assert(serverContent.includes("codex:preferences-changed") && serverContent.includes("Composer preferences changed"), 'Composer preferences sync over API/WebSocket', 'preference sync missing');
assert(serverContent.includes('actionTimelineSummary') && serverContent.includes('recentActionTimelineEvents') && serverContent.includes('work-summary-line') && serverContent.includes('на протяжении'), 'Extension shows Codex-like work summary', 'work summary row missing from extension chat');
};
assertWebviewInteractionWiring();

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
assert(serverContent.includes("case pathname === '/api/app/apk/status'") && serverContent.includes('handleAppApkStatus') && serverContent.includes('sizeBytes: metadata.sizeBytes') && serverContent.includes('sha256: metadata.sha256') && !serverContent.includes('apkPath: metadata.apkPath'), 'APK status endpoint exposes safe diagnostics', 'APK status should expose availability, size, sha256, and serverVersion without leaking local file paths');
assert(serverContent.includes('sanitizeLogText'), 'Маскирование логов расширения', 'sanitizeLogText не найден');
assert(serverContent.includes('if (!this._authToken) return !requireConfiguredToken'), 'Внешний доступ требует настроенный токен', 'checkAuth не требует токен для public access');
assert(
    serverContent.includes('const authRequired = this.isAuthRequiredForRequest(req, \'/ws\', publicAccess);') &&
    serverContent.includes('if (authRequired && !this.checkAuth(req, true))'),
    'WebSocket public access requires token',
    'public WebSocket must use the same token gate as HTTP'
);
assert(serverContent.includes('data-action="createOrCopyToken"') && serverContent.includes("case 'createOrCopyToken'") && serverContent.includes('showAuthTokenMenu'), 'Visible token button works', 'token button missing in webview');
assert(serverContent.includes('Создать новый токен') && serverContent.includes('forceNew') && serverContent.includes('token-btn'), 'Token can be regenerated explicitly', 'token regeneration/menu label missing');
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
assert(serverContent.includes('.msg.user{max-width:var(--chat-max);margin:0 auto 23px;color:var(--codex-bright);display:flex;justify-content:center') && serverContent.includes('margin-right:auto'), 'Extension user messages match Codex centered cards', 'user prompt bubble should be centered in the webview');
const compactWebviewChecks = [
    '--codex-sidebar:#17191d',
    '--codex-selected:#303039',
    '.sidebar-thread{min-height:39px',
    '.sidebar-thread.selected{background:var(--codex-selected)}',
    '.message-text{margin:0;white-space:normal;word-wrap:break-word;font:inherit;color:var(--codex-text);font-size:14px;line-height:1.47}',
    '.change-card{margin:10px 0 13px',
    '.change-row{display:flex;align-items:center;gap:11px;min-height:38px',
    '.composer{max-width:var(--composer-max);margin:0 auto;border:1px solid var(--codex-strong-border);background:#2d2d2d;border-radius:18px',
];
assert(compactWebviewChecks.every((snippet) => serverContent.includes(snippet)), 'Extension webview uses compact Codex-like density', 'webview sidebar/message/change-card/composer density drifted from Codex target');
assert(
    serverContent.includes('remote_code_hidden_messages') &&
    serverContent.includes('deleteRemoteMessage') &&
    serverContent.includes('regenerateRemoteMessage') &&
    serverContent.includes("type: 'codex:message-deleted'"),
    'Extension message actions persist and broadcast',
    'message delete/regenerate API should persist hidden messages and notify clients'
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
assert(
    standaloneContent.includes("pathname === '/api/terminal/exec'") &&
    standaloneContent.includes('Terminal execution is disabled in standalone mode') &&
    !standaloneContent.match(/terminal\/exec[\s\S]{0,800}(execSync|spawn|sendText)/),
    'Standalone terminal exec disabled',
    'standalone terminal exec must not execute commands'
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
assert(!!pkg.name, 'name поле', 'Отсутствует');
assert(!!pkg.contributes?.commands, 'commands в contributes', 'Отсутствуют');
assert(pkg.scripts?.['install:local']?.includes('install-local-extension.ps1'), 'Local extension install script is wired', 'package.json should expose a local install script for the VS Code extension copy');
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
    'app/src/main/java/com/remotecodeonpc/app/RemoteCodeApp.kt',
    'app/src/main/java/com/remotecodeonpc/app/viewmodel/MainViewModel.kt',
    'app/src/main/java/com/remotecodeonpc/app/network/ApiClient.kt',
    'app/src/main/java/com/remotecodeonpc/app/network/WebSocketClient.kt',
    'app/src/main/java/com/remotecodeonpc/app/ui/screens/VSCodeScreen.kt',
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
const androidBuildGradle = fs.readFileSync(path.join(androidBase, 'app', 'build.gradle.kts'), 'utf-8');
assert(!remoteCodeApp.includes('.verticalScroll(rememberScrollState())'), 'Android connection screen avoids forced startup scroll', 'startup screen still has verticalScroll');
assert(remoteCodeApp.includes('Arrangement.spacedBy(7.dp, Alignment.CenterVertically)'), 'Android connection screen is compact', 'compact connection layout missing');
assert(remoteCodeApp.includes('Text("Логи"') && remoteCodeApp.includes('Text("Очистить"') && remoteCodeApp.includes('Text("Обновить"'), 'Android startup action buttons are present', 'startup action row missing');
assert(remoteCodeApp.includes('PasswordVisualTransformation') && remoteCodeApp.includes('showToken') && remoteCodeApp.includes('showCompactToken'), 'Android token fields are masked by default', 'token field must not show secrets by default');
assert(!connectionUrl.includes('withKeeneticPort') && !remoteCodeApp.includes('Text("Порт"') && !remoteCodeApp.includes('порт'), 'Android hides manual port from connection UI', 'external URLs should not get an implicit app port and Android should not mention a manual port in the main UI');
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
assert(androidBuildGradle.includes('versionCode = 97') && androidBuildGradle.includes('versionName = "1.0.97"') && androidBuildGradle.includes('signingConfig = signingConfigs.getByName("debug")'), 'Android release artifact can update existing sideload installs', 'release APK should be version-bumped and signed for sideload updates');
assert(mainActivity.includes('UpdateReadyDialog') && mainActivity.includes('UpdateStatusDialog') && mainActivity.includes('onStatus("Скачивание обновления') && mainActivity.includes('onStatus("Проверка APK') && mainActivity.includes('PendingVerifiedApk') && mainActivity.includes('onReadyDialogFinished = { pendingVerifiedApk = null }') && mainActivity.includes('onInstallPermissionRequired = { pendingVerifiedApk = update }') && mainActivity.includes('Handler(Looper.getMainLooper()).post') && mainActivity.includes('Intent.ACTION_VIEW') && mainActivity.includes('Intent.ACTION_INSTALL_PACKAGE') && !mainActivity.includes('Intent.EXTRA_RETURN_RESULT') && mainActivity.includes('startActivityForResult(intent, updateInstallRequestCode)') && mainActivity.includes('startActivityForResult(installIntent, updateInstallRequestCode)') && !mainActivity.includes('Intent.FLAG_ACTIVITY_NEW_TASK'), 'Android updater uses the Package Installer handoff style without forced return-result', 'verified APK should open through ACTION_VIEW and keep ACTION_INSTALL_PACKAGE as fallback without forcing result mode');
assert(mainActivity.includes('onInstallPermissionRequired()') && mainActivity.includes('ACTION_MANAGE_UNKNOWN_APP_SOURCES') && mainActivity.indexOf('onInstallPermissionRequired()') > mainActivity.indexOf('startActivity(settingsIntent)'), 'Android updater preserves APK after unknown-source permission handoff', 'permission settings should keep the verified APK ready for a second install tap');
assert(codexScreen.includes('CodexNavigationPanel') && codexScreen.includes('CodexDrawerProjectRow') && codexScreen.includes('buildMobileCodexProjects') && modelsFile.includes('workspaceName'), 'Android exposes projects in Codex chat list', 'project drawer/thread workspace metadata should be visible to Android');
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
assert(codexScreen.includes('contentAlignment = Alignment.Center') && codexScreen.includes('modifier = Modifier.widthIn(max = 330.dp)'), 'Android user messages match Codex centered cards', 'user prompt bubble should be centered and constrained like Codex');
assert(codexScreen.includes('BasicTextField') && codexScreen.includes('heightIn(min = 40.dp, max = 108.dp)') && codexScreen.includes('Modifier.size(37.dp)'), 'Android composer is compact like Codex', 'mobile composer should avoid excessive vertical height');
assert(codexScreen.includes('startNumber: Int = 1') && codexScreen.includes('"${startNumber + index}."') && codexScreen.includes('val startNumber = ordered.groupValues[1]'), 'Android ordered lists preserve original numbering', 'ordered list blocks should not restart at 1 after item descriptions');
assert(codexScreen.includes('mobileWorkSummary(events, running)') && codexScreen.includes('MOBILE_WORK_SUMMARY_IDLE_GAP_MS') && codexScreen.includes('на протяжении'), 'Android shows Codex-like work summary', 'mobile work summary should match Codex wording');
assert(codexScreen.includes('val previewEvents = visibleEvents.takeLast(if (running) 4 else 3)') && codexScreen.includes('MobileTimelineEventPreview(event)') && codexScreen.includes('title.isNotBlank() && !event.type.contains("command")'), 'Android action timeline shows public work steps', 'mobile chat should expose recent public action/model progress lines without requiring expansion');
assert(codexScreen.includes('summary.files.take(5)') && codexScreen.includes('fontSize = 12.75.sp') && codexScreen.includes('modifier = Modifier.width(22.dp)'), 'Android answer and change-card density matches Codex', 'mobile assistant text, ordered markers, and change cards should stay close to Codex density');
assert(apiClient.includes('selectCodexModel(@Body body: Map<String, @JvmSuppressWildcards Any>)'), 'Android composer preference API accepts booleans', 'selectCodexModel body type is too narrow');
assert(
    apiClient.includes('codexMessageAction') &&
    mainVm.includes('deleteCodexMessage') &&
    mainVm.includes('regenerateCodexMessage') &&
    mainVm.includes('codex:message-deleted') &&
    codexScreen.includes('MobileMessageToolbar') &&
    modelsFile.includes('CodexMessageActionResponse'),
    'Android message actions match Codex chat controls',
    'Android should expose copy/edit/delete/regenerate actions and call the extension message API'
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
    apiClient.includes('newCodexThread(@Body body: Map<String, String>)') &&
    mainVm.includes('currentCodexProjectForNewThread') &&
    mainVm.includes('codexNewThreadRequest') &&
    serverContent.includes('resolveRequestedRemoteCodeWorkspace') &&
    serverContent.includes('createRemoteCodeThread(workspace)'),
    'New Android chat is created inside the selected project',
    'new chat should send project/workspace metadata and extension should preserve it on the thread'
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
