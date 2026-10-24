'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const host=require('../desktop/figma-host.cjs');
const {FigmaHostManager}=host;
const bounds={x:15,y:70,width:1000,height:700};let nextContentsId=1;
class Contents extends EventEmitter{constructor(){super();this.id=nextContentsId++;this.url='';this.mainFrame={url:'',origin:'',framesInSubtree:[]};this.mainFrame.top=this.mainFrame;this.mainFrame.framesInSubtree=[this.mainFrame];this.loads=[];this.closed=false;}getURL(){return this.url;}loadURL(url){this.url=url;this.loads.push(url);return Promise.resolve();}isLoadingMainFrame(){return false;}setWindowOpenHandler(handler){this.popup=handler;}isDestroyed(){return this.closed;}close(options){this.closeOptions=options;if(options?.waitForBeforeUnload&&this.preventUnload){const e=event();this.emit('will-prevent-unload',e);if(!e.prevented)return;}this.closed=true;this.emit('destroyed');}reload(){this.reloaded=true;}}
class View{constructor(options){this.options=options;this.webContents=new Contents();this.visible=false;}setBackgroundColor(){}setVisible(v){this.visible=v;}getVisible(){return this.visible;}setBounds(b){this.bounds=b;}getBounds(){return this.bounds;}}
class Window extends EventEmitter{constructor(options={}){super();this.options=options;this.webContents=new Contents();this.children=[];this.contentView={addChildView:v=>this.children.push(v),removeChildView:v=>{this.children=this.children.filter(x=>x!==v);}};}isDestroyed(){return Boolean(this.destroyed);}getContentSize(){return[1200,800];}setTitle(title){this.title=title;}loadURL(url){return this.webContents.loadURL(url);}destroy(){this.destroyed=true;this.webContents.close();this.emit('closed');}}
function fixture(extra={}){const session=new EventEmitter();session.webRequest={onBeforeRequest:fn=>session.request=fn,onBeforeSendHeaders:fn=>session.headers=fn};session.setPermissionRequestHandler=fn=>session.permission=fn;session.setPermissionCheckHandler=fn=>session.check=fn;const opened=[],revealed=[],events=[],window=new Window();window.webContents.url='http://127.0.0.1:4317/home';window.webContents.mainFrame.url=window.webContents.url;const electron={session:{fromPartition:name=>{assert.equal(name,'persist:m0-figma');return session;}},WebContentsView:View,BrowserWindow:Window,app:{getPath:()=>'/tmp'},shell:{openExternal:async url=>opened.push(url),showItemInFolder:file=>revealed.push(file)},dialog:{showMessageBoxSync:()=>0}};const manager=new FigmaHostManager({window,root:'/tmp/m0-host-unit',baseURL:'http://127.0.0.1:4317',onStatus:s=>events.push(s),electron,...extra});return{manager,session,window,events,opened,revealed,electron};}
const event=()=>({prevented:false,preventDefault(){this.prevented=true;}});
test('disposal after the native owner closes does not read a destroyed window webContents getter',()=>{
  const f=fixture(),contents=f.window.webContents;
  f.window.destroyed=true;contents.closed=true;
  Object.defineProperty(f.window,'webContents',{get(){throw Error('Object has been destroyed');}});
  assert.doesNotThrow(()=>f.manager.dispose());
  assert.equal(contents.listenerCount('did-start-navigation'),0);
  assert.equal(contents.listenerCount('did-navigate'),0);
  assert.doesNotThrow(()=>f.manager.dispose());
});
test('workspace URLs admit official Figma documents, home and figma.new and reject credential/port/domain escapes',()=>{for(const url of ['https://www.figma.com/design/abc/title?node-id=1-2','https://figma.com/file/key/name','https://www.figma.com/files/recents','https://figma.new'])assert.ok(host.normalizeFigmaURL(url));for(const url of ['https://figma.com.evil.test/file/a','https://evil.test/','http://www.figma.com/design/a','https://name:secret@www.figma.com/design/a','https://www.figma.com:444/design/a','file:///tmp/x','javascript:alert(1)','https://www.figma.com/api/user'])assert.throws(()=>host.normalizeFigmaURL(url));assert.deepEqual(host.contextFromURL('https://www.figma.com/design/key/a?node-id=1-2'),{fileKey:'key',nodeId:'1:2'});assert.deepEqual(host.contextFromURL('https://evil.test/design/key/a'),{fileKey:null,nodeId:null});});
test('isolated web resource policy enables public Figma/CDN/WSS dependencies while blocking local and privileged schemes',()=>{for(const url of ['https://www.figma.com/design/a','https://static.figma.com/app.js','https://cdn.example.com/font.woff2','wss://collab.figma.com/session','data:image/png;base64,AAAA','blob:https://www.figma.com/id'])assert.equal(host.allowsRemoteRequest(url),true,url);for(const url of ['http://127.0.0.1:4317/__local/model','https://127.0.0.1/private','https://2130706433/private','https://[::1]/private','https://[::ffff:127.0.0.1]/private','https://10.1.2.3/','https://192.168.1.1/','https://172.16.0.1/','https://host.local/','https://localhost/','ws://collab.figma.com/','file:///etc/passwd','vscode-remote://m0/workspace','https://u:p@example.com/'])assert.equal(host.allowsRemoteRequest(url),false,url);});
test('new view has no preload or Node and accurately follows bounds, URL/context, loading and route hiding',()=>{const f=fixture(),s=f.manager.show({url:'https://www.figma.com/design/A/name',bounds,projectId:1}),view=f.manager.view;assert.equal(s.url,'https://www.figma.com/design/A/name');assert.equal(s.fileKey,'A');assert.equal(s.projectId,'1');assert.equal(s.loading,true);for(const key of ['nodeIntegration','nodeIntegrationInSubFrames','webviewTag','allowRunningInsecureContent'])assert.equal(view.options.webPreferences[key],false);for(const key of ['contextIsolation','sandbox','webSecurity'])assert.equal(view.options.webPreferences[key],true);assert.equal(Object.hasOwn(view.options.webPreferences,'preload'),false);view.webContents.emit('did-navigate-in-page',{},'https://www.figma.com/design/A/name?node-id=4-8');assert.equal(f.manager.status().nodeId,'4:8');view.webContents.emit('did-stop-loading');assert.equal(f.manager.status().loading,false);f.manager.updateBounds({x:1100,y:750,width:500,height:500});assert.deepEqual(view.getBounds(),{x:1100,y:750,width:100,height:50});f.window.webContents.emit('did-start-navigation',{},'http://127.0.0.1:4317/home',false,true);assert.equal(view.visible,false);assert.equal(f.manager.status().visible,false);f.manager.dispose();assert.equal(view.webContents.closed,true);assert.equal(f.window.children.length,0);assert.equal(f.session.listenerCount('will-download'),0);});
test('requested new file B is emitted immediately and a stale A navigation cannot reset its status',()=>{const f=fixture();f.manager.show({url:'https://www.figma.com/design/A/name',bounds,projectId:'1'});f.manager.show({url:'https://www.figma.com/design/B/name',bounds,projectId:'1'});assert.equal(f.manager.status().fileKey,'B');f.manager.view.webContents.emit('did-fail-load',{},-105,'old A DNS error','https://www.figma.com/design/A/name',true);assert.equal(f.manager.status().error,null);assert.equal(f.manager.status().loading,true);f.manager.view.webContents.emit('did-navigate',{},'https://www.figma.com/design/A/name');assert.equal(f.manager.status().fileKey,'B');f.manager.view.webContents.emit('did-navigate',{},'https://www.figma.com/design/B/name?node-id=7-9');assert.equal(f.manager.status().nodeId,'7:9');f.manager.show({bounds,projectId:'2'});assert.equal(f.manager.status().url,host.DEFAULT_URL);f.manager.dispose();});
test('clipboard permissions require own visible Figma main frame and a recent real input event',()=>{const f=fixture();f.manager.show({bounds});const c=f.manager.view.webContents;c.url='https://www.figma.com/design/a/name';const request=(name,details={isMainFrame:true,requestingUrl:c.url})=>{let result;f.session.permission(c,name,value=>result=value,details);return result;};assert.equal(request('clipboard-read'),false);c.emit('before-mouse-event',{}, {type:'mouseDown'});assert.equal(request('clipboard-read'),true);assert.equal(request('clipboard-sanitized-write'),true);assert.equal(request('fileSystem'),false);assert.equal(request('media'),false);assert.equal(request('clipboard-read',{isMainFrame:false,requestingUrl:c.url}),false);f.manager.hide();assert.equal(request('clipboard-read'),false);f.manager.dispose();});
test('downloads require user interaction and retain a native save dialog rather than an automatic path',()=>{const f=fixture();f.manager.show({bounds});const c=f.manager.view.webContents;c.url='https://www.figma.com/design/a/name';const item={getFilename:()=>'/../../export.svg',setSaveDialogOptions(value){this.options=value;}};let e=event();f.session.emit('will-download',e,item,c);assert.equal(e.prevented,true);c.emit('before-input-event',{}, {type:'keyDown'});e=event();f.session.emit('will-download',e,item,c);assert.equal(e.prevented,false);assert.equal(item.options.defaultPath,'/tmp/export.svg');assert.equal(Object.hasOwn(item,'savePath'),false);e=event();f.session.emit('will-download',e,item,new Contents());assert.equal(e.prevented,true);f.manager.dispose();});
test('login popups stay sandboxed without preload, reject local URLs and are destroyed with their owner',()=>{const f=fixture();f.manager.show({bounds});const c=f.manager.view.webContents;const allowed=c.popup({url:'https://accounts.google.com/o/oauth2/auth'});assert.equal(allowed.action,'allow');assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.nodeIntegration,false);assert.equal(Object.hasOwn(allowed.overrideBrowserWindowOptions.webPreferences,'preload'),false);assert.equal(c.popup({url:'http://127.0.0.1:4317/__local/settings'}).action,'deny');assert.equal(c.popup({url:'file:///tmp/x'}).action,'deny');const popup=new Window();c.emit('did-create-window',popup);const e=event();popup.webContents.emit('will-navigate',e,'http://127.0.0.1:4317');assert.equal(e.prevented,true);f.manager.dispose();assert.equal(popup.destroyed,true);});
test('Figma bridge identity accepts only the local parent main frame',()=>{const f=fixture(),wc=f.window.webContents,frame=wc.mainFrame;assert.equal(host.isTrustedLocalMainFrame({sender:wc,senderFrame:frame},f.window,'http://127.0.0.1:4317'),true);assert.equal(host.isTrustedLocalMainFrame({sender:wc,senderFrame:{url:frame.url}},f.window,'http://127.0.0.1:4317'),false);assert.equal(host.isTrustedLocalMainFrame({sender:new Contents(),senderFrame:frame},f.window,'http://127.0.0.1:4317'),false);frame.url='https://www.figma.com/design/a/name';assert.equal(host.isTrustedLocalMainFrame({sender:wc,senderFrame:frame},f.window,'http://127.0.0.1:4317'),false);f.manager.dispose();});
test('reveal obtains metadata from the backend, checks project and realpath and cannot reveal a renderer supplied file',async t=>{const directory=await fs.mkdtemp(path.join(os.tmpdir(),'m0-figma-host-')),plugin=path.join(directory,'.local-data/figma-plugin/project-one');await fs.mkdir(plugin,{recursive:true});const manifest=path.join(plugin,'manifest.json');await fs.writeFile(manifest,'{}');t.after(()=>fs.rm(directory,{recursive:true,force:true}));let metadata={pluginDirectory:plugin,manifestPath:manifest,projectId:1};const f=fixture({root:directory,fetch:async url=>{assert.equal(new URL(url).pathname,'/__local/figma/metadata');assert.equal(new URL(url).searchParams.get('projectId'),'1');return{ok:true,json:async()=>metadata};}});const result=await f.manager.revealBridgePlugin({projectId:'1',manifestPath:'/etc/passwd'});assert.equal(result.revealed,true);assert.deepEqual(f.revealed,[await fs.realpath(manifest)]);metadata={...metadata,projectId:2};await assert.rejects(f.manager.revealBridgePlugin({projectId:'1'}),/上下文/);const outside=path.join(directory,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'manifest.json'),'{}');metadata={pluginDirectory:outside,manifestPath:path.join(outside,'manifest.json'),projectId:1};await assert.rejects(f.manager.revealBridgePlugin({projectId:'1'}),/不属于/);f.manager.dispose();});
test('preload exposes a fixed narrow Figma API and status listener with unsubscribe',async()=>{const source=await fs.readFile(path.join(__dirname,'../desktop/preload.cjs'),'utf8'),ipc=new EventEmitter(),calls=[];ipc.invoke=(...args)=>{calls.push(args);return Promise.resolve(true);};let bridge;vm.runInNewContext(source,{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'m0LocalDesktop');bridge=value;}},ipcRenderer:ipc};}});assert.deepEqual(Object.keys(bridge.figmaHost).sort(),['available','getStatus','hide','onStatus','openExternal','revealBridgePlugin','show','updateBounds'].sort());await bridge.figmaHost.show({bounds,url:'https://figma.new'});assert.equal(calls[0][0],'m0-local:figma-host');let seen;const unsubscribe=bridge.figmaHost.onStatus(s=>seen=s);ipc.emit('m0-local:figma-status',{}, {url:'https://figma.new/'});assert.equal(seen.url,'https://figma.new/');unsubscribe();assert.equal(ipc.listenerCount('m0-local:figma-status'),0);});

