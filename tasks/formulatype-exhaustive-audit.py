import hashlib
import json
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import urlparse

import requests
from fontTools.ttLib import TTFont
from pypdf import PdfReader


DATE_TAG = "2026-02-28"
ROOT = Path(__file__).resolve().parents[1]
IN_REPORT = ROOT / "tasks" / "reports" / f"formulatype-research-{DATE_TAG}.json"
OUT_REPORT = ROOT / "tasks" / "reports" / f"formulatype-exhaustive-audit-{DATE_TAG}.json"
FONT_CACHE = ROOT / "tasks" / "cache" / f"formulatype-font-assets-{DATE_TAG}"
PDF_CACHE = ROOT / "tasks" / "cache" / f"formulatype-pdf-assets-{DATE_TAG}"

BASE_ADMIN = "https://admin.formulatype.com"
TIMEOUT = 60
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"

LIGATURE_TAGS = {
    "liga",
    "rlig",
    "dlig",
    "hlig",
    "clig",
    "calt",
    "ccmp",
    "rlig",
    "hist",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def unique_sorted(values: Iterable[str]) -> List[str]:
    return sorted({v for v in values if isinstance(v, str) and v})


def normalize_upload_url(raw: str) -> Optional[str]:
    if not raw or not isinstance(raw, str):
        return None
    if raw.startswith("https://") or raw.startswith("http://"):
        return raw
    if raw.startswith("/uploads/"):
        return f"{BASE_ADMIN}{raw}"
    if raw.startswith("uploads/"):
        return f"{BASE_ADMIN}/{raw}"
    return None


def ext_of_url(url: str) -> str:
    path = urlparse(url).path.lower()
    match = re.search(r"\.([a-z0-9]+)$", path)
    return match.group(1) if match else "unknown"


def safe_filename(url: str) -> str:
    path = urlparse(url).path
    name = Path(path).name
    if name:
        return name
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 256), b""):
            h.update(chunk)
    return h.hexdigest()


def font_name(font: TTFont, name_id: int) -> Optional[str]:
    if "name" not in font:
        return None
    for rec in font["name"].names:
        if rec.nameID == name_id:
            try:
                text = rec.toUnicode().strip()
            except Exception:
                continue
            if text:
                return text
    return None


def feature_tags(font: TTFont, table_tag: str) -> Set[str]:
    out: Set[str] = set()
    if table_tag not in font:
        return out
    table = font[table_tag].table
    feature_list = getattr(table, "FeatureList", None)
    if not feature_list or not getattr(feature_list, "FeatureRecord", None):
        return out
    for rec in feature_list.FeatureRecord:
        tag = getattr(rec, "FeatureTag", None)
        if tag:
            out.add(str(tag))
    return out


def script_tags(font: TTFont, table_tag: str) -> Set[str]:
    out: Set[str] = set()
    if table_tag not in font:
        return out
    table = font[table_tag].table
    script_list = getattr(table, "ScriptList", None)
    if not script_list or not getattr(script_list, "ScriptRecord", None):
        return out
    for rec in script_list.ScriptRecord:
        tag = getattr(rec, "ScriptTag", None)
        if tag:
            out.add(str(tag))
    return out


def parse_cmap(font: TTFont) -> Tuple[int, int]:
    codepoints: Set[int] = set()
    if "cmap" not in font:
        return 0, 0
    for table in font["cmap"].tables:
        cmap = getattr(table, "cmap", None)
        if not cmap:
            continue
        codepoints.update(int(cp) for cp in cmap.keys())
    if not codepoints:
        return 0, 0
    return len(codepoints), max(codepoints)


def style_slug_from_url(url: str) -> str:
    name = Path(urlparse(url).path).stem
    name = re.sub(r"_App_app_[0-9a-f]{8,}$", "", name, flags=re.I)
    name = re.sub(r"_[0-9a-f]{8,}$", "", name, flags=re.I)
    return name


