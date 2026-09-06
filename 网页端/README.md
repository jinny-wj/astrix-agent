# 星序 Astrix · 网页端

浏览器版 AI 设计协作。首页打开真实 Figma，配合 Chrome Side Panel 使用右侧 Agent。
macOS 客户端源码与安装包在上级目录的 `客户端/`。

## 快速开始

在本目录执行：

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5273/
```

其他命令：

```bash
pnpm build        # tsc -b && vite build
npx tsc -b        # 仅类型检查
```

## 技术栈

| 项 | 版本 |
|----|------|
| React | 18.3 |
| TypeScript | 5.9 |
| Vite | 5.4 |
| Tailwind CSS | 3.4 |
| lucide-react | 0.454 |

Node 22 / pnpm 10。

要预览「真实 Figma + 右侧 Agent」完整形态，还需按
[`browser-extension/README.md`](browser-extension/README.md) 加载本地扩展。

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
│   ├── RecentFigma.tsx         # 文件流（点击打开真实 Figma）
│   ├── StudioHealth.tsx        # Agent / OAuth / Team ID / Bridge 状态与设置
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
```

## 当前实现状态

下面区分代码已实现的链路与运行环境要求。Figma 登录、团队文件读取和 Bridge 写回仍需在具备相应权限的目标文件中验证；Agent 取决于本机后端登录与额度。

### 代码已接通

- **浏览器首页**：侧栏、Design 模式、输入区、功能卡、最近文件；Code 模式明确禁用
- **真实 Figma 入口**：首页发送、生成设计稿、功能卡会打开官方 `figma.new` 或已有文件；浏览器靠扩展挂 Agent，桌面客户端在同一窗口嵌真实 Figma
- **Agent 链路**：默认 Codex CLI → Claude Code → Hermes。未登录、额度用尽或 CLI 失败时返回真实错误，**默认不会静默落到演示壳伪造物料**
- **Figma 登录**：Authorization Code + PKCE、HttpOnly Session。登录后跨重启保持；打开/读取走 OAuth，改图层走当前文件里的 Design Studio Bridge
- **团队文件**：浏览 `figma.com/files/team/...` 或粘贴团队链接后自动记住，不必先配 Team ID 再重新登录
- **Plugin Bridge 写回**：在当前 Figma 文件运行 Design Studio Bridge；安装一次后画布可一键重开
- **PAT / OAuth 探测**：设置里可贴文件链接验证当前凭证能否读到真实文件
- **REST 预览编辑器**：用 OAuth/PAT 拉节点树做预览，编辑仍在真实 Figma 里完成

### 运行时仍常缺的条件

| 缺口 | 现状 |
|------|------|
| **真实 Agent** | 需要本机已登录且有额度。`/api/agent/status` 的 online 只表示 CLI 登录状态，发消息仍可能因额度/网络失败 |
| **macOS 正式分发** | 见客户端 README。本机临时签名包不能当发行包 |
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
5. 重启 `pnpm dev`，点击首页右上角「连接 Figma」。
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
