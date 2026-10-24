import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import layoutConfig from '../../../packages/astrix-workbench/layout.cjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const recovery = path.join(layoutConfig.getLayout().recoveryRoot,'web-assets');
const sha = data => createHash('sha256').update(data).digest('hex');
const sources = {
  krn: { path: 'additional-static/bs3-hb1.corp.kuaishou.com/upload-lux-portal/m0-plugin-files/id_1/plugin.js', sha256: '96c5032ee091b4ca488b421fdfbdc9670f84dc96e4a26500c37fb1920f427768' },
  theme: { path: 'additional-static/bs3-hb1.corp.kuaishou.com/upload-lux-portal/m0-plugin-files/id_4/plugin.js', sha256: 'df2ec6602e00623d4b5951c55f51cfaeae7b684ef6027cce29873283ca26d840' },
};
const target = path.join(here, 'recovered');
await mkdir(target, { recursive: true });
const manifest = { format: 'm0-local-recovered-generators-v1', sources: {}, adapters: [] };
function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`${label}: expected one exact source match`);
  return source.replace(before, after);
}
for (const [kind, info] of Object.entries(sources)) {
  const bytes = await readFile(path.join(recovery, info.path));
  if (sha(bytes) !== info.sha256) throw new Error(`${kind}: recovered source digest changed`);
  let text = bytes.toString('utf8');
  if (kind === 'krn') {
    const start = text.indexOf('// src/utils/snack.ts');
    const end = text.indexOf('// src/utils/listenerManager.ts', start);
    if (start < 0 || end <= start) throw new Error('KRN Snack side-effect block not found');
    text = text.slice(0, start) + '// Local adapter: corporate Snack initialization is intentionally absent.\nvar snack={updateDependencies(){}};\n\n' + text.slice(end);
    text = replaceOnce(text, '  registryListeners();', '  // Local adapter: preview event registration is disabled.', 'KRN preview listeners');
    manifest.adapters.push('KRN: remove the original Snack module initialization and setOnline(true); skip preview event registration. Keep transformM0Node/generateKRN/toDSLWithSchema unchanged.');
  }
  text = replaceOnce(text, 'export {\n  src_default as default\n};', `globalThis.__M0_${kind.toUpperCase()}_PLUGIN__=src_default;`, `${kind} VM export`);
  const output = `${kind}.bundle.js`;
  await writeFile(path.join(target, output), text);
  manifest.sources[kind] = { recoveredPath: info.path, sourceSha256: info.sha256, output, outputSha256: sha(text), bytes: Buffer.byteLength(text) };
}

// Recover the original pure gradient math plus its local helper dependencies.
// This exact contiguous source section contains no imports, DOM or network.
const corePath = 'cache-recovered/by-host/s2-12205.kwimgs.com/kos/proj-gis/Z2lz/kos/nlav12205/workbench/assets/index-iLbwEgQT.js';
const coreBytes = await readFile(path.join(recovery, corePath));
if (sha(coreBytes) !== '54161baf0e6b4e3d90d9cd5c9a9c2eded0a1c2e85a9b773d379c68eddebf9698') throw new Error('Original gradient source digest changed');
const core = coreBytes.toString('utf8');
const start = core.indexOf('matrix3x3MultiplyVector3x1=');
const end = core.indexOf(',PointsDistance2D=', start);
if (start < 0 || end <= start || !core.slice(start, end).includes('linearGradientTransform2ReactNative=')) throw new Error('Original pure gradient helpers not found');
const gradient = 'const ' + core.slice(start, end) + ';\nglobalThis.__M0_GRADIENTS__=(values)=>values.filter(value=>value.type==="GRADIENT_LINEAR").map(value=>linearGradientTransform2ReactNative(value.gradientTransform,value.gradientStops));\n';
await writeFile(path.join(target, 'gradients.js'), gradient);
manifest.sources.gradients = { recoveredPath: corePath, sourceSha256: sha(coreBytes), startOffset: start, endOffset: end, output: 'gradients.js', outputSha256: sha(gradient), bytes: Buffer.byteLength(gradient) };
manifest.adapters.push('Gradients: extract the original linear-gradient math and expose the original ToDslTools linear-gradient mapping inside the VM.');
await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Prepared isolated original KRN/theme generators and original gradient helpers.');
