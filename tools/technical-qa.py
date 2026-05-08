#!/usr/bin/env python3
"""
Technical QA report for downloaded font packages.

Focus:
- format coverage (woff/woff2/otf/ttf)
- table/metadata sanity across files
- OpenType feature inventory
- optional FontBakery quick run (if available in PATH)
"""

import argparse
import json
import os
import re
import shutil
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

try:
    from fontTools.ttLib import TTFont
except Exception:
    print("ERROR: fontTools not installed. Run: pip install fonttools brotli", flush=True)
    raise SystemExit(1)


FONT_EXTS = {".woff2", ".woff", ".ttf", ".otf"}
DEFAULT_REQUIRED_FORMATS = ["woff", "woff2", "otf", "ttf"]


def _safe_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _read_name(font: TTFont, name_id: int) -> Optional[str]:
    if "name" not in font:
        return None
    for rec in font["name"].names:
        if rec.nameID != name_id:
            continue
        try:
            value = str(rec.toUnicode()).strip()
        except Exception:
            continue
        if value:
            return value
    return None


def _read_features(font: TTFont) -> List[str]:
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


def _analyze_font(filepath: Path) -> Dict:
    result = {
        "path": str(filepath),
        "filename": filepath.name,
        "ext": filepath.suffix.lower().replace(".", ""),
        "size_bytes": filepath.stat().st_size,
        "is_valid": False,
        "family_name": None,
        "subfamily_name": None,
        "full_name": None,
        "postscript_name": None,
        "units_per_em": None,
        "hhea": {},
        "os2": {},
        "glyph_count": 0,
        "cmap_entries": 0,
        "feature_tags": [],
        "feature_count": 0,
        "axes": [],
    }

    try:
        font = TTFont(str(filepath), 0, ignoreDecompileErrors=True)
        result["is_valid"] = True

        result["family_name"] = _read_name(font, 16) or _read_name(font, 1)
        result["subfamily_name"] = _read_name(font, 17) or _read_name(font, 2)
        result["full_name"] = _read_name(font, 4)
        result["postscript_name"] = _read_name(font, 6)

        if "head" in font:
            result["units_per_em"] = int(getattr(font["head"], "unitsPerEm", 0))

        if "hhea" in font:
            hhea = font["hhea"]
            result["hhea"] = {
                "ascender": int(getattr(hhea, "ascent", 0)),
                "descender": int(getattr(hhea, "descent", 0)),
                "lineGap": int(getattr(hhea, "lineGap", 0)),
            }

        if "OS/2" in font:
            os2 = font["OS/2"]
            result["os2"] = {
                "usWeightClass": int(getattr(os2, "usWeightClass", 0)),
                "sTypoAscender": int(getattr(os2, "sTypoAscender", 0)),
                "sTypoDescender": int(getattr(os2, "sTypoDescender", 0)),
                "sTypoLineGap": int(getattr(os2, "sTypoLineGap", 0)),
                "usWinAscent": int(getattr(os2, "usWinAscent", 0)),
                "usWinDescent": int(getattr(os2, "usWinDescent", 0)),
            }

        if "maxp" in font:
            result["glyph_count"] = int(getattr(font["maxp"], "numGlyphs", 0))

        if "cmap" in font:
            for table in getattr(font["cmap"], "tables", []):
                cmap = getattr(table, "cmap", None)
                if cmap:
                    result["cmap_entries"] = len(cmap)
                    break

        features = _read_features(font)
        result["feature_tags"] = features
        result["feature_count"] = len(features)

        if "fvar" in font:
            axes = []
            for axis in font["fvar"].axes:
                axes.append(
                    {
                        "tag": axis.axisTag,
                        "min": float(axis.minValue),
                        "default": float(axis.defaultValue),
                        "max": float(axis.maxValue),
                    }
                )
            result["axes"] = axes

        font.close()
    except Exception as error:
        result["error"] = str(error)

    return result


def _group_key(filename: str) -> str:
    stem = Path(filename).stem.lower()
    stem = re.sub(r"\s+", "-", stem)
    return stem


