import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createFigmaOAuthMiddleware} from '../../../网页端/workbench/server/figma-oauth.mjs';
import {readFigmaOAuthConfig} from '../../../网页端/workbench/server/figma-oauth-config.mjs';
const require=createRequire(import.meta.url);
const {isOAuthStartURL,isOAuthWindowURL,isOfficialOAuthURL,createOAuthWindow}=require('../../../客户端/workbench/desktop/figma-oauth-window.cjs');
const cookie=response=>response.headers.getSetCookie().find(value=>value.startsWith('design_studio_figma_session'))?.split(';')[0];

async function service(t,directory,namespace){
  let middleware;const server=http.createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const options={clientId:'fixture-client-'+namespace,clientSecret:'fixture-secret-'+namespace,redirectUri:origin+'/api/auth/figma/callback',cookieNamespace:namespace,dataDirectory:path.join(directory,namespace),allowedOrigin:origin};
  middleware=createFigmaOAuthMiddleware(options);
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return {origin,options,recreate:()=>{middleware=createFigmaOAuthMiddleware(options);}};
}

test('separate app instances keep OAuth handoffs, cookies and encrypted state isolated',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-oauth-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const desktop=await service(t,directory,'desktop'),web=await service(t,directory,'web');
  const original=globalThis.fetch,upstream=[];
  globalThis.fetch=async(input,options)=>{
    const url=new URL(String(input));if(url.hostname!=='api.figma.com')return original(input,options);
    upstream.push({path:url.pathname,method:options?.method||'GET'});
    if(url.pathname==='/v1/oauth/token')return Response.json({access_token:'fixture-access-only',refresh_token:'fixture-refresh-only',expires_in:3600});
    if(url.pathname==='/v1/me')return Response.json({id:'fixture-user',handle:'Astrix Fixture',email:'fixture@example.test',img_url:''});
    if(url.pathname==='/v1/files/FixtureFile123/meta')return Response.json({file:{name:'Readonly fixture',last_touched_at:'2026-10-25T00:00:00Z',editorType:'figma'}});
    throw Error('Unexpected upstream call');
  };
  t.after(()=>{globalThis.fetch=original;});
  const start=await fetch(desktop.origin+'/api/auth/figma/start?handoff=1&returnTo=/figma-oauth-complete.html');
  const claim=start.headers.getSetCookie()[0].split(';')[0];
  assert.match(claim,/^design_studio_figma_handoff_desktop=/);
  assert.match(start.headers.getSetCookie()[0],/HttpOnly/);
  const html=await start.text(),match=/link.href = ("[^\n]+");/.exec(html);
  const authorize=new URL(JSON.parse(match[1]));
  assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');
  assert.equal(authorize.searchParams.get('scope'),'current_user:read file_content:read file_metadata:read');
  assert.doesNotMatch(authorize.href,/handoff|fixture-secret|fixture-access/);
  const callback='?code=fixture-code&state='+authorize.searchParams.get('state');
  const wrong=await fetch(web.origin+'/api/auth/figma/callback'+callback,{redirect:'manual'});
  assert.match(wrong.headers.get('location'),/invalid_state/);
  assert.equal(upstream.length,0,'another instance cannot consume a pending flow');
  const granted=await fetch(desktop.origin+'/api/auth/figma/callback'+callback,{redirect:'manual'});
  assert.match(granted.headers.get('location'),/figma_auth=connected/);
  assert.equal((await(await fetch(desktop.origin+'/api/auth/figma/session')).json()).authenticated,false);
  const handoff=await fetch(desktop.origin+'/api/auth/figma/handoff',{headers:{cookie:claim}});
  const session=cookie(handoff);
  assert.match(session,/^design_studio_figma_session_desktop=/);
  assert.match((await handoff.json()).redirect,/figma_auth=connected/);
  assert.equal((await fetch(desktop.origin+'/api/auth/figma/handoff',{headers:{cookie:claim}})).status,410);
  const connected=await(await fetch(desktop.origin+'/api/auth/figma/session',{headers:{cookie:session}})).json();
  assert.equal(connected.authenticated,true);assert.equal(connected.user.name,'Astrix Fixture');
  assert.doesNotMatch(JSON.stringify(connected),/fixture-access|fixture-refresh|fixture-secret/);
  assert.equal((await(await fetch(web.origin+'/api/auth/figma/session',{headers:{cookie:session}})).json()).authenticated,false);
  assert.equal((await(await fetch(web.origin+'/api/auth/figma/session',{headers:{cookie:session.replace('_desktop=','_web=')}})).json()).authenticated,false);
  const metadata=await(await fetch(desktop.origin+'/api/auth/figma/file-metadata?keys=FixtureFile123',{headers:{cookie:session}})).json();
  assert.equal(metadata.files[0].name,'Readonly fixture');
  const encrypted=await fs.readFile(path.join(directory,'desktop/figma-oauth-sessions.enc'),'utf8');
  assert.doesNotMatch(encrypted,/fixture-access|fixture-refresh|Astrix Fixture/);
  assert.equal((await fs.stat(path.join(directory,'desktop/figma-oauth-sessions.enc'))).mode&0o777,0o600);
  desktop.recreate();
  assert.equal((await(await fetch(desktop.origin+'/api/auth/figma/session',{headers:{cookie:session}})).json()).authenticated,true);
  const badOrigin=await fetch(desktop.origin+'/api/auth/figma/session',{headers:{origin:'https://hostile.example',cookie:session}});
  assert.equal(badOrigin.status,403);
  const revoked=await fetch(desktop.origin+'/api/auth/figma/session',{method:'DELETE',headers:{origin:'https://hostile.example',cookie:session}});
  assert.equal(revoked.status,403);
  assert.ok(upstream.every(request=>request.method==='GET'||request.path==='/v1/oauth/token'),'no Figma document writes are performed');
});

