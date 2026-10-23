import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createM0Api} from './m0-api.mjs';
import {createModelConfig,modelCompletion} from './model.mjs';
import {createFiles} from './files.mjs';
import {createChatService} from './chat.mjs';
import {handleSkills} from './skills.mjs';
import {createPreview} from './preview.mjs';
import {createCanvasService} from './canvas.mjs';
import {createFigmaBridge} from './figma-bridge.mjs';
import {createFigmaWorkspace} from './figma-workspace.mjs';
import {createCanvasCollaboration} from './canvas-collaboration.mjs';
import {renderPrototype,PROTOTYPE_CSP} from './design-prototype.mjs';
import {createDesignCloud} from './design-cloud.mjs';
import {workflowPage} from './workflow-page.mjs';
import {settingsPage,editorPage,projectsPage,assetsSidebarPage} from './pages.mjs';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const projectVersion=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const port=Number(process.env.M0_LOCAL_PORT||4317);
const dataDir=path.resolve(process.env.M0_LOCAL_DATA_DIR||path.join(root,'.local-data'));
const workspaceRoot=path.resolve(process.env.M0_LOCAL_WORKSPACE||path.join(root,'workspace'));
fs.mkdirSync(dataDir,{recursive:true,mode:0o700});fs.mkdirSync(workspaceRoot,{recursive:true});
const model=createModelConfig(dataDir);
let api,figmaBridge,figmaWorkspace;
const workspaceFiles=()=>createFiles(api?.state.workspace||workspaceRoot,{trashDir:path.join(dataDir,'trash')});
const files=Object.fromEntries(['list','read','write','mkdir','rename','remove','restore','importProject','exportProject'].map(method=>[method,(...args)=>workspaceFiles()[method](...args)]));
const chat=createChatService({getModelConfig:model.get,files,getWorkspace:()=>api?.state.workspace||workspaceRoot,dataDir,getFigmaIntegration:()=>({bridge:figmaBridge,workspaceService:figmaWorkspace})});
api=createM0Api({dataDir,workspaceRoot,port,getModelConfig:model.get,chatHandler:(req,res,url,body,context)=>chat.handle({req,res,url,body,api:context.api})});
const preview=createPreview({getWorkspace:()=>api?.state.workspace||workspaceRoot});
const canvas=createCanvasService({api,getWorkspace:()=>api.state.workspace||workspaceRoot});
figmaBridge=createFigmaBridge({dataDir,port,resolveProject:projectId=>api.findProject(projectId)});
figmaWorkspace=createFigmaWorkspace({api,canvas,bridge:figmaBridge,port,dataDir});
const collaboration=createCanvasCollaboration({dataDir,resolveWorkspace:canvas.target,readCanvas:canvas.read,transactCanvas:canvas.transact,subscribeCanvas:canvas.subscribe,staticDir:path.join(root,'public/local-canvas')});
const designCloud=createDesignCloud({dataDir,resolveWorkspace:canvas.target,readCanvas:canvas.read,saveCanvas:canvas.save});
const diagnostics={startedAt:new Date().toISOString(),clientErrors:[],unhandled:[],requests:[]};
const events=new Set();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.wasm':'application/wasm','.ico':'image/x-icon'};
function json(res,data,status=200){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
function html(res,text){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(text);}
async function bodyOf(req){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>5*1024*1024)throw Object.assign(new Error('请求过大'),{status:413});chunks.push(chunk);}if(!bytes)return{};return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
const app=http.createServer(async(req,res)=>{
  try {
    const host=req.headers.host||'';
    if(!['127.0.0.1','localhost','[::1]'].includes(host.replace(/:\d+$/,'')))return json(res,{error:'Only local hostnames are supported'},403);
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    // A Figma plugin UI has an opaque Origin. Only the paired bridge routes
    // handle that origin, before the main application rejects cross-site use.
    if(await figmaBridge.handle(req,res,url))return;
    if(await preview(req,res,url))return;
    if(req.headers.origin && req.headers.origin!==`http://${host}`)return json(res,{error:'Cross-origin requests are disabled'},403);
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    // Recovered assets can run scripts, but their original remote service endpoints stay disconnected.
    res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:"+port+" ws://localhost:"+port+"; frame-src 'self' blob:; object-src 'none'");
    const body=['POST','PUT','PATCH','DELETE'].includes(req.method)?await bodyOf(req):{};
    diagnostics.requests.push({method:req.method,path:url.pathname});if(diagnostics.requests.length>200)diagnostics.requests.shift();
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    if(url.pathname==='/__local/health')return json(res,{ok:true,m0Local:true,version:projectVersion,mode:model.get().mode});
    if(url.pathname==='/__local/diagnostics')return json(res,diagnostics);
    if(url.pathname==='/__local/client-error'){diagnostics.clientErrors.push({message:String(body.message||'').slice(0,1500),stack:String(body.stack||'').slice(0,5000),url:String(body.url||'').slice(0,600)});return json(res,{ok:true});}
    if(url.pathname==='/__local/settings')return html(res,settingsPage());
    if(url.pathname==='/__local/figma/workspace'){
      if(!['GET','PUT'].includes(req.method))return json(res,{error:'Method not allowed'},405);
      return json(res,req.method==='GET'?await figmaWorkspace.get(url.searchParams.get('projectId')):await figmaWorkspace.set(url.searchParams.get('projectId'),body));
    }
    if(url.pathname==='/__local/figma/metadata'){
      if(req.method!=='GET')return json(res,{error:'Method not allowed'},405);
      return json(res,await figmaWorkspace.metadata(url.searchParams.get('projectId')));
    }
    if(url.pathname==='/__local/figma/generate'){
      if(req.method!=='POST')return json(res,{error:'Method not allowed'},405);
      const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort();});
      return json(res,await figmaWorkspace.generate(url.searchParams.get('projectId'),body,abort.signal));
    }
    if(url.pathname==='/__local/editor')return html(res,editorPage(url.searchParams.get('embedded')==='1'));
    if(url.pathname==='/__local/projects')return html(res,projectsPage());
    if(url.pathname==='/__local/workflow')return html(res,workflowPage());
    if(url.pathname==='/__local/workflow-client.js'){
      res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});
      return res.end(await fsp.readFile(path.join(root,'server/workflow-client.js'),'utf8'));
    }
    if(url.pathname==='/__local/workflow/runs'){
      if(req.method!=='GET')return json(res,{error:'Method not allowed'},405);
      const service=await chat.getWorkflow();
      const projectId=url.searchParams.get('projectId');
      let workspace;
      if(projectId){const project=api.findProject(projectId);if(!project)return json(res,{error:'项目不存在'},404);workspace=await fsp.realpath(project.projectPath);}
      const runs=await service.listRuns({sessionId:url.searchParams.get('sessionId')||undefined,workspace,limit:50});
      return json(res,{runs});
    }
    if(url.pathname.startsWith('/__local/workflow/runs/')){
      if(req.method!=='GET')return json(res,{error:'Method not allowed'},405);
      const record=await(await chat.getWorkflow()).getRun(decodeURIComponent(url.pathname.slice('/__local/workflow/runs/'.length)));
      return record?json(res,record):json(res,{error:'运行记录不存在'},404);
    }
    if(url.pathname==='/__local/workflow/run'){
      if(req.method!=='POST')return json(res,{error:'Method not allowed'},405);
      if(body.projectId&&!api.findProject(body.projectId))return json(res,{error:'项目不存在'},404);
      return chat.handle({req,res,url,body:{...body,humanMessage:body.humanMessage||body.prompt,workflow:'multi'},api});
    }
    if(url.pathname==='/left-iframe.html')return html(res,assetsSidebarPage());
    if((url.pathname.startsWith('/__local/design-cloud/api/')||url.pathname==='/__local/design-preview')&&url.searchParams.has('workspaceKey')){
      const context=await canvas.target(url.searchParams.get('projectId'));
      if(url.searchParams.get('workspaceKey')!==createHash('sha256').update(context.workspace).digest('hex'))return json(res,{error:'当前工作区已切换，请先导出未保存设计，再重新打开画布'},409);
    }
    if(await designCloud.handle(req,res,url,body))return;
    if(url.pathname==='/__local/design-preview'){
      if(req.method!=='GET')return json(res,{error:'Method not allowed'},405);
      const current=await canvas.read(await canvas.target(url.searchParams.get('projectId')));
      if(!current.document)return json(res,{error:'请先保存设计画布'},404);
      res.setHeader('Content-Security-Policy',PROTOTYPE_CSP);
      if(url.searchParams.get('download')==='1')res.setHeader('Content-Disposition','attachment; filename="m0-design-prototype.html"');
      return html(res,renderPrototype(current.document,{startId:url.searchParams.get('startId')}));
    }
    if(await collaboration.handle(req,res,url,body))return;
    if(await canvas.handle(req,res,url,body))return;
    if(url.pathname==='/__local/model'){
      if(!['GET','PUT'].includes(req.method))return json(res,{error:'Method not allowed'},405);
      return json(res,req.method==='GET'?model.public():model.set(body));
    }
    if(url.pathname==='/__local/models')return json(res,await api.publicConfig());
    if(url.pathname==='/__local/model/test'){
      if(req.method!=='POST')return json(res,{error:'Method not allowed'},405);
      if(model.get().mode==='demo')return json(res,{ok:true,message:'当前为界面演示模式，没有进行模型推理。'});
      const message=await modelCompletion(model.get(),[{role:'user',content:'只回复：连接成功'}]);
      return json(res,{ok:true,message:message.content});
    }
    if(url.pathname==='/__local/files'){
      if(req.method!=='GET')return json(res,{error:'Method not allowed'},405);
      return json(res,await files.list(url.searchParams.get('path')||'.'));
    }
    if(url.pathname==='/__local/file'){
      if(!['GET','PUT','DELETE'].includes(req.method))return json(res,{error:'Method not allowed'},405);
      return json(res,req.method==='GET'?await files.read(url.searchParams.get('path')):req.method==='DELETE'?await files.remove(url.searchParams.get('path')):await files.write(body.path,body.content));
    }
    if(url.pathname==='/__local/directory'){
      if(req.method!=='POST')return json(res,{error:'Method not allowed'},405);
      return json(res,await files.mkdir(body.path));
    }
    if(url.pathname==='/__local/file/rename'){
      if(req.method!=='POST')return json(res,{error:'Method not allowed'},405);
      return json(res,await files.rename(body.path,body.newPath));
    }
    if(url.pathname==='/__local/file/restore'){
      if(req.method!=='POST')return json(res,{error:'Method not allowed'},405);
      return json(res,await files.restore(body.trashId));
    }
    if(url.pathname==='/__local/project/export'){
      if(req.method!=='GET')return json(res,{error:'Method not allowed'},405);
      res.setHeader('Content-Disposition','attachment; filename="m0-local-project.json"');
      return json(res,await files.exportProject());
    }
    if(url.pathname==='/__local/project/import'){
      if(req.method!=='POST')return json(res,{error:'Method not allowed'},405);
      return json(res,await files.importProject(body.files));
    }
    if(url.pathname==='/__local/generate/krn'||url.pathname==='/__local/generate/theme'){
      if(req.method!=='POST')return json(res,{error:'Method not allowed'},405);
      const generators=await import('../plugins/local-generators.mjs');
      return json(res,url.pathname.endsWith('/krn')?await generators.generateKrn(body.schema):await generators.generateTheme(body.theme));
    }
    if(url.pathname==='/__local/rpc'){
      if(req.method!=='POST')return json(res,{error:'Method not allowed'},405);
      return json(res,await api.rpc(String(body.namespace||'').replace(/API$/,''),body.method,body.args||[]));
    }
    if(url.pathname==='/__local/chat'){
      if(req.method!=='POST')return json(res,{error:'Method not allowed'},405);
      return chat.handle({req,res,url,body,api});
    }
    if(url.pathname==='/__local/opencode/global/event'||url.pathname==='/__local/opencode/event'||url.pathname==='/global/event'){
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});res.write('data: {"type":"server.connected","properties":{}}\n\n');events.add(res);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clearInterval(heartbeat);events.delete(res);});return;
    }
    if(await handleSkills(req,res,url))return;
    if(await api.handle(req,res,url,body))return;
    let relative=decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if(!relative||relative==='home'||relative.startsWith('home/')||relative==='index.html')relative='index.html';
    const publicDir=path.join(root,'public'),file=path.resolve(publicDir,relative);
    if(!file.startsWith(publicDir+path.sep))return json(res,{error:'Invalid resource path'},403);
    if(fs.existsSync(file)&&fs.statSync(file).isFile()){
      res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-cache'});return fs.createReadStream(file).pipe(res);
    }
    if(!path.extname(url.pathname)&&!url.pathname.startsWith('/api')&&!url.pathname.startsWith('/rest')&&!url.pathname.startsWith('/devops-api'))return html(res,await fsp.readFile(path.join(publicDir,'index.html'),'utf8'));
    diagnostics.unhandled.push({method:req.method,path:url.pathname});return json(res,{error:'本地版本尚未实现此接口',path:url.pathname},404);
  }catch(error){if(!res.headersSent)json(res,{error:error.message},error.status||400);else res.end();}
});
app.on('upgrade',(req,socket)=>{
  const allowedOrigins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
  if(req.url!=='/'||req.headers['sec-websocket-version']!=='13'||!allowedOrigins.includes(req.headers.origin))return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  const key=req.headers['sec-websocket-key'];
  if(typeof key!=='string'||Buffer.from(key,'base64').length!==16)return socket.destroy();
  const accept=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  // The recovered web UI uses this socket only to detect the local CLI. Chat uses HTTP SSE.
  let buffer=Buffer.alloc(0);
  socket.on('data',data=>{
    buffer=Buffer.concat([buffer,data]);
    if(buffer.length>1024*1024)return socket.destroy();
    while(buffer.length>=2){
      const opcode=buffer[0]&15,masked=Boolean(buffer[1]&128);let length=buffer[1]&127,offset=2;
      if(length===127)return socket.destroy();
      if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);offset=4;}
      const header=offset+(masked?4:0);if(buffer.length<header+length)return;
      const mask=masked?buffer.subarray(offset,offset+4):null,payload=Buffer.from(buffer.subarray(header,header+length));
      if(mask)for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
      buffer=buffer.subarray(header+length);
      if(opcode===8){socket.end(Buffer.from([0x88,0]));return;}
      if(opcode===9&&payload.length<126)socket.write(Buffer.concat([Buffer.from([0x8a,payload.length]),payload]));
    }
  });
  socket.on('error',()=>{});
});
app.on('error',error=>{console.error(error.message);process.exitCode=1;});
app.listen(port,'127.0.0.1',()=>console.log(`M0 Local: http://127.0.0.1:${port}/home\nSettings: http://127.0.0.1:${port}/__local/settings\nData: ${dataDir}`));
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;for(const response of events)response.end();figmaBridge.close();await collaboration.close();app.close(()=>process.exit(0));}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
export {app,api,model,chat};
