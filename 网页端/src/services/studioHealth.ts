export type StudioHealth = {
  agent: {
    configured: boolean
    backend: string
    servers: Array<{ id: string; name: string; online: boolean; detail: string }>
  }
  figma: {
    configured: boolean
    authenticated: boolean
    email: string | null
  }
  library: {
    teamIds: string[]
    configured: boolean
  }
  bridge: {
    connected: boolean
    note: string
    pluginConnectedAt: string | null
  }
}

export async function loadStudioHealth(): Promise<StudioHealth> {
  const [agentRes, sessionRes, libraryRes, bridgeRes] = await Promise.all([
    fetch('/api/agent/status', { cache: 'no-store' }),
    fetch('/api/auth/figma/session', { credentials: 'same-origin', cache: 'no-store' }),
    fetch('/api/auth/figma/library/config', { credentials: 'same-origin', cache: 'no-store' }),
    fetch('/api/figma-bridge/status', { cache: 'no-store' }),
  ])

  const agent = agentRes.ok
    ? await agentRes.json() as StudioHealth['agent'] & { configured?: boolean; backend?: string; servers?: StudioHealth['agent']['servers'] }
    : { configured: false, backend: 'unavailable', servers: [] }
  const session = sessionRes.ok
    ? await sessionRes.json() as { configured?: boolean; authenticated?: boolean; user?: { email?: string } | null }
    : { configured: false, authenticated: false, user: null }
  const library = libraryRes.ok
    ? await libraryRes.json() as { teamIds?: string[]; configured?: boolean }
    : { teamIds: [], configured: false }
  const bridge = bridgeRes.ok
    ? await bridgeRes.json() as { pluginConnectedAt?: string | null; note?: string }
    : { pluginConnectedAt: null, note: '无法读取 Bridge 状态' }

  return {
    agent: {
      configured: Boolean(agent.configured),
      backend: agent.backend ?? 'unavailable',
      servers: Array.isArray(agent.servers) ? agent.servers : [],
    },
    figma: {
      configured: Boolean(session.configured),
      authenticated: Boolean(session.authenticated),
      email: session.user?.email ?? null,
    },
    library: {
      teamIds: Array.isArray(library.teamIds) ? library.teamIds : [],
      configured: Boolean(library.configured),
    },
    bridge: {
      connected: Boolean(bridge.pluginConnectedAt),
      note: bridge.note ?? '在 Figma 中运行 Design Studio Bridge 后即可写回图层。',
      pluginConnectedAt: bridge.pluginConnectedAt ?? null,
    },
  }
}
