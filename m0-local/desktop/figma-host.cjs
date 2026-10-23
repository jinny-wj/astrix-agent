'use strict';
// Authored remote-web host. The WebContentsView layout approach was informed by
// jinny-wj/astrix-agent, commit 8da3e5b6bf8b3981f50a5e22b26d9484846795bf
// (客户端/desktop/main.ts); no recovered main/preload or login data is imported.
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const PARTITION = 'persist:m0-figma';
const DEFAULT_URL = 'https://www.figma.com/files';
const WEB_PREFERENCES = Object.freeze({ partition: PARTITION, nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false });
const under = (candidate, root) => candidate === root || candidate.startsWith(root + path.sep);

function privateHost(host) {
  host=host.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||!host.includes('.')&&!net.isIP(host))return true;
  if(net.isIPv4(host)){const[a,b]=host.split('.').map(Number);return a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a>=224;}
  if(net.isIPv6(host)){if(host==='::'||host==='::1'||/^f[cd]/i.test(host)||/^fe[89ab]/i.test(host))return true;const mapped=/^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);return mapped?privateHost(mapped[1]):/^::ffff:/i.test(host);}
  return false;
}
function publicHTTPS(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!privateHost(u.hostname)?u:null;}catch{return null;}}
function isFigmaNavigation(value){const u=publicHTTPS(value);return Boolean(u&&(u.hostname==='figma.new'||u.hostname==='figma.com'||u.hostname.endsWith('.figma.com')));}
function normalizeFigmaURL(value){const u=publicHTTPS(value);if(!u||!['figma.new','figma.com','www.figma.com'].includes(u.hostname))throw new Error('请使用官方 Figma HTTPS 文件或首页链接');if(u.hostname==='figma.new'){if(u.pathname!=='/')throw new Error('figma.new 链接无效');}else if(!/^\/(?:$|(?:design|file|proto|board|slides|draw|make|files)(?:\/|$))/.test(u.pathname))throw new Error('请使用 Figma 文件、项目首页或 figma.new 链接');return u.href;}
function allowsRemoteRequest(value){try{const u=new URL(value);if(['data:','blob:'].includes(u.protocol))return true;return ['https:','wss:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port&&!privateHost(u.hostname);}catch{return false;}}
const BRIDGE_METHODS=Object.freeze({pair:'POST',selection:'POST',pull:'GET',ack:'POST'});
function bridgeEndpoint(value,baseURL){try{const u=new URL(value),base=new URL(baseURL);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.port!==(base.port||'')||u.username||u.password||u.hash)return null;const route=u.pathname.match(/^\/__local\/figma\/bridge\/(pair|selection|pull|ack)$/)?.[1];return route?BRIDGE_METHODS[route]:null;}catch{return null;}}
function opaqueChildFrame(frame,contents){try{return Boolean(frame&&contents&&!frame.detached&&frame!==contents.mainFrame&&frame.top===contents.mainFrame&&frame.origin==='null');}catch{return false;}}
function ownsRequest(details,contents){return Boolean(contents&&(details.webContents===contents||Number.isInteger(contents.id)&&details.webContentsId===contents.id));}
function allowsBridgeRequest(details,baseURL,contents){const expected=bridgeEndpoint(details.url,baseURL);return Boolean(expected&&ownsRequest(details,contents)&&isFigmaNavigation(contents.getURL())&&opaqueChildFrame(details.frame,contents)&&(details.method===expected&&details.resourceType==='xhr'||details.method==='OPTIONS'&&['xhr','other'].includes(details.resourceType)));}
function allowsBridgeHeaders(details,baseURL,contents){if(!allowsBridgeRequest(details,baseURL,contents))return false;const headers=Object.fromEntries(Object.entries(details.requestHeaders||{}).map(([k,v])=>[k.toLowerCase(),v]));if(headers.origin!=='null')return false;if(details.method==='OPTIONS'){if(headers['access-control-request-method']!==bridgeEndpoint(details.url,baseURL))return false;if(String(headers['access-control-request-headers']||'').split(',').some(name=>name.trim()&&!['authorization','content-type'].includes(name.trim().toLowerCase())))return false;}return true;}
function contextFromURL(value){try{const u=new URL(value);if(!isFigmaNavigation(value))return{fileKey:null,nodeId:null};const parts=u.pathname.split('/').filter(Boolean),fileKey=['design','file','proto','board','slides','draw','make'].includes(parts[0])?parts[1]||null:null;let nodeId=u.searchParams.get('node-id')||u.searchParams.get('node_id');if(!nodeId&&u.hash){const hash=u.hash.slice(1),p=new URLSearchParams(hash.includes('?')?hash.slice(hash.indexOf('?')+1):hash);nodeId=p.get('node-id')||p.get('node_id');}if(nodeId&&/^\d+-\d+$/.test(nodeId))nodeId=nodeId.replace('-',':');return{fileKey,nodeId:nodeId?.slice(0,200)||null};}catch{return{fileKey:null,nodeId:null};}}
function normalizeProjectId(value){if(value===undefined||value===null||value==='')return null;if(!['string','number'].includes(typeof value)||!/^[A-Za-z0-9_-]{1,128}$/.test(String(value)))throw new Error('Figma 项目标识无效');return String(value);}
function normalizeBounds(value){if(!value||!['x','y','width','height'].every(k=>typeof value[k]==='number'&&Number.isFinite(value[k])&&Math.abs(value[k])<=100000))throw new Error('Figma 容器需要有限 CSS 像素矩形');return Object.fromEntries(['x','y','width','height'].map(k=>[k,Math.round(value[k])]));}
function permitsGesturePermission(permission,{trusted=false,visible=false,recentGesture=false,isMainFrame=false}={}){return trusted&&visible&&recentGesture&&isMainFrame&&['clipboard-read','clipboard-sanitized-write','fullscreen'].includes(permission);}
function isTrustedLocalMainFrame(event,window,baseURL){try{const u=new URL(event.senderFrame?.url||'');return Boolean(window&&!window.isDestroyed()&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&u.origin===new URL(baseURL).origin&&!u.username&&!u.password);}catch{return false;}}

class FigmaHostManager {
  constructor({window,root,baseURL,onStatus=()=>{},electron,fetch:fetcher=globalThis.fetch}){
    this.electron=electron||require('electron');this.window=window;this.root=root;this.baseURL=new URL(baseURL);this.fetch=fetcher;this.onStatus=onStatus;this.view=null;this.visible=false;this.loading=false;this.url=null;this.projectId=null;this.bounds=null;this.title='Figma';this.error=null;this.disposed=false;this.authWindows=new Set();this.gestures=new WeakMap();this.initialized=false;this.navigationGeneration=0;
    this.resize=()=>this.applyBounds();this.navigation=(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace)this.hide();};this.navigated=()=>this.hide();
    window.on('resize',this.resize);window.webContents.on('did-start-navigation',this.navigation);window.webContents.on('did-navigate',this.navigated);
  }
  status(){return{available:!this.disposed,mode:'remote-figma-web',visible:this.visible,loading:this.loading,url:this.url,...contextFromURL(this.url),title:this.title,error:this.error,projectId:this.projectId,bounds:this.view?.getBounds()||this.bounds};}
  emit(){if(!this.disposed)this.onStatus(this.status());}
  recent(contents,windowMs=4000){return Date.now()-(this.gestures.get(contents)||0)<windowMs;}
  trackGestures(contents){contents.on('before-input-event',(_event,input)=>{if(input.type==='keyDown'||input.type==='rawKeyDown')this.gestures.set(contents,Date.now());});contents.on('before-mouse-event',(_event,input)=>{if(input.type==='mouseDown')this.gestures.set(contents,Date.now());});}
  bridgeNetworkPermission(contents,name,origin,details){
    // Electron 38 does not expose a target URL on LNA permission requests. Grant
    // only an opaque child of this Figma view; webRequest remains the authority
    // for the exact loopback port/path/method. A null WebContents check is denied
    // so Chromium must make the request with its real owning WebContents.
    try{if(!['local-network-access','loopback-network'].includes(name)||!contents||contents!==this.view?.webContents||!this.visible||!isFigmaNavigation(contents.getURL())||details?.isMainFrame!==false||origin&&origin!=='null')return false;
    return contents.mainFrame.framesInSubtree.some(frame=>opaqueChildFrame(frame,contents)&&(!details.requestingUrl||frame.url===details.requestingUrl));}catch{return false;}
  }
  initialize(){
    if(this.initialized)return;this.initialized=true;const {session,WebContentsView}=this.electron;this.session=session.fromPartition(PARTITION);
    // Public HTTPS resources and WSS are left to Chromium's web security so
    // Figma CDNs, collaboration and federated login work normally. Loopback,
    // local network literals, file/custom schemes and insecure requests remain
    // unavailable except the four paired-plugin XHR endpoints below. The local
    // application session is unchanged. Origin is checked again before headers
    // leave Chromium; no Origin or Authorization header is synthesized here.
    this.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowsRemoteRequest(details.url)&&!allowsBridgeRequest(details,this.baseURL,this.view?.webContents)}));
    this.session.webRequest.onBeforeSendHeaders((details,callback)=>{const local=!allowsRemoteRequest(details.url);callback({cancel:local&&!allowsBridgeHeaders(details,this.baseURL,this.view?.webContents),requestHeaders:details.requestHeaders});});
    const permission=(contents,name,url,details)=>permitsGesturePermission(name,{trusted:contents===this.view?.webContents&&isFigmaNavigation(contents?.getURL())&&isFigmaNavigation(url||''),visible:this.visible,recentGesture:this.recent(contents),isMainFrame:details?.isMainFrame===true});
    this.session.setPermissionRequestHandler((contents,name,callback,details)=>callback(this.bridgeNetworkPermission(contents,name,null,details)||permission(contents,name,details?.requestingUrl||contents?.getURL(),details)));
    this.session.setPermissionCheckHandler((contents,name,origin,details)=>this.bridgeNetworkPermission(contents,name,origin,details)||permission(contents,name,details?.requestingUrl||origin,details));
    this.download=(_event,item,contents)=>{if(this.disposed||contents!==this.view?.webContents||!this.visible||!isFigmaNavigation(contents.getURL())||!this.recent(contents,30000)){_event.preventDefault();return;}item.setSaveDialogOptions?.({title:'保存 Figma 导出',defaultPath:path.join(this.electron.app.getPath('downloads'),path.basename(item.getFilename()||'figma-export')),properties:['showOverwriteConfirmation']});};
    this.session.on('will-download',this.download);
    this.view=new WebContentsView({webPreferences:{...WEB_PREFERENCES,session:this.session}});this.view.setBackgroundColor('#f5f5f5');this.view.setVisible(false);this.window.contentView.addChildView(this.view);const contents=this.view.webContents;this.trackGestures(contents);
    contents.on('will-navigate',(event,url)=>{if(isFigmaNavigation(url)){this.requestedURL=url;return;}event.preventDefault();if(publicHTTPS(url)&&this.recent(contents))this.openAuthWindow(url);});
    contents.on('will-redirect',(event,url)=>{if(isFigmaNavigation(url)){this.requestedURL=url;return;}event.preventDefault();if(publicHTTPS(url))this.openAuthWindow(url);});
    this.configurePopups(contents);
    contents.on('did-start-loading',()=>{this.loading=true;this.error=null;this.emit();});contents.on('did-stop-loading',()=>{if(contents.isLoadingMainFrame?.())return;this.loading=false;this.emit();});
    const location=(_event,url)=>{if(!isFigmaNavigation(url)||this.loading&&url===this.previousURL&&url!==this.requestedURL)return;this.url=url;this.error=null;this.emit();};contents.on('did-navigate',location);contents.on('did-navigate-in-page',location);
    contents.on('page-title-updated',(_event,title)=>{this.title=String(title).slice(0,200)||'Figma';this.emit();});
    contents.on('did-fail-load',(_event,code,description,url,mainFrame)=>{if(!mainFrame||code===-3||url&&url!==this.requestedURL&&url!==this.url)return;this.loading=false;this.error=`Figma 加载失败 (${code})：${description}`;this.emit();});
    contents.on('render-process-gone',(_event,details)=>{this.loading=false;this.error=`Figma 网页进程已退出：${details.reason}`;this.emit();});
    contents.on('will-prevent-unload',event=>{const choice=this.electron.dialog.showMessageBoxSync(this.window,{type:'question',title:'Figma 请求保留页面',message:'Figma 网页阻止了离开。',detail:'请确认更改已在 Figma 保存后再离开；也可以留在页面继续操作。',buttons:['留在 Figma','仍然离开'],defaultId:0,cancelId:0});if(choice===1)event.preventDefault();else this.closeDecision?.(false);});
  }
  configurePopups(contents){contents.setWindowOpenHandler(({url})=>{if(this.disposed)return{action:'deny'};if(isFigmaNavigation(url)&&contextFromURL(url).fileKey){this.navigate(url);return{action:'deny'};}if(!publicHTTPS(url)||this.authWindows.size>=4)return{action:'deny'};return{action:'allow',overrideBrowserWindowOptions:{parent:this.window,width:620,height:820,title:'Figma 登录 · '+new URL(url).hostname,webPreferences:{...WEB_PREFERENCES,session:this.session}}};});contents.on('did-create-window',popup=>this.secureAuthWindow(popup));}
  secureAuthWindow(popup){if(this.disposed){popup.destroy();return;}this.authWindows.add(popup);const contents=popup.webContents;this.trackGestures(contents);this.configurePopups(contents);const navigation=(event,url)=>{if(!publicHTTPS(url))event.preventDefault();};contents.on('will-navigate',navigation);contents.on('will-redirect',navigation);const title=()=>{try{popup.setTitle('Figma 登录 · '+new URL(contents.getURL()).hostname);}catch{}};contents.on('did-navigate',title);contents.on('page-title-updated',event=>{event.preventDefault();title();});popup.on('closed',()=>{this.authWindows.delete(popup);if(!this.disposed&&this.visible&&!this.view?.webContents.isDestroyed())this.view.webContents.reload();});}
  openAuthWindow(url){if(!publicHTTPS(url)||this.authWindows.size>=4||this.disposed)return;const popup=new this.electron.BrowserWindow({parent:this.window,width:620,height:820,title:'Figma 登录 · '+new URL(url).hostname,webPreferences:{...WEB_PREFERENCES,session:this.session}});this.secureAuthWindow(popup);void popup.loadURL(url).catch(()=>{});}
  navigate(url){if(this.disposed)throw new Error('Figma 网页宿主已关闭');this.initialize();if(!isFigmaNavigation(url))throw new Error('Figma 导航地址无效');const generation=++this.navigationGeneration;this.previousURL=this.url;this.requestedURL=url;this.url=url;this.loading=true;this.error=null;this.emit();void this.view.webContents.loadURL(url).catch(error=>{if(!this.disposed&&generation===this.navigationGeneration&&error.code!=='ERR_ABORTED'){this.loading=false;this.error=error.message;this.emit();}});}
  show({url,bounds,projectId}={}){if(this.disposed)throw new Error('Figma 网页宿主已关闭');const nextProject=projectId===undefined?this.projectId:normalizeProjectId(projectId),resumeCurrent=url===this.url&&nextProject===this.projectId&&isFigmaNavigation(url),nextURL=url?(resumeCurrent?url:normalizeFigmaURL(url)):nextProject!==this.projectId?DEFAULT_URL:this.url||DEFAULT_URL,nextBounds=normalizeBounds(bounds||this.bounds);this.projectId=nextProject;this.initialize();this.visible=true;this.bounds=nextBounds;this.applyBounds();if(nextURL!==this.url||!this.view.webContents.getURL()||this.error)this.navigate(nextURL);this.emit();return this.status();}
  hide(){this.visible=false;this.view?.setVisible(false);this.emit();return this.status();}
  updateBounds(bounds){this.bounds=normalizeBounds(bounds);this.applyBounds();this.emit();return this.status();}
  applyBounds(){if(!this.view||!this.bounds||this.disposed||this.window.isDestroyed())return;const[w,h]=this.window.getContentSize(),x=Math.max(0,Math.min(w,this.bounds.x)),y=Math.max(0,Math.min(h,this.bounds.y));this.view.setBounds({x,y,width:Math.max(1,Math.min(w-x,this.bounds.width)),height:Math.max(1,Math.min(h-y,this.bounds.height))});this.view.setVisible(this.visible&&this.bounds.width>1&&this.bounds.height>1&&x<w&&y<h);}
  async openExternal(url){const target=normalizeFigmaURL(url||this.url||DEFAULT_URL);await this.electron.shell.openExternal(target);return{opened:true,url:target};}
  async revealBridgePlugin({projectId}={}){
    const id=normalizeProjectId(projectId??this.projectId),url=new URL('/__local/figma/metadata',this.baseURL);if(id!==null)url.searchParams.set('projectId',id);const response=await this.fetch(url,{headers:{Origin:this.baseURL.origin},signal:AbortSignal.timeout(10000)});const metadata=await response.json();if(!response.ok)throw new Error(metadata.error||'Figma 插件元数据不可用');
    if(typeof metadata.pluginDirectory!=='string'||typeof metadata.manifestPath!=='string')throw new Error('Figma 插件尚未生成');if(id!==null&&String(metadata.projectId)!==id)throw new Error('Figma 插件项目上下文不匹配');
    const directory=await fs.realpath(metadata.pluginDirectory),manifest=await fs.realpath(metadata.manifestPath),roots=[path.join(this.root,'.local-data','figma-plugin'),path.join(path.resolve(process.env.M0_LOCAL_DATA_DIR||path.join(this.root,'.local-data')),'figma-plugin')];let allowed=false;for(const root of roots){try{if(under(directory,await fs.realpath(root)))allowed=true;}catch{}}
    if(!allowed||path.basename(manifest)!=='manifest.json'||path.dirname(manifest)!==directory||!(await fs.stat(manifest)).isFile())throw new Error('Figma 插件路径不属于本项目生成目录');this.electron.shell.showItemInFolder(manifest);return{revealed:true,pluginDirectory:directory,manifestPath:manifest,installation:'请在 Figma Desktop 导入此 manifest，或发布团队私有插件后在当前文件运行。'};
  }
  hasLivePage(){return Boolean(this.view&&!this.view.webContents.isDestroyed());}
  prepareClose({timeoutMs=20000}={}){
    if(this.closeAttempt)return this.closeAttempt;
    if(this.disposed||!this.hasLivePage())return Promise.resolve(true);
    const view=this.view,contents=view.webContents;let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});this.closeAttempt=promise;
    const cleanup=()=>{clearTimeout(timer);contents.removeListener('destroyed',destroyed);if(this.closeAttempt===promise)this.closeAttempt=null;this.closeDecision=null;};
    const destroyed=()=>{cleanup();try{this.window.contentView.removeChildView(view);}catch{}if(this.view===view)this.view=null;this.visible=false;this.loading=false;this.emit();resolve(true);};
    const timer=setTimeout(()=>{cleanup();reject(Object.assign(new Error('Figma 页面未完成关闭，窗口已保留；请确认网页状态后重试。'),{code:'FIGMA_CLOSE_FAILED'}));},timeoutMs);
    this.closeDecision=leave=>{if(leave)return;cleanup();resolve(false);};contents.once('destroyed',destroyed);
    try{contents.close({waitForBeforeUnload:true});}catch(error){cleanup();reject(Object.assign(error,{code:'FIGMA_CLOSE_FAILED'}));}
    return promise;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.visible=false;for(const popup of this.authWindows){try{popup.destroy();}catch{}}this.authWindows.clear();if(this.download)this.session?.removeListener('will-download',this.download);if(this.view){try{this.window.contentView.removeChildView(this.view);}catch{}if(!this.view.webContents.isDestroyed())this.view.webContents.close({waitForBeforeUnload:false});this.view=null;}this.window.removeListener('resize',this.resize);this.window.webContents.removeListener('did-start-navigation',this.navigation);this.window.webContents.removeListener('did-navigate',this.navigated);}
}
module.exports={FigmaHostManager,PARTITION,DEFAULT_URL,WEB_PREFERENCES,normalizeFigmaURL,isFigmaNavigation,allowsRemoteRequest,bridgeEndpoint,allowsBridgeRequest,allowsBridgeHeaders,contextFromURL,normalizeBounds,normalizeProjectId,permitsGesturePermission,isTrustedLocalMainFrame};
