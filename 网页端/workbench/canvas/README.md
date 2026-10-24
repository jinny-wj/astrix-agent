# 本地设计画布

这是为恢复工程新写的设计编辑器，外观与操作参照 Figma 的三栏工作区、页面/图层侧栏、属性面板、浮动工具栏、紫色组件标识和蓝色选择框。原 Figma 静态脚本仍缺少完整且版本一致的启动页、WASM、文件和协同服务；这里没有伪造 `window.figma`，也没有宣称原 Figma 云引擎已离线启动。源码生成真实复用恢复的原 KRN 插件。

原工作台的“设计”标签显示本页面，Code 保持原 KSCode 桌面编辑器/Web 文件编辑器。独立地址为 `/local-canvas/index.html?projectId=项目ID`。不带 ID 时首次载入会绑定服务端解析到的项目并更新 URL；未登记的目录通过 workspaceKey 固定作用域，切目录后拒绝误写。自动保存写所绑定项目的 `canvas.json`，携带内容哈希 revision；冲突时保留内存编辑并提示先导出、再载入，不自动覆盖。

可用编辑功能：

- Frame、矩形、椭圆、多行文字和本地 PNG/JPEG/WebP 图片；图层树、拖动、八向调整尺寸、隐藏/锁定、复制、排序、删除、撤销/重做。
- 多页面创建、重命名、删除与切换；每页有独立节点树，保存整份文档。
- Shift/⌘/Ctrl 点击多选，空白拖动框选，批量属性修改，六向对齐、水平/垂直分布、组合/取消组合。组合保留世界坐标。
- 标尺、平移/缩放及 8px 网格吸附；Alt 拖动可暂时绕过吸附。浮动工具栏支持选择、平移、绘制和图片导入。
- 钢笔 `P` 点击加锚点，拖动新点创建三次 Bézier 曲线，点击首点闭合或 Enter 完成。双击矢量/按 Enter 进入节点编辑，锚点和控制柄可拖动，支持后续线段中点插入、删点、平滑/尖角和闭合切换。结束编辑、换工具或换图层会更新真实边界并保持世界位置。
- 联集、减去顶层、交集、排除使用本地固定版本 Paper.js 0.12.18 的真实几何运算；保留曲线，拒绝开口/锁定/不同父节点的布尔操作。多选“拼合路径”保留独立轮廓，不做联集；单选将基本形状转换为可编辑路径。
- Frame/Group 的水平或垂直 Auto Layout：间距、统一内边距、交叉轴对齐/拉伸、主轴对齐/等距分布。嵌套布局在父层拉伸之后重新计算子层排版。
- 填充、描边、透明度、圆角、旋转和水平/垂直翻转；线性渐变支持两端颜色与角度，导入的中间色标保留。文字字体、字号、字重、行高、字距和水平对齐；图片填充/适应及替换。旋转父层下绘制、拖动、缩放和节点编辑均通过 SVG 坐标矩阵转换。
- 主组件创建 → 资源面板插入实例 → 编辑主组件 → 显式同步所有实例 → 分离实例。同步保留实例位置和名称，其余内容跟随主组件；不是云端组件库或自动双向同步。
- 选择图层后设置“点击跳转”到任一页面的 Frame，通过“演示”打开本地原型，支持跨页、返回和离线 HTML。删除目标会清空悬空链接。
- “版本与协作”打开本地版本、评论、模板、冻结只读分享面板。打开前保存；恢复/应用模板通过同源、来源窗口和项目校验的 postMessage 更新干净画布。有未保存更改时提示导出/重载，避免覆盖。这些历史快照功能与实时协作分开保存。

“实时协作”可开启本机多窗口编辑，通过编辑/只读邀请加入；显示成员、光标与选区，每个窗口保留自己的页面和视口。局域网入口需要主持人显式开启，只暴露邀请与协作所需资源。连接中断或邀请撤销后禁止编辑，未同步设计保留以供导出。协作模式按操作同步，撤销/重做只作用于本人的操作，不用旧的整份文件自动保存覆盖他人修改；同一属性/结构冲突需要明确处理。由 `collaboration.mjs`、`collaboration-state.mjs` 与 `collab-model.mjs` 实现，不是原 Figma 云协同服务。

文件菜单支持本地画布 JSON、M0Schema、Figma REST JSON 和安全 SVG 子集导入，导出 SVG、M0Schema 和完整可编辑画布 JSON。Figma REST 支持多页面、基本节点、文字、部分 Auto Layout，以及明确的 fillGeometry/strokeGeometry、relativeTransform 和线性渐变。绝对坐标转换为相对父节点，不下载外部素材；缺少本地图片正文的远程图片、阴影与未覆盖特性仍提示降级。SVG 导入保留路径曲线、渐变与支持的变换，拒绝脚本、外部 href、事件、滤镜等可执行或不支持内容。M0Schema 中带本地 dataURL 的图片可完整往返；纯 flex 布局仍可能需要手动调整。不是 `.fig` 二进制解析器。

