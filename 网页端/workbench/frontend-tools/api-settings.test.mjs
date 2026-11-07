import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {apiProviders,publicApiConfig,publicCodexStatus,credentialState,apiSubmission,switchApiProvider} from './api-settings-model.mjs';
const saved=publicApiConfig({mode:'demo',baseUrl:'https://provider.example/v1',model:'old-model',hasKey:true,apiKey:'MUST-NOT-ENTER-FORM',engine:'original-opencode',workflow:'multi',allowFigmaWriteTools:true});
const draft={enabled:false,baseUrl:saved.baseUrl,model:'任意 third-party/model name',apiKey:'',clearKey:false};
test('public form state never contains credential or unrelated advanced settings and legacy config defaults to OpenAI',()=>{assert.deepEqual(Object.keys(saved).sort(),['baseUrl','codexModel','hasKey','mode','model','provider']);assert.equal(saved.provider,'openai');assert.equal(saved.codexModel,'');assert(!JSON.stringify(saved).includes('MUST-NOT'));});
test('same-origin blank key is omitted; source change is explicit and never copies old key',()=>{assert.equal(credentialState(saved,draft),'keep');const changed={...draft,baseUrl:'http://127.0.0.1:11434/custom-path?api-version=2026-01'};assert.equal(credentialState(saved,changed),'new-origin');const body=apiSubmission(saved,changed);assert.equal(body.baseUrl,changed.baseUrl);assert(!('apiKey'in body));assert(!('engine'in body));assert(!('workflow'in body));});
test('test uses compatible draft even while saved conversation mode stays demo',()=>{const body=apiSubmission(saved,draft,{test:true});assert.equal(body.mode,'compatible');assert.equal(saved.mode,'demo');assert.equal(draft.enabled,false);assert.equal(body.model,draft.model);assert.equal(apiSubmission(saved,draft).mode,'demo');});
test('arbitrary official/third-party/local origins and model identifiers are accepted',()=>{for(const baseUrl of ['https://official.example/v1','https://custom-vendor.example/api/chat/completions?api-version=next','http://localhost:9901/v1','https://service.corp.kuaishou.com/v1']){const body=apiSubmission(saved,{...draft,enabled:true,baseUrl});assert.equal(body.baseUrl,baseUrl);assert.equal(body.model,draft.model);}});
test('replacement and explicit clearing use distinct request shapes',()=>{assert.equal(apiSubmission(saved,{...draft,apiKey:' new-test-value '}).apiKey,'new-test-value');const cleared=apiSubmission(saved,{...draft,clearKey:true});assert.equal(cleared.clearKey,true);assert(!('apiKey'in cleared));assert.throws(()=>apiSubmission(saved,{...draft,clearKey:true,apiKey:'new-value'}),/清空/);});
test('endpoint structure and actual model tests are validated without vendor presets',()=>{for(const baseUrl of ['file:///tmp/model','https://user:pass@example.com/v1','https://example.com/v1#fragment','not-a-url'])assert.throws(()=>apiSubmission(saved,{...draft,baseUrl}));assert.throws(()=>apiSubmission(saved,{...draft,model:''},{test:true}),/模型名称/);assert.equal(apiSubmission(saved,{...draft,model:''}).mode,'demo');});
test('native protocol draft tests send the selected dialect and permit official or custom endpoints',()=>{
  for(const [provider,baseUrl] of [['anthropic','https://api.anthropic.com/v1/messages'],['gemini','https://generativelanguage.googleapis.com/v1beta/models/custom:streamGenerateContent?alt=sse'],['anthropic','http://127.0.0.1:9980/custom/messages?route=native'],['gemini','https://third-party.example/custom-gemini-root']]){
    const value=apiSubmission(saved,{...draft,provider,baseUrl},{test:true});assert.equal(value.provider,provider);assert.equal(value.baseUrl,baseUrl);assert.equal(value.mode,'compatible');assert(!('apiKey'in value));
  }
  assert.equal(apiSubmission(saved,draft).provider,'openai');
  assert.throws(()=>apiSubmission(saved,{...draft,provider:'unknown'}),/API 协议/);
});
test('empty credentials require the same native protocol as well as the same origin',()=>{
  const nativeSaved=publicApiConfig({...saved,provider:'anthropic'});
  assert.equal(credentialState(nativeSaved,{...draft,provider:'anthropic'}),'keep');
  assert.equal(credentialState(nativeSaved,{...draft,provider:'gemini'}),'new-provider');
  assert.equal(credentialState(nativeSaved,{...draft,provider:'anthropic',baseUrl:'https://another.example/v1'}),'new-origin');
  assert.equal(credentialState(nativeSaved,{...draft,provider:'gemini',apiKey:'fresh-value'}),'replace');
  assert.equal(credentialState(nativeSaved,draft),'keep');assert.equal(apiSubmission(nativeSaved,draft).provider,'anthropic');
});
test('protocol changes suggest official roots only for known defaults and clear unsaved credentials',()=>{
  for(const baseUrl of ['','http://127.0.0.1:11434/v1/','https://api.openai.com/v1','https://api.anthropic.com/v1/','https://generativelanguage.googleapis.com/v1beta']){
    const value=switchApiProvider({...draft,baseUrl,apiKey:'unsaved-only',clearKey:true},'anthropic');assert.equal(value.baseUrl,apiProviders.anthropic.baseUrl);assert.equal(value.provider,'anthropic');assert.equal(value.apiKey,'');assert.equal(value.clearKey,false);assert.equal(value.model,draft.model);
  }
  const original={...draft,provider:'anthropic',baseUrl:'https://relay.example/native?api-version=next',apiKey:'unsaved-only'};
  const next=switchApiProvider(original,'gemini');assert.equal(next.baseUrl,original.baseUrl);assert.equal(next.apiKey,'');assert.equal(original.apiKey,'unsaved-only');assert.equal(original.provider,'anthropic');
});

