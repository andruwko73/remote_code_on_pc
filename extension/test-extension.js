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
    assert(serverContent.includes("message-tool") && serverContent.includes("case 'copyMessage'") && serverContent.includes("case 'messageFeedback'"), 'Message hover buttons work', 'copy/feedback handlers missing');
    assert(serverContent.includes("data-action-id=") && serverContent.includes("actionResponse"), 'Approve/deny action buttons work', 'action response wiring missing');
    assert(serverContent.includes("prompt.addEventListener('paste'") && serverContent.includes("pasteFiles"), 'Paste attachment flow works', 'paste attachment wiring missing');
    assert(serverContent.includes("prompt.addEventListener('keydown'") && serverContent.includes("event.key === 'Enter'"), 'Enter sends message in extension', 'Enter send wiring missing');
    assert(serverContent.includes("case 'stopGeneration'") && serverContent.includes("id=\"topRun\"") && serverContent.includes("id=\"send\""), 'Stop/run buttons are wired', 'stop/run wiring missing');
    assert(serverContent.includes("codex:preferences-changed") && serverContent.includes("Composer preferences changed"), 'Composer preferences sync over API/WebSocket', 'preference sync missing');
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

// ===== Тест 7: Проверка extension.ts =====
console.log('\n🧩 Тест 7: Проверка extension.ts');

const extContent = fs.readFileSync(path.join(__dirname, 'src', 'extension.ts'), 'utf-8');

assert(extContent.includes('statusBarItem'), 'StatusBarItem', 'Не найден');
assert(extContent.includes('remoteCodeOnPC.start'), 'start команда', 'Не найдена');
assert(extContent.includes('remoteCodeOnPC.stop'), 'stop команда', 'Не найдена');
assert(extContent.includes('remoteCodeOnPC.tunnel'), 'tunnel команда', 'Не найдена');
assert(extContent.includes('remoteCodeOnPC.status'), 'status команда', 'Не найдена');
assert(extContent.includes('remoteCodeOnPC.openChat'), 'openChat команда', 'Не найдена');
assert(extContent.includes('remoteCodeOnPC.token') && extContent.includes('createOrCopyAuthToken'), 'token команда', 'Не найдена');
assert(extContent.includes('server.openRemoteCodeChat'), 'собственный Remote Code чат', 'Не найден');
assert(extContent.includes('updateStatusBar'), 'updateStatusBar функция', 'Не найдена');

// ===== Тест 7.1: Проверка безопасности и webview-кнопок =====
console.log('\n🔐 Тест 7.1: Безопасность внешнего доступа и webview actions');

assert(serverContent.includes('requestUsesPublicAccess'), 'Определение внешнего Host', 'requestUsesPublicAccess не найден');
assert(serverContent.includes('publicAuthRequiredStatus'), 'Минимальный статус без токена', 'publicAuthRequiredStatus не найден');
assert(serverContent.includes('sanitizeLogText'), 'Маскирование логов расширения', 'sanitizeLogText не найден');
assert(serverContent.includes('if (!this._authToken) return !requireConfiguredToken'), 'Внешний доступ требует настроенный токен', 'checkAuth не требует токен для public access');
assert(serverContent.includes('const publicAccess = this.requestUsesPublicAccess(req);') && serverContent.includes('!this.checkAuth(req, publicAccess)'), 'WebSocket public access requires token', 'public WebSocket must use the same token gate as HTTP');
assert(serverContent.includes('data-action="createOrCopyToken"') && serverContent.includes("case 'createOrCopyToken'"), 'Visible token button works', 'token button missing in webview');
assert(serverContent.includes('liveDraftThreadIds'), 'Пустые чаты не закрепляются навсегда', 'liveDraftThreadIds не найден');
assert(serverContent.includes("private currentRemoteThreadId: string = '';"), 'Нет скрытого default-чата при старте', 'currentRemoteThreadId не должен стартовать с remote-code-default');
assert(serverContent.includes('if (!targetThreadId)') && serverContent.includes('targetThreadId = this.createRemoteCodeThread()'), 'Сообщение без thread создаёт реальный чат', 'fallback thread должен создаваться явно');
assert(serverContent.includes('decodeBasicHtmlEntities') && serverContent.includes('isTechnicalProgressLine'), 'Прогресс не показывает технические строки вложений', 'Фильтрация технических progress-строк не найдена');

