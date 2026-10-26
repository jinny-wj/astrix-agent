# 首页 API 配置

客户端和网页版的默认首页右上角都有 **API 设置**。输入服务地址、模型名称和 API Key 后，可以测试当前填写的配置，再保存并决定是否用于后续对话。

在 **API 协议** 中选择 **OpenAI 兼容 Chat Completions、Claude 原生 Messages、Gemini 原生 GenerateContent**。服务来源不设域名白名单，官方、第三方代理和本机服务均可使用；选择与服务实际提供的接口一致的协议，模型名称由对应服务决定。

| 协议 | 官方根地址 | 原生请求 |
| --- | --- | --- |
| OpenAI 兼容 | `https://api.openai.com/v1` | `chat/completions` |
| Claude 原生 | `https://api.anthropic.com/v1` | `messages` |
| Gemini 原生 | `https://generativelanguage.googleapis.com/v1beta` | `models/{模型}:generateContent` / `streamGenerateContent` |

Claude 使用 Messages API 的鉴权和文本/工具内容块，Gemini 使用 GenerateContent 的鉴权、contents、函数声明与函数结果。两者支持普通回复、流式回复及 Agent 工具往返；Gemini 的原生签名和函数 ID 会随工具上下文保留。实现依据为 [Claude Messages](https://platform.claude.com/docs/en/api/messages/create)、[Claude Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)、[Gemini GenerateContent](https://ai.google.dev/api/generate-content) 和 [Gemini Thought Signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)。

- 地址可填接口版本根路径，也可填所选协议的完整接口地址；会自动归一化，支持合法查询参数。Gemini 完整地址中的模型段以“模型名称”字段为准。
- API Key 填在独立字段，免密服务可以留空。已保存的值不回显，留空保留同一协议、同一来源的值；更换协议或来源且没有填写新值时，原值不会沿用。切换协议会清空尚未保存的 Key；自定义地址继续保留，已知默认地址会切换为相应官方根地址。
- 点击 **测试连接** 只测试当前填写的内容，不保存、不切换实际对话模式。测试会向指定模型发出一次简短请求。
- 点击 **保存配置** 后，“用于后续对话”的选择才会生效。关闭该选项时继续界面演示。
- **清除已保存的密钥** 在保存后生效。关闭面板或按 Escape 会清空尚未保存的密钥输入，并返回首页入口。

两端配置分别保存。首页仅编辑 API 相关字段，现有执行引擎、多 Agent 工作流、文件写入及 Figma 写入权限保持原值；完整设置仍可通过原“本地设置”入口管理。API 配置不改变 Figma OAuth、文件权限或 Plugin Bridge 配对。

原设计客户端的“AI 模型 API”入口也可选择三种协议，仍保留单轮文字交流和取消机制；它不因协议增加而获得工具或图片能力。

本版原生接口覆盖文字和现有 Agent 工具，图片、音频、视频、Google Vertex AI 与托管工具等接口不属于这条调用链。恢复的 OpenCode 原生调用在每轮新建隔离请求上下文，并传入已完成的文字历史，避免把上一轮已丢失签名的工具记录重新发送。不同协议间不能混用历史工具上下文；达到输出上限的工具调用会报错，避免执行未完成参数。

本机配置不会进入源码或发布资源，应用不将 API Key 写入浏览器存储，也不跟随模型接口重定向。新安装默认仍为演示模式；本版验收使用隔离模拟服务，没有替用户配置或调用真实模型。
