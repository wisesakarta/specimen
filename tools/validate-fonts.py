#!/usr/bin/env python3
"""
Font validation utility for Saka Font Scrapper.

Outputs a JSON report with:
- structural validity
- glyph/cmap coverage
- subset heuristics
- name table sanity
- italic filename vs internal-flag mismatch
- optional target token matching (contamination estimation)
"""

import argparse
import json
from pathlib import Path
from typing import Dict, List, Optional

try:
    from fontTools.ttLib import TTFont
except Exception:
    print("ERROR: fontTools not installed. Run: pip install fonttools brotli")
    raise SystemExit(1)


FONT_EXTS = {".woff2", ".woff", ".ttf", ".otf", ".eot"}
SUBSET_THRESHOLD = 50


def _sanitize_token(value: str) -> str:
    return "".join([c for c in (value or "").lower() if c.isalnum()])


def _detect_signature(filepath: Path) -> Optional[str]:
    try:
        with filepath.open("rb") as handle:
            sig = handle.read(4)
    except Exception:
        return None

    if sig == b"wOF2":
        return "woff2"
    if sig == b"wOFF":
        return "woff"
    if sig == b"\x00\x01\x00\x00":
        return "ttf"
    if sig == b"OTTO":
        return "otf"
    return None


def _first_name_value(name_table, name_id: int) -> Optional[str]:
    for rec in getattr(name_table, "names", []):
        if getattr(rec, "nameID", None) != name_id:
            continue
        try:
            value = str(rec.toUnicode()).strip()
        except Exception:
            continue
        if value:
            return value
    return None


def _name_table_sanity(font) -> Dict:
    result = {"ok": False, "issues": [], "names": {}}
    if "name" not in font:
        result["issues"].append("missing name table")
        return result

    name_table = font["name"]
    family = _first_name_value(name_table, 16) or _first_name_value(name_table, 1)
    subfamily = _first_name_value(name_table, 17) or _first_name_value(name_table, 2)
    full_name = _first_name_value(name_table, 4)
    ps_name = _first_name_value(name_table, 6)

    result["names"] = {
        "family": family,
        "subfamily": subfamily,
        "full_name": full_name,
        "postscript_name": ps_name,
    }

    def bad(v: Optional[str]) -> bool:
        if v is None:
            return True
        s = v.strip()
        if not s:
            return True
        if s == ".":
            return True
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in s):
            return True
        return False

    if bad(family):
        result["issues"].append("family name missing/invalid (nameID 16/1)")
    if bad(subfamily):
        result["issues"].append("subfamily name missing/invalid (nameID 17/2)")
    if bad(full_name):
        result["issues"].append("full name missing/invalid (nameID 4)")
    if bad(ps_name):
        result["issues"].append("postscript name missing/invalid (nameID 6)")

    result["ok"] = len(result["issues"]) == 0
    return result


def _is_italic(font) -> Optional[bool]:
    try:
        os2 = font["OS/2"] if "OS/2" in font else None
        head = font["head"] if "head" in font else None
        italic = False
        if os2 is not None and hasattr(os2, "fsSelection"):
            italic = italic or bool(os2.fsSelection & 0x01)
        if head is not None and hasattr(head, "macStyle"):
            italic = italic or bool(head.macStyle & 0x02)
        return italic
    except Exception:
        return None


def _extract_opentype_features(font) -> List[str]:
    tags = set()
    for table_tag in ("GSUB", "GPOS"):
        if table_tag not in font:
            continue
        try:
            table = font[table_tag].table
            feature_list = getattr(table, "FeatureList", None)
            records = getattr(feature_list, "FeatureRecord", None) if feature_list else None
            if not records:
                continue
            for record in records:
                tag = getattr(record, "FeatureTag", None)
                if isinstance(tag, str) and tag.strip():
                    tags.add(tag.strip())
        except Exception:
            continue
    return sorted(tags)


def _name_declares_italic(*values: Optional[str]) -> bool:
    for value in values:
        if not value:
            continue
        token = _sanitize_token(value)
        if not token:
            continue
        if "italic" in token or "oblique" in token or token.endswith("ital"):
            return True
    return False


def _parse_tokens_arg(tokens_arg) -> Optional[List[str]]:
    if not tokens_arg:
        return None
    if isinstance(tokens_arg, str):
        raw_items = [tokens_arg]
    else:
        raw_items = list(tokens_arg)

    tokens: List[str] = []
    for item in raw_items:
        for part in str(item).split(","):
            token = _sanitize_token(part)
            if len(token) >= 4:
                tokens.append(token)
    return list(sorted(set(tokens))) or None


