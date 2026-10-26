# 首页 API 设置

`/home` 右上角直接显示“API 设置”，与左侧头像区域分开。入口通过当前 authored runtime 安装；桌面与 Web 使用同一组 `public` 静态资源。原生 dialog 提供加载、重试、请求反馈、Escape 关闭与关闭后焦点恢复，不导航到旧设置页。

面板说明协议为 **OpenAI 兼容接口，支持官方、第三方与本机服务**。不按服务域名、厂商或模型名称提供白名单或预设；只校验普通 HTTP/HTTPS URL 的结构。它不声称支持所有厂商的原生非兼容请求格式。

表单只提交 `mode/baseUrl/model/apiKey?/clearKey?`，不会发送或重置 `engine/workflow/allowWriteTools/allowFigmaWriteTools` 等高级配置。API Key 输入一直为空白初值，GET只使用公开的 `hasKey`，不读/回填响应里的凭据字段，不写浏览器存储。关闭清除密码输入。

- 同来源密钥留空：省略 apiKey，后端保留已保存的密钥。
- URL origin 改变：明确提示原密钥不会沿用；新服务需要密钥时重填，无需密钥的服务可留空。后端负责阻止跨来源保留原密钥。
- 勾选清除：提交 `clearKey:true`，不同时提交新密钥。测试中的清除仅影响草稿测试，不修改已保存配置。
- “测试连接”：向 `POST /__local/model/test` 发送当前草稿，显式 `mode:compatible`；即使“用于后续对话”尚未勾选也可先测试。测试成功不会暗中保存或开启对话。
- “保存配置”：向 `PUT /__local/model` 提交开关选择的模式。成功后清空密码输入，刷新公开模型列表，不强制刷新整页。

作者模块为 `api-settings.js`、`api-settings.css` 与纯请求模型 `api-settings-model.mjs`。`prepare-frontend.mjs` 将它们发布到public并在HTML加载样式；runtime动态安装面板。`astrix-api-config-saved` 事件只携带公开字段。

## 验证

```sh
node --test 网页端/workbench/frontend-tools/api-settings.test.mjs
```

6项纯单元测试覆盖：公开状态不包含密钥/高级配置、同来源空白保留请求语义、跨来源提示与不携带旧密钥、草稿test不改变保存模式、任意自定义服务地址/模型名、query地址、明确清除/替换以及非法URL结构。

实际UI验收应在临时dataDir+本地mock模型中运行，不能改开发者live配置：

1. `/home` 的 `#astrix-api-entry` 可见且不遮挡左侧头像；桌面no-drag点击可打开，窄屏无横向溢出。
2. `#astrix-api-dialog` 打开时读取GET；网络失败显示 `#astrix-api-feedback` 和重试入口，未完成读取不能保存。
3. 输入mock地址、任意模型名和测试密钥，点击 `#astrix-api-test`；mock收到草稿，保存配置保持原值，面板没有把成功误称为已保存。
4. 勾选 `#astrix-api-enabled` 后保存；只有API字段变化，高级引擎/工作流/写权限保持原值。密码框立即清空，重开仍不回显。
5. 同来源空白保存保留key；换到另一mock来源时显示警示，原key不进入新来源请求；勾选 `#astrix-api-clear-key` 保存确实清除。
6. mock 401/超时响应时显示错误，关闭会取消未完成测试；Escape/取消恢复入口焦点。切项目/离开home隐藏入口并关闭面板。

UI选择器：`#astrix-api-base-url`、`#astrix-api-model`、`#astrix-api-key`、`#astrix-api-test`、`#astrix-api-save`、`#astrix-api-close`、`#astrix-api-enabled`、`#astrix-api-clear-key`。测试成功只显示固定确认文案，不把模型回复或密钥回显给页面。
