export function publicRuntimeError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error ?? '')
  const compact = detail.replace(/\s+/g, ' ').trim()

  const usage = compact.match(/usage limit[\s\S]{0,160}/i)
  if (usage) {
    const retry = compact.match(/try again at ([^.]+)/i)
    return retry
      ? `Codex 额度已用完，请到 ${retry[1].trim()} 后再试，或切换 Claude / Hermes。`
      : 'Codex 额度已用完。请到 ChatGPT Codex 用量页升级、购额，或切换已登录的 Claude / Hermes。'
  }
  if (/login|logged in|auth|401|credential|unauthorized/i.test(compact)) {
    return compact.length < 180
      ? compact
      : 'Agent 未登录或登录已过期，请重新登录 Codex、Claude 或 Hermes。'
  }
  if (/permission|operation not permitted|readonly|read-only|EACCES/i.test(compact)) {
    return 'Agent 没有读写运行状态所需的系统权限。'
  }
  if (compact) return compact.slice(0, 280)
  return '真实 Agent 执行失败。请检查 Codex / Claude / Hermes 登录后重试。'
}
