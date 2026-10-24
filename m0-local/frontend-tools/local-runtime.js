/* Local integration for the recovered M0 browser UI. This is new source. */
(() => {
  'use strict';
  // Preserve Vue's static image nodes; use readable text in wordmark slots and
  // the existing square Astrix icon for avatars. No user content is rewritten.
  function installBranding() {
    const marked=new WeakSet();
    const refresh=()=>{
      for(const image of document.querySelectorAll('img[src="/branding/astrix-logo-v1.png"]')){
        if(marked.has(image))continue;marked.add(image);
        const label=document.createElement('span');label.textContent='Astrix';label.className=image.className;
        label.dataset.astrixWordmark='';label.setAttribute('aria-label','Astrix');
        Object.assign(label.style,{display:'inline-flex',alignItems:'center',fontFamily:'Inter,-apple-system,BlinkMacSystemFont,sans-serif',fontSize:'16px',fontWeight:'700',lineHeight:'1',letterSpacing:'-.3px'});
        image.alt='Astrix';image.style.display='none';image.after(label);
      }
    };
    refresh();new MutationObserver(refresh).observe(document.body,{childList:true,subtree:true});
  }
  addEventListener('DOMContentLoaded',installBranding,{once:true});
  const nativeFetch = window.fetch.bind(window);
  const NativeXHR = window.XMLHttpRequest;
  const NativeWebSocket = window.WebSocket;
  const originalOpen = window.open.bind(window);
  const localOrigin = location.origin;
  const assetPrefix = '/vendor/s2-12205.kwimgs.com/kos/proj-gis/Z2lz/kos/nlav12205/workbench/';
  const report = (message, stack = '', url = '') => {
    // Only code errors, never user identity, requests, storage, or page contents.
    nativeFetch('/__local/client-error', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: String(message).slice(0, 2000), stack: String(stack).slice(0, 8000), url: String(url).split('?')[0] }),
    }).catch(() => {});
  };
  addEventListener('error', event => report(event.message || 'Resource error', event.error?.stack, event.filename));
  addEventListener('unhandledrejection', event => report(event.reason?.message || event.reason, event.reason?.stack));

  function remap(input) {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return url.href;
    if (url.origin === localOrigin) return url.href;
    // No original server is contacted. All old local ports and remote service
    // paths are served by this project's backend and its explicit integrations.
    url.host = location.host;
    url.protocol = url.protocol.startsWith('ws') ? (location.protocol === 'https:' ? 'wss:' : 'ws:') : location.protocol;
    return url.href;
  }

  let figmaContextFrame=null;
  function currentFigmaContext() {
    const value=window.__M0_FIGMA_CONTEXT__,id=new URLSearchParams(location.search).get('id');
    const frame=[...document.querySelectorAll('[data-m0-figma-workspace-frame]')].find(frame=>frame.getBoundingClientRect().width>20&&frame.getBoundingClientRect().height>20);
    if(!value||!frame||frame!==figmaContextFrame||!id||String(value.projectId)!==id||!value.fileKey||!value.sessionId||!Array.isArray(value.targetNodeIds))return null;
    return structuredClone(value);
  }
  window.fetch = async (input, init) => {
    const target = remap(input);
    const path=new URL(target).pathname,method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    if(method==='POST'&&['/api/agent/chat','/__local/chat','/__local/workflow/run'].includes(path)){
      const context=currentFigmaContext();
      if(context)try{
        const source=init?.body??(input instanceof Request?await input.clone().text():null);
        if(typeof source==='string'){const body=JSON.parse(source);if(body&&typeof body==='object'&&!Array.isArray(body)&&!Object.prototype.hasOwnProperty.call(body,'figmaContext'))init={...init,body:JSON.stringify({...body,figmaContext:context})};}
      }catch{/* Non-JSON requests keep their original body. */}
    }
    if (input instanceof Request) {
      // Original authorization and cookie values cannot cross into local APIs.
      const request = new Request(target, input);
      const headers = new Headers(init?.headers || request.headers);
      headers.delete('authorization'); headers.delete('cookie');
      return nativeFetch(new Request(request, { ...init, headers, credentials: 'same-origin' }));
    }
    const headers = new Headers(init?.headers);
    headers.delete('authorization'); headers.delete('cookie');
    return nativeFetch(target, { ...init, headers, credentials: 'same-origin' });
  };
  window.nativeFetch = window.fetch;
  class LocalXHR extends NativeXHR {
    open(method, url, ...options) { return super.open(method, remap(url), ...options); }
    setRequestHeader(name, value) {
      if (/^(?:authorization|cookie)$/i.test(name)) return;
      return super.setRequestHeader(name, value);
    }
  }
  window.XMLHttpRequest = LocalXHR;
  window.NativeXMLHttpRequest = LocalXHR;
  if (NativeWebSocket) {
    class LocalWebSocket extends NativeWebSocket {
      constructor(url, protocols) { super(remap(url), ...(protocols === undefined ? [] : [protocols])); }
    }
    window.WebSocket = LocalWebSocket;
  }
  // Trackers must not use sendBeacon to escape the network adapter.
  if (navigator.sendBeacon) navigator.sendBeacon = () => true;
  window.open = (url, ...args) => {
    if (url && new URL(url, location.href).origin !== localOrigin) {
      window.alert('此恢复版尚未接入该外部服务。请在“本地设置”中配置可用的模型与本地项目。');
      return null;
    }
    return originalOpen(url, ...args);
  };
  document.addEventListener('click', event => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    const destination = new URL(anchor.href, location.href);
    if (!['http:', 'https:'].includes(destination.protocol) || destination.origin === localOrigin) return;
    event.preventDefault(); event.stopImmediatePropagation();
    window.alert('此恢复版尚未接入该外部服务。请通过“本地设置”查看已支持的功能。');
  }, true);

  // Rebuild only the necessary public runtime shape. No original account,
  // cached session, SSO value, or injected server JSON is used.
  const user = { name: 'local-user', displayName: '本地用户', avatar: '/branding/astrix-dock.png' };
  localStorage.setItem('USER_INFO_RECORD_CACHE', JSON.stringify(user));
  localStorage.setItem('M0_APP_THEME', 'light');
  if (!['code', 'design'].includes(localStorage.getItem('M0Mode'))) localStorage.setItem('M0Mode', 'code');
  localStorage.setItem('WEBLOGGER_SILENCED', '1');
  window.m0AppTheme = 'light';
  window.__M0_LOCAL_PLUGINS__ = Object.freeze({});
  const modelConfig = { models: [{ model_id: 'wanqing-online-reasoning/local-model', display_name: '本地模型', enable: true, autoCandidate: true, multimodal: false }] };
  const codeModelKey = 'kConf_openApiBaas.data__airstar-689efd34e57bde596a38c5b0.dataDetail_1780978836368';
  const designModelKey = 'kConf_openApiBaas.data__airstar-689efd34e57bde596a38c5b0.dataDetail_1784717314617';
  window[codeModelKey] = structuredClone(modelConfig);
  window[designModelKey] = structuredClone(modelConfig);
  const modelReady = nativeFetch('/__local/models').then(response => response.ok ? response.json() : null).then(config => {
    if (!Array.isArray(config?.models) || !config.models.length) return;
    const normalized = { ...config, models: config.models.map(model => ({ ...model, display_name: model.display_name || model.name || model.model_id, autoCandidate: true })) };
    window[codeModelKey] = structuredClone(normalized); window[designModelKey] = structuredClone(normalized);
  }).catch(() => {});
  window.__M0_NATIVE_EDITOR_AVAILABLE__ = false;
  const nativeEditorReady = window.m0LocalDesktop?.nativeEditor?.available
    ? window.m0LocalDesktop.nativeEditor.available().then(available => { window.__M0_NATIVE_EDITOR_AVAILABLE__ = available === true; }).catch(() => {})
    : Promise.resolve();
  window.__m0LocalReady = Promise.all([modelReady, nativeEditorReady]);
  window['kConf_openApiBaas.m0-ai.iframe-connection'] = { blankList: [localOrigin] };
  window['kConf_openApiBaas.m0_ai.app_inside_config'] = {};

  async function rpc(method, ...args) {
    const response = await nativeFetch('/__local/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }) });
    const body = await response.json();
    if (!response.ok || body?.error) throw new Error(body.error?.message || body.error || `${method}: HTTP ${response.status}`);
    return Object.prototype.hasOwnProperty.call(body, 'result') ? body.result : body;
  }
  const localEvents = new Map();
  const listen = (name, fn) => {
    if (typeof fn !== 'function') return () => {};
    const callbacks = localEvents.get(name) || new Set(); callbacks.add(fn); localEvents.set(name, callbacks);
    return () => callbacks.delete(fn);
  };
  const api = (group, methods) => Object.fromEntries(methods.map(name => [name, (...args) => rpc(group + '.' + name, ...args)]));
  window.cliAPI ||= api('cli', ['getPorts', 'getCwd', 'getVersion', 'getStatus', 'restart']);
  window.opencodeAPI ||= {
    ...api('opencode', ['getStatus', 'clientCall', 'start', 'stop', 'restart', 'syncSkillsByScope']),
    onEvent: fn => listen('opencode', fn), onAllEvent: fn => listen('opencode', fn),
    onStatusChange: fn => listen('opencodeStatus', fn),
  };
  window.configAPI ||= {
    get: async ({ scope = 'global', key }) => ({ value: JSON.parse(localStorage.getItem(`m0-local-config:${scope}:${key}`) || 'null') }),
    set: async ({ scope = 'global', key, value }) => { localStorage.setItem(`m0-local-config:${scope}:${key}`, JSON.stringify(value)); return { value }; },
    merge: async ({ scope = 'global', value }) => { for (const [key, item] of Object.entries(value || {})) localStorage.setItem(`m0-local-config:${scope}:${key}`, JSON.stringify(item)); return { value }; },
  };
  window.workspaceAPI ||= {
    ...api('workspace', ['getCurrentPath', 'getHistory', 'updateAndRestart']),
    selectPath: async (...args) => {
      const result = !args[0] && window.m0LocalDesktop?.chooseWorkspace
        ? await window.m0LocalDesktop.chooseWorkspace()
        : await rpc('workspace.selectPath', ...args);
      window.__M0_LOCAL_NATIVE_EDITOR__?.refresh();
      return result;
    },
  };
  window.appAPI ||= {
    ...api('app', ['getInfo', 'getHomedir', 'getMainWindowBounds']),
    createSubWindow: async (_tag, url) => { location.href = remap(url); return true; },
    closeSubWindow: async () => { location.href = '/home'; return true; },
    relaunch: async () => location.reload(),
  };

  addEventListener('DOMContentLoaded', () => {
    const links = document.createElement('nav');
    links.setAttribute('aria-label', '本地恢复功能');
    links.style.cssText = 'position:fixed;right:18px;bottom:12px;z-index:2147483640;display:flex;gap:12px;font:12px -apple-system,sans-serif;background:rgba(255,255,255,.94);border:1px solid #e3e6ed;border-radius:7px;padding:7px 11px;box-shadow:0 2px 8px #1520480a';
    for (const [title, href] of [['本地设置','/__local/settings'],['项目与会话','/__local/projects'],['Figma 工作区','/figma-workspace.html'],['代码工具','/codegen.html'],['多 Agent','/__local/workflow'],['原版 Skills','/__local/skills']]) {
      const anchor = document.createElement('a'); anchor.href = href; anchor.target = '_blank'; anchor.textContent = title;
      if(title==='Figma 工作区')anchor.dataset.m0FigmaLink='';
      if(title==='版本与协作')anchor.dataset.m0DesignCloudLink='';
      anchor.style.cssText = 'color:#6a6e7b;text-decoration:none'; links.appendChild(anchor);
    }
    document.body.appendChild(links);
    refreshCanvasLinks();
    installEditorToolbar();
    void nativeEditorReady.then(installNativeEditorHost);
    installFigmaHost();
  });
  function installEditorToolbar() {
    document.addEventListener('click', async event => {
      const button=event.target instanceof Element?event.target.closest('[data-m0-native-editor-action]'):null;
      if(!button)return;
      button.disabled=true;
      try{
        const shell=button.closest('.m0-local-editor-shell');
        shell?.querySelector('[data-m0-editor-action="code"]')?.click();
        const controller=window.__M0_LOCAL_NATIVE_EDITOR__;
        if(!controller)throw new Error('当前原版编辑器未启动。');
        await controller.runAction(button.dataset.m0NativeEditorAction);
      }catch(error){window.alert(error?.message||'原版编辑器操作失败');}
      finally{button.disabled=false;}
    });
    document.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('[data-m0-editor-action]') : null;
      if (!button) return;
      const shell = button.closest('.m0-local-editor-shell');
      const content = shell?.querySelector('[data-m0-editor-content]');
      if (!content) return;
      const mode = button.dataset.m0EditorAction;
      shell.dataset.m0EditorMode = mode;
      let preview = content.querySelector('[data-m0-preview-frame]');
      if (mode === 'preview') {
        if (!preview) {
          preview = document.createElement('iframe'); preview.dataset.m0PreviewFrame = '';
          preview.title = '本地 HTML 预览'; preview.setAttribute('sandbox', 'allow-scripts');
          preview.style.cssText = 'width:100%;height:100%;border:0;background:#fff'; content.appendChild(preview);
        }
        preview.src = '/__local/preview?t=' + Date.now();
      }
      for (const child of content.children) child.style.display = mode === 'preview' ? (child === preview ? 'block' : 'none') : (child === preview ? 'none' : 'block');
      for (const item of shell.querySelectorAll('[data-m0-editor-action]')) item.style.background = item === button ? '#eaf2ff' : '#fff';
      window.__M0_LOCAL_NATIVE_EDITOR__?.refresh();
    });
    let lastRoute = location.pathname + location.search;
    new MutationObserver(() => {
      const route = location.pathname + location.search;
      if (route === lastRoute) return;
      lastRoute = route;
      for (const frame of document.querySelectorAll('.m0-local-editor-shell[data-m0-editor-mode="preview"] [data-m0-preview-frame]')) frame.src = '/__local/preview?t=' + Date.now();
      refreshCanvasLinks();
    }).observe(document.body, {childList:true,subtree:true});
  }
  function refreshCanvasLinks() {
    const id=new URLSearchParams(location.search).get('id');
    const url='/local-canvas/index.html'+(id?'?projectId='+encodeURIComponent(id):'');
    for(const frame of document.querySelectorAll('[data-m0-local-canvas-frame]'))if(frame.getAttribute('src')!==url)frame.setAttribute('src',url);
    for(const anchor of document.querySelectorAll('[data-m0-canvas-link]'))anchor.href=url;
    const figma='/figma-workspace.html'+(id?'?projectId='+encodeURIComponent(id):'');
    for(const frame of document.querySelectorAll('[data-m0-figma-workspace-frame]'))if(frame.getAttribute('src')!==figma)frame.setAttribute('src',figma);
    for(const anchor of document.querySelectorAll('[data-m0-figma-link]'))anchor.href=figma;
    const context=window.__M0_FIGMA_CONTEXT__;if(context&&String(context.projectId)!==String(id||''))setFigmaContext(null);
    for(const anchor of document.querySelectorAll('[data-m0-design-cloud-link]'))anchor.href='/__local/design-cloud'+(id?'?projectId='+encodeURIComponent(id):'');
  }
  function setFigmaContext(value,frame=null){figmaContextFrame=frame;window.__M0_FIGMA_CONTEXT__=value;dispatchEvent(new CustomEvent('m0-local-figma-context',{detail:value}));}
  function installFigmaHost(){
    const native=window.m0LocalDesktop?.figmaHost,records=new WeakMap();let available=false,shown=false,current=null,pending=false,sequence=0,raf=0,lastKey='',activeRequest=null;
    const visible=element=>{const r=element.getBoundingClientRect();return r.width>20&&r.height>20&&getComputedStyle(element).visibility!=='hidden';};
    const send=(frame,type,payload)=>{try{frame.contentWindow?.postMessage({source:'m0-local-figma-parent',type,payload},localOrigin);}catch{}};
    const frames=()=>[...document.querySelectorAll('[data-m0-figma-workspace-frame]')];
    const schedule=()=>{if(!raf)raf=requestAnimationFrame(update);};
    async function hide(){sequence++;shown=false;lastKey='';if(native)await native.hide().catch(()=>{});}
    function isBlocked(frame,record){return !frame||!visible(frame)||document.hidden||record?.suspended||[...document.querySelectorAll('dialog[open],.arco-modal-wrapper,.arco-drawer,.ks-dialog,[role="dialog"]')].some(visible);}
    async function update(){
      raf=0;const frame=frames().find(frame=>visible(frame)&&records.has(frame)),record=frame&&records.get(frame);
      if(!available||isBlocked(frame,record)||!record?.requested){current=null;if(shown)await hide();return;}
      if(record.failedVersion===record.version)return;
      let host;try{host=frame.contentDocument?.querySelector('[data-m0-figma-host]');}catch{}
      if(!host||!visible(host)){if(shown)await hide();return;}
      const outer=frame.getBoundingClientRect(),inner=host.getBoundingClientRect(),bounds={x:Math.max(0,Math.round(outer.x+frame.clientLeft+inner.x)),y:Math.max(0,Math.round(outer.y+frame.clientTop+inner.y)),width:Math.round(Math.min(inner.width,outer.width)),height:Math.round(Math.min(inner.height,outer.height))};
      const key=JSON.stringify({bounds,url:record.url,projectId:record.projectId});
      if(pending)return;if(shown&&current===frame&&lastKey===key)return;
      const same=shown&&current===frame&&record.shownURL===record.url;
      current=frame;lastKey=key;pending=true;shown=true;const token=++sequence,url=record.url,projectId=record.projectId,version=record.version;activeRequest={frame,version};
      try{const status=same?await native.updateBounds(bounds):await native.show({url,bounds,projectId});const superseded=version!==record.version;if(!superseded){record.shownURL=status?.url||url;if(status?.url)record.url=status.url;send(frame,'host-status',status);}if(superseded||token!==sequence||isBlocked(frame,record)||!frame.isConnected){shown=false;await native.hide();}}
      catch(error){shown=false;record.failedVersion=version;send(frame,'host-status',{available:true,error:error.message,projectId:record.projectId});}
      finally{pending=false;activeRequest=null;schedule();}
    }
    if(native){void native.available().then(value=>{available=value===true;for(const frame of frames())send(frame,'capabilities',{nativeAvailable:available});schedule();}).catch(()=>{});native.onStatus?.(status=>{for(const frame of frames()){const record=records.get(frame);if(record&&String(status.projectId??'')===String(record.projectId??'')){if(pending&&activeRequest?.frame===frame&&activeRequest.version!==record.version)continue;if(!pending&&status.url){record.url=status.url;record.shownURL=status.url;}send(frame,'host-status',status);}}});}
    addEventListener('message',async event=>{
      if(event.origin!==localOrigin||event.data?.source!=='m0-local-figma')return;
      const frame=frames().find(frame=>frame.contentWindow===event.source);if(!frame)return;
      let frameURL;try{frameURL=new URL(frame.src);}catch{return;}if(frameURL.origin!==localOrigin||frameURL.pathname!=='/figma-workspace.html')return;
      const expected=frameURL.searchParams.get('projectId')||'',payload=event.data.payload||{},type=event.data.type;
      if(expected&&String(payload.projectId??'')!==expected)return;
      const record=records.get(frame)||{projectId:expected||payload.projectId||null,url:'',requested:false,suspended:false,version:0};records.set(frame,record);
      if(type==='ready'){send(frame,'capabilities',{nativeAvailable:available});schedule();return;}
      if(type==='context'){
        const routeId=new URLSearchParams(location.search).get('id');
        if(!routeId||String(payload.projectId)!==routeId)return;
        if(!payload.fileKey||!payload.sessionId){setFigmaContext(null);return;}
        if(!Array.isArray(payload.targetNodeIds)||payload.targetNodeIds.some(id=>typeof id!=='string'||id.length>200))return;
        setFigmaContext({projectId:payload.projectId,fileKey:payload.fileKey,sessionId:payload.sessionId,selectionRevision:payload.selectionRevision,selectionVersion:payload.selectionRevision,targetNodeIds:payload.targetNodeIds,nodes:Array.isArray(payload.nodes)?payload.nodes:[]},frame);return;
      }
      if(type!=='host-request')return;
      if(payload.action==='show'){record.url=payload.url||record.url;record.projectId=payload.projectId??record.projectId;record.version++;record.requested=true;record.suspended=false;schedule();}
      else if(payload.action==='suspend'||payload.action==='hide'){record.suspended=true;await hide();if(payload.requestId)send(frame,'host-action',{requestId:payload.requestId,ok:true});}
      else if(payload.action==='resume'||payload.action==='layout'){if(payload.action==='resume')record.suspended=false;schedule();}
      else if(['openExternal','revealBridgePlugin'].includes(payload.action))try{if(!native)throw Error('当前浏览器请直接打开 Figma，并从插件目录导入 Bridge。');await hide();await native[payload.action](payload.action==='openExternal'?payload.url:{projectId:record.projectId});}catch(error){send(frame,'host-error',{message:error.message});}
    });
    new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','open']});
    new ResizeObserver(schedule).observe(document.body);addEventListener('resize',schedule);addEventListener('scroll',schedule,true);addEventListener('visibilitychange',schedule);
    addEventListener('pagehide',()=>{if(native)void native.hide();setFigmaContext(null);});
    setInterval(schedule,500);
  }
  function installNativeEditorHost() {
    const native = window.m0LocalDesktop?.nativeEditor;
    if (!native || !window.__M0_NATIVE_EDITOR_AVAILABLE__) return;
    let frame = 0, currentHost = null, project = '', lastBounds = '', pending = false, shown = false, refreshRequested = false, showPromise=Promise.resolve();
    const observed = new WeakSet(), failed = new WeakSet();
    const resize = new ResizeObserver(() => schedule());
    const visible = element => { const r = element.getBoundingClientRect(); return r.width > 20 && r.height > 20 && getComputedStyle(element).visibility !== 'hidden'; };
    const schedule = (force = false) => { refreshRequested ||= force; if (!frame) frame = requestAnimationFrame(update); };
    async function hide() { if (shown) { shown = false; await native.hide().catch(() => {}); } }
    function updateLabel(status,host=currentHost){
      const label=host?.closest('.m0-local-editor-shell')?.querySelector('[data-m0-native-editor-label]');
      if(!label)return;
      const capabilities=status?.capabilities||{};
      label.textContent='原版 KSCode'+(capabilities.terminal&&capabilities.extensions?' · 本地终端与扩展':capabilities.terminal?' · 本地终端':' · 终端与扩展未启用');
      if(status?.marketplace?.enabled)label.textContent+=' · Open VSX';
    }
    function fallback(host) {
      failed.add(host);
      const label = host.closest('.m0-local-editor-shell')?.querySelector('[data-m0-native-editor-label]');
      if (label) label.textContent = '本地文件编辑器 · 原版 KSCode 启动失败，可刷新重试';
      const iframe = document.createElement('iframe'); iframe.src = '/__local/editor?embedded=1'; iframe.title = '本地文件编辑器';
      iframe.style.cssText = 'width:100%;height:100%;border:0;background:#fff'; host.replaceChildren(iframe);
    }
    async function update() {
      frame = 0;
      const hosts = [...document.querySelectorAll('[data-m0-native-editor-host]')];
      for (const host of hosts) if (!observed.has(host)) { observed.add(host); resize.observe(host); }
      const modal = [...document.querySelectorAll('.arco-modal-wrapper, .arco-drawer, .ks-dialog, [role="dialog"]')].some(visible);
      const host = hosts.filter(element => !failed.has(element) && visible(element)).sort((a,b) => b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
      if (!host || modal || document.hidden) { currentHost = null; await hide(); return; }
      const rect = host.getBoundingClientRect();
      const bounds = { x:Math.max(0,Math.round(rect.x)), y:Math.max(0,Math.round(rect.y)), width:Math.max(1,Math.round(rect.width)), height:Math.max(1,Math.round(rect.height)) };
      const nextProject = new URLSearchParams(location.search).get('id') || '';
      const key = JSON.stringify(bounds);
      if (pending) { if (key !== lastBounds) { lastBounds = key; await native.updateBounds(bounds).catch(() => {}); } return; }
      const mustShow = !shown || currentHost !== host || project !== nextProject || refreshRequested;
      currentHost = host;
      if (mustShow) {
        pending = true; shown = true; project = nextProject; lastBounds = key; refreshRequested = false;
        try {
          showPromise=native.show({ bounds, projectId: nextProject });
          const status = await showPromise;
          if (status?.error || status?.available === false) throw new Error(status.error || 'Native editor unavailable');
          updateLabel(status,host);
          // A tab or modal can hide the host while the original editor boots.
          // Always send a second hide after that pending show completes.
          if (!host.isConnected || currentHost !== host) { shown = false; await native.hide().catch(() => {}); }
        } catch (error) { await hide(); fallback(host); report('原版 KSCode 启动失败', '', '/__local/native-editor'); }
        finally { pending = false; schedule(); }
      } else if (key !== lastBounds) { lastBounds = key; await native.updateBounds(bounds).catch(() => {}); }
    }
    new MutationObserver(() => schedule()).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['style','class'] });
    addEventListener('resize', () => schedule()); addEventListener('scroll', () => schedule(), true);
    addEventListener('focus', () => schedule(true)); addEventListener('visibilitychange', () => schedule());
    addEventListener('pagehide', () => { void native.hide(); });
    window.__M0_LOCAL_NATIVE_EDITOR__ = Object.freeze({
      refresh: () => schedule(true),
      runAction:async method=>{
        if(!['openTerminal','showExtensions','installVSIX'].includes(method)||typeof native[method]!=='function')throw new Error('当前桌面未提供该编辑器功能。');
        schedule(true);await new Promise(resolve=>requestAnimationFrame(resolve));await showPromise;
        if(!shown||!currentHost||!visible(currentHost))throw new Error('请先打开代码编辑器。');
        const result=await native[method]();
        updateLabel(await native.getStatus());return result;
      },
    });
    schedule();
  }
  window.__M0_LOCAL_RUNTIME__ = Object.freeze({ version: 1, offline: true });
})();
