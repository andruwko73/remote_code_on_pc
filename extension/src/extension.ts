import * as vscode from 'vscode';
import { RemoteServer } from './server';

let server: RemoteServer | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('[RemoteCodeOnPC] Активация расширения...');

    const startCmd = vscode.commands.registerCommand('remoteCodeOnPC.start', async () => {
        if (server) {
            vscode.window.showInformationMessage('✅ Сервер уже запущен');
            return;
        }
        server = new RemoteServer(context);
        try {
            await server.start();
            vscode.window.showInformationMessage(`✅ Remote Code on PC запущен на порту ${server.port}`);
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
        vscode.window.showInformationMessage('⏹ Сервер остановлен');
    });

    const statusCmd = vscode.commands.registerCommand('remoteCodeOnPC.status', async () => {
        if (server?.isRunning) {
            const addr = `http://${server.host}:${server.port}`;
            vscode.window.showInformationMessage(`✅ Сервер запущен: ${addr}`);
        } else {
            vscode.window.showInformationMessage('❌ Сервер не запущен');
        }
    });

    context.subscriptions.push(startCmd, stopCmd, statusCmd);

    // Автозапуск сервера
    const config = vscode.workspace.getConfiguration('remoteCodeOnPC');
    const port = config.get<number>('port', 8799);
    server = new RemoteServer(context);
    server.start().then(() => {
        console.log(`[RemoteCodeOnPC] Сервер автозапущен на порту ${port}`);
    }).catch(err => {
        console.error('[RemoteCodeOnPC] Ошибка автозапуска:', err.message);
        server = undefined;
    });
}

export function deactivate() {
    if (server) {
        server.stop();
    }
}
