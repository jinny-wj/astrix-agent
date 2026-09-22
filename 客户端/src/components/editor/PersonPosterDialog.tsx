import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import fullRules from '../../../skills/person-poster-extension/references/workflow.md?raw'
import nodeRules from '../../../skills/person-poster-extension/references/figma-placement.md?raw'
import type { AgentAttachment } from '../../types/agentComposer'
import type { PeopleRecord } from '../../types/personPoster'
import { attachmentPeopleDocument, posterPreparationIssues, posterPreparationPrompt } from '../../services/personPoster'

const fieldClass = 'w-full rounded-lg border border-[#dce2ed] bg-white px-3 py-2 text-sm text-[#253348]'

export default function PersonPosterDialog({ attachments, brief, uploadError, onClose, onAddFiles, onPrepare }: {
  attachments: AgentAttachment[]
  brief: string
  uploadError: string
  onClose: () => void
  onAddFiles: () => void
  onPrepare: (prompt: string) => void
}) {
  const [templateId, setTemplateId] = useState('')
  const [sheetKey, setSheetKey] = useState('')
  const [originalNickname, setOriginalNickname] = useState('')
  const [originalEvent, setOriginalEvent] = useState('')
  const [originalTrack, setOriginalTrack] = useState('')
  const [overrides, setOverrides] = useState<Record<string, Partial<PeopleRecord>>>({})
  const dialog = useRef<HTMLDivElement>(null)
  const images = attachments.filter(a => a.kind === 'image' && a.path)
  const template = images.find(a => a.id === templateId)
  const sheets = useMemo(() => attachments.flatMap(a => (attachmentPeopleDocument(a)?.sheets ?? []).map((s, i) =>
    ({ ...s, key: `${a.id}:${i}`, label: `${a.name} · ${s.name}` }))), [attachments])
  const selectedSheet = sheets.find(s => s.key === sheetKey)
  const baseRows: PeopleRecord[] = selectedSheet?.records ?? images.filter(a => a.id !== templateId).map((a, i) =>
    ({ row: i + 1, nickname: '', event: '', track: '', images: [a.path!], issues: [] }))
  const rows = baseRows.map((r, i) => ({ ...r, ...overrides[`${sheetKey}:${templateId}:${i}`] }))
  const update = (i: number, value: Partial<PeopleRecord>) => setOverrides(current => ({ ...current,
    [`${sheetKey}:${templateId}:${i}`]: { ...current[`${sheetKey}:${templateId}:${i}`], ...value } }))
  const input = template ? { template, sheet: selectedSheet?.name ?? '逐张图片', originalNickname, originalEvent, originalTrack, records: rows } : undefined
  const errors = input ? [...(selectedSheet?.issues ?? []), ...posterPreparationIssues(input)] : ['请选择海报模板。']
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => previous?.focus()
  }, [])
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[#152238]/40 p-4" onClick={onClose}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="poster-title" tabIndex={-1}
        className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl bg-[#f8faff] p-6 shadow-2xl"
        onClick={e => e.stopPropagation()} onKeyDown={e => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Tab') {
            const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary')
            if (!focusable?.length) return
            const first = focusable[0]; const last = focusable[focusable.length - 1]
            if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus() }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
          }
        }}>
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="poster-title" className="text-xl font-semibold text-[#253348]">单人海报延展</h2>
            <p className="mt-1 text-sm text-[#67758b]">一张海报模板，批量替换人物和昵称。</p></div>
          <button type="button" onClick={onClose} aria-label="关闭海报准备窗口" className="p-2">✕</button>
        </div>
        <div className="my-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">准备阶段：核对人物与文案。图片生成服务尚待接入，此处不会开始出图。</div>
        <button type="button" onClick={onAddFiles} className="mb-4 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm text-blue-700">添加模板、人物图片或 Excel</button>
        <p className="mb-3 text-xs text-[#67758b]">支持 XLSX 内嵌图片、CSV/TSV 图片引用及已导出的表格 JSON。当前输入框最多 8 个附件，每个文件不超过 4 MB；更多人物请使用表格。</p>
        {uploadError && <p role="alert" className="mb-3 text-sm text-red-700">{uploadError}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">海报模板<select aria-label="海报模板" className={fieldClass} value={templateId} onChange={e=>setTemplateId(e.target.value)}>
            <option value="">请选择上传成功的模板图</option>{images.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="text-sm">人物来源<select aria-label="人物来源" className={fieldClass} value={sheetKey} onChange={e=>setSheetKey(e.target.value)}>
            <option value="">已上传的人物图片（手动填昵称）</option>{sheets.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
          <label className="text-sm">模板中的原昵称<input aria-label="模板中的原昵称" className={fieldClass} value={originalNickname} onChange={e=>setOriginalNickname(e.target.value)} placeholder="例如：凌云" /></label>
          {template?.previewUrl && <img src={template.previewUrl} className="h-32 justify-self-start rounded-lg object-contain" alt="所选海报模板" />}
        </div>
        <details className="my-4 rounded-lg border border-[#e0e6ef] p-3 text-sm">
          <summary className="cursor-pointer">额外文案替换（默认保持不变）</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label>模板赛事原文<input aria-label="模板赛事原文" className={fieldClass} value={originalEvent} onChange={e=>setOriginalEvent(e.target.value)} placeholder="留空则不替换赛事" /></label>
            <label>模板赛道原文<input aria-label="模板赛道原文" className={fieldClass} value={originalTrack} onChange={e=>setOriginalTrack(e.target.value)} placeholder="留空则不替换赛道" /></label>
          </div>
        </details>
        <h3 className="mb-2 font-medium">人物清单 · {rows.length} 人 · {Math.ceil(rows.length / 10)} 批</h3>
        <div className="max-h-72 overflow-auto rounded-xl border border-[#e0e6ef] bg-white">
          <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-[#edf2f9]"><tr><th className="p-2">序号</th><th>完整昵称</th><th>人物素材</th>{originalEvent && <th>赛事</th>}{originalTrack && <th>赛道</th>}</tr></thead>
            <tbody>{rows.map((r,i)=><tr key={`${sheetKey}:${templateId}:${i}`} className="border-t border-[#edf2f9]">
              <td className="p-2">{i+1}</td><td className="p-2"><input aria-label={`人物 ${i+1} 昵称`} className={fieldClass} value={r.nickname} onChange={e=>update(i,{nickname:e.target.value})} /></td>
              <td className="p-2"><select aria-label={`人物 ${i+1} 素材`} className={fieldClass} value={r.images.length===1?r.images[0]:''} onChange={e=>update(i,{images:e.target.value?[e.target.value]:[]})}>
                <option value="">请选择对应照片</option>{[...new Set([...baseRows[i].images,...images.filter(a=>a.id!==templateId).map(a=>a.path!)])].map((path,n)=><option key={path} value={path}>{images.find(a=>a.path===path)?.name ?? `表格素材 ${n+1}（待检查）`}</option>)}</select></td>
              {originalEvent && <td className="p-2"><input aria-label={`人物 ${i+1} 赛事`} className={fieldClass} value={r.event} onChange={e=>update(i,{event:e.target.value})} /></td>}
              {originalTrack && <td className="p-2"><input aria-label={`人物 ${i+1} 赛道`} className={fieldClass} value={r.track} onChange={e=>update(i,{track:e.target.value})} /></td>}
            </tr>)}</tbody></table>
          {!rows.length && <p className="p-5 text-[#67758b]">添加人物图片或选择已解析的工作表。</p>}
        </div>
        <details className="my-4 text-sm text-[#67758b]"><summary className="cursor-pointer">查看完整业务 Skill</summary><p className="my-2">下面保留完整业务约束。原服务为 Gemini，后续以你指定的图片服务为准。</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-6">{fullRules}</pre></details>
        <details className="my-4 text-sm text-[#67758b]"><summary className="cursor-pointer">查看 Figma 辅助 Skill 整理</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-6">{nodeRules}</pre></details>
        {errors.length>0 && <p role="status" className="mt-3 text-sm text-amber-700">{errors.slice(0,3).join(' ')}{errors.length>3?` 另有 ${errors.length-3} 项待检查。`:''}</p>}
        <div className="mt-4 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">稍后继续</button>
          <button type="button" disabled={errors.length>0} onClick={()=>input && onPrepare(posterPreparationPrompt(input,brief))} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40">交给助手核对任务</button></div>
      </div>
    </div>, document.body)
}
