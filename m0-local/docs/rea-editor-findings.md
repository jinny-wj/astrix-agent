# 原版 KSCode 编辑器恢复调查

本轮静态读取恢复包、检查文件和原生模块类型，并由主任务执行了受限的原编辑器 server 探针；没有启动原 M0 AI、原主进程、原 preload 或 OpenCode。

**结论：原编辑器主体实际在安装包中，本机 server 和原 renderer 都已在新 Electron 中启动，原 Monaco 界面真实打开了工作区 README。** 本报告先记录独立实验；后续已经将原编辑器接入桌面主工作台，浏览器模式继续使用本地文本编辑器。扩展、diff 和终端尚未完成验证。

## 已恢复的实物

| 组件 | 证据 |
| --- | --- |
| 原包装层 TypeScript | [main.ts](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/app/node_modules/@ks-m0/kscode/src/main.ts:33)，有 KSCodeFactory、KSCodeService 和事件、编辑、diff、终端方法 |
| 编辑器 HTML 入口及脚本顺序 | [workbench.kscode.html](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/resources/editor/out/vs/code/browser/workbench/workbench.kscode.html:30) |
| 本地编辑器 server 启动器 | [server-main.kscode.js](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/resources/editor/out/server-main.kscode.js:4)，导出 `startupMain` |
| agent server 及导出服务工厂 | [server.main.js](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/resources/editor/out/vs/server/electron-main/server.main.js:169) |
| UI、文件管理、编辑器服务及宿主桥 | [workbench.web.main.js](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/resources/editor/out/vs/workbench/workbench.web.main.js:2229) |
| 工作区与 remote authority 配置 | [workbench.kscode.js](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/resources/editor/out/vs/code/browser/workbench/workbench.kscode.js:3) |

`Resources/editor/product.json` 标记版本 `1.83.18`，基于 Code OSS；这不是 M0 AI 客户端版本。`out/vs/webPackagePaths.js` 中列出的 **17 个浏览器依赖入口均存在**；`extensions/` 有 **88 个条目**。这些检查不等于全部扩展可运行。

`node-pty`、`@vscode/spdlog`、`native-watchdog`、`@parcel/watcher` 的已分发 `.node` 文件都是 macOS arm64 Mach-O。`node-pty` 和 `spdlog` 导出 N-API 注册符号；终端还依赖随包的 `node-pty/build/Release/spawn-helper`。这些是现成运行组件，重新从 TypeScript 编译它们不是最小启动路径的前提。

## 原来的本地启动链

1. `createKSCode({useDataPath})` 创建单例工厂，见 [index.ts:5](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/app/node_modules/@ks-m0/kscode/src/index.ts:5)。工厂生成 Unix IPC 路径，见 [main.ts:45](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/app/node_modules/@ks-m0/kscode/src/main.ts:45)。
2. 设置 `KSCODE_SOCKET_IPC_HANDLE`、`KSCODE_EXTENSION_IPC_HANDLE`、`VSCODE_AGENT_FOLDER`、`VSCODE_PARENT_PID`，然后导入 `editor/out/server-main.kscode.js` 并调用 `startupMain()`，见 [main.ts:59](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/app/node_modules/@ks-m0/kscode/src/main.ts:59)。
3. `startupMain` 在 `KSCODE_SOCKET_IPC_HANDLE` 监听 Unix socket，经 AMD loader 加载 `vs/server/electron-main/server.main`。返回对象包含 `agentServer` 和 `getDevtoolsExports`。这是本机编辑器服务，并不要求先运行原 M0 的模型网关或 NestJS 服务。
4. 界面打开 `workbench.kscode.html?remoteauthority=<projectId>&folder=<绝对工作区路径>`。路径定义见 [config.ts:22](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/app/node_modules/@ks-m0/kscode/src/utils/config.ts:22)。原外层 UI 拼接方式位于恢复的 `index-v2-BGt4TMzj.js:1090`。
5. renderer 的自定义 socket factory 直接调用 `AMDLoader.global.nodeRequire("net")`，读取 `process.env.KSCODE_SOCKET_IPC_HANDLE` 并连接同一 Unix socket，见 [workbench.web.main.js:668](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/resources/editor/out/vs/workbench/workbench.web.main.js:668)。原生管理连接以 `clientId: "renderer"` 建立，见同文件 2011 行。
6. renderer 注册 `devtoolsExport` IPC channel，调用 `devtoolsExportReady.ready`；main 端以 projectId / remoteAuthority 匹配 renderer，取得其服务代理，见 [server.main.js:158](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/resources/editor/out/vs/server/electron-main/server.main.js:158)。因此 `getDevtoolsExports()` 能构造代理不等于 frame 已就绪，实际方法可能等待 renderer ready。

