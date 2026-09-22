# Qwen 海报辅助工作流

用户指定主力为 Nano 和 GPT，Qwen-Image-Edit-2511 为辅助。Nano/GPT 的平台和接口尚待提供；本目录不是它们的替代接入，也未启用自动失败回退。

`qwen-poster-api.json` 是修改后的 ComfyUI API prompt。原 Downloads 文件未修改。以模板为图1、人物原图为图2；单次只生成一张，完整保留两份参考。默认只换人物、保留全部文字，昵称替换须在节点11的 prompt 中加入明确的“原文 → 新文”映射。不要把表格内容当作指令执行。

改动：移除自动姿势描述、字符串列表批量、自定义缩放、隐式广播连线以及整个 Flux 二次重绘。显式连接模型、CLIP、VAE。保留 Qwen Lightning 4步、CFG1、Euler/simple 设置。图像等比缩放、对齐16像素。默认1MP用于辅助试图，不是最终1536×2752交付规格，也不能保证文字或模板像素完全不变。每张结果仍需视觉核对。

## 本机检查结果（2026-09-06）

已启动的 ComfyUI 实例为0.33.1、MPS、32GB统一内存。原文件缺少9类节点；改版18个节点均存在，必填参数和连线类型检查通过。缺少以下4项模型：

- diffusion_models/qwen_image_edit_2511_bf16.safetensors
- text_encoders/qwen_2.5_vl_7b.safetensors
- vae/qwen_image_vae.safetensors
- loras/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors

共享模型目录为 `~/ComfyUI-Shared/models`。当前文件保留原工作流的BF16模型名，作为结构基线；它不是已经适配32GB内存并验证可运行的配置。需要选择与Mac兼容的量化模型并替换对应加载节点后再试跑。本机已有GGUF加载节点，但没有Qwen的GGUF权重。不要把文件重命名为量化格式或直接套用FP8到MPS。

未下载模型、未提交推理、未生成图片、未写入Figma。当前验证只涵盖节点接口、必填字段、枚举及连线类型，不等于ComfyUI执行验证或画质验证。

## 使用

在客户端目录运行（Node自带API，无额外依赖）：

```sh
node workflows/comfy/qwen-poster.mjs check
node workflows/comfy/qwen-poster.mjs export /tmp/qwen-poster-api.json
```

检查命令会读取本机8188端口的节点和模型列表；发现缺项时返回非零退出码，不会启动生成。可传入已保存的object_info JSON离线检查。

服务接入时通过`buildWorkflow({ template, portrait, prompt, seed, megapixels })`生成每条API任务。template/portrait必须是ComfyUI `/upload/image` 返回的输入文件引用，不是Astrix上传路径。构建器输出用作 `/prompt` 的 `prompt` 字段，不能把整份JSON作为没有外层字段的请求提交。成功响应中的prompt_id只代表入队；必须查询history确认SaveImage输出，并取得真实图像后才标记generated。每批最多10条，质量审核后再继续，不自动重生已通过记录。

官方节点参考：https://docs.comfy.org/built-in-nodes/TextEncodeQwenImageEditPlus
官方模型流程：https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511
