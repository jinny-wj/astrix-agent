import { spawn } from 'node:child_process'
import { readCodexMcpServers } from './composer'
import type { AgentRuntimeMeta } from './types'
import { childEnv, whichBin } from './whichBin'
import type {
  AgentMcpService,
  AgentServerInfo,
  AgentStatusSnapshot,
} from '../../src/types/agentComposer'

type BackendProbe = {
  installed: boolean
  authenticated: boolean
  path: string | null
  detail: string
}

type ProbeSet = {
  codex: BackendProbe
  claude: BackendProbe
  hermes: BackendProbe
}

let cachedProbes: { expiresAt: number; value: Promise<ProbeSet> } | null = null

function runCommand(
  bin: string,
  args: string[],
  timeoutMs = 4_000,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: string[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')))
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      resolve({ code: 1, output: error.message })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, output: chunks.join('') })
    })
  })
}

async function probeCodex(path: string | null): Promise<BackendProbe> {
  if (!path) {
    return { installed: false, authenticated: false, path, detail: '未安装 Codex CLI' }
  }
  const result = await runCommand(path, ['login', 'status'])
  const authenticated = result.code === 0 && /logged in/i.test(result.output)
  return {
    installed: true,
    authenticated,
    path,
    detail: authenticated ? '已安装并登录' : '已安装，但未登录或登录已过期',
  }
}

async function probeClaude(path: string | null): Promise<BackendProbe> {
  if (!path) {
    return { installed: false, authenticated: false, path, detail: '未安装 Claude Code' }
  }
  const result = await runCommand(path, ['auth', 'status'])
  let loggedIn = false
  try {
    const payload = JSON.parse(result.output) as { loggedIn?: boolean }
    loggedIn = payload.loggedIn === true
  } catch {
    loggedIn = /"loggedIn"\s*:\s*true/.test(result.output)
  }
  const authenticated = result.code === 0 && loggedIn
  return {
    installed: true,
    authenticated,
    path,
    detail: authenticated ? '已安装并登录' : '已安装，但未登录或登录已过期',
  }
}

async function probeHermes(path: string | null): Promise<BackendProbe> {
  if (!path) {
    return { installed: false, authenticated: false, path, detail: '未安装 Hermes' }
  }
  const result = await runCommand(path, ['status'], 6_000)
  const authenticated = result.code === 0 && /[✓✔]\s*logged in/i.test(result.output)
  return {
    installed: true,
    authenticated,
    path,
    detail: authenticated ? '已安装并登录' : '已安装，但没有可用的模型授权',
  }
}

export function getBackendProbes(): Promise<ProbeSet> {
  const now = Date.now()
  if (cachedProbes && cachedProbes.expiresAt > now) return cachedProbes.value
  const codex = whichBin('codex')
  const claude = whichBin('claude')
  const hermes = whichBin('hermes')
  const value = Promise.all([
    probeCodex(codex),
    probeClaude(claude),
    probeHermes(hermes),
  ]).then(([codexProbe, claudeProbe, hermesProbe]) => ({
    codex: codexProbe,
    claude: claudeProbe,
    hermes: hermesProbe,
  }))
  cachedProbes = { expiresAt: now + 15_000, value }
  return value
}

export async function collectStatusSnapshot(
  runtime: AgentRuntimeMeta,
): Promise<AgentStatusSnapshot> {
  const probes = await getBackendProbes()
  const configured = Object.values(probes).some((probe) => probe.authenticated)

  const mcp: AgentMcpService[] = [
    {
      id: 'loop',
      name: 'Loop',
      description: '按间隔重复执行当前任务（Codex loop）',
      available: probes.codex.authenticated,
      skill: 'loop',
      source: 'skill',
    },
    {
      id: 'hermes',
      name: 'Hermes',
      description: '跨会话记忆与定时网关',
      available: probes.hermes.authenticated,
      skill: 'hermes',
      source: 'skill',
    },
    {
      id: 'figma-layers',
      name: 'Figma 图层',
      description: '把当前对准的图层作为上下文交给 Agent',
      available: true,
      source: 'skill',
    },
  ]

  for (const server of readCodexMcpServers()) {
    if (mcp.some((item) => item.id === server.id)) continue
    mcp.push({
      id: server.id,
      name: server.id,
      description: server.command ? `命令：${server.command}` : '来自 ~/.codex/config.toml',
      available: probes.codex.authenticated,
      source: 'codex-mcp',
    })
  }

  const servers: AgentServerInfo[] = [
    {
      id: 'codex',
      name: 'Codex CLI',
      online: probes.codex.authenticated,
      detail: probes.codex.detail,
      active: runtime.backend === 'codex-cli' && probes.codex.authenticated,
    },
    {
      id: 'claude',
      name: 'Claude Code',
      online: probes.claude.authenticated,
      detail: probes.claude.detail,
      active: runtime.backend === 'claude-agent-sdk' && probes.claude.authenticated,
    },
    {
      id: 'hermes',
      name: 'Hermes',
      online: probes.hermes.authenticated,
      detail: probes.hermes.detail,
      active: runtime.backend === 'hermes-agent' && probes.hermes.authenticated,
    },
    {
      id: 'shell',
      name: '演示模式',
      online: false,
      detail: '不会自动启用。显式选择时只说明限制，不伪造物料',
      active: runtime.backend === 'local-shell',
    },
  ]

  return {
    configured,
    mode: runtime.mode,
    model: runtime.model,
    shell: runtime.shell,
    backend: runtime.backend,
    baseUrl: null,
    binaries: {
      codex: { available: probes.codex.installed, path: probes.codex.path },
      claude: { available: probes.claude.installed, path: probes.claude.path },
      hermes: { available: probes.hermes.installed, path: probes.hermes.path },
    },
    mcp,
    servers,
  }
}
