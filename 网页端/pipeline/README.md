# P2 人物海报批量流水线

阶段 A 小样验证脚本。默认 `--dry-run` 不消耗 dreamina credits。

## 目录

```
pipeline/
├── run_poster_batch.py
├── samples/
│   ├── info.csv
│   └── portraits/     # 放入 3-5 张主播原图
└── output/            # 运行后生成
```

## 运行

```bash
mkdir -p pipeline/samples/portraits
# 把原图放进 portraits/，文件名与 info.csv 的 portrait 列对应

python3 pipeline/run_poster_batch.py \
  --input pipeline/samples/portraits \
  --info pipeline/samples/info.csv \
  --template pipeline/samples/template.png \
  --out pipeline/output \
  --dry-run
```

去掉 `--dry-run` 且本机已 `dreamina login` 时，会尝试 `image_upscale`（D03 路线乙）。

## 依赖

- 推荐：Pillow、OpenCV（`pip install pillow opencv-python`）
- 可选：`dreamina` CLI（人像修复）
- 无依赖时仍可复制原图并写出 report.json
