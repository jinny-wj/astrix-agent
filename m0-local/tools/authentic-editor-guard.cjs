'use strict';
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const marketplaceTransport = require('../desktop/marketplace-network.cjs');

module.exports = function installGuard({ sandbox, editor, workspace, agent, temporary, marketplace = false, allowLocalProcesses = false, role = 'server', record = () => {} }) {
  const market = marketplaceTransport.create({enabled:marketplace,record});
  const under = (candidate, base) => {
    const resolved = path.resolve(candidate);
    return resolved === base || resolved.startsWith(base + path.sep);
  };
  function blocked(operation) {
    record(operation);
    throw new Error(`Authentic editor isolation blocked ${operation}`);
  }
  // VS Code and its extensions resolve their profile through os.homedir().
  // Keep that API in this project's profile without changing the caller's HOME.
  if (agent) require('node:os').homedir = () => path.join(agent, 'home');
  function localSocket(args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const candidate = typeof first === 'string' ? first : first && typeof first === 'object' ? first.path : null;
    return typeof candidate === 'string' && (under(candidate, sandbox) || temporary && under(candidate, temporary));
  }
  const net = require('node:net');
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    if (!localSocket(args)) return blocked('TCP/outside-socket connect');
    return connect.apply(this, args);
  };
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    if (!localSocket(args)) return blocked('TCP/outside-socket listen');
    return listen.apply(this, args);
  };
  const cp = require('node:child_process');
  const native = Object.fromEntries(['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync'].map(name => [name, cp[name]]));
  const bootstrap = path.join(editor, 'out/bootstrap-fork.js');
  const normalizeScript = file => path.resolve(file).replace(/\/bootstrap-fork$/, '/bootstrap-fork.js');
  const entries = new Set([
    'vs/platform/files/node/watcher/watcherMain',
    'vs/platform/terminal/node/ptyHostMain',
    'vs/workbench/api/node/extensionHostProcess',
  ]);
  const languageServers = new Set([
    'json-language-features/server/dist/node/jsonServerMain.js',
    'html-language-features/server/dist/node/htmlServerMain.js',
    'css-language-features/server/dist/node/cssServerMain.js',
    'node_modules/typescript/lib/tsserver.js',
    'node_modules/typescript/lib/typingsInstaller.js',
    'markdown-language-features/server/dist/node/main.js',
    'markdown-language-features/server/dist/node/workerMain.js',
  ].map(file => path.join(editor, 'extensions', file)));
  const childPreload = path.join(__dirname, 'authentic-editor-child.cjs');
  const children = new Set();
  function track(child) {
    children.add(child);
    child.once('exit', () => children.delete(child));
    return child;
  }
  function childPolicy(script, options = {}) {
    let resolved = normalizeScript(script);
    if (languageServers.has(resolved + '.js')) resolved += '.js';
    const entry = options.env?.VSCODE_AMD_ENTRYPOINT;
    const allowed = allowLocalProcesses && (resolved === bootstrap && entries.has(entry)
      || ['vs/workbench/api/node/extensionHostProcess', 'language-server'].includes(role) && languageServers.has(resolved));
    if (!allowed) return blocked(`child_process.fork ${resolved} (${entry || role})`);
    const nextRole = resolved === bootstrap ? entry : 'language-server';
    const policy = { sandbox, editor, agent, workspace, temporary, allowLocalProcesses: true, role: nextRole };
    record(`allowed:fork:${nextRole}:${resolved}`);
    return { ...options, execPath: process.execPath,
      execArgv: [...(options.execArgv || []), '--require', childPreload],
      env: { ...process.env, ...options.env, ELECTRON_RUN_AS_NODE: '1',
        M0_EDITOR_CHILD_POLICY: Buffer.from(JSON.stringify(policy)).toString('base64url') },
    };
  }
  cp.fork = (script, args, options) => {
    if (!Array.isArray(args)) { options = args; args = []; }
    return track(native.fork(script, args || [], childPolicy(script, options)));
  };
  // VS Code's fork helper eventually calls spawn with the Electron-as-Node
  // executable. Only permit the scripts already checked by childPolicy.
  cp.spawn = (executable, args, options) => {
    const argv = Array.isArray(args) ? args : [];
    if (allowLocalProcesses && executable === process.execPath && options?.env?.M0_EDITOR_CHILD_POLICY
      && argv.some(value => normalizeScript(value) === bootstrap || languageServers.has(value))) {
      return track(native.spawn(executable, argv, options));
    }
    if (allowLocalProcesses && executable === path.join(editor, 'node_modules/@vscode/ripgrep/bin/rg')
      && ['server', 'vs/workbench/api/node/extensionHostProcess'].includes(role)) {
      record('allowed:spawn:ripgrep');
      return track(native.spawn(executable, argv, options));
    }
    return blocked(`child_process.spawn ${executable}`);
  };
  for (const name of ['exec', 'execFile', 'spawnSync', 'execSync', 'execFileSync']) cp[name] = () => blocked(`node:child_process.${name}`);
  for (const [name, methods] of [
    ['node:http', ['request', 'get']], ['node:https', ['request', 'get']],
    ['node:tls', ['connect']], ['node:dns', ['lookup', 'resolve']],
  ]) {
    const target = require(name);
    for (const method of methods) target[method] = () => blocked(`${name}.${method}`);
  }
  const https=require('node:https');
  https.request=(...args)=>{
    try { return market.request(...args); }
    catch(error){if(marketplace&&error.message!=='Open VSX transport rejected URL or method')throw error;return blocked('node:https.request outside Open VSX');}
  };
  https.get=(...args)=>{const request=https.request(...args);request.end();return request;};
  const nativeFetch = globalThis.fetch?.bind(globalThis);
  globalThis.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if(market.allows(url,options?.method))return market.fetch(input,options);
    const allowed = ['data:', 'blob:', 'kscode-fetch:', 'vscode-remote:', 'vscode-webview:'].includes(url.protocol)
      || url.protocol === 'file:' && (under(fileURLToPath(url), sandbox) || under(fileURLToPath(url), editor) || workspace && under(fileURLToPath(url), workspace));
    if (!allowed) return Promise.reject(new Error('Authentic editor isolation blocks network fetch'));
    return nativeFetch(input, options);
  };
  require('node:module').syncBuiltinESMExports();
  return { async dispose() {
    market.dispose();
    await Promise.all([...children].map(child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      let timer;
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
      timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2500);
    })));
  } };
};