test('backend env loading preserves model configuration and rejects a callback belonging to the other surface',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-oauth-config-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const content='FIGMA_OAUTH_CLIENT_ID=fixture-client\nFIGMA_OAUTH_CLIENT_SECRET=fixture-secret\nFIGMA_OAUTH_REDIRECT_URI=http://127.0.0.1:4317/api/auth/figma/callback\nAGENT_MODEL=keep-current\n';
  await fs.writeFile(path.join(directory,'.env.local'),content);
  const options=readFigmaOAuthConfig({applicationRoot:directory,port:4317,environment:{}});
  assert.equal(options.clientId,'fixture-client');assert.equal(options.redirectUri,'http://127.0.0.1:4317/api/auth/figma/callback');
  assert.equal(options.AGENT_MODEL,undefined);assert.equal(await fs.readFile(path.join(directory,'.env.local'),'utf8'),content);
  assert.throws(()=>readFigmaOAuthConfig({applicationRoot:directory,port:5273,environment:{}}),/回调地址/);
});

test('Figma err diagnostics preserve permission status while expired authorization stays private',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-oauth-errors-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const server=await service(t,directory,'diagnostic'),original=globalThis.fetch;
  let upstreamStatus=403,refreshes=0;
  const permissionMessage='Application access is restricted for this file.';
  globalThis.fetch=async(input,options)=>{
    const url=new URL(String(input));if(url.hostname!=='api.figma.com')return original(input,options);
    if(url.pathname==='/v1/oauth/token'){
      return Response.json({access_token:'fixture-sensitive-access',refresh_token:'fixture-sensitive-refresh',expires_in:3600});
    }
    if(url.pathname==='/v1/oauth/refresh'){refreshes++;return Response.json({err:'fixture-sensitive-refresh-error'},{status:400});}
    if(url.pathname==='/v1/me')return Response.json({id:'diagnostic-fixture',handle:'Diagnostic Fixture',email:'fixture@example.test',img_url:''});
    if(url.pathname.startsWith('/v1/files/DeniedFile123'))return Response.json({status:upstreamStatus,err:upstreamStatus===403?permissionMessage:'fixture-sensitive-access expired',access_token:'fixture-sensitive-access'},{status:upstreamStatus});
    throw Error('Unexpected upstream request');
  };
  t.after(()=>{globalThis.fetch=original;});
  const start=await fetch(server.origin+'/api/auth/figma/start?direct=1',{redirect:'manual'}),authorize=new URL(start.headers.get('location'));
  const granted=await fetch(server.origin+'/api/auth/figma/callback?code=fixture-code&state='+authorize.searchParams.get('state'),{redirect:'manual'}),session=cookie(granted);
  assert.ok(session);
  const denied=await fetch(server.origin+'/api/auth/figma/files/DeniedFile123?depth=1',{headers:{cookie:session}}),deniedBody=await denied.json();
  assert.equal(denied.status,403);assert.equal(deniedBody.error,'FIGMA_ACCESS_DENIED');assert.equal(deniedBody.message,permissionMessage);assert.equal(refreshes,0);
  const metadata=await fetch(server.origin+'/api/auth/figma/file-metadata?keys=DeniedFile123',{headers:{cookie:session}}),metadataBody=await metadata.json();
  assert.equal(metadata.status,207);assert.equal(metadataBody.errors[0].status,403);assert.equal(metadataBody.errors[0].message,permissionMessage);
  assert.equal((await(await fetch(server.origin+'/api/auth/figma/session',{headers:{cookie:session}})).json()).authenticated,true,'a file permission denial does not discard account authorization');
  upstreamStatus=401;
  const expired=await fetch(server.origin+'/api/auth/figma/files/DeniedFile123?depth=1',{headers:{cookie:session}}),expiredBody=await expired.json();
  assert.equal(expired.status,401);assert.equal(expiredBody.error,'FIGMA_SESSION_EXPIRED');assert.equal(refreshes,1);assert.match(expired.headers.get('set-cookie'),/Max-Age=0/);
  assert.doesNotMatch(JSON.stringify([deniedBody,metadataBody,expiredBody]),/fixture-sensitive|access_token|refresh_token|clientSecret/);
  const disconnected=await(await fetch(server.origin+'/api/auth/figma/session',{headers:{cookie:session}})).json();assert.equal(disconnected.authenticated,false);assert.equal(disconnected.user,null);
});

