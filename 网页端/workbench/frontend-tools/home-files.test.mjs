import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {figmaCatalogInput,figmaThumbnailUrl,normalizeFigmaCatalog,figmaCatalogError,figmaCatalogWarnings,createFigmaCatalog,figmaCatalogDesignRoute,requestFigmaCatalogOpen,figmaCatalogReturnNeedsRefresh} from './figma-catalog-model.mjs';
import {patchHomeFigmaCatalog} from './home-catalog-patch.mjs';

const file=(key='realFile',name='真实设计稿')=>({key,name,url:'https://www.figma.com/design/'+key+'/Design?node-id=10-20&page-id=1-2&t=tracking',thumbnailUrl:'https://images.example.test/actual-thumbnail.png',lastModified:'2026-11-08T09:12:00Z',source:'saved'});
const catalog=(files=[file()],id='account-a',extra={})=>({account:{id},files,errors:[],partial:false,team:{configured:false},...extra});
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};

test('catalog normalization uses only real well-formed rows and retains safe node/page targeting',()=>{
  const result=normalizeFigmaCatalog(catalog([file(),file(),{...file('missingName'),name:''},{...file('wrongKey'),url:'https://www.figma.com/design/other'},{...file('unsafe'),url:'javascript:alert(1)'},{...file('badDate'),lastModified:'not-a-date',thumbnailUrl:'data:image/png;base64,fake'}]));
  assert.deepEqual(result.files.map(item=>item.key),['realFile','badDate']);
  const url=new URL(result.files[0].url);assert.equal(url.searchParams.get('node-id'),'10-20');assert.equal(url.searchParams.get('page-id'),'1-2');assert.equal(url.searchParams.has('t'),false);
  assert.equal(result.files[1].lastModified,null);assert.equal(result.files[1].thumbnailUrl,null);
  assert.throws(()=>normalizeFigmaCatalog({files:{}}));
});

test('file/source input accepts official HTTPS only and matches all supported editor types',()=>{
  for(const type of ['design','file','board','slides','proto','draw','make'])assert.equal(figmaCatalogInput('https://www.figma.com/'+type+'/A_1/title?node-id=2-3&tracking=x#fragment').kind,'file');
  assert.equal(figmaCatalogInput('https://www.figma.com/files/team/123').kind,'source');
  assert.equal(figmaCatalogInput('https://www.figma.com/files/project/123').kind,'source');
  for(const url of ['http://www.figma.com/design/a','https://figma.com.evil.test/design/a','https://user:pass@figma.com/design/a','file:///tmp/file','javascript:alert(1)','https://figma.com:8443/design/a'])assert.throws(()=>figmaCatalogInput(url));
  assert.equal(figmaCatalogInput('https://figma.com/design/'+'a'.repeat(129)).kind,'source');
});

test('thumbnail accepts genuine absolute HTTPS URLs and never accepts script/data/relative previews',()=>{
  assert.equal(figmaThumbnailUrl('https://images.example.test/a?sig=real'),'https://images.example.test/a?sig=real');
  for(const value of ['http://example.test/a','data:image/png,anything','javascript:alert(1)','/mock-design.png','https://user:pass@example.test/a',null])assert.equal(figmaThumbnailUrl(value),null);
});

test('passive metadata refresh is throttled independently of account polling; manual refresh is explicit',async()=>{
  let time=0;const calls=[];
  const store=createFigmaCatalog({now:()=>time,request:async(url,options)=>{calls.push({url,options});return Response.json(catalog());}});
  await store.refresh();assert.equal(calls.length,1);
  for(let i=0;i<12;i++){time+=5000;store.setSession({authenticated:true,accountId:'account-a'});if(time<60000)await store.refresh();}
  assert.equal(calls.length,1);await store.refresh();assert.equal(calls.length,2);
  await store.refresh({force:true});assert.equal(calls.length,3);assert.ok(calls.every(call=>call.url==='/api/auth/figma/catalog'&&call.options.credentials==='same-origin'&&call.options.cache==='no-store'));
});