def guess_family_style(style_slug: str) -> Tuple[str, str]:
    base = style_slug
    if base.startswith("FT_"):
        base = base[3:]
    base = base.replace("_Unlicensed_Trial_", "_")
    base = base.strip("_")
    tokens = [t for t in base.split("_") if t]

    if not tokens:
        return "UNKNOWN", "UNKNOWN"

    family_tokens: List[str]
    style_tokens: List[str]
    if tokens[:2] == ["Kunst", "Grotesk"]:
        family_tokens = ["FT", "Kunst", "Grotesk"]
        style_tokens = tokens[2:]
    elif tokens[:2] == ["Regola", "Neue"]:
        family_tokens = ["FT", "Regola", "Neue"]
        style_tokens = tokens[2:]
    elif tokens[0] in {"Aktual", "Athletic", "Habit", "Speaker", "Supplement"}:
        family_tokens = ["FT", tokens[0]]
        style_tokens = tokens[1:]
    else:
        family_tokens = ["FT", tokens[0]]
        style_tokens = tokens[1:]

    family = " ".join(family_tokens).strip()
    style = " ".join(style_tokens).strip() if style_tokens else "Regular"
    return family, style


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def download_file(session: requests.Session, url: str, dest: Path) -> Dict[str, object]:
    ensure_parent(dest)
    if dest.exists() and dest.stat().st_size > 0:
        return {
            "ok": True,
            "url": url,
            "path": str(dest),
            "fromCache": True,
            "status": 200,
            "size": dest.stat().st_size,
        }
    try:
        with session.get(url, timeout=TIMEOUT, stream=True) as resp:
            status = resp.status_code
            if status != 200:
                return {
                    "ok": False,
                    "url": url,
                    "path": str(dest),
                    "status": status,
                    "error": f"http_{status}",
                }
            with dest.open("wb") as f:
                for chunk in resp.iter_content(chunk_size=1024 * 64):
                    if chunk:
                        f.write(chunk)
        return {
            "ok": True,
            "url": url,
            "path": str(dest),
            "fromCache": False,
            "status": 200,
            "size": dest.stat().st_size,
        }
    except Exception as e:
        return {
            "ok": False,
            "url": url,
            "path": str(dest),
            "status": None,
            "error": str(e),
        }


@dataclass
class FontMeta:
    url: str
    local_path: str
    ext: str
    is_trial: bool
    is_app_variant: bool
    style_slug: str
    canonical_family: str
    canonical_style: str
    size: int
    sha256: str
    family_name: Optional[str]
    subfamily_name: Optional[str]
    full_name: Optional[str]
    postscript_name: Optional[str]
    glyph_count: int
    unicode_count: int
    max_codepoint: int
    table_tags: List[str]
    gsub_features: List[str]
    gpos_features: List[str]
    gsub_scripts: List[str]
    gpos_scripts: List[str]
    ligature_features: List[str]
    has_kerning: bool
    parse_error: Optional[str]

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "localPath": self.local_path,
            "ext": self.ext,
            "isTrial": self.is_trial,
            "isAppVariant": self.is_app_variant,
            "styleSlug": self.style_slug,
            "canonicalFamily": self.canonical_family,
            "canonicalStyle": self.canonical_style,
            "size": self.size,
            "sha256": self.sha256,
            "familyName": self.family_name,
            "subfamilyName": self.subfamily_name,
            "fullName": self.full_name,
            "postscriptName": self.postscript_name,
            "glyphCount": self.glyph_count,
            "unicodeCount": self.unicode_count,
            "maxCodepoint": self.max_codepoint,
            "tableTags": self.table_tags,
            "gsubFeatures": self.gsub_features,
            "gposFeatures": self.gpos_features,
            "gsubScripts": self.gsub_scripts,
            "gposScripts": self.gpos_scripts,
            "ligatureFeatures": self.ligature_features,
            "hasKerning": self.has_kerning,
            "parseError": self.parse_error,
        }


