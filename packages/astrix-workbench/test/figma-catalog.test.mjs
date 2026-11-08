import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createFigmaOAuthMiddleware,figmaOAuthPlugin,getFigmaOAuthMiddlewareForServer} from '../../../网页端/workbench/server/figma-oauth.mjs';

async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-catalog-'));
  const original=globalThis.fetch,calls=[],statuses=new Map();let middleware,candidates=[],folderStatus=403;
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/open?')) {
      middleware.resolveCatalogFile(req,res,new URL(req.url,'http://local').searchParams.get('url')).then(value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));}).catch(error=>{res.statusCode=error.status||500;res.end(JSON.stringify({message:error.message}));});return;
    }
    middleware(req,res,()=>{res.statusCode=404;res.end();});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const options={clientId:'fixture-client',clientSecret:'fixture-secret',redirectUri:origin+'/api/auth/figma/callback',allowedOrigin:origin,cookieNamespace:'catalog',dataDirectory:directory,getCatalogCandidates:()=>candidates};
  middleware=createFigmaOAuthMiddleware(options);
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(String(input));if(url.hostname!=='api.figma.com')return original(input,init);
    const authorization=init.headers?.Authorization||'',account=authorization.replace('Bearer fixture-token-','');
    calls.push({path:url.pathname,account});
    if(url.pathname==='/v1/oauth/token')return Response.json({access_token:'fixture-token-'+new URLSearchParams(init.body).get('code'),refresh_token:'fixture-refresh',expires_in:3600});
    if(url.pathname==='/v1/oauth/refresh')return Response.json({err:'invalid fixture'},{status:400});
    if(url.pathname==='/v1/me')return Response.json({id:account,handle:'Account '+account,email:'private@example.test'});
    const key=/^\/v1\/files\/([^/]+)\/meta$/.exec(url.pathname)?.[1];
    if(key) {
      const status=statuses.get(key)||200;
      if(status!==200)return Response.json({err:status===401?'Invalid token':'private-fixture-diagnostic'},{status,headers:status===429?{'retry-after':'120'}:{}});
      return Response.json({file:{name:'Real '+key,thumbnail_url:'https://static.figma.com/fixture.png',last_touched_at:'2026-11-08T00:00:00Z',editorType:'figma',url:'https://hostile.example/do-not-use'}});
    }
    if(/\/(?:folders|projects|files)$/.test(url.pathname)) {
      const status=typeof folderStatus==='function'?folderStatus(url.pathname):folderStatus;
      if(status!==200)return Response.json({err:'private-fixture-diagnostic'},{status,headers:status===429?{'retry-after':'120'}:{}});
      if(url.pathname.includes('/teams/'))return Response.json(url.pathname.startsWith('/v1/')?{projects:[{id:'1234567890'}]}:{folders:[{id:'1234567890'}]});
      if(url.pathname.endsWith('/folders'))return Response.json({folders:[]});
      return Response.json({files:[{key:'TeamFile123',name:'unverified enumeration name'}]});
    }
    throw Error('Unexpected fixture URL '+url.pathname);
  };
  t.after(async()=>{globalThis.fetch=original;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const request=async(route,{cookie,body,method,headers={}}={})=>{
    const response=await original(origin+route,{method:method||(body?'POST':'GET'),redirect:'manual',headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    const text=await response.text();return {response,body:text?JSON.parse(text):null};
  };
  const login=async(account)=>{
    const start=await original(origin+'/api/auth/figma/start?direct=1',{redirect:'manual'}),state=new URL(start.headers.get('location')).searchParams.get('state');
    const granted=await original(origin+'/api/auth/figma/callback?code='+account+'&state='+state,{redirect:'manual'});
    return granted.headers.getSetCookie().find(value=>value.startsWith('design_studio_figma_session_catalog='))?.split(';')[0];
  };
  return {origin,directory,calls,statuses,request,login,setCandidates:value=>{candidates=value;},setFolderStatus:value=>{folderStatus=value;},recreate:()=>{middleware=createFigmaOAuthMiddleware(options);}};
}

test('catalog requires the actual OAuth cookie and never accepts cross-origin reads or writes',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/api/auth/figma/catalog')).response.status,401);
  const cookie=await f.login('A');
  assert.equal((await f.request('/api/auth/figma/catalog',{cookie,headers:{origin:'https://hostile.example'}})).response.status,403);
  for(const url of ['https://www.figma.com.evil.test/design/FileKey123','http://www.figma.com/design/FileKey123','https://name:password@www.figma.com/design/FileKey123','https://www.figma.com/files'])
    assert.equal((await f.request('/api/auth/figma/catalog/files',{cookie,body:{url}})).response.status,400);
  assert.equal(f.calls.filter(call=>call.path.includes('/files/')).length,0);
});

test('workspace candidates are reverified for this account, foreign accounts and cached names stay hidden',async t=>{
  const f=await fixture(t),cookie=await f.login('A');
  f.setCandidates([{url:'https://www.figma.com/design/LegacyFile123/old',projectId:5},{url:'https://www.figma.com/design/ScopedFile123',accountId:'A'},{url:'https://www.figma.com/design/ForeignFile123',accountId:'B',name:'foreign private title'}]);
  const result=await f.request('/api/auth/figma/catalog',{cookie});
  assert.equal(result.response.status,200);assert.equal(result.body.account.id,'A');assert.equal(result.body.files.length,2);
  assert.equal(result.body.files[0].name,'Real LegacyFile123');assert.equal(result.body.files[0].projectId,5);assert.equal(result.body.files[0].accountId,'A');
  assert.equal(result.body.files[0].url,'https://www.figma.com/design/LegacyFile123');
  assert.ok(!f.calls.some(call=>call.path.includes('ForeignFile')));
  assert.doesNotMatch(JSON.stringify(result.body),/private@example|fixture-token|fixture-secret|foreign private|hostile.example/);
  assert.equal(result.response.headers.get('cache-control'),'no-store');
});

test('saving a verified canonical URL persists per account and permission revocation never serves cached cards',async t=>{
  const f=await fixture(t),a=await f.login('A');
  const saved=await f.request('/api/auth/figma/catalog/files',{cookie:a,body:{url:'https://www.figma.com/design/SavedFile123/old?node-id=1-2&tracking=private#x'}});
  assert.equal(saved.response.status,201);assert.equal(saved.body.file.url,'https://www.figma.com/design/SavedFile123?node-id=1-2');
  f.setCandidates([{url:'https://www.figma.com/design/SavedFile123?node-id=9-9',projectId:7}]);
  f.recreate();const restored=await f.request('/api/auth/figma/catalog',{cookie:a});assert.equal(restored.body.files[0].name,'Real SavedFile123');assert.match(restored.body.files[0].url,/node-id=1-2/);assert.equal(restored.body.files[0].projectId,7);
  const clicked=await f.request('/open?url='+encodeURIComponent(restored.body.files[0].url),{cookie:a});assert.equal(clicked.body.file.url,'https://www.figma.com/design/SavedFile123?node-id=1-2');
  f.setCandidates([]);
  const b=await f.login('B');assert.deepEqual((await f.request('/api/auth/figma/catalog',{cookie:b})).body.files,[]);
  f.statuses.set('SavedFile123',403);const denied=await f.request('/api/auth/figma/catalog',{cookie:a});assert.equal(denied.response.status,207);assert.deepEqual(denied.body.files,[]);assert.equal(denied.body.errors[0].status,403);
  assert.doesNotMatch(JSON.stringify(denied.body),/private-fixture/);
  const folder=path.join(f.directory,'figma-catalog'),files=await fs.readdir(folder);assert.equal(files.length,1);assert.equal((await fs.stat(path.join(folder,files[0]))).mode&0o777,0o600);
  assert.doesNotMatch(await fs.readFile(path.join(folder,files[0]),'utf8'),/Real Saved|fixture-token|fixture-secret|private@example/);
});

test('403/404 additions are not saved; rate limits stop further requests and expose explicit partial status',async t=>{
  const f=await fixture(t),cookie=await f.login('A');
  for(const status of [403,404]){f.statuses.set('DeniedFile123',status);assert.equal((await f.request('/api/auth/figma/catalog/files',{cookie,body:{url:'https://www.figma.com/design/DeniedFile123'}})).response.status,status);}
  f.setCandidates([{url:'https://www.figma.com/design/GoodFile123'},{url:'https://www.figma.com/design/RateFile123'},{url:'https://www.figma.com/design/SkippedFile123'}]);f.statuses.set('RateFile123',429);
  const value=await f.request('/api/auth/figma/catalog',{cookie});assert.equal(value.response.status,207);assert.equal(value.body.partial,true);assert.equal(value.body.files.length,1);assert.equal(value.body.errors[0].status,429);assert.equal(value.body.errors[0].retryAfterSeconds,120);assert.equal(value.response.headers.get('retry-after'),'120');
  assert.ok(!f.calls.some(call=>call.path.includes('SkippedFile')));
  const count=f.calls.length;await f.request('/api/auth/figma/catalog',{cookie});assert.equal(f.calls.length,count,'Retry-After blocks upstream calls in this account');
});

test('401 clears the session instead of returning partial cards; click resolver freshly verifies permission',async t=>{
  const f=await fixture(t),cookie=await f.login('A');
  const opened=await f.request('/open?url='+encodeURIComponent('https://www.figma.com/design/OpenFile123'),{cookie});assert.equal(opened.response.status,200);assert.equal(opened.body.accountId,'A');
  f.statuses.set('OpenFile123',403);assert.equal((await f.request('/open?url='+encodeURIComponent('https://www.figma.com/design/OpenFile123'),{cookie})).response.status,403);
  f.statuses.set('OpenFile123',401);const expired=await f.request('/api/auth/figma/catalog',{cookie});assert.equal(expired.response.status,401);assert.match(expired.response.headers.get('set-cookie'),/Max-Age=0/);assert.ok(!expired.body.files);
  assert.equal((await f.request('/api/auth/figma/session',{cookie})).body.authenticated,false);
});

test('team sources are account scoped and opt-in; missing list scope is explicit and does not change authorization',async t=>{
  const f=await fixture(t),cookie=await f.login('A');
  const added=await f.request('/api/auth/figma/catalog/sources',{cookie,body:{url:'https://www.figma.com/files/123456/team/9876543210/Workspace'}});assert.equal(added.response.status,201);
  const before=f.calls.length;const local=await f.request('/api/auth/figma/catalog',{cookie});assert.equal(f.calls.length,before);assert.equal(local.body.team.configured,true);
  const denied=await f.request('/api/auth/figma/catalog?team=1',{cookie});assert.equal(denied.response.status,207);assert.equal(denied.body.errors[0].action,'reauthorize-library');assert.match(denied.body.errors[0].message,/folders:read/);assert.deepEqual(denied.body.files,[]);
  f.setFolderStatus(200);const listed=await f.request('/api/auth/figma/catalog?team=1',{cookie});assert.equal(listed.body.files[0].name,'Real TeamFile123');assert.equal(listed.body.files[0].source,'team');
  const b=await f.login('B');assert.deepEqual((await f.request('/api/auth/figma/catalog',{cookie:b})).body.sources,[]);
});

test('Vite and preview register distinct existing OAuth handlers without creating new sessions',()=>{
  const options={clientId:'fixture',clientSecret:'fixture',redirectUri:'http://127.0.0.1:4317/api/auth/figma/callback',dataDirectory:path.join(os.tmpdir(),'nonexistent-astrix-catalog-fixture-'+process.pid+'-'+Date.now())};
  const plugin=figmaOAuthPlugin(options),server={httpServer:{},middlewares:{use(value){this.handler=value;}}};plugin.configureServer(server);
  assert.equal(getFigmaOAuthMiddlewareForServer(server.httpServer),server.middlewares.handler);assert.equal(typeof server.middlewares.handler.setCatalogCandidates,'function');
  const preview={httpServer:{},middlewares:{use(value){this.handler=value;}}};figmaOAuthPlugin(options).configurePreviewServer(preview);
  assert.equal(getFigmaOAuthMiddlewareForServer(preview.httpServer),preview.middlewares.handler);
  assert.notEqual(getFigmaOAuthMiddlewareForServer(server.httpServer),getFigmaOAuthMiddlewareForServer(preview.httpServer));
  assert.equal(getFigmaOAuthMiddlewareForServer({}),null);
});

test('legacy project scope fallback remains explicit and source throttling stops file verification',async t=>{
  const f=await fixture(t),cookie=await f.login('A');
  await f.request('/api/auth/figma/catalog/sources',{cookie,body:{url:'https://www.figma.com/files/team/9876543210'}});
  f.setFolderStatus(path=>path.startsWith('/v2/')?403:200);
  const legacy=await f.request('/api/auth/figma/catalog?team=1',{cookie});
  assert.equal(legacy.response.status,207);assert.equal(legacy.body.files[0].name,'Real TeamFile123');
  assert.ok(f.calls.some(call=>call.path==='/v1/teams/9876543210/projects'));assert.ok(f.calls.some(call=>call.path==='/v1/projects/1234567890/files'));
  f.setFolderStatus(429);const before=f.calls.length;
  const limited=await f.request('/api/auth/figma/catalog?team=1',{cookie});
  assert.equal(limited.response.status,207);assert.deepEqual(limited.body.files,[]);assert.equal(limited.body.errors[0].status,429);
  assert.equal(f.calls.length,before+1,'a source 429 does not cascade into v1 or metadata requests');
});
