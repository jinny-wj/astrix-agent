import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./clarification-monitor.js',import.meta.url),'utf8');
const events = values => values.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('');
const sse = values => new Response(events(values),{headers:{'content-type':'text/event-stream'}});
const pending = (sessionId = 'session-one',projectId = '1') => ({id:'question-one',taskId:'task-one',sessionId,projectId,status:'awaiting_user',originalRequest:'把原标题改成新标题',questions:[{id:'title',prompt:'新标题改成什么？',required:true,options:['秋日活动','本周战报']}]});
const snapshot = (status = 'awaiting_user',sessionId = 'session-one',projectId = '1') => ({sessionId,projectId,taskId:'task-one',status,originalRequest:'把原标题改成新标题',pending:status === 'awaiting_user' ? pending(sessionId,projectId) : null,messages:[{id:'original',role:'user',content:'把原标题改成新标题'}]});
function harness({stored = new Map(),url = 'http://127.0.0.1:5273/aicode-v2?id=1',responder} = {}) {
  const elements = [], calls = [], listeners = new Map();
  function element(tag) {
    const item = {tag,children:[],textContent:'',hidden:false,disabled:false,value:'',dataset:{},attributes:{},
      setAttribute(name,value){this.attributes[name] = value;},append(...items){this.children.push(...items);},replaceChildren(...items){this.children = [...items];},focus(){this.focused = true;}};
    elements.push(item); return item;
  }
  const location = {href:url}, document = {head:element('head'),body:element('body'),createElement:element,readyState:'complete'};
  const history = {pushState(_state,_title,next){if(next)location.href = new URL(next,location.href).href;},replaceState(_state,_title,next){if(next)location.href = new URL(next,location.href).href;}};
  let handler = responder || (() => sse([]));
  const window = {ReadableStream,crypto:{randomUUID:()=> 'request-proof'},fetch:async(input,init) => {const target = new URL(input instanceof Request ? input.url : String(input),location.href);const call = {url:target,pathname:target.pathname,init,body:typeof init?.body === 'string' ? JSON.parse(init.body) : null};calls.push(call);return handler(call);}};
  vm.runInNewContext(source,{window,document,Response,Request,ReadableStream,TextDecoder,URL,location,history,localStorage:{getItem:key=>stored.get(key) || null,setItem:(key,value)=>stored.set(key,value)},structuredClone,addEventListener:(name,callback)=>listeners.set(name,callback)});
  const settle = async() => {for(let i = 0;i < 8;i++)await new Promise(resolve=>setImmediate(resolve));};
  return {window,document,elements,calls,stored,location,history,settle,
    setResponder:fn=>{handler = fn;},
    button:label=>elements.filter(item=>item.tag === 'button' && item.textContent === label).at(-1),
    field:()=>elements.filter(item=>item.tag === 'textarea').at(-1),
    panel:()=>elements.find(item=>item.tag === 'section'),
    heading:()=>elements.find(item=>item.tag === 'strong'),
    state:()=>window.astrixClarification.getState(),
  };
}
async function openPending(h,sessionId = 'session-one',projectId = '1') {
  h.setResponder(call => call.pathname === '/__local/chat' ? sse([{type:'RUN_STARTED',threadId:sessionId},{type:'CUSTOM',name:'local-clarification',value:pending(sessionId,projectId)},{type:'RUN_FINISHED',threadId:sessionId}]) : new Response(JSON.stringify(snapshot('awaiting_user',sessionId,projectId))));
  await (await h.window.fetch('/__local/chat',{method:'POST',body:JSON.stringify({sessionId,projectId,message:'把原标题改成新标题'})})).text();
  assert.equal(h.state().status,'awaiting_user');
}

test('observes clarification without altering SSE bytes or original response headers',async() => {
  const values = [{type:'RUN_STARTED',threadId:'session-one'},{type:'CUSTOM',name:'local-clarification',value:pending()},{type:'RUN_FINISHED'}];
  const h = harness({responder:()=>sse(values)});
  const response = await h.window.fetch('/api/agent/chat',{method:'POST',body:JSON.stringify({sessionId:'session-one',projectId:1,message:'改标题'})});
  assert.equal(await response.text(),events(values));
  assert.match(response.headers.get('content-type'),/event-stream/);
  assert.equal(h.heading().textContent,'等待你补充需求');assert.equal(h.field().attributes['aria-label'],'新标题改成什么？');
  assert.deepEqual(JSON.parse(h.stored.get('astrix-clarification-session:1')),{sessionId:'session-one',projectId:1});
});

test('required answers block submission; options fill editable fields',async() => {
  const h = harness();await openPending(h);
  const count = h.calls.length;h.button('补充并继续').onclick();await h.settle();assert.equal(h.calls.length,count);assert.equal(h.field().focused,true);
  h.button('秋日活动').onclick();assert.equal(h.field().value,'秋日活动');
});

test('answer continues original session once and ready never claims execution',async() => {
  const h = harness();await openPending(h);
  h.setResponder(call => call.pathname.endsWith('/session-one') ? new Response(JSON.stringify(snapshot('ready'))) : sse([{type:'RUN_STARTED',threadId:'session-one'},{type:'CUSTOM',name:'local-conversation',value:snapshot('running')},{type:'TEXT_MESSAGE_CONTENT',delta:'需求已补齐，尚未配置模型。'},{type:'CUSTOM',name:'local-conversation',value:snapshot('ready')},{type:'RUN_FINISHED',threadId:'session-one'}]));
  h.field().value = '秋日活动';h.field().oninput();h.button('补充并继续').onclick();h.button('补充并继续')?.onclick();await h.settle();
  const requests = h.calls.filter(call=>call.body?.clarificationAnswer);assert.equal(requests.length,1);
  assert.deepEqual(requests[0].body,{sessionId:'session-one',projectId:'1',requestId:'request-proof',message:'新标题改成什么？：秋日活动',clarificationAnswer:{id:'question-one',answers:{title:'秋日活动'}}});
  assert.equal(h.state().status,'ready');assert.equal(h.state().pending,null);assert.match(h.heading().textContent,/等待配置模型/);assert.doesNotMatch(h.heading().textContent,/完成/);
  assert.equal(h.state().messages[0].content,'把原标题改成新标题');
});

