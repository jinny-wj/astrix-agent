import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import vm from 'node:vm';
import {createM0Api} from '../../../网页端/workbench/server/m0-api.mjs';
import {createCanvasService} from '../../../网页端/workbench/server/canvas.mjs';
import {createFigmaWorkspace} from '../../../网页端/workbench/server/figma-workspace.mjs';
import {createFigmaCatalogOpen,figmaCatalogLaunchURL} from '../../../网页端/workbench/server/figma-catalog-open.mjs';
import {createWorkbenchApplication} from '../../../网页端/workbench/server/application.mjs';
import {patchDesignEntry,designEntryCondition} from '../../../网页端/workbench/frontend-tools/design-entry.mjs';

const KEY='ActualFile_123',URL='https://www.figma.com/design/'+KEY+'/Real%20File?node-id=1-2';
const deferred=()=>{let resolve;const promise=new Promise(accept=>{resolve=accept;});return {promise,resolve};};
const cancelled=failure=>failure.name==='AbortError'&&failure.status===499;
async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(tmpdir(),'astrix-figma-open-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const root=path.join(directory,'workspace');await fs.mkdir(root);
  const api=createM0Api({dataDir:path.join(directory,'data'),workspaceRoot:root});
  const canvas=createCanvasService({api,getWorkspace:()=>api.state.workspace});
  const workspace=createFigmaWorkspace({api,canvas,bridge:{},port:4317});
  let owner='account-one',denied=false,mismatched=false;const reads=[];
  const service=createFigmaCatalogOpen({api,workspace,resolveFile:async(request,response,url)=>{
    reads.push({request,url,owner});
    if(denied)throw Object.assign(new Error('当前账号无权访问该文件'),{status:403});
    return {accountId:owner,file:{key:mismatched?'OtherFile_456':KEY,name:'真实设计稿',url:'https://untrusted.example/metadata-url'}};
  }});
  return {api,workspace,service,reads,setOwner:value=>owner=value,setDenied:value=>denied=value,setMismatch:value=>mismatched=value};
}

test('real file open verifies metadata before creating a bound managed project and returns an explicit Design route',async t=>{
  const f=await fixture(t),request={headers:{cookie:'fixture-current-session'}};
  const result=await f.service.open(request,{}, {url:URL+'&tracking=discard#fragment'});
  assert.equal(f.reads.length,1);assert.equal(f.reads[0].request,request);assert.equal(f.reads[0].url,URL);
  const project=f.api.findProject(result.projectId);
  assert.equal(project.figmaAccountId,'account-one');assert.equal(project.figmaKey,KEY);assert.equal(project.figmaUrl,URL);assert.equal(project.projectName,'真实设计稿');
  assert.equal(f.api.state.activeProjectId,project.id);assert.equal(result.file.url,URL);assert.ok(!JSON.stringify(result).includes('untrusted.example'));
  const route=new globalThis.URL(result.route,'http://127.0.0.1:4317');
  assert.equal(route.pathname,'/aicode-v2');assert.equal(route.searchParams.get('id'),String(project.id));assert.equal(route.searchParams.get('autoOpenFigma'),'true');assert.equal(route.searchParams.get('mode'),'spark');
  assert.deepEqual(await fs.readdir(project.projectPath),['README.md'],'opening never reconstructs the Figma canvas or downloads file contents');
  assert.deepEqual(f.service.candidates(),[{url:URL,projectId:project.id,accountId:'account-one'}]);
});

test('repeated and parallel opens revalidate access and reuse only the same account/file project and its own session',async t=>{
  const f=await fixture(t),first=await f.service.open({}, {},{url:URL}),project=f.api.findProject(first.projectId);
  const session=f.api.createSession({projectId:project.id,title:'Original task'});
  const results=await Promise.all([f.service.open({}, {},{url:URL}),f.service.open({}, {},{url:URL})]);
  assert.equal(f.reads.length,3);assert.equal(f.api.state.projects.length,1);assert.ok(results.every(value=>value.projectId===first.projectId));
  assert.equal(new globalThis.URL(results[0].route,'http://localhost').searchParams.get('sessionId'),session.id);
  f.setOwner('account-two');const other=await f.service.open({}, {},{url:URL});
  assert.notEqual(other.projectId,first.projectId);assert.equal(f.api.state.projects.length,2);
  assert.equal(new globalThis.URL(other.route,'http://localhost').searchParams.has('sessionId'),false);
  assert.equal(f.api.findProject(first.projectId).figmaAccountId,'account-one');
});

test('legacy bindings are verified URL candidates but cannot donate another account local files or conversations',async t=>{
  const f=await fixture(t),legacy=f.api.createProject({projectName:'Private legacy name'});
  await f.workspace.set(legacy.id,{url:URL});
  assert.deepEqual(f.service.candidates(),[{url:URL,projectId:legacy.id}]);
  const result=await f.service.open({}, {},{url:URL});
  assert.notEqual(result.projectId,legacy.id);assert.equal(f.api.findProject(legacy.id).projectName,'Private legacy name');assert.equal(f.api.findProject(legacy.id).figmaAccountId,undefined);
  assert.ok(!JSON.stringify(f.service.candidates()).includes('Private legacy name'));
});

