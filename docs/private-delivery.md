# 私发安装包验收（2026-09-22）

用户交付范围调整为把安装包发给指定人员试用；本次不部署网页版、不上传公开安装包。源码同步到 `jinny-wj/astrix-agent`。

## 产物

- 生成命令：在 `客户端` 运行 `pnpm desktop:dist:mac:private`。
- 本地输出：`客户端/release/private/Astrix-0.1.0-arm64-private.dmg`。
- 大小：328014131 字节，适用 Apple 芯片 / macOS 13+。
- SHA-256：`027e51bf0bbe82b6d6871fb8ea550a78bc1cb33b3314072770a5669d27447be8`。
- 镜像内包含 Astrix.app、Applications 拖放入口和安装说明；校验文件也在输出目录。
- 临时签名，未公证；接收者可能需要手动允许打开，公司设备可能不允许。

## 已检查

- 客户端 77 项自动化测试全部通过，前端和桌面 TypeScript 检查、生产构建通过。
- 拒绝不可信 Origin 和不透明 Origin 对 Agent 的访问，拒绝非 JSON POST；回归验证恶意来源上传不产生文件，正常本地 JSON 上传继续可用。
- 打包在临时目录完成并复用已安装且版本匹配的 Electron，避免桌面目录元数据破坏签名及重复下载 Electron。
- `hdiutil verify`、只读挂载后 `codesign --verify --deep --strict` 与本机包验收通过。
- 镜像中的主进程代码与本次构建逐字节一致；启动页面、OAuth preload、Bridge 和新增 Skill 都存在。
- ASAR 中检查 5,635 个路径，未发现指定的环境配置、登录数据和真实 API 配置文件名；源码常见密钥格式扫描无命中。这是有限扫描，不代表完整安全审计。
- 安装包与 SHA-256 文件匹配。构建产物被 Git 忽略。

## 使用边界

此轮未在一台全新 Mac 上完成真实登录和 Figma 写入验收，因此交付为私发试用包。
应用安装不要求 Node/pnpm；实际 AI 使用需要接收者配置本机后端并登录，Figma 需要自己的账号和 Bridge。
本地插件需在官方 Figma 桌面版导入；内嵌 Figma 页运行需已发布插件。生成海报服务尚未完整接通。

此前 [公开部署审计](release-readiness/2026-09-22/report.md) 仍保留历史证据。
本次修复了客户端 Agent 跨站请求执行问题并增加打包资源排除规则；未对网页版做 SaaS 鉴权改造，也未解决先前依赖审计的全部命中项。
Bridge 仍是仅供本机信任环境使用的接口，Origin 检查不等于用户身份认证。

接收者步骤见 [安装与首次使用](../客户端/docs/private-install.txt)。