def analyze_font(filepath: Path, target_tokens: Optional[List[str]] = None) -> Dict:
    ext = filepath.suffix.lower().lstrip(".")
    signature = _detect_signature(filepath)
    expected_signature_by_ext = {
        "ttf": "ttf",
        "otf": "otf",
        "woff": "woff",
        "woff2": "woff2",
    }
    expected_signature = expected_signature_by_ext.get(ext)
    ext_signature_mismatch = bool(expected_signature and signature and expected_signature != signature)

    result = {
        "path": str(filepath),
        "filename": filepath.name,
        "ext": ext,
        "signature": signature,
        "ext_signature_mismatch": ext_signature_mismatch,
        "size_bytes": filepath.stat().st_size,
        "is_valid": False,
        "glyph_count": 0,
        "cmap_entries": 0,
        "feature_count": 0,
        "opentype_features": [],
        "is_subetted": False,
        "subset_evidence": [],
        "warnings": [],
        "name_table_ok": False,
        "name_table_issues": [],
        "is_italic": None,
        "filename_is_italic": False,
        "italic_mismatch": False,
        "declared_italic": None,
        "effective_italic": None,
        "target_matched": None,
        "matched_tokens": [],
    }
    if ext_signature_mismatch:
        result["warnings"].append(
            f"extension-signature mismatch: ext={expected_signature}, signature={signature}"
        )

    filename_lower = filepath.name.lower()
    filename_token = _sanitize_token(filename_lower)
    result["filename_is_italic"] = (
        "italic" in filename_token
        or "oblique" in filename_token
        or filename_token.endswith("ital")
    )

    try:
        font = TTFont(str(filepath), 0, ignoreDecompileErrors=True)
        result["is_valid"] = True

        if "maxp" in font:
            result["glyph_count"] = int(getattr(font["maxp"], "numGlyphs", 0))

        if "cmap" in font:
            for table in getattr(font["cmap"], "tables", []):
                cmap = getattr(table, "cmap", None)
                if cmap:
                    result["cmap_entries"] = len(cmap)
                    break

        features = _extract_opentype_features(font)
        result["opentype_features"] = features
        result["feature_count"] = len(features)

        if result["glyph_count"] < SUBSET_THRESHOLD:
            result["is_subetted"] = True
            result["subset_evidence"].append(f"glyph_count<{SUBSET_THRESHOLD}")
        if result["cmap_entries"] < SUBSET_THRESHOLD and result["cmap_entries"] > 0:
            result["is_subetted"] = True
            result["subset_evidence"].append(f"cmap_entries<{SUBSET_THRESHOLD}")

        if "name" in font:
            sanity = _name_table_sanity(font)
            result["name_table_ok"] = sanity.get("ok", False)
            result["name_table_issues"] = sanity.get("issues", [])
            names = sanity.get("names", {}) or {}
            for key in ["family", "subfamily", "full_name", "postscript_name"]:
                if names.get(key):
                    result[f"{key if key != 'subfamily' else 'subfamily'}_name" if key in ("family", "subfamily") else key] = names.get(key)
            if names.get("family"):
                result["family_name"] = names.get("family")
            if names.get("subfamily"):
                result["subfamily_name"] = names.get("subfamily")
            if names.get("full_name"):
                result["full_name"] = names.get("full_name")
            if names.get("postscript_name"):
                result["postscript_name"] = names.get("postscript_name")

            declared_italic = _name_declares_italic(
                names.get("subfamily"),
                names.get("full_name"),
                names.get("postscript_name"),
            )
            result["declared_italic"] = declared_italic

        result["is_italic"] = _is_italic(font)
        effective_italic = None
        if result["is_italic"] is not None:
            effective_italic = bool(result["is_italic"])
        if result.get("declared_italic") is True:
            effective_italic = True if effective_italic is None else (effective_italic or True)
        result["effective_italic"] = effective_italic
        if effective_italic is not None:
            result["italic_mismatch"] = bool(result["filename_is_italic"]) != bool(effective_italic)

        if target_tokens is not None:
            haystack = " ".join([
                str(result.get("filename", "")),
                str(result.get("family_name", "") or ""),
                str(result.get("subfamily_name", "") or ""),
                str(result.get("full_name", "") or ""),
                str(result.get("postscript_name", "") or ""),
            ]).lower()
            collapsed = _sanitize_token(haystack)
            collapsed_wo_ll = collapsed.replace("ll", "")
            matched = []
            for token in target_tokens:
                if token in haystack or token in collapsed or token in collapsed_wo_ll:
                    matched.append(token)
            result["matched_tokens"] = sorted(list(set(matched)))
            result["target_matched"] = len(result["matched_tokens"]) > 0

        font.close()
    except Exception as e:
        result["error"] = str(e)
        result["is_valid"] = False

    return result


