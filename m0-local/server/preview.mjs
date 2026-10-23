import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
const under=(file,root)=>file===root||file.startsWith(root+path.sep);
const notice='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:14px/1.8 -apple-system,sans-serif;color:#767584;background:#fafafe;display:grid;place-content:center;min-height:80vh;padding:32px}h2{font-size:20px;color:#454250}</style><h2>这个项目还没有 HTML 预览入口</h2><p>在项目根目录保存 index.html，或将网页构建到 dist/index.html 后刷新预览。</p><p>这里可以预览本地 HTML、CSS 和浏览器 JavaScript。React Native 的 App.tsx 需要相应运行环境。</p></html>';

export function createPreview({getWorkspace}){
  const sessions=new Map();
  return async function handlePreview(req,res,url){
    if(url.pathname!=='/__local/preview'&&!url.pathname.startsWith('/__local/preview/'))return false;
    const json=(message,status)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:message}));return true;};
    if(!['GET','HEAD'].includes(req.method))return json('Preview is read-only',405);
    const origin=`http://${req.headers.host}`;
    const requestOrigin=req.headers.origin;
    if(requestOrigin&&requestOrigin!=='null'&&requestOrigin!==origin)return json('Cross-origin preview request refused',403);
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/__local/preview'||url.pathname==='/__local/preview/'){
      // Only the trusted workbench can mint a capability. The opaque preview
      // may read its captured project assets, but cannot call the app's APIs.
      if(requestOrigin==='null')return json('Preview capability required',403);
      const workspace=await fs.realpath(getWorkspace());
      let directory=null;
      for(const relative of ['index.html','dist/index.html']){
        try {const file=await fs.realpath(path.join(workspace,relative));if(under(file,workspace)&&(await fs.stat(file)).isFile()){directory=path.dirname(file);break;}}catch{}
      }
      if(!directory){res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'");res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(req.method==='HEAD'?undefined:notice);return true;}
      const token=randomBytes(24).toString('hex');sessions.set(token,{directory,created:Date.now()});
      while(sessions.size>32)sessions.delete(sessions.keys().next().value);
      res.writeHead(302,{location:'/__local/preview/'+token+'/index.html'});res.end();return true;
    }
    const match=url.pathname.match(/^\/__local\/preview\/([a-f0-9]{48})\/(.*)$/);
    const session=match&&sessions.get(match[1]);
    if(!session||Date.now()-session.created>12*60*60*1000)return json('预览已过期，请刷新预览入口',404);
    let relative;
    try {relative=decodeURIComponent(match[2]||'index.html');}catch{return json('Invalid preview path',400);}
    if(relative.split(/[\\/]/).some(part=>part==='..'||part.startsWith('.')||part==='node_modules')||relative.includes('\0'))return json('Invalid preview path',403);
    try {
      const file=await fs.realpath(path.resolve(session.directory,relative));
      if(!under(file,session.directory))return json('Preview path escaped workspace',403);
      const stat=await fs.stat(file);
      if(!stat.isFile()||stat.size>10*1024*1024)return json('Preview supports files up to 10 MB',400);
      const type=types[path.extname(file).toLowerCase()];
      if(!type)return json('Unsupported preview file type',415);
      const prefix='/__local/preview/'+match[1]+'/';
      const source=origin+prefix;
      res.setHeader('Content-Security-Policy',`sandbox allow-scripts; default-src 'none'; script-src ${source} 'unsafe-inline' 'unsafe-eval'; style-src ${source} 'unsafe-inline'; img-src ${source} data: blob:; font-src ${source} data:; connect-src ${source}; frame-src 'none'; object-src 'none'; base-uri ${source}; form-action 'none'`);
      res.setHeader('Access-Control-Allow-Origin','null');
      res.setHeader('Cross-Origin-Resource-Policy','cross-origin');
      let content=await fs.readFile(file);
      if(path.extname(file)==='.html')content=Buffer.from(content.toString('utf8').replace(/\b(src|href)=(['"])\/(?!\/)/gi,`$1=$2${prefix}`));
      else if(path.extname(file)==='.css')content=Buffer.from(content.toString('utf8').replace(/url\(\s*(['"]?)\/(?!\/)/gi,`url($1${prefix}`));
      res.writeHead(200,{'content-type':type});res.end(req.method==='HEAD'?undefined:content);return true;
    }catch(error){return json(error.code==='ENOENT'?'Preview file not found':error.message,error.code==='ENOENT'?404:400);}
  };
}
