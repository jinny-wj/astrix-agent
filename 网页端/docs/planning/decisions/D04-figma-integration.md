# D04 · Figma 集成选型与写回边界

状态：已确认 | 日期：2026-07-30

## 结论

1. **读取路径**：OAuth + REST（`file_content:read` / `file_metadata:read` / `projects:read`）。
2. **文件列表**：`team_id`（环境变量 `FIGMA_TEAM_IDS`）→ `/v1/teams/:id/projects` → `/v1/projects/:id/files`。
3. **写入路径**：REST **不能**写普通设计节点。Agent 写回走：
   - 本地 `figma-plugin-bridge`（Plugin API + `/api/figma-bridge` 队列）
   - 或后续 Figma Remote MCP（优先，待接入）
4. **自建画布**：继续用 REST 节点树做近似渲染；复杂节点（蒙版 / 布尔 / geometry / imageTransform）做增强近似，不以像素级 1:1 为阻塞目标。

## 为何不写回 REST

官方 REST 可写范围不含 Frame / Text / Rectangle 等普通设计节点。任何「编辑后覆盖原 Figma 文件」的期望都必须改走 Plugin / MCP。

## 与产品行为对齐

| 能力 | 实现 |
|------|------|
| 打开真实 Figma | 浏览器标签 + Side Panel |
| 最近文件 | 扩展采集 + 本机记录 |
| 团队文件同步 | OAuth library sync（需配置 team_id） |
| Agent 改稿 | Bridge 队列 → 插件执行 |
