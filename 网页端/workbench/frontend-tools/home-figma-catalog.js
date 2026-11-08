import {createFigmaCatalog,figmaCatalogInput,figmaCatalogError,figmaCatalogDesignRoute,requestFigmaCatalogOpen,figmaCatalogReturnNeedsRefresh} from './figma-catalog-model.mjs';

export function installHomeFigmaCatalog({request=window.fetch.bind(window),navigate=url=>location.assign(url),now=()=>Date.now()}={}) {
  if(window.__astrixFigmaCatalogInstalled)return;
  window.__astrixFigmaCatalogInstalled=true;
  let host=null,controls=null,latest=null,queued=false,active=true,opening=null,dialog=null,returnFocus=null;
  const home=()=>['/','/home','/home/'].includes(location.pathname)&&document.visibilityState!=='hidden';
  const store=createFigmaCatalog({request,now,onChange:state=>{latest=state;if(opening&&(state.authenticated===false||state.accountId&&opening.accountId&&state.accountId!==opening.accountId)){opening.controller.abort();opening=null;}render();}});
  latest=store.snapshot();
  function feedback(text){if(controls)controls.notice.textContent=text;}
  async function openFile(file,button){
    if(opening)return;
    const operation={controller:new AbortController(),accountId:latest.accountId};opening=operation;
    button.disabled=true;feedback('正在打开“'+file.name+'”…');
    try{
      const response=await requestFigmaCatalogOpen(file.url,{request,open:window.open.bind(window),desktop:window.m0LocalDesktop?.isDesktop===true,signal:AbortSignal.any([operation.controller.signal,AbortSignal.timeout(25000)])});
      if(!response.ok){if(response.status===401)store.unauthorized();throw Error(figmaCatalogError(response.status));}
      const result=await response.json();
      if(!active||opening!==operation||operation.controller.signal.aborted)return;
      navigate(figmaCatalogDesignRoute(result.route,location.origin));
    }catch(error){if(!operation.controller.signal.aborted)feedback(error.message||'暂时无法打开设计稿，请重试。');}
    finally{if(opening===operation)opening=null;button.disabled=false;}
  }
  function card(file){
    const button=document.createElement('button');button.type='button';button.className='figma-file-card';button.setAttribute('aria-label','打开设计稿：'+file.name);
    const cover=document.createElement('span');cover.className='figma-file-cover';
    const fallback=()=>{cover.replaceChildren();const icon=document.createElement('span');icon.className='figma-file-no-preview';icon.innerHTML='<svg viewBox="0 0 32 40" aria-hidden="true"><path d="M7 2h12l8 8v27H7z"/><path d="M19 2v9h8M12 20h10M12 26h10"/></svg>';const label=document.createElement('span');label.textContent=file.name;icon.appendChild(label);cover.appendChild(icon);};
    if(file.thumbnailUrl){const image=document.createElement('img');image.src=file.thumbnailUrl;image.alt='';image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';image.onerror=fallback;cover.appendChild(image);}else fallback();
    const copy=document.createElement('span');copy.className='figma-file-copy';
    const name=document.createElement('strong');name.textContent=file.name;name.title=file.name;
    const meta=document.createElement('span');meta.className='figma-file-meta';
    const source={saved:'已添加',workspace:'工作区',team:'团队'}[file.source];
    meta.textContent=[source,file.lastModified?'更新于 '+new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric'}).format(new Date(file.lastModified)):null].filter(Boolean).join(' · ')||'Figma 设计稿';
    copy.append(name,meta);button.append(cover,copy);button.onclick=()=>void openFile(file,button);return button;
  }
  function render(){
    if(!controls||!host?.isConnected)return;
    const state=latest,busy=['loading','adding'].includes(state.phase),query=controls.search.value.trim().toLocaleLowerCase();
    host.setAttribute('aria-busy',String(busy));controls.refresh.disabled=busy;controls.team.disabled=busy;controls.team.hidden=!state.teamConfigured;controls.add.disabled=state.phase==='adding';
    controls.refresh.textContent=state.phase==='loading'?'刷新中…':'刷新';
    controls.count.textContent=state.files.length?'· '+state.files.length:'';
    controls.notice.textContent=state.message;
    controls.notice.dataset.kind=state.phase==='error'||state.phase==='unconfigured'?'error':'info';
    const files=state.files.filter(file=>file.name.toLocaleLowerCase().includes(query));
    controls.grid.replaceChildren(...files.map(card));
    controls.empty.hidden=files.length>0;
    controls.empty.textContent=busy&&!state.files.length?'正在读取设计稿…':state.phase==='unauthorized'?'连接 Figma 后，添加你有权限访问的设计稿。':state.phase==='unconfigured'?'请先通过顶部“连接 Figma”配置授权。':query?'没有找到匹配的设计稿。':state.phase==='error'?'列表暂不可用，可点击刷新重试。':'添加 Figma 链接，即可在这里打开真实设计稿。';
  }
  function ensureDialog(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.className='figma-catalog-dialog';dialog.setAttribute('aria-labelledby','figma-catalog-dialog-title');
    dialog.innerHTML='<form><header><div><h2 id="figma-catalog-dialog-title">添加设计稿或来源</h2><p>粘贴设计稿、团队、项目或文件夹的 Figma 链接。</p></div><button type="button" class="catalog-close" aria-label="关闭">×</button></header><label for="figma-catalog-url">Figma 链接</label><input id="figma-catalog-url" type="url" required autocomplete="off" placeholder="https://www.figma.com/design/…"><p class="catalog-dialog-note">只添加当前账号有权访问的真实文件；来源同步受 Figma 目录权限限制。</p><p class="catalog-dialog-feedback" role="status" aria-live="polite"></p><footer><button type="button" class="catalog-cancel">取消</button><button type="submit" class="catalog-primary">添加设计稿</button></footer></form>';
    document.body.appendChild(dialog);
    const input=dialog.querySelector('input'),form=dialog.querySelector('form'),submit=dialog.querySelector('[type=submit]'),note=dialog.querySelector('[role=status]');
    const close=()=>dialog.close();dialog.querySelector('.catalog-close').onclick=close;dialog.querySelector('.catalog-cancel').onclick=close;
    input.oninput=()=>{note.textContent='';try{submit.textContent=figmaCatalogInput(input.value).kind==='source'?'添加并同步来源':'添加设计稿';}catch{submit.textContent='添加设计稿';}};
    dialog.addEventListener('close',()=>{if(['adding','loading'].includes(latest.phase))store.cancel();input.value='';note.textContent='';input.disabled=false;submit.disabled=false;returnFocus?.focus();});
    form.onsubmit=async event=>{
      event.preventDefault();if(submit.disabled)return;
      note.textContent='正在验证链接与访问权限…';input.disabled=true;submit.disabled=true;
      try{const kind=await store.add(input.value);if(dialog.open){dialog.close();feedback(kind==='source'?'来源已添加；列表仅显示实际有权限读取的设计稿。':'设计稿已添加。');}}
      catch(error){if(dialog.open)note.textContent=error.name==='AbortError'?'连接状态已变化，请检查后重试。':error.status?figmaCatalogError(error.status):error.message;}
      finally{input.disabled=false;submit.disabled=false;}
    };
  }
  function mount(next){
    host=next;host.classList.add('astrix-figma-catalog');
    host.innerHTML='<div class="figma-catalog-head"><div class="figma-catalog-heading"><h2>Figma 设计稿 <span class="figma-catalog-count"></span></h2><p>当前账号可访问的已连接文件</p></div><div class="figma-catalog-actions"><input type="search" aria-label="搜索设计稿" placeholder="搜索设计稿"><button type="button" class="catalog-team" hidden>同步来源</button><button type="button" class="catalog-refresh">刷新</button><button type="button" class="catalog-add catalog-primary">添加设计稿</button></div></div><p class="figma-catalog-notice" role="status" aria-live="polite"></p><div class="figma-catalog-grid"></div><p class="figma-catalog-empty"></p>';
    controls={search:host.querySelector('input'),team:host.querySelector('.catalog-team'),refresh:host.querySelector('.catalog-refresh'),add:host.querySelector('.catalog-add'),count:host.querySelector('.figma-catalog-count'),notice:host.querySelector('.figma-catalog-notice'),grid:host.querySelector('.figma-catalog-grid'),empty:host.querySelector('.figma-catalog-empty')};
    controls.search.oninput=render;controls.refresh.onclick=()=>void store.refresh({force:true});controls.team.onclick=()=>void store.refresh({force:true,team:true});
    controls.add.onclick=()=>{ensureDialog();returnFocus=controls.add;dialog.showModal();dialog.querySelector('input').focus();};
    render();void store.refresh({force:true});
  }
  function reconcile(){queued=false;const next=document.querySelector('[data-astrix-figma-catalog]');if(next&&next!==host)mount(next);}
  function schedule(){if(!queued){queued=true;requestAnimationFrame(reconcile);}}
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
  const passive=()=>{if(active&&home()&&host?.isConnected)void store.refresh();};
  const returning=()=>{if(active&&home()&&host?.isConnected)void store.refresh({force:figmaCatalogReturnNeedsRefresh(latest)});};
  addEventListener('astrix-figma-session',event=>{store.setSession(event.detail,{refresh:active&&home()&&Boolean(host?.isConnected)});});
  addEventListener('focus',returning);document.addEventListener('visibilitychange',returning);addEventListener('popstate',schedule);
  const poll=setInterval(passive,60000);
  addEventListener('pagehide',()=>{active=false;store.cancel();opening?.controller.abort();opening=null;dialog?.close();});
  addEventListener('pageshow',()=>{active=true;schedule();returning();});
  reconcile();
  return {store,refresh:()=>store.refresh({force:true}),dispose(){active=false;clearInterval(poll);store.dispose();opening?.controller.abort();dialog?.remove();}};
}
