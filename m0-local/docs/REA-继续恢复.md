# REA 定向复核与进一步恢复

日期：2026-10-23。工具：实际执行的 `rea-agents` 6.7.0。

这是首次 REA 定向复核的记录。之后已接入桌面原编辑器、原 OpenCode 与代码生成插件，最新运行方式和验证见 [本地整合 0.2.0](本地整合-0.2.0.md)。

本轮已完成三组 REA 静态分析，另对原编辑器进行了独立启动验证，并补存了此前未进入恢复包的静态 JavaScript。运行中的本地工作台仍使用已验证的兼容层；本轮没有把尚未集成的新插件直接加载进去。

## 1. REA 已实际运行成功

此前 `execution_failure` 的具体原因是 macOS 进程归属辅助程序在编译时，尝试写入系统 Swift module cache 被沙盒拒绝。设置临时缓存环境变量没有被该辅助编译链采用；在获准的沙盒外执行静态分析后成功。未注册或替换全局 MCP 配置。

| 分析目标 | 实际解析 | 访问 AST 节点 | 静态发现项 | 解析失败 |
| --- | ---: | ---: | ---: | ---: |
| 原主进程 `out/main/index.js` | 1 个 JS，645,497 字节 | 85,007 | 202 | 0 |
| 新取回的 `app-figma-api/index.iife-76.js` | 1 个 JS，1,281,292 字节 | 276,129 | 16 | 0 |
| 原编辑器 server 与 workbench 启动入口 | 2 个 JS，49,652 字节 | 13,483 | 50 | 0 |

以上均以 exit code 0 返回 REA Evidence。原始结果保存在 `diagnostics/rea/*-analysis.json`，不包含通过执行目标产生的观测。便于阅读的摘要为 `diagnostics/rea/summary.json`。

这里的“静态发现项”包括 Electron、入口及关系等分析记录，不代表漏洞数量。此次指定了确切 source paths，没有把整个依赖树逐文件分析。语义节点分别有 12,000 / 8,000 / 10,000 的保留上限，三个调用关系图都明确标为 partial/truncated；动态分派、未选文件与运行时行为仍有未知。不能据此宣称完整恢复了所有调用路径或原始源码工程。

复跑：

```sh
npm run analyze:rea -- main
npm run analyze:rea -- figma-bridge
npm run analyze:rea -- editor
```

脚本只启动版本固定的 REA 静态扫描，输出留在本地。在受限 macOS 环境下仍需允许辅助程序的编译缓存及进程检查；编译错误应看 stderr 和 Evidence 中的实际 diagnostics。

## 2. 本轮补充保留的真实代码

相邻 `M0-AI-recovered/web-assets/` 新增：

| 目录 | 文件 | 字节 |
| --- | ---: | ---: |
| `additional-static/` | 5 份精确引用的桥接/代码生成/主题 JS | 28,826,406 |
| `figma-proxy-static-unique/` | 470 份可证明静态 URL 的本机 Figma 代理缓存 JS | 112,275,270 |

合计 **475 份不同 SHA-256 的 JavaScript，141,101,676 字节**，全量长度/哈希验证 0 项失败。结果为相邻恢复包中的 `analysis/additional-static-verification.json`，复验使用其 `tools/verify_additional_static.py`。

CDN 只对原代码里明确引用的静态地址发起普通无凭据 GET；登录重定向没有被当作代码下载。代理缓存只提取了可由缓存键算法和静态脚本 URL 相互证明的条目，没有复制缓存响应头、HTML、用户初始状态或 API 数据。其余 2,827 个仅知 JS MIME、但 URL 无法证明的记录没有解码提取。

新取回的默认注入脚本与已有缓存的 `figma-api-inside` 属于不同构建，函数数和版本标记不同；默认 URL 不证明当前实际运行版本。具体版本、API、KRN 转换与顶层联网副作用见 [Figma 复核报告](rea-figma-findings.md)。这些代码尚未自动接入工作台。

## 3. 原编辑器的真实启动证据

`tools/probe-authentic-editor.cjs --run` 使用本项目新安装的 Electron，加载恢复的原 `server-main.kscode.js`，在独立数据目录启动了真实编辑器 server：

- `socketExists: true`；
- `agentServer` 与 `getDevtoolsExports` 导出存在；
- 被拒绝网络/子进程操作数为 0（server-only 测试没有发起这些操作）。

证据：`diagnostics/authentic-editor-server-probe.json`。随后用原 `workbench.kscode.html/js`、Unix socket 和原 `openEditor` 服务实际显示了 Code-OSS / Monaco 窗口并打开隔离 README，截图为 `diagnostics/authentic-editor-window.png`；窗口探针的最后状态、检测及限制见对应 JSON 与 [编辑器恢复报告](rea-editor-findings.md)。

最终窗口验证的 `ok`、`serverReady`、`openEditorResolved`、`readmeVisible` 均为 `true`，控制台 error 为 0。英文模式使用原包默认 NLS；中文 NLS 接线实验曾产生重复定义并停滞，失败证据另存，未启用为默认。可在本工程运行 `npm run editor:original` 保持原编辑器实验窗口打开；自动退出的验证命令为 `./node_modules/.bin/electron tools/open-authentic-editor.cjs --run --smoke-test`。

这是恢复原编辑器启动链的实际进展。其主体代码已经存在，主程序仍需移植 Node renderer、协议及生命周期 glue；这与“编辑器源码不在安装包内”是不同的情况。独立实验窗口不会把当前主工作台的文本编辑器自动替换掉。

原编辑器实验禁止 TCP、扩展宿主、终端等子进程。这些限制会影响原扩展和终端功能，不能把基本文件打开成功称作原编辑器全部能力已恢复。它也不提供原 Figma 云端、模型服务或服务端源码。

## 4. 对整体恢复的含义

REA 帮助解析现有制品和定位关系；本次确实补出了原代码和可运行原组件，不只是模拟界面。但原始 TypeScript/Vue 工程、服务端、账号运行状态和未出现在本机的代码仍不能由一次静态扫描证明齐全。已有本地工作台、原代码恢复包与新增实验入口分别保留，便于逐步移植并独立验证。
