import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

// API prompt, not a UI graph. Images must be uploaded to ComfyUI first.
export function buildWorkflow({ template = 'astrix-template.png', portrait = 'astrix-person.png', prompt = '以图1为完整海报模板，用图2人物替换图1人物。保留图2人物身份、发型和服装，自然融合光影。不新增道具，保持背景、Logo、标题、布局及所有文字不变。', seed = 1, megapixels = 1 } = {}) {
  const n = (class_type, inputs) => ({ class_type, inputs })
  return {
    '1': n('LoadImage', { image: template }),
    '2': n('LoadImage', { image: portrait }),
    '3': n('UNETLoader', { unet_name: 'qwen_image_edit_2511_bf16.safetensors', weight_dtype: 'default' }),
    '4': n('CLIPLoader', { clip_name: 'qwen_2.5_vl_7b.safetensors', type: 'qwen_image', device: 'cpu' }),
    '5': n('VAELoader', { vae_name: 'qwen_image_vae.safetensors' }),
    '6': n('LoraLoaderModelOnly', { model: ['3', 0], lora_name: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors', strength_model: 1 }),
    '7': n('ModelSamplingAuraFlow', { model: ['6', 0], shift: 3 }),
    '8': n('CFGNorm', { model: ['7', 0], strength: 1, pre_cfg: false }),
    '9': n('ImageScaleToTotalPixels', { image: ['1', 0], upscale_method: 'lanczos', megapixels, resolution_steps: 16 }),
    '10': n('ImageScaleToTotalPixels', { image: ['2', 0], upscale_method: 'lanczos', megapixels, resolution_steps: 16 }),
    '11': n('TextEncodeQwenImageEditPlus', { clip: ['4', 0], vae: ['5', 0], image1: ['9', 0], image2: ['10', 0], prompt }),
    '12': n('TextEncodeQwenImageEditPlus', { clip: ['4', 0], vae: ['5', 0], image1: ['9', 0], image2: ['10', 0], prompt: '' }),
    '13': n('FluxKontextMultiReferenceLatentMethod', { conditioning: ['11', 0], reference_latents_method: 'index_timestep_zero' }),
    '14': n('FluxKontextMultiReferenceLatentMethod', { conditioning: ['12', 0], reference_latents_method: 'index_timestep_zero' }),
    '15': n('VAEEncode', { pixels: ['9', 0], vae: ['5', 0] }),
    '16': n('KSampler', { model: ['8', 0], positive: ['13', 0], negative: ['14', 0], latent_image: ['15', 0], seed, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }),
    '17': n('VAEDecode', { samples: ['16', 0], vae: ['5', 0] }),
    '18': n('SaveImage', { images: ['17', 0], filename_prefix: 'Astrix/Qwen-assist' }),
  }
}

export function checkWorkflow(workflow, objects, { skipImages = false } = {}) {
  const errors = []
  for (const [id, node] of Object.entries(workflow)) {
    const schema = objects[node.class_type]
    if (!schema) { errors.push(`${id}: 缺少节点 ${node.class_type}`); continue }
    const required = schema.input?.required ?? {}
    const fields = { ...required, ...schema.input?.optional }
    for (const name of Object.keys(required)) if (!(name in node.inputs)) errors.push(`${id}: 缺少输入 ${name}`)
    for (const [name, value] of Object.entries(node.inputs)) {
      const field = fields[name]
      if (!field) { errors.push(`${id}: 未知输入 ${name}`); continue }
      if (Array.isArray(value)) {
        const upstream = workflow[value[0]]
        const type = upstream && objects[upstream.class_type]?.output?.[value[1]]
        if (!type || (field[0] !== '*' && type !== field[0])) errors.push(`${id}.${name}: 无效连线 ${JSON.stringify(value)}`)
      } else {
        if (skipImages && node.class_type === 'LoadImage') continue
        const options = Array.isArray(field[0]) ? field[0] : field[0] === 'COMBO' ? field[1]?.options : undefined
        if (options && !options.includes(value)) errors.push(`${id}.${name}: 不可用 ${value}`)
      }
    }
  }
  return errors
}

async function main() {
  const [command = 'check', file] = process.argv.slice(2)
  if (command === 'export') {
    if (!file) throw new Error('用法: node qwen-poster.mjs export 输出.json')
    await writeFile(file, JSON.stringify(buildWorkflow(), null, 2) + '\n')
    console.log(`已导出 ${file}；尚未生成图片。`)
    return
  }
  if (command !== 'check') throw new Error('仅支持 check / export；本脚本不会自动提交生成。')
  const objects = file ? JSON.parse(await readFile(file, 'utf8')) : await fetch('http://127.0.0.1:8188/object_info', { signal: AbortSignal.timeout(10000) }).then(r => { if (!r.ok) throw new Error(`ComfyUI HTTP ${r.status}`); return r.json() })
  const errors = checkWorkflow(buildWorkflow(), objects, { skipImages: true })
  console.log(errors.length ? errors.join('\n') : '节点、参数、连线和模型名称检查通过。仍需上传两张图片并实际试跑。')
  process.exitCode = errors.length ? 1 : 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1 })
