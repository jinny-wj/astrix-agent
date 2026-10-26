import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {nativeModelCompletion} from './model-providers.mjs';

export function normalizeModelBaseUrl(value,provider='openai') {
  if(!['openai','anthropic','gemini'].includes(provider))throw new Error('未知 API 协议');
  if(typeof value!=='string'||!value.trim())throw new Error('模型地址应为普通 HTTP/HTTPS URL');
  let url;try{url=new URL(value.trim());}catch{throw new Error('模型地址应为普通 HTTP/HTTPS URL');}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.hash)throw new Error('模型地址应为不含用户名、密码或片段的 HTTP/HTTPS URL');
  url.pathname=url.pathname.replace(/\/+$/,'');
  if(provider==='openai')url.pathname=url.pathname.replace(/\/chat\/completions$/,'');
  if(provider==='anthropic')url.pathname=url.pathname.replace(/\/messages$/,'');
  if(provider==='gemini')url.pathname=url.pathname.replace(/\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/,'');
  return url.pathname==='/'&&!url.search?url.href.replace(/\/$/,''):url.href;
}

export function modelCompletionUrl(baseUrl) {
  const url=new URL(normalizeModelBaseUrl(baseUrl));
  url.pathname=url.pathname.replace(/\/+$/,'')+'/chat/completions';
  return url.href;
}

export function createModelConfig(dataDir) {
  const file = path.join(dataDir, 'model.json');
  const defaults = { mode: 'demo', provider: 'openai', engine: 'local', workflow: 'single', baseUrl: 'http://127.0.0.1:11434/v1', model: '', apiKey: '', allowWriteTools: false, allowFigmaWriteTools: false };
  let config = {...defaults};
  try { config = {...config, ...JSON.parse(fs.readFileSync(file, 'utf8'))}; } catch {}
  const visible=value=>({...Object.fromEntries(Object.keys(defaults).filter(key=>key!=='apiKey').map(key=>[key,value[key]])),hasKey:Boolean(value.apiKey)});
  function preview(next) {
    if(!next||typeof next!=='object'||Array.isArray(next))throw new Error('模型配置应为 JSON 对象');
    const merged={...config};
    for(const key of Object.keys(defaults))if(key!=='apiKey'&&next[key]!==undefined)merged[key]=next[key];
    if(!['demo','compatible'].includes(merged.mode))throw new Error('未知模型模式');
    if(!['local','original-opencode'].includes(merged.engine))throw new Error('未知执行引擎');
    if(!['single','multi'].includes(merged.workflow))throw new Error('未知工作流模式');
    if(typeof merged.model!=='string'||next.apiKey!==undefined&&typeof next.apiKey!=='string')throw new Error('模型名和密钥应为文本');
    if(next.clearKey!==undefined&&typeof next.clearKey!=='boolean')throw new Error('clearKey 应为布尔值');
    for(const key of ['allowWriteTools','allowFigmaWriteTools'])if(next[key]!==undefined&&typeof next[key]!=='boolean')throw new Error('工具写权限应为布尔值');
    merged.baseUrl=normalizeModelBaseUrl(merged.baseUrl,merged.provider);
    let previousOrigin;try{previousOrigin=new URL(normalizeModelBaseUrl(config.baseUrl,config.provider)).origin;}catch{}
    const replacement=next.apiKey?.trim();
    merged.apiKey=next.clearKey?'':replacement||(merged.provider===config.provider&&new URL(merged.baseUrl).origin===previousOrigin?config.apiKey:'');
    if(typeof merged.apiKey!=='string'||/[\u0000-\u001f\u007f]/.test(merged.apiKey))throw new Error('密钥格式无效');
    merged.allowWriteTools=Boolean(merged.allowWriteTools);merged.allowFigmaWriteTools=Boolean(merged.allowFigmaWriteTools);
    return merged;
  }
  return {
    get: () => ({...config}),
    public: () => visible(config),
    preview,
    set: next => {
      const merged=preview(next);
      fs.mkdirSync(dataDir, {recursive:true});
      const temporary=file+'.'+randomUUID()+'.tmp';
      try{fs.writeFileSync(temporary,JSON.stringify(merged,null,2),{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);}
      finally{try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
      config = merged;
      return visible(config);
    }
  };
}

export async function modelCompletion(config, messages, tools, signal, onDelta) {
  if (!config.model) throw new Error('请先在本地设置页填写模型名称');
  const provider=config.provider||'openai';
  if(provider==='anthropic'||provider==='gemini')return nativeModelCompletion(config,messages,tools,signal,onDelta);
  if(provider!=='openai')throw new Error('未知 API 协议');
  const headers = {'content-type':'application/json'};
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const response = await fetch(modelCompletionUrl(config.baseUrl), {
    method:'POST', headers,
    redirect:'error',credentials:'omit',cache:'no-store',
    body: JSON.stringify({model:config.model,messages,stream:Boolean(onDelta),...(tools?.length?{tools,tool_choice:'auto'}:{})}),
    signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}；请检查地址、模型名与密钥`);
  if(onDelta&&response.headers.get('content-type')?.includes('text/event-stream')){
    const message={role:'assistant',content:''},calls=new Map();
    let buffer='',bytes=0;
    const decoder=new TextDecoder();
    function line(raw){
      if(!raw.startsWith('data:'))return;
      const data=raw.slice(5).trim();if(!data||data==='[DONE]')return;
      const event=JSON.parse(data);
      if(event.error)throw new Error(event.error.message||'模型流返回错误');
      const delta=event.choices?.[0]?.delta;if(!delta)return;
      if(typeof delta.content==='string'){message.content+=delta.content;onDelta(delta.content);}
      for(const part of delta.tool_calls||[]){
        const call=calls.get(part.index)||{id:'',type:'function',function:{name:'',arguments:''}};
        if(part.id)call.id=part.id;
        if(part.function?.name)call.function.name+=part.function.name;
        if(part.function?.arguments)call.function.arguments+=part.function.arguments;
        calls.set(part.index,call);
      }
    }
    for await(const chunk of response.body){
      bytes+=chunk.length;if(bytes>8*1024*1024)throw new Error('模型单轮响应超过 8 MB');
      buffer+=decoder.decode(chunk,{stream:true});let newline;
      while((newline=buffer.indexOf('\n'))>=0){line(buffer.slice(0,newline).replace(/\r$/,''));buffer=buffer.slice(newline+1);}
    }
    buffer+=decoder.decode();if(buffer.trim())line(buffer);
    if(calls.size)message.tool_calls=[...calls.values()];
    if(!message.content&&!message.tool_calls?.length)throw new Error('模型流中没有文本或工具调用');
    return message;
  }
  const data = await response.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('模型响应缺少 choices[0].message');
  if(onDelta&&typeof message.content==='string')onDelta(message.content);
  return message;
}
