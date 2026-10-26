import {publicApiConfig,credentialState,apiSubmission} from './api-settings-model.mjs';

export function installApiSettings({request=window.fetch.bind(window)}={}) {
  if(document.getElementById('astrix-api-entry'))return window.__ASTRIX_API_SETTINGS__;
  const entry=document.createElement('button');entry.type='button';entry.id='astrix-api-entry';entry.setAttribute('aria-haspopup','dialog');entry.setAttribute('aria-controls','astrix-api-dialog');
  entry.innerHTML='<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7.5 3.4h5l.5 2 1.8 1.1 2-.6 2.4 4.2-1.5 1.4v2.1l1.5 1.4-2.4 4.2-2-.6-1.8 1.1-.5 2h-5l-.5-2-1.8-1.1-2 .6L.8 15l1.5-1.4v-2.1L.8 10.1l2.4-4.2 2 .6L7 5.4l.5-2Z" transform="translate(1 0) scale(.8)" stroke="currentColor" stroke-width="1.4"/><circle cx="9" cy="10" r="2.4" stroke="currentColor" stroke-width="1.4"/></svg><span>API 设置</span>';
  const dialog=document.createElement('dialog');dialog.id='astrix-api-dialog';dialog.className='astrix-api-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-labelledby','astrix-api-title');dialog.setAttribute('aria-describedby','astrix-api-description');
  dialog.innerHTML=`<div class="api-header"><span class="api-emblem" aria-hidden="true">✦</span><div><h2 id="astrix-api-title">API 设置</h2><p class="api-subtitle">连接你的模型服务</p></div><button type="button" class="api-close" id="astrix-api-close" aria-label="关闭 API 设置">×</button></div>
  <p class="api-loading" id="astrix-api-loading" role="status">正在读取配置…</p>
  <form id="astrix-api-form" novalidate autocomplete="off" hidden>
    <p class="api-intro" id="astrix-api-description">OpenAI 兼容接口，支持官方、第三方与本机服务。<br>可自由填写地址和模型名，具体能力由服务提供。</p>
    <label class="api-switch-row"><span class="api-switch-copy">用于后续对话<small>保存后生效；关闭时使用界面演示</small></span><input id="astrix-api-enabled" type="checkbox" role="switch" aria-label="保存后使用 API 对话"></label>
    <label class="api-field" for="astrix-api-base-url">API 地址<input id="astrix-api-base-url" type="url" inputmode="url" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="填写服务的兼容接口地址" aria-describedby="astrix-api-url-help"><span class="api-help" id="astrix-api-url-help">可填接口根路径或完整 chat/completions 地址。API Key 请填写下方独立字段。</span></label>
    <label class="api-field" for="astrix-api-model">模型名称<input id="astrix-api-model" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="填写该服务中的模型名称"></label>
    <label class="api-field" for="astrix-api-key">API Key<input id="astrix-api-key" type="password" spellcheck="false" autocapitalize="off" autocomplete="new-password" placeholder="无需密钥的服务可留空" aria-describedby="astrix-api-key-note"></label>
    <p id="astrix-api-key-note" role="status"></p>
    <label class="api-clear-row" id="astrix-api-clear-row" hidden><input id="astrix-api-clear-key" type="checkbox">保存时清除已保存的密钥</label>
    <p class="api-feedback" id="astrix-api-feedback" role="status" aria-live="polite" hidden></p>
    <div class="api-actions"><button type="button" id="astrix-api-reload" hidden>重新读取</button><button type="button" id="astrix-api-cancel">取消</button><button type="button" id="astrix-api-test">测试连接</button><button type="submit" id="astrix-api-save" class="api-save">保存配置</button></div>
    <p class="api-footnote">测试使用当前填写的配置，不保存，也不启用对话。密钥不会回显或写入浏览器存储。</p>
  </form>`;
  document.body.append(entry,dialog);
  const $=id=>dialog.querySelector('#astrix-api-'+id),form=$('form');
  let saved=null,busy=false,opener=null,controller=null,version=0,lastPath='';
  const fields=['enabled','base-url','model','key','clear-key'];
  const draft=()=>({enabled:$('enabled').checked,baseUrl:$('base-url').value,model:$('model').value,apiKey:$('key').value,clearKey:$('clear-key').checked});
  function feedback(message,kind='info'){const target=$('feedback');target.textContent=message;target.dataset.kind=kind;target.hidden=!message;}
  function setBusy(value,operation=''){busy=value;form.setAttribute('aria-busy',String(value));for(const id of [...fields,'test','save'])$(id).disabled=value||!saved;$('test').textContent=value&&operation==='test'?'正在测试…':'测试连接';$('save').textContent=value&&operation==='save'?'正在保存…':'保存配置';}
  function renderCredential(){
    if(!saved)return;const value=credentialState(saved,draft()),note=$('key-note');note.dataset.state=value;
    const messages={keep:'已保存密钥；留空会保留同一来源的密钥。',replace:'保存后使用新填写的密钥。',clear:'保存后清除已保存的密钥；当前填写内容仍可先测试。','new-origin':'地址来源已改变，原密钥不会沿用。请填写新来源的密钥；无需密钥的服务可留空。',empty:'未保存密钥。无需密钥的本机服务可留空。'};
    note.textContent=messages[value];$('key').placeholder=saved.hasKey&&value==='keep'?'已保存，留空保留':'无需密钥的服务可留空';$('clear-row').hidden=!saved.hasKey;
  }
  async function jsonRequest(url,options={}){
    const response=await request(url,{...options,credentials:'same-origin',signal:controller?.signal,headers:{'content-type':'application/json',...options.headers}});
    let body;try{body=await response.json();}catch{throw Error('服务未返回有效结果，请重试。');}
    if(!response.ok)throw Error(body?.error?.message||body?.error||`请求失败（HTTP ${response.status}）`);
    return body;
  }
  function applyPublic(value){saved=publicApiConfig(value);$('enabled').checked=saved.mode==='compatible';$('base-url').value=saved.baseUrl;$('model').value=saved.model;$('key').value='';$('clear-key').checked=false;renderCredential();}
  async function load(){
    const token=++version;controller?.abort();controller=new AbortController();saved=null;feedback('');$('loading').hidden=false;form.hidden=true;$('reload').hidden=true;setBusy(true,'load');
    try{const config=await jsonRequest('/__local/model');if(!dialog.open||token!==version)return;applyPublic(config);form.hidden=false;setBusy(false);requestAnimationFrame(()=>{if(dialog.open&&token===version)$('base-url').focus();});}
    catch(error){if(error.name==='AbortError'||token!==version||!dialog.open)return;form.hidden=false;feedback(error.message,'error');$('reload').hidden=false;setBusy(false);$('reload').focus();}
    finally{if(token===version)$('loading').hidden=true;}
  }
  function close(){if(!dialog.open)return;version++;controller?.abort();controller=null;$('key').value='';dialog.close();if(opener?.isConnected&&!opener.hidden)opener.focus();else if(!entry.hidden)entry.focus();}
  async function open(){if(dialog.open)return;opener=document.activeElement;dialog.showModal();await load();}
  function refreshVisibility(){const path=location.pathname;if(lastPath===path)return;lastPath=path;const home=path==='/home'||path==='/home/'||path==='/';entry.hidden=!home;if(!home)close();}
  async function submit(test){
    if(busy||!saved)return;
    let body;try{body=apiSubmission(saved,draft(),{test});}catch(error){feedback(error.message,'error');return;}
    const token=++version;controller?.abort();controller=new AbortController();setBusy(true,test?'test':'save');feedback(test?'正在测试当前填写的配置；已保存的设置保持不变。':'正在保存配置…');
    try{
      const result=await jsonRequest(test?'/__local/model/test':'/__local/model',{method:test?'POST':'PUT',body:JSON.stringify(body)});
      if(!dialog.open||token!==version)return;
      if(test){if(result.ok!==true||result.mode==='demo'||result.demo===true)throw Error('未确认实际模型连接，请检查地址与模型名称后重试。');feedback('连接测试成功。测试未更改已保存设置；如有修改，请点击“保存配置”。','success');}
      else{applyPublic(result);feedback(saved.mode==='compatible'?'已保存。后续对话将使用此 API 配置。':'已保存。后续对话保持界面演示模式。','success');dispatchEvent(new CustomEvent('astrix-api-config-saved',{detail:{...saved}}));}
    }catch(error){if(error.name!=='AbortError'&&dialog.open&&token===version)feedback(error.message,'error');}
    finally{if(token===version){setBusy(false);renderCredential();}}
  }
  entry.onclick=()=>void open();$('close').onclick=close;$('cancel').onclick=close;$('reload').onclick=()=>void load();$('test').onclick=()=>void submit(true);form.onsubmit=event=>{event.preventDefault();void submit(false);};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{$('key').value='';});
  for(const id of fields)$(id).addEventListener('input',()=>{if(id==='key'&&$('key').value)$('clear-key').checked=false;if(id==='clear-key'&&$('clear-key').checked)$('key').value='';feedback('');renderCredential();});
  refreshVisibility();new MutationObserver(refreshVisibility).observe(document.body,{childList:true,subtree:true});addEventListener('popstate',refreshVisibility);
  const api=Object.freeze({open,close,refreshVisibility});window.__ASTRIX_API_SETTINGS__=api;return api;
}
