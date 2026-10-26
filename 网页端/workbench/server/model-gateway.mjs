import http from 'node:http';
import {Readable} from 'node:stream';
import {randomBytes,randomUUID} from 'node:crypto';
import {modelCompletionUrl,modelCompletion} from './model.mjs';

function messageIdentity(message){
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  const argumentsOf=value=>{try{return stable(JSON.parse(value||'{}'));}catch{return value;}};
  const text=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.filter(part=>part.type==='text').map(part=>part.text).join(''):'';
  return JSON.stringify([text,(message.tool_calls||[]).map(call=>[call.id,call.function?.name,argumentsOf(call.function?.arguments)])]);
}

/** Per-run gateway: the recovered engine cannot exceed its forwarded model
 * request budget even if that version ignores its agent.steps configuration. */
export async function createModelGateway({config,maxRequests=12,signal}){
  signal?.throwIfAborted();
  const key=randomBytes(24).toString('hex');
  const limit=Math.max(1,Math.min(40,Math.floor(Number(maxRequests)||12)));
  const stats={maxRequests:limit,forwardedRequests:0,deniedRequests:0};
  const active=new Set();
  // Provider blocks (including Gemini thought signatures) stay inside this
  // authenticated run; the recovered OpenAI client only receives its own schema.
  const nativeHistory=new Map();let nativeHistoryBytes=0;
  const server=http.createServer(async(req,res)=>{
    const error=(status,message,code='LOCAL_MODEL_ERROR')=>{if(res.headersSent){res.end();return;}res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:{message,type:'local_runtime_error',code}}));};
    if(req.headers.origin||req.headers.authorization!=='Bearer '+key)return error(403,'This model gateway belongs to a local engine run');
    if(req.method!=='POST'||req.url!=='/v1/chat/completions')return error(404,'Unknown model gateway route');
    const abort=new AbortController();active.add(abort);
    res.on('close',()=>{if(!res.writableEnded)abort.abort();});
    try{
      const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>10*1024*1024)return error(413,'Model request exceeds 10 MB');chunks.push(chunk);}const body=Buffer.concat(chunks).toString('utf8');
      const parsed=JSON.parse(body);
      if(parsed.model!==config.model)return error(400,'Unexpected model selected by engine');
      if(stats.forwardedRequests>=limit){stats.deniedRequests++;return error(400,`本角色已达到 ${limit} 次模型请求预算，工作流已停止。`,'M0_LOCAL_BUDGET_EXCEEDED');}
      if(signal?.aborted)return error(400,'任务已停止','LOCAL_CANCELLED');
      stats.forwardedRequests++;
      if(config.provider&&config.provider!=='openai'){
        if(!Array.isArray(parsed.messages))return error(400,'Model messages must be an array');
        let assistantOrdinal=0;
        const messages=parsed.messages.map(value=>{
          const {_astrixNative,...message}=value;
          const retained=message.role==='assistant'?nativeHistory.get(assistantOrdinal+':'+messageIdentity(message)):null;
          if(message.role==='assistant')assistantOrdinal++;
          return retained?{...message,_astrixNative:retained.metadata}:message;
        });
        const id='chatcmpl-'+randomUUID(),created=Math.floor(Date.now()/1000),stream=parsed.stream===true;
        const chunk=(delta,finish_reason=null)=>({id,object:'chat.completion.chunk',created,model:config.model,choices:[{index:0,delta,finish_reason}]});
        const emit=data=>{if(!res.destroyed)res.write('data: '+JSON.stringify(data)+'\n\n');};
        let started=false;
        const start=()=>{if(started)return;started=true;res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store'});emit(chunk({role:'assistant',content:''}));};
        try{
          const message=await modelCompletion(config,messages,parsed.tools,AbortSignal.any([abort.signal,...(signal?[signal]:[])]),stream?text=>{start();emit(chunk({content:text}));}:undefined);
          if(message._astrixNative){
            const identity=assistantOrdinal+':'+messageIdentity(message),metadata=message._astrixNative;
            const bytes=Buffer.byteLength(identity)+Buffer.byteLength(JSON.stringify(metadata));
            const nextBytes=nativeHistoryBytes+bytes-(nativeHistory.get(identity)?.bytes||0);
            if(nextBytes>16*1024*1024)throw Error('Native model history exceeds the run limit');
            nativeHistory.set(identity,{metadata,bytes});nativeHistoryBytes=nextBytes;
          }
          const {_astrixNative,...visible}=message,finish=visible.tool_calls?.length?'tool_calls':'stop';
          if(stream){start();if(visible.tool_calls?.length)emit(chunk({tool_calls:visible.tool_calls.map((call,index)=>({index,...call}))}));emit(chunk({},finish));if(!res.destroyed)res.end('data: [DONE]\n\n');}
          else{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({id,object:'chat.completion',created,model:config.model,choices:[{index:0,message:visible,finish_reason:finish}]}));}
          return;
        }catch(failure){
          if(started){emit({error:{message:signal?.aborted||abort.signal.aborted?'模型请求已取消':'原生模型请求失败，请检查协议、地址与模型配置',type:'local_runtime_error'}});res.end();return;}
          throw failure;
        }
      }
      const headers={'content-type':'application/json'};
      if(config.apiKey)headers.authorization='Bearer '+config.apiKey;
      const response=await fetch(modelCompletionUrl(config.baseUrl),{
        method:'POST',headers,body,redirect:'error',credentials:'omit',cache:'no-store',
        signal:AbortSignal.any([abort.signal,AbortSignal.timeout(120000),...(signal?[signal]:[])])
      });
      res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'});
      if(!response.body)return res.end();
      await new Promise((resolve,reject)=>{
        const stream=Readable.fromWeb(response.body);stream.on('error',reject);res.on('error',reject);res.on('close',resolve);res.on('finish',resolve);stream.pipe(res);
      });
    }catch(failure){error(400,signal?.aborted?'任务已停止':abort.signal.aborted?'模型请求已取消':'模型服务请求失败，请检查已配置的服务地址。');}
    finally{active.delete(abort);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let closed=false;
  return {baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:key,stats,
    async close(){if(closed)return;closed=true;nativeHistory.clear();nativeHistoryBytes=0;for(const controller of active)controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  };
}
