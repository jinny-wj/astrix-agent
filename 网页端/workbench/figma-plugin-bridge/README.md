# Astrix Figma Bridge

这是基于 Astrix 固定提交的本地适配；上游文件及 Git blob 标识见 `SOURCES.json`，原执行器留在 `upstream-code.js` 供核对。运行入口只有适配后的 `code.js` 和 `ui.html`。

1. 在 Astrix 项目的 Figma 面板生成一次性配对码。
2. Figma Desktop → Plugins → Development → Import plugin from manifest，选择本机数据目录 `figma-plugin/manifest.json`。
3. 在目标 Figma 文件运行 Astrix Figma Bridge，把配对码输入插件面板对应的客户端或网页版卡片。两端分别生成配对码，绑定同一真实文件后可以同时连接。
4. Astrix 面板显示文件名、会话和实际选区后，方可读写。写命令入队不代表成功；必须收到插件执行回执。

模板的 `id: "m0-local-figma-bridge"` 只是本地标记，不是 Figma 分配的插件 ID，不能用于发布。如果导入要求 ID，先在 Figma 的 **Create new plugin** 流程取得自己的 ID，再把它作为字符串填入上述生成目录的 `manifest.json`。服务会保留你填入的纯数字 ID；再次打开 metadata、准备插件或更换本机服务端口都不会把它覆盖为模板标记。其余运行代码和网络端口仍随本地项目更新。实际导入与官方分配 ID 需要按当前账号正常流程完成；代码测试不能证明导入已完成。

默认客户端服务为 `http://127.0.0.1:4317`，网页版为 `http://127.0.0.1:5273`。从 0.7.3 起，同一个插件实例支持独立连接这两个本机服务；每端独立保存配对与会话，真实选区分发到在线端，命令和回执按来源端隔离。一端断开不阻塞另一端。旧单端凭据只恢复到其原服务地址。自定义服务端口会在准备插件时写入 manifest 及 UI。插件只连接本机，配对码一次性使用、五分钟有效；插件 token 保存在 Figma 的 clientStorage，本地服务只持久化 token 的 SHA-256。撤销配对后旧 token、队列及旧文件会话不能继续执行。插件重开时会用保存的 token 申请新会话；不会读取或复用原 M0/Figma 账号凭据。

只读验收不需要模型：选择已有图层，核对两端在线状态、文件和选区，以及真实上下文读取回执，不修改原稿。

每条命令、拉取、选区上报和回执绑定真实 `fileKey`、插件 `sessionId` 和配对凭据。普通选区修改还检查选区版本和目标节点类型；明确节点模式只操作显式提供的节点。所有写操作通过 Figma Plugin API 完成，可在 Figma 原生撤销。超时、断开或失败不会被当作成功。取消尚未派发的任务能阻止后续执行；已派发的 Plugin API 调用不能保证中断，迟到回执会单独记录。

支持当前选区/节点上下文、显式选中节点、PNG/SVG/JSON_REST_V1 导出、创建 Frame/Text、批量属性修改。Schema 导出返回供恢复 KRN 生成器使用的 `nodeTree/imageMap/componentsMap`：简单 View/Text 保留节点结构，图片、复杂矢量、旋转、混合文字及效果以真实 Figma PNG 保留外观，`metadata.notes` 列出栅格化子树。捕获的是布局位置，不是完整 Figma 组件/约束往返转换。

`enablePrivatePluginApi` 允许本地开发插件读取 `figma.fileKey`。正式发布到 Web 编辑器时需组织私有插件；普通 Community 插件不能直接沿用此私有文件键协议。普通 Figma 嵌入 iframe 不是插件宿主。这里未宣称真实 Figma 账号端到端验证通过；HTTP 和插件代码 VM 测试不能替代实际编辑器联调。

官方参考：

- https://developers.figma.com/docs/plugins/manifest/
- https://developers.figma.com/docs/plugins/api/figma/
- https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/

## 本地服务与联测

`createFigmaBridge({dataDir,port,resolveProject})` 返回 `handle(req,res,url,body?)`、`preparePlugin()`、`getContext({projectId,fileKey,sessionId?})`、`execute({...})`、`close()`。`getContext` 返回扁平 `projectId/fileKey/sessionId/selectionRevision/nodes` 和完整 `selection`。`execute` 只有收到匹配插件回执才完成 `{id,ok,result}`，超时/取消拒绝 Promise；结果中的 `ok:false` 仍是实际失败，不能包装为写入成功。

路由前缀 `/__local/figma/bridge/`：本机 owner 可 GET `status/metadata/selection/context/results/:id`，POST `commands` 入队，POST `pair` `{action:'create',projectId}` 生成码或 `{action:'revoke',projectId,pairingId}` 撤销。插件以 opaque Origin `null` POST `pair` `{code,fileKey,sessionId}`；恢复时用 `{token,fileKey,sessionId}`。之后以 `Authorization: Bearer <token>` 调用 POST `selection/ack`、GET `pull`，正文/查询均包含文件与会话绑定。`selection` 上报 `{fileKey,sessionId,snapshot:{fileKey,sessionId,revision,pageId,nodes,...}}`。`ack` 上报 `{fileKey,sessionId,results:[{id,ok,fileKey,sessionId,changedNodeIds,data?,...}]}`。owner 的状态和结果不返回配对 token/hash。

命令 `type` 为 `read-context/get-node/select-node/export-node/export-schema/create-frame/create-text/patch-nodes`。导出节点要 `nodeId` 和 `format:'PNG'|'SVG'|'JSON_REST_V1'`；`export-schema` 直接返回标准 Schema 到 `result.data`。其余导出为 `result.data={nodeId,format,mimeType,encoding,content}`。写命令必带当前 `selectionRevision`。批量修改还带 `targets:[{nodeId,expectedType,patches:[{kind,...}]}]`；默认锁当前选区，明确节点模式需显式 `lock:'nodes'`。旧的无绑定 `set-characters/set-fills` 和任意 JS 执行均未开放。

运行 `node --test test/figma-bridge.test.mjs`。可复用 `figma-plugin-bridge/test-harness.mjs` 的 `createPluginHarness(fileKey)` 和 `createPluginUiHarness({plugin,baseUrl})`：后者执行真实 UI 脚本，经真实本机 HTTP 服务配对/轮询/回执；前者只是明确的 Figma scene fixture，不接真实账号。示例：

```js
const plugin = createPluginHarness('FigmaFile_123');
const ui = await createPluginUiHarness({plugin, baseUrl: localServerOrigin});
// 由本机 owner API 获取一次性 code，然后运行真实插件 UI 的配对按钮。
await ui.pair(code);
// Agent/owner 入队后推进真实 UI 轮询：HTTP → Plugin API fixture → HTTP ack。
await ui.tick();
```

选区至多同步 100 个节点，摘要文字每层 500 字；截断状态保留在快照。JSON/Schema 导出上限 3 MB，PNG/SVG 单次 2 MB；复杂设计应缩小目标。服务端最多 100 个待执行命令、回执最多保留 500 条记录；重启服务会清空队列与回执。配对凭据可恢复，必须重新上报真实选区后才在线。
