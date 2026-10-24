# 双端源码与受限运行资源

0.7.0 起，工作台源码位于 `网页端/workbench/` 与 `客户端/workbench/`，共享配置和版本记录位于 `packages/astrix-workbench/`。公开 Git 保存适配源码；生成界面、派生生成器和原生恢复组件不进入普通 Git。

## 下载与准备

对应受限草稿为 `m0-runtime/v0.7.0`，只有有权访问草稿的账号可以下载。它不作为公开安装器发布。使用已授权的 GitHub CLI，在仓库外的下载目录执行：

```sh
gh release download m0-runtime/v0.7.0 --repo jinny-wj/astrix-agent --pattern 'M0-*-v0.7.0.*'
shasum -a 256 -c M0-local-resources-v0.7.0.sha256
shasum -a 256 -c M0-AI-recovered-runtime-v0.7.0.sha256
```

界面资源包采用 **layoutVersion: 2**，原生恢复包沿用兼容目录。将两个归档解压到同一个 `astrix-agent` 仓库根：

```sh
tar -xzf M0-local-resources-v0.7.0.tar.gz -C /path/to/astrix-agent
tar -xzf M0-AI-recovered-runtime-v0.7.0.tar.gz -C /path/to/astrix-agent
```

最终结构：

```text
astrix-agent/
  网页端/workbench/
    public/
    plugins/recovered/
    frontend-tools/extra-assets/
  客户端/workbench/desktop/icon.icns
  packages/astrix-workbench/resources-manifest.json
  M0-AI-recovered/
    runtime-manifest.json
    extracted/app/
    extracted/resources/
```

旧 0.6.x 界面归档会创建 `m0-local/`，不能直接当作新布局资源使用。请取得对应 0.7.0 包，不覆盖本机原恢复证据或混合不同版本。资源准备完成后，按[共享说明](../README.md)分别运行客户端或网页端。

## 归档范围

界面打包器只收集四个允许的来源：网页端 `public/`、`plugins/recovered/`、`frontend-tools/extra-assets/` 和客户端 `desktop/icon.icns`。归档直接保存仓库相对路径，不再有单应用 `m0-local` 外层。清单记录每个派生文件的哈希、字节数、权限和必要的清理类型，不记录原凭据值。

原生恢复包包括原编辑器、OpenCode、Skills、实际使用的提示词和 LangGraph 运行依赖闭包，适用 **macOS Apple Silicon**。编辑器与终端还须适配实际 Electron 宿主；浏览器不会因为安装此包而取得 Node/preload 权限。

两个包都排除原安装包、原主进程、原 preload、原企业配置、用户项目、会话、模型密钥、登录状态、插件配对和诊断。文本静态凭据只在归档副本中清理，完整私钥或可辨识二进制凭据会阻止打包。原恢复证据不修改；格式扫描不保证第三方资源不存在任何其他形式的敏感数据。

## 重新打包

从共享包执行：

```sh
cd packages/astrix-workbench
npm run release:resources
npm run release:runtime
```

资源打包器默认从仓库实际双端路径读取，恢复打包器默认读取仓库根 `M0-AI-recovered/`；输出位于共享包 ignored 的 `.release-assets/`。测试会解压布局 2 并核对文件路径、字节和哈希；原生包还在独立临时目录加载 LangGraph 与 callback 执行小图。

运行包是受限草稿附件，不是公开源码 Release 附件；发布时必须核对草稿目标等于对应源码提交，并保持 draft。具体流程见[版本发布说明](版本发布.md)。
