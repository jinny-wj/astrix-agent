import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {figmaOAuthStartPath,homeConnectionPositions} from '../../../网页端/workbench/frontend-tools/home-connections.js';

test('home Figma connection keeps the exact existing OAuth completion and per-surface handoff',()=>{
  for(const desktop of [false,true]){
    const path=figmaOAuthStartPath(desktop),url=new URL(path,'http://127.0.0.1:'+(desktop?4317:5273));
    assert.equal(url.pathname,'/api/auth/figma/start');
    assert.equal(url.searchParams.get('returnTo'),'/figma-oauth-complete.html');
    assert.deepEqual([...url.searchParams.keys()].sort(),['returnTo',desktop?'handoff':'direct'].sort());
    assert.equal(url.searchParams.get(desktop?'handoff':'direct'),'1');
  }
});

test('account and model buttons stay separate from the mode switch and wrap on a narrow screen',()=>{
  for(const [viewport,figmaWidth,modelWidth,mode] of [[1440,245,98,{left:1180,right:1325,top:28,bottom:64,width:145,height:36}],[390,184,90,{left:218,right:374,top:28,bottom:64,width:156,height:36}],[320,184,90,{left:159,right:304,top:28,bottom:64,width:145,height:36}]]){
    const p=homeConnectionPositions({viewport,mode,figmaWidth,modelWidth});
    const figma={left:viewport-p.figmaRight-figmaWidth,right:viewport-p.figmaRight};
    const model={left:viewport-p.modelRight-modelWidth,right:viewport-p.modelRight};
    assert.ok(model.right<figma.left);assert.ok(model.left>=16);
    assert.ok(figma.right<=viewport-16);
    assert.ok(figma.right<mode.left||p.top>=mode.bottom);
  }
});