test('returning after an error or partial permission failure retries immediately while successful catalogs keep their throttle',async()=>{
  for(const first of [()=>Response.json({error:'unavailable'},{status:500}),()=>Response.json(catalog([],'account-a',{partial:true,errors:[{status:403}]}),{status:207})]){
    let calls=0;const store=createFigmaCatalog({now:()=>0,request:async()=>++calls===1?first():Response.json(catalog())});
    await store.refresh();assert.equal(figmaCatalogReturnNeedsRefresh(store.snapshot()),true);
    await store.refresh();assert.equal(calls,1);
    await store.refresh({force:figmaCatalogReturnNeedsRefresh(store.snapshot())});assert.equal(calls,2);assert.equal(store.snapshot().files.length,1);
    assert.equal(figmaCatalogReturnNeedsRefresh(store.snapshot()),false);await store.refresh({force:figmaCatalogReturnNeedsRefresh(store.snapshot())});assert.equal(calls,2);
  }
  for(const state of [null,{phase:'unauthorized'},{phase:'loading'},{phase:'ready',partial:true,errors:[]},{phase:'ready',partial:false,errors:[{status:403}]}])assert.equal(figmaCatalogReturnNeedsRefresh(state),false);
  const source=fs.readFileSync(new URL('./home-figma-catalog.js',import.meta.url),'utf8');assert.match(source,/addEventListener\('focus',returning\)/);assert.match(source,/addEventListener\('visibilitychange',returning\)/);assert.match(source,/setInterval\(passive,60000\)/);
});

test('logout aborts a pending catalog and a late authenticated response cannot restore its files',async()=>{
  let finish,signal;const store=createFigmaCatalog({request:(_url,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}});
  const pending=store.refresh();store.setSession({authenticated:false});assert.equal(signal.aborted,true);
  finish(Response.json(catalog()));await pending;
  assert.equal(store.snapshot().phase,'unauthorized');assert.equal(store.snapshot().files.length,0);assert.equal(store.snapshot().accountId,null);
});

test('account replacement discards old cards and responses, even when transports ignore abort',async()=>{
  let finish,count=0;
  const store=createFigmaCatalog({request:async()=>++count===1?new Promise(resolve=>{finish=resolve;}):Response.json(catalog([file('newFile','新账号设计稿')],'account-b'))});
  const old=store.refresh();store.setSession({authenticated:false});store.setSession({authenticated:true,accountId:'account-b'});await settle();
  assert.equal(store.snapshot().accountId,'account-b');finish(Response.json(catalog([file('oldFile')],'account-a')));await old;
  assert.deepEqual(store.snapshot().files.map(file=>file.key),['newFile']);assert.equal(store.snapshot().accountId,'account-b');
});

test('401 clears previously loaded account data and focus polling does not infer a fresh authorization',async()=>{
  let count=0;const store=createFigmaCatalog({request:async()=>++count===1?Response.json(catalog()):Response.json({error:'private diagnostic'},{status:401})});
  await store.refresh();await store.refresh({force:true});assert.equal(store.snapshot().files.length,0);assert.equal(store.snapshot().phase,'unauthorized');assert.match(store.snapshot().message,/连接 Figma/);
  await store.refresh();assert.equal(count,2);assert.ok(!store.snapshot().message.includes('private'));
});

test('a response for a different account cannot replace the session-bound catalog',async()=>{
  const store=createFigmaCatalog({request:async()=>Response.json(catalog([file('wrongAccountFile')],'account-a'))});
  store.setSession({authenticated:true,accountId:'account-b'},{refresh:false});await store.refresh({force:true});
  assert.equal(store.snapshot().accountId,'account-b');assert.equal(store.snapshot().files.length,0);assert.match(store.snapshot().message,/账号状态已变化/);
});

