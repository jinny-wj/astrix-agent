// Local prototype playback. It contains only exported SVG and navigation;
// the exported HTML has no connection to the application or project APIs.
import * as canvasModel from '../canvas/model.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const PROTOTYPE_CSP="sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function renderPrototype(input,{title,startId}={}){
  const document=canvasModel.getResolvedDocument?canvasModel.getResolvedDocument(input):canvasModel.validateDocument(input);
  const pages=document.pages||[{id:'page-legacy',name:'Page 1',nodes:document.nodes}],screens=[];
  const walk=(nodes,visit,offset={x:0,y:0})=>{for(const node of nodes){if(node.hidden)continue;const position={x:offset.x+node.x,y:offset.y+node.y};visit(node,position);walk(node.children||[],visit,position);}};
  for(const page of pages){
    walk(page.nodes,node=>{if(node.type==='frame')screens.push({id:node.id,name:node.name,pageId:page.id,pageName:page.name,width:node.width,height:node.height,root:{...node,x:0,y:0}});});
    if(!screens.some(screen=>screen.pageId===page.id)&&page.nodes.some(node=>!node.hidden)){
      const bounds=canvasModel.documentBounds(document,{pageId:page.id});
      screens.push({id:'page-'+page.id,name:page.name,pageName:page.name,width:bounds.width,height:bounds.height,root:{...canvasModel.createNode('frame'),id:'preview-'+page.id,name:page.name,x:0,y:0,width:bounds.width,height:bounds.height,fill:'none',children:page.nodes.map(node=>({...node,x:node.x-bounds.x,y:node.y-bounds.y}))}});
    }
  }
  const byId=new Map(screens.map((screen,index)=>[screen.id,index]));
  const initial=byId.get(startId)??0;
  const exported=screens.map((screen,index)=>{
    const svg=canvasModel.documentToSVG({format:canvasModel.FORMAT,version:1,name:screen.name,nodes:[screen.root]});
    const hotspots=[];
    walk([screen.root],(node,position)=>{
      const target=byId.get(node.prototype?.targetId);
      if(target===undefined||node.prototype?.trigger!=='click')return;
      hotspots.push(`<a class="hotspot" href="#screen-${target}" data-target="${target}" data-node-id="${escape(node.id)}" aria-label="${escape(node.name)}：跳转到 ${escape(screens[target].name)}" style="left:${position.x}px;top:${position.y}px;width:${node.width}px;height:${node.height}px"></a>`);
    });
    return `<section class="screen" id="screen-${index}" data-index="${index}" data-width="${screen.width}" data-height="${screen.height}" aria-label="${escape(screen.name)}"${index!==initial?' hidden':''}><div class="surface" style="width:${screen.width}px;height:${screen.height}px">${svg}${hotspots.join('')}</div></section>`;
  }).join('');
  const options=screens.map((screen,index)=>`<option value="${index}"${index===initial?' selected':''}>${escape(screen.pageName)} / ${escape(screen.name)}</option>`).join('');
  const name=title||document.name||'本地设计原型';
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(PROTOTYPE_CSP.replace('sandbox allow-scripts; ',''))}"><title>${escape(name)} · 原型演示</title><style>
*{box-sizing:border-box}body{margin:0;background:#202124;color:#f5f5f6;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{height:60px;padding:10px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #37383c;background:#292a2d}header strong{max-width:30vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}button,select{font:inherit;color:inherit;background:#3a3b40;border:1px solid #55565e;border-radius:6px;padding:7px 10px}button{cursor:pointer}button:disabled{opacity:.35;cursor:default}select{max-width:40vw}#position{margin-left:auto;white-space:nowrap;color:#b8b9c0}main{position:relative;height:calc(100vh - 96px);overflow:hidden}.screen{position:absolute;inset:0;overflow:hidden}.surface{position:absolute;transform-origin:0 0;box-shadow:0 12px 60px #0006;background:white}.surface>svg{display:block;width:100%;height:100%}.hotspot{position:absolute;display:block;cursor:pointer;background:transparent}.hotspot:focus-visible{outline:3px solid #7c8cff;outline-offset:-3px}body.hints .hotspot{background:#675aff35;outline:1px solid #a394ff}footer{height:36px;text-align:center;color:#aaaab2;font-size:12px;padding:10px}#empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;line-height:2;color:#babac3}#empty[hidden],.screen[hidden]{display:none}#reset{white-space:nowrap}@media(max-width:600px){header{padding:8px;gap:6px}header strong{display:none}select{max-width:48vw}#position{font-size:11px}footer{font-size:10px}}
</style><header><strong>${escape(name)}</strong><button id="back" aria-label="返回上一画板" disabled>←</button><select id="screens" aria-label="演示画板">${options}</select><button id="reset">重新开始</button><button id="hints" aria-pressed="false">热点</button><span id="position">${screens.length?initial+1:0} / ${screens.length}</span></header><main>${exported}<div id="empty"${screens.length?' hidden':''}>还没有可演示的画板<br>在设计画布中创建 Frame，再设置图层的点击跳转。</div></main><footer>本地原型 · 点击热点跳转 · Esc 返回 · 此文件可离线打开</footer><script>
(()=>{'use strict';const screens=[...document.querySelectorAll('.screen')],select=document.querySelector('#screens'),back=document.querySelector('#back'),position=document.querySelector('#position'),trail=[];let current=${initial};
function fit(){const screen=screens[current];if(!screen)return;const area=screen.parentElement.getBoundingClientRect(),width=Number(screen.dataset.width),height=Number(screen.dataset.height),scale=Math.max(.001,Math.min((area.width-40)/width,(area.height-40)/height,1.5)),surface=screen.querySelector('.surface');surface.style.transform='translate('+Math.max(0,(area.width-width*scale)/2)+'px,'+Math.max(0,(area.height-height*scale)/2)+'px) scale('+scale+')';}
function show(index,push=true){if(!Number.isInteger(index)||!screens[index])return;if(push&&index!==current)trail.push(current);current=index;screens.forEach((screen,i)=>screen.hidden=i!==index);select.value=String(index);position.textContent=(index+1)+' / '+screens.length;back.disabled=!trail.length;fit();}
document.addEventListener('click',event=>{const link=event.target.closest('a[data-target]');if(link){event.preventDefault();show(Number(link.dataset.target));}});select.addEventListener('change',()=>show(Number(select.value)));back.onclick=()=>{if(trail.length)show(trail.pop(),false);};document.querySelector('#reset').onclick=()=>{trail.length=0;show(${initial},false);};document.querySelector('#hints').onclick=event=>{const active=document.body.classList.toggle('hints');event.currentTarget.setAttribute('aria-pressed',String(active));};document.addEventListener('keydown',event=>{if(event.key==='Escape')back.click();});addEventListener('resize',fit);fit();
})();
</script></html>`;
}
