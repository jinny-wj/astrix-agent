'use strict';
// This process owns only the recovered local KSCode server. Guarding it does
// not affect the desktop shell's HTTP client or the independent model service.
const fs = require('node:fs');
const path = require('node:path');
const config = JSON.parse(Buffer.from(process.env.M0_ORIGINAL_EDITOR_CONFIG, 'base64url').toString('utf8'));
delete process.env.M0_ORIGINAL_EDITOR_CONFIG;
process.env.KSCODE_SOCKET_IPC_HANDLE = config.socket;
process.env.KSCODE_EXTENSION_IPC_HANDLE = config.extensionSocket;
process.env.VSCODE_AGENT_FOLDER = config.agent;
process.env.VSCODE_PARENT_PID = String(process.pid);
// The recovered editor has its own profile and no inherited account settings.
// Skip login-shell environment discovery, which would source the user's dotfiles.
process.env.VSCODE_CLI = '1';
process.env.VSCODE_RESOLVING_ENVIRONMENT = '1';
delete process.env.VSCODE_DEV;
delete process.env.VSCODE_INJECT_NODE_MODULE_LOOKUP_PATH;
const guard = require('../tools/authentic-editor-guard.cjs')({
  sandbox: config.sandbox, editor: config.editor, agent: config.agent, temporary: config.temporary, marketplace: config.marketplace, allowLocalProcesses: true,
  record: operation => process.send?.({ type: operation.startsWith('market:') ? 'marketplace' : operation.startsWith('allowed:') ? 'process' : 'blocked', operation }),
});

let server;
process.on('message', async message => {
  if (!message || message.type !== 'call') return;
  try {
    if (!server) throw new Error('Original editor server is not ready');
    const service = server.getDevtoolsExports(String(message.authority));
    let result;
    if (message.method === 'openEditor') {
      const file = fs.realpathSync(message.args.filePath);
      const workspace = fs.realpathSync(message.args.workspace);
      if (file !== workspace && !file.startsWith(workspace + path.sep)) throw new Error('Editor file must be inside the current workspace');
      result = await service.openEditor({ filePath: file, selection: { startLineNumber: 1, startColumn: 1 } });
    } else if (message.method === 'getOpeningFilesStat') {
      result = await service.getOpeningFilesStat();
    } else {
      throw new Error('Unsupported original editor server operation');
    }
    process.send?.({ type: 'reply', id: message.id, result });
  } catch (error) {
    process.send?.({ type: 'reply', id: message.id, error: error.message });
  }
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { server?.agentServer?.dispose(); } catch {}
  await guard.dispose();
  // The desktop may already have exited. Let this owning server perform its
  // own temp cleanup instead of relying only on a callback in the GUI process.
  if (config.temporary) { try { fs.rmSync(config.temporary, { recursive: true, force: true }); } catch {} }
  process.exit(0);
}
process.on('disconnect', shutdown);
process.on('SIGTERM', shutdown);
(async () => {
  const productPath=path.join(config.editor,'product.json');
  const product=require(productPath);
  require.cache[require.resolve(productPath)].exports={...product,extensionsGallery:config.marketplace?require('./marketplace-network.cjs').gallery:{}};
  const { startupMain } = require(path.join(config.editor, 'out/server-main.kscode.js'));
  server = await startupMain();
  process.send?.({ type: 'ready', socket: config.socket });
})().catch(error => {
  process.send?.({ type: 'fatal', error: error.message });
  process.exit(1);
});
