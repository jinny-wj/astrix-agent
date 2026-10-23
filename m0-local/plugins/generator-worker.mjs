import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const directory = new URL('./recovered/', import.meta.url);
const sha = text => createHash('sha256').update(text).digest('hex');
const deny = name => () => { throw new Error(`本地生成器禁止网络/外部操作：${name}`); };

function validateInput(kind, input) {
  const serialized = JSON.stringify(input);
  if (!serialized || Buffer.byteLength(serialized) > 3 * 1024 * 1024) throw new Error('输入必须是 3 MB 以内的 JSON。');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('输入必须是 JSON 对象。');
  if (kind === 'theme') {
    if (input.imageNodes?.length) throw new Error('主题图片导出需要真实 Figma 节点。请移除 imageNodes，当前支持离线导出样式与变量 JSON。');
    return { styles: input.styles ?? {}, variables: input.variables ?? {}, variableCollection: input.variableCollection ?? [] };
  }
  if (!input.nodeTree || typeof input.nodeTree !== 'object') throw new Error('M0Schema 必须包含 nodeTree；Figma REST 原始节点 JSON 需要先转成 M0Schema。');
  let count = 0;
  const visit = (node, depth) => {
    if (++count > 5000 || depth > 80) throw new Error('节点树超过 5000 个节点或 80 层。');
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('nodeTree.children 必须是节点对象数组。');
    if (!['view', 'text', 'image', 'component'].includes(node.nodeType)) throw new Error(`原 KRN 插件不支持此 nodeType：${String(node.nodeType)}`);
    if (typeof node.id !== 'string' || !node.id) throw new Error('每个节点需要非空字符串 id。');
    if (!node.styles || typeof node.styles !== 'object' || Array.isArray(node.styles)) throw new Error(`节点 ${node.id} 缺少 styles 对象。`);
    if (node.styles.gradient?.some(item => item.type !== 'GRADIENT_LINEAR')) throw new Error('原 KRN 插件的 RN 转换仅支持线性渐变。');
    if (node.children && !Array.isArray(node.children)) throw new Error('children 必须是数组。');
    node.children?.forEach(child => visit(child, depth + 1));
  };
  visit(input.nodeTree, 0);
  return input;
}

try {
  const {kind} = workerData;
  if (!['krn', 'theme'].includes(kind)) throw new Error('未知生成器。');
  const input = validateInput(kind, workerData.input);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  const entry = manifest.sources[kind];
  const source = await readFile(new URL(entry.output, directory), 'utf8');
  if (sha(source) !== entry.outputSha256) throw new Error('本地恢复插件校验失败，请重新准备插件。');
  const sandbox = {
    console: Object.freeze({ log(){}, warn(){}, error(){}, info(){}, debug(){} }),
    fetch: deny('fetch'), WebSocket: deny('WebSocket'), XMLHttpRequest: deny('XMLHttpRequest'),
    setTimeout: deny('setTimeout'), setInterval: deny('setInterval'),
    clearTimeout(){}, clearInterval(){},
  };
  const context = vm.createContext(sandbox, { name: 'M0 recovered pure generator' });
  new vm.Script('globalThis.window=globalThis;globalThis.self=globalThis;globalThis.navigator={userAgent:"M0 local generator"};globalThis.process={env:{}};globalThis.m0={themePluginEvent:{on(){return()=>{}}},tools:{}};').runInContext(context);
  if (kind === 'krn') {
    const entry = manifest.sources.gradients;
    const helpers = await readFile(new URL(entry.output, directory), 'utf8');
    if (sha(helpers) !== entry.outputSha256) throw new Error('原渐变工具校验失败。');
    new vm.Script(helpers).runInContext(context, { timeout: 3000 });
    new vm.Script('m0.tools.gradients2RNStyle=__M0_GRADIENTS__;').runInContext(context);
  }
  new vm.Script(source, { filename: `recovered-${kind}.bundle.js` }).runInContext(context, { timeout: 12000 });
  // Only JSON data enters the context. No generated code is ever executed.
  const call = kind === 'krn' ? '__M0_KRN_PLUGIN__.toDSLWithSchema' : '__M0_THEME_PLUGIN__.generateThemeFile';
  new vm.Script(`globalThis.__M0_RESULT__=${call}(JSON.parse(${JSON.stringify(JSON.stringify(input))}));`).runInContext(context, { timeout: 10000 });
  const value = await sandbox.__M0_RESULT__;
  const originalFiles = kind === 'krn' ? value : value.code;
  const files = originalFiles.map(file => ({ path: file.fileName, content: file.data }));
  if (files.some(file => typeof file.content !== 'string')) throw new Error('原插件未返回有效的文件文本。');
  if (Buffer.byteLength(JSON.stringify(files)) > 4 * 1024 * 1024) throw new Error('生成文件超过 4 MB。');
  parentPort.postMessage({ result: {
    success: true, engine: `recovered-original-${kind}`, files,
    sourceSha256: entry.sourceSha256,
    offline: true,
    notes: kind === 'krn' ? ['输出为 KRN / React Native 源码。企业组件依赖需在目标工程中提供；原企业 Snack 预览没有启用。'] : ['导出原插件的三类样式/变量 JSON；未导出 Figma 图片。'],
  } });
} catch (error) {
  parentPort.postMessage({ error: error?.message || String(error) });
}
