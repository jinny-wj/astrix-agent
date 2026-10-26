import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createModelConfig,normalizeModelBaseUrl,modelCompletionUrl,modelCompletion} from '../../../网页端/workbench/server/model.mjs';
import {createWorkbenchApplication} from '../../../网页端/workbench/server/application.mjs';
import {createModelGateway} from '../../../网页端/workbench/server/model-gateway.mjs';

async function temporary(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-model-config-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
async function upstream(t,handler){
  const requests=[],server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push({path:req.url,authorization:req.headers.authorization,body});await handler?.(req,res,body);if(res.writableEnded||res.destroyed||handler)return;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'mock connection succeeded'}}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});return {requests,baseUrl:'http://127.0.0.1:'+server.address().port+'/v1'};
}
async function application(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astrix-model-http-')),dataDir=path.join(directory,'data'),app=createWorkbenchApplication({surface:'web',dataDir,workspaceRoot:path.join(directory,'workspace'),port:4317});
  const server=http.createServer(app.handle);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.close();await fs.rm(directory,{recursive:true,force:true});});
  async function request(route,body,method=body===undefined?'GET':'POST'){
    const response=await fetch(origin+route,{method,headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();return {status:response.status,data};
  }
  return {app,dataDir,file:path.join(dataDir,'model.json'),origin,request};
}

test('compatible model configuration accepts arbitrary service origins and model names, with a canonical base endpoint',async t=>{
  const config=createModelConfig(await temporary(t));
  const model='third-party/custom model:latest 中文';
  for(const address of ['https://api.provider.example/openai/v1','http://localhost:12345/v1','https://independent.corp.kuaishou.com/v1','https://independent.staging.kuaishou.com/v1']){
    const result=config.set({mode:'compatible',baseUrl:address+'/chat/completions///',model});assert.equal(result.baseUrl,address);assert.equal(result.model,model);assert.equal(Object.hasOwn(result,'apiKey'),false);
  }
  assert.equal(normalizeModelBaseUrl(' http://[::1]:1234/v1/chat/completions/ '),'http://[::1]:1234/v1');
  for(const address of ['not a url','file:///tmp/model','https://user:private@provider.example/v1','https://provider.example/v1#private'])assert.throws(()=>config.set({baseUrl:address}),error=>!error.message.includes('private'));
  assert.equal(normalizeModelBaseUrl('https://provider.example/openai/v1/chat/completions/?api-version=2026-01-01'),'https://provider.example/openai/v1?api-version=2026-01-01');assert.equal(modelCompletionUrl('https://provider.example/?api-version=preview'),'https://provider.example/chat/completions?api-version=preview');
});

test('blank keys preserve only the same origin, explicit clearing wins and partial saves keep advanced settings',async t=>{
  const directory=await temporary(t),config=createModelConfig(directory),secret='synthetic-model-secret';
  config.set({mode:'compatible',engine:'original-opencode',workflow:'multi',baseUrl:'https://api.provider.example/v1',model:'any-name',apiKey:secret,allowWriteTools:true,allowFigmaWriteTools:true});
  let result=config.set({baseUrl:'https://api.provider.example/other/chat/completions',apiKey:'   ',model:'another/name'});assert.equal(result.hasKey,true);assert.equal(config.get().apiKey,secret);assert.equal(result.engine,'original-opencode');assert.equal(result.workflow,'multi');assert.equal(result.allowWriteTools,true);assert.equal(result.allowFigmaWriteTools,true);
  assert.equal(config.preview({baseUrl:'https://api.provider.example:443/other',apiKey:''}).apiKey,secret);
  assert.equal(config.preview({baseUrl:'http://api.provider.example/v1'}).apiKey,'');assert.equal(config.preview({baseUrl:'https://api.provider.example:444/v1'}).apiKey,'');
  result=config.set({baseUrl:'https://different.provider.example/v1',apiKey:''});assert.equal(result.hasKey,false);assert.equal(config.get().apiKey,'');
  config.set({apiKey:'fresh-key'});assert.equal(config.get().apiKey,'fresh-key');assert.equal(config.set({clearKey:true}).hasKey,false);
  config.set({apiKey:'another-key'});assert.equal(config.set({clearKey:true,apiKey:'must-not-win'}).hasKey,false);
  const stored=await fs.stat(path.join(directory,'model.json'));assert.equal(stored.mode&0o777,0o600);
  const before=await fs.readFile(path.join(directory,'model.json'),'utf8');for(const draft of [{mode:'unsupported'},{apiKey:'invalid\r\nheader'},{clearKey:'true'},{allowWriteTools:'false'},{allowFigmaWriteTools:'false'}])assert.throws(()=>config.set(draft));
  for(const key of ['private\u0007credential','private\u007fcredential'])assert.throws(()=>config.set({apiKey:key}),error=>error.message==='密钥格式无效'&&!error.message.includes(key));assert.equal(await fs.readFile(path.join(directory,'model.json'),'utf8'),before);
});

test('preview resolves credentials and endpoint without creating or changing persisted configuration',async t=>{
  const directory=await temporary(t),config=createModelConfig(directory),file=path.join(directory,'model.json');
  const draft=config.preview({mode:'compatible',baseUrl:'https://draft.example/v1/chat/completions',model:'draft',apiKey:'draft-only'});assert.equal(draft.baseUrl,'https://draft.example/v1');assert.equal(config.get().mode,'demo');await assert.rejects(fs.access(file));
  config.set({mode:'compatible',baseUrl:'https://saved.example/v1',model:'saved',apiKey:'saved-only'});const before=await fs.readFile(file,'utf8'),stat=await fs.stat(file);config.preview({mode:'demo',engine:'original-opencode',allowWriteTools:true,baseUrl:'https://draft.example/v1',apiKey:'draft-only'});assert.equal(await fs.readFile(file,'utf8'),before);assert.equal((await fs.stat(file)).mtimeMs,stat.mtimeMs);assert.equal(config.get().model,'saved');assert.equal(config.get().engine,'local');assert.equal(config.get().allowWriteTools,false);assert.equal(config.get().apiKey,'saved-only');assert.ok(!JSON.stringify(config.public()).includes('saved-only'));
});

test('a full completion URL reaches the loopback upstream exactly once without duplicating its suffix',async t=>{
  const server=await upstream(t),message=await modelCompletion({baseUrl:server.baseUrl+'/chat/completions///',model:'arbitrary/model-name',apiKey:'fixture-key'},[{role:'user',content:'test'}]);assert.equal(message.content,'mock connection succeeded');assert.equal(server.requests.length,1);assert.equal(server.requests[0].path,'/v1/chat/completions');assert.equal(server.requests[0].authorization,'Bearer fixture-key');assert.equal(server.requests[0].body.model,'arbitrary/model-name');
});

test('completion URL query parameters stay after the canonical path and do not affect same-origin credential retention',async t=>{
  assert.equal(normalizeModelBaseUrl('https://provider.example/v1/?prefix=/custom/'),'https://provider.example/v1?prefix=/custom/');
  assert.equal(modelCompletionUrl('https://provider.example/?prefix=/custom/'),'https://provider.example/chat/completions?prefix=/custom/');
  const server=await upstream(t),config=createModelConfig(await temporary(t));config.set({mode:'compatible',baseUrl:server.baseUrl,model:'query-model',apiKey:'query-fixture-key'});
  const draft=config.preview({baseUrl:server.baseUrl+'/chat/completions/?api-version=preview&feature=tools',apiKey:''});assert.equal(draft.apiKey,'query-fixture-key');await modelCompletion(draft,[{role:'user',content:'query test'}]);assert.equal(server.requests.length,1);assert.equal(server.requests[0].path,'/v1/chat/completions?api-version=preview&feature=tools');assert.equal(server.requests[0].authorization,'Bearer query-fixture-key');
});

test('the native engine gateway shares completion URL normalization for full endpoints and query parameters',async t=>{
  const server=await upstream(t),gateway=await createModelGateway({config:{baseUrl:server.baseUrl+'/chat/completions/?api-version=preview',model:'gateway-query-model',apiKey:'gateway-query-fixture-key'},maxRequests:1});t.after(()=>gateway.close());
  const response=await fetch(gateway.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+gateway.apiKey},body:JSON.stringify({model:'gateway-query-model',messages:[{role:'user',content:'gateway query test'}]})});assert.equal(response.status,200);await response.json();assert.equal(server.requests.length,1);assert.equal(server.requests[0].path,'/v1/chat/completions?api-version=preview');assert.equal(server.requests[0].authorization,'Bearer gateway-query-fixture-key');assert.equal(gateway.stats.forwardedRequests,1);
});