function homeHarness({desktop=false,session={configured:true,authenticated:false},respond}={}) {
  const nodes=new Map(),opens=[],listeners=new Map(),documentListeners=new Map(),intervals=new Map(),calls=[];
  let intervalId=0,current=session,responder=respond;
  const model={style:{},getBoundingClientRect:()=>({width:98,height:36}),onclick(){}};nodes.set('astrix-api-entry',model);
  const document={documentElement:{},visibilityState:'visible',getElementById:id=>nodes.get(id),querySelector:()=>({getBoundingClientRect:()=>({left:1180,right:1325,top:28,bottom:64,width:145,height:36})}),
    addEventListener:(name,fn)=>documentListeners.set(name,fn),
    createElement:()=>({style:{},dataset:{},setAttribute(name,value){this[name]=value;},appendChild:node=>nodes.set(node.id,node),getBoundingClientRect:()=>({width:110,height:36})}),body:{appendChild:node=>nodes.set(node.id,node)}};
  const location={pathname:'/home',search:''};
  const request=(url,options)=>{calls.push({url,options});return responder?responder(url,options):Response.json(current);};
  const context={document,location,innerWidth:1440,URLSearchParams,AbortController,AbortSignal,window:{fetch:request,m0LocalDesktop:desktop?{isDesktop:true}:undefined,open:(...args)=>{opens.push(args);return null;}},
    setInterval:fn=>{const id=++intervalId;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),
    MutationObserver:class{observe(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),addEventListener:(name,fn)=>listeners.set(name,fn)};
  const source=fs.readFileSync(new URL('../../../网页端/workbench/frontend-tools/home-connections.js',import.meta.url),'utf8').replaceAll('export function ','function ');
  vm.runInNewContext(source,context);context.installHomeFigmaConnection();
  const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
  return {nodes,opens,calls,listeners,documentListeners,intervals,document,location,context,settle,
    button:nodes.get('astrix-figma-entry'),account:nodes.get('astrix-figma-account-status'),model,
    setSession:value=>{current=value;responder=null;},setResponder:value=>{responder=value;},
    async tick(){for(const fn of intervals.values())fn();await settle();}};
}

test('actual home button starts OAuth synchronously and leaves model action and native handoff intact',async()=>{
  for(const desktop of [false,true]){
    const h=homeHarness({desktop});await h.settle();
    const action=h.model.onclick;h.context.installHomeFigmaConnection();assert.equal(h.nodes.size,3);assert.equal(h.intervals.size,1);
    h.button.onclick();assert.equal(h.opens.length,1);assert.deepEqual(h.opens[0],[figmaOAuthStartPath(desktop),'_blank']);
    await h.settle();assert.equal(h.account.textContent,'等待授权');
    assert.equal(h.model.onclick,action);
    h.location.pathname='/aicode-v2';h.listeners.get('popstate')();assert.equal(h.button.hidden,true);
    assert.ok(h.calls.every(call=>call.url==='/api/auth/figma/session'&&call.options.credentials==='same-origin'&&call.options.cache==='no-store'));
  }
});

test('home displays the real authenticated account after restart without exposing unrelated session fields',async()=>{
  const h=homeHarness({session:{configured:true,authenticated:true,user:{name:'测试用户',email:'private@example.test'},accessToken:'private-do-not-display'}});await h.settle();
  assert.equal(h.account.dataset.state,'connected');assert.equal(h.account.textContent,'已连接 · 测试用户');assert.match(h.button.title,/Bridge/);
  assert.ok(!JSON.stringify([h.button.title,h.account.textContent]).includes('private'));
  h.setSession({configured:true,authenticated:true,user:{name:'<img onerror=alert(1)>'}});h.listeners.get('focus')();await h.settle();
  assert.equal(h.account.textContent,'已连接 · <img onerror=alert(1)>');assert.equal(h.account.innerHTML,undefined);
});

test('returning from authorization refreshes the same-origin cookie state and periodic checks detect expiry',async()=>{
  const h=homeHarness();await h.settle();assert.equal(h.account.textContent,'未连接');
  h.location.search='?figma_auth=connected';h.listeners.get('focus')();await h.settle();assert.equal(h.account.textContent,'未连接');
  h.button.onclick();await h.settle();assert.equal(h.account.textContent,'等待授权');
  h.setSession({configured:true,authenticated:true,user:{name:'授权返回用户'}});h.listeners.get('focus')();await h.settle();assert.equal(h.account.textContent,'已连接 · 授权返回用户');
  const before=h.calls.length;h.document.visibilityState='hidden';await h.tick();assert.equal(h.calls.length,before);
  h.document.visibilityState='visible';h.documentListeners.get('visibilitychange')();await h.settle();assert.equal(h.calls.length,before+1);
  h.setSession({configured:true,authenticated:false});await h.tick();assert.equal(h.account.textContent,'未连接');
});

test('status errors and malformed sessions do not claim a connection, and focus can recover',async()=>{
  const h=homeHarness({respond:()=>Response.json({error:'private-server-diagnostic'},{status:500})});await h.settle();
  assert.equal(h.account.textContent,'状态不可用');assert.ok(!h.button.title.includes('private'));
  h.setResponder(()=>{throw Error('private synchronous failure');});h.listeners.get('focus')();await h.settle();assert.equal(h.account.textContent,'状态不可用');
  h.setSession({configured:true,authenticated:'true',user:{name:'not authenticated'}});h.listeners.get('focus')();await h.settle();assert.equal(h.account.textContent,'状态不可用');
  h.setSession({configured:false,authenticated:false});h.listeners.get('focus')();await h.settle();assert.equal(h.account.textContent,'待配置');
  h.setSession({configured:true,authenticated:true});h.listeners.get('focus')();await h.settle();assert.equal(h.account.textContent,'已连接');
});

test('leaving aborts a pending status request, and a late result cannot overwrite a restored page',async()=>{
  let finish;
  const h=homeHarness({respond:()=>new Promise(resolve=>{finish=resolve;})});await h.settle();
  h.listeners.get('focus')();assert.equal(h.calls.length,1);
  h.listeners.get('pagehide')();assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.intervals.size,0);
  h.setSession({configured:true,authenticated:true,user:{name:'恢复用户'}});h.listeners.get('pageshow')();await h.settle();assert.equal(h.account.textContent,'已连接 · 恢复用户');
  finish(Response.json({configured:true,authenticated:true,user:{name:'过期响应'}}));await h.settle();assert.equal(h.account.textContent,'已连接 · 恢复用户');assert.equal(h.intervals.size,1);
});
