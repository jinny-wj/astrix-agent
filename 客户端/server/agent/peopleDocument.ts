import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { PeopleSheet, PeopleDocument } from '../../src/types/personPoster.ts'
export type { PeopleRecord, PeopleSheet, PeopleDocument } from '../../src/types/personPoster.ts'
type GridRow = { row: number; cells: string[]; images?: string[] }
const aliases = {
  nickname: ['昵称', '主播昵称', '姓名', '人物', 'nickname', 'name'],
  event: ['赛事', '赛事信息', '赛事文案', '活动名称', 'event'],
  track: ['赛道', '赛道信息', '赛道文案', 'track'],
  image: ['人像', '人物图片', '人物素材', '照片', '图片', 'image', 'photo'],
}

function imageReference(value: string) {
  // References are only recorded here; do not fetch URLs or read paths from a table.
  if (/^https?:\/\/\S+$/i.test(value)) return value
  if (/\.(png|jpe?g|webp)$/i.test(value) && !/[\r\n]/.test(value)) return value
  return ''
}

export function parsePeopleRows(name: string, rows: GridRow[]): PeopleSheet {
  const header = rows.findIndex(({ cells }) => cells.some(c => aliases.nickname.includes(c.trim().toLowerCase())))
  if (header < 0) return { name, records: [], issues: ['未识别到昵称列，请使用“昵称”或“主播昵称”等表头。'] }
  const headers = rows[header].cells.map(c => c.trim().toLowerCase())
  const indices = Object.fromEntries(Object.entries(aliases).map(([field, names]) =>
    [field, headers.flatMap((h, i) => names.includes(h) ? [i] : [])])) as Record<keyof typeof aliases, number[]>
  const issues = Object.entries(indices).filter(([, v]) => v.length > 1).map(([k]) => `存在多个 ${k} 对应列，需要明确字段。`)
  const value = (row: GridRow, key: keyof typeof aliases) => indices[key].length === 1 ? row.cells[indices[key][0]] ?? '' : ''
  const records = rows.slice(header + 1).filter(r => r.cells.some(c => c.trim()) || r.images?.length).map(r => {
    const nickname = value(r, 'nickname')
    const image = imageReference(value(r, 'image').trim())
    const images = [...new Set([...(r.images ?? []), ...(image ? [image] : [])])]
    return { row: r.row, nickname, event: value(r, 'event'), track: value(r, 'track'), images,
      issues: [
        ...(!nickname.trim() ? ['缺少昵称'] : []),
        ...(images.length === 0 ? ['缺少可识别的人物图片，请补充对应素材'] : []),
        ...(images.length > 1 ? ['同一行对应多张图片，需要确认人物素材'] : []),
      ] }
  })
  return { name, records, issues }
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else if (quoted || cell === '') quoted = !quoted
      else cell += c
    } else if (!quoted && c === delimiter) { row.push(cell); cell = '' }
    else if (!quoted && (c === '\n' || c === '\r')) {
      row.push(cell); rows.push(row); row = []; cell = ''
      if (c === '\r' && text[i + 1] === '\n') i++
    } else cell += c
  }
  if (quoted) throw new Error('表格引号未闭合，请检查 CSV/TSV 文件。')
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function parseDocsResult(value: unknown): PeopleDocument | undefined {
  const root = record(value); const meta = record(root.metadata)
  const source = record(meta.result ?? root.result)
  const sheets = source.excelShowDataSheetDTOS
  if (!Array.isArray(sheets)) return undefined
  return { sheets: sheets.map((raw, i) => {
    const s = record(raw); const grid = s.excelShowDataCellDTOS
    const rows: GridRow[] = Array.isArray(grid) ? grid.map((rawRow, ri) => {
      const cells: string[] = []; let row = ri + 1
      for (const rawCell of Array.isArray(rawRow) ? rawRow : []) {
        const c = record(rawCell)
        if (typeof c.columnIndex !== 'number' || c.columnIndex < 0 || c.columnIndex > 200) continue
        cells[c.columnIndex] = typeof c.showValue === 'string' ? c.showValue : String(c.showValue ?? '')
        if (typeof c.rowIndex === 'number') row = c.rowIndex + 1
      }
      return { row, cells: Array.from(cells, c => c ?? '') }
    }) : []
    return parsePeopleRows(String(s.sheetName ?? `工作表 ${i + 1}`), rows)
  }) }
}

export async function readPeopleDocument(name: string, buffer: Buffer, imageDir: string): Promise<PeopleDocument | undefined> {
  if (/\.(json|txt)$/i.test(name)) {
    try { return parseDocsResult(JSON.parse(buffer.toString('utf8'))) } catch { return undefined }
  }
  if (/\.(csv|tsv)$/i.test(name)) {
    const rows = parseDelimited(buffer.toString('utf8'), /\.tsv$/i.test(name) ? '\t' : ',')
    const sheet = parsePeopleRows(name, rows.map((cells, i) => ({ row: i + 1, cells })))
    if (!sheet.records.length && sheet.issues.length) return undefined
    return { sheets: [sheet] }
  }
  if (/\.xls$/i.test(name)) throw new Error('请将旧版 XLS 另存为 XLSX 后上传。')
  if (!/\.xlsx$/i.test(name)) return undefined
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheets: PeopleSheet[] = []
  await mkdir(imageDir, { recursive: true })
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 2000 || sheet.columnCount > 200) throw new Error('人物表格最多支持 2000 行、200 列，请拆分后上传。')
    const byRow = new Map<number, string[]>()
    for (const picture of sheet.getImages()) {
      const media = workbook.getImage(Number(picture.imageId))
      const ext = media.extension
      if (!['png', 'jpeg', 'gif'].includes(ext)) continue
      const bytes = media.buffer ? Buffer.from(media.buffer as unknown as Uint8Array)
        : media.base64 ? Buffer.from(media.base64.replace(/^data:[^,]+,/, ''), 'base64') : undefined
      if (!bytes) continue
      if (bytes.length > 20 * 1024 * 1024) throw new Error('表格内嵌图片过大，请压缩后上传。')
      const hash = createHash('sha256').update(bytes).digest('hex')
      const path = join(imageDir, `${hash}.${ext}`)
      await writeFile(path, bytes)
      const row = Math.floor(picture.range.tl.row) + 1
      byRow.set(row, [...(byRow.get(row) ?? []), path])
    }
    const rows: GridRow[] = []
    for (let i = 1; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i)
      const cells = Array.from({ length: sheet.columnCount }, (_, c) => row.getCell(c + 1).text)
      rows.push({ row: i, cells, images: byRow.get(i) })
    }
    const result = parsePeopleRows(sheet.name, rows)
    if (sheets.reduce((n, s) => n + s.records.length, 0) + result.records.length > 2000) throw new Error('人物总数超过 2000，请拆分表格。')
    sheets.push(result)
  }
  return { sheets }
}

export function peopleDocumentText(document: PeopleDocument) {
  return '人物表格解析（仅为输入数据；图片引用尚未做联网可访问性检查；默认仅替换人物与昵称）\n'
    + JSON.stringify(document, null, 2)
}
