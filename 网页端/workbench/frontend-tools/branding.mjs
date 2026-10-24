// Visible product literals from the recovered workbench. Protocol/storage keys,
// schema types, SVG geometry and user-authored strings are intentionally absent.
const replacements = [
  [
    "\" M0 AI 2.0 仅对内部白名单用户开放，如需申请试用请联系管理员： \"",
    "\" Astrix 2.0 仅对内部白名单用户开放，如需申请试用请联系管理员： \""
  ],
  [
    "\"包含 M0 AI 生成或编辑内容的设计稿文件数\"",
    "\"包含 Astrix 生成或编辑内容的设计稿文件数\""
  ],
  [
    "\"设计稿 AI 占比与 M0 AI 覆盖文件数占全部设计文件数的比例趋势。\"",
    "\"设计稿 AI 占比与 Astrix 覆盖文件数占全部设计文件数的比例趋势。\""
  ],
  [
    "\"M0@\"",
    "\"Astrix@\""
  ],
  [
    "\" 一键体验码灵2.0新功能 \"",
    "\" 一键体验Astrix2.0新功能 \""
  ],
  [
    "\"用 M0 生成同款\"",
    "\"用 Astrix 生成同款\""
  ],
  [
    "\" M0 AI \"",
    "\" Astrix \""
  ],
  [
    "\"码灵 M0 Design 123\"",
    "\"Astrix Design 123\""
  ],
  [
    "\"码灵Aa12\"",
    "\"AstrixAa12\""
  ],
  [
    "\"码灵Chrome插件\"",
    "\"AstrixChrome插件\""
  ],
  [
    "\"生成设计稿、海报、插画或字体，也可上传参考图或粘贴 Figma 链接。快来感受 M0 Design 的「哇塞」时刻吧~\"",
    "\"生成设计稿、海报、插画或字体，也可上传参考图或粘贴 Figma 链接。快来感受 Astrix Design 的「哇塞」时刻吧~\""
  ],
  [
    "\"当前模式无法打开关联 M0 项目\"",
    "\"当前模式无法打开关联 Astrix 项目\""
  ],
  [
    "\"当前环境不支持安装设计规范，请在 M0 客户端中使用\"",
    "\"当前环境不支持安装设计规范，请在 Astrix 客户端中使用\""
  ],
  [
    "\"码灵字体 Aa 123\"",
    "\"Astrix字体 Aa 123\""
  ],
  [
    "\"[M0] Failed to init ports config:\"",
    "\"[Astrix] Failed to init ports config:\""
  ],
  [
    "\"[M0] Ports config initialized\"",
    "\"[Astrix] Ports config initialized\""
  ],
  [
    "\" 您好，我是 M0 Design，一站式 AI 设计协作平台 \"",
    "\" 您好，我是 Astrix Design，一站式 AI 设计协作平台 \""
  ],
  [
    "\"Skill 管理仅支持 M0 Electron 客户端\"",
    "\"Skill 管理仅支持 Astrix Electron 客户端\""
  ],
  [
    "\"安装 Skill 请在 M0 Electron 客户端中使用\"",
    "\"安装 Skill 请在 Astrix Electron 客户端中使用\""
  ],
  [
    "\"给码灵发送消息\"",
    "\"给Astrix发送消息\""
  ],
  [
    "\" 码灵满意度调研 \"",
    "\" Astrix满意度调研 \""
  ],
  [
    "\"邀请您参与码灵满意度调研，您的反馈将帮助码灵变得更好~\"",
    "\"邀请您参与Astrix满意度调研，您的反馈将帮助Astrix变得更好~\""
  ],
  [
    "\"预览失败，请反馈码灵 oncall\"",
    "\"预览失败，请反馈Astrix oncall\""
  ],
  [
    "\"连接 websocket 成功，M0 准备请求插件\"",
    "\"连接 websocket 成功，Astrix 准备请求插件\""
  ],
  [
    "\"静态端口获取失败，请刷新页面和重新插件，若还失败，请联系 M0 oncall\"",
    "\"静态端口获取失败，请刷新页面和重新插件，若还失败，请联系 Astrix oncall\""
  ],
  [
    "\"插件代码更新成功，同步 M0 ...\"",
    "\"插件代码更新成功，同步 Astrix ...\""
  ],
  [
    "\"加载插件 manifest.json 失败，请确认插件目录下是否有 manifest.json, 若未确定，请联系 M0 oncall\"",
    "\"加载插件 manifest.json 失败，请确认插件目录下是否有 manifest.json, 若未确定，请联系 Astrix oncall\""
  ],
  [
    "\"插件发布失败，请联系 M0 oncall\"",
    "\"插件发布失败，请联系 Astrix oncall\""
  ],
  [
    "\" 开发码灵转码插件 \"",
    "\" 开发Astrix转码插件 \""
  ],
  [
    "\" 开发码灵插件 \"",
    "\" 开发Astrix插件 \""
  ],
  [
    "\" 开发码灵主题导出插件 \"",
    "\" 开发Astrix主题导出插件 \""
  ],
  [
    "\"规则仅在码灵默认模型和Agent中生效，三方Agent中规则无效\"",
    "\"规则仅在Astrix默认模型和Agent中生效，三方Agent中规则无效\""
  ],
  [
    "\" 码灵插件开发文档 \"",
    "\" Astrix插件开发文档 \""
  ],
  [
    "\"Hi, 我是码灵\"",
    "\"Hi, 我是Astrix\""
  ],
  [
    "\"「码灵 AICode 」正在内测中...\"",
    "\"「Astrix AICode 」正在内测中...\""
  ],
  [
    "\"请先启动码灵 cli\"",
    "\"请先启动Astrix cli\""
  ],
  [
    "\"[创建Figma草稿] M0 调用超时\"",
    "\"[创建Figma草稿] Astrix 调用超时\""
  ],
  [
    "\" M0 AI CLI \"",
    "\" Astrix CLI \""
  ],
  [
    "\" Working with M0 AI, ... \"",
    "\" Working with Astrix, ... \""
  ],
  [
    "\" M0 CLI \"",
    "\" Astrix CLI \""
  ],
  [
    "\"码灵电脑\"",
    "\"Astrix电脑\""
  ],
  [
    "\"您好，我是码灵，一站式研发 + 设计 + AI协作平台\"",
    "\"您好，我是Astrix，一站式研发 + 设计 + AI协作平台\""
  ],
  [
    "\"给 M0 发送消息\"",
    "\"给 Astrix 发送消息\""
  ],
  [
    "\"码灵/工作台\"",
    "\"Astrix/工作台\""
  ],
  [
    "\"插件加载失败，请联系 M0 oncall\"",
    "\"插件加载失败，请联系 Astrix oncall\""
  ],
  [
    "\"插件运行出错, 请联系码灵 onCall\"",
    "\"插件运行出错, 请联系Astrix onCall\""
  ],
  [
    "\"做动效仅支持 M0 桌面端\"",
    "\"做动效仅支持 Astrix 桌面端\""
  ],
  [
    "\"正在打开浏览器捕获 Cookie，请确认已安装 M0 Design Plugin。\"",
    "\"正在打开浏览器捕获 Cookie，请确认已安装 Astrix Design Plugin。\""
  ],
  [
    "\"当前 M0 客户端不支持 Skill 安装\"",
    "\"当前 Astrix 客户端不支持 Skill 安装\""
  ],
  [
    "\"展开M0 Design\"",
    "\"展开Astrix Design\""
  ],
  [
    "\"收起M0 Design\"",
    "\"收起Astrix Design\""
  ],
  [
    "\"未检测到码灵 chrome 插件，请先安装\"",
    "\"未检测到Astrix chrome 插件，请先安装\""
  ],
  [
    "\"by M0\"",
    "\"by Astrix\""
  ],
  [
    "\" 安装M0 \"",
    "\" 安装Astrix \""
  ],
  [
    "\"安装M0\"",
    "\"安装Astrix\""
  ],
  [
    "\"码灵正在使用浏览器\"",
    "\"Astrix正在使用浏览器\""
  ],
  [
    "\"当前资产缺少 Figma 文件信息，无法打开 M0 项目\"",
    "\"当前资产缺少 Figma 文件信息，无法打开 Astrix 项目\""
  ],
  [
    "\"码灵 Chrome 插件\"",
    "\"Astrix Chrome 插件\""
  ]
];