test('concurrent invalid-token reads use one official refresh request and retry with the replacement authorization',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-oauth-refresh-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const server=await service(t,directory,'refresh'),original=globalThis.fetch;
  let refreshes=0,oldReads=0,newReads=0,releaseRefresh;
  const refreshing=new Promise(resolve=>{releaseRefresh=resolve;});
  globalThis.fetch=async(input,options)=>{
    const url=new URL(String(input));if(url.hostname!=='api.figma.com')return original(input,options);
    if(url.pathname==='/v1/oauth/token'){
      assert.equal(new URLSearchParams(options.body).get('grant_type'),'authorization_code');
      return Response.json({access_token:'fixture-old-access',refresh_token:'fixture-stable-refresh',expires_in:3600});
    }
    if(url.pathname==='/v1/me')return Response.json({id:'refresh-fixture',handle:'Refresh Fixture',email:'fixture@example.test',img_url:''});
    if(url.pathname==='/v1/oauth/refresh'){
      refreshes++;
      assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Basic '+Buffer.from('fixture-client-refresh:fixture-secret-refresh').toString('base64'));
      assert.equal(options.headers['Content-Type'],'application/x-www-form-urlencoded');
      assert.deepEqual([...new URLSearchParams(options.body).entries()],[['refresh_token','fixture-stable-refresh']]);
      await refreshing;
      // Figma may omit refresh_token; the original one must remain available.
      return Response.json({access_token:'fixture-new-access',expires_in:3600});
    }
    if(url.pathname==='/v1/files/RefreshFile123'){
      if(options.headers.Authorization==='Bearer fixture-old-access'){oldReads++;return Response.json({status:403,err:'Invalid token'},{status:403});}
      assert.equal(options.headers.Authorization,'Bearer fixture-new-access');newReads++;
      return Response.json({name:'Readonly refresh fixture',document:{id:'0:0',type:'DOCUMENT',children:[]}});
    }
    throw Error('Unexpected upstream request');
  };
  t.after(()=>{globalThis.fetch=original;});
  const start=await fetch(server.origin+'/api/auth/figma/start?direct=1',{redirect:'manual'}),authorize=new URL(start.headers.get('location'));
  const granted=await fetch(server.origin+'/api/auth/figma/callback?code=fixture-code&state='+authorize.searchParams.get('state'),{redirect:'manual'}),session=cookie(granted);
  const route=server.origin+'/api/auth/figma/files/RefreshFile123?depth=1';
  const requests=[fetch(route,{headers:{cookie:session}}),fetch(route,{headers:{cookie:session}})];
  for(let count=0;count<100&&oldReads<2;count++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(oldReads,2);assert.equal(refreshes,1);releaseRefresh();
  const results=await Promise.all(requests);for(const response of results){assert.equal(response.status,200);assert.equal((await response.json()).name,'Readonly refresh fixture');}
  assert.equal(refreshes,1);assert.equal(newReads,2);
  server.recreate();
  const restored=await fetch(route,{headers:{cookie:session}});assert.equal(restored.status,200);assert.equal(refreshes,1,'replacement authorization survives encrypted session restoration');
  assert.equal((await(await fetch(server.origin+'/api/auth/figma/session',{headers:{cookie:session}})).json()).authenticated,true);
});

