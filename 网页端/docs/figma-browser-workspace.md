# 真实 Figma + Agent 浏览器工作区

## 结论

浏览器版本采用以下结构：

```text
Chrome 窗口
├── 主页面：真实 https://www.figma.com/design/...
└── Chrome Side Panel：Design Agent / Skills
```

不在产品页面中用 iframe 冒充 Figma 编辑器。Figma 官方 File Embed
是只读视图，无法选择单层或编辑普通节点。

## 打开流程

1. 用户在首页点击输入框、功能卡或「新建设计稿」。
2. 页面发送一次 `OPEN_FIGMA_WORKSPACE` 消息。
3. 本地 Chrome 扩展在该用户手势内打开 Side Panel，并保存预选 Skill。
4. 创建过渡页结束后，当前标签进入官方 `https://figma.new`。
5. Figma 在 Drafts 中创建真实设计文件；Side Panel 继续保持在右侧。
6. 点击已有文件时，流程相同，但目标改为该文件的真实 URL。

扩展未安装时，第 2 步会被安全忽略，用户仍会进入真实 Figma。

## OAuth

OAuth 用于显示授权账户、读取用户与文件数据，不负责创建普通设计节点。

本地回调：

```text
http://127.0.0.1:5273/api/auth/figma/callback
```

所需 scopes：

```text
current_user:read
file_content:read
file_metadata:read
```

服务端实现了：

```text
GET    /api/auth/figma/start
GET    /api/auth/figma/callback
GET    /api/auth/figma/session
DELETE /api/auth/figma/session
```

授权使用 Authorization Code + PKCE S256，并校验 `state`。Client Secret
只从服务端环境变量读取，Token 仅保存于本机开发服务的内存 Session，
通过 HttpOnly Cookie 关联浏览器。服务重启后需要重新授权。

生产环境需要把内存 Session 替换为加密的持久化 Session，并实现刷新令牌。

## 画布写入

当前扩展不读取或自动化 Figma DOM。真实节点写入需要单独的执行层：

1. 优先申请 Figma Remote MCP 客户端接入。
2. 等待接入期间，开发 Figma Plugin Bridge：
   Agent 后端下发结构化命令，插件用 Plugin API 修改当前文件。

OAuth REST API 没有创建 Figma Design 文件或写普通 Frame / Text /
Rectangle 节点的接口。

## 本地验证

```bash
pnpm dev
pnpm build
```

扩展安装步骤见 `browser-extension/README.md`。
