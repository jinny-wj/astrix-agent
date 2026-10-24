import fs from 'node:fs';
import path from 'node:path';

export function createModelConfig(dataDir) {
  const file = path.join(dataDir, 'model.json');
  const defaults = { mode: 'demo', engine: 'local', workflow: 'single', baseUrl: 'http://127.0.0.1:11434/v1', model: '', apiKey: '', allowWriteTools: false, allowFigmaWriteTools: false };
  let config = {...defaults};
  try { config = {...config, ...JSON.parse(fs.readFileSync(file, 'utf8'))}; } catch {}
  return {
    get: () => ({...config}),
    public: () => ({...config, apiKey: undefined, hasKey: Boolean(config.apiKey)}),
    set: next => {
      const merged = {...config};
      for (const key of Object.keys(defaults)) if (next[key] !== undefined) merged[key] = next[key];
      if (!['demo','compatible'].includes(merged.mode)) throw new Error('未知模型模式');
      if (!['local','original-opencode'].includes(merged.engine)) throw new Error('未知执行引擎');
      if (!['single','multi'].includes(merged.workflow)) throw new Error('未知工作流模式');
      const url = new URL(merged.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('模型地址应为普通 HTTP/HTTPS URL');
      if (/\.(?:corp\.kuaishou\.com|staging\.kuaishou\.com)$/.test(url.hostname)) throw new Error('本地工程不复用原客户端公司服务，请填写独立模型服务地址');
      if (typeof merged.model !== 'string' || typeof merged.apiKey !== 'string') throw new Error('模型名和密钥应为文本');
      merged.baseUrl = url.href.replace(/\/$/, '');
      merged.allowWriteTools = Boolean(merged.allowWriteTools);
      merged.allowFigmaWriteTools = Boolean(merged.allowFigmaWriteTools);
      fs.mkdirSync(dataDir, {recursive:true});
      fs.writeFileSync(file, JSON.stringify(merged,null,2), {mode:0o600});
      fs.chmodSync(file,0o600);
      config = merged;
      return {...config, apiKey:undefined, hasKey:Boolean(config.apiKey)};
    }
  };
}

export async function modelCompletion(config, messages, tools, signal, onDelta) {
  if (!config.model) throw new Error('请先在本地设置页填写模型名称');
  const headers = {'content-type':'application/json'};
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const response = await fetch(`${config.baseUrl.replace(/\/$/,'')}/chat/completions`, {
    method:'POST', headers,
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
