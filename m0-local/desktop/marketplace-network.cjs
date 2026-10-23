'use strict';
// Public Open VSX transport only. Capture the Node transport before the editor's
// general network guard is installed; raw sockets remain blocked to its callers.
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const nativeRequest = https.request;
const nativeSocketConnect = net.Socket.prototype.connect;
const nativeTLSConnect = tls.connect;
const nativeLookup = dns.lookup;
// Captured before extension code runs. A helper cannot enable this transport
// merely by importing the module and passing {enabled:true} itself.
const path = require('node:path');
const trustedHost = process.type === 'renderer' || path.resolve(process.argv[1] || '') === path.join(__dirname,'editor-server.cjs');

const gallery = Object.freeze({
  serviceUrl: 'https://open-vsx.org/vscode/gallery',
  itemUrl: 'https://open-vsx.org/vscode/item',
  resourceUrlTemplate: 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
  extensionUrlTemplate: 'https://open-vsx.org/vscode/gallery/{publisher}/{name}/latest',
});
function allows(value, method = 'GET') {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password) return false;
    method = method.toUpperCase();
    if (url.hostname === 'open-vsx.org') {
      if (['POST','OPTIONS'].includes(method)) return url.pathname === '/vscode/gallery/extensionquery';
      return ['GET', 'HEAD'].includes(method) && (/^\/vscode\/(gallery|asset|unpkg|item)(\/|$)/.test(url.pathname)
        || /^\/api\/(?:-\/(?:search|query|public-key)(\/|$)|[\w][\w.-]*(?:\/|$))/.test(url.pathname));
    }
    return ['GET', 'HEAD'].includes(method) && (url.hostname === 'openvsxorg.blob.core.windows.net' && url.pathname.startsWith('/resources/')
      || url.hostname === 'openvsx.eclipsecontent.org' && /^\/[\w.-]+\/[\w.-]+\//.test(url.pathname));
  } catch { return false; }
}
function normalizeRequest(args) {
  let options, callback, url;
  if (typeof args[0] === 'string' || args[0] instanceof URL) {
    url = new URL(args[0]);
    options = typeof args[1] === 'object' ? { ...args[1] } : {};
    callback = typeof args[1] === 'function' ? args[1] : args[2];
  } else {
    options = { ...args[0] }; callback = args[1];
    const host = options.hostname || options.host;
    url = new URL(`${options.protocol || 'https:'}//${host}${options.port ? ':' + options.port : ''}${options.path || '/'}`);
  }
  // A caller cannot validate one URL and then override its authority/path.
  if (options.hostname || options.host || options.path || options.port) {
    url = new URL(`${options.protocol || url.protocol}//${options.hostname || options.host || url.hostname}${options.port ? ':' + options.port : url.port ? ':' + url.port : ''}${options.path || url.pathname + url.search}`);
  }
  return { url, options, callback };
}
function create({ enabled = false, record = () => {} } = {}) {
  enabled = enabled && trustedHost;
  const agent = new https.Agent({ keepAlive: false });
  agent.createConnection = options => {
    const hostname = options.servername || options.hostname || options.host;
    if (!['open-vsx.org', 'openvsxorg.blob.core.windows.net', 'openvsx.eclipsecontent.org'].includes(hostname)) throw new Error('Open VSX transport rejected host');
    const socket = new net.Socket();
    const secured = nativeTLSConnect({ socket, servername: hostname, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] });
    nativeSocketConnect.call(socket, { host: hostname, port: 443, lookup: nativeLookup });
    return secured;
  };
  function request(...args) {
    const { url, options, callback } = normalizeRequest(args);
    const method = (options.method || 'GET').toUpperCase();
    if (!enabled || !allows(url, method)) throw new Error('Open VSX transport rejected URL or method');
    const headers = { ...options.headers };
    for (const key of Object.keys(headers)) if (/^(authorization|proxy-authorization|cookie)$/i.test(key)) delete headers[key];
    record(`market:request:${method}:${url.href}`);
    const req = nativeRequest(url, { ...options, protocol: 'https:', hostname: url.hostname, host: url.hostname,
      port: 443, path: url.pathname + url.search, method, headers, auth: undefined,
      agent, createConnection: undefined, rejectUnauthorized: true, lookup: nativeLookup,
    }, response => {
      record(`market:response:${response.statusCode}:${url.href}`);
      callback?.(response);
    });
    req.setTimeout(20000, () => req.destroy(new Error('Open VSX 请求超时；本地 VSIX 仍可使用')));
    req.once('error', error => record(`market:error:${error.message}`));
    return req;
  }
  async function fetchPublic(input, options = {}, redirects = 0) {
    const value = typeof input === 'string' || input instanceof URL ? input : input.url;
    const url = new URL(value);
    return new Promise((resolve, reject) => {
      const req = request(url, options, response => {
        if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          if (redirects >= 5) return reject(new Error('Open VSX 重定向次数过多'));
          return fetchPublic(new URL(response.headers.location, url), { ...options, method: response.statusCode === 303 ? 'GET' : options.method }, redirects + 1).then(resolve, reject);
        }
        const chunks=[];let length=0;
        response.on('data',chunk=>{length+=chunk.length;if(length>256*1024*1024)req.destroy(new Error('Open VSX 资源超过 256 MiB'));else chunks.push(chunk);});
        response.on('error',reject);
        response.on('end',()=>resolve(new Response([204,205,304].includes(response.statusCode)?null:Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
      });
      req.once('error',reject);
      if(options.signal){if(options.signal.aborted)req.destroy(new Error('Open VSX 请求已取消'));else options.signal.addEventListener('abort',()=>req.destroy(new Error('Open VSX 请求已取消')),{once:true});}
      if(options.body)req.write(options.body);req.end();
    });
  }
  return { enabled, request, fetch: fetchPublic, allows: (url,method) => enabled && allows(url,method), dispose: () => agent.destroy() };
}
module.exports = { gallery, allows, create };
