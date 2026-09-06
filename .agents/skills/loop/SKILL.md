---
name: loop
description: >-
  Run a prompt or skill in this session on a recurring or variable interval
  (e.g. /loop 5m check Figma, 每隔 5 分钟跟进战报). Codex-class loop, not Claude ralph-loop.
---
# Loop

Codex 侧的 loop 工程。OpenAI `openai/codex` 仓库尚未合入 `/loop` 内置命令（见 [issue #15679](https://github.com/openai/codex/issues/15679)、[#25466](https://github.com/openai/codex/issues/25466)）。本 skill 采用与 Codex 工作流兼容的 loop 协议：`/loop [interval] <prompt>`，sentinel `AGENT_LOOP_TICK_` / `AGENT_LOOP_WAKE_`。Codex CLI 里也可用 `$loop`。不要用 Claude 的 ralph-loop。

## Parse

Accept `/loop [interval] <prompt>` or `$loop [interval] <prompt>`.

- Leading interval: `5m /foo`, `30s check status`, `2h run report`, `5m 检查授权`.
- Trailing interval: `check deploy every 5m`, `检查 Figma 连接 every 5m`.
- No interval: dynamic mode; the agent chooses the next delay after each run.
- Empty prompt: show `Usage: /loop [interval] <prompt>`.

Use intervals like `30s`, `5m`, `2h`, `1d`. Convert unit words to short units.

Use monitored shell output to wake the agent for recurring local work.

## Fixed Schedule

```bash
while true; do
  sleep <seconds>
  echo 'AGENT_LOOP_TICK_<purpose> {"prompt":"<prompt>"}'
done
```

1. Check existing terminals for an already-running matching loop.
2. Start one background shell loop with output monitoring.
3. Use a unique sentinel and a regex such as `^AGENT_LOOP_TICK_<purpose>`.
4. Smoke-check once to confirm clean startup.
5. Run the prompt once immediately after arming the loop.
6. The first sentinel should arrive only after the initial sleep, so startup does not double-run the prompt.
7. Track the PID so the agent can stop the loop if asked.
8. Briefly confirm: the interval, that the prompt already ran once, when the first tick will arrive, and that the loop will fire on each tick until stopped. On later ticks, give a short update of what changed. On stop, say the loop has stopped and why.

## Dynamic Schedule

The user wants the agent to self-pace. Decide what makes the next iteration worth running — a passage of time, or an observable event.

1. **Run the prompt now.**
2. **If the next run is gated on an event** (a git ref advancing, a log line matching, a file changing, a CI check completing, Figma session change), arm a background watcher that emits the sentinel only when the event fires, matching `^AGENT_LOOP_WAKE_<purpose>`. Arm once; skip on later ticks if it's still running.
3. **At the end of the turn, arm a one-shot time-based wake**:

```bash
sleep <seconds>
echo 'AGENT_LOOP_WAKE_<purpose> {"prompt":"<prompt>"}'
```

   With a watcher armed, this is the **fallback heartbeat** — lean long so idle ticks aren't pure overhead. Without a watcher, this is the cadence — pick a delay based on when the result is worth checking again.

4. **On wake**, read the latest payload, execute its `prompt`, then re-arm the next heartbeat (and re-arm the watcher only if it exited). If both an output wake and a completion notification arrive, act on the output and ignore the completion.
5. **To stop**, kill any watcher PID and don't arm the next heartbeat.
6. Briefly confirm: that you're self-pacing, whether a watcher is the primary wake signal, what fallback delay you picked, and that the prompt already ran.

## Prompt Payload

Wake notifications include an output file path, not a submitted prompt. Put the prompt beside the sentinel, preferably as JSON. On wake, read the latest matching line and act on its `prompt`. The prompt may vary by tick.

## Guidance

- Title shell commands as `Loop <schedule>: <prompt>` (e.g. `Loop every 5m: check deploy status`).
- Adapt loop syntax to the user's shell (e.g. PowerShell `while ($true) { ... Start-Sleep }` on Windows). The examples above use bash.
- Prefer monitored shell output over OS cron when the agent needs wake notifications; stdout stays attached to the monitored task.
- Use a unique sentinel per loop so unrelated output does not trigger notifications.
- Avoid noisy commands inside the loop.
- Do not create duplicate fixed loops or dynamic sleepers.
- If the user asks to stop, kill any tracked loop/sleeper PID, then await the shell task so its completion notification is consumed and does not wake the agent later. Do not schedule another dynamic wake.

## Design Studio

- Figma OAuth is read-only. Do not pretend to write design nodes.
- In-app Agent uses `codex exec` (one-shot). Persistent ticks need a loop-capable Codex interactive environment; in the panel, run the first tick now and describe the armed schedule.
- Typical prompts: 授权是否仍有效、最近文件是否同步、战报导出是否完成.
