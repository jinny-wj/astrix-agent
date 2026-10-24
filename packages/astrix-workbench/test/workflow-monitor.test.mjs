import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../../../网页端/workbench/frontend-tools/workflow-monitor.js',import.meta.url),'utf8');
const encoder=new TextEncoder();
function monitor({stopStatus=200,stopFailure,stopResponse}={}){
  const elements=[],calls=[];
  function element(tag){
    const value={tag,children:[],textContent:'',hidden:false,disabled:false,dataset:{},
      setAttribute(){},append(...children){this.children.push(...children);},
      replaceChildren(...children){this.children=[...children];},
      querySelector(selector){for(const child of this.children){if(child.tag===selector)return child;const nested=child.querySelector?.(selector);if(nested)return nested;}return null;}};
    elements.push(value);return value;
  }
  const document={head:element('head'),body:element('body'),createElement:element};
  let upstream,cancelled=false,cancelReason;
  const makeResponse=()=>new Response(new ReadableStream({start(controller){upstream=controller;},cancel(reason){cancelled=true;cancelReason=reason;}}),{headers:{'content-type':'text/event-stream'}});
  let original=makeResponse(),responseUsed=false;
  const window={TransformStream,ReadableStream,fetch:async(input,init)=>{
    const pathname=new URL(input instanceof Request?input.url:String(input),'http://127.0.0.1:4317').pathname;
    calls.push({pathname,init});
    if(pathname==='/api/agent/stop'){
      if(stopFailure)throw stopFailure;
      if(stopResponse)return stopResponse();
      return new Response(JSON.stringify({success:stopStatus===200,error:stopStatus===200?undefined:'stop failed'}),{status:stopStatus,headers:{'content-type':'application/json'}});
    }
    if(responseUsed)original=makeResponse();responseUsed=true;return original;
  }};
  vm.runInNewContext(source,{window,document,Response,Request,TransformStream,ReadableStream,TextDecoder,URL,location:{href:'http://127.0.0.1:4317/home'}});
  const emit=(...events)=>upstream.enqueue(encoder.encode(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')));
  return {window,emit,calls,original,
    close:()=>upstream.close(),error:error=>upstream.error(error),
    get cancelled(){return cancelled;},get cancelReason(){return cancelReason;},
    get heading(){return elements.find(item=>item.tag==='strong');},
    get stop(){return elements.find(item=>item.tag==='button');},
    get steps(){return elements.find(item=>item.tag==='main')?.children||[];},
  };
}
const running=(session='monitor-session',runId='monitor-run')=>[
  {type:'RUN_STARTED',threadId:session,runId:'chat-run'},
  {type:'CUSTOM',name:'local-workflow',value:{id:runId+':plan',runId,sessionId:session,role:'planner',title:'规划与分工',status:'running'}},
];
async function start(harness,session='monitor-session',runId='monitor-run'){const response=await harness.window.fetch('/api/agent/chat');const reader=response.body.getReader();harness.emit(...running(session,runId));await reader.read();assert.match(harness.heading.textContent,/正在协作/);return reader;}
function settled(harness){assert.doesNotMatch(harness.heading.textContent,/正在协作/);assert.ok(harness.steps.every(step=>step.dataset.status!=='running'));}

test('chat reader cancellation settles progress and propagates to the original body',async()=>{
  const h=monitor(),reader=await start(h);
  await reader.cancel('user cancelled');
  assert.equal(h.cancelled,true);assert.equal(h.cancelReason,'user cancelled');settled(h);
  assert.ok(h.steps.every(step=>step.dataset.status==='cancelled'));assert.equal(h.stop.hidden,true);
});

test('an upstream stream error remains observable and settles workflow progress',async()=>{
  const h=monitor(),reader=await start(h),failure=new Error('network-disconnected-proof');
  h.error(failure);
  await assert.rejects(reader.read(),error=>error===failure);settled(h);assert.equal(h.stop.hidden,true);
});

test('EOF without a terminal event does not leave a running panel or claim success',async()=>{
  const h=monitor(),reader=await start(h);h.close();assert.equal((await reader.read()).done,true);
  settled(h);assert.doesNotMatch(h.heading.textContent,/协作完成/);assert.equal(h.stop.hidden,true);
});

test('normal completion survives subsequent EOF and preserves original response bytes',async()=>{
  const h=monitor(),response=await h.window.fetch('/api/agent/chat'),reader=response.body.getReader();
  const events=[...running(),{type:'CUSTOM',name:'local-workflow',value:{id:'monitor-run:plan',runId:'monitor-run',role:'planner',title:'规划与分工',status:'completed'}},{type:'RUN_FINISHED',threadId:'monitor-session',runId:'chat-run'}];
  h.emit(...events);const chunk=(await reader.read()).value;
  assert.equal(new TextDecoder().decode(chunk),events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''));
  h.close();assert.equal((await reader.read()).done,true);assert.match(h.heading.textContent,/协作完成/);
  assert.equal(h.steps[0].dataset.status,'completed');assert.equal(h.stop.hidden,true);assert.equal(h.cancelled,false);
});

for(const failure of ['http','network'])test('stop '+failure+' failure keeps a usable retry button',async()=>{
  const h=monitor(failure==='http'?{stopStatus:500}:{stopFailure:new Error('stop-network-failure')}),reader=await start(h);
  await h.stop.onclick();
  assert.equal(h.stop.disabled,false);assert.equal(h.stop.hidden,false);
  assert.ok(h.calls.some(call=>call.pathname==='/api/agent/stop'&&JSON.parse(call.init.body).sessionId==='monitor-session'));
  assert.doesNotMatch(h.heading.textContent,/协作完成/);
  await reader.cancel();
});

test('a late stop response from an older stream cannot finish a newer workflow panel',async()=>{
  let respond;
  const h=monitor({stopResponse:()=>new Promise(resolve=>respond=resolve)}),oldReader=await start(h,'old-session','old-run');
  const stopping=h.stop.onclick();
  const newReader=await start(h,'new-session','new-run');
  respond(new Response(JSON.stringify({success:false}),{headers:{'content-type':'application/json'}}));
  await stopping;
  assert.match(h.heading.textContent,/正在协作/);assert.equal(h.stop.hidden,false);assert.equal(h.steps[0].dataset.status,'running');
  const stopCall=h.calls.find(call=>call.pathname==='/api/agent/stop');assert.equal(JSON.parse(stopCall.init.body).sessionId,'old-session');
  await oldReader.cancel();assert.match(h.heading.textContent,/正在协作/);await newReader.cancel();
});

test('a late successful stop response cannot overwrite an already completed run',async()=>{
  let respond;
  const h=monitor({stopResponse:()=>new Promise(resolve=>respond=resolve)}),reader=await start(h);
  const stopping=h.stop.onclick();
  h.emit({type:'RUN_FINISHED',threadId:'monitor-session',runId:'chat-run'});await reader.read();
  respond(new Response(JSON.stringify({success:true}),{headers:{'content-type':'application/json'}}));
  await stopping;assert.match(h.heading.textContent,/协作完成/);assert.equal(h.stop.hidden,true);
  h.close();await reader.read();
});
