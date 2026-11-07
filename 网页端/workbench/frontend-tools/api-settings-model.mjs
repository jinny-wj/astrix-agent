// Public form state and request shaping shared by the authored API dialog/tests.
// Saved credentials are never copied into the form or returned by this module.
export const apiProviders=Object.freeze({
  openai:Object.freeze({label:'OpenAI 兼容',baseUrl:'https://api.openai.com/v1',urlHelp:'可填接口根路径或完整 chat/completions 地址。',modelExample:'例如服务提供的 GPT 或其他兼容模型名'}),
  anthropic:Object.freeze({label:'Claude 原生 · Messages',baseUrl:'https://api.anthropic.com/v1',urlHelp:'使用 Messages API，可填根路径或完整 /v1/messages 地址。',modelExample:'填写 Claude 服务提供的模型 ID'}),
  gemini:Object.freeze({label:'Gemini 原生 · GenerateContent',baseUrl:'https://generativelanguage.googleapis.com/v1beta',urlHelp:'使用 GenerateContent API，可填版本根路径或完整模型接口地址。',modelExample:'填写 Gemini 服务提供的模型 ID'})
});
const providerOf=value=>Object.hasOwn(apiProviders,value)?value:'openai';
const knownDefaults=new Set(['http://127.0.0.1:11434/v1','http://localhost:11434/v1',...Object.values(apiProviders).map(value=>value.baseUrl)]);
export function switchApiProvider(draft,provider) {
  if(!Object.hasOwn(apiProviders,provider))throw Error('请选择支持的 API 协议。');
  const baseUrl=String(draft.baseUrl||'').trim();
  return {...draft,provider,baseUrl:!baseUrl||knownDefaults.has(baseUrl.replace(/\/+$/,''))?apiProviders[provider].baseUrl:baseUrl,apiKey:'',clearKey:false};
}
export function publicApiConfig(value={}) {
  return {mode:['compatible','codex'].includes(value.mode)?value.mode:'demo',provider:providerOf(value.provider),baseUrl:typeof value.baseUrl==='string'?value.baseUrl:'',model:typeof value.model==='string'?value.model:'',codexModel:typeof value.codexModel==='string'?value.codexModel:'',hasKey:value.hasKey===true};
}
export function publicCodexStatus(value={}) {
  const installed=value.installed===true,authenticated=value.authenticated===true;
  const authMethod=['chatgpt','api-key','unknown','none'].includes(value.authMethod)?value.authMethod:'unknown';
  const ready=value.ready===true&&installed&&authenticated&&authMethod==='chatgpt';
  const message=!installed?'未找到 Codex CLI。安装后，在终端运行 codex login 完成登录。'
    :authMethod==='api-key'?'本机 Codex 当前使用 API 登录。请在终端切换为 ChatGPT 登录，再重新检测。'
    :!authenticated?'已找到 Codex CLI，但尚未确认有效登录。请在终端运行 codex login，再重新检测。'
    :ready?'已检测到 ChatGPT 登录。运行时使用该账号可用的 Codex 额度。'
    :'Codex 登录方式或可用状态尚未确认，请重新检测；需要时在终端运行 codex login。';
  return {installed,authenticated,authMethod,ready,message};
}
export function endpointOrigin(value) {try{return new URL(String(value).trim()).origin;}catch{return null;}}
export function credentialState(saved,draft) {
  if(draft.clearKey)return 'clear';
  if(String(draft.apiKey||'').trim())return 'replace';
  if(!saved.hasKey)return 'empty';
  if(providerOf(saved.provider)!==providerOf(draft.provider===undefined?saved.provider:draft.provider))return 'new-provider';
  return endpointOrigin(saved.baseUrl)===endpointOrigin(draft.baseUrl)?'keep':'new-origin';
}
export function apiSubmission(saved,draft,{test=false}={}) {
  if(draft.connection==='codex'||draft.mode==='codex') {
    if(draft.codexModel!==undefined&&typeof draft.codexModel!=='string')throw Error('Codex 模型名应为文本。');
    const codexModel=String(draft.codexModel||'').trim();
    if(codexModel.length>200||/[\u0000-\u001f\u007f]/.test(codexModel))throw Error('Codex 模型名格式无效。');
    // Switching the connection never overwrites or clears the saved API draft.
    return {mode:'codex',codexModel};
  }
  const provider=draft.provider===undefined?providerOf(saved.provider):draft.provider;
  if(!Object.hasOwn(apiProviders,provider))throw Error('请选择支持的 API 协议。');
  const baseUrl=String(draft.baseUrl||'').trim(),model=String(draft.model||'').trim(),apiKey=String(draft.apiKey||'').trim();
  let url;try{url=new URL(baseUrl);}catch{throw Error('请填写完整的 API 地址。');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw Error('请使用普通 HTTP/HTTPS 接口地址，不附带网址登录信息或锚点。');
  const mode=test||draft.enabled?'compatible':'demo';
  if(mode==='compatible'&&!model)throw Error('请填写模型名称。名称由你使用的服务决定。');
  if(draft.clearKey&&apiKey)throw Error('清除已保存密钥时，请先清空 API Key 输入框。');
  const body={mode,provider,baseUrl,model};
  if(draft.clearKey)body.clearKey=true;else if(apiKey)body.apiKey=apiKey;
  // A blank key is intentionally omitted. The server alone decides whether it
  // can retain a same-protocol/same-origin credential or must discard it.
  return body;
}