test('invalid links, forged account input, denied metadata and mismatched keys have no project side effects',async t=>{
  const f=await fixture(t);
  for(const url of ['https://www.figma.com/files','https://figma.new/','https://www.figma.com.evil.example/design/ActualFile_123','https://private@www.figma.com/design/ActualFile_123','http://www.figma.com/design/ActualFile_123'])await assert.rejects(f.service.open({}, {},{url}));
  await assert.rejects(f.service.open({}, {},{url:URL,accountId:'forged-account'}));assert.equal(f.reads.length,0);
  f.setDenied(true);await assert.rejects(f.service.open({}, {},{url:URL}),failure=>failure.status===403);
  f.setDenied(false);f.setMismatch(true);await assert.rejects(f.service.open({}, {},{url:URL}),failure=>failure.status===502);
  assert.equal(f.api.state.projects.length,0);
});

test('cancelled deferred metadata cannot create an old account project or replace a newly selected workspace',async t=>{
  for(const reason of ['aborted','destroyed']){
    const f=await fixture(t),metadata=deferred(),request={aborted:false},response={destroyed:false};
    const service=createFigmaCatalogOpen({api:f.api,workspace:f.workspace,resolveFile:()=>metadata.promise});
    const pending=service.open(request,response,{url:URL}),rejection=assert.rejects(pending,cancelled);
    const current=f.api.createProject({projectName:'New account current workspace'});
    if(reason==='aborted')request.aborted=true;else response.destroyed=true;
    metadata.resolve({accountId:'cancelled-old-account',file:{key:KEY,name:'Must not be created'}});
    await rejection;
    assert.deepEqual(f.api.state.projects.map(project=>project.id),[current.id]);
    assert.equal(f.api.state.activeProjectId,current.id);assert.equal(f.api.state.workspace,current.projectPath);
    assert.equal(f.api.findProject(current.id).figmaKey,'');assert.deepEqual(service.candidates(),[]);
  }
});

test('an open cancelled while queued cannot resolve its project or switch back after another account selects a workspace',async t=>{
  const f=await fixture(t),old=f.api.createProject({projectName:'Old account project'});
  await f.workspace.set(old.id,{url:URL});f.api.findProject(old.id).figmaAccountId='old-account';
  const current=f.api.createProject({projectName:'New account workspace'}),entered=deferred(),release=deferred();let resolutions=0;
  const service=createFigmaCatalogOpen({api:f.api,workspace:{...f.workspace,resolve:async id=>{
    resolutions++;if(resolutions===1){entered.resolve();await release.promise;}return f.workspace.resolve(id);
  }},resolveFile:async()=>({accountId:'old-account',file:{key:KEY,name:'Old account file'}})});
  const first=service.open({}, {},{url:URL});await entered.promise;
  const response={destroyed:false},queued=service.open({},response,{url:URL}),rejection=assert.rejects(queued,cancelled);
  await Promise.resolve();response.destroyed=true;release.resolve();await first;
  f.api.selectWorkspace(current.projectPath,{projectId:current.id});await rejection;
  assert.equal(resolutions,1,'the cancelled queued operation must stop before resolving or changing its project');
  assert.equal(f.api.state.activeProjectId,current.id);assert.equal(f.api.state.workspace,current.projectPath);assert.equal(f.api.state.projects.length,2);
});

test('cancellation during project validation or binding prevents a late global workspace switch',async t=>{
  for(const boundary of ['resolve','set']){
    const f=await fixture(t),old=f.api.createProject({projectName:'Old account project'});
    await f.workspace.set(old.id,{url:URL});f.api.findProject(old.id).figmaAccountId='old-account';
    const current=f.api.createProject({projectName:'New account workspace'}),entered=deferred(),release=deferred(),response={destroyed:false};
    const service=createFigmaCatalogOpen({api:f.api,workspace:{...f.workspace,[boundary]:async(...args)=>{
      const result=await f.workspace[boundary](...args);entered.resolve();await release.promise;return result;
    }},resolveFile:async()=>({accountId:'old-account',file:{key:KEY,name:'Old account file'}})});
    const pending=service.open({},response,{url:URL}),rejection=assert.rejects(pending,cancelled);
    await entered.promise;response.destroyed=true;f.api.selectWorkspace(current.projectPath,{projectId:current.id});release.resolve();await rejection;
    assert.equal(f.api.state.activeProjectId,current.id);assert.equal(f.api.state.workspace,current.projectPath);
  }
});

