# 星序 Astrix · macOS 客户端

macOS 应用。同一窗口内提供应用级标签、真实 Figma 工作区和右侧 Agent。
网页端源码在上级目录的 `网页端/`。

安装包已分开放置，但**现有 `.app` / ZIP / DMG 不能正式对外分发**：

- `Design Studio.app` — 可本机双击打开（临时签名、仅 Apple Silicon）
- `zip/` — ZIP 压缩包
- `DMG/` — DMG 安装镜像

正式分发必须同时具备：Apple Team ID、Developer ID Application 证书、公证凭证，并通过 Gatekeeper。没有这些凭证时，`pnpm desktop:dist:mac` 会直接失败，不会再产出看起来像发行包的临时签名文件。

## 快速开始

在本目录执行：

```bash
pnpm install
pnpm desktop:dev          # 构建并运行 Mac 客户端
pnpm desktop:pack:mac     # 生成并验收 Apple Silicon 本机调试 .app
pnpm desktop:dist:mac:local # 生成临时签名的本机 DMG + ZIP，不可对外分发
pnpm desktop:dist:mac     # 预检、签名、公证并生成 universal 发行 DMG + ZIP
```

客户端从首页启动。输入设计需求并发送、点击功能卡、打开最近文件或新建设计稿时，
会在应用内创建 Figma 标签；右侧 Agent 直接复用真实选区与 Plugin Bridge 写回链路。
Figma 使用独立持久会话，首次手动登录后会在后续启动中保留登录状态。
客户端会把 Bridge 插件一并放进安装包；进入 Figma 工作区后点击顶部
「Bridge 文件」即可定位 `manifest.json`。本地开发插件需在 Figma 官方桌面版导入；内嵌 Figma 页面需要已发布的插件。OAuth 登录本身不代表 Bridge 已连接。

本机开发包使用临时签名。发行命令会强制检查 Developer ID Application、Apple
公证凭证、universal 架构、Gatekeeper 验收和 stapler 公证票据，任一缺失都会失败，
不会再把临时签名包误当发行包。OAuth Client Secret 仍应移到在线后端，不能随
安装包分发。

## 技术栈

| 项 | 版本 |
|----|------|
| React | 18.3 |
| TypeScript | 5.9 |
| Vite | 5.4 |
| Tailwind CSS | 3.4 |
| Electron | 43.4 |
| electron-builder | 26.15 |
| lucide-react | 0.454 |

Node 22 / pnpm 10。

客户端原生窗口内已集成 Figma 与右侧 Agent，无需 Chrome 扩展；浏览器版侧栏的配置见 [`browser-extension/README.md`](browser-extension/README.md)。

## 目录结构

```
src/
├── App.tsx                     # 路由出口
├── router.tsx                  # 浏览器 History 路由（home / creating / editor / agent）
├── config/
│   ├── brand.ts                # ⭐ 品牌配置唯一来源（名称/标语/文案）
│   └── figma.ts                # Figma 工作区意图、figma.new 与扩展握手
├── pages/
│   ├── HomePage.tsx            # 首页
│   ├── CreatingFigmaPage.tsx   # 自动创建设计稿过渡页
│   ├── AgentPanelPage.tsx      # Agent 独立预览 / Side Panel 内容入口
│   └── EditorPage.tsx          # 编辑器（含 EditorProvider）
├── state/
│   └── editorStore.tsx         # 编辑器、选区、视图与 Figma 导入状态
├── services/
│   ├── figmaApi.ts             # Figma URL 解析、REST 请求与错误映射
│   └── figmaAuth.ts            # OAuth Session 前端接口
├── types/
│   └── figma.ts                # Figma 文件、节点、填充与文本类型
├── components/
│   ├── FigmaAccountMenu.tsx    # 授权账户、配置提示与解绑
│   ├── TitleBar.tsx            # 通用 AppLogo
│   ├── Sidebar.tsx             # 首页侧栏（生成/资产/工具/创意）
│   ├── HeroSection.tsx         # 品牌图形 + 主标语
│   ├── PromptInput.tsx         # 首页输入框
│   ├── FeatureCards.tsx        # 五个功能入口卡
│   ├── CaseGallery.tsx         # 精选案例响应式卡片
│   ├── RecentFigma.tsx         # 文件流（点击进入编辑器）
│   └── editor/
│       ├── EditorTopBar.tsx    # 编辑器顶栏（编辑器/Figma 切换）
│       ├── LayersPanel.tsx     # 左侧图层栏（收起态）
│       ├── Canvas.tsx          # 单稿画布（选中框 + 手柄）
│       ├── FigmaCanvas.tsx     # Figma REST 节点树渲染器
│       ├── FigmaImportDialog.tsx # 文件链接 + PAT 导入对话框
│       ├── CanvasToolbar.tsx   # 悬浮 AI 操作条
│       ├── CanvasControls.tsx  # 底部缩放控件 + 沉浸模式
│       ├── BatchCanvas.tsx     # 批量产出画布（深色底、画板组平铺）
│       ├── AiPanel.tsx         # 右侧面板容器
│       ├── AiWelcome.tsx       # 欢迎卡 + 三步引导
│       ├── AiInputArea.tsx     # 能力标签 + 输入框 + 状态栏
│       └── agent/
│           ├── ConversationFlow.tsx  # 消息流回放编排
│           ├── MessageParts.tsx      # 用户气泡 / Skill 卡 / 采集摘要
│           └── ToolParts.tsx         # 工具调用卡 / 设计预览 / 结果网格
├── data/
│   ├── mock.ts                 # 首页功能卡与文件流数据
│   ├── aiPanel.ts              # 面板能力说明与快捷标签
│   ├── canvasDoc.ts            # 单稿画布占位内容
│   ├── agentScript.ts          # ⭐ Agent 消息模型 + 回放脚本
│   └── batchBoards.ts          # 批量画板数据
├── styles/index.css
└── public/assets/brand-mark.svg

server/
└── figmaOAuthPlugin.ts         # 本地 OAuth + PKCE + HttpOnly Session

browser-extension/
├── manifest.json               # Chrome Manifest V3
├── service-worker.js           # Side Panel 打开与工作区意图保存
├── workspace-bridge.js         # 首页用户手势桥接
└── sidepanel.*                 # Agent / Skills 原生侧栏界面

desktop/
├── main.ts                     # macOS 窗口、多标签、Figma 会话与安全边界
├── server.ts                   # 127.0.0.1:5273 内置服务与生产静态站点
├── preload/                    # 首页、顶栏、Agent 的最小 IPC 接口
└── renderer/                   # macOS 应用级标签栏与导航栏
```

