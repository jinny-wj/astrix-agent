# M0 本地兼容接口与恢复边界

本模块由安装包随带的控制器、preload schema 和缓存前端 bundle 推导接口，重新实现本地存储。它没有恢复远端服务端源码，也没有启动原 OpenCode Mach-O 或使用原安装包认证配置。

## 接入

```js
import { createM0Api } from './server/m0-api.mjs';
const api = createM0Api({
  dataDir: '/absolute/local/data',
  workspaceRoot: '/absolute/workspace',
  port: 4317,
  getModelConfig: () => ({ mode: 'demo', model: 'local-demo' }),
  chatHandler: async (req, res, url, body, context) => { /* root chat service */ },
});
// body 由外层服务器解析；返回 false 表示这个模块没有处理该路径。
await api.handle(req, res, new URL(req.url, origin), body);
```

`context` 包含 `{api,state,session,createSession,appendMessage,save}`。`api.createSession({projectId,sessionId?})` 返回完整会话；`api.appendMessage(sessionId,{id?,role?,content?,messageRole?,messageContent?,messageEvents?})` 写入持久化历史，返回写入的记录。`api.findSession(id)` / `api.findProject(id)` 返回内存对象，直接修改后需 `api.save()`。

原聊天请求正文使用 `humanMessage`。原消息渲染还要求 `TEXT_MESSAGE_START/CONTENT/END` 共享 `messageId` 与 `chunkDetailId`；只有标准 AG-UI `messageId` 会使该构建忽略文本。用户历史的 `messageContext` 必须至少为 `{}`，因为恢复代码直接访问其子字段。助手历史只重播 `messageEvents`，忽略 `messageContent`。本地 `appendMessage` 默认补足空 context；若助手文本没有事件，生成带这些字段的文本事件和 `RUN_FINISHED`。真实聊天服务应优先传入本轮实际事件。

项目 ID 使用数字。原前端在读取详情时对 ID 使用一元 `+`，UUID 项目 ID 会变成 `NaN`。会话和消息 ID 为字符串。

`state.json` 原子替换保存，存储项目、会话、消息、配置和已选择工作目录。新目录 `dataDir/home/.m0/.spark-project/<id>` 供原前端的 Spark 路径规则使用。`app.getHomedir` 返回这个本地运行目录；不会向用户原 `~/.m0` 写文件。导入代码目录只记录路径；移除项目记录不会删除该代码目录。

新建项目会切换当前工作区。管理目录内的数字项目路径会创建目录并在缺少 `README.md` 时添加项目说明；已有 README 保持原样。用户自行选择的其他目录必须已存在，不创建、添加或覆盖其中的文件。打开项目详情会同步当前工作目录，供中央本地编辑器和聊天工具使用。管理路径拒绝指向本地运行目录外的符号链接。

## HTTP

以下业务路径支持 `/devops-api`、`/api/proxy`、`/api` 或 `/proxy` 前缀，返回直接 JSON 值，无统一 `data` 包壳。

| 方法与业务路径 | 入参 | 返回 |
|---|---|---|
| GET `/project/v2/list` | — | 项目数组 |
| POST `/project/v2/create` | `{type,mode,projectPath?,projectName?}` | 项目，含数字 `id` |
| GET `/project/v2/info` | `projectId` 或 `sessionId` | 项目 |
| POST `/project/v2/update` | query `projectId`，body `{projectName?,projectPath?,cover?,figmaKey?,mode?}` | 项目 |
| DELETE `/project/v2/delete` | `projectId` | `true`；只删除本地记录 |
| GET `/session/list` | `projectId?` | 会话数组，字段含 `id,projectId,title,updatedAt` |
| GET `/session/create` | `projectId?` | `{sessionId}` |
| POST `/session/v2/create` | `{sessionId?,projectId?}` | `{sessionId}`；可把 RPC 已建会话关联到项目 |
| GET `/session/exist` | `sessionId` | boolean |
| GET `/session/history_message` | `sessionId` | 消息数组，含 `messageRole,messageContent,messageEvents` |
| DELETE `/session/v2/delete` | `sessionId` | `true` |
| POST `/message/create`、`/message/update` | `{sessionId,id?,messageRole,messageContent?,messageEvents?}` | 消息 |
| POST `/agent/chat`、GET `/agent/stop` | 原请求 | 委托 `chatHandler`；模块不自行声称做推理 |
| GET `/info`、`/info/version` | — | 本地版本信息 |
| GET `/model/icon` | `name` | `{icon:null}`，未联网查询 |

无需业务前缀的本地接口：

