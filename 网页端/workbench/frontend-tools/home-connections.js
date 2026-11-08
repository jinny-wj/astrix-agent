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

export function installHomeFigmaConnection() {
  if(document.getElementById('astrix-figma-entry'))return;
  const button=document.createElement('button');
  button.id='astrix-figma-entry';button.type='button';
  button.setAttribute('aria-label','连接 Figma');
  button.title='通过 Figma OAuth 授权连接';
  button.innerHTML='<svg viewBox="0 0 18 27" aria-hidden="true"><path fill="#F24E1E" d="M4.5 0H9v9H4.5a4.5 4.5 0 0 1 0-9Z"/><path fill="#FF7262" d="M9 0h4.5a4.5 4.5 0 0 1 0 9H9Z"/><path fill="#A259FF" d="M4.5 9H9v9H4.5a4.5 4.5 0 0 1 0-9Z"/><circle fill="#1ABCFE" cx="13.5" cy="13.5" r="4.5"/><path fill="#0ACF83" d="M4.5 18H9v4.5A4.5 4.5 0 1 1 4.5 18Z"/></svg><span>连接 Figma</span>';
  button.onclick=()=>{
    // The desktop window handler intentionally returns null while opening the
    // system browser. Never replace that handoff with an in-window redirect.
    window.open(figmaOAuthStartPath(window.m0LocalDesktop?.isDesktop===true),'_blank');
  };
  document.body.appendChild(button);
  let queued=false;
  function refresh() {
    queued=false;
    button.hidden=!['/','/home','/home/'].includes(location.pathname);
    if(button.hidden)return;
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
  refresh();
}