## 当前实现状态

下面区分代码已实现的链路与运行环境要求。Figma 登录、团队文件读取和 Bridge 写回仍需在具备相应权限的目标文件中验证；Agent 取决于本机后端登录与额度。

### 代码已接通

- **macOS 客户端**：首页固定标签、真实 Figma 多标签、右侧 Agent、独立 `persist:design-studio-figma` 登录会话；启动时会把 OAuth Cookie 同步回首页
- **Agent 链路**：默认 Codex CLI → Claude Code → Hermes。未登录、额度用尽或 CLI 失败时返回真实错误，**默认不会静默落到演示壳伪造物料**
- **Figma 登录**：Authorization Code + PKCE、HttpOnly Session。登录后跨重启保持；打开/读取走 OAuth，改图层走当前文件里的 Design Studio Bridge
- **团队文件**：浏览团队页或粘贴团队链接后自动记住，不必先配 Team ID 再重新登录
- **Plugin Bridge 写回**：工作区顶栏「Bridge 安装」可定位插件；安装一次后画布可一键重开
- **PAT / OAuth 探测**：设置里可贴文件链接验证当前凭证能否读到真实文件
- **macOS 双轨打包**：本机调试包允许临时签名；发行命令强制 Developer ID、公证、universal 与 Gatekeeper

### 运行时仍常缺的条件

| 缺口 | 现状 |
|------|------|
| **真实 Agent** | 需要本机已登录且有额度。状态页 online 只表示 CLI 登录，发消息仍可能失败 |
| **macOS 正式分发** | 当前仓库里的 `.app` 是临时签名 arm64 本机包。没有 Apple Team ID / Developer ID / 公证凭证时不能过 Gatekeeper |
| **Code 模式** | 尚未开放 |

## 读取 Figma 文件

1. 在 Figma 设置的 Security 页面生成 Personal Access Token，并勾选
   `file_content:read`。
2. 运行 `pnpm dev`，或先 `pnpm build` 再运行 `pnpm preview`。
3. 进入编辑器，点击顶部「读取 Figma」。
4. 粘贴 `figma.com/design/...` 文件链接（支持带 `node-id`）或文件 Key，
   再输入 Token。

Token 只在导入弹窗内存中使用。浏览器把它发送给本机 `/api/figma`
代理，由代理转换为 Figma 要求的 `X-Figma-Token` 请求头；不会写入
`localStorage` 或构建产物。

## 配置 Figma OAuth

