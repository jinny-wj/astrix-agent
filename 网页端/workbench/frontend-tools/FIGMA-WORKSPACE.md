# 真实 Figma 工作区适配

Design 默认显示官方 Figma 页面，由 Electron 独立 session 的 WebContentsView 提供原生图层树、画布和属性面板。`figma-workspace.html` 只是文件链接、连接状态和 Bridge 控件；不嵌入只读 Figma iframe，不以旧本地画布替代原生编辑器。网页端通过“在 Figma 打开”进入官方文件，再连接插件。

这里的工作区前端宿主适配为新写；配套 Plugin Bridge 基于 [Astrix](https://github.com/jinny-wj/astrix-agent) 固定提交派生，上游执行器和来源清单保存在 `../figma-plugin-bridge/upstream-code.js`、`SOURCES.json`。不导入历史 M0 凭据、企业代理和修改过的 Figma 核心。真实页面会正常从 Figma 取得自己的运行时，因此不以恢复旧 WASM 为前提。

## 宿主与消息

父 recovered renderer 挂 `iframe[data-m0-figma-workspace-frame]`；子页面 `div[data-m0-figma-host]` 是唯一 native 覆盖区。父 `local-runtime.js` 验证 `event.origin`、`event.source`、iframe路径和 projectId，计算 iframe+子容器的主窗口坐标，再调用 `m0LocalDesktop.figmaHost`。子页面若独立作为桌面主页面打开，则直接使用同一窄接口。

子→父 `{source:'m0-local-figma',type,payload:{projectId,...}}`：

- `ready`：请求 `capabilities`。
- `host-request`：`action:show|hide|suspend|resume|layout|openExternal|revealBridgePlugin`，show可带官方Figma url。
- `context`：`fileKey,sessionId,selectionRevision,targetNodeIds,nodes`。离线或切文件发送空上下文。

父→子 `{source:'m0-local-figma-parent',type:'capabilities'|'host-status'|'host-error',payload}`。`host-status` 来自主进程实际导航与加载事件。Bridge在线状态来自本机服务，不用网页ready冒充插件ready。

父仅对白名单 POST `/api/agent/chat`、`/__local/chat`、`/__local/workflow/run` 的JSON正文附加当前可见Design项目的 `figmaContext`；不覆盖调用方已经显式提供的上下文，不把旧上下文换到其他项目/文件/会话。服务器仍需校验真实session和权限。

## 服务契约

- `GET/PUT /__local/figma/workspace?projectId` → `{projectId,url,fileKey,bridge?}`；PUT `{url}`。UI首次解析并固定项目ID，只有正式文件链接自动持久化；无文件时加载官方files首页。
- `GET /__local/figma/metadata?projectId` → `{pluginDirectory,manifestPath,port,baseURL,projectId}`。
- `GET bridge/status?projectId` → `{sessions:[{fileKey,sessionId,online,documentName,...}]}`。
- `POST bridge/pair` `{action:'create',projectId}` → `{code,expiresAt,pluginDirectory}`。用户在插件输入一次性配对码；工作区不取得插件token。
- `GET bridge/selection?projectId&fileKey&sessionId` → `{selection:{revision,nodes,...},online}`。选择过的会话掉线后保留离线状态，必须手动选择新会话。
- `POST bridge/commands` → HTTP202 `{commandId,status:'pending'}`。所有请求绑定project/file/session/selectionRevision；UI面板打开时冻结完整作用域。
- `GET bridge/results/:id?projectId&fileKey&sessionId` → `{pending,status,result?}`。只有匹配文件/会话且`result.ok`才显示成功。导出从`result.data`实际正文下载，不下载预览占位。

手动命令：`patch-nodes` + `replace-text`、`set-fill-color`、`resize`；`export-node` + `JSON_REST_V1|SVG`。批量修改为atomic。选区变化后禁止继续使用旧面板；收到本人操作回执后，仅在文件、会话和节点集合未改变时刷新该面板的版本。

“生成原 KRN 代码”只对一个真实选中节点启用。它携带同一冻结scope和nodeId请求 `POST /__local/figma/generate?projectId`；服务等待插件实际导出Schema，再调用恢复的原生成器并写入项目新目录。UI展示真实返回的files/assets/directory并允许下载完整结果包。它不把本地画布替身作为真实Figma导出。

AI写入是独立的 `allowFigmaWriteTools` 开关，默认由服务器设置控制。明确的手动按钮不受AI开关影响；插件仍执行真实文件、节点和权限检查。原M0内部SceneGraph、企业组件目录、剪贴板私有runtime等不因此自动恢复。

## 验证与限制

前端准备命令会复制三个workspace静态文件，并严格匹配两处Design组件替换。语法与静态产物检查不等于真实登录/插件端到端通过；实际Figma访问、配对、修改和回执必须在用户正常授权的目标文件中验收。页面不自动开启账号、复制历史Cookie或声称已有完整原M0私有API。
