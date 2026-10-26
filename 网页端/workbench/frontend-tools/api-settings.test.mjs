import test from 'node:test';
import assert from 'node:assert/strict';
import {apiProviders,publicApiConfig,credentialState,apiSubmission,switchApiProvider} from './api-settings-model.mjs';
const saved=publicApiConfig({mode:'demo',baseUrl:'https://provider.example/v1',model:'old-model',hasKey:true,apiKey:'MUST-NOT-ENTER-FORM',engine:'original-opencode',workflow:'multi',allowFigmaWriteTools:true});
const draft={enabled:false,baseUrl:saved.baseUrl,model:'任意 third-party/model name',apiKey:'',clearKey:false};
test('public form state never contains credential or unrelated advanced settings and legacy config defaults to OpenAI',()=>{assert.deepEqual(Object.keys(saved).sort(),['baseUrl','hasKey','mode','model','provider']);assert.equal(saved.provider,'openai');assert(!JSON.stringify(saved).includes('MUST-NOT'));});
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