test('refresh restores pending task and transcript with identifiers only in local storage',async() => {
  const stored = new Map([['astrix-clarification-session:1',JSON.stringify({sessionId:'session-one',projectId:'1'})]]);
  const h = harness({stored,responder:call => {assert.equal(call.pathname,'/__local/conversations/session-one');assert.equal(call.url.searchParams.get('projectId'),'1');return new Response(JSON.stringify(snapshot()));}});
  await h.settle();assert.equal(h.state().status,'awaiting_user');assert.equal(h.field().attributes['aria-label'],'新标题改成什么？');
  assert.doesNotMatch([...stored.values()].join(''),/原任务|原标题|附件/);assert.equal(h.state().messages.length,1);
});

test('refresh after answers shows ready state and the saved original task',async() => {
  const stored = new Map([['astrix-clarification-session:1',JSON.stringify({sessionId:'session-one',projectId:'1'})]]);
  const h = harness({stored,responder:()=>new Response(JSON.stringify(snapshot('ready')))});
  await h.settle();assert.equal(h.state().status,'ready');assert.equal(h.panel().hidden,false);assert.match(h.heading().textContent,/等待配置模型/);assert.equal(h.state().originalRequest,'把原标题改成新标题');
});

test('refresh keeps interrupted tasks visible with their original request',async()=>{
  const stored=new Map([['astrix-clarification-session:1',JSON.stringify({sessionId:'session-one',projectId:'1'})]]);
  const h=harness({stored,responder:()=>new Response(JSON.stringify({...snapshot('interrupted'),error:'连接中断，原任务已保留'}))});
  await h.settle();assert.equal(h.panel().hidden,false);assert.match(h.heading().textContent,/原任务已保留/);assert.equal(h.state().originalRequest,'把原标题改成新标题');
});

test('project and same-project conversation navigation hide stale tasks',async() => {
  const h = harness();await openPending(h);
  h.setResponder(()=>new Response('{}',{status:404}));
  h.history.pushState({},'','/aicode-v2?id=2');await h.settle();assert.equal(h.panel().hidden,true);assert.equal(h.state(),null);
  h.history.pushState({},'','/aicode-v2?id=1&sessionId=other-session');await h.settle();assert.equal(h.panel().hidden,true);assert.equal(h.state(),null);
  assert.equal(h.calls.at(-1).pathname,'/__local/conversations/other-session');
});

test('a late stream cannot replace the newer conversation task',async() => {
  let upstream;
  const h = harness({responder:()=>new Response(new ReadableStream({start(controller){upstream = controller;}}),{headers:{'content-type':'text/event-stream'}})});
  const old = await h.window.fetch('/__local/chat',{method:'POST',body:JSON.stringify({sessionId:'old-session',projectId:'1',message:'旧任务'})}), reader = old.body.getReader();
  const oldUpstream = upstream;
  await openPending(h,'new-session');
  oldUpstream.enqueue(new TextEncoder().encode(events([{type:'RUN_STARTED',threadId:'old-session'},{type:'CUSTOM',name:'local-clarification',value:pending('old-session')}])));await reader.read();
  assert.equal(h.state().sessionId,'new-session');await reader.cancel();
});

test('cancel is a task operation and starting new task flags only the next chat',async() => {
  const h = harness();await openPending(h);
  h.setResponder(call => call.pathname.endsWith('/cancel') ? new Response(JSON.stringify(snapshot('cancelled'))) : sse([{type:'RUN_STARTED',threadId:'session-one'},{type:'CUSTOM',name:'local-conversation',value:snapshot('ready')},{type:'RUN_FINISHED'}]));
  await h.button('开始新任务').onclick();assert.equal(h.state().status,'cancelled');
  assert.equal(h.calls.at(-1).pathname,'/__local/conversations/session-one/cancel');
  await (await h.window.fetch('/__local/chat',{method:'POST',body:JSON.stringify({sessionId:'session-one',projectId:'1',message:'新的任务'})})).text();
  assert.equal(h.calls.at(-1).body.newTask,true);
  await (await h.window.fetch('/__local/chat',{method:'POST',body:JSON.stringify({sessionId:'session-one',projectId:'1',message:'继续'})})).text();
  assert.equal(h.calls.at(-1).body.newTask,undefined);
});

test('cancelling the wrapped stream propagates to upstream',async() => {
  let reason;
  const h = harness({responder:()=>new Response(new ReadableStream({cancel(value){reason = value;}}),{headers:{'content-type':'text/event-stream'}})});
  const response = await h.window.fetch('/__local/chat',{method:'POST',body:'{}'});await response.body.cancel('user-stopped-proof');assert.equal(reason,'user-stopped-proof');
});

test('prepare script injects and copies the shared monitor for both Workbench hosts',() => {
  const prepare = fs.readFileSync(new URL('./prepare-frontend.mjs',import.meta.url),'utf8');
  assert.match(prepare,/<script src="\/clarification-monitor\.js" defer><\/script>/);
  assert.match(prepare,/copyFile\(path\.join\(here, 'clarification-monitor\.js'\), path\.join\(publicRoot, 'clarification-monitor\.js'\)\)/);
});
