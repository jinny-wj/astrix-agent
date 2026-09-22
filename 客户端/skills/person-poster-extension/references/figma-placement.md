# 成图摆放与用户提供的辅助 skill

用户提供了 insert-nodes、work-with-images、position-nodes、set-clipping、manage-node-hierarchy；set-clipping 重复一次。这些用于整理成图，不执行生图或读取 Excel。

- 创建 1080×1920 Frame 并设置 clipsContent=true；图片为 frame 内唯一成图节点。组不支持裁切。
- 先 appendChild 再设置相对坐标；图片按实际像素比例等比填充、居中，不拉伸。
- 在支持的自动布局容器中手动定位图片前设置 layoutPositioning='ABSOLUTE'。resize 会重置尺寸模式，需先 resize 再设置 AUTO/FILL。
- 保持目标文件、页面和模板节点身份，检查碰撞后整组挪到空白区域，保留组内顺序与间距。
- 原文本的 findPlacement 并非可以假定存在的通用方法；先检查宿主能力，没有就根据节点边界计算位置。
- 图像滤镜属于 ImagePaint，不属于节点；本流程终检后不自动加滤镜或覆盖文案。
- 重挂载、旋转或变换后的节点不能简单通过 x/y 相加保留视觉位置；需要实际坐标变换。这里直接创建新画框，避免修改原模板层级。
- 不采用“最后一个子节点移走后再 remove 原组”的固定代码，组可能已自动移除。只清理属于当前任务的临时对象。
- Plugin Bridge 未确认支持并执行图片导入时，保留本机图片并报告待回填，不宣称已写入 Figma。
