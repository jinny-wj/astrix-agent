import {randomUUID} from 'node:crypto';

// Keep the application's conversation/tool contract stable while speaking each
// provider's REST protocol. Opaque native blocks stay on the assistant message
// so signed reasoning parts can be sent back unchanged on the next tool turn.
const MAX_RESPONSE_BYTES=8*1024*1024;
const labels={anthropic:'Claude',gemini:'Gemini'};
const copy=value=>JSON.parse(JSON.stringify(value));

export function nativeModelUrl(config,{stream=false}={}) {
  if(!labels[config.provider])throw Error('未知原生 API 协议');
  let url;try{url=new URL(config.baseUrl);}catch{throw Error('模型地址应为普通 HTTP/HTTPS URL');}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.hash)throw Error('模型地址应为不含登录信息或片段的 HTTP/HTTPS URL');
  let path=url.pathname.replace(/\/+$/,'');
  if(config.provider==='anthropic'){
    if(!path)path='/v1';
    url.pathname=path.endsWith('/messages')?path:path+'/messages';
  }else{
    if(typeof config.model!=='string'||!config.model.trim())throw Error('请先填写模型名称');
    const model=encodeURIComponent(config.model.trim().replace(/^models\//,''));
    const suffix='/models/'+model+':'+(stream?'streamGenerateContent':'generateContent');
    if(/\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/.test(path))path=path.replace(/\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/,suffix);
    else{if(!path)path='/v1beta';path=path.replace(/\/models$/,'')+suffix;}
    url.pathname=path;
    if(stream)url.searchParams.set('alt','sse');else if(url.searchParams.get('alt')==='sse')url.searchParams.delete('alt');
  }
  return url.href;
}

function textContent(content) {
  if(content==null)return '';
  if(typeof content==='string')return content;
  if(Array.isArray(content)){
    if(content.some(part=>part?.type!=='text'))throw Error('当前原生模型对话仅支持文本内容');
    return content.map(part=>String(part.text||'')).join('\n');
  }
  throw Error('模型对话内容格式无效');
}
function argumentsObject(value) {
  let parsed;try{parsed=typeof value==='string'?JSON.parse(value||'{}'):value??{};}catch{throw Error('工具调用参数不是有效 JSON');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('工具调用参数应为 JSON 对象');
  return parsed;
}
function functionTools(tools) {
  return (tools||[]).map(tool=>{
    if(tool?.type!=='function'||typeof tool.function?.name!=='string')throw Error('模型工具定义格式无效');
    const {name,description,parameters}=tool.function;
    return {name,...(description?{description}:{}),schema:parameters||{type:'object',properties:{}}};
  });
}
function appendTurn(turns,role,field,parts) {
  if(!parts.length)return;
  const prior=turns.at(-1);
  if(prior?.role===role)prior[field].push(...parts);else turns.push({role,[field]:parts});
}
function nativeContent(message,provider) {
  const native=message?._astrixNative;
  return native?.provider===provider&&Array.isArray(native.content)?copy(native.content):null;
}

function claudeRequest(config,messages,tools,stream) {
  const turns=[],system=[];
  for(const message of messages){
    if(message.role==='system'||message.role==='developer'){const text=textContent(message.content);if(text)system.push(text);continue;}
    if(message.role==='tool'){
      if(typeof message.tool_call_id!=='string'||!message.tool_call_id)throw Error('工具结果缺少调用 ID');
      appendTurn(turns,'user','content',[{type:'tool_result',tool_use_id:message.tool_call_id,content:textContent(message.content),...(message.is_error===true?{is_error:true}:{})}]);continue;
    }
    if(!['user','assistant'].includes(message.role))throw Error('模型对话角色无效');
    let parts=message.role==='assistant'?nativeContent(message,'anthropic'):null;
    if(!parts){
      parts=[];const text=textContent(message.content);if(text)parts.push({type:'text',text});
      if(message.role==='assistant')for(const call of message.tool_calls||[]){
        if(typeof call.id!=='string'||!call.id||typeof call.function?.name!=='string')throw Error('工具调用格式无效');
        parts.push({type:'tool_use',id:call.id,name:call.function.name,input:argumentsObject(call.function.arguments)});
      }
    }
    appendTurn(turns,message.role,'content',parts);
  }
  const functions=functionTools(tools);
  return {model:config.model,max_tokens:4096,messages:turns,stream,...(system.length?{system:system.join('\n\n')}:{}),...(functions.length?{tools:functions.map(({name,description,schema})=>({name,...(description?{description}:{}),input_schema:schema})),tool_choice:{type:'auto'}}:{})};
}

function geminiRequest(messages,tools) {
  const contents=[],system=[],calls=new Map();
  for(const message of messages){
    if(message.role==='system'||message.role==='developer'){const text=textContent(message.content);if(text)system.push({text});continue;}
    if(message.role==='tool'){
      const call=calls.get(message.tool_call_id);if(!call)throw Error('工具结果找不到对应的模型调用');
      let result;try{result=JSON.parse(textContent(message.content));}catch{result=textContent(message.content);}
      const response=result&&typeof result==='object'&&!Array.isArray(result)?result:{result};
      appendTurn(contents,'user','parts',[{functionResponse:{name:call.name,...(call.nativeId?{id:call.nativeId}:{}),response}}]);continue;
    }
    if(!['user','assistant'].includes(message.role))throw Error('模型对话角色无效');
    let parts=message.role==='assistant'?nativeContent(message,'gemini'):null;
    if(message.role==='assistant'){
      const nativeCalls=(parts||[]).filter(part=>part.functionCall).map(part=>part.functionCall);
      for(const [index,call] of (message.tool_calls||[]).entries()){
        if(typeof call.id!=='string'||!call.id||typeof call.function?.name!=='string')throw Error('工具调用格式无效');
        const original=nativeCalls[index];
        if(original&&original.name!==call.function.name)throw Error('原生工具上下文与调用不一致');
        calls.set(call.id,{name:call.function.name,nativeId:original?.id});
      }
    }
    if(!parts){
      parts=[];const text=textContent(message.content);if(text)parts.push({text});
      if(message.role==='assistant')for(const call of message.tool_calls||[])parts.push({functionCall:{name:call.function.name,args:argumentsObject(call.function.arguments)}});
    }
    appendTurn(contents,message.role==='assistant'?'model':'user','parts',parts);
  }
  const functions=functionTools(tools);
  return {contents,...(system.length?{systemInstruction:{parts:system}}:{}),...(functions.length?{tools:[{functionDeclarations:functions.map(({name,description,schema})=>({name,...(description?{description}:{}),parametersJsonSchema:schema}))}],toolConfig:{functionCallingConfig:{mode:'AUTO'}}}:{})};
}

function normalizedMessage(provider,parts,{stopReason}={}) {
  const content=parts.filter(part=>provider==='anthropic'?part.type==='text':typeof part.text==='string'&&!part.thought).map(part=>part.text).join('');
  if(['max_tokens','MAX_TOKENS'].includes(stopReason)&&parts.some(part=>provider==='anthropic'?part.type==='tool_use':part.functionCall))throw Error(labels[provider]+' 工具调用因输出上限被截断，请重试');
  const calls=parts.filter(part=>provider==='anthropic'?part.type==='tool_use':part.functionCall).map(part=>{
    const value=provider==='anthropic'?part:part.functionCall;
    if(typeof value.name!=='string'||!value.name)throw Error('原生响应的工具调用缺少名称');
    if(provider==='anthropic'&&(typeof value.id!=='string'||!value.id)||value.id!==undefined&&(typeof value.id!=='string'||!value.id))throw Error('原生响应的工具调用 ID 无效');
    return {id:value.id||'call_'+randomUUID().replaceAll('-',''),type:'function',function:{name:value.name,arguments:JSON.stringify(argumentsObject(provider==='anthropic'?value.input:value.args))}};
  });
  if(!content&&!calls.length)throw Error(labels[provider]+' 未返回文本或工具调用');
  return {role:'assistant',content,...(calls.length?{tool_calls:calls}:{}),_astrixNative:{provider,content:copy(parts)}};
}

async function boundedJson(response) {
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>MAX_RESPONSE_BYTES)throw Error('模型单轮响应超过 8 MB');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('原生模型未返回有效 JSON');}
}
async function sse(response,receive) {
  let buffer='',bytes=0,data=[];const decoder=new TextDecoder();
  const dispatch=()=>{if(!data.length)return;const value=data.join('\n');data=[];if(value.trim()==='[DONE]')return;let event;try{event=JSON.parse(value);}catch{throw Error('原生模型流包含无效 JSON');}receive(event);};
  const line=value=>{if(!value){dispatch();return;}if(value.startsWith('data:'))data.push(value.slice(5).replace(/^ /,''));};
  for await(const chunk of response.body){
    bytes+=chunk.length;if(bytes>MAX_RESPONSE_BYTES)throw Error('模型单轮响应超过 8 MB');
    buffer+=decoder.decode(chunk,{stream:true});let end;
    while((end=buffer.indexOf('\n'))>=0){line(buffer.slice(0,end).replace(/\r$/,''));buffer=buffer.slice(end+1);}
  }
  buffer+=decoder.decode();if(buffer)line(buffer.replace(/\r$/,''));dispatch();
}
async function claudeStream(response,onDelta) {
  const blocks=new Map(),partialInputs=new Map(),open=new Set();let complete=false,stopReason;
  await sse(response,event=>{
    if(event?.type==='error'||event?.error)throw Error('Claude 模型流返回错误');
    if(event.type==='content_block_start'){
      if(!Number.isInteger(event.index)||!event.content_block||open.has(event.index)||blocks.has(event.index))throw Error('Claude 模型流的内容块无效');
      blocks.set(event.index,copy(event.content_block));open.add(event.index);
      if(event.content_block.type==='text'&&event.content_block.text)onDelta(event.content_block.text);
    }else if(event.type==='content_block_delta'){
      const block=blocks.get(event.index),delta=event.delta;if(!block||!open.has(event.index)||!delta)throw Error('Claude 模型流的内容块无效');
      if(delta.type==='text_delta'){block.text=(block.text||'')+(delta.text||'');if(delta.text)onDelta(delta.text);}
      else if(delta.type==='input_json_delta')partialInputs.set(event.index,(partialInputs.get(event.index)||'')+(delta.partial_json||''));
      else if(delta.type==='thinking_delta')block.thinking=(block.thinking||'')+(delta.thinking||'');
      else if(delta.type==='signature_delta')block.signature=(block.signature||'')+(delta.signature||'');
    }else if(event.type==='content_block_stop'){
      if(!open.delete(event.index))throw Error('Claude 模型流的内容块无效');
      if(partialInputs.has(event.index))blocks.get(event.index).input=argumentsObject(partialInputs.get(event.index));
    }else if(event.type==='message_delta')stopReason=event.delta?.stop_reason??stopReason;
    else if(event.type==='message_stop')complete=true;
  });
  if(!complete||open.size)throw Error('Claude 模型流未完整结束，请重试');
  return normalizedMessage('anthropic',[...blocks.entries()].sort((a,b)=>a[0]-b[0]).map(([,block])=>block),{stopReason});
}
function geminiCandidate(event) {
  if(event?.error)throw Error('Gemini 模型返回错误');
  if(event?.promptFeedback?.blockReason)throw Error('Gemini 拒绝了当前请求');
  const candidate=event.candidates?.find(value=>value.index===0)??event.candidates?.[0];
  if(candidate?.finishReason&&!['STOP','MAX_TOKENS','FINISH_REASON_UNSPECIFIED'].includes(candidate.finishReason))throw Error('Gemini 未正常完成当前请求');
  return candidate;
}
async function geminiStream(response,onDelta) {
  const parts=[];let complete=false,stopReason;
  await sse(response,event=>{
    const candidate=geminiCandidate(event);if(!candidate)return;
    if(candidate.finishReason&&candidate.finishReason!=='FINISH_REASON_UNSPECIFIED'){complete=true;stopReason=candidate.finishReason;}
    for(const part of candidate.content?.parts||[]){parts.push(copy(part));if(typeof part.text==='string'&&!part.thought&&part.text)onDelta(part.text);}
  });
  if(!complete)throw Error('Gemini 模型流未完整结束，请重试');
  return normalizedMessage('gemini',parts,{stopReason});
}

