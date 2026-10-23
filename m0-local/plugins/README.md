# 原插件的本地执行适配

`node plugins/prepare.mjs` 从恢复目录按固定 SHA-256 校验生产 KRN / 主题插件，生成 `plugins/recovered/`。原始证据文件不变。运行项目使用生成后的副本，不再需要联网获取插件。

`generateKrn(schema)` 调用原 `toDSLWithSchema`、`transformM0Node` 与 `generateKRN`，返回 `App.tsx` 和 `styles.ts`。原线性渐变工具及其数学依赖从已恢复前端的连续纯函数段原样抽出。`generateTheme(theme)` 调用原 `generateThemeFile`，返回 `styles.json`、`variables.json`、`variable-collection.json`。

适配范围在 `recovered/manifest.json` 记录：删除 KRN 模块顶层的企业 Snack 初始化与 `setOnline(true)`，跳过预览事件注册，改写 ESM 导出为 VM 内部出口；原转换和生成算法不变。运行入口 `local-generators.mjs` 为每次生成启动独立线程，限时 25 秒并设内存上限；VM 不提供文件系统、Node require 或可用网络，输入只传 JSON，生成结果作为文本返回且不执行。

限制：输入需为 M0Schema，不是未经转换的 Figma REST 文档。原 KRN 插件支持 view/text/image/component；RN 渐变只支持线性渐变。输出引用的 React Native / 企业组件需要目标工程提供，原企业 Snack 预览未启用。主题图片导出需要真实 Figma 节点，当前会明确拒绝 imageNodes。

输入不超过 3 MB，节点树不超过 5000 个节点和 80 层；生成文本不超过 4 MB。每次调用校验派生插件和渐变辅助代码的 SHA-256。主题输入为 `{styles,variables,variableCollection}`；KRN 最小输入示例在 `fixtures/basic-schema.json`。生成器没有伪造 Figma 节点对象，也不自动下载图片或安装输出代码所引用的包。

接口为 `POST /__local/generate/krn {schema}` 与 `POST /__local/generate/theme {theme}`，返回 `{success,engine,files:[{path,content}],sourceSha256,offline,notes}`。用户界面 `/codegen.html` 支持 JSON 导入、源码查看/复制、单文件下载、JSON 文件包下载及导入当前工作区。导入复用项目导入 API，拒绝覆盖已有文件。

验证：`node plugins/test-generators.mjs` 实际执行原 view/text 编译、原线性渐变转换、原主题三 JSON 输出，并检查未接入的图片导出与无效节点输入被拒绝。生成样例和结果在 `plugins/verification-output/`。

真实浏览器验证使用独立端口 4329 与临时数据/工作区：点击原 KRN 生成并导入两个源码文件，切换主题生成并导入三个 JSON，再打开工作区里的 `App.tsx`。五个文件均在磁盘上复核字节数和 SHA-256，证据在 `../diagnostics/codegen-ui-verification.json` 与 `codegen-ui.png`、`codegen-workspace-ui.png`。验证未修改用户原项目。
