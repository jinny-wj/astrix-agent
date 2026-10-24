# Astrix · 网页端

默认入口是 Astrix 工作台：项目、会话、Agent、文件编辑、HTML 预览和真实 Figma Plugin Bridge 在同一个本机服务中运行。原有 React 设计界面保留在 `/design.html`，工作台左下角提供「原设计界面」入口；原界面标题栏可返回工作台。

## 启动

需要 Node 22 或更新版本、pnpm 10，以及与当前版本对应的工作台运行资源。首次还原资源的目录与校验步骤见 [运行包说明](../packages/astrix-workbench/docs/GitHub运行包.md)。恢复的生成资源不加入 Git。

在本目录执行：

```bash
pnpm install --frozen-lockfile
pnpm dev                 # http://127.0.0.1:5273/
```

如持有完整的本机恢复目录，可以从只读原始素材重新准备前端和生成器：

```bash
ASTRIX_RECOVERY_ROOT=/path/to/M0-AI-recovered pnpm prepare:workbench
```

这个目录需要包含 `web-assets/cache-recovered/manifest.json` 和生成器所需的 `web-assets/additional-static/`。只含原生引擎的 runtime 包不足以重建浏览器静态素材；已还原对应 UI 资源包时可直接启动。路径默认为仓库根目录的 `M0-AI-recovered/`，与客户端共用只读资源。

```bash
pnpm build               # 类型检查；构建工作台资源和原 React 界面到 dist/
pnpm preview             # http://127.0.0.1:5273/，同时启动真实本地后端
pnpm test                # 原界面、浏览器扩展及工作台服务测试
pnpm test:workbench       # 本地矢量/协作与恢复生成器验证
pnpm exec tsc -b          # 仅类型检查
```

开发和预览均固定使用 5273；占用时会明确退出，避免 OAuth 回调、插件地址和扩展连接到错误实例。需要隔离验收时可传 `--port 端口号`，但原设计界面的 OAuth 回调及 Chrome 扩展仍须相应配置。

`dist/` 包含两套界面的前端资源；`pnpm preview` 会加载工作台后端和原有服务插件。部署成普通静态站点无法提供项目存储、Agent 或 Plugin Bridge。

## 入口与功能

| 路径 | 内容 |
|------|------|
| `/`、`/home` | 默认工作台，项目与会话 |
| `/__local/settings` | 工作台模型配置与权限 |
| `/__local/editor` | 浏览器文件编辑器 |
| `/__local/preview` | 当前项目 HTML 预览，使用独立沙箱 |
| `/__local/workflow` | 多 Agent 工作流与运行记录 |
| `/figma-workspace.html?projectId=…` | 当前项目的真实 Figma 连接与 Bridge 状态 |
| `/design.html` | 保留的原 React 设计首页 |
| `/editor/…`、`/workspace`、`/creating`、`/agent` | 原 React 路由，仍加载原界面 |
| `/local-canvas/index.html` | 先前的独立本地设计编辑器，可选使用 |

工作台默认处于明确标注的界面演示模式，不调用模型。配置独立模型服务后可开启真实对话、文件工具和多 Agent 工作流；原 OpenCode 引擎和 LangGraph 工作流还需要对应的受限运行资源。模型不可用时展示实际错误。

浏览器可编辑项目文本文件并预览保存的 HTML/CSS/JavaScript。浏览器不加载原生 KSCode、PTY 终端和 Open VSX 扩展安装；这些能力由 [macOS 客户端](../客户端/README.md) 提供。HTML 预览不会执行项目安装或构建脚本，React Native 工程需要自己的运行环境。

原设计界面的 Agent 保留 Codex CLI → Claude Code → Hermes 的原链路，需要本机登录与额度，演示 fallback 必须显式开启。工作台的模型设置不会替换这一条链路。配置细节见 [原 Agent 说明](docs/agent.md)。

## 真实 Figma

在工作台项目中切换到 Design，保存官方 Figma 文件链接，然后在浏览器中打开真实 Figma。浏览器无法把官方编辑器嵌入普通网页；设计节点仍在 Figma 自己的画布、图层树与属性面板中编辑。