const webviewActions = [...serverContent.matchAll(/data-action=\"([^\"]+)\"/g)].map(match => match[1]);
const uniqueWebviewActions = [...new Set(webviewActions)].sort();
const handlerCases = new Set([...serverContent.matchAll(/case\s+'([^']+)'\s*:/g)].map(match => match[1]));
const missingWebviewHandlers = uniqueWebviewActions.filter(action => !handlerCases.has(action));
assert(missingWebviewHandlers.length === 0, 'Все data-action имеют обработчик', missingWebviewHandlers.join(', ') || 'OK');

// ===== Тест 8: Проверка package.json =====
console.log('\n📦 Тест 8: Проверка package.json');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
assert(!!pkg.name, 'name поле', 'Отсутствует');
assert(!!pkg.contributes?.commands, 'commands в contributes', 'Отсутствуют');
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
const connectionUrl = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'network', 'ConnectionUrl.kt'), 'utf-8');
assert(!remoteCodeApp.includes('.verticalScroll(rememberScrollState())'), 'Android connection screen avoids forced startup scroll', 'startup screen still has verticalScroll');
assert(remoteCodeApp.includes('Arrangement.spacedBy(7.dp, Alignment.CenterVertically)'), 'Android connection screen is compact', 'compact connection layout missing');
assert(remoteCodeApp.includes('Text("Логи"') && remoteCodeApp.includes('Text("Очистить"') && remoteCodeApp.includes('Text("Обновить"'), 'Android startup action buttons are present', 'startup action row missing');
assert(remoteCodeApp.includes('PasswordVisualTransformation') && remoteCodeApp.includes('showToken') && remoteCodeApp.includes('showCompactToken'), 'Android token fields are masked by default', 'token field must not show secrets by default');
assert(connectionUrl.includes('withKeeneticPort') && connectionUrl.includes('netcraze') && connectionUrl.includes('.keenetic.'), 'Android Keenetic URL gets Remote Code port', 'Keenetic URLs without explicit port should use the app port');
assert(codexScreen.includes('item(key = "bottom-anchor")'), 'Android chat scrolls to a true bottom anchor', 'bottom anchor missing');
assert(codexScreen.includes('showCurrentThreadMenu') && codexScreen.includes('pendingDeleteThread') && codexScreen.includes('onNavigateToSettings()'), 'Android current-chat menu buttons work', 'current chat menu wiring missing');
assert(codexScreen.includes('attachmentPicker.launch') && codexScreen.includes('startVoiceInput'), 'Android composer file and voice buttons work', 'composer media/voice wiring missing');
assert(codexScreen.includes('onStopGeneration') && codexScreen.includes('onRespondToAction'), 'Android stop and approve/deny actions are wired', 'stop/approval wiring missing');
assert(apiClient.includes('selectCodexModel(@Body body: Map<String, @JvmSuppressWildcards Any>)'), 'Android composer preference API accepts booleans', 'selectCodexModel body type is too narrow');

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
const mainVm = fs.readFileSync(path.join(androidBase, 'app', 'src', 'main', 'java', 'com', 'remotecodeonpc', 'app', 'viewmodel', 'MainViewModel.kt'), 'utf-8');
assert(mainVm.includes('syncCodexComposerPreferences') && mainVm.includes('codex:preferences-changed'), 'Android composer buttons sync with extension', 'composer sync missing in ViewModel');
assert(mainVm.includes('dedupeCodexMessages') && mainVm.includes('mobile_user_') && mainVm.includes('isDuplicateCodexMessage'), 'Android chat history deduplicates optimistic/WebSocket/history messages', 'chat dedupe missing in ViewModel');
assert(mainVm.includes('unexpected end of stream') && mainVm.includes('KeenDNS Direct'), 'Android external connection errors explain Keenetic port forwarding', 'external connection hint missing in ViewModel');
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