test('HTTP draft tests call only explicit temporary credentials and never save, while empty requests keep the saved test contract',async t=>{
  const f=await application(t),first=await upstream(t),second=await upstream(t),savedKey='saved-fixture-key',draftKey='temporary-fixture-key';
  const saved=await f.request('/__local/model',{mode:'compatible',baseUrl:first.baseUrl,model:'saved-model',apiKey:savedKey,engine:'original-opencode',workflow:'multi',allowWriteTools:true,allowFigmaWriteTools:true},'PUT');assert.equal(saved.status,200);assert.equal(saved.data.hasKey,true);assert.equal(Object.hasOwn(saved.data,'apiKey'),false);
  const before=await fs.readFile(f.file,'utf8'),stat=await fs.stat(f.file);
  let result=await f.request('/__local/model/test',{mode:'compatible',baseUrl:second.baseUrl+'/chat/completions',model:'draft-model',apiKey:draftKey,engine:'local',workflow:'single',allowWriteTools:false});assert.equal(result.status,200);assert.equal(result.data.ok,true);assert.equal(second.requests[0].authorization,'Bearer '+draftKey);assert.equal(second.requests[0].body.model,'draft-model');assert.equal(second.requests[0].path,'/v1/chat/completions');
  result=await f.request('/__local/model/test',{mode:'compatible',baseUrl:second.baseUrl,model:'no-key-draft',apiKey:' '});assert.equal(result.status,200);assert.equal(second.requests[1].authorization,undefined,'the saved key must not cross to a different origin');
  result=await f.request('/__local/model/test',{mode:'compatible',baseUrl:first.baseUrl,model:'same-origin-draft',apiKey:''});assert.equal(result.status,200);assert.equal(first.requests[0].authorization,'Bearer '+savedKey);
  result=await f.request('/__local/model/test',{},'POST');assert.equal(result.data.message,'mock connection succeeded');assert.equal(first.requests[1].body.model,'saved-model');assert.equal(first.requests[1].authorization,'Bearer '+savedKey);
  result=await f.request('/__local/model/test',undefined,'POST');assert.equal(result.status,200);assert.equal(first.requests[2].body.model,'saved-model');
  assert.equal(await fs.readFile(f.file,'utf8'),before);assert.equal((await fs.stat(f.file)).mtimeMs,stat.mtimeMs);const publicConfig=(await f.request('/__local/model')).data;assert.equal(publicConfig.engine,'original-opencode');assert.equal(publicConfig.workflow,'multi');assert.equal(publicConfig.allowWriteTools,true);assert.ok(!JSON.stringify(publicConfig).includes(savedKey));assert.ok(!JSON.stringify(result.data).includes(draftKey));
});