按工作区提供的插件目录导入开发版 Plugin Bridge，在目标文件里运行，并使用一次性配对码连接本机服务。选区、导出和修改绑定当前项目、文件、会话及选区版本。发送命令只代表排队，收到实际插件回执后才显示成功；没有插件连接时不会声称写入完成。操作说明见 [Figma 工作区](workbench/frontend-tools/FIGMA-WORKSPACE.md)。

原设计界面与 Chrome Side Panel 继续使用原来的 Bridge 链路。需要这一形态时，按 [扩展说明](browser-extension/README.md) 加载扩展。原 React 中的 REST 节点预览器和演示画面仍保留，它们不代替官方 Figma 编辑器。

## 数据与同源服务

`server/workbenchPlugin.ts` 将 `workbench/server/application.mjs` 工厂直接挂载到 Vite 的开发和预览 HTTP 服务。构建本身不启动 Agent、不写用户状态；原 React 服务插件先处理自己的 API。

- 工作台项目/会话继续使用 `/devops-api/…`，本地服务使用 `/__local/…`。
- 恢复页面的网络适配器将 `/api/agent/chat` 改到 `/__local/chat`，将 `/api/agent/stop` 改到 `/__local/agent/stop`，保持 AG-UI 事件流与停止操作成对。
- 原 React 的 `/api/agent/…`、`/api/figma-bridge/…`、`/api/auth/…`、`/api/desktop/…`、`/api/local/…` 和 Figma REST 代理保持原协议。
- 工作台仅处理自己的 WebSocket 握手；Vite 的 `vite-hmr` 子协议继续由 Vite 管理。
- `/__local/health` 返回产品、版本、运行表面与实例 ID，客户端据此拒绝误连旧服务。

默认网页工作台数据位于 `workbench/.local-data/`，与客户端的默认数据目录分开。原 React 的 OAuth 等数据继续使用 `.design-studio/`。不要让两个进程同时写同一份工作台 JSON 状态。可用下列变量为测试或私有运行指定独立目录：

```bash
ASTRIX_STATE_ROOT=/path/to/web-state \
ASTRIX_DATA_DIR=/path/to/web-state/data \
ASTRIX_WORKSPACE=/path/to/web-state/workspace \
DESIGN_STUDIO_DATA_DIR=/path/to/web-state/design \
pnpm dev
```

`ASTRIX_DATA_DIR`、`ASTRIX_WORKSPACE` 优先；旧的 `M0_LOCAL_DATA_DIR`、`M0_LOCAL_WORKSPACE` 环境变量仍兼容。显示品牌为 Astrix，历史导入格式、存储键及桥接消息标识保留兼容名称。

## 原设计界面的 Figma OAuth

工作台的 Plugin Bridge 不要求原 React 的 OAuth；以下配置用于原设计首页的账号与文件读取。

1. 在 [Figma Developer Apps](https://www.figma.com/developers/apps) 创建 OAuth App。
2. 配置回调 `http://127.0.0.1:5273/api/auth/figma/callback`。
3. 基础连接启用 `current_user:read`、`file_content:read`、`file_metadata:read`。团队目录需要的权限须与应用实际授权一致。
4. 复制 `.env.example` 为 `.env.local`，填写服务端配置，重启 `pnpm dev`。
5. 打开 `/design.html`，连接 Figma 后打开团队页或粘贴团队链接。

原界面的 PAT 导入也可读取文件。Figma REST/OAuth 负责读取，设计节点修改必须经当前目标文件内运行的 Plugin Bridge 确认。更多说明见 [原浏览器工作区架构](docs/figma-browser-workspace.md)。

## 源码位置

- `workbench/server/`：工作台服务工厂、CLI 兼容入口、项目/会话/模型/文件/Figma/工作流。
- `workbench/frontend-tools/`：恢复前端准备器、Astrix 品牌适配及浏览器集成源码。
- `workbench/plugins/`：隔离恢复生成器的适配源码。
- `workbench/canvas/`、`workbench/figma-plugin-bridge/`：可选本地画布与真实 Figma 插件。
- `src/`、`server/`、`browser-extension/`：保留的 React 设计界面、Vite 服务和浏览器扩展。
- `../packages/astrix-workbench/`：两端共用的布局、版本、检查及运行资源打包工具；不是第三个应用入口。
