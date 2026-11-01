export const colors = '(?:#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?|红色?|橙色?|黄色?|绿色?|青色?|蓝色?|紫色?|黑色?|白色?|灰色?|粉色?|red|orange|yellow|green|blue|purple|black|white|gray|pink)'
export function ambiguousTitleColor(text: string) {
  return !/颜色|填充|色值/.test(text)
    && !/(?:文字|文本|内容).{0,5}[「“"『]/.test(text)
    && new RegExp(`(?:标题|文字|文本).{0,8}(?:改成|改为|变成|改|变)\\s*(${colors})[。！!\\s]*$`, 'i').test(text)
}

export function isReadOnlyConsultation(text: string) {
  const consulting = /解释|讲解|说明.{0,5}(?:如何|怎么)|介绍|是什么|原理|如何实现|怎么实现|如何操作|怎么操作|怎么做|如何把/.test(text)
  const execution = /(?:并|然后|同时)(?:且|请|帮我|直接|实际|立即|立刻)?(?:执行|修改|调整|生成|把|将|改)|(?:直接|立即|现在)(?:执行|修改|把|将|生成|改)/.test(text)
  return consulting && !execution
}