def analyze_font(path: Path, url: str) -> FontMeta:
    ext = path.suffix.lower().lstrip(".")
    is_trial = "unlicensed_trial" in path.name.lower()
    is_app_variant = "_app_app_" in path.name.lower()
    style_slug = style_slug_from_url(url)
    canonical_family, canonical_style = guess_family_style(style_slug)
    size = path.stat().st_size if path.exists() else 0
    digest = sha256_file(path) if path.exists() else ""

    try:
        font = TTFont(path, lazy=False)
        family = font_name(font, 1)
        subfamily = font_name(font, 2)
        full = font_name(font, 4)
        psname = font_name(font, 6)
        glyph_count = len(font.getGlyphOrder())
        unicode_count, max_codepoint = parse_cmap(font)
        tables = sorted(list(font.keys()))
        gsub = sorted(feature_tags(font, "GSUB"))
        gpos = sorted(feature_tags(font, "GPOS"))
        gsub_scripts = sorted(script_tags(font, "GSUB"))
        gpos_scripts = sorted(script_tags(font, "GPOS"))
        lig = sorted([tag for tag in set(gsub + gpos) if tag in LIGATURE_TAGS])
        has_kerning = "kern" in tables or "kern" in gpos or "dist" in gpos
        font.close()
        return FontMeta(
            url=url,
            local_path=str(path),
            ext=ext,
            is_trial=is_trial,
            is_app_variant=is_app_variant,
            style_slug=style_slug,
            canonical_family=canonical_family,
            canonical_style=canonical_style,
            size=size,
            sha256=digest,
            family_name=family,
            subfamily_name=subfamily,
            full_name=full,
            postscript_name=psname,
            glyph_count=glyph_count,
            unicode_count=unicode_count,
            max_codepoint=max_codepoint,
            table_tags=tables,
            gsub_features=gsub,
            gpos_features=gpos,
            gsub_scripts=gsub_scripts,
            gpos_scripts=gpos_scripts,
            ligature_features=lig,
            has_kerning=has_kerning,
            parse_error=None,
        )
    except Exception as e:
        return FontMeta(
            url=url,
            local_path=str(path),
            ext=ext,
            is_trial=is_trial,
            is_app_variant=is_app_variant,
            style_slug=style_slug,
            canonical_family=canonical_family,
            canonical_style=canonical_style,
            size=size,
            sha256=digest,
            family_name=None,
            subfamily_name=None,
            full_name=None,
            postscript_name=None,
            glyph_count=0,
            unicode_count=0,
            max_codepoint=0,
            table_tags=[],
            gsub_features=[],
            gpos_features=[],
            gsub_scripts=[],
            gpos_scripts=[],
            ligature_features=[],
            has_kerning=False,
            parse_error=str(e),
        )


def extract_assets(report: dict) -> Tuple[List[str], List[str], List[str]]:
    uploads: List[str] = []
    uploads.extend(report.get("staticSeed", {}).get("uploadAssetSample", []) or [])
    for row in report.get("crawl", {}).get("pageResults", []) or []:
        uploads.extend(row.get("uploadAssets", []) or [])
        uploads.extend(row.get("pdfLinks", []) or [])
    all_urls = unique_sorted(filter(None, (normalize_upload_url(u) for u in uploads)))
    font_urls = [u for u in all_urls if re.search(r"\.(woff2?|otf)$", u, re.I)]
    pdf_urls = [u for u in all_urls if re.search(r"\.pdf(?:$|\?)", u, re.I)]
    return all_urls, font_urls, pdf_urls


def audit_pdfs(session: requests.Session, pdf_urls: List[str]) -> Dict[str, object]:
    PDF_CACHE.mkdir(parents=True, exist_ok=True)
    results = []
    ok = 0
    failed = 0

    for url in pdf_urls:
        dest = PDF_CACHE / safe_filename(url)
        dl = download_file(session, url, dest)
        if not dl["ok"]:
            failed += 1
            results.append(
                {
                    "url": url,
                    "ok": False,
                    "status": dl.get("status"),
                    "error": dl.get("error"),
                }
            )
            continue
        try:
            reader = PdfReader(str(dest))
            info = reader.metadata or {}
            results.append(
                {
                    "url": url,
                    "ok": True,
                    "path": str(dest),
                    "size": int(dest.stat().st_size),
                    "pageCount": len(reader.pages),
                    "title": str(getattr(info, "title", "") or ""),
                    "author": str(getattr(info, "author", "") or ""),
                    "producer": str(getattr(info, "producer", "") or ""),
                    "subject": str(getattr(info, "subject", "") or ""),
                }
            )
            ok += 1
        except Exception as e:
            failed += 1
            results.append(
                {
                    "url": url,
                    "ok": False,
                    "path": str(dest),
                    "size": int(dest.stat().st_size) if dest.exists() else 0,
                    "error": f"pdf_parse: {e}",
                }
            )
    return {
        "requested": len(pdf_urls),
        "ok": ok,
        "failed": failed,
        "items": results,
    }