def generate_report(results: List[Dict]) -> Dict:
    valid = [r for r in results if r.get("is_valid")]
    invalid = [r for r in results if not r.get("is_valid")]
    subsetted = [r for r in valid if r.get("is_subetted")]
    full = [r for r in valid if not r.get("is_subetted")]
    name_bad = [r for r in valid if r.get("name_table_ok") is False]
    italic_mismatch = [r for r in valid if r.get("italic_mismatch") is True]
    ext_sig_mismatch = [r for r in results if r.get("ext_signature_mismatch") is True]

    token_mode = any(r.get("target_matched") is not None for r in results)
    contamination = [r for r in results if r.get("target_matched") is False] if token_mode else []
    feature_counter: Dict[str, int] = {}
    for item in valid:
        tags = item.get("opentype_features") or []
        if not isinstance(tags, list):
            continue
        for tag in tags:
            if not isinstance(tag, str) or not tag.strip():
                continue
            feature_counter[tag] = feature_counter.get(tag, 0) + 1

    summary = {
        "total_files": len(results),
        "valid_fonts": len(valid),
        "invalid_fonts": len(invalid),
        "subsetted_fonts": len(subsetted),
        "full_fonts": len(full),
        "name_table_ok_fonts": len([r for r in valid if r.get("name_table_ok") is True]),
        "name_table_bad_fonts": len(name_bad),
        "italic_mismatches": len(italic_mismatch),
        "ext_signature_mismatches": len(ext_sig_mismatch),
        "os2_italic_mismatches": 0,
        "mono_fixed_pitch_mismatches": 0,
        "desktop_fonts": len([r for r in valid if r.get("ext") in ("ttf", "otf")]),
        "desktop_name_ok": len([r for r in valid if r.get("ext") in ("ttf", "otf") and r.get("name_table_ok") is True]),
        "target_matched_fonts": len([r for r in results if r.get("target_matched") is True]),
        "contamination_fonts": len(contamination),
        "average_glyphs": (sum([int(r.get("glyph_count", 0)) for r in valid]) / max(1, len(valid))),
        "average_feature_count": (sum([int(r.get("feature_count", 0)) for r in valid]) / max(1, len(valid))),
        "common_feature_tags": [
            {"tag": tag, "count": count}
            for tag, count in sorted(feature_counter.items(), key=lambda kv: (-kv[1], kv[0]))[:24]
        ],
    }

    if summary["valid_fonts"] == 0:
        status = "fail"
    elif summary["invalid_fonts"] > 0 or summary["name_table_bad_fonts"] > 0 or summary["italic_mismatches"] > 0 or summary["ext_signature_mismatches"] > 0 or (token_mode and summary["contamination_fonts"] > 0):
        status = "warn"
    else:
        status = "pass"
    summary["status"] = status

    return {
        "summary": summary,
        "subsetted_fonts": subsetted,
        "full_fonts": full,
        "name_table_bad": name_bad,
        "italic_mismatches": italic_mismatch,
        "ext_signature_mismatches": ext_sig_mismatch,
        "contamination": contamination,
        "recommendations": [],
    }


def scan_directory(directory: Path, recursive: bool, tokens: Optional[List[str]]) -> List[Dict]:
    if recursive:
        files = [p for p in directory.rglob("*") if p.is_file() and p.suffix.lower() in FONT_EXTS]
    else:
        files = [p for p in directory.iterdir() if p.is_file() and p.suffix.lower() in FONT_EXTS]
    results = []
    for file_path in files:
        results.append(analyze_font(file_path, tokens))
    return results


def main():
    parser = argparse.ArgumentParser(description="Validate downloaded fonts and emit JSON report")
    parser.add_argument("directory", help="Directory to scan")
    parser.add_argument("--output", default="validation-log.json", help="Output JSON file path")
    parser.add_argument("--tokens", default="", help="Comma-separated target tokens for contamination estimation")
    parser.add_argument("--no-recursive", action="store_true", help="Disable recursive scan")
    args = parser.parse_args()

    target_dir = Path(args.directory)
    if not target_dir.exists() or not target_dir.is_dir():
        raise SystemExit(f"Directory not found: {target_dir}")

    tokens = _parse_tokens_arg(args.tokens)
    results = scan_directory(target_dir, recursive=(not args.no_recursive), tokens=tokens)
    report = generate_report(results)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
