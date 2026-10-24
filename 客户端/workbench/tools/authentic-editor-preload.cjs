'use strict';
const { ipcRenderer } = require('electron');
const encoded = process.argv.find(value => value.startsWith('--m0-authentic-editor='));
if (!encoded) throw new Error('Isolated editor configuration missing');
const config = JSON.parse(Buffer.from(encoded.split('=', 2)[1], 'base64url').toString('utf8'));
process.env.KSCODE_SOCKET_IPC_HANDLE = config.socket;
process.env.KSCODE_EXTENSION_IPC_HANDLE = config.extensionSocket;
process.env.VSCODE_AGENT_FOLDER = config.agent;
require('./authentic-editor-guard.cjs')({
  sandbox: config.sandbox, editor: config.editor, workspace: config.workspace, agent: config.agent, temporary: config.temporary, marketplace: config.marketplace,
  record: operation => ipcRenderer.send('authentic-editor:blocked', { operation }),
});
