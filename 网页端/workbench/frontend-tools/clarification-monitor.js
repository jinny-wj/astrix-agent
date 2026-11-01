/* A local clarification card for both Workbench hosts. Observe SSE without
 * changing the recovered chat bytes; the server owns tasks and their context. */
(() => {
  'use strict';
  if (!window.ReadableStream || window.__ASTRIX_CLARIFICATION_MONITOR__) return;
  window.__ASTRIX_CLARIFICATION_MONITOR__ = true;
  const sourceFetch = window.fetch.bind(window);
  const storagePrefix = 'astrix-clarification-session:';
  let panel, heading, content, statusLine, toggle, current = null, context = null;
  let generation = 0, restoring = 0, busy = false, route = '', nextNewTask = false;
  const drafts = new Map();
  const project = () => {
    const query = new URL(location.href).searchParams;
    return query.get('id') || query.get('projectId') || '';
  };
  const scope = () => project() || 'unbound:' + new URL(location.href).pathname;
  const sameProject = value => !value?.projectId || String(value.projectId) === project();
  const session = value => typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : '';
  const requestId = () => window.crypto?.randomUUID?.() || 'answer-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  function remember(snapshot) {
    if (!snapshot?.sessionId || !sameProject(snapshot)) return;
    try { localStorage.setItem(storagePrefix + scope(), JSON.stringify({sessionId:snapshot.sessionId,projectId:snapshot.projectId})); } catch {}
  }
  function create() {
    if (panel) return;
    const style = document.createElement('style');
    style.textContent = '.astrix-clarification{position:fixed;right:24px;bottom:64px;width:min(370px,calc(100vw - 48px));max-height:calc(100vh - 90px);overflow:auto;z-index:2147483601;color:#343344;background:#fff;border:1px solid #ded9f0;border-radius:12px;box-shadow:0 8px 35px #30254a24;font:13px -apple-system,BlinkMacSystemFont,sans-serif}.astrix-clarification header{display:flex;gap:8px;align-items:center;padding:13px 15px}.astrix-clarification header strong{flex:1}.astrix-clarification button{font:inherit;cursor:pointer;border-radius:7px;padding:7px 10px;border:1px solid #ded9ef;background:#fff;color:#6651a0}.astrix-clarification button:disabled{opacity:.5;cursor:wait}.astrix-clarification header button{border:0;padding:2px;background:none}.astrix-clarification main{padding:0 15px 15px}.astrix-clarification p{line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.astrix-clarification .astrix-question{display:block;margin-top:13px}.astrix-clarification textarea{box-sizing:border-box;display:block;width:100%;min-height:65px;resize:vertical;border:1px solid #dcd8e9;border-radius:7px;padding:8px;margin-top:6px;color:inherit;background:#fff;font:inherit}.astrix-clarification .astrix-options{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}.astrix-clarification .astrix-options button{font-size:12px;padding:4px 7px}.astrix-clarification .astrix-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.astrix-clarification .astrix-primary{background:#7962c7;color:#fff;border-color:#7962c7}.astrix-clarification .astrix-status{margin:0;color:#787287;font-size:12px}.astrix-clarification .astrix-error{color:#ac3434}.astrix-clarification summary{cursor:pointer;color:#786697;margin-top:13px}.astrix-clarification .astrix-records{max-height:170px;overflow:auto;font-size:12px}.astrix-clarification .astrix-records p{padding-top:8px;border-top:1px solid #eeeaf5}';
    document.head.append(style);
    panel = document.createElement('section'); panel.className = 'astrix-clarification';
    panel.setAttribute('role','region'); panel.setAttribute('aria-label','需求澄清与任务续接');
    const header = document.createElement('header'); heading = document.createElement('strong');
    toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = '收起';
    toggle.onclick = () => { content.hidden = !content.hidden; toggle.textContent = content.hidden ? '展开' : '收起'; };
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '隐藏';
    close.onclick = () => { panel.hidden = true; };
    content = document.createElement('main'); statusLine = document.createElement('p'); statusLine.className = 'astrix-status';
    header.append(heading,toggle,close); panel.append(header,content); document.body.append(panel);
  }
  function message(text, className) {
    const item = document.createElement('p'); item.textContent = String(text || ''); if(className)item.className = className; return item;
  }
  function render() {
    if (!current || !sameProject(current)) { if(panel)panel.hidden = true; return; }
    if (!current.pending && !current.display) { if(panel)panel.hidden = true; return; }
    create(); panel.hidden = false;
    const labels = {awaiting_user:'等待你补充需求',running:'继续原任务…',ready:'需求已补齐 · 等待配置模型',completed:'原任务本轮已结束',cancelled:'当前任务已取消',interrupted:'连接已中断 · 原任务已保留',error:'任务未完成'};
    heading.textContent = labels[current.status] || '需求澄清';
    content.replaceChildren();
    if (current.originalRequest) content.append(message('原任务：' + current.originalRequest));
    statusLine.textContent = current.status === 'ready' ? '需求已保存，尚未调用模型或执行任务。' : current.status === 'awaiting_user' ? '原任务与附件已保留，补充后将继续同一个任务。' : current.status === 'running' ? '正在处理补充信息，请勿重复提交。' : '';
    statusLine.className = 'astrix-status'; content.append(statusLine);
    const pending = current.pending;
    if (pending && current.status === 'awaiting_user') {
      const fields = new Map();
      for (const question of pending.questions || []) {
        const label = document.createElement('label'); label.className = 'astrix-question';
        label.append(message(question.prompt || question.label || question.id));
        const field = document.createElement('textarea'); field.setAttribute('aria-label',question.prompt || question.id); field.required = question.required !== false;
        const key = current.sessionId + ':' + pending.id + ':' + question.id;
        field.value = drafts.get(key) || ''; field.oninput = () => drafts.set(key,field.value);
        label.append(field); fields.set(question.id,field);
        if (Array.isArray(question.options) && question.options.length) {
          const options = document.createElement('div'); options.className = 'astrix-options';
          for (const option of question.options) { const button = document.createElement('button'); button.type = 'button'; button.textContent = typeof option === 'string' ? option : option.label || option.value || ''; button.onclick = () => { field.value = button.textContent; drafts.set(key,field.value); }; options.append(button); }
          label.append(options);
        }
        content.append(label);
      }
      const actions = document.createElement('div'); actions.className = 'astrix-actions';
      const submit = document.createElement('button'); submit.type = 'button'; submit.className = 'astrix-primary'; submit.textContent = '补充并继续'; submit.disabled = busy;
      submit.onclick = () => {
        const answers = {};
        for (const question of pending.questions || []) { const field = fields.get(question.id); const value = field.value.trim(); if(question.required !== false && !value){statusLine.textContent = '请补充所有必填问题。';statusLine.className = 'astrix-status astrix-error';field.focus?.();return;} if(value)answers[question.id] = value; }
        void answer(current,pending,answers);
      };
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消当前任务'; cancel.disabled = busy; cancel.onclick = () => void cancelTask(current);
      const fresh = document.createElement('button'); fresh.type = 'button'; fresh.textContent = '开始新任务'; fresh.disabled = busy; fresh.onclick = async () => { const previous = current; await cancelTask(previous); if(current?.sessionId === previous.sessionId && current.status === 'cancelled'){nextNewTask = true;current.output = '请在原聊天框输入新需求，将作为新任务处理。';render();} };
      actions.append(submit,cancel,fresh); content.append(actions);
    }
    if (current.output) content.append(message(current.output));
    if (current.error) content.append(message(current.error,'astrix-error'));
    if (Array.isArray(current.messages) && current.messages.length) {
      const details = document.createElement('details'), summary = document.createElement('summary'), records = document.createElement('div'); summary.textContent = '查看当前会话记录'; records.className = 'astrix-records';
      for (const item of current.messages.slice(-30)) records.append(message((item.role === 'user' ? '你：' : 'Astrix：') + String(item.content || '')));
      details.append(summary,records); content.append(details);
    }
  }
  function accept(snapshot, requestContext) {
    if (!snapshot || !sameProject(snapshot) || requestContext && requestContext !== context) return;
    const id = session(snapshot.sessionId); if(!id)return;
    const retained = current?.sessionId === id ? current : {};
    current = {...retained,...snapshot,sessionId:id,display:retained.display || Boolean(snapshot.pending) || ['ready','interrupted','error'].includes(snapshot.status) || Boolean(requestContext?.direct)};
    remember(current); render();
  }
  function receive(event, requestContext) {
    if (requestContext !== context || !sameProject(requestContext)) return;
    if (event.type === 'RUN_FINISHED') { requestContext.finished = true; return; }
    if (event.type === 'RUN_STARTED') { requestContext.sessionId = event.threadId || requestContext.sessionId; return; }
    if (event.type === 'CUSTOM' && event.name === 'local-clarification') {
      const pending = event.value; accept({...pending,sessionId:pending.sessionId || requestContext.sessionId,projectId:requestContext.projectId,status:'awaiting_user',pending,display:true},requestContext); return;
    }
    if (event.type === 'CUSTOM' && event.name === 'local-conversation') { accept({...event.value,projectId:event.value?.projectId ?? requestContext.projectId},requestContext); return; }
    if (event.type === 'TEXT_MESSAGE_CONTENT' && current?.sessionId === requestContext.sessionId && requestContext.direct) { current.output = (current.output || '') + String(event.delta || ''); current.display = true; render(); }
    if (event.type === 'RUN_ERROR' && current?.sessionId === requestContext.sessionId) { current.error = String(event.message || '请求未完成，请重试。'); if(current.status === 'running')current.status = 'error'; render(); }
  }
  function observe(response, requestContext) {
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response;
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', cancelled = false;
    const release = () => { try { reader.releaseLock(); } catch {} };
    const consume = chunk => { try { buffer += decoder.decode(chunk,{stream:true}); let index; while((index = buffer.indexOf('\n')) >= 0){const line = buffer.slice(0,index).replace(/\r$/,'');buffer = buffer.slice(index+1);if(line.startsWith('data:'))try{receive(JSON.parse(line.slice(5).trim()),requestContext);}catch{}} if(buffer.length > 1024*1024)buffer = ''; }catch{} };
    const stream = new ReadableStream({async pull(controller){try{const result = await reader.read();if(cancelled)return;if(result.done){if(requestContext.direct && !requestContext.finished && requestContext === context && current?.status === 'running'){current.error = '连接已结束，任务状态尚未确认，请刷新恢复。';current.status = 'error';render();}controller.close();release();return;}consume(result.value);controller.enqueue(result.value);}catch(error){if(cancelled)return;controller.error(error);release();}},async cancel(reason){cancelled = true;try{await reader.cancel(reason);}finally{release();}}});
    const wrapped = new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
    for(const key of ['url','redirected','type'])Object.defineProperty(wrapped,key,{value:response[key]});
    return wrapped;
  }
  async function answer(snapshot,pending,answers) {
    if (busy || snapshot !== current || !sameProject(snapshot)) return;
    busy = true;
    const id = requestId(), requestContext = {sessionId:snapshot.sessionId,projectId:snapshot.projectId,direct:true,generation:++generation}; context = requestContext;
    current = {...current,status:'running',output:'',error:'',display:true}; render();
    try {
      const text = (pending.questions || []).map(q => q.prompt + '：' + (answers[q.id] || '')).join('\n');
      const response = await sourceFetch('/__local/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:snapshot.sessionId,projectId:snapshot.projectId,requestId:id,message:text,clarificationAnswer:{id:pending.id,answers}})});
      if (!response.ok) {const result = await response.json().catch(() => ({}));throw Error(result.error?.message || result.error || '提交补充信息失败');}
      const reader = observe(response,requestContext).body.getReader(); while(!(await reader.read()).done){}
      if(context === requestContext)await restore(snapshot.sessionId,requestContext.projectId);
    } catch(error) { if(context === requestContext && sameProject(snapshot)){current = {...current,status:'awaiting_user',pending,error:error.message};render();} }
    finally {busy = false;if(context === requestContext)render();}
  }
  async function cancelTask(snapshot) {
    if(busy || snapshot !== current)return;busy = true;render();const token = ++generation;context = null;
    try {const response = await sourceFetch('/__local/conversations/' + encodeURIComponent(snapshot.sessionId) + '/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:snapshot.projectId})});const result = await response.json();if(!response.ok)throw Error(result.error?.message || result.error || '取消任务失败');if(token === generation && sameProject(snapshot))accept({...result,display:true,pending:null});}
    catch(error){if(token === generation && current){current.error = error.message;render();}}
    finally{busy = false;if(token === generation)render();}
  }
  async function restore(id, projectId = project()) {
    if (!session(id)) return;
    const token = ++restoring, observedGeneration = generation, observedScope = scope();
    try {const query = projectId ? '?projectId=' + encodeURIComponent(projectId) : '';const response = await sourceFetch('/__local/conversations/' + encodeURIComponent(id) + query);if(!response.ok)return;const snapshot = await response.json();if(token !== restoring || observedGeneration !== generation || observedScope !== scope())return;accept(snapshot);}
    catch{/* A failed optional restore cannot interfere with the existing chat. */}
  }
  function routeChanged() {
    const query = new URL(location.href).searchParams;const storageScope = scope(), next = storageScope + '|' + (query.get('sessionId') || query.get('threadId') || '');if(next === route)return;route = next;generation++;context = null;current = null;busy = false;nextNewTask = false;if(panel)panel.hidden = true;
    let id = session(query.get('sessionId') || query.get('threadId'));
    if(!id)try{const saved = JSON.parse(localStorage.getItem(storagePrefix + storageScope) || 'null');if(saved && (!saved.projectId || String(saved.projectId) === project()))id = session(saved.sessionId);}catch{}
    if(id)void restore(id);
  }
  const monitored = async(input,init) => {
    let requestContext;
    try {
      const url = new URL(input instanceof Request ? input.url : String(input),location.href);
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if(method === 'POST' && /(?:\/agent\/chat|\/__local\/chat|\/__local\/workflow\/run)$/.test(url.pathname)){
        routeChanged();const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : null);let body = {};
        if(typeof raw === 'string')try{body = JSON.parse(raw);}catch{}
        requestContext = {sessionId:session(body.sessionId || body.threadId),projectId:body.projectId ?? project(),direct:false,generation:++generation};context = requestContext;
        if(nextNewTask && typeof raw === 'string'){init = {...init,body:JSON.stringify({...body,newTask:true})};nextNewTask = false;}
        if(current?.sessionId === requestContext.sessionId){current.output = '';current.error = '';}
      }
    } catch{}
    const response = await sourceFetch(input,init);return requestContext ? observe(response,requestContext) : response;
  };
  window.fetch = monitored;window.nativeFetch = monitored;
  window.astrixClarification = Object.freeze({restore:()=>{const id = current?.sessionId;if(id)return restore(id,current.projectId);},getState:()=>current ? structuredClone(current) : null});
  addEventListener('popstate',routeChanged);addEventListener('hashchange',routeChanged);
  for(const method of ['pushState','replaceState']){const original = history[method];history[method] = function(...args){const result = original.apply(this,args);routeChanged();return result;};}
  if(document.readyState === 'loading')addEventListener('DOMContentLoaded',routeChanged,{once:true});else routeChanged();
})();
