# 本地桌面运行方式

桌面入口是本项目新建的 `desktop/main.cjs` 和 `desktop/preload.cjs`。它们使用独立安装的 Electron 启动恢复的网页，并在代码工作区内嵌入原版 KSCode。窗口布局沿用隐藏标题栏、左上角原生窗口按钮及约 1480 × 940 的初始尺寸。

## 启动

在项目根目录运行 `npm start` 可用浏览器访问本地版本；运行 `npm run desktop` 可使用桌面窗口。桌面入口会探测 `http://127.0.0.1:4317/__local/health`，存在本项目的服务就复用，否则以 Node 模式启动本项目 `server/index.mjs`。

```sh
npm run desktop
```

可用 `M0_LOCAL_PORT` 改变自动启动端口，或设置 `M0_LOCAL_URL` 连接已经启动的本地服务。`M0_LOCAL_URL` 只接受不带认证信息的 HTTP 回环地址；设置它时不会自动启动其他服务。`--devtools` 用于前端调试。

```sh
M0_LOCAL_URL=http://127.0.0.1:4317 npx electron desktop/main.cjs --devtools
npx electron desktop/main.cjs --smoke-test
```

`--smoke-test` 在加载页面后等待六秒，保存 `diagnostics/desktop-smoke.png` 和 `diagnostics/desktop-smoke.json`，随后退出。JSON 包含加载错误、渲染进程错误与控制台消息；截图生成并不单独证明全部产品功能已完成验证。

完整界面链路检查使用 `npx electron scripts/ui-check.cjs`。该脚本要求服务器处于演示模式，在独立的 `.local-data/ui-check-electron` 浏览器配置中打开 `/home`，点击原界面的 Code 和“快速出码”，在新建的本地项目中发送“本地界面测试”，检查演示回复，再刷新确认会话历史仍可见。它只生成本地测试项目和截图，不触发真实模型调用。结果保存在 `diagnostics/ui-check-result.json`，Code、对话和刷新截图分别为 `ui-check-code.png`、`ui-check-conversation.png`、`ui-check-history.png`。

## 新建的桌面桥接

`window.m0LocalDesktop` 提供 `getInfo`、`getBaseURL`、`minimize`、`toggleMaximize`、`close`、原生文件夹选择 `chooseWorkspace` 及受限邀请窗口 `openCanvasWindow({invite})`。文件夹选择走操作系统对话框，选中结果经 `POST /__local/rpc` 保存到本项目的工作区状态。

0.5.0 画布“打开协作窗口”使用独立 sandboxed BrowserWindow，最多 8 个。协作窗口没有 Node 或桌面/编辑器 IPC 桥接；只允许画布静态资源与邀请协作 API。协作窗口中的新窗口请求仍限制为同源有效邀请页，关闭它不会关闭主窗口。普通设置等链接仍在主窗口打开。

`appAPI`、`workspaceAPI`、`cliAPI`、`opencodeAPI` 等业务接口统一由新建的 `public/local-runtime.js` 适配，浏览器和桌面版本使用同一套实现。preload 不定义这些对象，避免不完整的原生接口覆盖浏览器适配器。`opencodeAPI` 是界面协议层；后端根据所选引擎处理任务。选择原 OpenCode 引擎时，后端按轮运行恢复的 CLI 二进制，不启动原客户端主进程。演示模式与本地简化模型适配器仍单独标记，不能把它们的响应当成原引擎推理。

preload 没有暴露 `window.electron` 标记，前端可继续采用 Web 启动分支。没有公开任意 IPC 通道、任意 Node 执行、原生 Cookie 读取或远端网页创建接口。

## 已嵌入的原版编辑器

`desktop/original-editor.cjs` 将原 KSCode 的 `workbench.kscode.js`、`workbench.web.main.js`、CSS 和本机 server 接入主工作台。网页通过 `m0LocalDesktop.nativeEditor` 报告空容器的 CSS 像素矩形，主进程用 `WebContentsView` 在该区域显示原版编辑器，右侧原聊天和项目导航继续保留。浏览器模式继续使用独立实现的文本编辑器。

编辑器路径只取自本地后端 `GET /__local/editor-context`，不接受网页直接指定任意路径。创建、选择和切换项目后，它按真实项目目录和 projectId 重载。原 server 由 `desktop/editor-server.cjs` 在独立 Electron Node 子进程中运行，通过本机 Unix socket 连接原 renderer，因此网络与子进程限制不会影响主服务的模型请求。

原版编辑器已经验证能读取和编辑本地 README，并实际写回磁盘。它开启 500 毫秒自动保存；切换项目、本地页面导航、关闭窗口和退出时还会显式等待所有分栏的未保存文件落盘，并检查剩余脏文件。保存失败时保留窗口并显示错误。预览、模态窗口和整页离开会隐藏原视图，返回代码后恢复；窗口调整大小时同步容器矩形。本地整页导航按事务串行处理，直到目标主 frame 提交并加载完成才撤销离开放行状态，避免 Electron 的 `loadURL()` 提前 resolve 造成页面留在旧地址。