export async function nativeModelCompletion(config,messages,tools,signal,onDelta) {
  const provider=config.provider;if(!labels[provider])throw Error('未知原生 API 协议');
  if(typeof config.model!=='string'||!config.model.trim())throw Error('请先填写模型名称');
  const headers={'content-type':'application/json'};
  if(provider==='anthropic'){headers['anthropic-version']='2023-06-01';if(config.apiKey)headers['x-api-key']=config.apiKey;}
  else if(config.apiKey)headers['x-goog-api-key']=config.apiKey;
  const response=await fetch(nativeModelUrl(config,{stream:Boolean(onDelta)}),{
    method:'POST',headers,redirect:'error',credentials:'omit',cache:'no-store',body:JSON.stringify(provider==='anthropic'?claudeRequest(config,messages,tools,Boolean(onDelta)):geminiRequest(messages,tools)),
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)
  });
  if(!response.ok)throw Error(`${labels[provider]} 服务返回 HTTP ${response.status}；请检查 API 协议、地址、模型与密钥`);
  if(onDelta&&response.headers.get('content-type')?.includes('text/event-stream'))return provider==='anthropic'?claudeStream(response,onDelta):geminiStream(response,onDelta);
  const data=await boundedJson(response);
  if(data?.error)throw Error(labels[provider]+' 模型返回错误');
  const candidate=provider==='gemini'?geminiCandidate(data):null;
  const parts=provider==='anthropic'?data.content:candidate?.content?.parts;
  if(!Array.isArray(parts))throw Error(labels[provider]+' 响应缺少模型内容');
  const message=normalizedMessage(provider,parts,{stopReason:provider==='anthropic'?data.stop_reason:candidate?.finishReason});if(onDelta&&message.content)onDelta(message.content);return message;
}