export function rebrandWorkbench(source,name) {
  if (!name.includes("/workbench/assets/") || !name.endsWith(".js") || name.includes(".worker")) return source;
  for (const [before,after] of replacements) source=source.replaceAll(before,after);
  source=source.replace(/(alt\s*:\s*["'])M0(["'])/g,'$1Astrix$2');
  const logos=name.endsWith("/m0-header-logo-DpRP-W92.js")?["Wt"]:name.endsWith("/m0-logo-cn-Cxk5wUPj.js")?["ua"]:[];
  for(const binding of logos)source=replaceLogoBinding(source,binding,'/branding/astrix-logo-v1.png');
  const icons=name.endsWith("/m0-header-logo-DpRP-W92.js")?["Ut"]:name.endsWith("/index-v2-BGt4TMzj.js")?["qp"]:[];
  for(const binding of icons)source=replaceLogoBinding(source,binding,'/branding/astrix-dock.png');
  return source.replaceAll("/vendor/s2-12205.kwimgs.com/kos/proj-gis/Z2lz/kos/nlav12205/workbench/m0-logo.svg","/branding/astrix-logo-v1.png");
}
function replaceLogoBinding(source,binding,url) {
  const marker=binding+'="data:image/',start=source.indexOf(marker);
  if(start<0)throw new Error('Recovered logo binding changed: '+binding);
  const end=source.indexOf('"',start+marker.length);
  if(end<0)throw new Error('Recovered logo binding is incomplete: '+binding);
  return source.slice(0,start)+binding+'='+JSON.stringify(url)+source.slice(end+1);
}