- `POST /__local/rpc`：`{namespace:'opencode',method:'clientCall',args:[...]}`。也兼容 `{method:'opencode.clientCall',args:[...]}`。成功返回直接 JSON 值。
- `GET /__local/models`：`{models:[{model_id,display_name,name,enable,multimodal}],localAdapter:true}`。不含 endpoint 或 API key，供 HTML 的 Kconf globals 初始化。
- `GET /__local/workspace`：`{path,history}`；POST `{path}` 选择存在的目录。
- `GET /devops-api/project/container_available`：`{status:200,adapter:'local-reconstruction',originalEngine:false}`，只表示本地兼容服务可用。
- `GET /rest/users/getUserInfo`：`{data:{name,userName,displayName,mail,avatar},local:true}`。独立本地身份，不代表登录原企业服务。
- Figma token / auth 检查返回明确 unavailable，不构造授权成功。
- `GET /api/coolux/business-space/list` 提供一个明确标记的“本地空间”；已识别的资产列表接口返回真实空列表。它们不包含原企业空间或 Figma 资产。

## Electron / 浏览器桥接 RPC

原 preload 将方法挂在 `window.workspaceAPI` 等对象，并以 `<namespace>:<method>` IPC 调用主进程。本地浏览器 bootstrap 与桌面 preload 改为只调用回环 HTTP。

`api.rpc(namespace,method,args)` 接受 `workspace` 或 `workspaceAPI` 等命名。已实现：

- `workspace.getCurrentPath/getHistory/selectPath/updateAndRestart`；`cli.getCwd/switchCwd/getVersion/getPorts`。所有接口共享同一 workspace 状态。
- `app.getInfo/getHomedir/getMainWindowBounds/getPreloadPath/getKscodeFramePath`。
- `devUser.get/set/clear`。仅本地显示身份，不保存传入 token。
- `config.get/set/merge/getDesignSystem/getLocalDesignMd`。支持 scope `global/local`、点号路径；拒绝原型污染键。
- `opencode.getStatus/clientCall/get/set/listSkills/getSkillRegistry/syncSkillsByScope`。
- `kscode.switchProject` 切换本地 workspace。它没有加载 KSCode 原编辑器。
- Deeplink 启动通知、Figma / IPC 状态的最小响应。

未实现的工具与方法抛出 `501`，不返回伪造成功。

`opencode.getStatus.connected:true` 指已连接本地接口。默认本地文件助手返回 `adapter:'local-reconstruction',originalEngine:false,managedServer:false`。选择恢复的原版 OpenCode 时返回 `adapter:'original-opencode',originalEngine:true,executionMode:'per-run-cli'`；`managedServer` 仍为 `false`，因为每轮通过 CLI 启动原引擎，没有常驻的原 OpenCode HTTP 服务。这些状态不表示 LangGraph 或 Figma 云工具已接通。

`opencode.clientCall` 的结果遵循 SDK `{data:...}` 包壳，已兼容：

| 方法 | 行为 |
|---|---|
| `global.health` | 适配器健康；引擎字段明确 `local-reconstruction` |
| `provider.list`、`config.providers` | `{all:[provider],connected:['wanqing'],default:{wanqing:modelId}}` |
| `config.get/update` | 本地配置 |
| `app.agents` | 默认 `build/plan` 两个本地聊天角色；选择原引擎时仅列真实运行使用的 `build` |
| `command.list/skill.list/tool.list/tool.ids` | 空列表，未假称工具可用 |
| `mcp.status` | 空对象 |
| `session.create/list/get/update/delete/messages/children/status` | 本地会话与消息 CRUD |
| `session.todo/diff/question.list/permission.list` | 空列表 |
| `path.get/project.current` | 当前本地工作目录 |

原模型 selector 只枚举 `wanqing` 和 `wanqing-online-reasoning` provider ID，因此本地模型用 `wanqing` 作兼容命名空间，provider 的 `source` 明确为 `local-reconstruction`。实际推理始终由外层聊天服务的用户配置决定，不发往原模型网关。未配置模型时名称明确为“本地演示 · 无模型推理”。

## 恢复证据

以下文件均在 `M0-AI-recovered` 内，恢复文件保持原样，本地兼容代码位于单独的 `m0-local`：

- `extracted/app/out/preload/index.cjs`：`NAMESPACE_CONFIG` 定义 workspace、cli、app、devUser、config、opencode schema；末尾 `IpcPreloadFactory` 定义 `window` globals 和 IPC channel 格式。
- `extracted/app/node_modules/@m0/cli/src/server/modules/session/session.controller.ts`：`create/v2/create/history_message/exist`；`session.service.ts` 中原业务进一步代理远端服务。
- `extracted/app/node_modules/@m0/cli/src/server/modules/chat/chat.controller.ts`：`POST agent/chat`、AG-UI SSE、`GET agent/stop`。
- `extracted/app/node_modules/@m0/cli/src/server/modules/chat/services/response.service.ts`：原消息保存字段为 `id,sessionId,messageRole,parentId,messageEvents`。
- `web-assets/.../workbench/assets/index-iLbwEgQT.js`：`axios.create({baseURL:'/devops-api'})` 及项目 API、`isInElectron`、端口初始化、用户信息 store、Kconf key、OpenCode SDK 调用。

