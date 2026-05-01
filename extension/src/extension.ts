import * as vscode from 'vscode';
import { RemoteServer } from './server';

let server: RemoteServer | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

// Глобальный обработчик необработанных rejections — защита от падения extension host
process.on('unhandledRejection', (reason: any) => {
    console.error('[RemoteCodeOnPC] Unhandled Rejection:', reason?.message || reason);
});

export function activate(context: vscode.ExtensionContext) {
    console.log('[RemoteCodeOnPC] Активация расширения...');

    // Статус бар
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'remoteCodeOnPC.status';
    context.subscriptions.push(statusBarItem);

    // Автозапуск сервера
    const config = vscode.workspace.getConfiguration('remoteCodeOnPC');
    const port = config.get<number>('port', 8799);
    server = new RemoteServer(context);
    server.start().then(() => {
        console.log(`[RemoteCodeOnPC] Сервер автозапущен на порту ${port}`);
        updateStatusBar();
    }).catch(err => {
        console.error('[RemoteCodeOnPC] Ошибка автозапуска:', err.message);
        server = undefined;
    });

    const startCmd = vscode.commands.registerCommand('remoteCodeOnPC.start', async () => {
        if (server?.isRunning) {
            vscode.window.showInformationMessage('✅ Сервер уже запущен');
            return;
        }
        if (!server) {
            server = new RemoteServer(context);
        }
        try {
            await server.start();
            vscode.window.showInformationMessage(`✅ Remote Code on PC запущен на порту ${server.port}`);
            updateStatusBar();
        } catch (err: any) {
            vscode.window.showErrorMessage(`❌ Ошибка запуска: ${err.message}`);
            server = undefined;
        }
    });

    const stopCmd = vscode.commands.registerCommand('remoteCodeOnPC.stop', async () => {
        if (!server) {
            vscode.window.showInformationMessage('Сервер не запущен');
            return;
        }
        await server.stop();
        server = undefined;
        if (statusBarItem) statusBarItem.hide();
        vscode.window.showInformationMessage('⏹ Сервер остановлен');
    });

    const tunnelCmd = vscode.commands.registerCommand('remoteCodeOnPC.tunnel', async () => {
        if (!server?.isRunning) {
            vscode.window.showErrorMessage('Сначала запустите сервер');
            return;
        }
        if (server.tunnelUrl) {
            const action = await vscode.window.showInformationMessage(
                `🌐 Туннель активен: ${server.tunnelUrl}`,
                'Остановить туннель'
            );
            if (action === 'Остановить туннель') {
                server.stopTunnelPublic();
                updateStatusBar();
                vscode.window.showInformationMessage('⏹ Туннель остановлен');
            }
            return;
        }
        vscode.window.showInformationMessage('🌐 Запуск туннеля ngrok...');
        try {
            const url = await server.startTunnelPublic();
            vscode.window.showInformationMessage(`🌐 Интернет-доступ: ${url}`);
            updateStatusBar();
        } catch (err: any) {
            vscode.window.showErrorMessage(`❌ Ошибка туннеля: ${err.message}`);
        }
    });

    const statusCmd = vscode.commands.registerCommand('remoteCodeOnPC.status', async () => {
        if (!server?.isRunning) {
            vscode.window.showErrorMessage('❌ Сервер не запущен');
            return;
        }
        const addr = `http://${server.host}:${server.port}`;
        let msg = `✅ Сервер: ${addr}`;
        if (server.tunnelUrl) msg += `\n🌐 Интернет: ${server.tunnelUrl}`;
        if (server.localIp) msg += `\n📡 Локальный IP: ${server.localIp}`;
        vscode.window.showInformationMessage(msg);
    });

    context.subscriptions.push(startCmd, stopCmd, tunnelCmd, statusCmd);
}

function updateStatusBar() {
    if (!statusBarItem || !server) return;
    const parts = ['🖥️ Remote'];
    if (server.isRunning) parts.push(`:${server.port}`);
    if (server.tunnelUrl) parts.push('🌐');
    statusBarItem.text = parts.join(' ');
    statusBarItem.tooltip = `Remote Code on PC\nЛокально: http://${server.localIp}:${server.port}\n${server.tunnelUrl ? 'Интернет: ' + server.tunnelUrl : 'Туннель неактивен'}`;
    statusBarItem.show();
}

export function deactivate() {
    if (server) {
        server.stop();
    }
}
