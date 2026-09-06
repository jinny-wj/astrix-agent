---
name: hermes
description: Use when the user asks for Hermes, 赫尔墨斯, cross-session memory, cron gateway, or the official Nous Research agent. Official repo is NousResearch/hermes-agent.
---
# Hermes

Official agent: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

Install (already present on this machine if `hermes` is on PATH):

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
hermes              # interactive
hermes model        # pick provider; openai-codex / anthropic / gemini / …
hermes -z "prompt" --in "$(pwd)"
hermes -z "…" --provider openai-codex -m gpt-5.5
```

`-z` is the official scripted one-shot: single prompt in, final reply text out. Use `--in` to pin the workspace. Do not pass `--cli` with `-z` (`--cli` forces the interactive REPL).

## When to use

- Cross-session memory, skill self-improvement, cron/gateway delivery
- Models that Codex CLI does not host locally (Gemini / Qwen via Hermes providers)
- User explicitly says Hermes

## In this product

Design Studio prefers **Codex CLI** for the in-app Agent. Hermes is the companion runtime for memory/cron and extra models.

Do not clone the whole Hermes monorepo into this app. Call the local `hermes` binary. Keep Figma OAuth read-only.
