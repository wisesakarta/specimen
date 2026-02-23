#!/usr/bin/env python3
"""
Master Forge fallback implementation.

Given multiple fragment fonts, picks the best candidate (largest usable glyph set),
applies requested naming metadata, and writes a recovered output font.
"""

import argparse
import json
from pathlib import Path
from typing import Optional, Tuple

try:
    from fontTools.ttLib import TTFont
except Exception:
    print("ERROR: fontTools not installed. Run: pip install fonttools brotli")
    raise SystemExit(1)


def _set_name_record(record, text: str) -> None:
    try:
        encoding = record.getEncoding() or "utf-16-be"
        record.string = text.encode(encoding, errors="ignore")
    except Exception:
        # Keep original if encoding update fails.
        pass


def _patch_names(font: TTFont, family: str, subfamily: str, psname: str) -> None:
    if "name" not in font:
        return
    full_name = f"{family} {subfamily}".strip()
    for rec in font["name"].names:
        if rec.nameID in (1, 16):
            _set_name_record(rec, family)
        elif rec.nameID in (2, 17):
            _set_name_record(rec, subfamily)
        elif rec.nameID == 4:
            _set_name_record(rec, full_name)
        elif rec.nameID == 6:
            _set_name_record(rec, psname)


def _score_font(path: Path) -> Tuple[int, Optional[TTFont]]:
    try:
        font = TTFont(str(path), recalcTimestamp=False)
        glyph_count = 0
        if "maxp" in font and hasattr(font["maxp"], "numGlyphs"):
            glyph_count = int(font["maxp"].numGlyphs)
        return glyph_count, font
    except Exception:
        return 0, None


def main() -> None:
    parser = argparse.ArgumentParser(description="Master Forge fallback")
    parser.add_argument("--fragments", nargs="+", required=True, help="Fragment font files")
    parser.add_argument("--output", required=True, help="Output recovered font path")
    parser.add_argument("--family", required=True, help="Family name")
    parser.add_argument("--subfamily", required=True, help="Subfamily name")
    parser.add_argument("--psname", required=True, help="PostScript name")
    parser.add_argument("--autoname", action="store_true", help="Compatibility flag")
    parser.add_argument("--skeleton", default="", help="Optional skeleton (unused in fallback)")
    args = parser.parse_args()

    best_font = None
    best_score = -1
    best_path = None

    for raw in args.fragments:
        path = Path(raw)
        if not path.exists():
            continue
        score, font = _score_font(path)
        if font is not None and score > best_score:
            if best_font is not None:
                best_font.close()
            best_font = font
            best_score = score
            best_path = path
        elif font is not None:
            font.close()

    if best_font is None:
        raise SystemExit("No valid fragments to forge.")

    try:
        _patch_names(best_font, args.family, args.subfamily, args.psname)
        if "OS/2" in best_font and hasattr(best_font["OS/2"], "fsType"):
            best_font["OS/2"].fsType = 0

        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        best_font.save(str(output_path))
    finally:
        best_font.close()

    metadata = {
        "family": args.family,
        "subfamily": args.subfamily,
        "psname": args.psname,
        "source_fragment": str(best_path) if best_path else "",
        "glyph_count": max(best_score, 0),
    }
    Path(str(args.output) + ".json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