def make_family_summary(font_metas: List[FontMeta]) -> List[dict]:
    fam_groups: Dict[str, List[FontMeta]] = defaultdict(list)
    for meta in font_metas:
        key = meta.canonical_family or meta.family_name or "UNKNOWN"
        fam_groups[key].append(meta)

    out = []
    for family, items in sorted(fam_groups.items(), key=lambda x: x[0].lower()):
        glyphs = [i.glyph_count for i in items if i.glyph_count > 0]
        unicode_counts = [i.unicode_count for i in items if i.unicode_count > 0]
        gsub_union = sorted({tag for i in items for tag in i.gsub_features})
        gpos_union = sorted({tag for i in items for tag in i.gpos_features})
        lig_union = sorted({tag for i in items for tag in i.ligature_features})
        scripts_union = sorted({tag for i in items for tag in i.gsub_scripts + i.gpos_scripts})
        styles = sorted({(i.canonical_style or i.subfamily_name or "UNKNOWN") for i in items})
        formats = sorted({i.ext for i in items})
        trial_count = sum(1 for i in items if i.is_trial)
        full_count = sum(1 for i in items if not i.is_trial)
        out.append(
            {
                "familyName": family,
                "fontCount": len(items),
                "styleCount": len(styles),
                "styles": styles,
                "formats": formats,
                "trialCount": trial_count,
                "fullCount": full_count,
                "glyphCountMin": min(glyphs) if glyphs else 0,
                "glyphCountMax": max(glyphs) if glyphs else 0,
                "unicodeCountMin": min(unicode_counts) if unicode_counts else 0,
                "unicodeCountMax": max(unicode_counts) if unicode_counts else 0,
                "gsubFeaturesUnion": gsub_union,
                "gposFeaturesUnion": gpos_union,
                "ligatureFeaturesUnion": lig_union,
                "scriptTagsUnion": scripts_union,
            }
        )
    return out


def compare_trial_vs_full(font_metas: List[FontMeta]) -> List[dict]:
    key_to_rows: Dict[Tuple[str, str], Dict[str, List[FontMeta]]] = defaultdict(lambda: {"trial": [], "full": []})
    for meta in font_metas:
        fam = meta.canonical_family or meta.family_name or "UNKNOWN"
        style = meta.canonical_style or meta.subfamily_name or "UNKNOWN"
        bucket = "trial" if meta.is_trial else "full"
        key_to_rows[(fam, style)][bucket].append(meta)

    comparisons = []
    for (family, style), parts in sorted(key_to_rows.items(), key=lambda x: (x[0][0].lower(), x[0][1].lower())):
        if not parts["trial"] or not parts["full"]:
            continue
        trial_best = max(parts["trial"], key=lambda x: (x.glyph_count, x.unicode_count))
        full_best = max(parts["full"], key=lambda x: (x.glyph_count, x.unicode_count))
        trial_feat = set(trial_best.gsub_features + trial_best.gpos_features)
        full_feat = set(full_best.gsub_features + full_best.gpos_features)
        comparisons.append(
            {
                "familyName": family,
                "styleName": style,
                "trialGlyphCount": trial_best.glyph_count,
                "fullGlyphCount": full_best.glyph_count,
                "glyphDelta": full_best.glyph_count - trial_best.glyph_count,
                "trialUnicodeCount": trial_best.unicode_count,
                "fullUnicodeCount": full_best.unicode_count,
                "unicodeDelta": full_best.unicode_count - trial_best.unicode_count,
                "trialFeatureCount": len(trial_feat),
                "fullFeatureCount": len(full_feat),
                "missingFeaturesInTrial": sorted(full_feat - trial_feat),
                "missingFeaturesInFull": sorted(trial_feat - full_feat),
            }
        )
    return comparisons


