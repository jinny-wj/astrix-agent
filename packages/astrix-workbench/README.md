# Astrix 工作台共享配置与验证

当前版本 **0.7.2**。工作台实现已实际拆入同仓库的两端，这个目录只保存路径配置、测试、版本、文档和打包发布工具，不再是第三套应用。

| 目录 | 实际职责 |
| --- | --- |
| [网页端/workbench](../../网页端/workbench/) | 浏览器界面、本地服务、项目/会话、Agent、多 Agent、生成器、保留画布与 Figma Bridge |
| [客户端/workbench](../../客户端/workbench/) | Electron 宿主、原编辑器、终端/扩展、原生隔离与桌面验收工具 |
| 当前目录 | 统一路径、版本记录、Node 回归、资源归档与受控发布 |

两端使用各自正式入口；原 Astrix 客户端和网页版的功能继续保留。源码移动关系见[迁移映射](docs/源码迁移映射.json)，旧版本标签与笔记不改写。

## 运行

先按[资源与运行包说明](docs/GitHub运行包.md)准备受限资源，然后从仓库根目录选择一端：

```sh
cd 网页端
pnpm install
pnpm dev
```

或：

```sh
cd 客户端
pnpm install
pnpm desktop:dev
```

工作台只从上述两端启动；浏览器与 Electron 具有不同能力，原生编辑器、终端/扩展宿主需要桌面环境。共享目录仅用于配置、验证与发布。Figma 登录、文件权限、插件配对和模型配置仍需自行完成，详见[真实 Figma 接入](docs/真实Figma接入.md)。演示模式不会调用真实模型。

## 验证与发布

```sh
cd packages/astrix-workbench
npm test
npm run release
```

`npm test` 覆盖共享 Node 回归和相关策略/生成器检查；两端还应运行各自测试，桌面能力另用隔离界面验收。`npm run release` 默认只校验，正式发布与受限资源打包见[版本发布流程](docs/版本发布.md)。

[版本清单](versions/index.json)保存逐版记录。0.1～0.5 是缺少旧源码快照的历史文档；0.6.x 的源码与证据保留原有标签。0.7.0 起共享记录对应两端实际源码和布局 2 资源。兼容标签继续为 `m0/v版本号`，受限资源留在 `m0-runtime/v版本号` 草稿，公开源码 Release 不附带运行组件。

## 路径与数据

使用 `layout.cjs` 取得仓库、网页端、客户端、共享目录和恢复包位置，不在业务文件中反复计算 `../`。开发时恢复包统一为仓库根 `M0-AI-recovered/`；私有客户端构建使用经过白名单整理的资源目录。

开发时客户端使用 `客户端/workbench/.local-data/` 和 `.data/<profile>/`，网页端使用 `网页端/workbench/.local-data/` 和 `.data/<profile>/`；两端不自动探测其他工程目录。安装版使用客户端自身的 Electron 用户数据目录。

可用 `ASTRIX_STATE_ROOT`、`ASTRIX_DATA_DIR`、`ASTRIX_PROFILE_ROOT`、`ASTRIX_WORKSPACE` 和 `ASTRIX_DIAGNOSTICS_DIR` 显式指定位置；旧环境变量别名仍支持明确配置，不代表旧目录回退。项目、模型配置、Figma 登录和配对令牌属于用户数据，不复制进 Git 或资源附件；目录整理不能当作删除或重置这些数据的理由。
