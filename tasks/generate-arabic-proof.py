#!/usr/bin/env python3
"""Generate a single Arabic proof HTML for downloaded fonts."""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path
from typing import Dict, List, Tuple

from fontTools.ttLib import TTFont

FONT_EXTS = {".woff2": 0, ".woff": 1, ".ttf": 2, ".otf": 3}
ARABIC_SAMPLES = [
    "من قلبي سلامٌ لبيروت وقبلٌ للبحر والبيوت",
    "الحرف العربي هنا يُعرض للمطابقة البصرية الدقيقة بين النسخ المحمّلة.",
    "أبجد هوز حطي كلمن سعفص قرشت ثخذ ضظغ",
    "١٢٣٤٥٦٧٨٩٠",
]


def get_name(tt: TTFont, name_id: int) -> str:
    for rec in tt["name"].names:
        if rec.nameID != name_id:
            continue
        try:
            text = rec.toUnicode()
        except Exception:
            continue
        if text:
            return text
    return ""


def safe_token(value: str) -> str:
    token = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return token or "font"


def collect_fonts(root: Path) -> Dict[Tuple[str, str], Path]:
    selected: Dict[Tuple[str, str], Path] = {}
    for path in sorted(p for p in root.iterdir() if p.is_file() and p.suffix.lower() in FONT_EXTS):
        tt = TTFont(str(path))
        family = get_name(tt, 1) or path.stem
        subfamily = get_name(tt, 2) or "Regular"
        key = (family, subfamily)
        prev = selected.get(key)
        if prev is None or FONT_EXTS[path.suffix.lower()] < FONT_EXTS[prev.suffix.lower()]:
            selected[key] = path
    return selected


def generate_html(root: Path, output_path: Path) -> None:
    fonts = collect_fonts(root)
    faces: List[str] = []
    cards: List[str] = []

    for index, ((family, subfamily), path) in enumerate(sorted(fonts.items())):
        face_name = f"proof-{safe_token(family)}-{safe_token(subfamily)}-{index}"
        rel_path = path.name.replace('\\', '/')
        fmt = path.suffix.lower().lstrip('.')
        faces.append(
            f"@font-face {{ font-family: '{face_name}'; src: url('{html.escape(rel_path)}') format('{fmt}'); font-display: swap; }}"
        )
        sample_html = "".join(
            f"<p class=\"sample\" style=\"font-family:'{face_name}'\">{html.escape(sample)}</p>"
            for sample in ARABIC_SAMPLES
        )
        cards.append(
            f"<section class=\"card\"><h2>{html.escape(family)} <span>{html.escape(subfamily)}</span></h2><div class=\"meta\">{html.escape(path.name)}</div>{sample_html}</section>"
        )

    html_text = """<!doctype html>
<html lang=\"ar\">
<head>
<meta charset=\"utf-8\">
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
<title>Arabic Proof</title>
<style>
:root { color-scheme: light; }
body { margin: 0; font-family: Georgia, 'Times New Roman', serif; background: #f3eee5; color: #1e140c; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 28px; margin: 0 0 10px; }
p.lead { margin: 0 0 28px; max-width: 70ch; line-height: 1.6; }
.card { background: rgba(255,255,255,0.72); border: 1px solid rgba(30,20,12,0.12); border-radius: 18px; padding: 18px 18px 10px; margin: 0 0 18px; box-shadow: 0 10px 30px rgba(30,20,12,0.05); }
h2 { font-size: 20px; margin: 0 0 6px; }
h2 span { font-weight: normal; opacity: 0.75; }
.meta { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.7; margin-bottom: 14px; }
.sample { direction: rtl; text-align: right; font-size: clamp(28px, 4vw, 54px); line-height: 1.45; margin: 0 0 12px; }
@media (max-width: 720px) { .sample { font-size: 28px; } }
</style>
<style>
__FACES__
</style>
</head>
<body>
<main>
<h1>Arabic Visual Proof</h1>
<p class=\"lead\">Proof ini merender font hasil download langsung dari folder yang sama untuk pencocokan visual Arabic script. Setiap kartu memakai file font yang diprioritaskan per style: WOFF2, lalu WOFF, lalu TTF/OTF.</p>
__CARDS__
</main>
</body>
</html>
"""
    output_path.write_text(html_text.replace('__FACES__', '\n'.join(faces)).replace('__CARDS__', '\n'.join(cards)), encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate Arabic proof HTML')
    parser.add_argument('folder', help='Folder containing downloaded fonts')
    parser.add_argument('--output', default='arabic-proof.html', help='Output HTML file name/path')
    args = parser.parse_args()

    root = Path(args.folder)
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = root / output_path

    generate_html(root, output_path)
    print(json.dumps({"output": str(output_path)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