test('partial results retain only verified files and explain real permission/rate limits',async()=>{
  const store=createFigmaCatalog({request:async()=>Response.json(catalog([file()],'account-a',{partial:true,errors:[{status:403,action:'reauthorize-library',message:'private detail'},{status:429}],team:{configured:true}}),{status:207})});
  await store.refresh();assert.equal(store.snapshot().files.length,1);assert.equal(store.snapshot().teamConfigured,true);assert.match(store.snapshot().message,/目录权限/);assert.ok(!store.snapshot().message.includes('private'));
  assert.match(figmaCatalogWarnings([{status:404}]),/不可用/);assert.match(figmaCatalogWarnings([{status:429}]),/频率/);assert.match(figmaCatalogError(403),/权限/);
});

test('adding a real file verifies it before refreshing and preserves node-id without requesting team discovery',async()=>{
  const calls=[];const store=createFigmaCatalog({request:async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/files')?{file:file()}:catalog());}});
  assert.equal(await store.add('https://www.figma.com/design/realFile/Design?node-id=10-20&t=track'),'file');
  assert.deepEqual(calls.map(call=>call.url),['/api/auth/figma/catalog/files','/api/auth/figma/catalog']);
  const input=JSON.parse(calls[0].options.body);assert.equal(new URL(input.url).searchParams.get('node-id'),'10-20');assert.equal(new URL(input.url).searchParams.has('t'),false);
});

test('team/folder source discovery happens only after explicit source addition or sync',async()=>{
  const calls=[];const store=createFigmaCatalog({request:async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/sources')?{source:{kind:'team'}}:catalog());}});
  await store.add('https://www.figma.com/files/team/123');assert.deepEqual(calls.map(call=>call.url),['/api/auth/figma/catalog/sources','/api/auth/figma/catalog?team=1']);
  await store.refresh({force:true});assert.equal(calls.at(-1).url,'/api/auth/figma/catalog');await store.refresh({force:true,team:true});assert.equal(calls.at(-1).url,'/api/auth/figma/catalog?team=1');
});

test('account changes during the post-add refresh reject the old addition instead of reporting success',async()=>{
  let finish,refreshSignal,succeeded=false;
  const store=createFigmaCatalog({request:async(url,options)=>url.endsWith('/files')?Response.json({account:{id:'account-a'},file:file()}):new Promise(resolve=>{finish=resolve;refreshSignal=options.signal;})});
  store.setSession({authenticated:true,accountId:'account-a'},{refresh:false});
  const pending=store.add(file().url).then(value=>{succeeded=true;return value;});await settle();
  assert.equal(typeof finish,'function');
  store.setSession({authenticated:true,accountId:'account-b'},{refresh:false});assert.equal(refreshSignal.aborted,true);
  const rejected=assert.rejects(pending,error=>error.name==='AbortError');
  finish(Response.json(catalog([file('oldAccountFile')],'account-a')));await rejected;
  assert.equal(succeeded,false);assert.equal(store.snapshot().accountId,'account-b');assert.deepEqual(store.snapshot().files,[]);
});

test('leaving during the post-add refresh rejects the addition even when the old request ignores abort',async()=>{
  let finish,refreshSignal,succeeded=false;
  const store=createFigmaCatalog({request:async(url,options)=>url.endsWith('/files')?Response.json({account:{id:'account-a'},file:file()}):new Promise(resolve=>{finish=resolve;refreshSignal=options.signal;})});
  store.setSession({authenticated:true,accountId:'account-a'},{refresh:false});
  const pending=store.add(file().url).then(value=>{succeeded=true;return value;});await settle();
  store.cancel();assert.equal(refreshSignal.aborted,true);
  const rejected=assert.rejects(pending,error=>error.name==='AbortError');
  finish(Response.json(catalog()));await rejected;
  assert.equal(succeeded,false);assert.deepEqual(store.snapshot().files,[]);assert.equal(store.snapshot().phase,'idle');
});

test('failed link validation never creates a card; canceled work cannot update a disposed store',async()=>{
  const store=createFigmaCatalog({request:async()=>Response.json({error:'private diagnostic'},{status:403})});
  await assert.rejects(store.add('https://www.figma.com/design/privateFile'),/权限/);assert.equal(store.snapshot().files.length,0);
  let finish;const pendingStore=createFigmaCatalog({request:()=>new Promise(resolve=>{finish=resolve;})});const pending=pendingStore.refresh();pendingStore.dispose();finish(Response.json(catalog()));await pending;assert.equal(pendingStore.snapshot().files.length,0);
});

test('open route accepts only the existing same-origin Design host and requires a bound project',()=>{
  const origin='http://127.0.0.1:4317',route='/aicode-v2?id=12&mode=spark&autoOpenFigma=true';assert.equal(figmaCatalogDesignRoute(route,origin),route);
  for(const value of ['https://evil.test/aicode-v2?id=1','/__local/settings?id=1','/aicode-v2','javascript:alert(1)',null])assert.throws(()=>figmaCatalogDesignRoute(value,origin));
});

test('web opens official Figma through the safe local redirect synchronously before POST; desktop only binds',async()=>{
  for(const desktop of [false,true]){
    const order=[];let finish;
    const pending=requestFigmaCatalogOpen(file().url,{desktop,open:(...args)=>order.push({action:'popup',args}),request:(url,options)=>{order.push({action:'request',url,options});return new Promise(resolve=>{finish=resolve;});}});
    assert.deepEqual(order.map(item=>item.action),desktop?['request']:['popup','request']);
    if(!desktop){const popup=new URL(order[0].args[0],'http://127.0.0.1:5273');assert.equal(popup.pathname,'/__local/figma/catalog/launch');assert.equal(new URL(popup.searchParams.get('url')).searchParams.get('node-id'),'10-20');assert.deepEqual(order[0].args.slice(1),['_blank','noopener,noreferrer']);}
    assert.equal(order.at(-1).url,'/__local/figma/catalog/open');assert.equal(new URL(JSON.parse(order.at(-1).options.body).url).searchParams.get('node-id'),'10-20');finish(Response.json({route:'/aicode-v2?id=1'}));await pending;
  }
});

test('the reliable local Vue mount bypasses recovered recent files and is idempotent',()=>{
  const old='Ue.value==="home"&&unref(x)?(openBlock(),createElementBlock("section",_hoisted_35,["enterprise file"])):createCommentVNode("",!0)';
  const next=patchHomeFigmaCatalog(old);assert.equal(patchHomeFigmaCatalog(next),next);assert.throws(()=>patchHomeFigmaCatalog('changed recovered section'));
  const evaluate=new Function('window','x','return '+next.replaceAll('Ue.value','"home"').replaceAll('unref(x)','x').replaceAll('openBlock()','0').replaceAll('_hoisted_35','{}').replaceAll('createCommentVNode("",!0)','null').replaceAll('createElementBlock','make'));
  globalThis.make=(_tag,attrs,children)=>({attrs,children});
  try{const local=evaluate({__M0_LOCAL_RUNTIME__:true},false);assert.ok(Object.hasOwn(local.attrs,'data-astrix-figma-catalog'));assert.equal(local.children,undefined);const original=evaluate({},true);assert.deepEqual(original.children,['enterprise file']);}finally{delete globalThis.make;}
});

test('full and refresh preparation install catalog files, stylesheet and native-fetch module import',()=>{
  const prepare=fs.readFileSync(new URL('./prepare-frontend.mjs',import.meta.url),'utf8'),runtime=fs.readFileSync(new URL('./local-runtime.js',import.meta.url),'utf8');
  for(const file of ['home-figma-catalog.js','figma-catalog-model.mjs','home-figma-catalog.css'])assert.ok(prepare.split(file).length>=3,file);
  assert.match(prepare,/patchHomeFigmaCatalog\(updated\)/);assert.match(prepare,/patchHomeFigmaCatalog\(text\)/);assert.match(runtime,/installHomeFigmaCatalog\(\{request:nativeFetch\}\)/);
});