`KSCODE_EXTENSION_IPC_HANDLE` 是原包装层设置的第二个路径，本轮在 editor 分发 JS 中未命中对该变量的直接读取。**已经证明启动器立即要求的是主 socket；不能把第二路径也断定为启动必需项。** 探针沿用两个变量，但不会打开或复用原软件的 socket。

## 为什么直接替换 iframe 地址还不够

当前本地项目的主页面是 HTTP、`nodeIntegration:false`、隔离 preload 的普通网页。原编辑器 renderer 使用 Node `net` 和 `process`，所以不是独立的纯浏览器编辑器页面。

原客户端的窗口配置明确设置 `nodeIntegration:true`、`nodeIntegrationInSubFrames:true`、`contextIsolation:false`、`webSecurity:false`，见 [主进程 4597 行](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/app/out/main/index.js:4597)。原 UI 还会把父页面的 `process` 交给编辑器 iframe。新工程没有照搬这些全局权限。

适合下一步的结构是：**保持现有页面的隔离，单独创建只加载恢复包本地文件的编辑器窗口或嵌入视图，给它完成本地 Node socket 接线。** 不应为了一个编辑器，把整个恢复网页都改成可访问 Node 的远端宿主。

原主进程还注册了几种资源协议，见 [主进程 11112 行](/Users/zhangye/Desktop/ceshi/M0-AI-recovered/extracted/app/out/main/index.js:11112)：

- `vscode-remote` 把资源 URI 映射到本机绝对文件路径。
- `vscode-webview` 允许固定的扩展 webview 入口与 service worker。
- `kscode-fetch` 负责 NLS 消息和其他由宿主注册的资源 handler。

最初可以只验证文件树、打开和编辑文本，随后补 webview、NLS、扩展和终端。原协议实现的任意绝对路径映射需要在新宿主中收窄到测试工作区和编辑器资源目录。`workbench.kscode.html:45` 还保留外部翻译服务 URL，需要在离线运行时明确处理本地语言资源或记录失败。

## 隔离探针

已新增 [probe-authentic-editor.cjs](/Users/zhangye/Desktop/ceshi/m0-local/tools/probe-authentic-editor.cjs)。普通 `node tools/probe-authentic-editor.cjs` 只打印用法，已经通过语法与默认路径检查。主任务随后执行了 `--run`，**真实 server 探针通过**。

主任务可在项目根目录选择执行：

```sh
./node_modules/.bin/electron tools/probe-authentic-editor.cjs --run
```

它使用新安装的 Electron，只 require 恢复的编辑器 server 启动器；数据和两个 socket 路径都在 `.local-data/editor-original-probe/`。它不打开 renderer，不启动原客户端、原 preload、OpenCode、终端或扩展子进程。JavaScript 层拦截 TCP、HTTP、TLS、DNS、fetch 和 child_process，20 秒超时；结果写入 `diagnostics/authentic-editor-server-probe.json`。这些拦截不是对原生模块系统调用的操作系统沙箱证明。

实测 [authentic-editor-server-probe.json](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/authentic-editor-server-probe.json) 为 `ok:true`、`socketExists:true`、`hasAgentServer:true`、`hasDevtoolsExportsFactory:true`，`blocked:[]`；返回键为 `agentServer` 和 `getDevtoolsExports`。该实验没有启动 renderer。

## 缺失项应如何分类

| 范围 | 当前判断 |
| --- | --- |
| 原编辑器 UI / server 的实际实现 | 编译代码与资源已在恢复包中，适合直接启动验证 |
| 外层框架如何启动、传 projectId、传工作区、转事件 | 相关原始 TS 和主进程代码已找到，需要移植到独立宿主 |
| diff、接受/拒绝、终端等能力 | 原 API 和实现在包内；终端、扩展与 watcher 已在后续实测跑通，diff 接受/拒绝仍需单独验证 |
| 原始未压缩 VS Code/M0 维护分支、完整构建仓库 | 没有因为拿到分发包而恢复，当前仍主要是编译实现 |
| 内部扩展市场、在线服务、Figma 远端能力 | 与本机编辑器运行分开，仍需具体服务与独立接入 |

## 原 renderer 真实运行结果

新增 [open-authentic-editor.cjs](/Users/zhangye/Desktop/ceshi/m0-local/tools/open-authentic-editor.cjs)、[独立 preload](/Users/zhangye/Desktop/ceshi/m0-local/tools/authentic-editor-preload.cjs) 与 [网络及子进程限制](/Users/zhangye/Desktop/ceshi/m0-local/tools/authentic-editor-guard.cjs)。它们不加载原客户端主进程或原 preload。