def _expected_group_formats(group_key: str, source_limited: set[str]) -> List[str]:
    key = (group_key or "").lower()
    if "variable" in key or key.endswith("-vf") or "-vf-" in key:
        base = ["woff", "woff2", "ttf"]
    else:
        base = ["woff", "woff2", "otf"]
    return [fmt for fmt in base if fmt not in source_limited]


def _run_fontbakery(files: List[Path], timeout_sec: int) -> Dict:
    exe = shutil.which("fontbakery")
    if not exe:
        return {
            "available": False,
            "status": "unavailable",
            "reason": "fontbakery not found in PATH",
            "checked_files": len(files),
        }

    if not files:
        return {
            "available": True,
            "status": "skipped",
            "reason": "no desktop fonts (.ttf/.otf) to check",
            "checked_files": 0,
        }

    cmd = [exe, "check-universal"] + [str(f) for f in files]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=max(30, int(timeout_sec)),
            check=False,
        )
        output = (proc.stdout or "") + "\n" + (proc.stderr or "")
        output = output.strip()

        pass_count = len(re.findall(r"\bPASS\b", output))
        warn_count = len(re.findall(r"\bWARN\b", output))
        fail_count = len(re.findall(r"\bFAIL\b", output))
        error_count = len(re.findall(r"\bERROR\b", output))

        status = "pass"
        if fail_count > 0 or error_count > 0:
            status = "warn"
        elif warn_count > 0:
            status = "warn"

        return {
            "available": True,
            "status": status,
            "exit_code": proc.returncode,
            "checked_files": len(files),
            "counts": {
                "PASS": pass_count,
                "WARN": warn_count,
                "FAIL": fail_count,
                "ERROR": error_count,
            },
            "snippet": output[:20000],
        }
    except subprocess.TimeoutExpired:
        return {
            "available": True,
            "status": "warn",
            "reason": f"fontbakery timeout after {timeout_sec}s",
            "checked_files": len(files),
        }
    except Exception as error:
        return {
            "available": True,
            "status": "warn",
            "reason": str(error),
            "checked_files": len(files),
        }


