import {apiProviders,publicApiConfig,publicCodexStatus,credentialState,apiSubmission,switchApiProvider} from './api-settings-model.mjs';

export function installApiSettings({request=window.fetch.bind(window)}={}) {
  if(document.getElementById('astrix-api-entry'))return window.__ASTRIX_API_SETTINGS__;
  const entry=document.createElement('button');entry.type='button';entry.id='astrix-api-entry';entry.setAttribute('aria-haspopup','dialog');entry.setAttribute('aria-controls','astrix-api-dialog');
  entry.innerHTML='<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7.5 3.4h5l.5 2 1.8 1.1 2-.6 2.4 4.2-1.5 1.4v2.1l1.5 1.4-2.4 4.2-2-.6-1.8 1.1-.5 2h-5l-.5-2-1.8-1.1-2 .6L.8 15l1.5-1.4v-2.1L.8 10.1l2.4-4.2 2 .6L7 5.4l.5-2Z" transform="translate(1 0) scale(.8)" stroke="currentColor" stroke-width="1.4"/><circle cx="9" cy="10" r="2.4" stroke="currentColor" stroke-width="1.4"/></svg><span>模型连接</span>';
  const dialog=document.createElement('dialog');dialog.id='astrix-api-dialog';dialog.className='astrix-api-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-labelledby','astrix-api-title');dialog.setAttribute('aria-describedby','astrix-api-description');
  dialog.innerHTML=`<div class="api-header"><span class="api-emblem" aria-hidden="true">✦</span><div><h2 id="astrix-api-title">模型连接</h2><p class="api-subtitle">选择本机 Codex 或自定义 API</p></div><button type="button" class="api-close" id="astrix-api-close" aria-label="关闭模型连接">×</button></div>
  <p class="api-loading" id="astrix-api-loading" role="status">正在读取配置…</p>
  <form id="astrix-api-form" novalidate autocomplete="off" hidden>
    <p class="api-intro" id="astrix-api-description">使用本机已登录的 Codex，或连接官方、第三方与本机模型 API。保存后用于后续对话。</p>
    <fieldset class="api-connection-options"><legend>调用方式</legend>
      <label class="api-connection-option"><input id="astrix-api-connection-codex" name="astrix-model-connection" type="radio" value="codex"><span>本机 Codex<small>使用已登录 ChatGPT 账号的 Codex 额度</small></span></label>
      <label class="api-connection-option"><input id="astrix-api-connection-api" name="astrix-model-connection" type="radio" value="api"><span>自定义 API<small>OpenAI 兼容、Claude 或 Gemini 原生接口</small></span></label>
    </fieldset>
    <div id="astrix-api-codex-panel" hidden>
      <div class="api-codex-status"><div><strong>本机安装与登录</strong><p id="astrix-api-codex-status" role="status" aria-live="polite">尚未检测。检测状态不会调用模型。</p></div><button id="astrix-api-codex-check" type="button">检测状态</button></div>
      <label class="api-field" for="astrix-api-codex-model">Codex 模型（可选）<input id="astrix-api-codex-model" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="留空使用 Codex 默认模型"><span class="api-help">无需填写 API Key。模型与额度由本机 Codex 账号决定；不可用时会提示，不会自动切换到 API。</span></label>
      <p class="api-codex-login">需要登录时，请在本机终端运行 <code>codex login</code>，完成 ChatGPT 登录后重新检测。</p>
    </div>
    <div id="astrix-api-api-panel">
    <label class="api-switch-row"><span class="api-switch-copy">用于后续对话<small>保存后生效；关闭时使用界面演示</small></span><input id="astrix-api-enabled" type="checkbox" role="switch" aria-label="保存后使用 API 对话"></label>
    <label class="api-field" for="astrix-api-provider">API 协议<select id="astrix-api-provider">${Object.entries(apiProviders).map(([value,detail])=>`<option value="${value}">${detail.label}</option>`).join('')}</select></label>
    <label class="api-field" for="astrix-api-base-url">API 地址<input id="astrix-api-base-url" type="url" inputmode="url" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="填写服务的 API 地址" aria-describedby="astrix-api-url-help"><span class="api-help" id="astrix-api-url-help"></span></label>
    <label class="api-field" for="astrix-api-model">模型名称<input id="astrix-api-model" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="填写该服务中的模型名称"></label>
    <label class="api-field" for="astrix-api-key">API Key<input id="astrix-api-key" type="password" spellcheck="false" autocapitalize="off" autocomplete="new-password" placeholder="无需密钥的服务可留空" aria-describedby="astrix-api-key-note"></label>
    <p id="astrix-api-key-note" role="status"></p>
    <label class="api-clear-row" id="astrix-api-clear-row" hidden><input id="astrix-api-clear-key" type="checkbox">保存时清除已保存的密钥</label>
    </div>
    <p class="api-feedback" id="astrix-api-feedback" role="status" aria-live="polite" hidden></p>
    <div class="api-actions"><button type="button" id="astrix-api-reload" hidden>重新读取</button><button type="button" id="astrix-api-cancel">取消</button><button type="button" id="astrix-api-test">测试连接</button><button type="submit" id="astrix-api-save" class="api-save">保存配置</button></div>
    <p class="api-footnote" id="astrix-api-footnote"></p>
  </form>`;
  document.body.append(entry,dialog);
  const $=id=>dialog.querySelector('#astrix-api-'+id),form=$('form');
  let saved=null,busy=false,checking=false,codexStatus=null,opener=null,controller=null,statusController=null,version=0,statusVersion=0,lastPath='';
  const fields=['connection-codex','connection-api','codex-model','enabled','provider','base-url','model','key','clear-key'];
  const isCodex=()=>$('connection-codex').checked;
  const draft=()=>({connection:isCodex()?'codex':'api',codexModel:$('codex-model').value,enabled:$('enabled').checked,provider:$('provider').value,baseUrl:$('base-url').value,model:$('model').value,apiKey:$('key').value,clearKey:$('clear-key').checked});
  function renderProtocol(){const details=apiProviders[$('provider').value]||apiProviders.openai;$('url-help').textContent=details.urlHelp+' API Key 请填写下方独立字段。';$('base-url').placeholder=details.baseUrl;$('model').placeholder=details.modelExample;}
  function feedback(message,kind='info'){const target=$('feedback');target.textContent=message;target.dataset.kind=kind;target.hidden=!message;}
  function renderConnection(){
    const codex=isCodex();$('codex-panel').hidden=!codex;$('api-panel').hidden=codex;
    $('footnote').textContent=codex?'检测状态不会使用模型额度；点击“测试 Codex”会发起一次简短请求，使用少量 Codex 额度，不保存或启用配置。':'测试使用当前填写的配置，不保存，也不启用对话。密钥不会回显或写入浏览器存储。';
    $('test').textContent=busy&&form.dataset.operation==='test'?'正在测试…':codex?'测试 Codex':'测试连接';
    $('codex-check').disabled=busy||checking||!saved;
  }
  function setBusy(value,operation=''){busy=value;form.dataset.operation=operation;form.setAttribute('aria-busy',String(value));for(const id of [...fields,'test','save'])$(id).disabled=value||!saved;$('save').textContent=value&&operation==='save'?'正在保存…':'保存配置';renderConnection();}
  function renderCredential(){
    if(!saved)return;const value=credentialState(saved,draft()),note=$('key-note');note.dataset.state=value;
    const messages={keep:'已保存密钥；留空会保留同一协议、同一来源的密钥。',replace:'保存后使用新填写的密钥。',clear:'保存后清除已保存的密钥；当前填写内容仍可先测试。','new-provider':'API 协议已改变，原密钥不会沿用。请填写此协议服务的密钥；无需密钥的服务可留空。','new-origin':'地址来源已改变，原密钥不会沿用。请填写新来源的密钥；无需密钥的服务可留空。',empty:'未保存密钥。无需密钥的本机服务可留空。'};
    note.textContent=messages[value];$('key').placeholder=saved.hasKey&&value==='keep'?'已保存，留空保留':'无需密钥的服务可留空';$('clear-row').hidden=!saved.hasKey;
  }
  async function jsonRequest(url,options={}){
    const response=await request(url,{...options,credentials:'same-origin',signal:options.signal||controller?.signal,headers:{'content-type':'application/json',...options.headers}});
    let body;try{body=await response.json();}catch{throw Error('服务未返回有效结果，请重试。');}
    if(!response.ok)throw Error(body?.error?.message||body?.error||`请求失败（HTTP ${response.status}）`);
    return body;
  }
  function applyPublic(value){
    saved=publicApiConfig(value);$('connection-codex').checked=saved.mode==='codex';$('connection-api').checked=saved.mode!=='codex';$('codex-model').value=saved.codexModel;
    $('enabled').checked=saved.mode!=='demo';$('provider').value=saved.provider;$('base-url').value=saved.baseUrl;$('model').value=saved.model;$('key').value='';$('clear-key').checked=false;renderProtocol();renderCredential();renderConnection();
  }
  async function checkCodexStatus(){
    if(!saved||busy||!dialog.open)return;
    const token=++statusVersion;statusController?.abort();statusController=new AbortController();checking=true;$('codex-status').textContent='正在检测本机 Codex 安装与登录…';renderConnection();
    try{
      const value=await jsonRequest('/__local/codex/status',{signal:statusController.signal});
      if(!dialog.open||token!==statusVersion)return;
      codexStatus=publicCodexStatus(value);$('codex-status').textContent=codexStatus.message;$('codex-status').dataset.ready=String(codexStatus.ready);
    }catch(error){if(error.name!=='AbortError'&&dialog.open&&token===statusVersion){codexStatus=null;$('codex-status').textContent='无法检测本机 Codex 状态。请确认本地服务正常，再点击重新检测。';$('codex-status').dataset.ready='false';}}
    finally{if(token===statusVersion){checking=false;renderConnection();}}
  }
  async function load(){
    const token=++version;controller?.abort();controller=new AbortController();statusVersion++;statusController?.abort();checking=false;codexStatus=null;saved=null;feedback('');$('loading').hidden=false;form.hidden=true;$('reload').hidden=true;setBusy(true,'load');
    try{const config=await jsonRequest('/__local/model');if(!dialog.open||token!==version)return;applyPublic(config);form.hidden=false;setBusy(false);if(isCodex())void checkCodexStatus();requestAnimationFrame(()=>{if(dialog.open&&token===version)(isCodex()?$('codex-model'):$('base-url')).focus();});}
    catch(error){if(error.name==='AbortError'||token!==version||!dialog.open)return;form.hidden=false;feedback(error.message,'error');$('reload').hidden=false;setBusy(false);$('reload').focus();}
    finally{if(token===version)$('loading').hidden=true;}
  }
  function close(){if(!dialog.open)return;version++;statusVersion++;controller?.abort();statusController?.abort();controller=null;statusController=null;checking=false;$('key').value='';dialog.close();if(opener?.isConnected&&!opener.hidden)opener.focus();else if(!entry.hidden)entry.focus();}
  async function open(){if(dialog.open)return;opener=document.activeElement;dialog.showModal();await load();}
  function refreshVisibility(){const path=location.pathname;if(lastPath===path)return;lastPath=path;const home=path==='/home'||path==='/home/'||path==='/';entry.hidden=!home;if(!home)close();}
  async function submit(test){
    if(busy||!saved)return;
    let body;try{body=apiSubmission(saved,draft(),{test});}catch(error){feedback(error.message,'error');return;}
    const codex=body.mode==='codex',token=++version;controller?.abort();controller=new AbortController();setBusy(true,test?'test':'save');feedback(test?(codex?'正在通过本机 Codex 发起简短测试；已保存设置保持不变。':'正在测试当前填写的配置；已保存的设置保持不变。'):'正在保存配置…');
    try{
      const result=await jsonRequest(test?'/__local/model/test':'/__local/model',{method:test?'POST':'PUT',body:JSON.stringify(body)});
      if(!dialog.open||token!==version)return;
      if(test){if(result.ok!==true||result.mode==='demo'||result.demo===true)throw Error(codex?'未确认 Codex 连接，请检查登录状态和可用额度后重试。':'未确认实际模型连接，请检查地址与模型名称后重试。');feedback(codex?'Codex 连接测试成功。已使用本机登录；测试未更改已保存设置。':'连接测试成功。测试未更改已保存设置；如有修改，请点击“保存配置”。','success');}
      else{applyPublic(result);feedback(saved.mode==='codex'?'已保存。后续对话将使用本机 Codex；安装、登录与额度仍以运行时检测为准。':saved.mode==='compatible'?'已保存。后续对话将使用此 API 配置。':'已保存。后续对话保持界面演示模式。','success');dispatchEvent(new CustomEvent('astrix-api-config-saved',{detail:{...saved}}));}
    }catch(error){if(error.name!=='AbortError'&&dialog.open&&token===version)feedback(error.message,'error');}
    finally{if(token===version){setBusy(false);renderCredential();}}
  }
  entry.onclick=()=>void open();$('close').onclick=close;$('cancel').onclick=close;$('reload').onclick=()=>void load();$('codex-check').onclick=()=>void checkCodexStatus();$('test').onclick=()=>void submit(true);form.onsubmit=event=>{event.preventDefault();void submit(false);};
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{$('key').value='';});
  for(const id of ['connection-codex','connection-api'])$(id).addEventListener('change',()=>{feedback('');renderConnection();if(isCodex()&&!codexStatus)void checkCodexStatus();});
  $('provider').addEventListener('change',()=>{const hadDraftKey=Boolean($('key').value);const next=switchApiProvider(draft(),$('provider').value);$('base-url').value=next.baseUrl;$('key').value='';$('clear-key').checked=false;renderProtocol();renderCredential();feedback(hadDraftKey?'已切换协议，并清空尚未保存的 API Key。请填写新服务的密钥。':'');});
  for(const id of fields.filter(id=>!['provider','connection-codex','connection-api'].includes(id)))$(id).addEventListener('input',()=>{if(id==='key'&&$('key').value)$('clear-key').checked=false;if(id==='clear-key'&&$('clear-key').checked)$('key').value='';feedback('');renderCredential();});
  refreshVisibility();new MutationObserver(refreshVisibility).observe(document.body,{childList:true,subtree:true});addEventListener('popstate',refreshVisibility);
  const api=Object.freeze({open,close,refreshVisibility});window.__ASTRIX_API_SETTINGS__=api;return api;
}
