# Design Studio WJ Agent

In-app Agent default: **Codex CLI** (`codex exec --json`).
Fallback: Claude Code SDK, then Hermes. The local demo shell is opt-in only.

## Skills

Read `skills/<name>/SKILL.md` before acting:

- `portrait-beautify` — 一键美化，保脸
- `resource-extension` — 资源位延展
- `battle-report` — 人物战报
- `loop` — Codex official loop (`/loop 5m …`)
- `hermes` — [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

## Rules

- Reply in concise Chinese.
- Do not modify the git repo or install packages unless the user asks.
- Figma REST/OAuth can read layers only. Figma writes must be acknowledged by the connected Plugin Bridge; never pretend a write succeeded.
- Do not mention tokens, secrets, or internal URLs.