def main() -> None:
    started_at = time.time()
    report = load_json(IN_REPORT)
    all_urls, font_urls, pdf_urls = extract_assets(report)

    session = requests.Session()
    session.headers.update({"User-Agent": UA})

    FONT_CACHE.mkdir(parents=True, exist_ok=True)
    downloads = []
    font_metas: List[FontMeta] = []
    download_failures = []

    for idx, url in enumerate(font_urls, start=1):
        ext = ext_of_url(url)
        filename = safe_filename(url)
        local = FONT_CACHE / filename
        dl = download_file(session, url, local)
        dl["index"] = idx
        dl["ext"] = ext
        downloads.append(dl)
        if not dl["ok"]:
            download_failures.append(
                {
                    "url": url,
                    "status": dl.get("status"),
                    "error": dl.get("error"),
                }
            )
            continue
        meta = analyze_font(local, url)
        font_metas.append(meta)

    pdf_audit = audit_pdfs(session, pdf_urls)

    parse_failures = [m.to_dict() for m in font_metas if m.parse_error]
    family_summary = make_family_summary(font_metas)
    trial_vs_full = compare_trial_vs_full(font_metas)

    ext_counts: Dict[str, int] = defaultdict(int)
    for url in all_urls:
        ext_counts[ext_of_url(url)] += 1

    network_patterns = report.get("networkSummary", {}).get("networkPatternSample", []) or []
    purchase_routes = sorted(
        {
            p
            for p in network_patterns
            if isinstance(p, str) and ("/purchase" in p or p.startswith("POST formulatype.com/ft-"))
        }
    )

    output = {
        "reportId": f"formulatype-exhaustive-audit-{DATE_TAG}",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "inputReport": str(IN_REPORT),
        "sourceCrawlSummary": {
            "okCount": report.get("crawl", {}).get("okCount"),
            "failCount": report.get("crawl", {}).get("failCount"),
            "requestedPaths": len(report.get("crawl", {}).get("requestedPaths", []) or []),
            "hiddenLabRoutes": report.get("crawl", {}).get("hiddenLabRoutes", []) or [],
        },
        "assetSummary": {
            "uniqueUploadUrls": len(all_urls),
            "fontUrls": len(font_urls),
            "pdfUrls": len(pdf_urls),
            "extCounts": dict(sorted(ext_counts.items(), key=lambda x: x[0])),
        },
        "networkPurchaseIndicators": purchase_routes,
        "fontDownloadSummary": {
            "requested": len(font_urls),
            "ok": len(font_metas),
            "failed": len(download_failures),
            "failures": download_failures,
        },
        "fontParseSummary": {
            "parsed": len(font_metas) - len(parse_failures),
            "parseErrors": len(parse_failures),
            "parseFailures": parse_failures,
        },
        "familySummary": family_summary,
        "trialVsFullComparison": trial_vs_full,
        "pdfAudit": pdf_audit,
        "fontMetadata": [m.to_dict() for m in font_metas],
        "durationSeconds": round(time.time() - started_at, 2),
    }

    ensure_parent(OUT_REPORT)
    OUT_REPORT.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "outPath": str(OUT_REPORT),
                "uniqueUploadUrls": output["assetSummary"]["uniqueUploadUrls"],
                "fontRequested": output["fontDownloadSummary"]["requested"],
                "fontOk": output["fontDownloadSummary"]["ok"],
                "fontFailed": output["fontDownloadSummary"]["failed"],
                "pdfRequested": output["pdfAudit"]["requested"],
                "pdfOk": output["pdfAudit"]["ok"],
                "pdfFailed": output["pdfAudit"]["failed"],
                "durationSeconds": output["durationSeconds"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
