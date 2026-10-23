import http from 'node:http';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';

/** Per-run gateway: the recovered engine cannot exceed its forwarded model
 * request budget even if that version ignores its agent.steps configuration. */
export async function createModelGateway({config,maxRequests=12,signal}){
  signal?.throwIfAborted();
  const key=randomBytes(24).toString('hex');
  const limit=Math.max(1,Math.min(40,Math.floor(Number(maxRequests)||12)));
  const stats={maxRequests:limit,forwardedRequests:0,deniedRequests:0};
  const active=new Set();
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
      const headers={'content-type':'application/json'};
      if(config.apiKey)headers.authorization='Bearer '+config.apiKey;
      const response=await fetch(config.baseUrl.replace(/\/$/,'')+'/chat/completions',{
        method:'POST',headers,body,
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
    async close(){if(closed)return;closed=true;for(const controller of active)controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  };
}
