# Design Studio ↔ Figma Plugin Bridge

REST API **不能**写入普通设计节点。本插件在 Figma Desktop 内执行 Agent
下发的结构化命令。

## 安装

1. 打开 Figma Desktop → Plugins → Development → Import plugin from manifest…
2. 选择本目录的 `manifest.json`
3. 运行插件「Design Studio Bridge」。之后可在画布右下角一键重开。
4. 确认 Base URL 为 `http://127.0.0.1:5273`。插件会自动连接并开始轮询

上述方式用于本地开发联调，Figma 官方要求本地开发插件通过 Desktop 读取本机
代码。若最终产品只使用 Figma Web，需要把本插件发布为团队私有插件，再由用户
在浏览器当前文件中运行。当前跨文件隔离依赖 Private Plugin API 的 `figma.fileKey`；
Community 插件无法直接使用这一标识，不能在没有额外配对协议时宣称等价支持。

插件运行期间，Figma 当前选区会自动同步到浏览器 Agent 面板。发送指令时，
服务端会把图层 ID、类型和选区版本写入命令；若用户已经切换选区，插件会拒绝
旧命令，避免误改其他图层。批量命令还会同时校验 Figma fileKey、会话 ID
和所有目标是否仍在发送时锁定的选区中。

## 本地队列

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/figma-bridge/commands` | Agent / 前端入队写命令 |
| POST | `/api/figma-bridge/selection` | 插件上报当前 Figma 选区 |
| GET | `/api/figma-bridge/selection` | Agent 面板读取当前选区 |
| POST | `/api/figma-bridge/instructions` | 将自然语言指令转换为选区修改命令 |
| GET | `/api/figma-bridge/pull?sessionId=…` | 插件按文件会话拉取待执行命令 |
| POST | `/api/figma-bridge/ack` | 插件回写执行结果 |
| GET | `/api/figma-bridge/results/:commandId` | Agent 面板等待执行结果 |
| GET | `/api/figma-bridge/status` | 队列与连接状态 |

## 当前支持的选区修改

- 替换文本（自动加载混合字体图层使用的全部字体）
- 修改填充颜色（保留原有图片、渐变等非纯色填充）
- 修改透明度、尺寸和位置
- 按中心点等比缩放（自由定位图层）
- 隐藏、显示和重命名图层
- 对多个选中图层执行同一组修改，并返回每个图层的成功/失败结果

`patch-nodes` 默认使用 `atomic` 模式：任一图层预检失败就不修改任何图层，
执行期出错时会尝试回滚已修改的图层。指定 `executionMode: "best-effort"`
时，不支持某项修改的图层会单独失败，其他图层继续执行。两种模式都只生成
一个 Figma 撤销点。

对含 `IMAGE` 填充的人物图片图层，插件可安全批量调整透明度、尺寸、
等比缩放、位置、显隐和名称；修改纯色填充时会保留原图片填充。
当前协议不包含 AI 人物生成或图片内容替换，不会将普通属性修改伪装成“换人”。

## 示例命令

```bash
curl -X POST http://127.0.0.1:5273/api/figma-bridge/commands \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "demo-1",
    "type": "create-frame",
    "name": "Agent Frame",
    "x": 80,
    "y": 80,
    "width": 360,
    "height": 240,
    "fills": [{"r":0.95,"g":0.2,"b":0.25,"a":1}]
  }'
```

## Remote MCP

若后续拿到 Figma Remote MCP 客户端接入，可让 Agent 后端优先走 MCP，
本插件作为本地兜底通道保留。