Auto Layout 当前使用固定容器尺寸、统一四边内边距，不实现 Figma 的 Hug contents、单边 padding、wrap 或完整约束求解；源码导出使用已经排好的绝对几何位置。文字由浏览器字体渲染，不复原 Figma 字体服务与复杂排版引擎。组件以显式同步为准，尚无实例局部 overrides 和云端发布。

“生成原 KRN 代码”先保存，服务端按 revision 调用原插件，将 `App.tsx/styles.ts` 写入同项目的新 `generated/canvas-时间戳/`，不覆盖已有代码。图片按稳定 SHA-256 命名，在同目录 `assets/` 落盘。矢量、渐变、旋转/翻转形状生成真实的本地 SVG 素材，服务端仅接受自产安全子集及匹配的内容 SHA；原 KRN 的资源引用与实际文件一致。默认取当前页首个可见 Frame，选中 Frame 可指定导出；无 Frame 时包裹当前页根节点。输出依赖 React Native 和企业组件，原 Snack 预览未恢复。

模型格式仍为 `m0-local-canvas-v1`，现 `version:2`：`{name,activePageId,pages:[{id,name,nodes}],components:[{id,name,mainNodeId}]}`。旧 `version:1` 的根 nodes 自动迁移，不维护冗余 nodes 别名。节点新增 group/image、layout、componentId/componentRole、textAlign/lineHeight/letterSpacing、prototype，以及 path/rotation/flipX/flipY/gradient 字段。路径采用独立尺寸、多个轮廓及相对锚点的 in/out 控制柄；单路径最多 200 轮廓、5000 锚点。最多 30 页、3000 节点、50 层、整份文档 2 MB；单张图片不超过 512 KB，严格限定 PNG/JPEG/WebP dataURL 与内容 magic，不接收任意 SVG 图片/远程 URL；矢量由结构化路径生成独立受校验 SVG。

`model.mjs` 为浏览器与服务端共享的模型；`vector-core.mjs` 提供锚点、柄、渐变与变换，`vector-geometry.mjs` 通过本地 vendor Paper.js 计算几何，`vector-svg.mjs` 实现严格 SVG 导入。没有动态 CDN 代码或原账户上下文。`getResolvedDocument/applyLayouts`、`documentToSVG(doc,{pageId})`、`documentToM0Schema(doc,{pageId,nodeId})` 和 `extractCanvasAssets` 给预览/导出/生成复用。导入文本不执行为代码，SVG 文本与属性转义。

验证：`npm run test:canvas` 覆盖 v1 迁移、多页、坐标/组合/编排、嵌套 Auto Layout、组件同步与分离、图片 SHA/资产与原 KRN 输出、导入往返及 SVG/原型边界。`npm run test:canvas-ui` 自动创建随机端口和临时数据/工作区，依次运行 `ui-check.cjs` 的 14 项兼容回归、`ui-enhanced-check.cjs` 的 13 组控件/原型/版本/作用域操作与 `ui-vector-check.cjs` 的 12 组矢量操作。`node --test canvas/vector.test.mjs` 验证真实布尔面积、曲线插点、变换、钢笔 mode、严格 SVG 和原 KRN 资源输出。`ui-collaboration-check.cjs` 覆盖四个真实窗口、双向修改、个人撤销、光标、只读邀请与局域网加入/撤销。renderer sandbox=true、无 Node。手动执行 Electron 脚本时通过 `M0_CANVAS_TEST_URL` 指向独立临时服务，不要指向用户项目。

证据：`diagnostics/canvas-ui-verification.json`、`canvas-v2-ui-verification.json`、`canvas-vector-ui-verification.json` 与 `canvas-collaboration-ui.json`；截图 `canvas-design-entry-ui.png`、`canvas-v2-ui.png`、`canvas-vector-ui.png`、`canvas-collaboration-ui.png`。原型预览故意采用 opaque sandbox origin，测试用 Electron WebFrameMain 观察其自身 DOM，不放宽产品 CSP。

仍未复原 Figma 的云文件服务、完整 WASM 渲染/排版引擎、实时云权限体系、完整矢量网络/约束、变量与云组件库、插件运行平台或 `.fig` 二进制协议。此处是可在本地保存、编辑、协同和生成代码的新实现；恢复的原 KRN 转换器和原工作台入口仍独立保留。
