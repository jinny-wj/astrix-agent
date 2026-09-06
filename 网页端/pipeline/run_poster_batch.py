#!/usr/bin/env python3
"""P2 person-poster batch pipeline — stage A sample runner.

Pipeline:
  1) preprocess (OpenCV face detect / crop hints)
  2) portrait repair (dreamina image2image / image_upscale) — optional
  3) template composite (Pillow)
  4) quality checks (local heuristics)
  5) export multi-spec + report

Usage:
  python3 pipeline/run_poster_batch.py \
    --input pipeline/samples/portraits \
    --template pipeline/samples/template.png \
    --info pipeline/samples/info.csv \
    --out pipeline/output \
    --dry-run
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class JobItem:
    portrait: str
    name: str
    title: str
    tag: str


@dataclass
class QualityResult:
    portrait: str
    ok: bool
    notes: list[str]


SPECS = [
    ("popup", 840, 1120),
    ("cover", 720, 1280),
    ("banner", 584, 160),
]


def load_jobs(info_csv: Path, portraits_dir: Path) -> list[JobItem]:
    jobs: list[JobItem] = []
    if info_csv.exists():
        with info_csv.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                portrait = row.get("portrait") or row.get("file") or ""
                path = portraits_dir / portrait if portrait else None
                if path and path.exists():
                    jobs.append(
                        JobItem(
                            portrait=str(path),
                            name=row.get("name") or path.stem,
                            title=row.get("title") or "",
                            tag=row.get("tag") or "",
                        )
                    )
    if jobs:
        return jobs

    for path in sorted(portraits_dir.glob("*")):
        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
            jobs.append(
                JobItem(
                    portrait=str(path),
                    name=path.stem,
                    title=path.stem,
                    tag="",
                )
            )
    return jobs


def try_import_cv2():
    try:
        import cv2  # type: ignore

        return cv2
    except Exception:
        return None


def try_import_pil():
    try:
        from PIL import Image, ImageDraw, ImageFont  # type: ignore

        return Image, ImageDraw, ImageFont
    except Exception:
        return None, None, None


def preprocess(portrait: Path, out_dir: Path, use_opencv: bool) -> Path:
    out = out_dir / f"{portrait.stem}_pre.png"
    if not use_opencv:
        shutil.copy2(portrait, out)
        return out

    cv2 = try_import_cv2()
    if cv2 is None:
        shutil.copy2(portrait, out)
        return out

    image = cv2.imread(str(portrait))
    if image is None:
        shutil.copy2(portrait, out)
        return out

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    faces = cascade.detectMultiScale(gray, 1.1, 4)
    if len(faces) > 0:
        x, y, w, h = max(faces, key=lambda item: item[2] * item[3])
        pad = int(max(w, h) * 0.35)
        x0 = max(0, x - pad)
        y0 = max(0, y - pad)
        x1 = min(image.shape[1], x + w + pad)
        y1 = min(image.shape[0], y + h + pad)
        image = image[y0:y1, x0:x1]
    cv2.imwrite(str(out), image)
    return out


def repair_with_dreamina(portrait: Path, out_dir: Path, dry_run: bool) -> Path:
    out = out_dir / f"{portrait.stem}_repair.png"
    if dry_run:
        shutil.copy2(portrait, out)
        return out

    dreamina = shutil.which("dreamina")
    if not dreamina:
        shutil.copy2(portrait, out)
        return out

    # Prefer upscale for fidelity-first route (D03-乙).
    cmd = [
        dreamina,
        "image_upscale",
        f"--image={portrait}",
        f"--output={out}",
    ]
    try:
        subprocess.run(cmd, check=False, capture_output=True, text=True)
        if out.exists():
            return out
    except Exception:
        pass
    shutil.copy2(portrait, out)
    return out


def composite(
    portrait: Path,
    template: Path | None,
    job: JobItem,
    width: int,
    height: int,
    out_path: Path,
) -> None:
    Image, ImageDraw, ImageFont = try_import_pil()
    if Image is None:
        shutil.copy2(portrait, out_path)
        return

    canvas = Image.new("RGBA", (width, height), (245, 246, 248, 255))
    if template and template.exists():
        base = Image.open(template).convert("RGBA")
        canvas = base.resize((width, height), Image.Resampling.LANCZOS)

    face = Image.open(portrait).convert("RGBA")
    target_h = int(height * 0.72) if height >= width else int(height * 0.9)
    ratio = target_h / max(face.height, 1)
    face = face.resize(
        (max(1, int(face.width * ratio)), max(1, target_h)),
        Image.Resampling.LANCZOS,
    )
    x = (width - face.width) // 2
    y = height - face.height
    canvas.alpha_composite(face, (x, y))

    draw = ImageDraw.Draw(canvas)
    label = " · ".join(part for part in [job.name, job.title, job.tag] if part) or job.name
    font = None
    for candidate in (
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
    ):
        try:
            font = ImageFont.truetype(candidate, size=max(18, width // 24))
            break
        except Exception:
            continue
    try:
        if font is not None:
            draw.text((24, 24), label, fill=(20, 20, 24, 255), font=font)
        else:
            draw.text((24, 24), label.encode("ascii", "ignore").decode() or "poster", fill=(20, 20, 24, 255))
    except Exception:
        draw.rectangle((24, 24, 24 + max(120, width // 3), 56), fill=(20, 20, 24, 255))
    canvas.convert("RGB").save(out_path, quality=92)


def quality_check(portrait: Path, output: Path) -> QualityResult:
    notes: list[str] = []
    ok = True
    if not output.exists():
        return QualityResult(portrait=str(portrait), ok=False, notes=["missing output"])
    size = output.stat().st_size
    if size > 300 * 1024 and "banner" in output.name:
        ok = False
        notes.append(f"banner too large: {size} bytes")
    Image, _, _ = try_import_pil()
    if Image is not None:
        with Image.open(output) as img:
            if min(img.size) < 80:
                ok = False
                notes.append("output too small")
    return QualityResult(portrait=str(portrait), ok=ok, notes=notes)


def main() -> int:
    parser = argparse.ArgumentParser(description="P2 person poster batch pipeline")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--template", type=Path, default=None)
    parser.add_argument("--info", type=Path, default=None)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--use-opencv",
        action="store_true",
        help="Enable OpenCV face crop during preprocess",
    )
    args = parser.parse_args()

    portraits_dir = args.input
    out_root = args.out
    pre_dir = out_root / "01_preprocess"
    repair_dir = out_root / "02_repair"
    export_dir = out_root / "05_export"
    for path in (pre_dir, repair_dir, export_dir):
        path.mkdir(parents=True, exist_ok=True)

    info_csv = args.info or (portraits_dir / "info.csv")
    jobs = load_jobs(info_csv, portraits_dir)
    if not jobs:
        print("No portraits found. Put images under --input or fill info.csv.", file=sys.stderr)
        return 1

    report: dict = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "dryRun": args.dry_run,
        "count": len(jobs),
        "items": [],
    }

    for job in jobs:
        portrait = Path(job.portrait)
        pre = preprocess(portrait, pre_dir, use_opencv=args.use_opencv)
        repaired = repair_with_dreamina(pre, repair_dir, dry_run=args.dry_run)
        outputs = []
        qc_list = []
        for spec_name, width, height in SPECS:
            out_path = export_dir / f"{portrait.stem}_{spec_name}.jpg"
            composite(repaired, args.template, job, width, height, out_path)
            qc = quality_check(portrait, out_path)
            outputs.append(str(out_path))
            qc_list.append(asdict(qc))
        report["items"].append(
            {
                "job": asdict(job),
                "preprocess": str(pre),
                "repair": str(repaired),
                "outputs": outputs,
                "qc": qc_list,
            }
        )
        print(f"done: {job.name} -> {len(outputs)} specs")

    report_path = out_root / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
