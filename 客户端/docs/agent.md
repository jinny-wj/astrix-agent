# Design Studio Agent

默认使用本机 **Codex CLI**（[openai/codex](https://github.com/openai/codex)，`codex exec --json`）。

失败时按顺序回退：**Claude Code Agent SDK** → **Hermes**（[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)）。默认不会回退到演示壳子，也不会伪造素材生成结果。

选 Gemini / Qwen 时优先 Hermes。

## 快速开始

1. 本机已登录 Codex：

```bash
codex login
which codex
```

可选：Claude Code、Hermes。

```bash
claude auth status
which hermes
```

2. `.env.local`：

```bash
AGENT_BACKEND=auto   # auto | codex | claude | hermes | shell
AGENT_MODEL=auto
AGENT_ALLOW_DEMO_FALLBACK=0
```

3. **用非沙箱终端**启动（需要读 `~/.codex` / `~/.claude` / `~/.hermes` 并访问网络）：

```bash
pnpm dev
```

4. 打开 `/agent` 或编辑器右侧面板发消息。面板会显示 `Codex ·` / `Claude Code ·` / `Hermes ·`。

## 行为

| 情况 | 行为 |
|------|------|
| Codex 已登录 | SSE 流式输出真实 Agent 文本 |
| Codex 失败 | 自动切换 Claude Code / Hermes；都不可用时明确报错 |
| 模型含 gemini / qwen | 优先 Hermes |
| `AGENT_BACKEND=codex` | 优先 Codex，失败后只回退其他真实后端 |
| `AGENT_BACKEND=shell` | 显式使用说明性演示壳子，不宣称生成成功 |
| `AGENT_ALLOW_DEMO_FALLBACK=1` | 仅产品演示时允许自动进入说明性壳子 |

## Skills

- 业务：`skills/portrait-beautify`、`skills/resource-extension`、`skills/battle-report`
- Loop：`skills/loop`（Codex `/loop` 协议，sentinel `AGENT_LOOP_TICK_`）
- Hermes：`skills/hermes`（官方 CLI：`hermes -z`）

用户说「定时 / 每隔 5 分钟 / `/loop`」时走 loop。说「Hermes / 赫尔墨斯」时走 Hermes。

## 工具白名单

Codex 使用 `--sandbox read-only`。Claude 仅允许 `Read` / `Grep` / `Glob`。

Figma OAuth 只能读图层，不能写普通设计节点。

## 常见问题

**找不到 `codex`**  
确认 `~/.local/bin/codex` 在 PATH。开发服务会额外查找该目录。

**状态显示“已安装但未登录”**  
服务会实际执行各 CLI 的认证状态检查，而不是把“找到二进制”当作在线。按提示执行对应的 `codex login`、`claude login` 或 Hermes 登录流程。

**卡住很久**  
当前实现会在运行时失败后切换下一条后端，不再死等。