独立数据位于 `.local-data/native-editor/<profile-hash>/`，不读取原 M0 的用户配置。原 server、extension host、pty host、文件 watcher 以及随包 JSON/HTML/CSS/Markdown/TypeScript 语言服务沿原 `bootstrap-fork` 链运行。只有这些明确的本地入口和随包 ripgrep 可派生进程；主网页仍不能任意执行 Node 命令。扩展宿主的 `os.homedir()` 指向本项目 profile，终端使用 `/bin/zsh -f` 和独立 `ZDOTDIR`/历史文件，跳过用户 shell 配置。macOS helper socket 使用本次进程专属的短 `/private/tmp/m0-kscode-*` 路径，退出时清理。

Code 工具栏增加“终端”“扩展”“安装 VSIX”。终端是原 KSCode 的 xterm、原 pty host 和随包 node-pty，可在当前项目目录交互执行命令。扩展面板沿用原实现，本地 VSIX 通过系统文件选择器交给原 installer，安装到项目自己的 `agent/extensions`。原随包目录有 88 个子目录，其中 87 个是扩展清单（28 个 Node 入口、19 个 Web 入口，部分同时提供两者），另一个是共享 node_modules；没有把这些目录统称为全部已验证的扩展。

原编辑器和原 server 现在只为公开 Open VSX 市场提供专用 HTTPS 通道；扩展宿主、语言服务以及原公司服务仍没有外部网络通道。需要自行启动其他二进制、调试适配器或访问自己在线 API 的扩展仍可能不兼容。终端中的交互命令属于用户明确启用的本机执行能力。语言加载器采用随包英文 NLS；原中文 NLS 接线仍是已记录的缺口。

完整桌面原编辑器检查：

```sh
npx electron tools/test-native-editor-integration.cjs
```

该测试默认使用独立端口 4347、独立 HTTP 数据目录和 Electron profile，可用 `M0_NATIVE_EDITOR_TEST_PROFILE` / `M0_NATIVE_EDITOR_TEST_PORT` 改为新的隔离环境，不改变正常项目。最新实测 [native-editor-integration.json](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-integration.json) 使用 `native-editor-market-final5` / 4356，为 `ok:true`，18 项断言全部通过：原有 16 项覆盖原视图挂载、Monaco 真实键入、磁盘保存、尺寸同步、代码/预览切换、模态遮挡、离开页面隐藏、跨项目隔离、立即关闭保存及 view/server 清理；新增 2 项验证关闭前非活动分栏确实仍脏、关闭后该分栏也已写入磁盘。新增测试关闭自动保存，并用实际鼠标焦点和原生输入分别编辑两个分栏，未用 model 内容替换代替键入。

`node tools/test-local-navigation.cjs` 的 3 项独立回归验证了 `loadURL()` 提前 resolve、目标主 frame 失败及导航超时清理；真实 GUI 报告同时记录了目标提交、完成和关闭前保存的事件顺序。之前诊断到的失败与修正边界保留在 [回归记录](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-regression-history.md)。

[原视图截图](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-integrated-content.png) 由原编辑器 WebContents 单独采集；宿主截图 `native-editor-integrated-window.png` 由主 WebContents 采集，Electron 的这张截图不包含独立 WebContentsView，不能把它当成完整窗口效果。实际桌面显示时两者位于同一个窗口。

终端与扩展的真实链路检查使用 `npx electron tools/test-native-editor-terminal.cjs`，独立端口为 4348。该测试清理并重建它自己的 editor profile，不操作默认 profile。结果 [native-editor-terminal.json](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-terminal.json) 已验证 13 项：工具栏创建终端、shell 路径/参数与独立配置、实际进程 ID、`pwd` 的 cwd、`printf` 输出、原 extension host、内置 JSON 补全、文件 watcher 外部改动、本地 VSIX 解包与激活、该 VSIX 的真实补全 provider、扩展面板，以及所有本次 helper/shell 进程退出。安装测试只为系统 picker 注入测试 VSIX 路径，preload、IPC、原 installer、磁盘写入和原扩展宿主均实际运行。

[终端截图](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-terminal-content.png) 显示原 xterm 的真实输出；[扩展截图](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-extensions-content.png) 显示刚安装并激活的测试 VSIX。两张都直接采集原编辑器 WebContents，未拼接宿主图像。

## 已接通公开 Open VSX 市场

