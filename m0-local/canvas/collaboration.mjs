import {CollaborationState} from './collaboration-state.mjs';
import {applyOperations} from './collab-model.mjs';
import {findNode,getActivePage} from './model.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
const uuid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
const stored=(key,value)=>{try{if(value!==undefined)localStorage.setItem(key,value);return localStorage.getItem(key);}catch{return null;}};
const svg=(tag,attrs)=>{const element=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[key,value]of Object.entries(attrs||{}))element.setAttribute(key,String(value));return element;};
const endpoint='/__local/collaboration/';

export function createCanvasCollaboration(options){
  const params=new URLSearchParams(location.search),invite=params.get('invite')||'';
  // A duplicated browser tab may inherit sessionStorage; participants still
  // need distinct identities even when their display names are the same.
  let clientId=uuid();
  let session=null,state=null,source=null,loaded=null,connected=false,joining=false,destroyed=false,sending=null,sendTimer,presenceTimer,presenceFlight=false,lastPresence=null,pendingPaint=false,resyncing=null,participants=[],gateway={enabled:false,urls:[]},invites=[],connectionError='',reconnectTimer,reconnectDelay=2000;
  const mount=options.mount,overlay=options.overlay;
  const container=node('span',undefined,'m0-realtime'),toggle=node('button','实时协作','m0-realtime-toggle'),avatars=node('span',undefined,'m0-realtime-avatars');
  toggle.type='button';toggle.id='collaboration-toggle';container.append(avatars,toggle);mount?.append(container);
  const style=node('style');style.textContent=`.m0-realtime{display:inline-flex;align-items:center;gap:6px}.m0-realtime-avatars{display:inline-flex}.m0-realtime-avatar{width:24px;height:24px;border-radius:50%;display:inline-grid;place-content:center;color:#fff;font-size:10px;border:2px solid white;margin-left:-5px}.m0-realtime-toggle{font-size:11px}.m0-realtime-toggle[data-state=online]{color:#0e916a;background:#e9faf3;border-color:#caecdf}.m0-realtime-toggle[data-state=conflict]{color:#b55c16;background:#fff5e7}.m0-collab-dialog{width:min(560px,95vw);max-height:90vh;overflow:auto;padding:22px;border:1px solid #ddd;border-radius:14px;box-shadow:0 20px 100px #0003;font:12px -apple-system,sans-serif;color:#303444}.m0-collab-dialog::backdrop{background:#1a223b55}.m0-collab-dialog h2{font-size:19px;margin:0}.m0-collab-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.m0-collab-dialog p{line-height:1.7;color:#73798a}.m0-collab-dialog label{display:block;margin:12px 0}.m0-collab-dialog input{width:100%;margin-top:6px;padding:9px;border:1px solid #ddd;border-radius:6px;font:inherit}.m0-collab-actions{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.m0-collab-dialog button{font:inherit;padding:7px 10px}.m0-collab-dialog .primary{color:white;background:#168dff;border-color:#168dff}.m0-collab-members{display:grid;gap:7px;margin:12px 0}.m0-collab-member{display:flex;align-items:center;gap:9px;padding:6px;border-radius:6px;background:#f6f7fa}.m0-collab-member .role{margin-left:auto;color:#9298a5;font-size:10px}.m0-collab-invite{padding:9px 0;border-top:1px solid #eee}.m0-collab-invite small{display:block;color:#888;margin:4px 0}.m0-collab-notice{padding:10px;border-radius:7px;background:#f2efff;color:#6c51a4;white-space:pre-wrap;line-height:1.6}.m0-collab-conflict{background:#fff3e6;color:#a55516}.m0-collab-dialog [hidden]{display:none!important}`;document.head.append(style);
  const dialog=node('dialog',undefined,'m0-collab-dialog');dialog.id='collaboration-dialog';
  const heading=node('div',undefined,'m0-collab-head'),title=node('h2','实时协作'),close=node('button','×');close.id='close-collaboration';close.onclick=()=>dialog.close();heading.append(title,close);
  const explanation=node('p','同一画布可在多个窗口同时编辑。开启局域网后，其他电脑可通过邀请链接加入。'),nameLabel=node('label','你的显示名称'),nameInput=node('input');nameInput.id='collaboration-name';nameInput.maxLength=60;nameInput.value=stored('m0-collaboration-name')||'本地用户';nameLabel.append(nameInput);
  const notice=node('div','尚未连接','m0-collab-notice');notice.id='collaboration-status';
  const actions=node('div',undefined,'m0-collab-actions'),start=node('button','开始实时协作','primary'),reconnect=node('button','重新连接'),newWindow=node('button','打开协作窗口'),leave=node('button','离开协作');
  start.id='collaboration-start';newWindow.id='collaboration-open-window';leave.id='collaboration-leave';reconnect.id='collaboration-reconnect';actions.append(start,newWindow,reconnect,leave);
  const conflictActions=node('div',undefined,'m0-collab-actions'),download=node('button','导出未同步设计'),reload=node('button','使用共享版本');download.id='collaboration-export-draft';reload.id='collaboration-reload';conflictActions.append(download,reload);
  const members=node('div',undefined,'m0-collab-members');members.id='collaboration-members';
  const administration=node('section'),shareActions=node('div',undefined,'m0-collab-actions'),editorInvite=node('button','生成编辑邀请'),viewerInvite=node('button','生成只读邀请'),lan=node('button','开启局域网'),lanStatus=node('p'),links=node('div');
  editorInvite.id='collaboration-invite-editor';viewerInvite.id='collaboration-invite-viewer';lan.id='collaboration-lan';shareActions.append(editorInvite,viewerInvite,lan);administration.append(shareActions,lanStatus,links);
  dialog.append(heading,explanation,nameLabel,notice,actions,conflictActions,members,administration);document.body.append(dialog);
  const errorMessage=error=>options.notify?.(error.message||String(error),true);
  const name=()=>nameInput.value.trim().slice(0,60)||'本地用户';
  const active=()=>Boolean(session);
  const readonly=()=>joining||Boolean(invite&&!session)||Boolean(session&&(session.role==='viewer'||!connected||state?.conflicts.length));
  async function request(route,{method='GET',body,signal}={}){
    const response=await fetch(endpoint+route,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:signal||AbortSignal.timeout(12000)});
    let value;try{value=await response.json();}catch{throw Error('协作服务未返回有效数据');}
    if(!response.ok)throw Object.assign(Error(value.error?.message||value.error||'协作请求失败'),value,{status:response.status});return value;
  }
  function status(){
    const hasConflict=Boolean(state?.conflicts.length),pending=state?.pending.length||0;
    toggle.dataset.state=hasConflict?'conflict':connected?'online':'offline';toggle.textContent=session?(hasConflict?'协作冲突':connected?'协作 · '+participants.length:'协作重连中'):'实时协作';
    avatars.replaceChildren();for(const member of participants.filter(member=>member.clientId!==clientId).slice(0,4)){const avatar=node('span',String(member.name||'?').slice(0,1),'m0-realtime-avatar');avatar.style.background=color(member.color);avatar.title=member.name||'协作者';avatars.append(avatar);}
    notice.classList.toggle('m0-collab-conflict',hasConflict);notice.textContent=connectionError|| (hasConflict?'同一属性或结构被其他成员修改。当前未同步设计仍保留在此窗口，可导出备份或使用共享版本。':session?(connected?(session.role==='viewer'?'已连接 · 只读查看':pending?'正在同步 '+pending+' 组修改':'已连接 · 所有修改已同步'):'连接中断，未同步修改保留在此窗口；恢复连接后继续同步。'):invite?'使用邀请加入共享画布。':'尚未连接。开始后可分享编辑或只读邀请。');
    start.hidden=Boolean(session);start.disabled=joining;leave.hidden=!session;reconnect.hidden=!session||connected;newWindow.hidden=!session;newWindow.disabled=!connected;conflictActions.hidden=!hasConflict&&!connectionError;reload.disabled=!connected;
    members.replaceChildren();for(const member of participants){const row=node('div',undefined,'m0-collab-member'),avatar=node('span',String(member.name||'?').slice(0,1),'m0-realtime-avatar'),label=node('span',(member.name||'协作者')+(member.clientId===clientId?'（你）':'')),role=node('span',member.role==='viewer'?'只读':member.role==='owner'?'主持人':'可编辑','role');avatar.style.background=color(member.color);row.append(avatar,label,role);members.append(row);}
    administration.hidden=!session||session.role!=='owner'||Boolean(invite);lan.textContent=gateway.enabled?'关闭局域网':'开启局域网';lanStatus.textContent=gateway.enabled?'局域网已开启：'+(gateway.urls||[]).join('、'):'当前仅此电脑可连接。';
    options.onStatus?.({active:active(),readOnly:readonly(),pending,canUndo:Boolean(session&&connected&&!hasConflict&&state?.undoStack.length),canRedo:Boolean(session&&connected&&!hasConflict&&state?.redoStack.length),connected,remote:Boolean(invite),conflict:hasConflict});
  }
  function color(value){return /^#[a-f0-9]{6}$/i.test(value||'')?value:'#8a68dc';}
  function applyView(sourceName='remote'){
    if(!state||destroyed)return;
    if(options.isInteracting?.()){pendingPaint=true;return;}
    const document=state.view(),oldPage=options.getDocument()?.activePageId;if(document.pages.some(page=>page.id===oldPage))document.activePageId=oldPage;
    options.applyRemote?.({document,revision:state.base.revision,dirty:Boolean(state.pending.length),source:sourceName});pendingPaint=false;paint();status();
  }
  async function resync(){
    if(!session)return;if(resyncing)return resyncing;
    resyncing=(async()=>{
      let snapshot;try{snapshot=await request('state?sessionToken='+encodeURIComponent(session.sessionToken));}
      catch(error){
        if(error.status!==403)throw error;
        // Long disconnections can outlive a server session. Rejoin under the
        // same invitation/scope, then rebase pending operations, never reset.
        snapshot=await request('join',{method:'POST',body:{...(invite?{invite}:{projectId:session.projectId,workspaceKey:session.workspaceKey}),clientId,name:name()}});
        session=snapshot;clientId=snapshot.clientId||clientId;
      }
      state.snapshot(snapshot);if(snapshot.participants)participants=snapshot.participants;if(snapshot.gateway)gateway=snapshot.gateway;connected=true;connectionError='';reconnectDelay=2000;applyView('resync');return snapshot;
    })().catch(error=>{connected=false;if(error.status===403)connectionError='协作邀请已失效，未同步设计仍保留，可导出备份。';status();throw error;}).finally(()=>resyncing=null);return resyncing;
  }
  function scheduleReconnect(){
    if(reconnectTimer||destroyed||!session)return;
    reconnectTimer=setTimeout(()=>{reconnectTimer=null;void resync().then(()=>{connectEvents();return flush();}).catch(error=>{if(error.status===403){source?.close();source=null;status();return;}reconnectDelay=Math.min(30000,reconnectDelay*2);scheduleReconnect();});},reconnectDelay);
  }
  function consume(type,value){
    if(!session)return;
    const payload=value.snapshot||value.current||value;
    if(type==='snapshot'){
      if(payload.document)state.snapshot(payload);if(payload.participants)participants=payload.participants;if(payload.gateway)gateway=payload.gateway;connected=true;connectionError='';applyView('snapshot');void flush().catch(error=>{if(error.status!==409)status();});
    }else if(type==='document'){
      const result=state.event({...payload,mutationId:payload.clientId===clientId?payload.mutationId:undefined});if(result.needsResync)void resync().catch(errorMessage);else applyView('document');
    }else if(['presence','participants','joined','left'].includes(type)){
      if(Array.isArray(payload))participants=payload;else if(payload.participants)participants=payload.participants;status();paint();
    }else if(type==='ready'){
      connected=true;connectionError='';status();if(payload.revision!==state.base.revision||payload.epoch!==undefined&&payload.epoch!==state.base.epoch)void resync().then(flush).catch(errorMessage);else {if(payload.acknowledgedMutationIds){state.acknowledge({...state.base,acknowledgedMutationIds:payload.acknowledgedMutationIds});applyView('ready');}void flush().catch(errorMessage);}
    }else if(type==='sync-error'){
      connected=false;connectionError=(payload.message||'共享画布暂不可用')+'。未同步设计已保留，请恢复画布文件后重新连接。';status();options.notify?.(connectionError,true);
    }else if(['revoked','access-revoked','closed','expired'].includes(type)){
      connected=false;source?.close();source=null;clearTimeout(reconnectTimer);reconnectTimer=null;connectionError='邀请或协作会话已失效。未同步修改仍保留在当前窗口，可导出备份。';status();options.notify?.('协作邀请或会话已失效，请向主持人获取新的邀请。',true);
    }
  }
  function connectEvents(){
    source?.close();clearTimeout(reconnectTimer);reconnectTimer=null;
    const url=new URL(session.eventsUrl||endpoint+'events',location.href);if(url.origin!==location.origin)throw Error('协作事件流地址无效');
    url.searchParams.set('sessionToken',session.sessionToken);url.searchParams.set('since',String(state.base.seq));source=new EventSource(url.href);
    source.onopen=()=>status();source.onerror=()=>{connected=false;status();scheduleReconnect();};
    for(const type of ['snapshot','document','presence','participants','joined','left','ready','sync-error','revoked','access-revoked','closed','expired'])source.addEventListener(type,event=>{try{consume(type,JSON.parse(event.data));}catch(error){errorMessage(error);}});
    source.onmessage=event=>{try{const data=JSON.parse(event.data);consume(data.type||'snapshot',data);}catch(error){errorMessage(error);}};
  }
  async function join(){
    if(joining)return;joining=true;stored('m0-collaboration-name',name());status();
    try{
      const scope=options.getScope?.()||{};
      if(!invite){await options.save?.();await request('rooms',{method:'POST',body:{...scope,name:name(),document:options.getDocument(),expectedRevision:loaded?.revision??null}});}
      const snapshot=await request('join',{method:'POST',body:{...(invite?{invite}:scope),name:name(),clientId}});
      session=snapshot;clientId=snapshot.clientId||clientId;state=new CollaborationState(snapshot);participants=snapshot.participants||[];gateway=snapshot.gateway||gateway;connected=true;connectionError='';connectEvents();status();
      if(!invite)applyView('join');return snapshot;
    }finally{joining=false;status();}
  }
  async function flush(){
    clearTimeout(sendTimer);if(!session||!state)return loaded||{};
    if(sending)return sending;
    if(!state.pending.length)return {document:state.view(),revision:state.base.revision,seq:state.base.seq};
    if(!connected)throw Error('协作连接已中断，未同步修改保留在此窗口');
    if(state.conflicts.length)throw Error('请先处理协作冲突，或导出未同步设计');
    if(session.role==='viewer')throw Error('当前邀请只允许查看画布');
    sending=(async()=>{
      while(state.pending.length){
        if(!connected||state.conflicts.length)throw Error('协作暂不可写，修改已保留');
        const action=state.pending[0],draft=options.getDocument();
        try{
          const snapshot=await request('ops',{method:'POST',body:{sessionToken:session.sessionToken,mutationId:action.mutationId,baseRevision:state.base.revision,ops:action.ops}});
          state.acknowledge(snapshot,action.mutationId);applyView('ack');
        }catch(error){
          if(error.status===409){state.reject(error,draft);applyView('conflict');}
          else {connected=false;status();}
          throw error;
        }
      }
      return {document:state.view(),revision:state.base.revision,seq:state.base.seq};
    })().finally(()=>{sending=null;status();});return sending;
  }
  function changed({before,after,reason='edit'}){
    if(!session||!state)return false;
    if(session.role==='viewer'||!connected||state.conflicts.length)return true;
    state.changed(before,after,reason);status();clearTimeout(sendTimer);sendTimer=setTimeout(()=>void flush().catch(errorMessage),180);return true;
  }
  async function history(direction){
    if(!session||readonly())return false;
    const from=direction==='undo'?state.undoStack:state.redoStack,to=direction==='undo'?state.redoStack:state.undoStack,action=from.at(-1);if(!action)return false;
    const ops=direction==='undo'?action.inverse:action.ops,result=applyOperations(state.view(),ops);
    if(result.conflicts.length)throw Error('其他成员已修改这些属性，无法撤销或重做；共享画布未被覆盖');
    // Settle history before awaiting the network. A new edit made while this
    // request is in flight must keep its own undo entry and clear redo normally.
    from.pop();to.push(action);state.queue(ops,direction);applyView(direction);await flush();status();return true;
  }
  function presence(value){
    if(!session||!connected)return;lastPresence={pageId:options.getDocument()?.activePageId,selectedIds:options.getSelection?.()||[],...value};
    if(presenceTimer||presenceFlight)return;
    presenceTimer=setTimeout(async()=>{presenceTimer=null;if(!lastPresence||!session||!connected)return;const data=lastPresence;lastPresence=null;presenceFlight=true;try{await request('presence',{method:'POST',body:{sessionToken:session.sessionToken,pageId:data.pageId,selection:data.selection||data.selectedIds||[],cursor:data.cursor||data.pointer||null}});}catch{}finally{presenceFlight=false;if(lastPresence)presence(lastPresence);}},90);
  }
  function paint(){
    if(!overlay)return;overlay.replaceChildren();if(!session)return;
    const document=options.getDocument(),page=getActivePage(document),viewport=options.getViewport?.()||{zoom:1,pan:{x:0,y:0}},zoom=viewport.zoom||1,pan=viewport.pan||{x:0,y:0};overlay.setAttribute('transform',`translate(${pan.x} ${pan.y}) scale(${zoom})`);overlay.style.pointerEvents='none';
    const transform=value=>`translate(${value.x} ${value.y}) translate(${value.width/2} ${value.height/2}) rotate(${value.rotation||0}) scale(${value.flipX?-1:1} ${value.flipY?-1:1}) translate(${-value.width/2} ${-value.height/2})`;
    for(const member of participants){
      if(member.clientId===clientId)continue;const position=member.presence||member;if(position.pageId!==page.id)continue;const fill=color(member.color);
      for(const id of position.selection||position.selectedIds||[]){const entry=findNode(document,id);if(!entry||entry.node.hidden)continue;let chain=[entry.node],parent=entry.parent;while(parent){chain.unshift(parent);parent=findNode(document,parent.id)?.parent;}const group=svg('g',{transform:chain.map(transform).join(' ')});group.append(svg('rect',{x:0,y:0,width:entry.node.width,height:entry.node.height,fill:'none',stroke:fill,'stroke-width':1.5/zoom,'stroke-dasharray':`${5/zoom} ${3/zoom}`}));overlay.append(group);}
      const pointer=position.cursor||position.pointer;if(!pointer||!Number.isFinite(pointer.x)||!Number.isFinite(pointer.y))continue;
      const cursor=svg('g',{transform:`translate(${pointer.x} ${pointer.y}) scale(${1/zoom})`});cursor.append(svg('path',{d:'M0 0 L4 18 L8 12 L16 11 Z',fill,stroke:'#fff','stroke-width':1}));
      const label=svg('text',{x:10,y:28,fill,'font-size':11,'font-family':'sans-serif','paint-order':'stroke',stroke:'#fff','stroke-width':3});label.textContent=member.name||'协作者';cursor.append(label);overlay.append(cursor);
    }
  }
  function renderInvites(){
    links.replaceChildren();for(const item of invites){const entry=node('div',undefined,'m0-collab-invite'),label=node('strong',item.role==='viewer'?'只读邀请':'编辑邀请'),small=node('small',item.expiresAt?'有效期至 '+new Date(item.expiresAt).toLocaleString():'邀请链接'),input=node('input');input.readOnly=true;input.value=item.shareURL;input.setAttribute('aria-label','协作邀请链接');const actions=node('div',undefined,'m0-collab-actions'),copyButton=node('button','复制链接'),revoke=node('button','撤销邀请');copyButton.onclick=()=>copyLink(input);revoke.onclick=()=>void request('invites/'+encodeURIComponent(item.inviteId||item.id),{method:'DELETE',body:{sessionToken:session.sessionToken}}).then(()=>{invites=invites.filter(value=>value!==item);renderInvites();}).catch(errorMessage);actions.append(copyButton,revoke);entry.append(label,small,input,actions);links.append(entry);}
  }
  async function copyLink(input){try{await navigator.clipboard.writeText(input.value);options.notify?.('邀请链接已复制');}catch{input.focus();input.select();options.notify?.('已选中邀请链接，可按 ⌘C / Ctrl+C 复制');}}
  async function createInvite(role){
    const item=await request('invites',{method:'POST',body:{sessionToken:session.sessionToken,role}}),token=item.invite||item.token;
    const localURL=new URL('/local-canvas/index.html',location.href);localURL.searchParams.set('invite',token);
    const remoteURL=item.gatewayUrls?.[0]||(gateway.enabled&&gateway.urls?.[0]?new URL('/local-canvas/index.html?invite='+encodeURIComponent(token),gateway.urls[0]).href:null);
    item.localURL=localURL.href;item.shareURL=remoteURL||new URL(item.url||localURL.href,location.href).href;invites.unshift(item);renderInvites();return item;
  }
  function downloadDraft(){const url=URL.createObjectURL(new Blob([JSON.stringify(options.getDocument(),null,2)],{type:'application/json'})),anchor=node('a');anchor.href=url;anchor.download='m0-unsynced-design.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  toggle.onclick=()=>{status();if(!dialog.open)dialog.showModal();};start.onclick=()=>void join().then(()=>{applyView('join');}).catch(errorMessage);
  reconnect.onclick=()=>void resync().then(()=>{connectEvents();return flush();}).catch(errorMessage);
  download.onclick=downloadDraft;reload.onclick=()=>void request('state?sessionToken='+encodeURIComponent(session.sessionToken)).then(snapshot=>{state.reset(snapshot);connected=true;applyView('reset');}).catch(errorMessage);
  editorInvite.onclick=()=>void createInvite('editor').catch(errorMessage);viewerInvite.onclick=()=>void createInvite('viewer').catch(errorMessage);
  newWindow.onclick=async()=>{try{let url;if(session.role==='owner'&&!invite)url=(await createInvite('editor')).localURL;else {url=new URL(location.href);url.searchParams.set('invite',invite);url=url.href;}const token=new URL(url).searchParams.get('invite');let desktop=window.m0LocalDesktop;try{desktop||=parent.m0LocalDesktop;}catch{}if(desktop?.openCanvasWindow)await desktop.openCanvasWindow({invite:token});else window.open(url,'_blank','noopener');}catch(error){errorMessage(error);}};
  lan.onclick=()=>void request('gateway',{method:'POST',body:{sessionToken:session.sessionToken,enabled:!gateway.enabled}}).then(value=>{gateway=value.gateway||value;status();}).catch(errorMessage);
  leave.onclick=()=>void (async()=>{await flush();try{await request('leave',{method:'POST',body:{sessionToken:session.sessionToken}});}catch(error){if(![403,404].includes(error.status))throw error;}loaded={document:state.view(),revision:state.base.revision,scope:options.getScope?.()};source?.close();source=null;clearTimeout(reconnectTimer);reconnectTimer=null;session=null;state=null;participants=[];connected=false;connectionError='';overlay?.replaceChildren();status();})().catch(errorMessage);
  function loadedDocument(value){loaded=value;if(!session)status();}
  const idle=setInterval(()=>{if(pendingPaint&&!options.isInteracting?.())applyView('deferred');},160);
  const heartbeat=setInterval(()=>{if(session&&connected)presence({});},12000);
  const onPageHide=()=>{if(session)void fetch(endpoint+'leave',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionToken:session.sessionToken}),keepalive:true}).catch(()=>{});};
  addEventListener('pagehide',onPageHide);
  queueMicrotask(status);
  return {bootstrap:async()=>invite?join():null,isActive:active,isReadOnly:readonly,changed,presence,loaded:loadedDocument,flush,undo:()=>history('undo'),redo:()=>history('redo'),paint,interactionEnded:()=>{if(pendingPaint)applyView('deferred');},destroy(){destroyed=true;onPageHide();source?.close();clearInterval(idle);clearInterval(heartbeat);clearTimeout(sendTimer);clearTimeout(presenceTimer);clearTimeout(reconnectTimer);removeEventListener('pagehide',onPageHide);container.remove();dialog.remove();style.remove();},getStatus:()=>({active:active(),connected,role:session?.role,roomId:session?.roomId,clientId,pending:state?.pending.length||0,conflicts:copy(state?.conflicts||[]),participants:copy(participants)})};
}
