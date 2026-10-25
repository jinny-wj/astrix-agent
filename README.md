<div align="center">

<img src="assets/brand/astrix/astrix-dock-transparent.png" width="96" alt="星序 Astrix 图标" />

# 星序 Astrix

### 让灵感变成现实。连接 Figma 的 AI 设计工作台。

**打开设计稿，选中图层，描述需求，查看真实执行结果。**

[![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple_Silicon-111827?style=flat-square&logo=apple&logoColor=white)](客户端/README.md)
[![Web Browser](https://img.shields.io/badge/Web-Browser-2563EB?style=flat-square&logo=googlechrome&logoColor=white)](网页端/README.md)
[![Figma Plugin Bridge](https://img.shields.io/badge/Figma-Plugin_Bridge-A259FF?style=flat-square&logo=figma&logoColor=white)](客户端/figma-plugin-bridge/README.md)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#快速开始)
[![Workbench v0.7.3](https://img.shields.io/badge/Workbench-v0.7.3-4F46E5?style=flat-square)](packages/astrix-workbench/versions/v0.7.3.md)
[![Status In Development](https://img.shields.io/badge/Status-In_Development-F59E0B?style=flat-square)](#构建与验证)

**[macOS 客户端](客户端/README.md) · [网页版](网页端/README.md) · [工作台指南](packages/astrix-workbench/README.md)**

[快速开始](#快速开始) · [产品能力](#产品能力) · [连接 Figma](#连接-figma) · [常见问题](#常见问题) · [版本记录](packages/astrix-workbench/CHANGELOG.md) · [反馈](#反馈与贡献)

<code>git clone https://github.com/jinny-wj/astrix-agent.git</code>

</div>

> [!NOTE]
> **当前阶段：开发与本机验证。** 最新实现位于默认分支 [main](https://github.com/jinny-wj/astrix-agent/tree/main)，仓库不提供已签名、公证的正式安装包。指定人员试用与本机打包见[私发安装说明](客户端/docs/private-install.txt)；源码与安装包分别交付。

## 项目简介

星序将真实 Figma 工作区、图层上下文和 AI 助手放在同一条工作流中，减少在设计工具、聊天窗口和素材之间反复切换的成本，让设计师围绕正在编辑的内容工作。

项目提供 **macOS 客户端**与**网页版**两套独立工程。客户端在真实 Figma 界面外增加应用级导航、标签页和右侧 AI 面板，保留 Figma 自带的图层树、画布和属性栏；网页版通过本地服务与浏览器扩展组织协作界面。两端均接入工作台界面与本地服务；客户端还承载原生代码编辑器、终端和扩展，网页版提供浏览器文件编辑与预览。

## 目录

- [项目简介](#项目简介)
- [产品能力](#产品能力)
- [客户端与网页版](#客户端与网页版)
- [工作台已接入两端](#工作台已接入两端)
- [快速开始](#快速开始)
- [连接 Figma](#连接-figma)
- [图层选择与修改](#图层选择与修改)
- [配置 AI 助手](#配置-ai-助手)
- [项目结构与开发](#项目结构与开发)
- [构建与验证](#构建与验证)
- [常见问题](#常见问题)
- [数据、安全与发布](#数据安全与发布)
- [反馈与贡献](#反馈与贡献)

## 产品能力

### 统一的设计工作区

- **首页与项目入口**：新建设计稿、打开 Figma 文件链接、访问本机最近文件，以及配置团队文件目录。
- **真实 Figma 编辑器**：客户端使用独立持久登录会话，保留 Figma 原生工具区域；外层提供多标签、首页、设置及图层 / 技能导航。
- **右侧 AI 面板**：包含欢迎说明、操作引导、能力入口、消息流、上下文标签和输入框。
- **统一品牌**：星序 Astrix 名称、品牌图形和 macOS 图标素材集中管理。

### 围绕选中图层工作

- 将目标文件中的单选或多选图层作为编辑上下文，在输入框区域显示图层名称等信息。
- 通过 Plugin Bridge 下发结构化修改，支持文字、纯色填充、透明度、尺寸、位置、显隐和名称等属性操作。
- 批量操作锁定目标文件、会话与选区版本，校验目标图层，降低切换选区后误改其他内容的风险。
- 修改结果以插件返回的真实执行回执为准；失败时展示原因，不把“已发出请求”当成“修改成功”。

### AI 与设计任务入口

提供一键美化、资源位延展、人物战报、视觉稿生成、批量任务及 Loop / Hermes 等入口。它们用于组织需求、技能和执行上下文，**不是所有模型与生成服务都已内置、免费或开箱即用**。

真实对话由本机配置的 Agent 后端执行。素材生成还取决于对应技能、模型服务、授权、网络及额度；普通图层属性编辑不等于 AI 图片生成、换人或换脸。

## 客户端与网页版

| 对比项 | macOS 客户端 | 网页版 |
|---|---|---|
| 使用形式 | Electron 原生窗口 | 本地网页 + 浏览器 |
| Figma 与 AI 面板 | 官方 Figma 与工作台在同一窗口 | 官方 Figma 在浏览器打开，与工作台配对 |
| 浏览器扩展 | 不需要 | 原设计界面的侧栏流程可加载本地扩展 |
| 图层写入 | 需要目标文件中的 Plugin Bridge | 同样需要 Plugin Bridge |
| 本地 AI 后端 | 本地设置可配置模型与多 Agent | 同源服务提供相同配置与工作流 |
| 代码与文件 | 原 KSCode、PTY 终端、扩展宿主与 Open VSX | 本地服务支持的浏览器文件编辑与 HTML 预览 |
| 当前打包状态 | Apple Silicon 本机调试包 | 开发及构建预览均带完整本地服务 |

详细文档：[客户端说明][desktop-doc] · [网页版说明][web-doc] · [浏览器扩展安装][extension-doc]。

## 快速开始

### 1. 准备环境

- Node.js 22，建议使用较新的 22.x 版本，以支持项目测试使用的类型剥离参数。
- pnpm 10 与 Git。
- 客户端打包配置要求 macOS 13 或更新版本；本机打包命令默认面向 Apple Silicon。
- 如需使用真实 Figma 文件，请准备有相应文件访问权限的 Figma 账户。
- 如需 AI 对话，请另行准备可用的本机 Agent 后端。

### 2. 获取代码

```bash
git clone https://github.com/jinny-wj/astrix-agent.git
cd astrix-agent
```

客户端、网页端分别安装依赖和构建。共用路径配置、跨端测试和版本记录位于 `packages/astrix-workbench/`，它不提供第三套应用入口。根目录不是统一的包管理入口。

### 3. 准备工作台运行资源

公开 Git 保存源码；生成前端与恢复的原生组件需按[运行资源说明](packages/astrix-workbench/docs/GitHub运行包.md)取得对应 0.7.3 资源并在仓库根目录还原。资源采用两端目录布局，下载与当前版本匹配的资源后再启动。

### 4. 启动 macOS 客户端

```bash
cd 客户端
pnpm install
pnpm desktop:dev
```

该命令通过客户端正式入口启动完整工作台：真实 Figma、原编辑器、终端、扩展、项目与会话及多 Agent。原来的 Figma 设计界面可用 `pnpm desktop:legacy` 打开，或从应用菜单切换。两种主进程按启动模式二选一。

### 5. 或者启动网页版

从仓库根目录执行：

```bash
cd 网页端
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:5273/` 即进入工作台；`pnpm build` 后的 `pnpm preview` 同样接入本地服务。原 React 设计界面保留在 `/design.html`。若使用原设计界面的 Chrome Side Panel，请按[扩展文档][extension-doc]加载 `网页端/browser-extension`。

完整客户端优先使用 4317，遇到旧服务占用时会选择独立端口；网页版使用 5273。两端默认分别保存状态，避免同时写同一份配置。原客户端设计模式也使用 5273，与网页版同开时需先核对端口。

客户端与网页版可以同时运行：分别在两端目录执行上述启动命令，网页版访问 [本地工作台](http://127.0.0.1:5273/)。首页底部提供项目与会话、Figma 工作区、代码工具、多 Agent 和技能入口；客户端的 Code 页面另有原生编辑器、终端与扩展。模型尚未配置时使用演示模式，真实 Figma 修改需要在目标文件配对 Plugin Bridge。

## 工作台已接入两端

工作台源码已按职责迁入两端，工程只保留客户端和网页版两个应用入口。默认启动客户端或网页版即可使用各自的工作台。

| 位置 | 实际职责 |
| --- | --- |
| `客户端/workbench/` | Electron 宿主、真实 Figma 容器、原 KSCode、PTY 终端、扩展与桌面验证工具 |
| `网页端/workbench/` | 工作台前端、本地项目与会话、文件编辑与预览、Agent / 多 Agent、生成器及 Figma Bridge |
| `packages/astrix-workbench/` | 共用路径配置、跨端测试、资源打包、版本与历史记录；没有第三套应用入口 |

客户端 bootstrap、网页端 Vite 开发与预览服务、构建输出和客户端资源打包均引用上述实际实现。普通网页不会获得 Electron 原生编辑器或 PTY；Figma 的画布、矢量和云端协作继续由官方 Figma 提供。

历史标签保留，新的提交标题统一使用 Astrix。逐版源码、验证与资源记录见[版本总表](packages/astrix-workbench/versions/index.json)与[变更记录](packages/astrix-workbench/CHANGELOG.md)；运行资源只在受限草稿中分发。本地状态使用各端的工作台数据目录，迁移备份不上传；数据位置见[工作台指南](packages/astrix-workbench/README.md)。

## 连接 Figma

### 默认工作台连接

在 Design 中打开真实 Figma 文件。客户端使用隔离的官方 Figma 登录会话；网页版在浏览器打开官方页面。随后在工作台生成配对码，在目标文件运行 **Astrix Figma Bridge** 并完成配对。只有插件的实际回执才能证明图层修改成功。详细步骤见[工作台指南](packages/astrix-workbench/README.md)。

0.7.3 为单个插件提供客户端与网页版的独立连接：每端分别配对，凭据按本地服务隔离，命令回执只回到发起它的服务。官方开发插件导入、两端登录及同一文件的实际同时联通，须按[本版验证记录](packages/astrix-workbench/versions/evidence/v0.7.3.json)逐项验收；当前不据此宣称真实 Bridge 已在线。本轮连接工作不配置或调用模型。

### 原设计界面的 OAuth 连接

以下 OAuth、团队目录与原 Side Panel 说明适用于 `/design.html` 和客户端 `--legacy-ui` 模式。

1. 在 Figma 开发者后台创建自己的 OAuth 应用。
2. 将对应工程中的 `.env.example` 复制为本机 `.env.local`，按照示例填写 OAuth 配置。
3. 将回调地址登记为 `http://127.0.0.1:5273/api/auth/figma/callback`，并确保与本机配置完全一致。
4. 按项目当前基础连接配置启用 `current_user:read`、`file_content:read`、`file_metadata:read`。请求权限必须与 OAuth 应用实际启用的权限匹配；团队目录能力需要单独核对，不能随意增加权限项。
5. 重启应用或开发服务，点击右上角“连接 Figma”，在官方授权页面完成确认。
6. 返回工作台后打开设计稿链接，或在团队设置中配置需要访问的团队。

**连接成功只表示授权链路可用。** 能否读取某个文件仍受账户权限、应用权限和接口限制影响；登录也不会自动授予图层修改能力。

### 最近文件与团队文件

本机最近文件记录和团队目录是两种不同来源。最近文件用于快速回到实际打开过的项目，不应理解为账户下所有 Figma 文件的完整列表。团队文件需要正确的团队配置及相应访问权限。

### 读取与编辑的区别

- **OAuth / REST 读取**：用于文件信息、节点数据及预览等读取流程。
- **Plugin Bridge 编辑**：在目标 Figma 文件内执行修改并返回结果。
- **应用中的预览**：是读取数据后的展示，不等于 Figma 原生编辑器，也不能仅凭预览变化判断原稿已保存。

## 图层选择与修改

### 默认工作台的 Bridge

默认工作台使用 `网页端/workbench/figma-plugin-bridge/` 的 **Astrix Figma Bridge**，客户端也使用同一份协议与插件源码。通过工作台的插件帮助准备开发插件、在对应文件中配对并选中图层；每次修改仍须核对真实执行回执。

### 原设计界面安装并连接 Bridge

1. 保持星序本地服务运行。
2. 在 Figma 官方桌面版中，通过开发插件入口导入对应工程的 `figma-plugin-bridge/manifest.json`。
3. 打开要修改的文件并运行“Design Studio Bridge”。这是仓库当前插件的技术名称。
4. 检查插件连接的本地地址与应用一致，并确认工作台显示当前文件的 Bridge 已连接。
5. 在 Figma 画布或图层树中选择图层，确认右侧输入框出现匹配的图层上下文，再发送指令。

客户端顶部“Bridge 文件”入口可帮助定位随包提供的插件文件。OAuth 授权完成后，仍需要单独完成上述连接。

**浏览器 / 内嵌 Figma 注意事项：** 本地开发插件通过官方桌面版导入。当前协议的跨文件隔离依赖 Private Plugin API 的文件标识，纯浏览器部署需要适配并发布团队私有插件；不能直接把 Community 发布视为等价方案。详见 [Bridge 文档][bridge-doc]。

### 示例指令

以下为当前受控图层编辑流程的示例，请先选择适合的图层：

```text
文字改成「立即参与」
颜色改为 #3366FF，透明度 80%
尺寸改成 300×200
右移 20px
重命名为 主视觉标题
隐藏
```

自然语言属性修改使用受控规则，并非任意指令都能执行。文字操作要求文本图层，尺寸与位置操作也会受到图层类型和布局约束影响。

多选时可以统一修改，结果按图层反馈。修改完成后请检查原稿；需要撤回时可使用 Figma 的撤销操作。对于图片图层，调整位置、大小和透明度不会自动替换图片内容。

## 配置 AI 助手

默认工作台先以演示模式运行界面。在“本地设置”中配置可用模型服务后，可使用本地助手或恢复的 OpenCode，以及规划、执行与复核的多 Agent 工作流。模型配置不随源码和资源包分发。

原设计界面默认优先使用本机 Codex CLI，并提供 Claude Code / Hermes 等后端路径。以下环境配置说明适用于原设计界面；安装应用不代表这些后端已经安装或登录，也不包含第三方服务额度。

在对应工程的 `.env.local` 中可配置：

```dotenv
AGENT_BACKEND=auto
AGENT_MODEL=auto
AGENT_ALLOW_DEMO_FALLBACK=0
```

使用前检查：

1. 所选后端已在本机安装，应用运行环境能够找到它。
2. 后端已完成登录，并且账户、网络和额度可用。
3. 使用生成类技能时，对应服务也已配置。
4. 先发送一次简单需求，检查真实响应，再进行复杂任务。

默认配置不会在真实 Agent 失败后静默伪造生成结果。状态页显示在线也不保证每次任务都成功，实际运行仍可能因限额、网络或服务状态报错。更多说明见 [Agent 文档][agent-doc]。

## 项目结构与开发

```text
astrix-agent/
├── README.md                  # 仓库首页与使用总览
├── assets/brand/astrix/        # 品牌图形与启动图标源素材
├── packages/astrix-workbench/  # 共用配置、跨端测试、打包工具与版本历史
├── 客户端/                    # macOS 独立工程
│   ├── src/                   # React 页面、组件、状态与服务
│   ├── desktop/               # 启动 bootstrap 与原设计界面主进程
│   ├── workbench/             # 工作台 Electron、Figma、原生编辑器及终端宿主
│   ├── server/                # 本地 OAuth、Agent 与 Bridge 服务
│   ├── figma-plugin-bridge/   # Figma 插件与协议说明
│   ├── browser-extension/    # 浏览器协作代码
│   ├── skills/               # 设计任务与 Agent 技能
│   ├── scripts/              # 构建、签名和验收脚本
│   └── build/                # macOS 图标、权限等构建资源
└── 网页端/                    # 浏览器独立工程
    ├── src/                   # 原设计界面与 AI 面板
    ├── workbench/             # 工作台前端、本地服务、Agent、Bridge 与生成器
    ├── server/                # 本地服务
    ├── browser-extension/    # Chrome Side Panel 扩展
    ├── figma-plugin-bridge/   # Figma 插件
    └── skills/               # 任务技能
```

原设计界面采用 React、TypeScript、Vite、Tailwind CSS；恢复工作台由已恢复前端与独立本地 Node 服务适配，客户端增加 Electron、原生编辑器与 electron-builder。具体依赖以各端 `package.json` 和锁文件为准。

品牌文案入口为各端 `src/config/brand.ts`；右侧面板位于 `src/components/editor/`；桌面应用级外壳位于 `客户端/desktop/renderer/`。两个工程并非自动同步，涉及通用协议或共享交互的改动应分别验证。

## 构建与验证

在需要验证的子工程目录执行：

```bash
pnpm test
pnpm build
```

客户端额外提供：

```bash
pnpm desktop:typecheck       # 桌面端类型检查
pnpm desktop:pack:mac        # 构建并验收 arm64 本机调试应用
pnpm desktop:dist:mac:local  # 生成本机测试 DMG / ZIP
```

完整工作台目前只有 darwin-arm64 恢复组件；`pnpm desktop:dist:mac:private` 可生成本机私发包，资源、入口、签名和图标均需验收。原 universal 正式发行命令暂不支持完整工作台，不能把本机包当作已签名、公证的正式发行版。

跨端工作台检查在 `packages/astrix-workbench/` 执行 `npm test`；两端各自的 `pnpm test` 保留原设计工程检查。

自动化测试和编译通过不等于外部服务端到端验证完成。Figma 授权、真实图层写回、模型服务调用和正式安装体验仍需要在具备对应权限的环境中单独验收。

## 常见问题

### 点击连接后提示 `Invalid scopes for app`

检查本机请求的权限与 Figma OAuth 应用中启用的权限是否一致，尤其不要把未启用的团队权限加入基础登录。修改配置后重启服务再重新授权，同时核对回调地址。

### Figma 已登录，为什么不能改图层？

登录与 Bridge 是两条不同链路。请在目标文件中运行插件，检查文件、连接地址和会话是否匹配；先确认选中的图层出现在右侧上下文中，再提交修改。

### 图层标签出现了，但发送后还是失败？

显示选区不等于写入链路正常。插件可能未连接、目标已改变，或该图层不支持所请求的属性。以错误提示和逐层执行回执为准，不要通过反复发送掩盖连接问题。

### 浏览器扩展链接打不开，是否必须去商店安装？

当前仓库提供的是本地扩展代码。开发测试使用 Chrome 的“加载已解压的扩展程序”，选择本项目的 `browser-extension` 目录即可；不要依赖未经确认的商店链接。

### AI 助手没有响应或显示额度错误？

先检查实际使用的后端、登录状态、网络和额度。Figma 登录成功不代表模型服务也已登录，应用在线也不代表后端还有可用额度。

### 为什么启动图标偶尔还是旧图标？

可能打开了不同目录中的旧应用，也可能是 Dock 保留了旧路径或缓存。先确认正在运行的 `.app` 路径与最新构建一致，再检查固定的 Dock 入口。不要直接删除应用数据；多个测试包应先备份并逐一核对。

### 可以只把网页静态文件上传后直接使用吗？

不能据此获得完整功能。OAuth、Agent 与 Bridge 依赖服务端或本机服务，静态页面不包含这些运行能力。公网部署还需另行设计身份验证、配置管理及安全边界。

### 是否支持 Windows、正式 macOS 安装包和 Code 模式？

完整客户端的原 KSCode、终端与扩展现已接入默认入口，目前原生恢复组件支持 macOS Apple Silicon。网页版提供浏览器文件编辑与预览，不具备 Electron 原生终端。尚未在此承诺 Windows、Intel 完整客户端或已公证发行版。原设计界面的独立 Code 模式仍按其原能力边界保留。

## 数据、安全与发布

- 仓库用于备份源码、文档、示例配置及品牌素材，不提交本机登录数据、实际环境配置、工作区数据、依赖目录和大型安装包。
- OAuth 私密配置应保存在受控服务端或本机环境中，不能写入前端公开变量，也不能随公开安装包分发。
- 本地保存部分状态不等于所有数据都不会离开电脑。使用 Figma、AI 或素材服务时，任务所需内容可能被发送到对应服务；处理未公开设计前请确认组织授权和服务使用规则。
- 本机服务面向本地开发使用，不应未经安全评估直接暴露到公网。
- macOS 正式分发需要 Developer ID、Apple 公证等条件，临时签名包只用于本机测试。
- 暂未添加开源许可证。仓库公开可见不等于已授予任意使用、修改或再分发许可。

## 反馈与贡献

欢迎通过 [GitHub Issues](https://github.com/jinny-wj/astrix-agent/issues) 提交问题或建议。为便于定位，请提供使用端、系统版本、分支或提交号、复现步骤、预期结果和实际结果。

提交截图、日志或设计文件前，请去除个人信息、认证信息和未获授权的工作内容。涉及设计稿的错误可优先使用最小化测试文件复现。

代码改动建议说明影响范围，并运行对应工程的测试与构建；涉及 Figma 写回时补充真实插件回执验证，涉及桌面打包时补充签名和图标验收。当前阶段重点是稳定连接、清晰反馈和可验证的编辑流程，不将未验证能力描述为已完成。

[desktop-doc]: https://github.com/jinny-wj/astrix-agent/blob/main/客户端/README.md
[web-doc]: https://github.com/jinny-wj/astrix-agent/blob/main/网页端/README.md
[extension-doc]: https://github.com/jinny-wj/astrix-agent/blob/main/网页端/browser-extension/README.md
[bridge-doc]: https://github.com/jinny-wj/astrix-agent/blob/main/客户端/figma-plugin-bridge/README.md
[agent-doc]: https://github.com/jinny-wj/astrix-agent/blob/main/客户端/docs/agent.md