function bridgeFixture(){
  const f=fixture();f.manager.show({url:'https://www.figma.com/design/A/name',bounds});
  const contents=f.manager.view.webContents,frame={url:'about:srcdoc',origin:'null',top:contents.mainFrame,detached:false};
  contents.mainFrame.framesInSubtree.push(frame);
  const request={url:'http://127.0.0.1:4317/__local/figma/bridge/pair',method:'POST',resourceType:'xhr',webContentsId:contents.id,frame,requestHeaders:{Origin:'null','Content-Type':'application/json'}};
  return{...f,contents,frame,request};
}
test('only the configured four plugin bridge routes and their real methods can leave an opaque child frame',()=>{
  const f=bridgeFixture(),{contents,request}=f,base=f.manager.baseURL;
  for(const[route,method]of [['pair','POST'],['selection','POST'],['pull','GET'],['ack','POST']]){
    const details={...request,url:'http://127.0.0.1:4317/__local/figma/bridge/'+route+(route==='pull'?'?fileKey=A&sessionId=S':''),method};
    assert.equal(host.allowsBridgeRequest(details,base,contents),true,route);
    assert.equal(host.allowsBridgeRequest({...details,method:'DELETE'},base,contents),false,route);
    let result;f.session.request(details,value=>result=value);assert.equal(result.cancel,false);
  }
  for(const url of ['http://127.0.0.1:4317/__local/rpc','http://127.0.0.1:4317/__local/model','http://127.0.0.1:4317/__local/figma/bridge/commands','http://127.0.0.1:4317/__local/figma/bridge/status','http://127.0.0.1:4317/__local/figma/bridge/pair/','http://127.0.0.1:4318/__local/figma/bridge/pair','http://localhost:4317/__local/figma/bridge/pair','https://127.0.0.1:4317/__local/figma/bridge/pair'])assert.equal(host.allowsBridgeRequest({...request,url},base,contents),false,url);
  for(const patch of [{resourceType:'mainFrame'},{resourceType:'image'},{method:'GET'},{frame:contents.mainFrame},{frame:null},{webContentsId:contents.id+1},{frame:{...f.frame,origin:'https://www.figma.com'}},{frame:{...f.frame,top:new Contents().mainFrame}}])assert.equal(host.allowsBridgeRequest({...request,...patch},base,contents),false,JSON.stringify(patch,(_,v)=>typeof v==='object'&&v?.top?'frame':v));
  assert.equal(host.allowsBridgeRequest({...request,url:request.url.replace(':4317',':4359')},'http://127.0.0.1:4359',contents),true);
  f.manager.dispose();
});
test('bridge headers preserve browser Origin:null and allow only the required CORS preflight method and headers',()=>{
  const f=bridgeFixture(),{contents,request}=f,base=f.manager.baseURL;
  assert.equal(host.allowsBridgeHeaders(request,base,contents),true);
  for(const headers of [{},{Origin:'https://www.figma.com'},{Origin:'http://127.0.0.1:4317'},{Origin:'null',Authorization:'anything'}]){
    // Authorization is validated by the backend; it is never synthesized here.
    assert.equal(host.allowsBridgeHeaders({...request,requestHeaders:headers},base,contents),headers.Origin==='null');
  }
  const preflight={...request,method:'OPTIONS',resourceType:'other',requestHeaders:{Origin:'null','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type'}};
  assert.equal(host.allowsBridgeHeaders(preflight,base,contents),true);
  for(const headers of [{'Access-Control-Request-Method':'GET'},{'Access-Control-Request-Headers':'x-admin-token'}])assert.equal(host.allowsBridgeHeaders({...preflight,requestHeaders:{...preflight.requestHeaders,...headers}},base,contents),false);
  let result;f.session.headers(request,value=>result=value);assert.equal(result.cancel,false);assert.equal(result.requestHeaders,request.requestHeaders);
  f.session.headers({...request,requestHeaders:{Origin:'https://www.figma.com'}},value=>result=value);assert.equal(result.cancel,true);
  f.manager.dispose();
});
test('loopback network permission is limited to own opaque child and cannot grant the Figma main frame or LAN permission',()=>{
  const f=bridgeFixture(),details={isMainFrame:false,requestingUrl:f.frame.url};
  const check=(contents,name,origin='null',d=details)=>f.session.check(contents,name,origin,d);
  assert.equal(check(f.contents,'local-network-access'),true);assert.equal(check(f.contents,'loopback-network'),true);
  assert.equal(check(f.contents,'local-network'),false);assert.equal(check(f.contents,'local-network-access','https://www.figma.com'),false);
  assert.equal(check(f.contents,'local-network-access','null',{isMainFrame:true,requestingUrl:f.contents.getURL()}),false);
  assert.equal(check(new Contents(),'local-network-access'),false);assert.equal(check(null,'local-network-access'),false);
  let allowed;f.session.permission(f.contents,'local-network-access',value=>allowed=value,details);assert.equal(allowed,true);
  f.frame.origin='https://evil.example';assert.equal(check(f.contents,'local-network-access'),false);
  f.manager.dispose();
});
test('clean Figma page closes only through waitForBeforeUnload and releases its owned view',async()=>{
  const f=fixture();f.manager.show({bounds});const contents=f.manager.view.webContents;
  assert.equal(await f.manager.prepareClose(),true);assert.deepEqual(contents.closeOptions,{waitForBeforeUnload:true});
  assert.equal(f.manager.hasLivePage(),false);assert.equal(f.window.children.length,0);f.manager.dispose();
});
test('a real prevented unload can retain the Figma page; explicit leave permits a later close',async()=>{
  const f=fixture();f.manager.show({bounds});const contents=f.manager.view.webContents;contents.preventUnload=true;
  assert.equal(await f.manager.prepareClose(),false);assert.equal(contents.closed,false);assert.equal(f.manager.hasLivePage(),true);
  f.electron.dialog.showMessageBoxSync=()=>1;assert.equal(await f.manager.prepareClose(),true);assert.equal(contents.closed,true);f.manager.dispose();
});
test('unresponsive Figma close fails closed and cleans listeners instead of silently destroying the page',async()=>{
  const f=fixture();f.manager.show({bounds});const contents=f.manager.view.webContents,close=contents.close;
  contents.close=()=>{};const pending=f.manager.prepareClose({timeoutMs:15});assert.equal(f.manager.prepareClose(),pending);
  await assert.rejects(pending,error=>error.code==='FIGMA_CLOSE_FAILED');assert.equal(contents.closed,false);assert.equal(contents.listenerCount('destroyed'),0);
  contents.close=close;f.manager.dispose();
});
test('modal suspend/resume preserves an internally reached login URL without admitting it as a new external URL',()=>{
  const f=fixture(),login='https://www.figma.com/login?is_not_gen_0=true';
  assert.throws(()=>f.manager.show({url:login,bounds,projectId:'1'}));
  f.manager.show({url:'https://www.figma.com/files',bounds,projectId:'1'});const contents=f.manager.view.webContents;
  contents.url=login;contents.emit('did-navigate',{},login);contents.emit('did-stop-loading');f.manager.hide();
  const count=contents.loads.length,result=f.manager.show({url:login,bounds,projectId:'1'});
  assert.equal(result.url,login);assert.equal(result.visible,true);assert.equal(contents.loads.length,count);
  assert.throws(()=>f.manager.show({url:login+'&other=true',bounds,projectId:'1'}));
  assert.throws(()=>f.manager.show({url:login,bounds,projectId:'2'}));f.manager.dispose();
});
