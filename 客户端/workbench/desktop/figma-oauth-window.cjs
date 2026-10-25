'use strict';

const COMPLETE_PATH='/figma-oauth-complete.html';
function oauthLocalURL(value,baseURL){
  try{const url=new URL(value),base=new URL(baseURL);if(url.origin!==base.origin||url.username||url.password||url.hash)return null;return url;}catch{return null;}
}
function isOAuthStartURL(value,baseURL){
  const url=oauthLocalURL(value,baseURL);
  return Boolean(url&&url.pathname==='/api/auth/figma/start'&&url.searchParams.get('handoff')==='1'&&url.searchParams.get('returnTo')===COMPLETE_PATH);
}
function isOAuthWindowURL(value,baseURL){
  const url=oauthLocalURL(value,baseURL);
  return Boolean(url&&(isOAuthStartURL(value,baseURL)||url.pathname===COMPLETE_PATH));
}
function isOfficialOAuthURL(value,baseURL){
  try{const url=new URL(value),base=new URL(baseURL);return url.origin==='https://www.figma.com'&&!url.username&&!url.password&&!url.hash&&url.pathname==='/oauth'&&url.searchParams.get('redirect_uri')===new URL('/api/auth/figma/callback',base).href&&url.searchParams.get('response_type')==='code'&&url.searchParams.get('code_challenge_method')==='S256'&&Boolean(url.searchParams.get('client_id')&&url.searchParams.get('state')&&url.searchParams.get('code_challenge'));}catch{return false;}
}

function createOAuthWindow({electron,mainWindow,baseURL,url}){
  if(!isOAuthStartURL(url,baseURL))throw new Error('Figma OAuth 入口无效。');
  const {BrowserWindow,shell,dialog}=electron;
  // The handoff cookie and the resulting login must use the same partition as
  // the initiating workbench. Figma itself opens only in the external browser.
  const window=new BrowserWindow({width:560,height:440,parent:mainWindow,title:'连接 Figma · Astrix',webPreferences:{session:mainWindow.webContents.session,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  const openOfficial=value=>{if(isOfficialOAuthURL(value,baseURL))void shell.openExternal(value).catch(()=>dialog.showErrorBox('Figma 授权页未打开','请重新连接 Figma 账号。'));};
  window.webContents.setWindowOpenHandler(({url:target})=>{openOfficial(target);return{action:'deny'};});
  const navigation=(event,target)=>{if(!isOAuthWindowURL(target,baseURL)){event.preventDefault();openOfficial(target);}};
  window.webContents.on('will-navigate',navigation);window.webContents.on('will-redirect',navigation);
  window.webContents.on('did-navigate',(_event,target)=>{if(!isOAuthWindowURL(target,baseURL))return;const completed=new URL(target);if(completed.pathname===COMPLETE_PATH&&completed.searchParams.get('figma_auth')==='connected')window.close();});
  void window.loadURL(url).catch(()=>{if(!window.isDestroyed())window.close();dialog.showErrorBox('Figma 连接失败','本地授权窗口无法打开，请重试。');});
  return window;
}

module.exports={COMPLETE_PATH,isOAuthStartURL,isOAuthWindowURL,isOfficialOAuthURL,createOAuthWindow};