test('demo and invalid draft tests make no model request, and returned diagnostics never reveal supplied secrets',async t=>{
  const f=await application(t),secret='synthetic-secret-no-response',server=await upstream(t,(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'upstream echoed '+secret}}]}));});
  const demo=await f.request('/__local/model/test',{mode:'demo',baseUrl:server.baseUrl,model:'unused',apiKey:secret});assert.equal(demo.data.ok,true);assert.match(demo.data.message,/没有进行/);assert.equal(server.requests.length,0);await assert.rejects(fs.access(f.file));
  const invalid=await f.request('/__local/model/test',{mode:'compatible',baseUrl:'https://user:'+secret+'@provider.example/v1',model:'x',apiKey:secret});assert.equal(invalid.status,400);assert.ok(!JSON.stringify(invalid.data).includes(secret));assert.equal(server.requests.length,0);
  const echoed=await f.request('/__local/model/test',{mode:'compatible',baseUrl:server.baseUrl,model:'x',apiKey:secret});assert.equal(echoed.status,200);assert.ok(!JSON.stringify(echoed.data).includes(secret));assert.match(echoed.data.message,/已隐藏/);await assert.rejects(fs.access(f.file));
  const malformed=await fetch(f.origin+'/__local/model',{method:'PUT',headers:{'content-type':'application/json'},body:'{"apiKey":"'+secret+'",bad}'});assert.equal(malformed.status,400);assert.ok(!(await malformed.text()).includes(secret));
});

test('closing a draft test request cancels its loopback upstream instead of leaving it running',async t=>{
  const f=await application(t);let started,closed;const received=new Promise(resolve=>started=resolve),finished=new Promise(resolve=>closed=resolve),server=await upstream(t,(req,res)=>{res.once('close',closed);started();});
  const abort=new AbortController(),request=fetch(f.origin+'/__local/model/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'compatible',baseUrl:server.baseUrl,model:'pending-model'}),signal:abort.signal});const rejection=assert.rejects(request,error=>error.name==='AbortError');await received;abort.abort();await rejection;
  await Promise.race([finished,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('upstream was not cancelled')),2000);timer.unref();})]);await assert.rejects(fs.access(f.file));
});
