(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const examples = {
    krn: { nodeTree:{id:'local-root',nodeType:'view',name:'LocalCard',uniqueStyleName:'localCard',styles:{width:'320px',height:'180px',padding:'24px',backgroundColor:'#ffffff',borderRadius:'16px'},props:[],children:[{id:'local-title',nodeType:'text',name:'Title',uniqueStyleName:'title',characters:'本地恢复的原 KRN 引擎',styles:{fontSize:'20px',fontWeight:'600',color:'#222222'},props:[],children:[]}]},imageMap:{} },
    theme: { styles:{primary:'#165dff',background:'#ffffff'},variables:{spacing:8,radius:12},variableCollection:[{name:'Local theme'}] },
  };
  let result = null, busy = false;
  const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
  function controls() {
    $('generate').disabled = busy;
    for (const id of ['copy','download','bundle','import']) $(id).disabled = busy || !result?.files?.length;
    $('files').disabled = busy || !result?.files?.length;
  }
  function showFile() { $('output').value = result?.files[Number($('files').value)]?.content || ''; }
  function example() {
    $('input').value = JSON.stringify(examples[$('kind').value], null, 2);
    $('input-hint').textContent = $('kind').value === 'krn'
      ? '需要包含 nodeTree 的 设计 Schema；支持 view、text、image、component 与线性渐变。Figma REST 原始文件需先转为 设计 Schema。'
      : '输入 styles、variables、variableCollection，生成三个 JSON 文件。当前不导出 Figma imageNodes。';
    result = null; $('output').value = ''; $('files').replaceChildren(new Option('尚未生成','')); status(''); controls();
  }
  const download = (name, content, type = 'text/plain;charset=utf-8') => {
    const href = URL.createObjectURL(new Blob([content], {type})); const link = document.createElement('a'); link.href = href; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(href),1000);
  };
  async function request(url, body) {
    const response = await fetch(url, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok || value.error) throw new Error(value.error?.message || value.error || `HTTP ${response.status}`);
    return value;
  }
  $('generate').onclick = async () => {
    busy = true; controls(); status('正在使用恢复的原插件生成…');
    try {
      const kind = $('kind').value; const input = JSON.parse($('input').value);
      result = await request(`/__local/generate/${kind}`, {[kind === 'krn' ? 'schema' : 'theme']:input});
      if (!Array.isArray(result.files) || !result.files.length) throw new Error('生成器没有返回文件。');
      $('files').replaceChildren(...result.files.map((file,index) => new Option(file.path,String(index)))); showFile();
      $('output-hint').textContent = result.notes?.join(' ') || '已使用恢复的原插件生成文件。';
      $('provenance').textContent = `引擎：${result.engine} · 原始插件 SHA-256：${result.sourceSha256}`;
      status(`已生成 ${result.files.length} 个文件。可下载，或导入当前工作区。`);
    } catch(error) { result = null; status(error.message,true); }
    finally { busy = false; controls(); }
  };
  $('files').onchange = showFile;
  $('example').onclick = example; $('kind').onchange = example;
  $('choose').onclick = () => $('file').click();
  $('file').onchange = async () => {
    const file = $('file').files[0]; if (!file) return;
    try { if (file.size > 3 * 1024 * 1024) throw new Error('请选择 3 MB 以内的 JSON 文件。'); const value = JSON.parse(await file.text()); $('input').value = JSON.stringify(value,null,2); status(`已载入 ${file.name}`); }
    catch(error) { status(error.message,true); }
    $('file').value = '';
  };
  $('copy').onclick = () => navigator.clipboard.writeText($('output').value).then(() => status('已复制当前文件。')).catch(error => status(error.message,true));
  $('download').onclick = () => { const file = result.files[Number($('files').value)]; download(file.path,file.content); };
  $('bundle').onclick = () => download('astrix-generated-files.json',JSON.stringify({format:'m0-local-text-project-v1',engine:result.engine,sourceSha256:result.sourceSha256,files:result.files},null,2),'application/json');
  $('import').onclick = async () => {
    busy = true; controls(); status('正在导入当前工作区…');
    try { const value = await request('/__local/project/import',{files:result.files}); status(`已导入 ${value.files?.length || result.files.length} 个文件。点击“查看工作区”或返回工作台查看。`); }
    catch(error) { status(error.message,true); }
    finally { busy = false; controls(); }
  };
  example();
})();
