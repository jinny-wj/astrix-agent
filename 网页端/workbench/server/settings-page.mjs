export function modelSettingsPage({css,header}) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Astrix 模型连接与工作区</title><style>${css}[hidden]{display:none!important}.notice{padding:14px;border:1px solid #e5e3f3;border-radius:10px;background:#f8f7fd}.notice code{background:white;padding:3px 7px;border-radius:5px}.row{flex-wrap:wrap}</style>${header}<main>
<h1>模型连接与工作区</h1><p>选择本机 Codex，或连接官方、第三方及本机 API 服务。配置保存在本机。</p>
<form id="form">
<label>连接方式<select id="mode"><option value="demo">界面演示（不进行模型推理）</option><option value="codex">本机 Codex · ChatGPT 登录额度</option><option value="compatible">自定义 API</option></select></label>
<section id="codex-fields" hidden><p class="notice">使用这台电脑已登录的 Codex CLI，无需填写 API Key。需要使用 ChatGPT 账号登录；额度不足或登录失效时会提示，不自动切换 API。<br>尚未登录时，在本机终端运行 <code>codex login</code> 并自行完成登录。</p><label>Codex 模型（可选）<input id="codexModel" placeholder="留空使用 Codex 默认模型" spellcheck="false"></label><div class="row"><button type="button" class="secondary" id="check-codex">检测安装与登录</button></div><p id="codex-status" role="status">检测登录不消耗模型额度。</p></section>
<section id="api-fields"><label>API 协议<select id="provider"><option value="openai">OpenAI 兼容</option><option value="anthropic">Claude 原生 · Messages</option><option value="gemini">Gemini 原生 · GenerateContent</option></select></label>
<label>服务地址<input id="baseUrl" placeholder="填写 API 地址"></label><p><small id="urlHelp"></small></p>
<label>模型名称<input id="model" placeholder="填写服务中实际存在的模型名"></label>
<label>API Key（免密服务可留空）<input id="apiKey" type="password" autocomplete="new-password" placeholder="同协议、同来源留空保留"></label><p><small id="apiKeyHint"></small></p><label class="check"><input type="checkbox" id="clearKey">清除已保存的 API Key</label></section>
<label>API 执行引擎<select id="engine"><option value="local">本地文件助手</option><option value="original-opencode">恢复的原版 OpenCode</option></select></label><p><small>本机 Codex 使用独立的 CLI 连接；API 引擎设置会保留，切回 API 后继续使用。</small></p>
<label>工作流<select id="workflow"><option value="single">单 Agent 对话</option><option value="multi">多 Agent：规划、分工、执行与复核</option></select></label><p><small>两种连接方式均可用于多 Agent。运行记录见<a href="/__local/workflow">多 Agent 工作台</a>。</small></p>
<label class="check"><input type="checkbox" id="allowWriteTools">允许 AI 修改当前工作区内的文件</label><p><small>默认仅允许列出、读取工作区文件。启用后可创建和修改工作区内文本文件。</small></p>
<label class="check"><input type="checkbox" id="allowFigmaWriteTools">允许 AI 修改当前 Figma 文件的图层</label><p><small>需要同一文件已连接 Plugin Bridge，修改绑定发送时的文件与选区，并等待插件回执。</small></p>
<div class="row"><button type="submit" id="save" disabled>保存设置</button><button type="button" class="secondary" id="test" disabled>测试当前连接</button></div><p><small>保存与检测登录不发起推理；“测试当前连接”会发送一次少量请求，不保存草稿。</small></p>
</form><div id="status" role="status" aria-live="polite"></div></main>
<script type="module">
import {apiProviders,publicApiConfig,credentialState,apiSubmission,switchApiProvider} from '/api-settings-model.mjs';
const fields=['mode','provider','engine','workflow','baseUrl','model','codexModel','allowWriteTools','allowFigmaWriteTools'];
const $=id=>document.getElementById(id),status=$('status');let saved=null,busy=false,controller=null;
const draft=()=>({connection:'api',provider:$('provider').value,enabled:$('mode').value==='compatible',baseUrl:$('baseUrl').value,model:$('model').value,apiKey:$('apiKey').value,clearKey:$('clearKey').checked});
function source(){const codex=$('mode').value==='codex';$('codex-fields').hidden=!codex;$('api-fields').hidden=codex;$('engine').disabled=codex||busy||!saved;}
function hints(){const detail=apiProviders[$('provider').value]||apiProviders.openai;$('urlHelp').textContent=detail.urlHelp;$('baseUrl').placeholder=detail.baseUrl;$('model').placeholder=detail.modelExample;const state=credentialState(saved||{},draft());$('apiKeyHint').textContent=state==='new-provider'?'API 协议已改变，原密钥不会沿用。':state==='new-origin'?'服务来源已改变，原密钥不会沿用。':state==='keep'?'已保存密钥；同协议、同来源留空保留。':'无需密钥的服务可留空。';source();}
function apply(value){saved=publicApiConfig(value);for(const key of fields){const control=$(key);if(control.type==='checkbox')control.checked=Boolean(value[key]);else control.value=key==='provider'?saved.provider:value[key]||'';}$('apiKey').value='';$('clearKey').checked=false;hints();}
function setBusy(value){busy=value;for(const control of $('form').elements)control.disabled=value||!saved;source();}
async function request(url,options={}){const response=await fetch(url,{...options,signal:controller?.signal,credentials:'same-origin'});const data=await response.json();if(!response.ok)throw Error(data.error?.message||data.error||'请求失败');return data;}
function submission(test=false){const body=$('mode').value==='codex'?{mode:'codex',codexModel:$('codexModel').value.trim()}:apiSubmission(saved,draft(),{test});for(const key of ['engine','workflow','allowWriteTools','allowFigmaWriteTools'])body[key]=$(key).type==='checkbox'?$(key).checked:$(key).value;return body;}
try{apply(await request('/__local/model'));setBusy(false);}catch(error){status.textContent='读取失败：'+error.message+'。请刷新后重试。';setBusy(false);}
$('mode').onchange=source;$('provider').onchange=()=>{const next=switchApiProvider(draft(),$('provider').value);$('baseUrl').value=next.baseUrl;$('apiKey').value='';$('clearKey').checked=false;hints();};$('baseUrl').oninput=hints;
$('check-codex').onclick=async()=>{if(busy||!saved)return;controller?.abort();controller=new AbortController();setBusy(true);$('codex-status').textContent='正在检测…';try{const result=await request('/__local/codex/status');$('codex-status').textContent=result.message||'请在本机终端运行 codex login 后重新检测。';}catch(error){if(error.name!=='AbortError')$('codex-status').textContent=error.message;}finally{setBusy(false);}};
$('form').onsubmit=async event=>{event.preventDefault();if(busy||!saved)return;let body;try{body=submission();}catch(error){status.textContent=error.message;return;}controller?.abort();controller=new AbortController();setBusy(true);try{apply(await request('/__local/model',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));status.textContent='已保存。后续任务使用所选连接方式。';}catch(error){if(error.name!=='AbortError')status.textContent=error.message;}finally{setBusy(false);}};
$('test').onclick=async()=>{if(busy||!saved)return;let body;try{body=submission(true);}catch(error){status.textContent=error.message;return;}controller?.abort();controller=new AbortController();setBusy(true);status.textContent='正在测试当前配置，不更改已保存设置…';try{const result=await request('/__local/model/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});status.textContent=result.message||'连接成功';}catch(error){if(error.name!=='AbortError')status.textContent=error.message;}finally{setBusy(false);}};
addEventListener('pagehide',()=>controller?.abort());
</script></html>`;
}