test('HTTP opening is POST-only, same-origin and forwards the current request to the server-only OAuth resolver',async t=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'astrix-figma-open-http-'));let seen=0;
  const app=createWorkbenchApplication({surface:'web',dataDir:path.join(directory,'data'),workspaceRoot:path.join(directory,'workspace'),port:4317,
    resolveFigmaCatalogFile:async request=>{seen++;assert.equal(request.headers.cookie,'current-fixture');return {accountId:'http-account',file:{key:KEY,name:'HTTP design'}};}});
  const server=http.createServer(app.handle);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.close();await fs.rm(directory,{recursive:true,force:true});});
  const route=origin+'/__local/figma/catalog/open';
  assert.equal((await fetch(route)).status,405);
  assert.equal((await fetch(route,{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:JSON.stringify({url:URL})})).status,403);assert.equal(seen,0);
  const opened=await fetch(route,{method:'POST',headers:{origin,cookie:'current-fixture','content-type':'application/json'},body:JSON.stringify({url:URL})});
  assert.equal(opened.status,200);assert.equal(seen,1);assert.match((await opened.json()).route,/^\/aicode-v2\?/);
  const policy=opened.headers.get('content-security-policy'),images=policy.split(';').find(value=>value.trim().startsWith('img-src'));
  assert.match(images,/https:\/\/figma\.com/);assert.match(images,/https:\/\/\*\.figma\.com/);assert.doesNotMatch(images,/(?:^|\s)https:(?:\s|$)|https:\/\/\*(?:\s|$)/);
  assert.match(policy,/(?:^|;)\s*script-src 'self'/);assert.match(policy,/(?:^|;)\s*connect-src 'self' ws:\/\/127\.0\.0\.1:/);assert.doesNotMatch(policy.split(';').find(value=>value.trim().startsWith('connect-src')),/https:|\*/);
  assert.ok(app.getFigmaCatalogCandidates().some(value=>value.url===URL&&value.accountId==='http-account'));
});

test('synchronous web launch redirects only to canonical official files without touching OAuth, projects or remote data',async t=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'astrix-figma-launch-http-'));let reads=0;
  const app=createWorkbenchApplication({surface:'web',dataDir:path.join(directory,'data'),workspaceRoot:path.join(directory,'workspace'),port:4317,
    resolveFigmaCatalogFile:()=>{reads++;throw Error('launch must never access OAuth or metadata');}});
  const server=http.createServer(app.handle);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.close();await fs.rm(directory,{recursive:true,force:true});});
  const route=origin+'/__local/figma/catalog/launch';
  const launch=await fetch(route+'?'+new URLSearchParams({url:URL+'&tracking=removed#ignored'}),{redirect:'manual'});
  assert.equal(launch.status,302);assert.equal(launch.headers.get('location'),URL);assert.equal(launch.headers.get('cache-control'),'no-store');assert.equal(launch.headers.get('referrer-policy'),'no-referrer');
  for(const value of ['https://www.figma.com/files','https://figma.new/','https://www.figma.com.evil.example/design/ActualFile_123','https://private@www.figma.com/design/ActualFile_123','https://www.figma.com:444/design/ActualFile_123','javascript:alert(1)']){
    assert.throws(()=>figmaCatalogLaunchURL(value));assert.equal((await fetch(route+'?'+new URLSearchParams({url:value}),{redirect:'manual'})).status,400);
  }
  assert.equal((await fetch(route+'?url='+encodeURIComponent(URL)+'&url='+encodeURIComponent(URL),{redirect:'manual'})).status,400);
  assert.equal((await fetch(route,{method:'POST',redirect:'manual'})).status,405);
  assert.equal((await fetch(route+'?'+new URLSearchParams({url:URL}),{headers:{origin:'https://untrusted.example'},redirect:'manual'})).status,403);
  assert.equal(reads,0);assert.equal(app.api.state.projects.length,0);
});

test('an explicit real Figma entry wins over both persisted and application Code modes while normal Code entries are unchanged',()=>{
  for(const local of [true,false])for(const explicit of [true,false])for(const savedCode of [true,false]) {
    const value=vm.runInNewContext(designEntryCondition,{window:{__M0_LOCAL_RUNTIME__:local},localStorage:{getItem:()=>savedCode?'code':'design'},j:{value:'code'},Zn:{Code:'code'},d:{query:{autoOpenFigma:explicit?'true':undefined,homeEntryMode:'code'}}});
    assert.equal(value,!(local&&explicit));
  }
  const previous='(window.__M0_LOCAL_RUNTIME__&&localStorage.getItem("M0Mode")==="code")||j.value===Zn.Code||d.query.homeEntryMode==="code"&&d.query.autoOpenFigma!=="true"';
  const original=previous.slice(previous.indexOf('j.value'));
  const patched=patchDesignEntry('if('+original+'){};const selected=('+original+')?"code":"design";');
  assert.equal(patchDesignEntry(patched),patched);assert.equal(patchDesignEntry('if('+previous+'){};const selected=('+previous+')?"code":"design";'),patched);
  assert.throws(()=>patchDesignEntry('unexpected upstream code'));
});
