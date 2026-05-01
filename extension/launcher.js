// Standalone launcher for Remote Code on PC server.
// This entry point intentionally does not import the VS Code extension runtime.

const { RemoteServer } = require('./out/standalone-server');
const path = require('path');

async function main() {
    const cwd = process.cwd();
    const workspaceRoot = path.basename(cwd).toLowerCase() === 'extension' ? path.dirname(cwd) : cwd;
    const server = new RemoteServer(workspaceRoot);

    try {
        await server.start();
        console.log('============================================');
        console.log('  Remote Code on PC - standalone server');
        console.log('============================================');
        console.log(`  IP: ${server.localIp || '0.0.0.0'}`);
        console.log(`  Port: ${server.port}`);
        console.log(`  URL: http://${server.localIp || '0.0.0.0'}:${server.port}`);
        console.log('============================================');
        console.log('  Connect Android to the URL above');
        console.log('  VS Code is optional; Codex works directly');
        console.log('============================================');
    } catch (err) {
        console.error('Failed to start standalone server:', err);
        process.exit(1);
    }
}

main();
