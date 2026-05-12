const esbuild = require('esbuild');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  external: ['vscode', 'bufferutil', 'utf-8-validate']
};

async function main() {
  await esbuild.build({
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js'
  });

  await esbuild.build({
    ...common,
    entryPoints: ['src/standalone-server.ts'],
    outfile: 'out/standalone-server.js'
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
