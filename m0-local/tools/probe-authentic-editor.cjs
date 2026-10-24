'use strict';

// Opt-in, server-only experiment. The parent task controls whether it runs.
// Uses the recovered editor JavaScript, not the original application entry.
if (!process.argv.includes('--run')) {
  console.log('Not started. To probe with the new Electron runtime:');
  console.log('npx electron tools/probe-authentic-editor.cjs --run');
  process.exit(0);
}
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
if (!app || process.type !== 'browser') throw new Error('Run this probe using the new local Electron runtime.');
const root = path.resolve(__dirname, '..');
const sandbox = path.join(root, '.local-data', 'editor-original-probe');
const editor = path.resolve(root, '../M0-AI-recovered/extracted/resources/editor');
const reportFile = path.join(root, 'diagnostics', 'authentic-editor-server-probe.json');
const blocked = [];
fs.mkdirSync(sandbox, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
app.setName('Astrix Editor Probe');
app.setPath('userData', path.join(sandbox, 'electron'));
app.commandLine.appendSwitch('disable-background-networking');
process.env.KSCODE_SOCKET_IPC_HANDLE = path.join(sandbox, 'editor.sock');
process.env.KSCODE_EXTENSION_IPC_HANDLE = path.join(sandbox, 'extension.sock');
process.env.VSCODE_AGENT_FOLDER = path.join(sandbox, 'agent');
process.env.VSCODE_PARENT_PID = String(process.pid);
delete process.env.VSCODE_DEV;
delete process.env.VSCODE_INJECT_NODE_MODULE_LOOKUP_PATH;

function deny(operation) {
  blocked.push(operation);
  throw new Error(`Isolated editor probe blocked ${operation}`);
}
// Preserve only this probe's Unix sockets. Never use target credentials or TCP.
function localSocket(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const candidate = typeof first === 'string' ? first : first && typeof first === 'object' ? first.path : null;
  return typeof candidate === 'string' && path.resolve(candidate).startsWith(sandbox + path.sep);
}
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  if (!localSocket(args)) return deny('TCP/outside-socket connect');
  return connect.apply(this, args);
};
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (!localSocket(args)) return deny('TCP/outside-socket listen');
  return listen.apply(this, args);
};
for (const [name, methods] of [
  ['node:child_process', ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']],
  ['node:http', ['request', 'get']], ['node:https', ['request', 'get']],
  ['node:tls', ['connect']], ['node:dns', ['lookup', 'resolve']],
]) {
  const module = require(name);
  for (const method of methods) module[method] = () => deny(`${name}.${method}`);
}
global.fetch = () => Promise.reject(new Error('Isolated editor probe blocks fetch'));
require('node:module').syncBuiltinESMExports();

let completed = false;
function finish(report, exitCode) {
  if (completed) return;
  completed = true;
  fs.writeFileSync(reportFile, JSON.stringify({ editor, sandbox, blocked, ...report }, null, 2));
  console.log(JSON.stringify({ reportFile, ...report }));
  app.exit(exitCode);
}
const timeout = setTimeout(() => finish({ ok: false, error: 'Server startup timed out after 20 seconds' }, 1), 20_000);
app.whenReady().then(async () => {
  const entry = path.join(editor, 'out/server-main.kscode.js');
  const { startupMain } = require(entry);
  const server = await startupMain();
  clearTimeout(timeout);
  finish({
    ok: true,
    stage: 'server-only',
    socketExists: fs.existsSync(process.env.KSCODE_SOCKET_IPC_HANDLE),
    exports: Object.keys(server),
    hasAgentServer: Boolean(server.agentServer),
    hasDevtoolsExportsFactory: typeof server.getDevtoolsExports === 'function',
    rendererStarted: false,
  }, 0);
}).catch(error => {
  clearTimeout(timeout);
  finish({ ok: false, error: error.message, stack: String(error.stack).slice(0, 6000) }, 1);
});
