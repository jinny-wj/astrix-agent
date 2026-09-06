# 星序启动图标

以已确认的星序 A 星芒图形制作无文字的白色圆角图标。
原始生成结果的外围方格是 RGB 像素，并非透明；经用户授权，使用本地 Pillow 脚本添加抗锯齿 alpha 蒙版，只去除白色图标外缘，不重绘蓝色图形。

- 透明 PNG：`astrix-dock-transparent.png`
- macOS 图标：`../../../客户端/build/astrix.icns`
- 可复现脚本：`../../../客户端/scripts/build-astrix-icon.py`
- 重建：在客户端目录运行 `python3 scripts/build-astrix-icon.py`，再运行 `iconutil -c icns build/astrix.iconset -o build/astrix.icns`。

打包配置使用 `build/astrix.icns`，同时将其复制为应用资源 `astrix.icns`，由 `CFBundleIconFile` 直接引用；运行时 Dock PNG 与启动时 ICNS 使用同一品牌图标。`verify-mac-release.mjs` 会验证引用名称及文件内容，阻止旧图标混入打包结果。

2026-09-06：已替换客户端根目录及 release 内共 7 份旧图标应用，原版本压缩存放于 `客户端/release/legacy-archives-20260906-nyRBPH/`（含对应路径清单）。用户数据目录、登录信息与工作区记录不作修改。