```sh
# 自动验证并退出，保留截图与结果
./node_modules/.bin/electron tools/open-authentic-editor.cjs --run --smoke-test

# 保持独立原版编辑器窗口，工作区仍限定为实验 README
./node_modules/.bin/electron tools/open-authentic-editor.cjs --run --interactive
```

2026-10-23 已实际运行上述 smoke 命令，结果在 [authentic-editor-window.json](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/authentic-editor-window.json)：

- `ok:true`、`serverReady:true`、`openEditorResolved:true`、`readmeVisible:true`。
- 原 `getOpeningFilesStat()` 返回 `.local-data/authentic-editor-window/workspace/README.md`，authority 为 `isolated-local-probe`，`isDirty:false`。
- DOM 中有真实 `.monaco-editor`，页面标题为 `README.md — workspace — Code - OSS`，截图显示原文件树、原标签页、行号、缩略图和 README 内容。
- renderer 控制台无 error；主进程记录了被限制的扩展宿主、文件 watcher、shell 环境解析与 pty host 子进程请求。限制保持生效，未为截图放开终端或扩展 host。

![隔离运行的原 KSCode 编辑器](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/authentic-editor-window.png)

HTML 加载器另存于实验目录，只调整资源 base 与语言回退；编辑器 `workbench.web.main.js`、`workbench.kscode.js`、CSS、server bundle 仍直接使用恢复包原件。默认使用随包英文 NLS，不访问在线翻译服务。尝试接入中文消息常量后，原 AMD loader 出现重复 NLS 定义并使 renderer 未完成启动，真实失败保留在 [NLS 尝试报告](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/authentic-editor-window-nls-attempt.json)；没有把这个语言接线问题描述成编辑器主体缺失。`--locale=zh-cn` 保留该实验路径，默认不启用。

后续桌面整合已完成：`desktop/original-editor.cjs` 用 WebContentsView 嵌回原聊天工作台，原 server 隔离到独立子进程。实际验证了 Monaco 键入、磁盘保存、切项目、代码/预览切换、模态遮挡、离开页面、立即关闭保存及进程清理；[整合报告](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-integration.json) 为 `ok:true`、16 项断言通过。实现和运行边界见 [desktop-runtime.md](/Users/zhangye/Desktop/ceshi/m0-local/docs/desktop-runtime.md)。diff 接受/拒绝、中文 NLS 和完整产品联动仍需单独验证。终端与扩展的后续恢复见下节。

## 原终端、扩展宿主与 watcher 已接通

原 `server.main.js:104` 的 watcher、155 行的 pty host、164 行的 extension host 都使用原 `out/bootstrap-fork` 与各自 `VSCODE_AMD_ENTRYPOINT`。新版宿主只允许这些明确入口、随包语言服务器和 ripgrep；新增 child preload 把相同网络限制传入 helper，未全局放开 child_process。renderer 继续保持无进程派生权限。

`workbench.web.main.js:2229` 的原 devtools export 已有 `createTerminal`、`switchTerminal`、`sendTerminalCommand`、`getTerminalContent`，其 `gb` 是原 terminal service；新增桌面入口经该服务创建 `/bin/zsh -f`，再沿原 ptyHost/node-pty 显示真实终端。`Y` 是原 extensions workbench service，安装 VSIX 必须传当前 authority 的 `vscode-remote` URI，让本地 Unix 管理通道读取安装包；直接传 `file:` 会错误落入 Web File System Access provider（已实际观察并修复）。

真实证据保存在 [native-editor-terminal.json](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-terminal.json)：13 项断言全部为真，包括 `pwd`/`printf`、正确 cwd、原 extension host、`vscode.json-language-features` 返回 `nativeEnabled`/`nativeTitle`、外部改文件使原 Monaco 更新、本地 VSIX 经原 installer 解包后激活并提供 `originalVSIXWorks` 补全，以及 helper/shell 全部退出。测试只替换系统文件 picker 的选择结果，未替换 installer、语言 provider 或 pty 输出。截图分别为 [原终端](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-terminal-content.png) 与 [原扩展面板](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-extensions-content.png)。

目录计数已细分：`extensions/` 的 88 个子目录包含 87 个具有 VS Code engines 声明的扩展与一个共享 node_modules。28 个扩展有 Node main，19 个有 Web browser 入口，部分重叠。当前验证了真实 JSON 语言服务和本地测试 VSIX，并不代表每一个随包扩展、外部 VSIX、调试器或远端市场均已验证。
