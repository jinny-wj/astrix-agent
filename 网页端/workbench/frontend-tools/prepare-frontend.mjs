import { readFile, writeFile, mkdir, copyFile, readdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebrandWorkbench } from './branding.mjs';
import layoutConfig from '../../../packages/astrix-workbench/layout.cjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const layout=layoutConfig.getLayout();
const projectRoot = layout.webRoot;
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--source-root' || !args[1])) throw new Error('Usage: node workbench/frontend-tools/prepare-frontend.mjs [--source-root /path/to/M0-AI-recovered]');
const recoveryRoot=path.resolve(args[1]||process.env.ASTRIX_RECOVERY_ROOT||process.env.M0_RECOVERY_ROOT||layout.recoveryRoot);
const sourceRoot = path.join(recoveryRoot,'web-assets/cache-recovered');
const publicRoot = layout.publicRoot;
const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'manifest.json'), 'utf8'));
const resources = new Map();
let extraAssets = { assets: [] };
try { extraAssets = JSON.parse(await readFile(path.join(here, 'extra-assets/manifest.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

for (const entry of manifest.entries) {
  if (!entry.path?.startsWith('by-host/') || !entry.source_url) continue;
  const url = new URL(entry.source_url);
  // Only public static responses are in the recovery manifest. The two access
  // proxy scripts are browser fingerprinting/watermark code and are not needed.
  if (url.pathname.startsWith('/accessproxy_statics/')) continue;
  const relative = path.posix.join('vendor', url.hostname, decodeURIComponent(url.pathname));
  if (relative.includes('../') || !relative.startsWith('vendor/')) throw new Error('Unsafe recovered asset path');
  resources.set(entry.source_url, { entry, local: '/' + relative });
}

const replacements = [...resources.entries(), ...extraAssets.assets.map(item => [item.url, { local: item.local }])].sort(([a], [b]) => b.length - a.length);
const scrubCounts = {};
const patches = [];
function localEditorRender(open, block, node, figmaNotice = false) {
  const prefix = figmaNotice ? 'Figma 尚未接入 · ' : '';
  const buttonStyle = 'font:12px -apple-system,sans-serif;border:1px solid #dce2eb;border-radius:5px;padding:4px 9px;color:#536174;background:#fff;cursor:pointer';
  const nativeButtons=[['openTerminal','终端'],['showExtensions','扩展市场'],['installVSIX','安装 VSIX']].map(([method,label])=>`...(typeof window.m0LocalDesktop?.nativeEditor?.${method}==="function"?[${node}("button",{type:"button","data-m0-native-editor-action":"${method}",style:${JSON.stringify(buttonStyle)}},"${label}")]:[]),`).join('');
  return `return()=>(${open}(),${block}("section",{class:"m0-local-editor-shell",style:"width:100%;height:100%;min-height:0;display:flex;flex-direction:column;background:#fff"},[${node}("div",{style:"flex:none;display:flex;align-items:center;gap:7px;padding:7px 12px;border-bottom:1px solid #e5e6eb;background:#f7f8fa;color:#697180;font:12px -apple-system,sans-serif"},[${node}("span",{"data-m0-native-editor-label":"",style:"flex:1"},window.__M0_NATIVE_EDITOR_AVAILABLE__?${JSON.stringify(prefix + '原版 KSCode · 终端与扩展未启用')}:${JSON.stringify(prefix + '本地文件编辑器')}),${node}("button",{type:"button","data-m0-editor-action":"code",style:${JSON.stringify(buttonStyle)}},"代码"),${node}("button",{type:"button","data-m0-editor-action":"preview",style:${JSON.stringify(buttonStyle)}},"预览"),${nativeButtons}${node}("a",{href:"/codegen.html",target:"_blank",style:"color:#536174;text-decoration:none;margin-left:4px"},"代码工具")]),${node}("div",{"data-m0-editor-content":"",style:"position:relative;width:100%;flex:1;min-height:0"},window.__M0_NATIVE_EDITOR_AVAILABLE__?[${node}("div",{"data-m0-native-editor-host":"",style:"width:100%;height:100%;min-height:0"})]:[${node}("iframe",{class:"m0-local-editor-frame",src:"/__local/editor?embedded=1",title:"本地文件编辑器",style:"width:100%;height:100%;border:0;display:block;background:#fff"})])]));`;
}
function localCanvasRender(open,block,node) {
  return `return()=>(${open}(),${block}("iframe",{"data-m0-figma-workspace-frame":"",src:"/figma-workspace.html"+(new URLSearchParams(location.search).get("id")?"?projectId="+encodeURIComponent(new URLSearchParams(location.search).get("id")):""),title:"真实 Figma 工作区",style:"width:100%;height:100%;min-height:0;border:0;display:block;background:#f6f7fb"}));`;
}
function rewrite(text, name) {
  for (const [url, resource] of replacements) {
    text = text.replaceAll(url, resource.local).replaceAll(url.replace(/^https?:/, ''), resource.local);
  }
  // Also handle bundled CDN directory bases (e.g. Vite's generated worker URLs).
  text = text.replaceAll('https://s2-12205.kwimgs.com/kos/proj-gis/Z2lz/kos/nlav12205/workbench/',
    '/vendor/s2-12205.kwimgs.com/kos/proj-gis/Z2lz/kos/nlav12205/workbench/');
  text = text.replaceAll('//s2-12205.kwimgs.com/kos/proj-gis/Z2lz/kos/nlav12205/workbench/',
    '/vendor/s2-12205.kwimgs.com/kos/proj-gis/Z2lz/kos/nlav12205/workbench/');
  let scrubbed = 0;
  const redact = (_match, prefix, _value, suffix) => { scrubbed++; return prefix + '' + suffix; };
  // Recovered bundles contain obsolete embedded service credentials. Never
  // carry those into the runnable project. Keep syntax and property keys.
  text = text.replace(/((?:Authorization|authorization)\s*:\s*["'])([^"']{8,})(["'])/g, redact);
  text = text.replace(/((?:secretKey|secret_key|clientSecret|client_secret|apiKey|api_key|accessToken|access_token)\s*:\s*["'])([^"']{12,})(["'])/g, redact);
  text = text.replace(/(SECRET_KEY\s*=\s*\{[^}]*?prod\s*:\s*["'])([^"']+)(["'])/g, redact);
  text = text.replace(/(["'])(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,})(["'])/g,
    (_match, prefix, suffix) => { scrubbed++; return prefix + suffix; });
  // This recovered vendor used a short local binding for its old image-search
  // credential rather than a named credential property. Keep the service inert.
  text=text.replace(/(const\s+[A-Za-z_$][\w$]*=)(["'])[A-Za-z0-9_-]{40,}\2(,[A-Za-z_$][\w$]*=`https:\/\/api\.pexels\.com\/v1\/search)/g,(_match,prefix,quote,suffix)=>{scrubbed++;return prefix+quote+quote+suffix;});
  if (scrubbed) scrubCounts[name] = scrubbed;
  if (name.endsWith('/assets/index-iLbwEgQT.js')) {
    const oldRoute = 'path:"/",redirect:()=>isInElectron(window)?"/aicode":"/welcome"';
    if (!text.includes(oldRoute)) throw new Error('Recovered root route changed; review the localhost home patch');
    text = text.replace(oldRoute, 'path:"/",redirect:()=>"/home"');
    patches.push({ file: name, purpose: 'Open the recovered workbench at localhost root without activating the unreconstructed Electron branches.', matchCount: 1 });
    const pluginInitGuard = 'if(window.__M0_LOCAL_RUNTIME__&&!Object.keys(window.__M0_LOCAL_PLUGINS__||{}).length){this.isLoading=!1;this.isError=!0;this.errorMsg="本地恢复版未接入远程插件";return}';
    for (const signature of ['async init(){await this.fetchPluginList();const h_=', 'init(){this.fetchPluginList().then(()=>{const h_=']) {
      if (!text.includes(signature)) throw new Error('Recovered plugin init changed; review the local registry guard');
      text = text.replace(signature, signature.replace('init(){', 'init(){' + pluginInitGuard));
    }
    const loader = 'async function loadRemotePlugin(h_){';
    if (!text.includes(loader)) throw new Error('Recovered plugin loader changed; review local-only plugin import');
    text = text.replace(loader, loader + 'if(window.__M0_LOCAL_RUNTIME__){const local=window.__M0_LOCAL_PLUGINS__?.[h_];if(!local||new URL(local,location.href).origin!==location.origin){window.alert("本地恢复版未接入该远程插件");throw new Error("本地恢复版未接入该远程插件")}const module=await import(local);return{id:h_,file:{implement:module?.default,plugin:module}}}');
    patches.push({ file: name, purpose: 'Skip automatic corporate plugin loading when the local registry is empty; explicit plugin imports require a same-origin registry entry.', matchCount: 3 });
    const demos = 'const h_=[genProjectRecord(),genProjectRecordV2()]';
    if (!text.includes(demos)) throw new Error('Recovered demo initialization changed');
    text = text.replace(demos, 'const h_=window.__M0_LOCAL_RUNTIME__?[]:[genProjectRecord(),genProjectRecordV2()]');
    const demoFallback = ':[genProjectRecord(),genProjectRecordV2()]}},getters:';
    if (!text.includes(demoFallback)) throw new Error('Recovered demo fallback changed');
    text = text.replace(demoFallback, ':(window.__M0_LOCAL_RUNTIME__?[]:[genProjectRecord(),genProjectRecordV2()])}},getters:');
    patches.push({ file: name, purpose: 'Do not seed the independent local project list with the original embedded cloud Figma demos.', matchCount: 2 });
  }
  if (name.endsWith('/assets/home-Dq22ywRR.js')) {
    let count = 0;
    text = text.replace(/\b(clearCreateMaterialSkillIconFile|clearEditSkillIconFile)\(\)/g,
      (_match, fn) => { count++; return `(typeof ${fn}==="function"&&${fn}())`; });
    if (count !== 4) throw new Error('Recovered material-icon cleanup changed; expected four optional cleanup calls');
    patches.push({ file: name, purpose: 'Guard four calls to absent optional material/skill icon cleanup functions so leaving home does not throw.', matchCount: count });
    // This warning belongs to the old corporate background-canvas login flow.
    // Keep its authorization failure truthful; offer the explicit local flow.
    const warning='(openBlock(),createBlock(be,{key:0,status:"warning",subtitle:unref(te)},{extra:withCtx(()=>[createVNode(ce,{type:"primary",onClick:unref(V)},{default:withCtx(()=>[...s[127]||(s[127]=[createTextVNode("重新获取",-1)])]),_:1},8,["onClick"])]),_:1},8,["subtitle"]))';
    const warningMatch='!unref(T)&&unref(te)?'+warning;
    if(text.split(warningMatch).length!==2)throw new Error('Recovered Figma home warning changed');
    const entry='(openBlock(),createElementBlock("section",{key:0,"data-m0-local-figma-entry":"",style:"padding:24px;text-align:center;color:#697180"},[createBaseVNode("strong",{style:"display:block;font-size:16px;color:#394559"},"选择项目后连接真实 Figma"),createBaseVNode("p",null,"在本地项目的 Design 中打开官方 Figma，并配对目标文件的 Plugin Bridge。原企业后台列表未接入。"),createBaseVNode("button",{type:"button","data-m0-create-figma-project":"",style:"padding:8px 14px;border:0;border-radius:6px;background:#0d99ff;color:white;cursor:pointer"},"创建本地项目"),createBaseVNode("a",{href:"/__local/projects",style:"margin-left:16px;color:#435edf"},"选择已有项目"),createBaseVNode("a",{href:"/figma-workspace.html",style:"margin-left:16px;color:#435edf"},"打开真实 Figma 工作区")]))';
    text=text.replace(warningMatch,'!unref(T)&&unref(te)?(window.__M0_LOCAL_RUNTIME__&&unref(te)==="Figma 后台画布需要在桌面端使用")?'+entry+':'+warning);
    const manual=/createBaseVNode\("a",\{class:"workspace-manual-link",href:"https:\/\/docs\.corp\.kuaishou\.com\/[^"\s]+",target:"_blank",rel:"noopener noreferrer"\}," 资产库使用手册 ",-1\)/g;
    const manualMatches=[...text.matchAll(manual)];
    if(manualMatches.length!==1)throw new Error('Recovered asset-library help entry changed');
    text=text.replace(manual,'createCommentVNode("Local asset-library manual unavailable",!0)');
    patches.push({file:name,purpose:'Replace only the unsupported corporate background-Figma warning with explicit local project/Figma links; remove its retry and the unavailable corporate asset-library manual. Keep original SSO authorization unchanged.',matchCount:2});
  }
  if (name.endsWith('/assets/index-v2-BGt4TMzj.js')) {
    const editorComponent = 'Np=Ze({__name:"index",setup(n){';
    if (!text.includes(editorComponent)) throw new Error('Recovered code pane changed');
    text = text.replace(editorComponent, editorComponent + 'if(window.__M0_LOCAL_RUNTIME__)' + localEditorRender('c', 'y', 'o'));
    const localMode = 'j.value===Zn.Code||d.query.homeEntryMode==="code"&&d.query.autoOpenFigma!=="true"';
    const localModeCount = text.split(localMode).length - 1;
    if (localModeCount !== 2) throw new Error('Recovered channel selection changed');
    text = text.replaceAll(localMode, '(window.__M0_LOCAL_RUNTIME__&&localStorage.getItem("M0Mode")==="code")||' + localMode);
    const demoImport = 'e&&H.handleChangeCurFigma("SRpV5DSpKq0Pto75dP4IyO")';
    if (!text.includes(demoImport)) throw new Error('Recovered automatic Figma demo import changed');
    text = text.replace(demoImport, '!window.__M0_LOCAL_RUNTIME__&&' + demoImport);
    const canvasVisibility='rr=W(()=>{if(d.query.homeEntryId&&!st.value)';
    if(!text.includes(canvasVisibility))throw new Error('Recovered Design pane visibility changed');
    text=text.replace(canvasVisibility,'rr=W(()=>{if(window.__M0_LOCAL_RUNTIME__)return!0;if(d.query.homeEntryId&&!st.value)');
    patches.push({ file: name, purpose: 'Use the recovered native KSCode host with browser fallback in Code, honor persisted Code mode, skip cloud demos, and make the local Design pane available without a Figma file.', matchCount: 5 });
  }
  if (name.endsWith('/assets/resize-container-CWxcyYgS.js')) {
    const canvasComponent = 'Vk=Xt({__name:"canvas",props:{curFigmaInfo:{}},setup(e){';
    if (!text.includes(canvasComponent)) throw new Error('Recovered Figma canvas pane changed');
    const localCanvas = 'if(window.__M0_LOCAL_RUNTIME__)' + localCanvasRender('v', '_', 'd');
    text = text.replace(canvasComponent, canvasComponent + localCanvas);
    const canvasHost='yI=Xt({__name:"index",setup(e){';
    if(!text.includes(canvasHost))throw new Error('Recovered Design host changed');
    text=text.replace(canvasHost,canvasHost+localCanvas);
    patches.push({ file: name, purpose: 'Mount the project-bound real Figma workspace. Its empty host is covered by an isolated desktop WebContentsView; browser users open Figma normally and connect the Plugin Bridge. Preserve Code and chat.', matchCount: 2 });
  }
  return rebrandWorkbench(text,name);
}

await mkdir(publicRoot, { recursive: true });
for (const { entry, local } of resources.values()) {
  const target = path.join(publicRoot, local.slice(1));
  await mkdir(path.dirname(target), { recursive: true });
  if (/\.(?:js|css|svg|html|json|map)$/i.test(entry.path)) {
    await writeFile(target, rewrite(await readFile(path.join(sourceRoot, entry.path), 'utf8'), local));
  } else await copyFile(path.join(sourceRoot, entry.path), target);
}
for (const item of extraAssets.assets) {
  const target = path.join(publicRoot, item.local.slice(1));
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(here, 'extra-assets', item.file), target);
}

let html = rewrite(await readFile(path.join(sourceRoot, 'html-shell/home.static-shell.html'), 'utf8'), 'index.html');
html = html.replace(/<!-- RECOVERED STATIC SHELL:[\s\S]*?-->/, '<!-- Recovered M0 UI, with an independently implemented localhost runtime. -->');
html = html.replace(/<script[^>]*src=["']\/accessproxy_statics\/[^"']+["'][^>]*><\/script>/g, '');
html = html.replace('<head>', '<head>\n  <script src="/local-runtime.js"></script>\n  <script src="/workflow-monitor.js" defer></script>');
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/,
  (_match, entry) => `<script type="module">await window.__m0LocalReady; await import(${JSON.stringify(entry)});</script>`);
html = html.replace(/<title>[^<]*<\/title>/, '<title>Astrix</title>');
html=html.replace(/(?:\/vendor\/[^"'\s<>]+\/)?m0-logo\.svg/g,'/branding/astrix-logo-v1.png');
html=html.replace(/alt=(["'])M0\1/g,'alt="Astrix"');
await writeFile(path.join(publicRoot, 'index.html'), html);
await mkdir(path.join(publicRoot,'branding'),{recursive:true});
await copyFile(path.join(here,'branding/astrix-logo-v1.png'),path.join(publicRoot,'branding/astrix-logo-v1.png'));
await copyFile(path.join(here,'branding/astrix-dock.png'),path.join(publicRoot,'branding/astrix-dock.png'));
await copyFile(path.join(here, 'local-runtime.js'), path.join(publicRoot, 'local-runtime.js'));
await copyFile(path.join(here, 'workflow-monitor.js'), path.join(publicRoot, 'workflow-monitor.js'));
await copyFile(path.join(here, 'local-codegen.html'), path.join(publicRoot, 'codegen.html'));
await copyFile(path.join(here, 'local-codegen.js'), path.join(publicRoot, 'codegen.js'));
for (const file of ['figma-workspace.html','figma-workspace.js','figma-workspace.css','figma-oauth-complete.html','figma-oauth-complete.js']) await copyFile(path.join(here,file),path.join(publicRoot,file));
await mkdir(path.join(publicRoot,'local-canvas'),{recursive:true});
for (const file of await readdir(path.join(projectRoot,'canvas'))) {
  if (['index.html','style.css','app.mjs','model.mjs'].includes(file) || /^(?:vector-|collab).*\.mjs$/.test(file) && !file.endsWith('.test.mjs'))
    await copyFile(path.join(projectRoot,'canvas',file),path.join(publicRoot,'local-canvas',file));
}
await cp(path.join(projectRoot,'canvas/vendor'),path.join(publicRoot,'local-canvas/vendor'),{recursive:true});
await writeFile(path.join(here, 'asset-map.json'), JSON.stringify({
  generatedBy: 'prepare-frontend.mjs',
  source: path.relative(projectRoot,path.join(recoveryRoot,'web-assets/cache-recovered')).split(path.sep).join('/'),
  entry: resources.get('https://s2-12205.kwimgs.com/kos/proj-gis/Z2lz/kos/nlav12205/workbench/assets/index-8tYpB-jE.js')?.local,
  assets: [...resources].map(([url, { local }]) => ({ url, local })),
  credentialLiteralsRemoved: scrubCounts,
  patches,
  extraAssets: extraAssets.assets.map(({url,local,sha256,size}) => ({url,local,sha256,size})),
}, null, 2) + '\n');
console.log(`Prepared ${resources.size} recovered static resources and the local runtime.`);
console.log(`Removed ${Object.values(scrubCounts).reduce((sum, n) => sum + n, 0)} embedded credential literals.`);