1. 打开 [Figma Developer Apps](https://www.figma.com/developers/apps)，
   创建 OAuth App。
2. 配置回调：
   `http://127.0.0.1:5273/api/auth/figma/callback`。
3. 基础连接启用 `current_user:read`、`file_content:read`、
   `file_metadata:read`，与当前应用请求的权限保持一致。
   团队目录权限需单独核对，不要向未启用对应权限的应用请求 `projects:read`。
4. 复制 `.env.example` 为 `.env.local`，填写 Client ID / Secret。
5. 重启客户端后，点击首页右上角「连接 Figma」。
6. 打开任意团队页，或在最近文件里粘贴团队链接。Team ID 会自动记住，不必重新登录。

Client Secret 没有 `VITE_` 前缀，不会进入浏览器代码。本地 OAuth Session
加密写入 `.design-studio`；客户端写入 macOS 的应用 `userData/data` 目录。

## 交互入口

| 操作 | 结果 |
|------|------|
| 首页输入框获得焦点 | 只进入输入状态，不跳转 |
| 首页输入框输入并发送 | 打开 Agent Side Panel，随后通过 `figma.new` 新建真实设计稿 |
| 首页点功能卡 | 同上，并把该功能预选为 Skill |
| 首页点「新建设计稿」 | 显示创建进度后进入 Figma Drafts 新文件 |
| 首页点已有文件卡片 / 「打开设计稿」 | 打开真实 Figma 文件，Side Panel 保持在右侧 |
| 打开 `/agent` | 在普通浏览器页单独预览现有 Agent 面板 |
| 真实 Figma 中选中图层 | Side Panel 输入框上方同步展示全部选中图层 |
| 多选人物 / 图片图层 | 显示集中编辑器，可统一修改或为每层填写不同指令 |
| Side Panel 输入指令并发送 | 锁定文件、选区版本和目标列表，通过 Bridge 批量修改并显示逐层回执 |
| 编辑器顶部「读取 Figma」 | 输入链接和 PAT，读取真实文件 |
| 图层树 / 画布节点 | 同步选择真实 Figma 节点 |
| 编辑器右上房子图标 | 返回首页 |
| 面板输入框打字 + Enter | 触发 Agent 回放 |
| 点任意能力标签 | 同上 |
| 面板左上「+」 | 重置会话，画布回到单稿态 |

## 二次开发要点

**改品牌名/文案**：只动 `src/config/brand.ts`。所有对外展示文字从此处取值，不要在组件里硬写。

**接真实 Agent**：默认 Codex CLI，见 [`docs/agent.md`](docs/agent.md)。前端 `ConversationFlow` 消费 `/api/agent/chat` SSE。

## macOS 正式发布

`pnpm desktop:dist:mac` 只用于正式发行。运行前必须满足：

1. 当前用户钥匙串中有有效的 `Developer ID Application` 证书和私钥。
2. 公证凭证使用以下任一完整组合：
   - `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`（推荐）；
   - `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`；
   - 已保存的 `APPLE_KEYCHAIN_PROFILE`。
3. Xcode Command Line Tools 提供 `notarytool` 和 `stapler`。

发行成功后会生成 arm64 + x86_64 的 universal 应用，并自动执行代码签名完整性、
Gatekeeper 与公证票据验收。只想在本机调试时使用 `desktop:pack:mac` 或
`desktop:dist:mac:local`。

**Figma 官方能力边界（产品已按此闭环，不是未完成项）**：

1. **不要用 File Embed 当编辑器** —— 客户端嵌真实 Figma 页面。
2. **REST 不能写普通设计节点** —— 读取走 OAuth，改图层走当前文件里的 Design Studio Bridge。
3. **没有「列出我的全部团队」API** —— 打开团队页或粘贴团队链接后自动记住 Team ID。

所需 scope：`file_content:read`、`file_metadata:read`、`projects:read`。

完整架构说明见
[`docs/figma-browser-workspace.md`](docs/figma-browser-workspace.md)。

## 多图层人物集中修改

1. 在真实 Figma 中运行 `Design Studio Bridge`。
2. 按住 Shift 选择两个或更多人物/图片图层。
3. 在右侧选择「统一修改」，输入例如
   `全部人物放大20%；右移20px；透明度90%`；或切换「分别修改」，为每层
   勾选目标并填写不同指令。
4. 发送后，Bridge 会在执行前再次校验当前文件、选区版本和全部目标。默认
   `atomic` 模式下任一目标失败会取消或回滚整批，并在右侧逐层显示结果。

当前可批量修改位置、尺寸、等比缩放、透明度、显隐、名称、文本和安全填充属性。
图片人物图层不会丢失原有 IMAGE 填充。本阶段不包含 AI 换脸、生成新人物或替换
图片内容；这些需要后续接入图片编辑模型与素材上传链路。

## 占位资产说明

以下内容为自制占位，非最终素材：

- `public/assets/brand-mark.svg` —— 中性几何图形，可整体替换
- `HeroSection.tsx` 的标语立体字 —— 渐变裁切 + 投影模拟，可换为图片资产（标记 `data-slot="brand-mark"`）
- `canvasDoc.ts` / `batchBoards.ts` 的画面 —— 全部为 CSS 拼的示意图形
- 文件流缩略图 —— 手写 DOM 结构