不能据这些接口恢复远端权限策略、Figma 服务、模型网关、团队数据、计费或完整 Agent 调度。当前实现只替代本地运行必须的持久化与接口契约。

## 已验证

`node --check server/m0-api.mjs` 通过。临时目录集成检查通过：新建 Spark 目录与数字项目 ID、SDK 创建并关联会话、消息历史保存重载、嵌套配置保存、原型污染键拒绝、provider 演示标签、删除会话清理历史并更新项目最新会话。检查不使用恢复文件中的凭据，不请求网络。

随后通过临时回环 HTTP 集成检查：原 `/devops-api` 项目接口、`/api` 会话接口、两种 RPC envelope、消息重放需要的 context/事件字段、可解析的 ISO 日期，以及通过会话查询所属项目。

工作区切换补充检查通过：显式管理路径的目录和 README 初始化、已有 README 不覆盖、已有用户目录保持不变、缺失的用户目录不创建、详情读取同步当前项目、管理路径符号链接越界拒绝。

## 当前编辑器和管理功能

`GET /__local/editor-context` 是原 KSCode 桌面接入使用的只读状态：`{workspace,project,revision,entryFiles}`。`workspace` 为当前绝对目录；`project` 仅含当前项目公开元数据；`revision` 只在工作区或活动项目改变时增加；`entryFiles` 优先列出 README。桌面编辑器用这个状态选择目录，不接受渲染页面任意传入目录。

`/__local/projects` 提供项目和会话的打开、重命名、删除。会话重命名使用 `POST /devops-api/session/v2/update?sessionId=... {title}`；项目使用原 `/project/v2/update`。删除活动项目会选择其他有效项目或默认工作区；项目文件保留，关联的本地会话和消息记录删除。

`/__local/editor` 提供实际接通的文件操作，桌面原编辑器与这页共享当前工作目录：

| 接口 | 行为 |
|---|---|
| POST `/__local/directory` `{path}` | 创建当前工作区内的文件夹 |
| POST `/__local/file/rename` `{path,newPath}` | 重命名或移动，不覆盖已有路径 |
| DELETE `/__local/file?path=...` | 移到 `dataDir/trash`，返回 `trashId` |
| POST `/__local/file/restore` `{trashId}` | 恢复本工作区的删除，不覆盖已有路径 |
| GET `/__local/project/export` | 导出可见 UTF-8 文本文件 JSON 包，报告跳过项 |
| POST `/__local/project/import` `{files:[{path,content}]}` | 导入文本文件，先校验所有路径；已有文件不覆盖 |

文本包最多 500 个文件、4 MB 正文、单文件 2 MB；导出跳过符号链接、二进制、隐藏文件和依赖目录。文件操作拒绝根目录删除、路径越界、符号链接越界。导入冲突不会先写入部分文件。回收站记录只可在其原工作区恢复。

`POST /__local/generate/krn {schema}` 和 `/__local/generate/theme {theme}` 委托恢复插件的本地隔离适配器，返回生成文件；插件资料、输入限制及原代码来源见相应插件模块。生成结果通过上述导入接口进入真实项目目录。

新增 `test/local.test.mjs` 集成检查验证活动项目切换、只读 revision、项目/会话重命名和删除、删除记录后保留项目文件、文件夹/重命名/回收与恢复、文本包导入导出、批量冲突不部分落盘和路径越界拒绝。管理页与编辑页所有内嵌 JavaScript 均通过语法检查。

## 0.4 设计接口

`GET/PUT /__local/canvas?projectId=…` 读取/保存明确项目的画布。PUT 必须携带 `{document,expectedRevision}`；不存在时修订号为 `null`，存在时为文件 SHA-256。旧 v1 文档读入后迁移到 v2 多页面格式。保存与版本恢复共用项目锁、修订比较及原子文件替换。

`POST /__local/canvas/generate?projectId=…` 携带 `{expectedRevision,directory,nodeId?}`，使用保存的文档调用原 KRN 插件；同时写入生成代码引用的已校验图片素材。公开文本项目导入仍仅接受字符串；内部图片生成路径不会把二进制权限暴露给 HTTP 参数。

`/__local/design-cloud` 为本地版本与协作页面，其 JSON 接口在 `/__local/design-cloud/api/` 下：`state`、`versions`、`versions/:id/restore`、`comments`、`comments/:id`、`templates`、`templates/:id/apply`、`shares`、`shares/:token`、`export`。所有管理请求都绑定 `projectId`，版本/模板/分享创建和恢复/应用都检查当前画布修订。评论状态变更另用 `expectedVersion`。

`GET /__local/design-share/:48hexToken` 展示创建时的冻结快照，可撤销；`?mode=prototype` 为交互原型，`?download=1` 为独立 HTML。`GET /__local/design-preview?projectId=…[&startId=…]` 演示当前保存的画布，`download=1` 导出离线原型。演示文档受不含同源许可的 sandbox 限制，导航脚本无网络及项目 API 权限。服务仍只监听 `127.0.0.1`。
