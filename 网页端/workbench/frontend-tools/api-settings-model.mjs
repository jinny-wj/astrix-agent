// Public form state and request shaping shared by the authored API dialog/tests.
// Saved credentials are never copied into the form or returned by this module.
export function publicApiConfig(value={}) {
  return {mode:value.mode==='compatible'?'compatible':'demo',baseUrl:typeof value.baseUrl==='string'?value.baseUrl:'',model:typeof value.model==='string'?value.model:'',hasKey:value.hasKey===true};
}
export function endpointOrigin(value) {try{return new URL(String(value).trim()).origin;}catch{return null;}}
export function credentialState(saved,draft) {
  if(draft.clearKey)return 'clear';
  if(String(draft.apiKey||'').trim())return 'replace';
  if(!saved.hasKey)return 'empty';
  return endpointOrigin(saved.baseUrl)===endpointOrigin(draft.baseUrl)?'keep':'new-origin';
}
export function apiSubmission(saved,draft,{test=false}={}) {
  const baseUrl=String(draft.baseUrl||'').trim(),model=String(draft.model||'').trim(),apiKey=String(draft.apiKey||'').trim();
  let url;try{url=new URL(baseUrl);}catch{throw Error('请填写完整的 API 地址。');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw Error('请使用普通 HTTP/HTTPS 接口地址，不附带网址登录信息或锚点。');
  const mode=test||draft.enabled?'compatible':'demo';
  if(mode==='compatible'&&!model)throw Error('请填写模型名称。名称由你使用的服务决定。');
  if(draft.clearKey&&apiKey)throw Error('清除已保存密钥时，请先清空 API Key 输入框。');
  const body={mode,baseUrl,model};
  if(draft.clearKey)body.clearKey=true;else if(apiKey)body.apiKey=apiKey;
  // A blank key is intentionally omitted. The server alone decides whether it
  // can retain a same-origin credential or must discard it for a new origin.
  return body;
}
