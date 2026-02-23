#!/usr/bin/env python3
"""
Convert font files to multiple formats and optionally explode variable-font instances.

Expected JSON stdout schema:
{
  "ttf": "..." | null,
  "otf": "..." | null,
  "woff": "..." | null,
  "woff2": "..." | null,
  "instances": ["..."]
}
"""

import argparse
import sys
import json
import re
from pathlib import Path
from typing import Dict, List, Optional

try:
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont
except Exception:
    print("ERROR: fontTools not installed. Run: pip install fonttools brotli", file=sys.stderr)
    raise SystemExit(1)


def _safe_token(value: str) -> str:
    token = re.sub(r"[^A-Za-z0-9]+", "", (value or "").strip())
    return token or "Regular"


def _set_record_text(record, text: str) -> None:
    try:
        enc = record.getEncoding() or "utf-16-be"
        record.string = text.encode(enc, errors="ignore")
    except Exception:
        pass


def _patch_name_table(font: TTFont, family: Optional[str], subfamily: Optional[str]) -> None:
    if "name" not in font:
        return

    name_table = font["name"]
    current_family = (family or "").strip()
    current_subfamily = (subfamily or "").strip()

    if not current_family:
        current_family = (
            (name_table.getDebugName(16) or "").strip()
            or (name_table.getDebugName(1) or "").strip()
            or "Font"
        )
    if not current_subfamily:
        current_subfamily = (
            (name_table.getDebugName(17) or "").strip()
            or (name_table.getDebugName(2) or "").strip()
            or "Regular"
        )

    version_name = (name_table.getDebugName(5) or "").strip() or "Version 1.000"

    full_name = f"{current_family} {current_subfamily}".strip()
    ps_name = f"{_safe_token(current_family)}-{_safe_token(current_subfamily)}"
    unique_name = f"{current_family}; {current_subfamily}; {version_name}".strip()

    for rec in name_table.names:
        if rec.nameID in (1, 16):
            _set_record_text(rec, current_family)
        elif rec.nameID in (2, 17):
            _set_record_text(rec, current_subfamily)
        elif rec.nameID == 4:
            _set_record_text(rec, full_name)
        elif rec.nameID == 6:
            _set_record_text(rec, ps_name)
        elif rec.nameID == 3:
            try:
                existing = str(rec.toUnicode()).strip()
            except Exception:
                existing = ""
            if not existing or existing == ".":
                _set_record_text(rec, unique_name)

    # Ensure critical Windows name records exist for desktop loaders.
    if not name_table.getName(1, 3, 1, 0x409):
        name_table.setName(current_family, 1, 3, 1, 0x409)
    if not name_table.getName(2, 3, 1, 0x409):
        name_table.setName(current_subfamily, 2, 3, 1, 0x409)
    if not name_table.getName(4, 3, 1, 0x409):
        name_table.setName(full_name, 4, 3, 1, 0x409)
    if not name_table.getName(5, 3, 1, 0x409):
        name_table.setName(version_name, 5, 3, 1, 0x409)
    if not name_table.getName(6, 3, 1, 0x409):
        name_table.setName(ps_name, 6, 3, 1, 0x409)
    unique_win_name = name_table.getName(3, 3, 1, 0x409)
    if unique_win_name:
        try:
            if not str(unique_win_name.toUnicode()).strip():
                name_table.setName(unique_name, 3, 3, 1, 0x409)
        except Exception:
            name_table.setName(unique_name, 3, 3, 1, 0x409)
    else:
        name_table.setName(unique_name, 3, 3, 1, 0x409)

    if "OS/2" in font and hasattr(font["OS/2"], "fsType"):
        font["OS/2"].fsType = 0


def _read_sfnt_signature(font_path: Path) -> str:
    try:
        with open(font_path, "rb") as handle:
            signature = handle.read(4)
    except Exception:
        return ""

    if signature == b"\x00\x01\x00\x00":
        return "ttf"
    if signature == b"OTTO":
        return "otf"
    if signature == b"wOFF":
        return "woff"
    if signature == b"wOF2":
        return "woff2"
    return ""


def _remove_if_signature_mismatch(font_path: Path, expected: str) -> bool:
    signature = _read_sfnt_signature(font_path)
    if signature == expected:
        return False

    try:
        font_path.unlink()
    except Exception:
        pass
    return True


def _export_primary(font: TTFont, args) -> Dict:
    result = {
        "ttf": None,
        "otf": None,
        "woff": None,
        "woff2": None,
    }

    ttf_out = Path(args.ttf)
    if args.ttf:
        font.flavor = None
        ttf_out.parent.mkdir(parents=True, exist_ok=True)
        font.save(str(ttf_out))
        if not _remove_if_signature_mismatch(ttf_out, "ttf"):
            result["ttf"] = str(ttf_out)

    if args.otf and not args.no_otf:
        otf_out = Path(args.otf)
        font.flavor = None
        otf_out.parent.mkdir(parents=True, exist_ok=True)
        font.save(str(otf_out))
        if not _remove_if_signature_mismatch(otf_out, "otf"):
            result["otf"] = str(otf_out)

    if args.woff:
        woff_out = Path(args.woff)
        font.flavor = "woff"
        woff_out.parent.mkdir(parents=True, exist_ok=True)
        font.save(str(woff_out))
        if not _remove_if_signature_mismatch(woff_out, "woff"):
            result["woff"] = str(woff_out)

    if args.woff2:
        woff2_out = Path(args.woff2)
        font.flavor = "woff2"
        woff2_out.parent.mkdir(parents=True, exist_ok=True)
        font.save(str(woff2_out))
        if not _remove_if_signature_mismatch(woff2_out, "woff2"):
            result["woff2"] = str(woff2_out)

    return result


