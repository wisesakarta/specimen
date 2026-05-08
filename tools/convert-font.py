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
import os
import re
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
from typing import Dict, List, Optional

try:
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont
except Exception:
    print("ERROR: fontTools not installed. Run: pip install fonttools brotli", file=sys.stderr)
    raise SystemExit(1)


WEIGHT_NAME_TO_CLASS = [
    ("hairline", 100),
    ("thin", 100),
    ("ultralight", 200),
    ("extralight", 200),
    ("light", 300),
    ("book", 400),
    ("regular", 400),
    ("roman", 400),
    ("normal", 400),
    ("medium", 500),
    ("demibold", 600),
    ("semibold", 600),
    ("extrabold", 800),
    ("ultrabold", 800),
    ("bold", 700),
    ("black", 900),
    ("heavy", 900),
]


def _safe_token(value: str) -> str:
    token = re.sub(r"[^A-Za-z0-9]+", "", (value or "").strip())
    return token or "Regular"


def _set_record_text(record, text: str) -> None:
    try:
        enc = record.getEncoding() or "utf-16-be"
        record.string = text.encode(enc, errors="ignore")
    except Exception:
        pass


def _set_name_id_text(name_table, name_id: int, text: str) -> None:
    updated = False
    for rec in name_table.names:
        if rec.nameID != name_id:
            continue
        _set_record_text(rec, text)
        updated = True
    if not updated:
        try:
            name_table.setName(text, name_id, 3, 1, 0x409)
        except Exception:
            pass


def _default_weight_axis(font: TTFont) -> Optional[float]:
    if "fvar" not in font:
        return None
    try:
        for axis in font["fvar"].axes:
            if axis.axisTag == "wght":
                return float(axis.defaultValue)
    except Exception:
        return None
    return None


def _clamp_weight_class(value: float) -> int:
    return max(1, min(1000, int(round(value))))


def _infer_weight_class(font: TTFont, subfamily: str) -> Optional[int]:
    compact = re.sub(r"[^a-z0-9]+", "", re.sub(r"\b(italic|oblique)\b", "", (subfamily or "").lower())).strip()
    default_weight = _default_weight_axis(font)

    if compact in {"variable", "vf"}:
        if default_weight is not None:
            return _clamp_weight_class(default_weight)
        return 400

    for token, weight_class in WEIGHT_NAME_TO_CLASS:
        if token in compact:
            return weight_class

    if default_weight is not None and compact:
        return _clamp_weight_class(default_weight)

    if "OS/2" in font and hasattr(font["OS/2"], "usWeightClass"):
        try:
            return int(font["OS/2"].usWeightClass)
        except Exception:
            return None
    return None


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

    if "fvar" in font:
        for instance in font["fvar"].instances:
            style_name = _normalize_instance_style_name(font, instance)
            subfamily_name_id = getattr(instance, "subfamilyNameID", 0xFFFF)
            postscript_name_id = getattr(instance, "postscriptNameID", 0xFFFF)

            if isinstance(subfamily_name_id, int) and subfamily_name_id not in {0xFFFF, 2, 17}:
                _set_name_id_text(name_table, subfamily_name_id, style_name)

            if isinstance(postscript_name_id, int) and postscript_name_id not in {0xFFFF, 6}:
                _set_name_id_text(
                    name_table,
                    postscript_name_id,
                    f"{_safe_token(current_family)}-{_safe_token(style_name)}",
                )

    if "OS/2" in font:
        expected_weight_class = _infer_weight_class(font, current_subfamily)
        if expected_weight_class is not None and hasattr(font["OS/2"], "usWeightClass"):
            font["OS/2"].usWeightClass = expected_weight_class
        if hasattr(font["OS/2"], "fsType"):
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
    ital_value = None
    try:
        if "ital" in instance.coordinates:
            ital_value = float(instance.coordinates["ital"])
    except Exception:
        ital_value = None
    is_italic_instance = ital_value is not None and ital_value >= 0.5
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

    # Normalize only true regular aliases. Keep "Book" as a first-class style.
    if style_name.lower() in {"regular", "roman", "normal", "variable"}:
        style_name = "Regular"

    if is_italic_source:
        if "italic" not in style_name.lower():
            style_name = f"{style_name} Italic"
    elif is_italic_instance:
        if "italic" not in style_name.lower():
            style_name = f"{style_name} Italic"
    else:
        # Keep upright instances upright if placeholder labels leak "Italic"
        # while the current instance does not activate italic axis.
        style_name = re.sub(r"\s+italic\b", "", style_name, flags=re.IGNORECASE)

    style_name = re.sub(r"\s+", " ", style_name).strip()
    return style_name or "Regular"


_WORKER_FONT_CACHE: Dict[str, TTFont] = {}


def _get_worker_font(input_path: str) -> TTFont:
    cached = _WORKER_FONT_CACHE.get(input_path)
    if cached is not None:
        return cached

    loaded = TTFont(input_path, recalcTimestamp=False)
    _WORKER_FONT_CACHE[input_path] = loaded
    return loaded


def _save_instance_job(job):
    input_path, family_name, style_name, coordinates, out_path = job
    base_font = _get_worker_font(str(input_path))
    static_font = instantiateVariableFont(base_font, coordinates, inplace=False)
    _patch_name_table(static_font, family_name, style_name)
    static_font.flavor = None
    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    static_font.save(str(target))
    static_font.close()
    return str(target)


def _explode_instances(font: TTFont, output_hint: str, family_hint: Optional[str]) -> List[str]:
    if "fvar" not in font:
        return []

    base_output = Path(output_hint)
    output_dir = base_output.parent
    family_name = family_hint or font["name"].getDebugName(16) or font["name"].getDebugName(1) or "Font"
    family_token = _safe_token(family_name)

    # Preserve sfnt signature compatibility: CFF/CFF2-based instances should use .otf extension.
    instance_ext = "otf" if ("CFF " in font or "CFF2" in font) else "ttf"

    jobs = []
    seen_paths = set()
    for inst in font["fvar"].instances:
        style_name = _instance_style_name(font, inst)
        style_token = _safe_token(style_name)
        out_path = output_dir / f"{family_token}-{style_token}.{instance_ext}"

        # Deduplicate only within this conversion run.
        # Existing files from previous runs should be overwritten to keep deterministic names.
        n = 1
        while str(out_path) in seen_paths:
            out_path = output_dir / f"{family_token}-{style_token}-{n}.{instance_ext}"
            n += 1

        seen_paths.add(str(out_path))
        coordinates = {tag: float(value) for tag, value in dict(inst.coordinates).items()}
        jobs.append((str(base_output), family_name, style_name, coordinates, str(out_path)))

    if not jobs:
        return []

    instance_count = len(jobs)
    cpu_count = max(1, os.cpu_count() or 1)
    worker_count = min(6, max(2, cpu_count // 2))
    use_parallel = instance_count >= 24 and worker_count > 1

    if use_parallel:
        try:
            with ProcessPoolExecutor(max_workers=worker_count) as executor:
                return list(executor.map(_save_instance_job, jobs))
        except Exception:
            # Fallback to sequential path if multiprocessing is unavailable in runtime.
            pass

    return [_save_instance_job(job) for job in jobs]


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

