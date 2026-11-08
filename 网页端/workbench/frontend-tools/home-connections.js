// The Figma account connection is independent from the model connection.
// Keep the existing OAuth route and native browser handoff contract intact.
export function figmaOAuthStartPath(desktop=false) {
  return '/api/auth/figma/start?'+new URLSearchParams({
    returnTo:'/figma-oauth-complete.html',
    ...(desktop?{handoff:'1'}:{direct:'1'}),
  });
}

export function homeConnectionPositions({viewport,mode,figmaWidth,modelWidth,height=36}) {
  const gap=8,margin=16;
  const width=figmaWidth+gap+modelWidth;
  if(mode&&mode.width>0) {
    const right=viewport-mode.left+12;
    if(mode.left-12-width>=96&&mode.right<=viewport-margin)return {figmaRight:right,modelRight:right+figmaWidth+gap,top:mode.top+(mode.height-height)/2};
    const wrapRight=Math.max(margin,viewport-mode.right);
    return {figmaRight:wrapRight,modelRight:wrapRight+figmaWidth+gap,top:mode.bottom+10};
  }
  return {figmaRight:208,modelRight:208+figmaWidth+gap,top:28};
}

export function installHomeFigmaConnection({request=window.fetch.bind(window)}={}) {
  if(document.getElementById('astrix-figma-entry'))return;
  const button=document.createElement('button');
  button.id='astrix-figma-entry';button.type='button';
  button.setAttribute('aria-label','连接 Figma');
  button.title='通过 Figma OAuth 授权连接';
  button.innerHTML='<svg viewBox="0 0 18 27" aria-hidden="true"><path fill="#F24E1E" d="M4.5 0H9v9H4.5a4.5 4.5 0 0 1 0-9Z"/><path fill="#FF7262" d="M9 0h4.5a4.5 4.5 0 0 1 0 9H9Z"/><path fill="#A259FF" d="M4.5 9H9v9H4.5a4.5 4.5 0 0 1 0-9Z"/><circle fill="#1ABCFE" cx="13.5" cy="13.5" r="4.5"/><path fill="#0ACF83" d="M4.5 18H9v4.5A4.5 4.5 0 1 1 4.5 18Z"/></svg><span>连接 Figma</span>';
  const account=document.createElement('span');account.id='astrix-figma-account-status';account.className='figma-account-status';
  account.setAttribute('role','status');account.setAttribute('aria-live','polite');account.textContent='正在检测';
  button.setAttribute('aria-describedby',account.id);button.appendChild(account);
  let session=null,failed=false,pendingUntil=0,requestController=null,flight=null,active=true,poll=null;
  function renderAccount() {
    const name=typeof session?.user?.name==='string'?session.user.name.trim().slice(0,32):'';
    const waiting=Date.now()<pendingUntil;
    const state=failed?'error':session?.authenticated===true?'connected':session?.configured===false?'unconfigured':waiting?'waiting':'disconnected';
    const labels={error:'状态不可用',connected:'已连接'+(name?' · '+name:''),unconfigured:'待配置',waiting:'等待授权',disconnected:'未连接'};
    account.dataset.state=state;account.textContent=labels[state];
    button.title=state==='connected'?'Figma 账号已连接'+(name?'：'+name:'')+'。点击可重新授权；设计稿与 Bridge 需要分别连接。'
      :state==='error'?'暂时无法确认 Figma 账号状态，请确认本地服务正常后重试。'
      :state==='unconfigured'?'当前应用尚未配置 Figma OAuth，请点击查看连接说明。'
      :waiting?'请在浏览器完成 Figma 授权，返回后会自动更新状态。':'尚未连接 Figma 账号，点击后进入原 OAuth 授权流程。';
    schedule();
  }
  function refreshAccount() {
    if(!active||button.hidden||document.visibilityState==='hidden')return Promise.resolve();
    if(flight)return flight;
    const controller=new AbortController();requestController=controller;
    flight=Promise.resolve().then(async()=>{
      try{
        if(!active||controller.signal.aborted)return;
        const response=await request('/api/auth/figma/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
        if(!response.ok)throw Error('Session unavailable');
        const value=await response.json();
        if(!value||typeof value.authenticated!=='boolean'||typeof value.configured!=='boolean')throw Error('Invalid session');
        if(!active||controller.signal.aborted)return;
        session={configured:value.configured,authenticated:value.authenticated,user:typeof value.user?.name==='string'?{name:value.user.name}:null};
        if(session.authenticated)pendingUntil=0;
        failed=false;renderAccount();
        if(typeof window.dispatchEvent==='function'&&typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('astrix-figma-session',{detail:{configured:value.configured,authenticated:value.authenticated,accountId:['string','number'].includes(typeof value.user?.id)?String(value.user.id):null}}));
      }catch{
        if(active&&!controller.signal.aborted){failed=true;renderAccount();}
      }finally{if(requestController===controller){requestController=null;flight=null;}}
    });
    return flight;
  }
  button.onclick=()=>{
    // The desktop window handler intentionally returns null while opening the
    // system browser. Never replace that handoff with an in-window redirect.
    pendingUntil=Date.now()+120000;failed=false;renderAccount();
    window.open(figmaOAuthStartPath(window.m0LocalDesktop?.isDesktop===true),'_blank');
    void refreshAccount();
  };
  document.body.appendChild(button);
  let queued=false,wasHome=false;
  function refresh() {
    queued=false;
    const home=['/','/home','/home/'].includes(location.pathname),entered=home&&!wasHome;wasHome=home;
    button.hidden=!home;
    if(button.hidden)return;
    if(entered)void refreshAccount();
    const model=document.getElementById('astrix-api-entry');
    const mode=document.querySelector('.spark-start-mode');
    const rect=mode?.getBoundingClientRect();
    const bounds=button.getBoundingClientRect();
    const positions=homeConnectionPositions({viewport:innerWidth,mode:rect,figmaWidth:bounds.width,modelWidth:model?.getBoundingClientRect().width||98,height:bounds.height});
    button.style.right=positions.figmaRight+'px';button.style.top=positions.top+'px';
    if(model){model.style.right=positions.modelRight+'px';model.style.top=positions.top+'px';}
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(refresh);}}
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
  new ResizeObserver(schedule).observe(document.documentElement);
  addEventListener('resize',schedule);addEventListener('scroll',schedule,{passive:true});addEventListener('popstate',schedule);
  addEventListener('focus',()=>void refreshAccount());
  document.addEventListener('visibilitychange',()=>void refreshAccount());
  const startPolling=()=>{if(!poll)poll=setInterval(()=>void refreshAccount(),5000);};
  addEventListener('pagehide',()=>{active=false;clearInterval(poll);poll=null;requestController?.abort();requestController=null;flight=null;});
  addEventListener('pageshow',()=>{active=true;startPolling();void refreshAccount();});
  startPolling();
  refresh();
}