def _instance_style_name(font: TTFont, instance) -> str:
    return _normalize_instance_style_name(font, instance)


def _font_is_italic_source(font: TTFont) -> bool:
    try:
        name_table = font["name"]
    except Exception:
        return False

    for name_id in (17, 2):
        label = name_table.getDebugName(name_id)
        if label and "italic" in label.lower():
            return True
    return False


def _weight_to_label(weight_value: Optional[float]) -> Optional[str]:
    if weight_value is None:
        return None

    weight_map = {
        100: "Thin",
        200: "ExtraLight",
        300: "Light",
        400: "Regular",
        500: "Medium",
        600: "SemiBold",
        700: "Bold",
        800: "ExtraBold",
        900: "Black",
    }
    nearest = min(weight_map.keys(), key=lambda key: abs(weight_value - key))
    if abs(weight_value - nearest) > 60:
        return None
    return weight_map[nearest]


def _normalize_instance_style_name(font: TTFont, instance) -> str:
    raw_name = ""
    try:
        raw = font["name"].getDebugName(instance.subfamilyNameID)
        raw_name = raw.strip() if raw else ""
    except Exception:
        raw_name = ""

    weight_value = None
    try:
        if "wght" in instance.coordinates:
            weight_value = float(instance.coordinates["wght"])
    except Exception:
        weight_value = None

    is_italic_source = _font_is_italic_source(font)
    lower = raw_name.lower()
    looks_like_placeholder = lower in {
        "",
        "variable",
        "instance",
        "wght400",
        "wght 400",
        "wght-400",
        "wght_400",
    }

    style_name = raw_name
    if looks_like_placeholder:
        inferred = _weight_to_label(weight_value)
        style_name = inferred or "Regular"

    normalized_style = re.sub(r"\s+", " ", style_name.lower()).strip()
    if normalized_style in {"variable", "variable roman"}:
        style_name = "Regular"
    elif normalized_style in {"variable italic", "variable oblique"}:
        style_name = "Regular Italic"

    # Normalize regular aliases.
    if style_name.lower() in {"regular", "roman", "book", "normal", "variable"}:
        style_name = "Regular"

    if is_italic_source:
        if "italic" not in style_name.lower():
            style_name = f"{style_name} Italic"
    else:
        # Keep upright instances upright even if a placeholder leaks "Italic".
        style_name = re.sub(r"\s+italic\b", "", style_name, flags=re.IGNORECASE)

    style_name = re.sub(r"\s+", " ", style_name).strip()
    return style_name or "Regular"


def _explode_instances(font: TTFont, output_hint: str, family_hint: Optional[str]) -> List[str]:
    if "fvar" not in font:
        return []

    base_output = Path(output_hint)
    output_dir = base_output.parent
    family_name = family_hint or font["name"].getDebugName(16) or font["name"].getDebugName(1) or "Font"
    family_token = _safe_token(family_name)

    instances: List[str] = []
    seen = set()

    for inst in font["fvar"].instances:
        style_name = _instance_style_name(font, inst)
        style_token = _safe_token(style_name)
        static_font = instantiateVariableFont(font, inst.coordinates, inplace=False)
        _patch_name_table(static_font, family_name, style_name)
        static_font.flavor = None

        # Preserve sfnt signature compatibility: CFF/CFF2-based instances should use .otf extension.
        instance_ext = "otf" if ("CFF " in static_font or "CFF2" in static_font) else "ttf"
        file_name = f"{family_token}-{style_token}.{instance_ext}"
        out_path = output_dir / file_name

        # Deduplicate only within this conversion run.
        # Existing files from previous runs should be overwritten to keep deterministic names.
        n = 1
        while str(out_path) in seen:
            out_path = output_dir / f"{family_token}-{style_token}-{n}.{instance_ext}"
            n += 1

        out_path.parent.mkdir(parents=True, exist_ok=True)
        static_font.save(str(out_path))
        static_font.close()

        instances.append(str(out_path))
        seen.add(str(out_path))

    return instances


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert fonts to multiple output formats")
    parser.add_argument("input", help="Input font path")
    parser.add_argument("ttf", help="Output TTF path")
    parser.add_argument("otf", nargs="?", default="", help="Output OTF path")
    parser.add_argument("woff", nargs="?", default="", help="Output WOFF path")
    parser.add_argument("--woff2", dest="woff2", default="", help="Output WOFF2 path")
    parser.add_argument("--family", dest="family", default="", help="Force family name")
    parser.add_argument("--subfamily", dest="subfamily", default="", help="Force subfamily name")
    parser.add_argument("--no-otf", action="store_true", help="Skip OTF conversion")
    parser.add_argument("--no-explode", action="store_true", help="Skip variable-font instance explosion")
    args = parser.parse_args()

    result = {
        "ttf": None,
        "otf": None,
        "woff": None,
        "woff2": None,
        "instances": [],
    }

    input_path = Path(args.input)
    if not input_path.exists():
        print(json.dumps({"error": f"input not found: {input_path}"}), file=sys.stderr)
        raise SystemExit(1)

    font = None
    try:
        font = TTFont(str(input_path), recalcTimestamp=False)
        _patch_name_table(font, args.family or None, args.subfamily or None)

        exported = _export_primary(font, args)
        result.update(exported)

        if not args.no_explode and "fvar" in font and args.ttf:
            result["instances"] = _explode_instances(font, args.ttf, args.family or None)

        # preserve original woff2 when no explicit output provided
        if not result.get("woff2"):
            result["woff2"] = str(input_path)

        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        raise SystemExit(1)
    finally:
        try:
            if font is not None:
                font.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
