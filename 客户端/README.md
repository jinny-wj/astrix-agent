# Astrix · macOS 客户端

0.7.0 起，客户端默认启动完整工作台：项目与会话、AI 对话与多 Agent、真实 Figma、原 KSCode 编辑器、终端和扩展。它们在当前客户端窗口内运行。原来的 Astrix 设计界面仍可通过应用菜单“打开原设计界面”或 `desktop:legacy` 访问。

网页端入口位于相邻的 `网页端/`。共享目录 `packages/astrix-workbench/` 只提供路径、版本和验证，不再是第三个独立应用。

## 启动完整工作台

需要 Node.js 22+、pnpm 10、macOS 13+。本轮原生功能和私发包面向 Apple Silicon。

```sh
pnpm install
pnpm desktop:dev
```

`desktop:dev` 构建保留的 React 界面、检查桌面类型并生成入口，再启动 Electron。默认入口为 `desktop/bootstrap.ts`；它在同一个 Electron 进程内加载 `workbench/desktop/main.cjs`。旧主进程独立编译为 `dist-electron/legacy-main.mjs`，两套主进程不会同时注册服务和 IPC。

从源码启动前，需要准备工作台资源和恢复的原生运行组件。受控资源按[共享资源说明](../packages/astrix-workbench/docs/GitHub运行包.md)和[版本记录](../packages/astrix-workbench/versions/index.json)获取；运行资源保存在未发布草稿中，不在公开 Git 源码内。开发目录布局为：

```text
astrix-agent/
  客户端/workbench/desktop/       Electron 宿主与原编辑器适配
  客户端/workbench/tools/         原生隔离与桌面验收工具
  网页端/workbench/server/        工作台服务
  网页端/workbench/public/        已准备的界面资源（忽略）
  网页端/workbench/plugins/recovered/  已准备的生成器（忽略）
  packages/astrix-workbench/      共享路径、版本与验证
  M0-AI-recovered/               已清理的恢复运行包（忽略）
```

恢复运行包中的旧名称用于识别组件来源。应用显示名为 Astrix。打包后的应用自带所需资源，接收者无需源码或 Node；AI 和 Figma 仍使用接收者自己的配置与账号。

## 当前能力

| 功能 | 客户端中的实现 |
| --- | --- |
| 项目、会话、文件 | 工作台本地服务持久保存；原编辑器可保存项目文件 |
| AI 对话与多 Agent | 共用工作区与模型配置；首次保持演示模式，启用真实模型后才发送模型请求 |
| Figma | 独立会话中的官方页面；Figma 自身提供画布、矢量编辑与多人协作 |
| Figma 修改 | 在目标文件运行 Astrix Figma Bridge，配对后执行；成功以真实插件回执为准 |
| 原编辑器、终端与扩展 | 原 KSCode、独立 PTY 和扩展宿主；市场来源 Open VSX，也可安装本地 VSIX |
| 原设计界面 | `pnpm desktop:legacy`；与工作台可通过应用菜单重启切换 |

Figma 网站登录、Plugin Bridge 配对、模型配置分别完成。登录网站不会自动授予插件写入能力，网页浏览器也不能使用客户端的原生编辑器、终端或嵌入式 Figma 宿主。原编辑器和扩展保持已有的本地隔离边界；扩展另需的网络或二进制不保证可用。

## 原设计界面

```sh
pnpm desktop:legacy
```

该模式保留原 Astrix 首页、设计任务入口、Figma 标签和右侧 Agent。应用菜单“打开完整工作台”可切回默认模式。旧 React、Agent、OAuth 和 Bridge 源码仍在本目录的 `src/`、`server/`、`desktop/main.ts` 等位置。

原设计模式的 Codex CLI / Claude Code / Hermes 和模型 API 配置仍按原文档使用；它们与完整工作台的模型设置不是同一个配置接口。原入口的 OAuth / REST 用于读取，修改仍需对应插件回执。相关说明：[原 Agent](docs/agent.md)、[模型 API](docs/model-api-settings.md)、[原 Figma 工作区](docs/figma-browser-workspace.md)、[浏览器扩展](browser-extension/README.md)。

单人海报延展等原功能入口保留输入解析、模板与 XLSX / CSV 人物表准备能力；图片生成、质量检查与实际成图回填仍取决于已配置服务，不把准备任务等同于生成完成。

## 数据和端口

完整工作台把可写状态与应用资源分开。开发模式默认使用本目录的 `workbench/.local-data/` 保存项目、会话和模型配置，使用 `workbench/.data/<profile>/` 保存 Electron profile；网页端使用其自己的状态目录。启动时不会查找或回退到其他应用目录。正式安装的客户端使用 `~/Library/Application Support/Design Studio/workbench/` 下的工作台数据与独立 Electron profile，不向安装目录写项目、登录或编辑器缓存。原设计模式保留已有 `Design Studio` 数据目录。

可通过 `ASTRIX_STATE_ROOT`、`ASTRIX_DATA_DIR`、`ASTRIX_PROFILE_ROOT` 和 `ASTRIX_WORKSPACE` 明确指定隔离位置；原设计模式的独立验收可设置 `ASTRIX_LEGACY_PROFILE_DIR` 和 `ASTRIX_LEGACY_PORT`（OAuth 配置仍需使用匹配的回调地址）。旧 `M0_LOCAL_*` 参数保留兼容。

完整工作台默认尝试 4317；已被其他实例占用时，未显式指定端口的桌面客户端会选空闲端口，并验证服务的产品、版本、桌面标识和实例 ID。显式 `ASTRIX_PORT` / `M0_LOCAL_PORT` 或 URL 指向旧服务时会报错，不会悄悄连到另一份数据。原设计模式仍使用原 5273 服务；两套聊天和 Bridge 协议不会混在一起。

## 验证与私发包

```sh
pnpm test
pnpm desktop:typecheck
pnpm desktop:bundle
pnpm test:workbench-ui
pnpm test:workbench-terminal
```

原生界面检查使用独立 profile、后端和工作区，并会打开临时测试窗口。市场联调另用 `pnpm exec electron workbench/tools/test-native-editor-marketplace.cjs`，会在隔离扩展目录中下载、安装和卸载测试主题。

```sh
pnpm desktop:prepare:resources
pnpm desktop:pack:mac
pnpm desktop:dist:mac:private
```

资源准备器按白名单复制桌面宿主、网页服务与界面、共享路径文件及恢复的原生组件到忽略的 `.workbench-bundle/`，生成清单并校验恢复依赖。electron-builder 把它们放到 `Contents/Resources/workbench` 和 `Contents/Resources/recovered`；运行时通过共享路径配置读取。

`desktop:pack:mac` 生成并验收 `release/mac-arm64/Astrix.app`；私发命令生成 DMG、安装说明和 SHA-256。两者均为本机临时签名包，不代表 Apple 正式公证发行。当前恢复组件仅提供 darwin-arm64，正式 universal 命令会明确拒绝，不能用 Intel 外壳冒充完整原生支持。

资源包、安装包、账号状态、模型密钥、项目、会话、缓存和诊断不进入公开 Git。首次使用和系统提示见[安装与首次使用](docs/private-install.txt)。
