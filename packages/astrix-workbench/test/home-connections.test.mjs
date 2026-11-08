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
  for(const [viewport,mode] of [[1440,{left:1180,right:1325,top:28,bottom:64,width:145,height:36}],[390,{left:218,right:374,top:28,bottom:64,width:156,height:36}]]){
    const p=homeConnectionPositions({viewport,mode,figmaWidth:110,modelWidth:98});
    const figma={left:viewport-p.figmaRight-110,right:viewport-p.figmaRight};
    const model={left:viewport-p.modelRight-98,right:viewport-p.modelRight};
    assert.ok(model.right<figma.left);assert.ok(model.left>=16);
    assert.ok(figma.right<=viewport-16);
    assert.ok(figma.right<mode.left||p.top>=mode.bottom);
  }
});

test('actual home button starts OAuth synchronously and leaves model action and native handoff intact',()=>{
  const source=fs.readFileSync(new URL('../../../网页端/workbench/frontend-tools/home-connections.js',import.meta.url),'utf8').replaceAll('export function ','function ');
  for(const desktop of [false,true]){
    const nodes=new Map(),opens=[],listeners=new Map();let modelClicks=0;
    const model={style:{},getBoundingClientRect:()=>({width:98,height:36}),onclick:()=>modelClicks++};nodes.set('astrix-api-entry',model);
    const action=model.onclick;
    const document={documentElement:{},getElementById:id=>nodes.get(id),querySelector:()=>({getBoundingClientRect:()=>({left:1180,right:1325,top:28,bottom:64,width:145,height:36})}),
      createElement:()=>({style:{},setAttribute(){},getBoundingClientRect:()=>({width:110,height:36})}),body:{appendChild:node=>nodes.set(node.id,node)}};
    const location={pathname:'/home'};
    const context={document,location,innerWidth:1440,URLSearchParams,window:{m0LocalDesktop:desktop?{isDesktop:true}:undefined,open:(...args)=>{opens.push(args);return null;}},
      MutationObserver:class{observe(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),addEventListener:(name,fn)=>listeners.set(name,fn)};
    vm.runInNewContext(source,context);context.installHomeFigmaConnection();context.installHomeFigmaConnection();
    const button=nodes.get('astrix-figma-entry');assert.equal(nodes.size,2);assert.equal(button.hidden,false);
    button.onclick();assert.equal(opens.length,1);assert.deepEqual(opens[0],[figmaOAuthStartPath(desktop),'_blank']);
    assert.equal(model.onclick,action);model.onclick();assert.equal(modelClicks,1);
    location.pathname='/aicode-v2';listeners.get('popstate')();assert.equal(button.hidden,true);
  }
});
