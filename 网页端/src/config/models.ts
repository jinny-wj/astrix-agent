export type StudioModel = {
  id: string
  label: string
  group: 'auto' | 'online'
}

const STORAGE_KEY = 'design-studio:selected-model'
const CUSTOM_STORAGE_KEY = 'design-studio:custom-models'
const DEFAULT_MODEL_ID = 'auto'

export const BUILTIN_MODELS: StudioModel[] = [
  { id: 'auto', label: 'Auto', group: 'auto' },
  { id: 'gpt-5.5', label: 'GPT 5.5', group: 'online' },
  { id: 'gemini-3.5-flash', label: 'Gemini-3.5-Flash', group: 'online' },
  { id: 'qwen-3.5', label: 'Qwen 3.5', group: 'online' },
]

function readCustomModels(): StudioModel[] {
  try {
    const raw = localStorage.getItem(CUSTOM_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (
        !item
        || typeof item !== 'object'
        || typeof (item as StudioModel).id !== 'string'
        || typeof (item as StudioModel).label !== 'string'
      ) {
        return []
      }
      const id = (item as StudioModel).id.trim()
      const label = (item as StudioModel).label.trim()
      if (!id || !label) return []
      return [{ id, label, group: 'online' as const }]
    })
  } catch {
    return []
  }
}

export function listStudioModels(): StudioModel[] {
  const custom = readCustomModels().filter(
    (item) => !BUILTIN_MODELS.some((model) => model.id === item.id),
  )
  return [...BUILTIN_MODELS, ...custom]
}

export function readSelectedModel(): StudioModel {
  const models = listStudioModels()
  try {
    const id = localStorage.getItem(STORAGE_KEY)?.trim() || DEFAULT_MODEL_ID
    return models.find((model) => model.id === id) ?? models[0]
  } catch {
    return models[0]
  }
}

export function writeSelectedModel(id: string) {
  const models = listStudioModels()
  const next = models.find((model) => model.id === id) ?? models[0]
  localStorage.setItem(STORAGE_KEY, next.id)
  return next
}

export function addCustomModel(label: string): StudioModel | null {
  const trimmed = label.trim()
  if (!trimmed) return null
  const id = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || `model-${Date.now().toString(36)}`
  const existing = listStudioModels().find((model) => model.id === id)
  if (existing) {
    writeSelectedModel(existing.id)
    return existing
  }
  const model: StudioModel = { id, label: trimmed, group: 'online' }
  localStorage.setItem(
    CUSTOM_STORAGE_KEY,
    JSON.stringify([...readCustomModels(), model]),
  )
  writeSelectedModel(model.id)
  return model
}

export function modelIdForAgent(model = readSelectedModel()): string | undefined {
  return model.id === 'auto' ? undefined : model.id
}