test('desktop OAuth popups allow only local handoff pages and official PKCE authorization for their own callback',()=>{
  const base='http://127.0.0.1:4317';
  const local=base+'/api/auth/figma/start?handoff=1&returnTo=%2Ffigma-oauth-complete.html';
  assert.equal(isOAuthStartURL(local,base),true);assert.equal(isOAuthWindowURL(base+'/figma-oauth-complete.html?figma_auth=connected',base),true);
  for(const value of [local.replace(':4317',':5273'),local.replace('127.0.0.1','localhost'),local.replace('handoff=1','handoff=0'),local.replace('%2Ffigma-oauth-complete.html','%2Fhome'),'https://www.figma.com/login'])assert.equal(isOAuthStartURL(value,base),false);
  const target=new URL('https://www.figma.com/oauth');target.search=new URLSearchParams({client_id:'fixture',redirect_uri:base+'/api/auth/figma/callback',response_type:'code',code_challenge_method:'S256',code_challenge:'fixture-challenge',state:'fixture-state'}).toString();
  assert.equal(isOfficialOAuthURL(target.href,base),true);
  for(const value of [target.href.replace('www.figma.com','figma.com.evil.test'),target.href.replace('https:','http:'),target.href.replace('S256','plain'),target.href.replace('4317','5273'),'https://www.figma.com/design/Fixture'])assert.equal(isOfficialOAuthURL(value,base),false);
});

test('desktop handoff uses the initiating workbench session and sends official authorization to the external browser',async()=>{
  const base='http://127.0.0.1:4317',partition={identity:'workbench-session'},opened=[];
  let options;
  class Window extends EventEmitter{
    constructor(value){super();options=value;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=handler=>this.popup=handler;this.closed=false;}
    async loadURL(url){this.loaded=url;}
    isDestroyed(){return this.closed;}
    close(){this.closed=true;this.emit('closed');}
  }
  const parent={webContents:{session:partition}};
  const window=createOAuthWindow({electron:{BrowserWindow:Window,shell:{openExternal:async url=>opened.push(url)},dialog:{showErrorBox:()=>assert.fail('unexpected error')}},mainWindow:parent,baseURL:base,url:base+'/api/auth/figma/start?handoff=1&returnTo=%2Ffigma-oauth-complete.html'});
  assert.equal(options.webPreferences.session,partition);assert.equal(options.parent,parent);assert.equal(options.webPreferences.preload,undefined);assert.equal(options.webPreferences.sandbox,true);assert.equal(options.webPreferences.nodeIntegration,false);
  const authorize=new URL('https://www.figma.com/oauth');authorize.search=new URLSearchParams({client_id:'fixture',redirect_uri:base+'/api/auth/figma/callback',response_type:'code',code_challenge_method:'S256',code_challenge:'fixture-challenge',state:'fixture-state'});
  assert.deepEqual(window.popup({url:authorize.href}),{action:'deny'});assert.deepEqual(opened,[authorize.href]);
  window.popup({url:'https://hostile.example/'});assert.equal(opened.length,1);
  let prevented=false;window.webContents.emit('will-navigate',{preventDefault:()=>{prevented=true;}},authorize.href);assert.equal(prevented,true);
  window.webContents.emit('did-navigate',{},base+'/figma-oauth-complete.html?figma_auth=access_denied');assert.equal(window.closed,false);
  window.webContents.emit('did-navigate',{},base+'/figma-oauth-complete.html?figma_auth=connected');assert.equal(window.closed,true);
});

test('the default desktop workbench serves real OAuth routes without configuring models or granting access',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-oauth-default-'));
  const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const repository=fileURLToPath(new URL('../../../',import.meta.url)),origin='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,[path.join(repository,'网页端/workbench/server/index.mjs')],{cwd:repository,env:{...process.env,ASTRIX_SURFACE:'desktop',ASTRIX_PORT:String(port),ASTRIX_DATA_DIR:path.join(directory,'data'),ASTRIX_WORKSPACE:path.join(directory,'workspace'),FIGMA_OAUTH_CLIENT_ID:'',FIGMA_OAUTH_CLIENT_SECRET:'',FIGMA_OAUTH_REDIRECT_URI:''},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}await fs.rm(directory,{recursive:true,force:true});});
  let ready=false;
  for(let count=0;count<100;count++){if(child.exitCode!==null)throw Error('Workbench stopped during startup');try{const response=await fetch(origin+'/__local/health');if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,30));}
  assert.equal(ready,true);
  const session=await fetch(origin+'/api/auth/figma/session');assert.equal(session.status,200);assert.deepEqual(await session.json(),{configured:false,authenticated:false,user:null});
  const model=await(await fetch(origin+'/__local/model')).json();assert.equal(model.mode,'demo');assert.equal(model.allowFigmaWriteTools,false);
  const metadata=await fetch(origin+'/api/auth/figma/file-metadata?keys=FixtureFile123');assert.equal(metadata.status,503);
  const ui=await(await fetch(origin+'/figma-workspace.html')).text();assert.match(ui,/id="connect-oauth"/);assert.match(ui,/id="oauth-status"/);
  const complete=await fetch(origin+'/figma-oauth-complete.html');assert.equal(complete.status,200);
  const rejected=await fetch(origin+'/api/auth/figma/session',{headers:{origin:'https://hostile.example'}});assert.equal(rejected.status,403);
});
