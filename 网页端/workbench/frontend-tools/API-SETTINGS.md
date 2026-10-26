# 首页 API 设置

`/home` 右上角直接显示“API 设置”，与左侧头像区域分开。入口通过当前 authored runtime 安装；桌面与 Web 使用同一组 `public` 静态资源。原生 dialog 提供加载、重试、请求反馈、Escape 关闭与关闭后焦点恢复，不导航到旧设置页。

面板可选择三种 API 协议：**OpenAI 兼容 Chat Completions、Claude 原生 Messages、Gemini 原生 GenerateContent**。三者均可填写官方、第三方或本机地址，不设置来源域名白名单，也不限制模型名称。协议选择决定请求格式、鉴权方式及流式/工具调用解析，不能仅根据地址猜测协议。

表单只提交 `mode/provider/baseUrl/model/apiKey?/clearKey?`，不会发送或重置 `engine/workflow/allowWriteTools/allowFigmaWriteTools` 等高级配置。`provider` 值为 `openai/anthropic/gemini`；旧配置缺失时按 `openai` 显示。API Key 输入一直为空白初值，GET只使用公开的 `hasKey`，不读/回填响应里的凭据字段，不写浏览器存储。关闭清除密码输入。

- 同协议、同来源密钥留空：省略 apiKey，后端保留已保存的密钥。
- 协议或 URL origin 改变：明确提示原密钥不会沿用；新服务需要密钥时重填，无需密钥的服务可留空。后端负责阻止跨协议或跨来源保留原密钥。
- 切换协议：清空尚未保存的密码输入与清除勾选，并给出相应协议的地址/模型名提示。仅当当前地址为空或已知默认根路径时填入该协议官方根路径；用户自定义代理路径与查询参数保留。不会自动选择模型或发送请求。
- 勾选清除：提交 `clearKey:true`，不同时提交新密钥。测试中的清除仅影响草稿测试，不修改已保存配置。
- “测试连接”：向 `POST /__local/model/test` 发送当前草稿，显式 `mode:compatible`；即使“用于后续对话”尚未勾选也可先测试。测试成功不会暗中保存或开启对话。
- “保存配置”：向 `PUT /__local/model` 提交开关选择的模式。成功后清空密码输入，刷新公开模型列表，不强制刷新整页。

作者模块为 `api-settings.js`、`api-settings.css` 与纯请求模型 `api-settings-model.mjs`。`prepare-frontend.mjs` 将它们发布到public并在HTML加载样式；runtime动态安装面板。`astrix-api-config-saved` 事件只携带公开字段。

原“本地设置”页复用同一份公开状态、默认地址与提交规则，增加相同协议选项；其“测试已保存的连接”继续测试已保存配置，首页的“测试连接”测试当前草稿。两端默认 workbench 共用此设置资源与服务端协议适配，两端实际保存状态保持独立。

## 验证

```sh
node --test 网页端/workbench/frontend-tools/api-settings.test.mjs
```

9项纯单元测试覆盖：公开状态不包含密钥/高级配置、旧配置默认协议、同协议同来源空白保留请求语义、跨协议/跨来源提示与不携带旧密钥、草稿test不改变保存模式、三种协议和自定义服务地址/模型名、query地址、明确清除/替换、非法URL结构、默认地址切换及自定义路径保留。

实际UI验收应在临时dataDir+本地mock模型中运行，不能改开发者live配置：

1. `/home` 的 `#astrix-api-entry` 可见且不遮挡左侧头像；桌面no-drag点击可打开，窄屏无横向溢出。
2. `#astrix-api-dialog` 打开时读取GET；网络失败显示 `#astrix-api-feedback` 和重试入口，未完成读取不能保存。
3. 分别选择 Claude 与 Gemini，输入对应mock地址、任意模型名和测试密钥，点击 `#astrix-api-test`；mock收到对应原生草稿，保存配置保持原值，面板没有把成功误称为已保存。
4. 勾选 `#astrix-api-enabled` 后保存；只有API字段变化，高级引擎/工作流/写权限保持原值。密码框立即清空，重开仍不回显。
5. 同协议同来源空白保存保留key；换到另一mock来源或改变协议时显示警示，原key不进入新来源/新协议请求；勾选 `#astrix-api-clear-key` 保存确实清除。切换已知默认地址会填入官方根路径，自定义mock/代理地址保持原样。
6. mock 401/超时响应时显示错误，关闭会取消未完成测试；Escape/取消恢复入口焦点。切项目/离开home隐藏入口并关闭面板。

UI选择器：`#astrix-api-provider`、`#astrix-api-base-url`、`#astrix-api-model`、`#astrix-api-key`、`#astrix-api-test`、`#astrix-api-save`、`#astrix-api-close`、`#astrix-api-enabled`、`#astrix-api-clear-key`。测试成功只显示固定确认文案，不把模型回复或密钥回显给页面。