def main():
    parser = argparse.ArgumentParser(description="Run technical QA checks for font package")
    parser.add_argument("directory", help="Directory to scan")
    parser.add_argument("--output", default="technical-qa-log.json", help="Output JSON file path")
    parser.add_argument(
        "--required-formats",
        default=",".join(DEFAULT_REQUIRED_FORMATS),
        help="Comma-separated required formats",
    )
    parser.add_argument(
        "--source-limited-formats",
        default="",
        help="Comma-separated formats to exclude from strict coverage checks",
    )
    parser.add_argument("--skip-fontbakery", action="store_true", help="Skip FontBakery execution")
    parser.add_argument("--fontbakery-timeout", type=int, default=300, help="FontBakery timeout (seconds)")
    parser.add_argument("--strict-groups", action="store_true", help="Treat per-group incomplete formats as warning")
    args = parser.parse_args()

    root = Path(args.directory)
    if not root.exists() or not root.is_dir():
        raise SystemExit(f"Directory not found: {root}")

    required_formats = []
    for token in str(args.required_formats or "").split(","):
        normalized = token.strip().lower()
        if normalized in {"woff", "woff2", "otf", "ttf"} and normalized not in required_formats:
            required_formats.append(normalized)
    if not required_formats:
        required_formats = list(DEFAULT_REQUIRED_FORMATS)
    source_limited_formats = []
    for token in str(args.source_limited_formats or "").split(","):
        normalized = token.strip().lower()
        if normalized in {"woff", "woff2", "otf", "ttf"} and normalized not in source_limited_formats:
            source_limited_formats.append(normalized)
    source_limited_set = set(source_limited_formats)
    effective_required_formats = [fmt for fmt in required_formats if fmt not in source_limited_set]

    files = sorted([p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in FONT_EXTS])
    rows = [_analyze_font(file_path) for file_path in files]
    valid_rows = [row for row in rows if row.get("is_valid")]
    invalid_rows = [row for row in rows if not row.get("is_valid")]

    by_ext: Dict[str, int] = defaultdict(int)
    for row in rows:
        by_ext[row.get("ext", "")] += 1
    missing_global_formats = [fmt for fmt in effective_required_formats if by_ext.get(fmt, 0) <= 0]

    groups: Dict[str, Dict] = {}
    for row in rows:
        key = _group_key(row["filename"])
        group = groups.setdefault(
            key,
            {"key": key, "files": [], "formats": set(), "family_names": set(), "subfamily_names": set(), "issues": []},
        )
        group["files"].append(row["filename"])
        group["formats"].add(row["ext"])
        if row.get("family_name"):
            group["family_names"].add(row["family_name"])
        if row.get("subfamily_name"):
            group["subfamily_names"].add(row["subfamily_name"])

    group_reports: List[Dict] = []
    group_missing_counter = defaultdict(int)
    group_name_mismatch_count = 0
    for group in groups.values():
        formats = sorted(list(group["formats"]))
        expected_formats = _expected_group_formats(group["key"], source_limited_set)
        missing_formats = [fmt for fmt in expected_formats if fmt not in group["formats"]]
        for miss in missing_formats:
            group_missing_counter[miss] += 1

        issues = []
        if len(group["family_names"]) > 1:
            issues.append("family_name_mismatch")
        if len(group["subfamily_names"]) > 1:
            issues.append("subfamily_name_mismatch")
        if "family_name_mismatch" in issues or "subfamily_name_mismatch" in issues:
            group_name_mismatch_count += 1
        if missing_formats:
            issues.append("format_incomplete")

        group_reports.append(
            {
                "key": group["key"],
                "files": sorted(group["files"]),
                "formats": formats,
                "expected_formats": expected_formats,
                "missing_formats": missing_formats,
                "family_names": sorted(group["family_names"]),
                "subfamily_names": sorted(group["subfamily_names"]),
                "issues": issues,
            }
        )

    desktop_files = [f for f in files if f.suffix.lower() in {".ttf", ".otf"}]
    fontbakery = (
        {"available": False, "status": "skipped", "reason": "skip requested", "checked_files": len(desktop_files)}
        if args.skip_fontbakery
        else _run_fontbakery(desktop_files, args.fontbakery_timeout)
    )

    warning_reasons = []
    if invalid_rows:
        warning_reasons.append(f"invalid_fonts={len(invalid_rows)}")
    if missing_global_formats:
        warning_reasons.append(f"missing_global_formats={','.join(missing_global_formats)}")
    if args.strict_groups and any(report["missing_formats"] for report in group_reports):
        warning_reasons.append("incomplete_format_groups")
    if group_name_mismatch_count > 0:
        warning_reasons.append(f"group_name_mismatch={group_name_mismatch_count}")
    if fontbakery.get("status") == "warn":
        warning_reasons.append("fontbakery_warn_or_fail")

    status = "pass" if len(warning_reasons) == 0 else "warn"

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "schemaVersion": 1,
        "status": status,
        "summary": {
            "total_files": len(rows),
            "valid_files": len(valid_rows),
            "invalid_files": len(invalid_rows),
            "format_counts": dict(sorted(by_ext.items())),
            "required_formats": required_formats,
            "source_limited_formats": source_limited_formats,
            "effective_required_formats": effective_required_formats,
            "missing_global_formats": missing_global_formats,
            "groups_total": len(group_reports),
            "groups_incomplete": sum(1 for report in group_reports if len(report["missing_formats"]) > 0),
            "group_missing_format_counts": dict(sorted(group_missing_counter.items())),
            "group_name_mismatch_count": group_name_mismatch_count,
            "fontbakery_status": fontbakery.get("status"),
            "warning_reasons": warning_reasons,
        },
        "fontbakery": fontbakery,
        "groups": sorted(group_reports, key=lambda item: item["key"]),
        "invalid_files": invalid_rows,
        "rows": rows,
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
