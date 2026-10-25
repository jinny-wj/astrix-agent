import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {createFigmaOAuthMiddleware} from './figma-oauth.mjs';

// Configuration remains backend-only. Loading Figma fields never changes model
// settings or exposes the application's .env contents to a browser.
export function readFigmaOAuthConfig({applicationRoot,port,environment=process.env}={}) {
  const values={};
  for(const name of ['.env','.env.local']) {
    try { Object.assign(values,parseEnv(fs.readFileSync(path.join(applicationRoot,name),'utf8'))); }
    catch(error) { if(error.code!=='ENOENT')throw new Error('Figma OAuth 本地配置无法读取。'); }
  }
  for(const name of ['FIGMA_OAUTH_CLIENT_ID','FIGMA_OAUTH_CLIENT_SECRET','FIGMA_OAUTH_REDIRECT_URI','FIGMA_TEAM_IDS']) {
    if(environment[name]!==undefined)values[name]=environment[name];
  }
  const origin=`http://127.0.0.1:${port}`;
  const clientId=String(values.FIGMA_OAUTH_CLIENT_ID||'').trim();
  const clientSecret=String(values.FIGMA_OAUTH_CLIENT_SECRET||'').trim();
  const redirectUri=String(values.FIGMA_OAUTH_REDIRECT_URI||`${origin}/api/auth/figma/callback`).trim();
  if((clientId||clientSecret)&&redirectUri!==`${origin}/api/auth/figma/callback`) {
    throw new Error('Figma OAuth 回调地址必须与当前客户端端口完全一致。');
  }
  if([clientId,clientSecret].some(value=>value.length>4096||/[\u0000-\u001f\u007f]/.test(value))) {
    throw new Error('Figma OAuth 本地配置格式无效。');
  }
  return {clientId,clientSecret,redirectUri,teamIds:String(values.FIGMA_TEAM_IDS||'').split(/[,\s]+/).filter(Boolean)};
}

export function createWorkbenchFigmaOAuth({applicationRoot,port,dataDir,surface,environment}={}) {
  return createFigmaOAuthMiddleware({
    ...readFigmaOAuthConfig({applicationRoot,port,environment}),
    dataDirectory:path.join(dataDir,'figma-oauth'),
    cookieNamespace:`${surface}_${port}`,
    accountPickerByDefault:surface!=='desktop',
    unconfiguredStartPage:surface==='desktop',
    allowedOrigin:`http://127.0.0.1:${port}`,
  });
}
