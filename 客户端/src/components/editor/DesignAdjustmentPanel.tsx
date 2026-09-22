import { useState } from 'react'

export type AdjustmentTab = 'image' | 'resource' | 'h5'
const TITLES = { image: '图片调整', resource: '资源位尺寸', h5: 'H5 调整' }
const OPTIONS = {
  image: ['图片适应', '图片填充', '图片曝光', '图片对比度', '图片饱和度', '图片色温'],
  h5: ['字号', '行高', '圆角', '间距', '内边距', '上内边距', '下内边距', '左内边距', '右内边距'],
}
const PRESETS = [
  { label: '直播广场 banner', width: 584, height: 160 },
  { label: '直播封面', width: 720, height: 1280 },
  { label: '活动弹窗', width: 840, height: 1120 },
  { label: 'H5 首屏', width: 375, height: 812 },
]

export default function DesignAdjustmentPanel({ tab, layerCount, onClose, onPrepare }: {
  tab: AdjustmentTab
  layerCount: number
  onClose: () => void
  onPrepare: (instruction: string) => void
}) {
  const [operation, setOperation] = useState(tab === 'image' ? '图片适应' : '字号')
  const [amount, setAmount] = useState('16')
  const [width, setWidth] = useState('584')
  const [height, setHeight] = useState('160')
  const imageMode = operation === '图片适应' || operation === '图片填充'
  const needsAmount = tab !== 'resource' && !imageMode
  const minimum = tab === 'image' ? -100 : operation === '字号' || operation === '行高' ? 1 : 0
  const maximum = tab === 'image' ? 100 : 10000
  const valid = tab === 'resource'
    ? [width, height].every(value => value.trim() && Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 100000)
    : !needsAmount || Boolean(amount.trim() && Number.isFinite(Number(amount)) && Number(amount) >= minimum && Number(amount) <= maximum)
  const instruction = tab === 'resource' ? `尺寸改为 ${width}×${height}` : imageMode ? operation : `${operation}设为 ${amount}${tab === 'image' ? '%' : 'px'}`
  const fieldClass = 'min-w-0 rounded-md border border-[#dedee3] bg-white px-2 py-1.5 text-[12px]'

  return <section className="mb-3 rounded-xl border border-[#e4e6ec] bg-[#f7f8fa] p-3" aria-label={TITLES[tab]}>
    <div className="mb-2 flex items-center justify-between gap-2 text-[12px]">
      <strong>{TITLES[tab]}</strong>
      <button type="button" onClick={onClose} aria-label="关闭调整面板">关闭</button>
    </div>
    <p className="mb-2 text-[11px] leading-5 text-[#777b86]">
      {layerCount ? `将对当前 ${layerCount} 个选中图层准备指令。` : '先在 Figma 中选中要调整的图层。'}
      {tab === 'image' ? '选择含图片填充的图层；调色值为绝对值，0% 表示中性。' : tab === 'resource' ? '调整当前画板尺寸，内容按原有约束变化；请检查裁切和文案。' : '字号和行高选文字，间距和内边距选自动布局容器。'}
    </p>
    {tab === 'resource' ? <div className="grid grid-cols-2 gap-2">
      <label className="col-span-2 grid gap-1 text-[11px]">常用规格
        <select className={fieldClass} value={PRESETS.findIndex(p => String(p.width) === width && String(p.height) === height)} onChange={event => {
          const preset = PRESETS[Number(event.target.value)]
          if (preset) { setWidth(String(preset.width)); setHeight(String(preset.height)) }
        }}>
          <option value={-1}>自定义尺寸</option>
          {PRESETS.map((preset, index) => <option key={preset.label} value={index}>{preset.label} · {preset.width}×{preset.height}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-[11px]">宽度（px）<input className={fieldClass} type="number" min={1} max={100000} value={width} onChange={event => setWidth(event.target.value)} /></label>
      <label className="grid gap-1 text-[11px]">高度（px）<input className={fieldClass} type="number" min={1} max={100000} value={height} onChange={event => setHeight(event.target.value)} /></label>
    </div> : <div className="grid grid-cols-2 gap-2">
      <label className="grid gap-1 text-[11px]">调整项目<select className={fieldClass} value={operation} onChange={event => { setOperation(event.target.value); setAmount(tab === 'image' ? '0' : '16') }}>
        {OPTIONS[tab].map(option => <option key={option}>{option}</option>)}
      </select></label>
      {needsAmount && <label className="grid gap-1 text-[11px]">{tab === 'image' ? '数值（%）' : '数值（px）'}<input className={fieldClass} type="number" min={minimum} max={maximum} value={amount} onChange={event => setAmount(event.target.value)} /></label>}
    </div>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 break-all text-[11px] text-[#777b86]">{valid ? instruction : '请输入范围内的有效数值'}</span>
      <button type="button" disabled={!valid || !layerCount} onClick={() => onPrepare(instruction)} className="rounded-md bg-[#252830] px-3 py-1.5 text-[11px] text-white disabled:opacity-40">加入输入框</button>
    </div>
  </section>
}
