# Astrix 本地工作台

Astrix 工作台使用已恢复的 M0 AI 前端构建，补上独立的本地服务与 Electron 桌面壳。准备运行资源后可在本机启动，项目、会话、模型配置均保存在项目目录中，不需要原公司的 SSO。

正式位置：[jinny-wj/astrix-agent/m0-local](https://github.com/jinny-wj/astrix-agent/tree/main/m0-local)，当前为 **0.6.2**。[版本总表](versions/index.json)保留全部阶段；0.1～0.5 为文档记录，应用源码从 0.6.0 开始保存。版本标签沿用 `m0/history/v版本号` 和 `m0/v版本号` 以保持兼容，旧引用对应关系见[历史导入映射](docs/历史导入映射.json)。后续按[发布流程](docs/版本发布.md)逐版保存准确源码。Astrix 客户端安装包使用[原预览版固定入口](https://github.com/jinny-wj/astrix-agent/releases/tag/v0.1.0-preview.20260906)；仓库的 Latest 当前可能指向 M0 源码记录，不代表新的 Astrix 安装包。

公开 Git 和 `m0/v0.6.2` Release 保存源码与文档。生成的 `public/`、插件转换器、额外静态资源和图标不放入 Git；它们与原编辑器、原 OpenCode、原 LangGraph 和 Skills 通过受限草稿 `m0-runtime/v0.6.2` 单独提供。请先按[运行包说明](docs/GitHub运行包.md)准备对应资源；原引擎恢复目录为 `astrix-agent/M0-AI-recovered/`。`npm ci` 只安装项目依赖，不会取得这些资源、原公司服务或登录资料。

## 启动

新克隆后进入工作台子目录安装依赖，按运行包说明准备资源后启动。资源齐备时也可双击 **启动Astrix.command**：

```sh
git clone https://github.com/jinny-wj/astrix-agent.git
cd astrix-agent/m0-local
npm ci
# 按运行包说明准备受限资源后启动
npm run desktop
```

只启动 Web 版本：

```sh
npm start
```

随后访问 [本地工作台](http://127.0.0.1:4317/home)、[本地设置](http://127.0.0.1:4317/__local/settings) 或 [文件编辑器](http://127.0.0.1:4317/__local/editor)。桌面启动会自动启动服务；如果已有同端口的本地服务，会复用该服务。

端口可通过 `M0_LOCAL_PORT=4318 npm start` 更改。桌面版使用相同环境变量。

`npm run desktop:figma` 会直接打开最近项目的真实 Figma 工作区；没有项目时进入首页。

## 当前可运行的功能

| 功能 | 实现情况 |
| --- | --- |
| 原工作台 Design / Code 外观和页面组件 | 使用恢复出的原 Vue/Vite 构建，静态资源本地化 |
| 项目、会话和历史消息 | 本地 JSON 持久化，支持切换、重命名、删除和历史恢复 |
| 用户、模型列表和工作目录 | 本地兼容接口，不接入原企业账号 |
| 对话 | 默认明确标注为界面演示；可连接自有兼容模型服务 |
| 模型工具 | 本地文件助手或恢复的原 OpenCode 1.17.10；可配置兼容模型服务，文件写入按设置启用 |
| 文件编辑 | 桌面 Code 工作区嵌入原 KSCode / Monaco，自动保存并跟随项目；Web 保留本地文件编辑器 |
| 文件管理 | 新建文件/文件夹、重命名、回收/撤销、JSON 文本文件包导入导出 |
| 网页预览 | Code 面板预览当前项目 index.html 或 dist/index.html，支持 CSS 和浏览器 ES Module |
| 设计转代码、主题导出 | 原 KRN 插件将 M0Schema 转为 App.tsx/styles.ts；原主题插件导出三类 JSON |
| 技能资料 | 浏览、搜索、导出原包 64 份 SKILL.md，不自动启用未接通的工具 |
| Design 真实 Figma 工作区 | 桌面独立会话加载官方 Figma 页面，保留原生图层树、画布、属性栏与协作；项目文件链接持久化，Plugin Bridge 配对和选区上下文；真实账号文件联调范围见下方指南 |
| 真实 Figma 操作与导出 | 配对插件执行文字/颜色/尺寸等修改，必须收到执行回执；真实 JSON/SVG/Schema 导出，Schema 经原 KRN 生成器落盘；AI 修改有独立设置开关 |
| 独立本地设计编辑器 | 旧本地画布源码与数据保留，支持矢量、Auto Layout、组件、本地多人协作和离线原型；不再作为 Design 默认入口，不冒充 Figma 云端 |
| 终端与扩展 | 原 KSCode 终端、内置语言服务、文件监视、本地 VSIX 与 Open VSX 市场；支持搜索、详情、下载、升级和卸载 |
| 桌面窗口及文件夹选择 | 独立 Electron，使用有限 IPC 桥接 |
| 原 M0 企业设计服务、企业资产、图像生成与企业发布 | 企业补丁/服务仍未接入；真实 Figma 由官方页面与新 Bridge 提供，不宣称恢复全部原 M0 私有接口 |
| 多 Agent 工作流 | 使用恢复的 LangGraph 和原提示词，由本地新增调度图完成规划、分工、执行、复核；每角色可调用原 OpenCode |

原页面上仍可能看到尚未接入服务的入口。这些入口不代表相关远端功能已经在本机实现。真实 Figma 的页面登录、文件访问、Bridge 配对和模型服务分别连接；请按 [真实 Figma 接入指南](docs/真实Figma接入.md) 完成目标文件联调。

## 模型稍后配置

按本次选择，默认是 **界面演示模式**，不执行模型推理。演示回复会直接说明这一点。

打开本地设置，选择“连接真实模型服务”，填写服务地址和模型名。支持提供 `/chat/completions` 接口的服务；本机 Ollama 可填写 `http://127.0.0.1:11434/v1`，模型名必须与你实际安装的模型一致。按需填写访问密钥，并点击“测试模型连接”。

密钥只存入 `.local-data/model.json`（文件权限 0600），不会在公开模型配置接口中返回。AI 文件工具限定在当前工作区，默认关闭模型写入文件能力。设置中启用写入后，模型可修改当前工作区里的文本文件。

“执行引擎”可选择恢复的原 OpenCode。它使用上面的模型地址与名称，独立保存引擎会话，不读取原客户端登录配置。真实 Figma 连接后，本地助手和原 OpenCode 都可按设置使用有明确范围的 Figma 工具；原引擎通过每次运行的鉴权 MCP 接入，规划/复核等只读角色不能修改设计稿。默认关闭“允许 AI 修改当前 Figma 文件”；这与“允许模型写入本地文件”是两个独立开关。AI 终端工具与原企业插件没有自动启用。桌面 Code 工具栏中的用户终端已接通。演示模式不会调用真实模型引擎。

Figma 工作区、多 Agent、代码工具、项目与会话、原版 Skills 均可从工作台本地功能入口打开。真实文件中选中一个图层/画板后，“生成原 KRN 代码”会等待插件导出 Schema，再写入同项目的 `generated/figma-…/` 新目录。复杂外观子树可能用 Figma 实际导出的 PNG 保留，结果包含说明；不是完整组件/约束往返转换。KRN 是 React Native 源码，目标工程仍需提供对应组件依赖，不能直接当作 HTML 预览。

## 保留的独立本地画布

原来新增的本地画布仍可通过 `/local-canvas/index.html?projectId=项目ID` 独立使用，旧 `canvas.json` 与版本资料不删除。Design 默认显示真实 Figma，不再显示此编辑器。本地画布中按 **P** 使用钢笔，拖动新锚点生成曲线；选中路径按 **Enter** 或双击进入节点编辑。右侧 Vector 提供联集、减去、交集、排除和拼合；外观面板提供线性渐变，尺寸旁提供旋转和翻转。

点击画布顶部 **实时协作 → 开始实时协作**，再选“打开协作窗口”或生成编辑/只读邀请。默认仅本机；跨电脑时由主持人“开启局域网”，然后重新生成带局域网地址的邀请。每位成员独立切页，撤销仅针对自己的操作。同字段并发会保留草稿并提示导出或使用共享版本。

操作协作使用稳定图层 ID、事务和属性比较，不是完整 Figma CRDT；尚不支持 `.fig` 二进制、完整 Figma 效果和云端账号协作。SVG 使用受限安全子集；原 KRN 通过本地 SVG 素材承载矢量，目标工程需支持 SVG 图片。详情见 [矢量数据说明](canvas/vector-guide.md) 和 [实时协作说明](docs/本地实时协作.md)。

## 项目结构

```text
frontend-tools/  原构建的可重复准备、本地适配与补丁记录
public/          本地生成/解压的前端与静态资源（不提交 Git）
server/          项目/会话接口、SSE 对话、模型客户端、文件接口
desktop/         独立 Electron 主进程与 preload
plugins/         来源清单与隔离执行器；recovered/ 派生构建单独准备
figma-plugin-bridge/  配对插件、标准节点操作与真实 Schema 导出
canvas/          保留的独立本地画布，不再作为 Design 默认界面
workspace/       默认本地工作目录
.local-data/     新建的本地项目/会话/模型配置（不提交仓库）
.data/electron/  本地桌面壳自己的配置与缓存
test/           HTTP、会话、文件隔离和模型协议集成验证
diagnostics/    本工程本地测试截图与诊断（不提交 Git）
```

源码和运行机制说明见 [后端接口契约](docs/backend-contracts.md)、[桌面运行说明](docs/desktop-runtime.md)、[前端准备说明](frontend-tools/README.md)。

修改前端适配后运行 `npm run prepare:frontend`。准备脚本读取相邻 `M0-AI-recovered` 恢复包；已生成的 `public/` 可以独立用于运行。原恢复包、原安装应用均未修改。

## 验证

```sh
npm test
npm run desktop -- --smoke-test
```

集成验证覆盖原页面静态资源、项目和会话、原协议的消息流与历史、文件保存/目录穿越/符号链接隔离、跨来源写入拒绝以及本地模拟模型连接。模型协议测试使用临时本机测试服务，不表示已测试真实外部模型。

真实 Figma 的验证分三层：官方网页/原生宿主 GUI、真实本机 HTTP 与插件 VM fixture、用户账号内真实文件联调。原 OpenCode 已通过 MCP 发现工具并完成插件 fixture 回执链；fixture 中的节点由测试环境提供，不能据此宣称用户的 Figma 原稿已修改。当前具体证据与仍需手动验收的步骤见 [真实 Figma 接入指南](docs/真实Figma接入.md)。

桌面 smoke 会生成 `diagnostics/desktop-smoke.png` 与 JSON。在 Web 服务已启动、模型为演示模式时，运行 `npm run test:ui` 可执行真实界面操作测试：Code → 快速出码 → 发送消息 → 演示回复 → 刷新恢复历史，同时检查本地编辑器。结果位于 `diagnostics/ui-check-result.json` 与相应截图，不读取原 M0 的用户数据。

## 与原软件的关系

这是以恢复构建为基础的本地重建工程，当前版本为 0.6.2。本版将产品显示名称和品牌图统一为 Astrix；真实 Figma、Agent、编辑器与终端功能沿用既有整合。原前端源码地图、完整原始 monorepo、服务端与企业运行环境未取得，因此不能保证与原软件二进制或功能完全等同。修改和新增代码均与原始恢复证据分开保存。

运行版会移除检测出的原内嵌凭据，重定向旧服务请求至本地，并限制页面联网。不要直接替换回原主进程或原 preload 期待本地兼容层自动生效。

## REA 进一步恢复（2026-10-23）

已用 REA 6.7.0 成功完成主进程、Figma bridge 和编辑器入口三组定向静态分析，并新增保存 475 份静态 JS（141.1 MB）。后续已把原 KSCode、原 OpenCode、KRN/主题生成器接入。0.6.0 将 Design 默认入口接入真实 Figma 和 Plugin Bridge，见 [0.6.0 整合说明](docs/本地整合-0.6.0.md)。旧独立画布的矢量和协作记录见 [0.5.0 整合说明](docs/本地整合-0.5.0.md)。0.4.0 补齐独立画布、设计版本与原型，以及真实 Open VSX 市场，详见 [0.4.0 整合说明](docs/本地整合-0.4.0.md)；前一版记录在 [0.3.0 整合说明](docs/本地整合-0.3.0.md)。

证据、复跑命令、覆盖范围及原组件实验说明见 [REA 继续恢复](docs/REA-继续恢复.md)、[原编辑器复核](docs/rea-editor-findings.md) 和 [Figma 复核](docs/rea-figma-findings.md)。这些实验尚未代表原 Figma/企业服务完整可用。

单独打开已恢复的原版 KSCode 编辑器窗口：

```sh
npm run editor:original
```

该独立实验打开自己的 README；正常使用直接运行 `npm run desktop`，即可在主工作台使用已嵌入的原编辑器。当前使用随包英文语言资源；正常工作台中已启用原终端和扩展宿主，独立旧实验仍保留较窄的测试配置。
