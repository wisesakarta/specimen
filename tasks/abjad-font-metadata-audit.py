#!/usr/bin/env python3
"""Audit metadata font hasil download Abjad (Arabic coverage + OpenType features)."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Set

from fontTools.ttLib import TTFont


FONT_EXTS = {".ttf", ".otf", ".woff", ".woff2"}
PLACEHOLDER_POSTSCRIPT_RE = re.compile(r"(xtest|mxxx|0{4,}|x{3,})", re.IGNORECASE)
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


def count_scripts(codepoints: Set[int]) -> Dict[str, int]:
    arabic = 0
    latin = 0
    for cp in codepoints:
        if (
            0x0600 <= cp <= 0x06FF
            or 0x0750 <= cp <= 0x077F
            or 0x08A0 <= cp <= 0x08FF
            or 0xFB50 <= cp <= 0xFDFF
            or 0xFE70 <= cp <= 0xFEFF
        ):
            arabic += 1
        if 0x0041 <= cp <= 0x007A or 0x00C0 <= cp <= 0x024F:
            latin += 1
    return {"arabic": arabic, "latin": latin}


def extract_feature_tags(tt: TTFont, table_name: str) -> List[str]:
    if table_name not in tt:
        return []
    table = tt[table_name].table
    if not table or not getattr(table, "FeatureList", None):
        return []
    return sorted({record.FeatureTag for record in table.FeatureList.FeatureRecord})


def safe_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def default_weight_axis(tt: TTFont) -> Optional[float]:
    if "fvar" not in tt:
        return None
    try:
        for axis in tt["fvar"].axes:
            if axis.axisTag == "wght":
                return float(axis.defaultValue)
    except Exception:
        return None
    return None


def infer_expected_weight_class(subfamily: str, fallback_default_weight: Optional[float]) -> Optional[int]:
    compact = safe_token(re.sub(r"\b(italic|oblique)\b", "", subfamily or ""))
    if compact in {"variable", "vf"}:
        if fallback_default_weight is not None:
            return max(1, min(1000, int(round(fallback_default_weight))))
        return None
    for token, weight_class in WEIGHT_NAME_TO_CLASS:
        if token in compact:
            return weight_class
    return None


def extract_fvar_info(tt: TTFont) -> Dict[str, object]:
    if "fvar" not in tt:
        return {"hasFvar": False, "axes": [], "instances": [], "defaultWeight": None}

    axes = []
    default_weight = None
    for axis in tt["fvar"].axes:
        axes.append(
            {
                "tag": axis.axisTag,
                "min": float(axis.minValue),
                "default": float(axis.defaultValue),
                "max": float(axis.maxValue),
            }
        )
        if axis.axisTag == "wght":
            default_weight = float(axis.defaultValue)

    instances = []
    for inst in tt["fvar"].instances:
        subfamily = ""
        postscript_name = ""
        try:
            subfamily = tt["name"].getDebugName(inst.subfamilyNameID) or ""
        except Exception:
            subfamily = ""
        try:
            if getattr(inst, "postscriptNameID", 0xFFFF) != 0xFFFF:
                postscript_name = tt["name"].getDebugName(inst.postscriptNameID) or ""
        except Exception:
            postscript_name = ""
        instances.append(
            {
                "subfamily": subfamily,
                "postscriptName": postscript_name,
                "coordinates": {tag: float(value) for tag, value in inst.coordinates.items()},
            }
        )

    return {"hasFvar": True, "axes": axes, "instances": instances, "defaultWeight": default_weight}


def audit_font(font_path: Path) -> Dict[str, object]:
    tt = TTFont(str(font_path))
    codepoints: Set[int] = set()
    for cmap_table in tt["cmap"].tables:
        codepoints.update(cmap_table.cmap.keys())

    script_counts = count_scripts(codepoints)
    gsub_tags = extract_feature_tags(tt, "GSUB")
    gpos_tags = extract_feature_tags(tt, "GPOS")
    fvar_info = extract_fvar_info(tt)
    weight_class = None
    if "OS/2" in tt and hasattr(tt["OS/2"], "usWeightClass"):
        try:
            weight_class = int(tt["OS/2"].usWeightClass)
        except Exception:
            weight_class = None

    return {
        "file": str(font_path),
        "family": get_name(tt, 1),
        "subfamily": get_name(tt, 2),
        "fullName": get_name(tt, 4),
        "postscriptName": get_name(tt, 6),
        "cmapCount": len(codepoints),
        "arabicCount": script_counts["arabic"],
        "latinCount": script_counts["latin"],
        "weightClass": weight_class,
        "hasFvar": fvar_info["hasFvar"],
        "fvarAxes": fvar_info["axes"],
        "fvarDefaultWeight": fvar_info["defaultWeight"],
        "fvarInstances": fvar_info["instances"],
        "gsubFeatureCount": len(gsub_tags),
        "gsubFeatures": gsub_tags,
        "gposFeatureCount": len(gpos_tags),
        "gposFeatures": gpos_tags,
    }


def collect_fonts(root: Path) -> List[Path]:
    if root.is_file() and root.suffix.lower() in FONT_EXTS:
        return [root]
    if not root.exists():
        return []
    return sorted([p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in FONT_EXTS])


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit metadata font outputs")
    parser.add_argument("paths", nargs="+", help="Folder/file font output")
    parser.add_argument("--json", action="store_true", help="Print full JSON")
    args = parser.parse_args()

    records: List[Dict[str, object]] = []
    problems: List[Dict[str, object]] = []

    for raw in args.paths:
        root = Path(raw)
        for font_path in collect_fonts(root):
            try:
                rec = audit_font(font_path)
                records.append(rec)
                if rec["arabicCount"] == 0:
                    problems.append({"file": str(font_path), "reason": "arabicCount=0"})
                if not rec["family"] or not rec["subfamily"]:
                    problems.append({"file": str(font_path), "reason": "missing family/subfamily"})

                family_token = safe_token(str(rec["family"]))
                for instance in rec.get("fvarInstances", []):
                    if not isinstance(instance, dict):
                        continue
                    instance_ps = str(instance.get("postscriptName") or "").strip()
                    if not instance_ps:
                        continue
                    instance_token = safe_token(instance_ps)
                    if family_token and not instance_token.startswith(family_token):
                        problems.append(
                            {
                                "file": str(font_path),
                                "reason": f"instance-postscript-family-mismatch:{instance_ps}",
                            }
                        )
                    elif PLACEHOLDER_POSTSCRIPT_RE.search(instance_ps):
                        problems.append(
                            {
                                "file": str(font_path),
                                "reason": f"instance-postscript-placeholder:{instance_ps}",
                            }
                        )

                expected_weight_class = infer_expected_weight_class(
                    str(rec["subfamily"]),
                    rec.get("fvarDefaultWeight") if isinstance(rec.get("fvarDefaultWeight"), (int, float)) else None,
                )
                actual_weight_class = rec.get("weightClass")
                if (
                    expected_weight_class is not None
                    and isinstance(actual_weight_class, int)
                    and abs(actual_weight_class - expected_weight_class) >= 100
                ):
                    problems.append(
                        {
                            "file": str(font_path),
                            "reason": f"weight-class-mismatch:{actual_weight_class}!={expected_weight_class}",
                        }
                    )
            except Exception as exc:
                problems.append({"file": str(font_path), "reason": f"parse-error: {exc}"})

    summary = {
        "fontsAudited": len(records),
        "problems": len(problems),
        "filesWithArabic": sum(1 for r in records if int(r["arabicCount"]) > 0),
    }

    if args.json:
        print(
            json.dumps(
                {
                    "summary": summary,
                    "problems": problems,
                    "records": records,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    print("SUMMARY", json.dumps(summary, ensure_ascii=False))
    for rec in records:
        print(
            f"- {Path(str(rec['file'])).name}: family={rec['family']} sub={rec['subfamily']} "
            f"arabic={rec['arabicCount']} latin={rec['latinCount']} "
            f"GSUB={rec['gsubFeatureCount']} GPOS={rec['gposFeatureCount']}"
        )
    if problems:
        print("PROBLEMS")
        for p in problems:
            print(f"- {p['file']}: {p['reason']}")


if __name__ == "__main__":
    main()