test('Codex connection survives public form hydration without exposing login data or API credentials',()=>{
  const value=publicApiConfig({mode:'codex',codexModel:'optional-codex-model',provider:'gemini',model:'api-model',baseUrl:'https://relay.example/v1',hasKey:true,apiKey:'private-api-value',auth:{access_token:'private-login-value'},engine:'original-opencode'});
  assert.equal(value.mode,'codex');assert.equal(value.codexModel,'optional-codex-model');assert.equal(value.model,'api-model');assert.equal(value.provider,'gemini');assert.equal(value.hasKey,true);
  assert(!JSON.stringify(value).includes('private-'));assert(!('auth'in value));assert(!('engine'in value));
});

test('selecting Codex sends only its mode and optional model, preserving an unrelated API draft',()=>{
  const original={...draft,connection:'codex',codexModel:'  local-codex-model  ',provider:'unsupported',baseUrl:'not-an-api-url',model:'api-model',apiKey:'unsaved-api-key',clearKey:true};
  assert.deepEqual(apiSubmission(saved,original),{mode:'codex',codexModel:'local-codex-model'});
  assert.deepEqual(apiSubmission(saved,original,{test:true}),{mode:'codex',codexModel:'local-codex-model'});
  assert.deepEqual(apiSubmission(saved,{connection:'codex'}),{mode:'codex',codexModel:''});
  assert.equal(original.apiKey,'unsaved-api-key');assert.equal(original.baseUrl,'not-an-api-url');
  for(const codexModel of [123,'bad\nmodel','x'.repeat(201)])assert.throws(()=>apiSubmission(saved,{connection:'codex',codexModel}),/Codex 模型名/);
});

test('switching back to API keeps native protocol and credential rules independent from Codex model',()=>{
  const codexSaved=publicApiConfig({mode:'codex',codexModel:'codex-default',provider:'anthropic',model:'api-model',baseUrl:'https://native.example/v1',hasKey:true});
  const body=apiSubmission(codexSaved,{connection:'api',enabled:true,provider:'anthropic',baseUrl:codexSaved.baseUrl,model:'claude-model',codexModel:'must-not-be-sent',apiKey:''});
  assert.deepEqual(body,{mode:'compatible',provider:'anthropic',baseUrl:codexSaved.baseUrl,model:'claude-model'});
  assert(!('codexModel'in body));assert(!('apiKey'in body));assert.equal(codexSaved.mode,'codex');
});

