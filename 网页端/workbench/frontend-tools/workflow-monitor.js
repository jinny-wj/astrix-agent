/* Observe actual workflow events. Original bytes and stream cancellation pass
 * through unchanged; the optional progress panel never consumes model output. */
(() => {
  'use strict';
  if(!window.ReadableStream||window.__M0_WORKFLOW_MONITOR__)return;
  window.__M0_WORKFLOW_MONITOR__=true;
  const sourceFetch=window.fetch.bind(window);
  let panel,heading,body,toggle,stop,currentSession='',currentRun='',currentContext,collapsed=false;
  const steps=new Map();
  function create(){
    if(panel)return;
    const style=document.createElement('style');
    style.textContent='.m0-workflow-panel{position:fixed;right:25px;top:116px;width:min(335px,calc(100vw - 50px));z-index:2147483600;background:#fffffff5;border:1px solid #e5e1f2;border-radius:10px;box-shadow:0 5px 24px #35255c12;color:#464353;font:12px -apple-system,sans-serif}.m0-workflow-panel>header{display:flex;align-items:center;gap:8px;padding:10px 12px}.m0-workflow-panel strong{flex:1;font-size:12px}.m0-workflow-panel button{border:0;background:none;color:#8975be;font:inherit;cursor:pointer;padding:2px}.m0-workflow-panel main{padding:0 12px 10px;max-height:280px;overflow:auto}.m0-workflow-panel article{display:flex;gap:8px;justify-content:space-between;border-top:1px solid #f0edf6;padding:9px 0}.m0-workflow-panel article small{color:#898291;white-space:nowrap}.m0-workflow-panel article[data-status=running]{color:#7650cb}.m0-workflow-panel article[data-status=completed] small{color:#429468}';
    document.head.append(style);panel=document.createElement('section');panel.className='m0-workflow-panel';panel.setAttribute('role','region');panel.setAttribute('aria-label','多 Agent 执行进度');
    const header=document.createElement('header');heading=document.createElement('strong');heading.textContent='多 Agent 协作';stop=document.createElement('button');stop.textContent='停止';stop.onclick=async()=>{const context=currentContext,session=currentSession;if(session&&context&&!context.finished){stop.disabled=true;try{const response=await sourceFetch('/api/agent/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:session})});if(!response.ok)throw Error('stop failed');const result=await response.json();if(context!==currentContext||context.finished)return;if(result.success===false)finish(context,'cancelled','没有运行中的任务');else heading.textContent='正在停止协作…';}catch{if(context!==currentContext||context.finished)return;heading.textContent='停止失败，请重试';stop.disabled=false;}}};
    toggle=document.createElement('button');toggle.textContent='收起';toggle.onclick=()=>{collapsed=!collapsed;body.hidden=collapsed;toggle.textContent=collapsed?'展开':'收起';};body=document.createElement('main');header.append(heading,stop,toggle);panel.append(header,body);document.body.append(panel);
  }
  function receive(event,context){
    if(event.type==='RUN_STARTED'){context.session=event.threadId;return;}
    if(event.type==='CUSTOM'&&event.name==='local-workflow'){
      create();currentSession=context.session||event.value?.sessionId||'';currentContext=context;context.active=true;
      const value=event.value||{};context.session||=value.sessionId||'';
      context.run=value.runId;if(value.runId!==currentRun){currentRun=value.runId;steps.clear();collapsed=false;body.hidden=false;toggle.textContent='收起';}
      heading.textContent='多 Agent 正在协作';stop.hidden=false;stop.disabled=false;
      steps.set(value.id,{...steps.get(value.id),...value});body.replaceChildren();
      const names={running:'进行中',completed:'完成',error:'失败',cancelled:'已停止',skipped:'已跳过'};
      for(const step of steps.values()){const item=document.createElement('article');item.dataset.status=step.status;const name=document.createElement('span');name.textContent=step.title||step.role;const status=document.createElement('small');status.textContent=names[step.status]||step.status;item.append(name,status);body.append(item);}
      return;
    }
    if(event.type==='RUN_FINISHED')finish(context,'completed','多 Agent 协作完成');
    else if(event.type==='RUN_ERROR')finish(context,/^(?:多 Agent )?任务已停止$/.test(String(event.message||''))?'cancelled':'error',event.message||'多 Agent 已停止');
  }
  function finish(context,status,message){
    if(!context?.active||context.finished)return;context.finished=true;
    if(!panel||context.session!==currentSession||context.run!==currentRun)return;
    heading.textContent=message;stop.hidden=true;
    if(status!=='completed')for(const step of steps.values())if(step.status==='running')step.status=status;
    const names={completed:'完成',error:'已中断',cancelled:'已停止'};
    for(const item of body.children)if(item.dataset.status==='running'&&status!=='completed'){item.dataset.status=status;item.querySelector('small').textContent=names[status]||status;}
  }
  function watch(response){
    if(!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))return response;
    const context={session:'',active:false,finished:false},decoder=new TextDecoder(),reader=response.body.getReader();let buffer='',cancelled=false;
    const release=()=>{try{reader.releaseLock();}catch{}};
    function consume(chunk){
      try{
        buffer+=decoder.decode(chunk,{stream:true});let newline;
        while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline).replace(/\r$/,'');buffer=buffer.slice(newline+1);if(line.startsWith('data:'))try{receive(JSON.parse(line.slice(5).trim()),context);}catch{}}
        if(buffer.length>1024*1024)buffer='';
      }catch{/* Optional progress never interrupts a chat response. */}
    }
    const observed=new ReadableStream({async pull(controller){
      try{const {value,done}=await reader.read();if(cancelled)return;if(done){finish(context,'error','协作连接已结束');controller.close();release();return;}consume(value);controller.enqueue(value);}
      catch(error){if(cancelled)return;finish(context,error.name==='AbortError'?'cancelled':'error',error.name==='AbortError'?'多 Agent 任务已停止':'协作连接已中断');controller.error(error);release();}
    },async cancel(reason){cancelled=true;finish(context,'cancelled','多 Agent 任务已停止');try{await reader.cancel(reason);}finally{release();}}});
    const wrapped=new Response(observed,{status:response.status,statusText:response.statusText,headers:response.headers});
    for(const key of ['url','redirected','type'])Object.defineProperty(wrapped,key,{value:response[key]});
    return wrapped;
  }
  const monitored=async(input,init)=>{
    const response=await sourceFetch(input,init);
    try{const url=new URL(input instanceof Request?input.url:String(input),location.href);if(/(?:\/agent\/chat|\/__local\/chat|\/__local\/workflow\/run)$/.test(url.pathname))return watch(response);}catch{}
    return response;
  };
  window.fetch=monitored;window.nativeFetch=monitored;
})();