原扩展面板直接使用 [Open VSX 官方的 VS Code gallery adapter](https://github.com/eclipse-openvsx/openvsx/wiki/Using-Open-VSX-in-VS-Code)。搜索、详情、README、下载、原安装器、升级和卸载沿原实现运行。新 launcher 在本地派生文件中覆盖 gallery 配置，原 Resources 保持只读；server 只在自身内存中覆盖同一配置。安装包实际写入本项目 `agent/extensions`，不安装到全局目录。

`desktop/marketplace-network.cjs` 只允许 Open VSX 公共 API 和 gallery 的 GET/HEAD、gallery 查询 POST（浏览器预检仅该查询路径）。下载重定向逐跳检查，资产来源仅为实际官方返回的 `openvsx.eclipsecontent.org` 和已有的 `openvsxorg.blob.core.windows.net/resources/`。请求使用专用 TLS agent，保留证书校验并移除认证、代理认证与 Cookie 请求头。原始 TCP、DNS、任意 URL 与发布/用户管理 API 没有因此开放。该许可不传给 extension host 或语言服务子进程；主工作台仍只访问本地服务。详情 README 引用的其他站点图片可能不显示。

`m0LocalDesktop.nativeEditor.marketplaceStatus()` 返回 `{provider:'Open VSX',enabled,online,lastError,checkedAt}`；`getStatus().marketplace` 同步最近状态。`online:null` 表示尚未验证。市场不可用时，扩展视图明确提示已安装扩展和本地 VSIX 仍可用；`M0_LOCAL_MARKETPLACE=off` 可在启动时关闭市场。

各扩展的许可证在 [Open VSX 元数据与详情](https://www.eclipse.org/legal/open-vsx-registry-faq/) 中列出，兼容性依据扩展 `engines.vscode`。真实联网测试使用 [Dracula 官方主题](https://github.com/dracula/visual-studio-code)，其 Open VSX 元数据为 MIT、`^1.13.0`，适合原编辑器 1.83.18；未改变该版本号或伪装其他产品身份。

```sh
node --test tools/test-marketplace-policy.cjs
npx electron tools/test-native-editor-marketplace.cjs
M0_LOCAL_MARKETPLACE=off npx electron tools/test-native-editor-terminal.cjs
```

独立端口 4354 的 [联网报告](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-marketplace.json) 为 `ok:true`、11 项通过：公开 API、许可与引擎元数据、原 gallery 搜索、原面板结果和详情、README、2.24.2 安装、2.25.1 升级、原主题实际应用、卸载、扩展子进程未获得市场许可。[主题应用截图](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-marketplace-theme.png) 为原编辑器直接采集。网络规则测试 3 项通过；[关闭市场后的报告](/Users/zhangye/Desktop/ceshi/m0-local/diagnostics/native-editor-marketplace-offline.json) 记录离线提示可见，原终端、本地语言服务和本地 VSIX 等 13 项仍通过。

## 原恢复包为何不能直接当开发工程启动

原安装包的 `package.json` 指向 `out/main/index.js`，包含 `workspace:` 和 `catalog:` 依赖，缺少原 monorepo 的构建配置。原主进程在启动时连接公司配置服务、生成 OpenCode 配置并启动工具、编辑器等组件。这部分实际分发代码已经保存在恢复目录，直接运行却仍依赖原网络环境和服务。

原 macOS app 是已打包 Electron，`Contents/Info.plist` 有 `ElectronAsarIntegrity`，其默认入口是 `Resources/app.asar`。不能假定给 `Contents/MacOS/M0 AI` 加一个目录参数就会切换成新项目。为避免误启动原入口，本项目使用单独安装的 Electron，不调用原 app 可执行文件，也不加载原主进程或 preload。

恢复包包含原 OpenCode 的 Bun 内嵌 JavaScript，但它不能直接当作普通 Node 项目导入。当前保留恢复二进制作为原引擎运行路径，另有独立模型适配器；缺少完整原仓库构建链和线上服务仍然是单独边界。原 KSCode 的运行组件已经接入，不再仅停留在静态恢复或独立窗口实验。

## 本地运行边界

桌面主页面数据位于本项目 `.data/electron`，不使用原软件的用户目录、Cookie 或登录状态。`M0_LOCAL_PROFILE` 可指定项目内独立测试 profile 名称。主页面、子资源和 WebSocket 仅允许当前本地服务器的同一地址与端口，`data:` / `blob:` 内容可在页面内展示；原编辑器单独加载恢复的本地组件，并有上述 Open VSX 专用通道。除上述受限协作邀请窗口外，新窗口、非本地导航、摄像头等页面权限默认关闭，本地设置等页面链接会在当前窗口打开。用户配置的模型网络请求由后端发起，因此不会被桌面页面的资源限制阻止。

原公司的认证、更新、云端服务、Figma 桌面联动仍需独立接入。公开扩展市场当前来源为 Open VSX。原客户端副本及其恢复结果仍独立保留在 `../M0-AI-recovered`。