test('Codex status accepts only confirmed ChatGPT login and never displays raw diagnostic content',()=>{
  const ready=publicCodexStatus({installed:true,authenticated:true,authMethod:'chatgpt',ready:true,message:'raw secret should not display',apiKey:'never-display'});
  assert.equal(ready.ready,true);assert.match(ready.message,/ChatGPT/);assert(!JSON.stringify(ready).includes('raw secret'));assert(!JSON.stringify(ready).includes('never-display'));
  const api=publicCodexStatus({installed:true,authenticated:true,authMethod:'api-key',ready:true});assert.equal(api.ready,false);assert.match(api.message,/API 登录/);
  const missing=publicCodexStatus({installed:false,authenticated:false,authMethod:'none',ready:false});assert.equal(missing.ready,false);assert.match(missing.message,/未找到/);
  const unknown=publicCodexStatus({installed:true,authenticated:true,authMethod:'unexpected',ready:true});assert.equal(unknown.ready,false);assert.equal(unknown.authMethod,'unknown');
  const loggedOut=publicCodexStatus({installed:true,authenticated:false,authMethod:'none',ready:false});assert.match(loggedOut.message,/codex login/);
});

// Drive the actual authored dialog with an isolated DOM surface and request
// recorder. No installed Codex, saved account or model service is contacted.
function dialogHarness(initial,{status,respond}={}) {
  const registry=new Map(),calls=[],events=[];
  const document={activeElement:null};
  function element(tag){
    const listeners=new Map();
    const node={tag,hidden:false,disabled:false,checked:false,value:'',textContent:'',dataset:{},isConnected:true,open:false,
      setAttribute(name,value){this[name]=String(value);},querySelector(selector){return registry.get(selector.slice(1))||null;},
      focus(){document.activeElement=this;},addEventListener(name,fn){const list=listeners.get(name)||[];list.push(fn);listeners.set(name,list);},
      async fire(name,event={}){for(const fn of listeners.get(name)||[])await fn(event);},
      showModal(){this.open=true;},close(){this.open=false;for(const fn of listeners.get('close')||[])fn();}};
    Object.defineProperty(node,'innerHTML',{set(value){for(const match of value.matchAll(/\bid="([^"]+)"/g)){const child=element('generated');child.id=match[1];registry.set(child.id,child);}},get(){return '';}});
    return node;
  }
  document.createElement=element;document.getElementById=id=>registry.get(id)||null;
  document.body={append(...nodes){for(const node of nodes)registry.set(node.id,node);}};
  let config={...initial},handler=respond;
  const request=async(url,init={})=>{
    const call={url,init,body:init.body?JSON.parse(init.body):null};calls.push(call);
    if(handler)return handler(call,config);
    if(url==='/__local/codex/status')return Response.json(status||{installed:true,authenticated:true,authMethod:'chatgpt',ready:true});
    if(url==='/__local/model/test')return Response.json({ok:true,mode:call.body.mode,message:'mock reply'});
    if(init.method==='PUT')config={...config,...call.body};
    return Response.json(config);
  };
  const window={fetch:request};
  const source=fs.readFileSync(new URL('./api-settings.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace('export function installApiSettings','function installApiSettings')+'\nglobalThis.installApiSettings=installApiSettings;';
  const context={window,document,location:{pathname:'/'},AbortController,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),addEventListener(){},dispatchEvent:event=>events.push(event),apiProviders,publicApiConfig,publicCodexStatus,credentialState,apiSubmission,switchApiProvider};
  vm.runInNewContext(source,context);
  const api=context.installApiSettings({request}),item=id=>registry.get('astrix-api-'+id);
  const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
  return {api,item,calls,events,document,settle,setResponder:value=>{handler=value;},
    async choose(connection){item('connection-codex').checked=connection==='codex';item('connection-api').checked=connection!=='codex';await item('connection-'+connection).fire('change');await settle();},
    submit:async()=>{item('form').onsubmit({preventDefault(){}});await settle();},
    test:async()=>{item('test').onclick();await settle();}};
}

test('opening saved Codex mode checks login only, and the explicit test is the sole inference request',async()=>{
  const h=dialogHarness({mode:'codex',codexModel:'',provider:'gemini',baseUrl:'https://saved.example/native',model:'api-only',hasKey:true});
  await h.api.open();await h.settle();
  assert.deepEqual(h.calls.map(call=>call.url),['/__local/model','/__local/codex/status']);
  assert.equal(h.item('codex-panel').hidden,false);assert.equal(h.item('api-panel').hidden,true);assert.equal(h.item('codex-model').value,'');
  assert.match(h.item('codex-status').textContent,/ChatGPT/);assert.match(h.item('footnote').textContent,/少量 Codex 额度/);
  await h.test();
  const tests=h.calls.filter(call=>call.url==='/__local/model/test');assert.equal(tests.length,1);assert.deepEqual(tests[0].body,{mode:'codex',codexModel:''});
  assert.equal(h.calls.filter(call=>call.init.method==='PUT').length,0);assert.match(h.item('feedback').textContent,/Codex 连接测试成功/);
});

test('dialog source changes preserve the API draft while Codex save sends no endpoint or credential',async()=>{
  const h=dialogHarness({mode:'demo',provider:'anthropic',baseUrl:'https://saved.example/native',model:'api-model',hasKey:true});
  await h.api.open();await h.choose('codex');h.item('codex-model').value='selected-codex';h.item('key').value='only-an-unsaved-api-draft';
  await h.submit();
  const savedCodex=h.calls.find(call=>call.init.method==='PUT');assert.deepEqual(savedCodex.body,{mode:'codex',codexModel:'selected-codex'});
  assert.equal(h.item('base-url').value,'https://saved.example/native');assert.equal(h.item('provider').value,'anthropic');assert.equal(h.item('model').value,'api-model');
  await h.choose('api');await h.submit();
  const savedApi=h.calls.filter(call=>call.init.method==='PUT').at(-1);assert.deepEqual(savedApi.body,{mode:'compatible',provider:'anthropic',baseUrl:'https://saved.example/native',model:'api-model'});
  assert.equal(h.events.length,2);assert.equal(h.events[0].detail.mode,'codex');assert.equal(h.events[1].detail.mode,'compatible');
});

test('closing the dialog aborts login detection and a late response cannot update closed feedback',async()=>{
  let finish;
  const h=dialogHarness({mode:'codex',codexModel:'',baseUrl:'https://saved.example/v1',model:'api-model',hasKey:false},{respond:call=>call.url==='/__local/codex/status'?new Promise(resolve=>{finish=resolve;}):Response.json({mode:'codex',codexModel:'',baseUrl:'https://saved.example/v1',model:'api-model',hasKey:false})});
  await h.api.open();await h.settle();const pending=h.calls.find(call=>call.url==='/__local/codex/status');
  assert.equal(pending.init.signal.aborted,false);h.api.close();assert.equal(pending.init.signal.aborted,true);
  finish(Response.json({installed:true,authenticated:true,authMethod:'chatgpt',ready:true}));await h.settle();
  assert.equal(h.item('dialog').open,false);assert.doesNotMatch(h.item('codex-status').textContent,/已检测到/);assert.equal(h.item('feedback').textContent,'');
});

test('test busy state blocks duplicate inference, escape aborts it and clears an unsaved API credential',async()=>{
  let finish;
  const initial={mode:'codex',codexModel:'',provider:'openai',baseUrl:'https://saved.example/v1',model:'api-model',hasKey:true};
  const h=dialogHarness(initial,{respond:call=>call.url==='/__local/model/test'?new Promise(resolve=>{finish=resolve;}):Response.json(call.url==='/__local/codex/status'?{installed:true,authenticated:true,authMethod:'chatgpt',ready:true}:initial)});
  await h.api.open();await h.settle();h.item('key').value='unsaved-api-value';await h.test();await h.test();
  assert.equal(h.calls.filter(call=>call.url==='/__local/model/test').length,1);assert.equal(h.item('connection-api').disabled,true);
  const pending=h.calls.find(call=>call.url==='/__local/model/test');let prevented=false;await h.item('dialog').fire('cancel',{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(pending.init.signal.aborted,true);assert.equal(h.item('key').value,'');
  finish(Response.json({ok:true,mode:'codex'}));await h.settle();assert.doesNotMatch(h.item('feedback').textContent,/连接测试成功/);assert.equal(h.events.length,0);
});
