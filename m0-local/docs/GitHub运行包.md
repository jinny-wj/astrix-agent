# GitHub 源码与可选运行包

Git 仓库保存本地服务、桌面适配、Figma Plugin Bridge、已准备的前端资源和生成器。`npm ci` 后可运行工作台、真实 Figma 和本地模型助手。原 KSCode、原 OpenCode、恢复的 LangGraph 和原技能还需要独立运行包。当前恢复二进制适用 **macOS Apple Silicon（darwin-arm64）**。

运行包发布为 GitHub Release 附件，不放入普通 Git 历史。OpenCode 单个文件超过 GitHub 普通 Git 的 100 MiB 限制。运行包不会携带你的项目、对话、Figma 登录、插件配对、模型密钥或 Electron 用户配置。

## 下载与安装

从对应版本的 GitHub Release 下载：

- `M0-AI-recovered-runtime-v0.6.0.tar.gz`
- `M0-AI-recovered-runtime-v0.6.0.sha256`
- `M0-AI-recovered-runtime-v0.6.0.manifest.json`

仓库 `jinny-wj/m0-local` 为私有仓库，需要有访问权限的 GitHub 账号。已登录 GitHub CLI 时可下载：

```sh
gh release download v0.6.0 --repo jinny-wj/m0-local --pattern 'M0-AI-recovered-runtime-v0.6.0.*'
```

在同一下载目录验证归档：

```sh
shasum -a 256 -c M0-AI-recovered-runtime-v0.6.0.sha256
```

把归档放在源码目录的**上一级**后解压。假设源码目录名为 `m0-local`，最终布局是：

```text
工作目录/
  m0-local/
    package.json
    server/
    desktop/
  M0-AI-recovered/
    runtime-manifest.json
    extracted/
      app/
        package.json
        node_modules/
      resources/
        editor/
        opencode-darwin-arm64/
        skills/
```

```sh
tar -xzf M0-AI-recovered-runtime-v0.6.0.tar.gz
cd m0-local
npm ci
npm test
npm run desktop
```

若本机已经有完整 `M0-AI-recovered` 恢复证据，直接继续使用现有目录即可。请在新的克隆目录旁解压运行包，避免覆盖原始恢复证据或混合不同版本资源。不需要在恢复运行包里执行 `npm install`。

模型默认保持演示模式。真实 Figma 仍需正常登录并按 [真实 Figma 接入](真实Figma接入.md) 安装插件、配对；运行包不会代入任何账号。原 OpenCode 引擎可在本地设置中选择。

## 运行包的范围

打包器只读取以下白名单：

| 路径 | 用途 |
| --- | --- |
| `extracted/resources/editor/` | 原 KSCode 发行文件、语言服务、终端与扩展依赖 |
| `extracted/resources/opencode-darwin-arm64/` | 原 OpenCode 发行文件 |
| `extracted/resources/skills/` | 原技能资料 |
| `extracted/app/node_modules/` 中解析出的依赖闭包 | LangGraph 与 callback 所需的 npm 运行文件 |
| 工作流实际读取的 4 个 prompt 文件 | 规划、代码、设计与总结提示词的来源 |

工作流依赖从 `@langchain/langgraph` 与 `@langchain/core` 开始，按 Node 的嵌套 `node_modules` 查找顺序递归收集 `dependencies`、`optionalDependencies` 和 `peerDependencies`。保留已安装的可选依赖、包内 `exports` 入口及相同包的不同嵌套版本。每个选中包保留完整内容；其嵌套 `node_modules` 由闭包逐项处理。未安装的可选依赖和 `@types/` 声明包会逐条写入清单；缺少必需运行依赖直接报错。不会用外层同名包替换嵌套版本。

不会打入原安装包、完整原应用、原主进程、原 preload、原企业配置、诊断、用户账号目录、缓存或项目数据。`extracted/app/package.json` 是新生成的模块解析锚点。原编辑器 `package.json` 中不用于运行的 `postinstall` 脚本会从派生副本移除。

打包器扫描所有选中文件中的常见 GitHub、OpenAI、AWS 凭据格式与完整私钥块，并清理文本资源里的静态凭据字段。可清理的文本在归档副本中处理；完整私钥或二进制中的可辨识凭据会使打包停止。清单记录清理类型和次数，不记录原值。原始恢复证据不修改；格式扫描不能证明任意第三方资源绝无其他形式的敏感信息。

`runtime-manifest.json` 记录每个文件的相对路径、大小、SHA-256、源 package 名称/版本。派生修改另外记录源 SHA-256 与清理记录。符号链接保留相对目标，禁止逃出对应运行资源目录或指向未选中的文件。

## 重新生成运行包

需要已有本机完整恢复证据，并保持相邻路径。运行：

```sh
node tools/package-runtime.mjs
```

版本默认读取当前 `package.json`，输出到 `.release-assets/`。也可显式指定：

```sh
node tools/package-runtime.mjs --source ../M0-AI-recovered --version 0.6.0 --output .release-assets
```

压缩前会在独立临时目录从白名单副本加载 LangGraph 和 callback，并执行一个结果为 `42` 的小图，确认模块解析与运行依赖完整。此验证不启动 GUI、不调用模型、不接触当前 M0 进程；不等于在所有 macOS 版本上验证了原编辑器。

此运行包不含原前端准备所需的 `web-assets/cache-recovered` 和两个原插件输入。Git 中的 `public/`、`plugins/recovered/` 已供直接运行；重新执行 `npm run prepare:frontend` 仍需要完整恢复证据，不应只凭此运行包重新生成。

每个正式发布版本使用对应 Git tag、Release 说明、源码与相同版本号的运行包。没有真实历史源码快照的早期版本只应发布历史说明，不能把当前源码重复标为旧版本。
