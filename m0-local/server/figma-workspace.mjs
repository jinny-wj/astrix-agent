import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {generateKrn} from '../plugins/local-generators.mjs';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function normalizeFigmaWorkspaceURL(value){
  if(typeof value!=='string'||value.length>4096)throw fail('请输入 Figma 文件链接');
  let url;try{url=new URL(value.trim());}catch{throw fail('请输入完整的 https://www.figma.com/design/… 文件链接');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!['www.figma.com','figma.com','figma.new'].includes(url.hostname))throw fail('只支持 Figma 官方 HTTPS 链接');
  if(url.hostname==='figma.new')return {url:'https://figma.new/',fileKey:null};
  const segments=url.pathname.split('/').filter(Boolean),isFile=['design','file','board','slides','proto'].includes(segments[0]);
  if(isFile&&!/^[a-zA-Z0-9_-]{1,128}$/.test(segments[1]||''))throw fail('Figma 文件标识无效');
  if(!isFile&&!['/','/files','/files/'].includes(url.pathname))throw fail('请使用 Figma 文件链接或文件首页');
  url.hostname='www.figma.com';url.hash='';
  for(const key of [...url.searchParams.keys()])if(!['node-id','page-id','mode','viewport','scaling','content-scaling','hide-ui'].includes(key))url.searchParams.delete(key);
  return {url:url.href,fileKey:isFile?segments[1]:null};
}

export function createFigmaWorkspace({api,canvas,bridge,port,dataDir}){
  async function resolve(projectId){const context=await canvas.target(projectId);if(context.projectId===null||context.projectId===undefined)throw fail('请先创建或打开 M0 项目，再连接 Figma 文件',409);return context;}
  async function get(projectId){
    const context=await resolve(projectId),project=api.findProject(context.projectId);
    let binding={url:'',fileKey:null};
    if(project.figmaUrl)try{binding=normalizeFigmaWorkspaceURL(project.figmaUrl);}catch{}
    else if(/^[a-zA-Z0-9_-]{1,128}$/.test(project.figmaKey||''))binding={url:'https://www.figma.com/design/'+project.figmaKey,fileKey:project.figmaKey};
    return {projectId:project.id,...binding};
  }
  async function set(projectId,body){const context=await resolve(projectId),project=api.findProject(context.projectId),binding=body.url===''?{url:'',fileKey:null}:normalizeFigmaWorkspaceURL(body.url);project.figmaUrl=binding.url;project.figmaKey=binding.fileKey||'';project.updatedAt=Date.now();api.save();return {projectId:project.id,...binding};}
  async function capture(projectId,raw){
    const binding=await get(projectId);
    if(!raw||String(raw.projectId)!==String(binding.projectId)||!binding.fileKey||raw.fileKey!==binding.fileKey||typeof raw.sessionId!=='string')throw fail('Figma 上下文与当前项目文件不一致，请重新选择图层',409);
    const live=await bridge.getContext({projectId:binding.projectId,fileKey:binding.fileKey,sessionId:raw.sessionId});
    const revision=raw.selectionRevision??raw.selectionVersion;
    if(!Number.isInteger(revision)||revision!==live.selectionRevision)throw fail('Figma 选区已变化，请确认当前选区后重新发送',409);
    const ids=raw.targetNodeIds??raw.nodes?.map(node=>node.id)??[];
    if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!live.nodes.some(node=>node.id===id)))throw fail('Figma 目标图层不在当前选区内',409);
    return {projectId:binding.projectId,fileKey:binding.fileKey,sessionId:live.sessionId,selectionRevision:revision,targetNodeIds:[...new Set(ids)],nodes:live.nodes.filter(node=>ids.includes(node.id)).map(node=>({id:node.id,name:String(node.name||'').slice(0,200),type:node.type})),url:binding.url};
  }
  async function metadata(projectId){const binding=await get(projectId);await bridge.preparePlugin();return {...binding,pluginDirectory:bridge.pluginDirectory,manifestPath:path.join(bridge.pluginDirectory,'manifest.json'),port,baseURL:'http://127.0.0.1:'+port};}
  async function generate(projectId,body,signal){
    const context=await resolve(projectId),binding=await get(context.projectId),captured=await capture(context.projectId,{...body,projectId:context.projectId,fileKey:body.fileKey||binding.fileKey});
    const nodeId=body.nodeId||captured.targetNodeIds[0];if(!nodeId||!captured.targetNodeIds.includes(nodeId))throw fail('请先在 Figma 选中需要生成代码的画板或图层');
    const ack=await bridge.execute({...captured,type:'export-schema',nodeId,signal});
    if(!ack.ok)throw fail(ack.error||'Figma 插件未能导出所选节点',409);
    const schema=ack.result?.data??ack.data;if(!schema?.nodeTree)throw fail('插件未返回真实 M0Schema');
    const assets=[];let bytes=0;
    for(const image of Object.values(schema.imageMap||{})){
      const data=image.dataURL||image.uri||image.url,parsed=typeof data==='string'&&/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data),base64=parsed?.[1]||image.base64;
      if(!base64)throw fail('Figma 素材缺少实际图片内容');
      const content=Buffer.from(base64,'base64'),fileName=image.fileName;
      bytes+=content.length;
      if(typeof base64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)||content.toString('base64')!==base64||typeof fileName!=='string'||!/^[-a-zA-Z0-9_]{1,150}\.png$/.test(fileName)||!content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||content.length>2*1024*1024||bytes>4*1024*1024)throw fail('Figma 导出的素材格式无效或超过大小限制');
      assets.push({path:'assets/'+fileName,content});
    }
    const output=await generateKrn(schema);signal?.throwIfAborted();
    const current=await get(context.projectId);if(current.fileKey!==captured.fileKey)throw fail('生成期间已切换 Figma 文件，未保存生成结果',409);
    const directory='generated/figma-'+Date.now()+'-'+randomUUID().slice(0,8),files=output.files.map(file=>({...file,path:directory+'/'+file.path}));
    const imported=await context.files.importProject([...files,...assets.map(asset=>({...asset,path:directory+'/'+asset.path}))],{allowBinary:true});
    return {...output,files,assets:assets.map(asset=>({path:directory+'/'+asset.path,size:asset.content.length,sha256:createHash('sha256').update(asset.content).digest('hex')})),directory,imported,fileKey:captured.fileKey,projectId:context.projectId};
  }
  return {get,set,capture,metadata,generate,resolve};
}
