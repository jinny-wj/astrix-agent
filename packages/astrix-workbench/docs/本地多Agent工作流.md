# 本地多 Agent 工作流

配置真实兼容模型后，在本地设置选择“多 Agent”，或通过多 Agent 工作台发起一次任务。演示模式不运行规划、子 Agent 或模型推理；记录会标为 `skipped`。

## 实际执行的链路

1. **规划**：独立模型调用返回结构化任务和依赖，角色限于 `coding-core-agent`、`m0-design-agent`、`explorer`。无效 JSON、循环依赖或未知角色直接失败，不伪造备用计划。
2. **执行**：独立只读任务最多并行 2 个；具有写权限的任务在同一工作区串行执行。后续任务收到真实依赖产物。
3. **复核**：另一次只读模型调用检查任务产物和工作区，可真实读取文件。
4. **总结**：单独模型调用根据实际产物与复核给出答复。

每次运行固定工作区、会话和模型配置。运行中切换项目不会改变该次任务使用的目录。文件修改受已有“允许 AI 修改当前工作区内的文件”开关限制。设计任务可使用已配对的真实 Figma 选区工具；只有实际授权的执行角色可写，规划与复核保持只读。执行目标绑定项目、文件、插件会话与选区版本，以真实回执为准；没有实时上下文时不能宣称修改了云端文件。保留的本地画布具有独立数据边界。

## 恢复代码的使用范围

调度图实际调用恢复包的 `@langchain/langgraph` 0.3.9，图结构为本地新增；记录标为 `original-langgraph-local-graph`，`businessGraphReused:false`。它不等于已恢复原企业业务图。恢复包缺失时使用本地同序调度，并记录 `local-workflow`。

角色提示词实际提取自恢复包中的规划 `internalPlanRole`、编码 `genExecutePrompt`、设计 `inlineDesignMD` 和总结 `SummaryPrompt`。只读取命名字符串常量，不执行这些业务 bundle 的企业服务初始化；适配部分会在 `promptSources` 标明，并记录原文件及提取内容 SHA-256。

- 本地文件助手：使用配置的真实模型和受工作区约束的 `list_files`、`read_file`、可选 `write_file`。
- 原版 OpenCode：每个角色运行独立的原生会话，传入角色提示词和授权文件权限。终端、委派任务、网络工具、外部目录与企业插件未启用。

## 预算与取消

默认最多 4 个任务、2 个并发只读角色、24 次全局预算。原版引擎按最大角色数预留每角色预算，默认每角色 3 次；实际转发请求数单独记录。

恢复的 OpenCode 1.17.10 在实测中没有可靠执行 `agent.steps` 的模型调用上限，因此不能只依赖该字段。每次原生角色调用经过临时本机模型网关：达到角色预算后返回 HTTP 400，后续请求不转发真实模型，并把该角色及工作流标为失败。原生标题、摘要 Agent 已禁用，以避免后台元数据消耗模型预算。网关只接收该次进程持有的随机令牌，真实模型密钥留在本地服务端。

取消信号会中止模型请求和原生进程，待活动步骤结束后记录 `cancelled`。预算不足、模型错误或工具循环不会被当成成功完成。

## 代码契约与记录

当前实现位于 `网页端/workbench/server/workflow.mjs`，由两端正式服务生命周期使用。该模块导出：

```js
const workflow = createWorkflowService({getModelConfig, getWorkspace, dataDir});
const result = await workflow.respond({
  prompt, history, sessionId, workspace, signal,
  onText(delta) {},
  onStep({id, runId, role, stage, status, summary}) {},
  onTool(event) {},
});
workflow.listRuns({sessionId, workspace, limit: 20});
workflow.getRun(runId);
```

运行记录保存在 `dataDir/workflow-runs/<runId>.json`，包含实际步骤、计划、产物、复核、结果、错误和预算，不包含模型密钥。原生步骤 `modelRequests` 记录 `maxRequests`、`forwardedRequests`、`deniedRequests`；总计在 `budget` 中。原生 `usedSteps` 是预留额度，类型明确为 `reserved-engine-steps`。

本地 HTTP 页面和 API 由主服务接入：`/__local/workflow`、`GET /__local/workflow/runs`、`GET /__local/workflow/runs/<id>`、`POST /__local/workflow/run`。消息通过现有 AG-UI SSE 返回，真实步骤使用 `CUSTOM` 事件 `local-workflow`。

## 已验证

`node --test test/workflow.test.mjs`：7 项通过。覆盖真实本机 mock 模型的角色请求、依赖上下文、并行只读与串行写入、工作区固定、只读越权拒绝、取消、预算失败、演示跳过；并实际运行恢复的原版二进制，验证独立会话和真实读取，以及连续工具调用在网关预算处停止。

`node --test test/opencode.test.mjs`：原生读写、会话续接和 AG-UI 对话原有回归通过。
