# Astrix 中的 M0 源码与运行资源

`jinny-wj/astrix-agent` 的 `m0-local/` 保存本地服务、桌面适配、Figma Plugin Bridge 和测试源码。生成前端、原生成器、图标、原生引擎和恢复资料不进入 Git。运行工作台需要另外恢复 UI 资源；原 KSCode、原 OpenCode、LangGraph 与原技能需要额外的原生运行包。当前恢复二进制适用 **macOS Apple Silicon（darwin-arm64）**。

源码正式版本使用 `m0/v0.6.1` 标签与源码 Release。两个资源包只保存在同一仓库的受限草稿 Release `m0-runtime/v0.6.1`，不发布公共安装器。草稿附件仅能由有权查看该草稿的仓库协作者下载；普通公开源码访问权限不包含这些资源。

## 下载与还原

有权查看草稿的协作者可使用已登录的 GitHub CLI：

```sh
gh release download m0-runtime/v0.6.1 --repo jinny-wj/astrix-agent --pattern 'M0-*-v0.6.1.*'
```

完整运行所需文件：

| 类型 | 归档 |
| --- | --- |
| UI 与生成资源 | `M0-local-resources-v0.6.1.tar.gz` |
| 原生引擎与工作流依赖 | `M0-AI-recovered-runtime-v0.6.1.tar.gz` |

每个归档附有同名 `.sha256` 校验文件与 `.manifest.json` 逐文件清单。将下载文件放在 Astrix 仓库根目录，在该目录校验和解压：

```sh
shasum -a 256 -c M0-local-resources-v0.6.1.sha256
shasum -a 256 -c M0-AI-recovered-runtime-v0.6.1.sha256
tar -xzf M0-local-resources-v0.6.1.tar.gz
tar -xzf M0-AI-recovered-runtime-v0.6.1.tar.gz
cd m0-local
npm ci
npm test
npm run desktop
```

还原后的布局：

```text
astrix-agent/
  m0-local/
    package.json
    public/
    plugins/recovered/
    frontend-tools/extra-assets/
    desktop/icon.icns
    resources-manifest.json
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

不要在恢复运行包内执行 `npm install`。若已有完整原始恢复证据，继续使用现有目录，或在另一份源码克隆旁还原资源包，避免覆盖原始证据、混用不同版本资源。

模型默认保持演示模式。真实 Figma 仍需正常登录并按 [真实 Figma 接入](真实Figma接入.md) 安装插件、配对。资源包不携带项目、对话、模型密钥、Figma 登录、Bridge 配对或 Electron 用户配置。

## UI 资源包的范围

`tools/package-resources.mjs` 仅打包 4 个白名单路径：

- `public/`
- `plugins/recovered/`
- `frontend-tools/extra-assets/`
- `desktop/icon.icns`

归档前缀固定为 `m0-local/`，因此可直接在 Astrix 根目录解压。`resources-manifest.json` 记录目标版本、来源版本及每个文件的大小、权限、源与产物 SHA-256、脱敏记录。拒绝符号链接、账号目录、依赖目录、环境文件和私钥路径。

已安装资源时，在 `m0-local/` 运行：

```sh
node tools/package-resources.mjs
```

首次从另一份已审查的本地 M0 安装目录打包时：

```sh
node tools/package-resources.mjs --source-root /path/to/installed/m0-local --version 0.6.1
```

默认版本读取当前模块 `package.json`；输出位于 `.release-assets/`，不会进入 Git。

## 原生运行包的范围

`tools/package-runtime.mjs` 只读取以下白名单：

| 路径 | 用途 |
| --- | --- |
| `extracted/resources/editor/` | 原 KSCode 发行文件、语言服务、终端与扩展依赖 |
| `extracted/resources/opencode-darwin-arm64/` | 原 OpenCode 发行文件 |
| `extracted/resources/skills/` | 原技能资料 |
| `extracted/app/node_modules/` 中解析出的依赖闭包 | LangGraph 与 callback 所需运行文件 |
| 工作流实际读取的 4 个 prompt 文件 | 规划、代码、设计与总结提示词来源 |

从 `@langchain/langgraph` 与 `@langchain/core` 开始，按 Node 的嵌套 `node_modules` 查找顺序递归收集 `dependencies`、`optionalDependencies` 和 `peerDependencies`。保留已安装可选依赖、包内 `exports` 入口及不同嵌套版本；未安装可选依赖和 `@types/` 声明包逐条记录，缺少必需运行依赖直接报错。

不会打入原安装包、完整原应用、原主进程、原 preload、企业配置、诊断、账号目录、缓存或项目数据。`extracted/app/package.json` 是新生成的模块解析锚点。编辑器不用于运行的 `postinstall` 脚本从派生副本移除。若输入来自先前运行包，清单另记录该输入版本及其清单摘要，保留再打包来源。

在 `m0-local/` 运行：

```sh
node tools/package-runtime.mjs
```

默认读取相邻的 `../M0-AI-recovered`，版本读取当前 `package.json`，输出到 `.release-assets/`；也可显式指定：

```sh
node tools/package-runtime.mjs --source ../M0-AI-recovered --version 0.6.1 --output .release-assets
```

压缩前在临时目录加载白名单副本中的 LangGraph 和 callback，并执行结果为 `42` 的小图。`runtime-manifest.json` 记录逐文件 SHA-256、大小、源 package 名称/版本及清理记录。相对符号链接不能逃出对应资源目录，目标必须在白名单文件中。此验证不启动 GUI、不调用模型、不接触当前程序。

## 脱敏与验证边界

两个打包器均扫描选中文件的常见 GitHub、OpenAI、AWS 凭据格式与完整私钥块，并清理文本资源中的静态凭据字段。可清理文本仅修改归档副本；完整私钥或二进制中的可辨识凭据会使打包停止。清单只记录类型、次数与摘要，不保存原值。格式扫描不能证明任意第三方文件绝无其他形式的敏感信息。

UI 资源包和原生包都不包含重新准备原前端所需的 `web-assets/cache-recovered` 及原插件输入。还原后可直接运行；重新执行 `npm run prepare:frontend` 仍需要完整恢复证据。

每个 M0 版本保留对应源码标签和说明。0.1.0 至 0.5.0 没有真实历史源码快照，只记录历史说明，不能把当前代码重复标为这些旧版本。不要将草稿资源 Release 改为公开发布，或把生成资源重新加入源码 Git。
