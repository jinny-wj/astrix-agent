import {normalizeFigmaWorkspaceURL} from './figma-workspace.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const accountId=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value)?value:null;
const requireLive=(request,response)=>{
  if(request?.aborted||response?.destroyed)throw Object.assign(new Error('打开设计稿的请求已取消'),{name:'AbortError',status:499});
};

export function figmaCatalogLaunchURL(value) {
  const target=normalizeFigmaWorkspaceURL(value);
  if(!target.fileKey)throw fail('请选择具体的 Figma 设计文件');
  return target.url;
}

/** Open a verified remote file in the existing real Figma workspace, never a local canvas clone. */
export function createFigmaCatalogOpen({api,workspace,resolveFile}) {
  const openings=new Map();
  function binding(project) {
    try {
      const target=normalizeFigmaWorkspaceURL(project.figmaUrl||('https://www.figma.com/design/'+(project.figmaKey||'')));
      return target.fileKey?target:null;
    }catch{return null;}
  }
  function candidates() {
    return api.state.projects.flatMap(project=>{
      const target=binding(project);
      return target?[{url:target.url,projectId:project.id,...(accountId(project.figmaAccountId)?{accountId:project.figmaAccountId}:{})}]:[];
    });
  }
  async function open(request,response,body) {
    requireLive(request,response);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='url'))throw fail('请选择一个 Figma 文件链接');
    const target=normalizeFigmaWorkspaceURL(body.url);
    if(!target.fileKey)throw fail('请选择具体的 Figma 设计文件');
    // Authentication and a fresh metadata read belong to the OAuth instance
    // that owns this exact request cookie. Never accept a client account id.
    const verified=await resolveFile(request,response,target.url);
    requireLive(request,response);
    const owner=accountId(verified?.accountId),file=verified?.file;
    if(!owner||file?.key!==target.fileKey||typeof file.name!=='string'||!file.name.trim())throw fail('Figma 文件验证结果无效，请刷新文件列表后重试',502);
    const key=JSON.stringify([owner,target.fileKey]),previous=openings.get(key)||Promise.resolve();
    const operation=previous.catch(()=>{}).then(async()=>{
      requireLive(request,response);
      // Legacy unscoped bindings can be verified catalog candidates, but their
      // local files and conversations cannot be claimed by a different account.
      let project;
      for(const candidate of api.state.projects) {
        if(candidate.figmaAccountId!==owner||binding(candidate)?.fileKey!==target.fileKey)continue;
        try{await workspace.resolve(candidate.id);}catch{requireLive(request,response);continue;}
        requireLive(request,response);
        project=candidate;break;
      }
      requireLive(request,response);
      if(!project) {
        const name=file.name.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,128)||'Figma 设计文件';
        const created=api.createProject({mode:'spark',projectName:name});
        project=api.findProject(created.id);
      }
      project.figmaAccountId=owner;
      await workspace.set(project.id,{url:target.url});
      requireLive(request,response);
      const selected=api.selectWorkspace(project.projectPath,{projectId:project.id});
      if(!selected.success)throw fail('本地项目目录不可用，请重新打开设计文件',409);
      const params=new URLSearchParams({id:String(project.id),mode:'spark',autoOpenFigma:'true'});
      const session=project.latestSessionId&&api.findSession(project.latestSessionId);
      if(session&&String(session.projectId)===String(project.id))params.set('sessionId',session.id);
      return {projectId:project.id,file:{key:target.fileKey,name:file.name,url:target.url},route:'/aicode-v2?'+params};
    });
    openings.set(key,operation);
    try{const result=await operation;requireLive(request,response);return result;}finally{if(openings.get(key)===operation)openings.delete(key);}
  }
  return {open,candidates};
}
