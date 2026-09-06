# Skill - 生图 Prompt 规则

> 本文档只定义生图环节的 Prompt 写法。
> 用户请求拦截和生成前追问见 `skill-constraints.md`。

---

## 一、定位

本文档用于在用户需求已经完成前置校验后，指导 AI 组装尽量简单、稳定的图像编辑 Prompt。

Prompt 的核心目标：

1. 保持原图尺寸和比例。
2. 只修改用户明确要求修改的内容。
3. 不主动总结或重写整图风格。
4. 让新增或替换内容自然贴合原图局部视觉表现。
5. 尽量减少额外约束，避免模型误以为要重绘未修改区域。

Prompt 不应该包含：

- 整体业务流程说明
- 与本次编辑无关的长约束

---

## 二、尺寸保持

除非用户明确要求改尺寸、改比例、扩图、裁切、横版或竖版重构，否则每次生图都保持原图尺寸和画布比例。

Prompt 建议写法：

```text
Keep the output image at the same size and aspect ratio as the input image.
Do not crop, extend, pad, resize, or reframe the canvas.
```

如果工程侧需要传入尺寸参数，使用原图尺寸，不使用模型或接口默认尺寸。

---

## 三、风格保持

### 核心原则

不要默认把原图风格提取成风格词再塞进 Prompt。

对于 GPT Image、nano banana 等能力较强的图像编辑模型，额外加入"粘土 3D / 扁平插画 / 写实摄影 / 混合风格"等整图风格标签，可能导致模型把原图中原本混搭、分层或局部差异化的视觉语言重绘成统一风格。

默认策略是：

```text
只说要改什么。
要求未修改区域保持原貌。
要求新内容匹配所在局部区域的视觉表现。
```

### 普通局部编辑

用于"把 A 改成 B""替换某个商品 / 人物 / 道具 / 背景局部"等需求。

```text
Keep the original image style and composition unchanged.
Only change {原内容} to {新内容}.
Make the new element blend naturally with the surrounding area.
Preserve all unrelated areas as close to the input image as possible.
```

### 多风格混搭图

如果原图包含多种视觉表现，例如 3D 主体 + 扁平 UI、写实商品 + 插画背景、摄影元素 + 手绘文字，不要概括成统一风格。

```text
Preserve the mixed visual treatments already present in the input image.
Only edit {目标区域}.
Make the edited area match the local visual treatment of that specific region.
Do not convert the image into one unified style.
```

### 主题 / 季节 / 氛围编辑

当用户要求"改成秋天氛围""换成冬日主题""变成露营主题"等，不要重写原图风格，只通过可替换元素表达主题。

```text
Change the theme or atmosphere to {新主题}.
Keep the original image style, composition, layout, and rendering approach unchanged.
Express the new theme through local color adjustments, props, environmental details, and replaceable decorative elements.
Do not restyle or redraw the whole image.
```

### 用户明确要求换风格

只有用户明确说"改成 XX 风格 / 换成 XX 画风 / 做成写实 / 做成 3D / 改成插画"等，才加入目标风格描述。

```text
Change the editable areas to {目标风格}.
Keep the original composition and element positions unless the user explicitly asks to change them.
Preserve unrelated areas as much as possible.
```

---

## 四、IP 编辑的 Prompt 写法

IP 请求的可执行范围由 `skill-constraints.md` 判断。本文档只说明通过校验后的 Prompt 写法。

当用户没有要求修改 IP 时，不要在 Prompt 中描述 IP，避免模型误以为需要重绘 IP。

当用户明确要求修改 IP，且该请求已经通过 skill 级约束校验时，Prompt 只写本次允许修改的内容：

```text
Only edit the IP character as requested: {具体修改}.
Keep the IP character's existing identity, shape, position, and visual treatment otherwise unchanged.
Do not change unrelated characters, objects, background, or layout.
```

如果只是给 IP 添加服装、道具、表情或动作，应继续保持简洁：

```text
Add {服装/道具/表情/动作} to the IP character.
Keep the rest of the IP character and the surrounding image unchanged.
Make the edit match the local visual treatment of the original IP.
```

---

## 五、Prompt 结构

默认 Prompt 只需要三块：

1. 尺寸保持
2. 局部编辑规则
3. 用户任务

如果用户明确要求换风格，用"用户明确换风格"写法替换默认风格保持写法。

如果用户明确要求修改 IP，加入简短 IP 编辑说明，不展开长约束。

### 标准结构

```text
Keep the output image at the same size and aspect ratio as the input image.
Do not crop, extend, pad, resize, or reframe the canvas.

Keep the original image style and composition unchanged.
Only change {原内容} to {新内容}.
Make the new element blend naturally with the surrounding area.
Preserve all unrelated areas as close to the input image as possible.

Task:
{用户需求的结构化描述}
```

### 任务描述建议

任务描述尽量使用简单动作，不要堆砌规则：

```text
- Replace {原元素} with {新元素}.
- Keep the same position, scale, perspective, lighting, and shadow relationship when appropriate.
- Remove or replace only the elements directly related to the user's request.
- Leave unrelated areas unchanged.
```

---

## 六、Prompt 示例

### 示例 1：普通局部替换

用户需求：把画面中的咖啡杯换成奶茶，其他不变。

```text
Keep the output image at the same size and aspect ratio as the input image.
Do not crop, extend, pad, resize, or reframe the canvas.

Keep the original image style and composition unchanged.
Only change the coffee cup to a milk tea cup.
Make the new element blend naturally with the surrounding area.
Preserve all unrelated areas as close to the input image as possible.

Task:
Replace the coffee cup with a milk tea cup.
Keep its original position, scale, perspective, shadow, and relationship with nearby objects.
Leave all other objects, characters, text, UI elements, and background areas unchanged.
```

### 示例 2：主题 / 季节变化

用户需求：把春日主题改成秋天氛围。

```text
Keep the output image at the same size and aspect ratio as the input image.
Do not crop, extend, pad, resize, or reframe the canvas.

Change the theme or atmosphere to autumn.
Keep the original image style, composition, layout, and rendering approach unchanged.
Express the new theme through local color adjustments, props, environmental details, and replaceable decorative elements.
Do not restyle or redraw the whole image.

Task:
Transform the editable seasonal atmosphere from spring to autumn.
Replace spring-related decorative elements with autumn leaves, warm seasonal props, and autumn color accents.
Leave unrelated areas unchanged.
```

### 示例 3：明确修改 IP

用户需求：让 IP 戴上冬天围巾，表情更开心。

```text
Keep the output image at the same size and aspect ratio as the input image.
Do not crop, extend, pad, resize, or reframe the canvas.

Keep the original image style and composition unchanged.
Only edit the IP character as requested.
Make the edit match the local visual treatment of the original IP.
Preserve all unrelated areas as close to the input image as possible.

Task:
Add a winter scarf to the IP character and make its expression happier.
Keep the rest of the IP character and the surrounding image unchanged.
Leave the background, layout, UI, text, and other objects unchanged.
```

---

## 七、生图后检查

生图完成后只检查与 Prompt 直接相关的输出质量：

- 图片尺寸和比例是否与原图一致。
- 是否只修改了用户要求的内容。
- 未要求修改的区域是否尽量保持原貌。
- 新增或替换元素是否自然贴合局部视觉表现。
- 多风格混搭图是否没有被统一风格化。

文档版本：v1.2 · 2026-05-29
