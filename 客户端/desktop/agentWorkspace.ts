import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Agent processes and attachments need a real, writable directory outside ASAR. */
export function prepareAgentWorkspace(dataDirectory: string, resourcesDirectory: string) {
  const workspace = join(dataDirectory, 'agent-workspace')
  mkdirSync(workspace, { recursive: true })
  for (const name of ['skills', 'AGENTS.md']) {
    const source = join(resourcesDirectory, name)
    if (!existsSync(source)) throw new Error(`Agent 运行资源缺失：${name}`)
    cpSync(source, join(workspace, name), { recursive: true })
  }
  return workspace
}
