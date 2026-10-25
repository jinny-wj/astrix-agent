# Astrix 本机 Figma OAuth 配置

客户端和网页端使用 Figma 官方 OAuth，账号授权状态与真实画布登录、Plugin Bridge 配对分别显示。OAuth 用于读取账号和文件；设计修改仍须由目标文件中的 Bridge 执行并返回回执。模型可以保持未配置。

## 官方应用

在 [Figma My Apps](https://www.figma.com/developers/apps) 分别准备 `Astrix Desktop` 和 `Astrix Web`。两端采用独立应用，避免同一账号在同一个应用中的授权更新互相影响。

创建页的所属团队或组织决定应用的管理归属；接受开发者条款前应由账号持有人确认。仅供本人本机验证时可保留草稿，不需要提交公开审核。

分别登记准确的回调：

| 运行入口 | 回调 |
| --- | --- |
| 默认客户端工作台 | `http://127.0.0.1:4317/api/auth/figma/callback` |
| 默认网页端 | `http://127.0.0.1:5273/api/auth/figma/callback` |

两个应用均仅选择 `current_user:read`、`file_metadata:read`、`file_content:read`。本流程不申请写入权限，也不默认启用团队项目枚举权限。

把官方应用信息分别保存到客户端和网页端各自的 `.env.local`，字段以对应 `.env.example` 为准。个人配置只留本机，不能提交到仓库、截图、版本记录或运行资源。配置后重新启动相应服务，保留现有用户数据和 Bridge 配对。

## 连接与验证

1. 打开项目中的真实 Figma 工作区，查看独立的 OAuth 状态。
2. 点击「连接 Figma 账号」，在外部浏览器完成官方授权。桌面端使用本机会话交接，不能把官方授权页放在内嵌画布中完成。
3. 授权完成后返回工作区，确认显示「OAuth 已连接」。
4. 点击「验证设计稿」进行一次真实的文件元数据读取。读取失败应显示实际原因，不能用 Bridge 在线代替 OAuth 成功。

OAuth 连接不会替代内嵌 Figma 页面的网页登录，也不会增加当前账号对文件的访问权限。只读验证不修改原稿，不调用模型。

实现与配置要求以 [Figma 官方 OAuth 文档](https://developers.figma.com/docs/rest-api/oauth-apps/)为准。每次发布的本机实测结果在对应版本记录中单独说明；配置示例与测试用例不代表用户已完成实际授权。
