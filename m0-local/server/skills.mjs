import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const resources=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../M0-AI-recovered/extracted/resources/skills');
async function catalog(){
  const records=[];
  let root;try {root=await fs.realpath(resources);} catch {return records;}
  async function visit(directory,depth=0){
    if(depth>3)return;
    for(const entry of await fs.readdir(directory,{withFileTypes:true})){
      if(entry.isDirectory())await visit(path.join(directory,entry.name),depth+1);
      else if(entry.isFile()&&entry.name==='SKILL.md'){
        const file=path.join(directory,entry.name),source=await fs.readFile(file,'utf8');
        const metadata=source.match(/^---\r?\n([\s\S]*?)\r?\n---/i)?.[1]||'';
        const field=name=>{
          const match=metadata.match(new RegExp('^'+name+':\\s*(.+)$','m'))?.[1]||'';
          if(match.startsWith('"'))try{return JSON.parse(match);}catch{}
          return match.replace(/^['"]|['"]$/g,'');
        };
        const id=path.relative(root,directory).split(path.sep).join('/');
        records.push({id,name:field('name')||path.basename(directory),description:field('description'),scope:id.includes('/')?id.split('/')[0]:'common',sha256:createHash('sha256').update(source).digest('hex'),bytes:Buffer.byteLength(source),source});
      }
    }
  }
  await visit(root);return records.sort((a,b)=>a.id.localeCompare(b.id));
}
const page=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>M0 原版技能资料</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f8fa;color:#292b34;font:14px -apple-system,BlinkMacSystemFont,sans-serif}header{padding:20px 28px;background:white;border-bottom:1px solid #e5e7eb;display:flex;gap:24px;align-items:center}a{color:#7354cf;text-decoration:none}main{padding:28px;max-width:1600px;margin:auto}h1{font-size:23px;margin:0 0 10px}p{color:#6a7080;line-height:1.7}.layout{display:grid;grid-template-columns:340px minmax(0,1fr);gap:20px}input,button{font:inherit;border:1px solid #e1deec;border-radius:8px;padding:11px;background:white;color:inherit}input{width:100%;margin-bottom:12px}#list{max-height:72vh;overflow:auto}.item{display:block;text-align:left;width:100%;margin:5px 0;cursor:pointer}.item[aria-current=true]{background:#f0ebfc;border-color:#b8a3e9}.item small{display:block;color:#8a8399;margin-top:5px}section{background:white;border:1px solid #e5e7eb;border-radius:12px;padding:22px;min-width:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 ui-monospace,SFMono-Regular,monospace;max-height:70vh;overflow:auto}#meta{font-size:12px;color:#84808d;overflow-wrap:anywhere}.bar{display:flex;justify-content:space-between;align-items:center;gap:16px}#download{cursor:pointer;color:#7454c7}@media(max-width:800px){.layout{grid-template-columns:1fr}#list{max-height:30vh}}</style><header><a href="/home">← M0 本地工作台</a><strong>原版技能资料</strong></header><main><h1>恢复的技能与工作流</h1><p>原安装包随附的技能原文，可检索、查看和导出。依赖 Figma 或企业工具的技能，需要相应工具接通后才能执行；此页不会自动运行它们。</p><div class="layout"><aside><input id="search" aria-label="搜索技能" placeholder="搜索名称、描述或目录"><div id="list"></div></aside><section><div class="bar"><strong id="name">选择一份技能</strong><button id="download" hidden>导出 Markdown</button></div><p id="description"></p><div id="meta"></div><pre id="source"></pre></section></div></main><script>
let items=[],selected;const list=document.getElementById('list');function render(){const query=document.getElementById('search').value.toLowerCase();list.replaceChildren();for(const item of items.filter(i=>(i.name+' '+i.description+' '+i.id).toLowerCase().includes(query))){const button=document.createElement('button');button.className='item';button.textContent=item.name;button.setAttribute('aria-current',String(item.id===selected?.id));const scope=document.createElement('small');scope.textContent=item.id;button.append(scope);button.onclick=()=>open(item);list.append(button)}}async function open(item){try{const r=await fetch('/__local/skills/source?id='+encodeURIComponent(item.id));const data=await r.json();if(!r.ok)throw Error(data.error);selected=data;document.getElementById('name').textContent=data.name;document.getElementById('description').textContent=data.description;document.getElementById('meta').textContent=data.id+' · '+data.bytes+' bytes · SHA256 '+data.sha256;document.getElementById('source').textContent=data.source;document.getElementById('download').hidden=false;render()}catch(e){document.getElementById('source').textContent=e.message}}document.getElementById('search').oninput=render;document.getElementById('download').onclick=()=>{if(!selected)return;const url=URL.createObjectURL(new Blob([selected.source],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=selected.name+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};fetch('/__local/skills/data').then(r=>r.json()).then(data=>{items=data.items;render();if(items.length)open(items[0])}).catch(e=>document.getElementById('source').textContent=e.message);
</script></html>`;

export async function handleSkills(req,res,url){
  if(!['/__local/skills','/__local/skills/data','/__local/skills/source'].includes(url.pathname))return false;
  const send=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));return true;};
  if(req.method!=='GET')return send({error:'Method not allowed'},405);
  if(url.pathname==='/__local/skills'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(page);return true;}
  const items=await catalog();
  if(url.pathname.endsWith('/data'))return send({items:items.map(({source,...item})=>item),total:items.length,origin:'recovered-bundled-skills',executionEnabled:false});
  const found=items.find(item=>item.id===url.searchParams.get('id'));
  return found?send(found):send({error:'Skill not found'},404);
}
