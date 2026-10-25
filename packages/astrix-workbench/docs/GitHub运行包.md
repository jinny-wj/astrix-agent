# 双端源码与受限运行资源

0.7.0 起，工作台源码位于 `网页端/workbench/` 与 `客户端/workbench/`，共享配置和版本记录位于 `packages/astrix-workbench/`。公开 Git 保存适配源码；生成界面、派生生成器和原生恢复组件不进入普通 Git。

## 下载与准备

当前版本的受限资源草稿命名为 `m0-runtime/v0.7.5`，以本版完成发布后的附件为准，只有有权访问草稿的账号可以下载。它不作为公开安装器发布。使用已授权的 GitHub CLI，在仓库外的下载目录执行：

```sh
gh release download m0-runtime/v0.7.5 --repo jinny-wj/astrix-agent --pattern 'M0-*-v0.7.5.*'
shasum -a 256 -c M0-local-resources-v0.7.5.sha256
shasum -a 256 -c M0-AI-recovered-runtime-v0.7.5.sha256
```

界面资源包采用 **layoutVersion: 2**，原生恢复包沿用兼容目录。将两个归档解压到同一个 `astrix-agent` 仓库根：

```sh
tar -xzf M0-local-resources-v0.7.5.tar.gz -C /path/to/astrix-agent
tar -xzf M0-AI-recovered-runtime-v0.7.5.tar.gz -C /path/to/astrix-agent
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

旧 0.6.x 界面归档采用单应用布局，不能直接当作双端资源使用。请取得对应 0.7.5 包，不覆盖本机原恢复证据或混合不同版本。0.7.5 会重新生成版本清单对应的两个资源包，继续使用布局 2；组件内容与上一版本一致不代表可以混用版本清单。资源准备完成后，按[共享说明](../README.md)分别运行客户端或网页端。

## 归档范围

界面打包器只收集四个允许的来源：网页端 `public/`、`plugins/recovered/`、`frontend-tools/extra-assets/` 和客户端 `desktop/icon.icns`。归档直接保存仓库相对路径，不创建独立应用外层目录。附件名中的 `M0-local-resources` 继续作为资源格式兼容名称，不是解压后的文件夹。清单记录每个派生文件的哈希、字节数、权限和必要的清理类型，不记录原凭据值。

原生恢复包包括原编辑器、OpenCode、Skills、实际使用的提示词和 LangGraph 运行依赖闭包，适用 **macOS Apple Silicon**。编辑器与终端还须适配实际 Electron 宿主；浏览器不会因为安装此包而取得 Node/preload 权限。

两个包都排除原安装包、原主进程、原 preload、原企业配置、用户项目、会话、模型密钥、登录状态、插件配对和诊断。文本静态凭据只在归档副本中清理，完整私钥或可辨识二进制凭据会阻止打包。原恢复证据不修改；格式扫描不保证第三方资源不存在任何其他形式的敏感数据。

单插件多端连接使用随源码提供的 Figma 插件和各本地服务。运行时生成的开发插件 manifest、个人插件 ID、配对信息及令牌留在本机数据目录，不随资源归档分发。安装资源不能替代官方插件导入、登录与文件权限验证，也不代表客户端和网页版的 Bridge 已同时在线。本轮保持模型配置不变。

## 重新打包

从共享包执行：

```sh
cd packages/astrix-workbench
npm run release:resources
npm run release:runtime
```

资源打包器默认从仓库实际双端路径读取，恢复打包器默认读取仓库根 `M0-AI-recovered/`；输出位于共享包 ignored 的 `.release-assets/`。测试会解压布局 2 并核对文件路径、字节和哈希；原生包还在独立临时目录加载 LangGraph 与 callback 执行小图。

运行包是受限草稿附件，不是公开源码 Release 附件；发布时必须核对草稿目标等于对应源码提交，并保持 draft。具体流程见[版本发布说明](版本发布.md)。
