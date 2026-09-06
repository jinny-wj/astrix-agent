# Design Agent Chrome Side Panel

这是一个可直接加载的 Chrome Manifest V3 扩展脚手架。它会在
`https://www.figma.com/design/...` 页面启用扩展按钮；点击按钮后，以 Chrome
原生 Side Panel 的形式在真实 Figma 编辑器右侧打开 Agent / Skill 界面。

## 本地安装

1. 使用 Chrome 116 或更高版本打开 `chrome://extensions`。
2. 打开右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `browser-extension` 目录。
5. 本地开发联调：在 Figma Desktop 中选择 Plugins → Development → Import
   plugin from manifest…，导入 `figma-plugin-bridge/manifest.json`。
6. 运行本地项目后，在同一个 Figma 文件中启动「Design Studio Bridge」。插件会
   自动连接，无需再点击“开始轮询”。Chrome Side Panel 可接收 Desktop 当前选区，
   用于验证完整读写闭环。
7. 纯浏览器正式使用：把 `figma-plugin-bridge` 注册并发布为团队私有插件或
   Community 插件，再在 Figma Web 当前文件内运行它。本地开发插件依赖本机文件，
   不能直接在 Figma Web 加载。
8. 回到本项目首页 `http://127.0.0.1:5273/`，点击「新建设计稿」或任意功能卡。
   浏览器会打开官方 Figma，Side Panel 保持在右侧；选中图层后，图层标签会出现
   在输入框上方。

也可以直接打开任意 `https://www.figma.com/design/...` 设计稿，然后在 Chrome
工具栏点击 **Design Agent for Figma** 图标。

扩展没有构建步骤。修改 HTML、CSS 或 JavaScript 后，在
`chrome://extensions` 中点击扩展卡片上的“重新加载”即可。

## 最近 Figma 文件

扩展会记录用户实际打开过的 `https://www.figma.com/design/...` 文件，并在
本机保存以下字段：

- `key`：从 Figma URL 路径解析出的文件 key。
- `url`：用户最近一次打开该文件时的完整地址。
- `title`：浏览器页面标题。
- `lastOpenedAt`：最近打开时间。

记录按 key 去重、最近优先，最多保留 20 条。刷新本地首页后，
`workspace-bridge.js` 会通过扩展消息把列表返回给网页。数据只存放在
`chrome.storage.local`，不会发往网络。

## 权限说明

- `sidePanel`：打开 Chrome 原生侧边栏。
- `declarativeContent`：仅在 Figma `/design/` 页面启用扩展按钮。
- `storage`：保存一次工作区意图、预选 Skill，以及最多 20 条最近文件记录。
- 本地地址访问：Side Panel 只访问 `127.0.0.1:5273` / `localhost:5273`
  上的受控 Bridge 接口，用于读取插件上报的选区、发送结构化修改命令和读取结果。
- 本地站点 content script：只监听
  `127.0.0.1:5273` / `localhost:5273` 发出的工作区消息，不读取页面内容。
- Figma content script：只在 `www.figma.com/design/*` 运行，只读取
  `location.href` 与 `document.title` 以更新最近文件；通过定时比较 URL
  支持 Figma 的 SPA 导航。

扩展没有申请 `tabs` 或剪贴板权限，也不注入或自动操作 Figma 页面 DOM。
真实选区由正在运行的 Figma Plugin API 读取并经过本地 Bridge 同步，网页
content script 仍只读取 `location.href` 与 `document.title`。

本地页面桥接协议：

- 网页发送 `source: "design-studio-web"`、`type:
  "REQUEST_RECENT_FIGMA_FILES"`。
- 扩展返回 `source: "design-studio-extension"`、`type:
  "RECENT_FIGMA_FILES"` 和 `files` 数组。
- 原有 `OPEN_FIGMA_WORKSPACE` / `FIGMA_WORKSPACE_READY` 协议保持不变。

## 当前能力与边界

- Agent / Skills 页签、Skill 选择和工作区意图可用。
- 支持同步 Figma 当前单选或多选图层，并在输入框上方展示图层标签。
- 发送时会锁定 `sessionId + selectionRevision`；发送后再切换图层不会误改。
- 支持替换文字、修改填充色/透明度/尺寸/位置、显隐和重命名；修改完成后
  会在 Side Panel 显示真实 ACK，且可在 Figma 中一步撤销。
- 目前的自然语言解释器是受控规则集，不会执行任意脚本。示例：
  `文字改成「立即购买」，颜色改为 #3366FF，透明度 80%`、
  `尺寸改成 300×200`、`右移 20px`、`隐藏`、`重命名为 主视觉标题`。
- 本地 Bridge 进程和 Figma 插件必须保持运行；OAuth 只负责文件读取，不能
  代替 Plugin API 写入普通设计节点。
