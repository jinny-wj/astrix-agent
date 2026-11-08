const filePath=/^\/(?:design|file|board|slides|proto|draw|make)\/([a-zA-Z0-9_-]{1,128})(?:\/|$)/;

export function figmaCatalogInput(value) {
  let url;try{url=new URL(String(value).trim());}catch{throw Error('请粘贴完整的 Figma 链接。');}
  if(url.protocol!=='https:'||!['figma.com','www.figma.com'].includes(url.hostname)||url.username||url.password||url.port)throw Error('请使用 figma.com 的 HTTPS 链接。');
  url.hash='';
  const allowed=new Set(['node-id','page-id','mode','viewport','scaling','content-scaling','hide-ui']);
  for(const key of [...url.searchParams.keys()])if(!allowed.has(key))url.searchParams.delete(key);
  return {url:url.href,kind:filePath.test(url.pathname)?'file':'source'};
}

export function figmaThumbnailUrl(value) {
  if(typeof value!=='string'||value.length>12000)return null;
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname&&!url.username&&!url.password?url.href:null;}catch{return null;}
}

export function normalizeFigmaCatalog(value) {
  if(!value||!Array.isArray(value.files))throw Error('设计稿列表暂不可用，请重试。');
  const seen=new Set(),files=[];
  for(const file of value.files){
    if(!file||typeof file.key!=='string'||typeof file.name!=='string'||!file.name.trim())continue;
    let input;try{input=figmaCatalogInput(file.url);}catch{continue;}
    const key=filePath.exec(new URL(input.url).pathname)?.[1];
    if(input.kind!=='file'||key!==file.key||seen.has(key))continue;
    seen.add(key);files.push({key,name:file.name.trim().slice(0,500),url:input.url,thumbnailUrl:figmaThumbnailUrl(file.thumbnailUrl),lastModified:typeof file.lastModified==='string'&&!Number.isNaN(Date.parse(file.lastModified))?file.lastModified:null,source:['saved','workspace','team'].includes(file.source)?file.source:null});
  }
  return {files,accountId:['string','number'].includes(typeof value.account?.id)?String(value.account.id):null,errors:Array.isArray(value.errors)?value.errors.map(error=>({status:Number(error?.status)||0,action:error?.action==='reauthorize-library'?'reauthorize-library':null})):[],partial:value.partial===true,teamConfigured:value.team?.configured===true,sources:Array.isArray(value.sources)?value.sources.filter(source=>source&&typeof source.url==='string').map(source=>({kind:source.kind,url:source.url})):[]};
}

export function figmaCatalogError(status) {
  return ({400:'此链接不是可用的 Figma 设计稿或团队、项目、文件夹来源，请检查后重试。',401:'请先通过顶部“连接 Figma”完成授权。',403:'当前账号或授权应用没有访问权限，请检查文件共享与应用权限。',404:'没有找到此设计稿或来源，请检查链接和访问权限。',409:'会话或文件状态已变化，请刷新后重试。',429:'Figma 请求较频繁，请稍后再刷新。',503:'Figma 授权尚未配置，请通过顶部连接入口查看。'})[status]||'暂时无法获取设计稿，请稍后重试。';
}

export function figmaCatalogWarnings(errors=[]) {
  if(errors.some(error=>error.action==='reauthorize-library'))return '部分来源受 Figma 目录权限限制，请检查授权应用配置；仍可添加有权限的设计稿链接。';
  const reasons=[];
  if(errors.some(error=>error.status===401||error.status===403))reasons.push('部分文件无访问权限');
  if(errors.some(error=>error.status===404))reasons.push('部分文件已不可用');
  if(errors.some(error=>error.status===429))reasons.push('请求频率受限');
  if(!reasons.length&&errors.length)reasons.push('部分来源暂不可用');
  return reasons.length?reasons.join('，')+'。可稍后刷新或检查共享权限。':'';
}

export function figmaCatalogReturnNeedsRefresh(state) {
  return state?.phase==='error'||state?.partial===true&&Array.isArray(state.errors)&&state.errors.length>0;
}

