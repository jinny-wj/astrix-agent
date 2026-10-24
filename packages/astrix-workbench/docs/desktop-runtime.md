# Astrix 双端工作台的桌面运行

0.7.0 的桌面实现实际位于 `客户端/workbench/`，浏览器界面与本地服务位于 `网页端/workbench/`。正式客户端使用自己的启动与打包流程接入这些代码，共享目录只保存配置、版本和验证。

## 启动与实例

准备[运行资源](GitHub运行包.md)后，在仓库的 `客户端/` 执行：

```sh
pnpm install
pnpm desktop:dev
```

也可双击该目录的 `启动Astrix.command`。原客户端界面保留为兼容入口；工作台采用实际版本和实例身份校验，不因为旧端口上恰好存在 HTTP 服务就误连另一套应用。

`ASTRIX_PORT` 可指定端口；`ASTRIX_URL` 只接受无认证信息的本机 HTTP 地址，并要求目标是相同版本、相同桌面实例。旧 `M0_LOCAL_PORT`、`M0_LOCAL_URL` 等名字继续作为兼容参数。未指定端口时客户端可以选择自己的空闲端口，避免与独立网页端混用状态。

路径由共享 `layout.cjs` 解析。开发恢复包是仓库根 `M0-AI-recovered/`；私有打包时先按白名单准备 ignored 的 `客户端/.workbench-bundle/`，由构建流程带入需要的资源。已有旧工作台数据与登录 profile 按兼容规则保留，不把配置或项目复制进安装包。

## 桌面与浏览器边界

主页面通过有限 preload 使用窗口、工作区选择、真实 Figma 宿主和原编辑器能力。IPC 校验本地主窗口及主 frame；官方 Figma 页面在独立 sandbox/context-isolated 容器中，不能获得本机 Node 或主窗口 preload。

原 KSCode 的 renderer/server、PTY、扩展宿主和文件 watcher 由 `客户端/workbench/desktop/` 与 `tools/` 运行隔离。它需要实际 Electron 宿主，不能只把启用 Node 的视图嵌进普通浏览器。网页端继续使用浏览器可用的文件界面和本地服务，原生终端/扩展属于桌面能力。

Code 原视图使用当前项目的真实目录，切换项目、导航、关窗和退出时等待脏文件保存。预览或模态窗口会暂时隐藏原生视图；真实 Figma 与 Code 容器互斥。交互终端使用独立 shell 配置与项目目录；扩展和语言进程只允许明确的本地入口，公开 Open VSX 市场具有专门的有限请求通道，不等于允许任意联网。

恢复的原 OpenCode 通过工作台配置与受限工具运行，不启动原公司主进程或读取原账号配置。演示模式明确标记，不作为真实模型调用结果。

## 验证

共享 Node/策略与生成器检查：

```sh
cd packages/astrix-workbench
npm test
```

桌面实际界面检查在 `客户端/` 使用：

```sh
pnpm test:workbench-ui
pnpm test:workbench-terminal
pnpm test:workbench-figma
```

这些检查应使用独立 profile、临时数据和空工作区。终端验收要核对真实 PTY 输出、原扩展宿主与进程清理；原编辑器依赖的 native 模块必须在最终客户端 Electron 版本下验证。截图或协议 fixture 不能代替用户真实 Figma 文件写入验收。

旧阶段的检查数量见对应版本笔记和历史证据；本版结果单独记录。原始诊断留在本机 ignored 目录，不上传 Git。真实 Figma 的登录、插件配对、回执与模型配置见[接入指南](真实Figma接入.md)。