// Catalog metadata is fetched on demand, not on the account button's 5s poll.
// Every operation is bound to a generation so logout/account changes invalidate
// a late response even if its transport ignores AbortSignal.
export function createFigmaCatalog({request,onChange=()=>{},now=()=>Date.now(),passiveInterval=60000}={}) {
  let state={files:[],errors:[],sources:[],partial:false,teamConfigured:false,accountId:null,authenticated:null,phase:'idle',message:''};
  let generation=0,current=null,lastRefresh=-Infinity,disposed=false;
  const snapshot=()=>({...state,files:[...state.files],errors:[...state.errors],sources:[...state.sources]});
  const publish=next=>{state={...state,...next};onChange(snapshot());};
  function cancel(){generation++;current?.controller.abort();current=null;}
  function unauthorized(){cancel();lastRefresh=-Infinity;publish({files:[],errors:[],sources:[],partial:false,teamConfigured:false,accountId:null,authenticated:false,phase:'unauthorized',message:figmaCatalogError(401)});}
  function begin(phase){cancel();const op={id:generation,controller:new AbortController(),promise:null};current=op;publish({phase,message:''});return op;}
  const valid=op=>!disposed&&current===op&&!op.controller.signal.aborted;
  async function json(url,options,op){
    const response=await request(url,{...options,credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([op.controller.signal,AbortSignal.timeout(20000)])});
    if(!response.ok)throw Object.assign(Error(figmaCatalogError(response.status)),{status:response.status});
    return response.json();
  }
  function refresh({force=false,team=false}={}){
    if(disposed)return Promise.resolve();
    if(current)return current.promise||Promise.resolve();
    if(!force&&(state.authenticated===false||now()-lastRefresh<passiveInterval))return Promise.resolve();
    const op=begin('loading');lastRefresh=now();
    op.promise=(async()=>{
      try{
        const result=normalizeFigmaCatalog(await json('/api/auth/figma/catalog'+(team?'?team=1':''),{},op));
        if(valid(op)&&state.accountId&&result.accountId&&state.accountId!==result.accountId){cancel();publish({files:[],errors:[],sources:[],phase:'error',message:'账号状态已变化，请刷新后重试。'});return;}
        if(valid(op))publish({...result,authenticated:true,phase:'ready',message:figmaCatalogWarnings(result.errors)});
      }catch(error){
        if(!valid(op))return;
        if(error.status===401){unauthorized();return;}
        publish({phase:error.status===503?'unconfigured':'error',message:figmaCatalogError(error.status),...(error.status===503?{files:[],sources:[],accountId:null}: {})});
      }finally{if(current===op)current=null;}
    })();
    return op.promise;
  }
  function setSession(value,{refresh:shouldRefresh=true}={}){
    if(disposed||typeof value?.authenticated!=='boolean')return;
    if(!value.authenticated){if(state.authenticated!==false||state.files.length||current)unauthorized();return;}
    const id=typeof value.accountId==='string'?value.accountId:null;
    const changed=state.authenticated!==true||Boolean(id&&state.accountId&&id!==state.accountId);
    if(changed){cancel();lastRefresh=-Infinity;publish({files:[],errors:[],sources:[],partial:false,teamConfigured:false,authenticated:true,accountId:id,phase:'idle',message:''});if(shouldRefresh)void refresh({force:true});}
  }
  async function add(value){
    if(disposed)throw Error('页面已离开，请返回首页后重试。');
    const input=figmaCatalogInput(value),op=begin('adding');
    try{
      await json('/api/auth/figma/catalog/'+(input.kind==='file'?'files':'sources'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:input.url})},op);
      if(!valid(op))throw Object.assign(Error('账号或页面已变化，请重试。'),{name:'AbortError'});
      current=null;
      const refreshing=refresh({force:true,team:input.kind==='source'}),refreshGeneration=generation;
      await refreshing;
      // Refresh has its own transport operation, but still belongs to this
      // addition. A logout, page exit or account replacement cancels both.
      if(disposed||generation!==refreshGeneration||state.authenticated===false)throw Object.assign(Error('账号或页面已变化，请重试。'),{name:'AbortError'});
      return input.kind;
    }catch(error){
      if(valid(op)){if(error.status===401)unauthorized();else publish({phase:'error',message:figmaCatalogError(error.status)});}
      throw error;
    }finally{if(current===op)current=null;}
  }
  return {snapshot,refresh,add,setSession,cancel(){cancel();if(['loading','adding'].includes(state.phase))publish({phase:state.files.length?'ready':'idle'});},unauthorized,dispose(){disposed=true;cancel();}};
}

export function figmaCatalogDesignRoute(value,origin) {
  if(typeof value!=='string')throw Error('打开设计稿的返回地址无效。');
  const url=new URL(value,origin);
  if(url.origin!==origin||url.pathname!=='/aicode-v2'||!url.searchParams.get('id')||url.username||url.password)throw Error('打开设计稿的返回地址无效。');
  return url.pathname+url.search+url.hash;
}

// Keep a browser's official Figma tab within the user's click activation. The
// localhost redirect route validates its destination; desktop uses its native
// Figma view and must not also open a browser window.
export function requestFigmaCatalogOpen(value,{request,open,desktop=false,signal}={}) {
  const input=figmaCatalogInput(value);
  if(input.kind!=='file')throw Error('请选择真实的 Figma 设计稿。');
  if(!desktop)open('/__local/figma/catalog/launch?'+new URLSearchParams({url:input.url}),'_blank','noopener,noreferrer');
  return request('/__local/figma/catalog/open',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({url:input.url}),signal});
}
