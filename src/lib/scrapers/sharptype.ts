import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const SHARPTYPE_ORIGIN = "https://www.sharptype.co";
const SHARPTYPE_FAMILIES_ENDPOINT = `${SHARPTYPE_ORIGIN}/api/font-families`;
const SHARPTYPE_FETCH_TIMEOUT_MS = 30000;
const SHARPTYPE_FETCH_MAX_RETRIES = 3;
const SHARPTYPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const FEATURE_TAG_RE =
  /\b(ss\d{2}|cv\d{2}|liga|dlig|calt|salt|onum|lnum|pnum|tnum|frac|afrc|sups|subs|smcp|c2sc|case|ordn|kern|zero)\b/gi;
const LEGAL_PDF_RE = /(?:eula|license|licen[cs]e|terms|agreement)/i;

type SharpStyle = "Normal" | "Italic";

type SharpFamilyNode = {
  id: string;
  name: string;
  slug: string;
  dotColor?: string | null;
};

type SharpFamily = SharpFamilyNode & {
  defaultFontId?: string | null;
  legacy?: boolean;
  parent?: SharpFamilyNode | null;
  children?: SharpFamilyNode[];
};

type SharpPackageFont = {
  id: string;
  width?: string;
  weight?: string;
  style?: string;
  description?: string;
  size?: string;
  price?: number;
  variations?: unknown[];
};

type SharpFontRow = {
  id: string;
  description?: string;
  unitsPerEm?: number;
  capHeight?: number;
  xHeight?: number;
  ascent?: number;
  descent?: number;
  italicAngle?: number;
  price?: number;
  variations?: unknown[];
};

type SharpCharacterSet = {
  id: string;
  name?: string;
  codePoints?: string[];
  fontFeatureSettings?: unknown;
};

type SharpStyleRecord = {
  fontId: string;
  familyId: string;
  familySlug: string;
  familyName: string;
  styleLabel: string;
  styleSlug: string;
  fullName: string;
  style: SharpStyle;
  weight?: string | number;
  weightToken?: string;
  styleToken?: string;
  widthToken?: string;
  source: "packages" | "fonts";
  description?: string;
  metrics?: SharpFontRow;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const toSafeSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const dedupeStringList = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const cleaned = normalizeSpace(item);
    if (!cleaned) continue;
    const token = normalizeToken(cleaned);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(cleaned);
  }
  return out;
};

const titleCaseLoose = (value: string): string =>
  normalizeSpace(value)
    .split(" ")
    .map((part) => {
      if (/^\d+$/.test(part)) return part;
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");

const normalizeTargetUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  const host = parsed.hostname.toLowerCase();
  if (host === "sharptype.co") parsed.hostname = "www.sharptype.co";
  return parsed.href;
};

const extractSlugFromUrl = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0].toLowerCase() === "typefaces") {
      return parts[1].toLowerCase();
    }
    if (parts.length === 1) return parts[0].toLowerCase();
  } catch {
    // ignore malformed URL
  }
  return undefined;
};

const buildTypefaceUrl = (slug: string): string => `${SHARPTYPE_ORIGIN}/typefaces/${slug}`;

const fetchTextWithRetry = async (url: string, headers: Record<string, string>): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SHARPTYPE_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SHARPTYPE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < SHARPTYPE_FETCH_MAX_RETRIES) await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("SharpType fetch failed");
};

const fetchJsonWithRetry = async (url: string, headers: Record<string, string>): Promise<unknown> => {
  const text = await fetchTextWithRetry(url, headers);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON payload from ${url}: ${String(error)}`);
  }
};

const toFamilyArray = (payload: unknown): SharpFamily[] => {
  const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const out: SharpFamily[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    const name = asString(row.name);
    const slug = asString(row.slug);
    if (!id || !name || !slug) continue;

    const children = Array.isArray(row.children)
      ? row.children
          .filter(isRecord)
          .map((child) => ({
            id: asString(child.id) || "",
            name: asString(child.name) || "",
            slug: asString(child.slug) || ""
          }))
          .filter((child) => child.id && child.slug)
      : [];

    const parent = isRecord(row.parent)
      ? {
          id: asString(row.parent.id) || "",
          name: asString(row.parent.name) || "",
          slug: asString(row.parent.slug) || ""
        }
      : null;

    out.push({
      id,
      name,
      slug: slug.toLowerCase(),
      dotColor: asString(row.dotColor) || null,
      defaultFontId: asString(row.defaultFontId) || null,
      legacy: Boolean(row.legacy),
      parent: parent && parent.id ? parent : null,
      children
    });
  }
  return out;
};

const resolveRequestedFamilies = (catalog: SharpFamily[], slug: string): SharpFamily[] => {
  const byId = new Map(catalog.map((family) => [family.id, family]));
  const exact = catalog.find((family) => family.slug === slug);
  const fuzzy = catalog.find((family) => normalizeToken(family.slug) === normalizeToken(slug));
  const picked = exact || fuzzy;
  if (!picked) return [];

  if (picked.defaultFontId) return [picked];

  const out: SharpFamily[] = [];
  for (const child of picked.children || []) {
    const resolved = byId.get(child.id);
    if (resolved?.defaultFontId) {
      out.push(resolved);
      continue;
    }
    if (resolved) out.push(resolved);
  }

  return out.length > 0 ? out : [picked];
};

const extractPackageFonts = (payload: unknown): SharpPackageFont[] => {
  if (!isRecord(payload)) return [];
  const data = isRecord(payload.data) ? payload.data : undefined;
  const family = data && isRecord(data.family) ? data.family : undefined;
  const rows = family && Array.isArray(family.fonts) ? family.fonts : [];
  const out: SharpPackageFont[] = [];

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    if (!id) continue;
    out.push({
      id,
      width: asString(row.width),
      weight: asString(row.weight),
      style: asString(row.style),
      description: asString(row.description),
      size: asString(row.size),
      price: asNumber(row.price),
      variations: Array.isArray(row.variations) ? row.variations : []
    });
  }

  return out;
};

const extractFontRows = (payload: unknown): SharpFontRow[] => {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const out: SharpFontRow[] = [];
  for (const row of payload.data) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    if (!id) continue;
    out.push({
      id,
      description: asString(row.description),
      unitsPerEm: asNumber(row.unitsPerEm),
      capHeight: asNumber(row.capHeight),
      xHeight: asNumber(row.xHeight),
      ascent: asNumber(row.ascent),
      descent: asNumber(row.descent),
      italicAngle: asNumber(row.italicAngle),
      price: asNumber(row.price),
      variations: Array.isArray(row.variations) ? row.variations : []
    });
  }
  return out;
};

const toStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const token = asString(item);
    if (token) out.push(token);
  }
  return out;
};

const extractCharacterSets = (payload: unknown): SharpCharacterSet[] => {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  const out: SharpCharacterSet[] = [];
  for (const row of payload.data) {
    if (!isRecord(row)) continue;
    const id = asString(row.id);
    if (!id) continue;
    out.push({
      id,
      name: asString(row.name),
      codePoints: toStringList(row.codePoints),
      fontFeatureSettings: row.fontFeatureSettings
    });
  }
  return out;
};

const normalizeStyleLabel = (value: string): string => {
  const base = normalizeSpace(value)
    .replace(/semi[\s-]*bold/gi, "Semibold")
    .replace(/extra[\s-]*light/gi, "ExtraLight")
    .replace(/extra[\s-]*bold/gi, "ExtraBold")
    .replace(/ultra[\s-]*thin/gi, "UltraThin")
    .replace(/extra[\s-]*thin/gi, "ExtraThin")
    .replace(/\broman\b/gi, "Regular")
    .trim();

  if (!base) return "Regular";
  return titleCaseLoose(base);
};

const normalizeStyleToken = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  return normalizeStyleLabel(value);
};

const isNeutralStyleToken = (value: string | undefined): boolean => {
  if (!value) return true;
  const token = normalizeToken(value);
  return token === "regular" || token === "roman" || token === "normal";
};

const isNeutralWidthToken = (value: string | undefined): boolean => {
  if (!value) return true;
  const token = normalizeToken(value);
  return token === "normal" || token === "regular" || token === "standard";
};

const containsToken = (label: string, candidate: string): boolean => {
  return normalizeToken(label).includes(normalizeToken(candidate));
};

const inferWeightValue = (label: string): number | undefined => {
  const token = normalizeToken(label);
  if (!token) return undefined;

  const numeric = token.match(/(?:^|[^0-9])(1000|950|900|800|700|600|500|400|350|300|275|250|200|150|125|100)(?:[^0-9]|$)/);
  if (numeric?.[1]) return Number(numeric[1]);

  if (token.includes("hairline")) return 100;
  if (token.includes("ultrathin") || token.includes("extrathin") || token.includes("thin")) return 100;
  if (token.includes("extralight") || token.includes("ultralight")) return 200;
  if (token.includes("light")) return 300;
  if (token.includes("book")) return 350;
  if (token.includes("regular") || token.includes("roman")) return 400;
  if (token.includes("medium")) return 500;
  if (token.includes("semibold") || token.includes("demibold")) return 600;
  if (token.includes("bold")) return 700;
  if (token.includes("extrabold") || token.includes("ultrabold")) return 800;
  if (token.includes("black") || token.includes("heavy")) return 900;
  return undefined;
};

const inferStyle = (params: {
  styleLabel: string;
  styleToken?: string;
  metrics?: SharpFontRow;
}): SharpStyle => {
  const { styleLabel, styleToken, metrics } = params;
  if (/italic|oblique/i.test(styleLabel)) return "Italic";
  if (styleToken && /italic|oblique/i.test(styleToken)) return "Italic";
  if (typeof metrics?.italicAngle === "number" && Math.abs(metrics.italicAngle) > 0.01) return "Italic";
  return "Normal";
};

const stripFamilyPrefix = (styleLabel: string, familyName: string): string => {
  const cleanedStyle = normalizeSpace(styleLabel);
  const cleanedFamily = normalizeSpace(familyName);
  if (!cleanedStyle || !cleanedFamily) return cleanedStyle;
  const escaped = cleanedFamily.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}\\s+`, "i");
  const stripped = cleanedStyle.replace(pattern, "").trim();
  return stripped || cleanedStyle;
};

const buildStyleLabelFromPackageFont = (row: SharpPackageFont, familyName: string): string => {
  const widthToken = normalizeStyleToken(row.width);
  const weightToken = normalizeStyleToken(row.weight);
  const styleToken = normalizeStyleToken(row.style);
  const description = normalizeStyleToken(row.description);

  let label = "";
  if (weightToken || styleToken) {
    if (!styleToken || isNeutralStyleToken(styleToken)) {
      label = weightToken || "";
    } else if (!weightToken) {
      label = styleToken;
    } else if (isNeutralStyleToken(weightToken)) {
      label = /italic|oblique/i.test(styleToken) ? `${weightToken} ${styleToken}` : styleToken;
    } else {
      label = `${weightToken} ${styleToken}`;
    }
  }

  if (!label && description) label = description;
  if (!label) label = "Regular";

  if (widthToken && !isNeutralWidthToken(widthToken) && !containsToken(label, widthToken) && !containsToken(familyName, widthToken)) {
    label = `${widthToken} ${label}`;
  }

  return normalizeStyleLabel(label);
};

const buildStyleLabelFromFontRow = (row: SharpFontRow): string => {
  const raw = normalizeStyleToken(row.description || "Regular") || "Regular";
  return normalizeStyleLabel(raw);
};

const dedupeStyleSlugs = (records: SharpStyleRecord[]): SharpStyleRecord[] => {
  const grouped = new Map<string, SharpStyleRecord[]>();
  for (const record of records) {
    const key = `${record.familySlug}|${record.styleSlug}`;
    const current = grouped.get(key) || [];
    current.push(record);
    grouped.set(key, current);
  }

  for (const group of grouped.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => a.fontId.localeCompare(b.fontId));
    for (const row of group) {
      row.styleSlug = `${row.styleSlug}-${row.fontId.slice(0, 8)}`;
    }
  }

  return records;
};

const buildStyleRecords = (params: {
  family: SharpFamily;
  packageFonts: SharpPackageFont[];
  fontRows: SharpFontRow[];
}): SharpStyleRecord[] => {
  const { family, packageFonts, fontRows } = params;
  const familyName = family.name;
  const familySlug = family.slug;
  const byId = new Map(fontRows.map((row) => [row.id, row]));

  const out: SharpStyleRecord[] = [];
  const seenFontIds = new Set<string>();

  if (packageFonts.length > 0) {
    for (const row of packageFonts) {
      if (!row.id || seenFontIds.has(row.id)) continue;
      seenFontIds.add(row.id);

      const metrics = byId.get(row.id);
      let styleLabel = buildStyleLabelFromPackageFont(row, familyName);
      styleLabel = stripFamilyPrefix(styleLabel, familyName);
      styleLabel = normalizeStyleLabel(styleLabel);

      const style = inferStyle({
        styleLabel,
        styleToken: row.style,
        metrics
      });
      const inferredWeight = inferWeightValue(`${row.weight || ""} ${styleLabel}`.trim());
      const weight = inferredWeight ?? asString(row.weight) ?? undefined;
      const styleSlug = toSafeSlug(styleLabel) || row.id.slice(0, 8);
      const fullName = `${familyName} ${styleLabel}`.replace(/\s+/g, " ").trim();

      out.push({
        fontId: row.id,
        familyId: family.id,
        familySlug,
        familyName,
        styleLabel,
        styleSlug,
        fullName,
        style,
        weight,
        weightToken: row.weight,
        styleToken: row.style,
        widthToken: row.width,
        source: "packages",
        description: row.description,
        metrics
      });
    }
  } else {
    for (const row of fontRows) {
      if (!row.id || seenFontIds.has(row.id)) continue;
      seenFontIds.add(row.id);

      let styleLabel = buildStyleLabelFromFontRow(row);
      styleLabel = stripFamilyPrefix(styleLabel, familyName);
      styleLabel = normalizeStyleLabel(styleLabel);

      const style = inferStyle({
        styleLabel,
        styleToken: row.description,
        metrics: row
      });
      const inferredWeight = inferWeightValue(styleLabel);
      const weight = inferredWeight ?? undefined;
      const styleSlug = toSafeSlug(styleLabel) || row.id.slice(0, 8);
      const fullName = `${familyName} ${styleLabel}`.replace(/\s+/g, " ").trim();

      out.push({
        fontId: row.id,
        familyId: family.id,
        familySlug,
        familyName,
        styleLabel,
        styleSlug,
        fullName,
        style,
        weight,
        source: "fonts",
        description: row.description,
        metrics: row
      });
    }
  }

  out.sort((a, b) => `${a.fullName}|${a.fontId}`.localeCompare(`${b.fullName}|${b.fontId}`));
  return dedupeStyleSlugs(out);
};

const buildAssetUrl = (fontId: string, format: "woff2" | "woff", nowToken: string): string =>
  `${SHARPTYPE_ORIGIN}/assets/fonts/${fontId}.${format}?subset=full&now=${encodeURIComponent(nowToken)}`;

const extractFeatureTagsFromCharacterSets = (sets: SharpCharacterSet[]): string[] => {
  const tags = new Set<string>();
  for (const set of sets) {
    const values: unknown[] = [];
    if (Array.isArray(set.fontFeatureSettings)) values.push(...set.fontFeatureSettings);
    else if (set.fontFeatureSettings !== null && set.fontFeatureSettings !== undefined) values.push(set.fontFeatureSettings);

    for (const value of values) {
      if (typeof value === "string") {
        for (const match of value.matchAll(FEATURE_TAG_RE)) {
          tags.add(String(match[1] || "").toLowerCase());
        }
        continue;
      }
      if (!isRecord(value)) continue;
      const candidates = [asString(value.tag), asString(value.name), asString(value.value)];
      for (const candidate of candidates) {
        if (!candidate) continue;
        for (const match of candidate.matchAll(FEATURE_TAG_RE)) {
          tags.add(String(match[1] || "").toLowerCase());
        }
      }
    }
  }
  return Array.from(tags).sort();
};

const normalizeRequiredFeatureTags = (featureTags: string[], sets: SharpCharacterSet[]): string[] => {
  const normalized = new Set(featureTags.map((tag) => tag.toLowerCase()));
  const usesCompositeOldstyleProportional = sets.some((set) => {
    const settings = Array.isArray(set.fontFeatureSettings)
      ? set.fontFeatureSettings.filter((value): value is string => typeof value === "string")
      : typeof set.fontFeatureSettings === "string"
        ? [set.fontFeatureSettings]
        : [];
    return settings.some((value) => /onum/i.test(value) && /pnum/i.test(value));
  });

  if (usesCompositeOldstyleProportional && normalized.has("onum") && normalized.has("pnum")) {
    normalized.delete("pnum");
  }

  return Array.from(normalized).sort();
};

const extractFeatureTagsFromHtml = (html: string): string[] => {
  const tags = new Set<string>();
  for (const match of html.matchAll(FEATURE_TAG_RE)) {
    tags.add(String(match[1] || "").toLowerCase());
  }
  return Array.from(tags).sort();
};

const extractSpecimenPdfUrls = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  const addCandidate = (raw: string | undefined) => {
    const candidate = asString(raw);
    if (!candidate) return;
    try {
      const resolved = new URL(candidate, baseUrl).href;
      if (!/\.pdf(?:$|\?)/i.test(resolved)) return;
      if (LEGAL_PDF_RE.test(resolved)) return;
      out.add(resolved);
    } catch {
      // ignore malformed URL
    }
  };

  for (const match of html.matchAll(/href=["']([^"']+?\.pdf(?:\?[^"']*)?)["']/gi)) {
    addCandidate(match[1]);
  }
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?/gi)) {
    addCandidate(match[0]);
  }
  for (const match of html.matchAll(/\\"(https?:\/\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi)) {
    addCandidate(match[1]);
  }
  for (const match of html.matchAll(/\\"(\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi)) {
    addCandidate(match[1]);
  }

  return Array.from(out);
};

const buildTargetProfile = (params: {
  requestUrl: string;
  requestSlug: string;
  resolvedFamilies: SharpFamily[];
  styleRecords: SharpStyleRecord[];
  specimenPdfUrls: string[];
  featureTags: string[];
  uniqueCodePointCount: number;
  totalCharacterSets: number;
}): Record<string, unknown> => {
  const {
    requestUrl,
    requestSlug,
    resolvedFamilies,
    styleRecords,
    specimenPdfUrls,
    featureTags: requiredFeatureTags,
    uniqueCodePointCount,
    totalCharacterSets
  } = params;

  return {
    profileId: "sharptype-target-profile-v1",
    source: "sharptype-api+typeface-html",
    foundry: "Sharp Type",
    styleScope: "family-style",
    strictMissingStyles: true,
    targetUrl: requestUrl,
    requestSlug,
    family: resolvedFamilies.length === 1 ? resolvedFamilies[0]?.name : `${titleCaseLoose(requestSlug)} Collection`,
    familyDisplay: resolvedFamilies.length === 1 ? resolvedFamilies[0]?.name : `${titleCaseLoose(requestSlug)} Collection`,
    resolvedFamilySlugs: resolvedFamilies.map((family) => family.slug),
    expectedStyles: styleRecords.map((row) => row.fullName),
    expectedStyleCount: styleRecords.length,
    styleMap: styleRecords.map((row) => ({
      styleSlug: row.styleSlug,
      expectedStyle: row.fullName,
      styleName: row.styleLabel,
      family: row.familyName,
      familySlug: row.familySlug,
      source: row.source,
      weight: row.weight,
      style: row.style
    })),
    requiredFeatureTags,
    specimenPdfUrls,
    characterSetCount: totalCharacterSets,
    uniqueCodePointCount,
    outputNaming: {
      prefix: "sharp-type",
      pattern: "sharp-type-{typeface-slug}-{style-slug}.{ext}",
      styleTokenCase: "lowercase",
      separator: "-",
      stableSort: "lexical"
    },
    formatPolicy: "woff2+woff (desktop variants via converter)",
    outputFormats: ["woff2", "woff", "ttf", "otf"],
    collectedAt: new Date().toISOString()
  };
};

const buildFonts = (params: {
  styleRecords: SharpStyleRecord[];
  targetProfile: Record<string, unknown>;
  pageByFamilySlug: Map<string, string>;
}): FontMetadata[] => {
  const { styleRecords, targetProfile, pageByFamilySlug } = params;
  const nowToken = Math.floor(Date.now() / 1000).toString();
  const out: FontMetadata[] = [];
  const seen = new Set<string>();

  for (const row of styleRecords) {
    const referer = pageByFamilySlug.get(row.familySlug) || buildTypefaceUrl(row.familySlug);
    const foundryPrefix = "sharp-type";
    const safeFamilySlug = toSafeSlug(row.familySlug) || "unknown-family";
    const safeStyleSlug = toSafeSlug(row.styleSlug) || row.fontId.slice(0, 8);
    const baseName = `${foundryPrefix}-${safeFamilySlug}-${safeStyleSlug}`;

    for (const format of ["woff2", "woff"] as const) {
      const url = buildAssetUrl(row.fontId, format, nowToken);
      const dedupeKey = `${row.fontId}|${format}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      out.push({
        url,
        family: row.familyName,
        format,
        style: row.style,
        weight: row.weight ?? "Regular",
        downloadable: true,
        note: "Sharp Type direct webfont asset.",
        metadata: {
          foundry: "Sharp Type",
          family: row.familyName,
          familySlug: row.familySlug,
          styleName: row.styleLabel,
          fullName: row.fullName,
          styleSlug: row.styleSlug,
          fontId: row.fontId,
          source: row.source,
          pageUrl: referer,
          targetUrl: referer,
          format,
          forceMetadataRepair: true,
          skipConversion: format === "woff",
          conversionSeedPreferred: "woff2",
          fileNameHint: `${baseName}.${format}`,
          targetProfile,
          headers: {
            Origin: SHARPTYPE_ORIGIN,
            Referer: referer,
            Accept: "*/*"
          }
        }
      });
    }
  }

  return out;
};

const buildFallbackInjectScript = (): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const actions = Array.from(document.querySelectorAll("button, [role='button'], a, input, select"));
    for (const node of actions.slice(0, 240)) {
      try {
        node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      } catch {}
      await sleep(30);
    }
    await sleep(1200);
  })();
`;

export const SharpTypeScraper: Scraper = {
  id: "sharptype",
  name: "Sharp Type Precision Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(www\.)?sharptype\.co/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const normalizedInput = normalizeTargetUrl(url);
      const requestSlug = extractSlugFromUrl(normalizedInput);
      if (!requestSlug) {
        return {
          scraperName: this.name,
          foundryName: "Sharp Type",
          fonts: [],
          originalUrl: url,
          metadata: {
            foundry: "Sharp Type",
            reason: "slug-not-found"
          }
        };
      }

      const headersJson = {
        "User-Agent": SHARPTYPE_UA,
        Accept: "application/json,*/*",
        Referer: normalizedInput
      };

      const familyPayload = await fetchJsonWithRetry(SHARPTYPE_FAMILIES_ENDPOINT, headersJson);
      const catalog = toFamilyArray(familyPayload);
      const resolvedFamilies = resolveRequestedFamilies(catalog, requestSlug);
      if (resolvedFamilies.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "Sharp Type",
          fonts: [],
          originalUrl: url,
          metadata: {
            foundry: "Sharp Type",
            requestSlug,
            reason: "family-not-found"
          }
        };
      }

      const pageByFamilySlug = new Map<string, string>();
      const specimenPdfUrlsRaw: string[] = [];
      const requiredFeatureTagsRaw: string[] = [];
      const hintedFeatureTagsRaw: string[] = [];
      const styleRecords: SharpStyleRecord[] = [];
      const allCharacterSets: SharpCharacterSet[] = [];
      let totalCharacterSets = 0;
      const globalCodePoints = new Set<string>();

      for (const family of resolvedFamilies) {
        const familyPageUrl = buildTypefaceUrl(family.slug);
        pageByFamilySlug.set(family.slug, familyPageUrl);

        const [packagesPayload, fontsPayload, characterSetsPayload, html] = await Promise.all([
          fetchJsonWithRetry(`${SHARPTYPE_ORIGIN}/api/font-families/${family.id}/packages`, headersJson).catch(() => ({})),
          fetchJsonWithRetry(`${SHARPTYPE_ORIGIN}/api/font-families/${family.id}/fonts`, headersJson).catch(() => ({})),
          fetchJsonWithRetry(`${SHARPTYPE_ORIGIN}/api/font-families/${family.id}/character-sets`, headersJson).catch(() => ({})),
          fetchTextWithRetry(familyPageUrl, {
            "User-Agent": SHARPTYPE_UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: SHARPTYPE_ORIGIN
          }).catch(() => "")
        ]);

        const packageFonts = extractPackageFonts(packagesPayload);
        const fontRows = extractFontRows(fontsPayload);
        const characterSets = extractCharacterSets(characterSetsPayload);
        const rows = buildStyleRecords({ family, packageFonts, fontRows });
        styleRecords.push(...rows);
        allCharacterSets.push(...characterSets);

        totalCharacterSets += characterSets.length;
        for (const set of characterSets) {
          for (const cp of set.codePoints || []) {
            const token = cp.trim().toUpperCase();
            if (!token) continue;
            globalCodePoints.add(token);
          }
        }

        specimenPdfUrlsRaw.push(...extractSpecimenPdfUrls(html, familyPageUrl));
        requiredFeatureTagsRaw.push(...extractFeatureTagsFromCharacterSets(characterSets));
        hintedFeatureTagsRaw.push(...extractFeatureTagsFromHtml(html));
      }

      const sortedStyles = dedupeStyleSlugs(
        styleRecords.sort((a, b) => `${a.familySlug}|${a.styleSlug}|${a.fontId}`.localeCompare(`${b.familySlug}|${b.styleSlug}|${b.fontId}`))
      );
      const specimenPdfUrls = dedupeStringList(specimenPdfUrlsRaw);
      const requiredFeatureTagsRawUnique = dedupeStringList(requiredFeatureTagsRaw.map((tag) => tag.toLowerCase())).sort();
      const requiredFeatureTags = normalizeRequiredFeatureTags(requiredFeatureTagsRawUnique, allCharacterSets);
      const hintedFeatureTags = dedupeStringList(hintedFeatureTagsRaw.map((tag) => tag.toLowerCase())).sort();

      const targetUrl =
        requestSlug && resolvedFamilies.length === 1 ? buildTypefaceUrl(resolvedFamilies[0].slug) : buildTypefaceUrl(requestSlug);
      const targetProfile = buildTargetProfile({
        requestUrl: targetUrl,
        requestSlug,
        resolvedFamilies,
        styleRecords: sortedStyles,
        specimenPdfUrls,
        featureTags: requiredFeatureTags,
        uniqueCodePointCount: globalCodePoints.size,
        totalCharacterSets
      });

      const fonts = buildFonts({
        styleRecords: sortedStyles,
        targetProfile,
        pageByFamilySlug
      });

      if (fonts.length === 0) {
        const fallbackFamily =
          resolvedFamilies.length === 1 ? resolvedFamilies[0].name : `${titleCaseLoose(requestSlug)} Collection`;
        return {
          scraperName: this.name,
          foundryName: "Sharp Type",
          fonts: [
            {
              url: "browser-intercept",
              family: fallbackFamily,
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: {
                foundry: "Sharp Type",
                family: fallbackFamily,
                pageUrl: targetUrl,
                targetUrl,
                targetProfile
              }
            }
          ],
          originalUrl: url,
          targetUrl,
          injectScript: buildFallbackInjectScript(),
          expectedCount: sortedStyles.length > 0 ? sortedStyles.length : undefined,
          metadata: {
            foundry: "Sharp Type",
            requestSlug,
            resolvedFamilySlugs: resolvedFamilies.map((family) => family.slug),
            targetProfile,
            specimenPdfUrls,
            fallbackMode: "browser-intercept"
          }
        };
      }

      return {
        scraperName: this.name,
        foundryName: "Sharp Type",
        fonts,
        originalUrl: url,
        targetUrl,
        expectedCount: sortedStyles.length > 0 ? sortedStyles.length : fonts.length,
        metadata: {
          foundry: "Sharp Type",
          requestSlug,
          resolvedFamilySlugs: resolvedFamilies.map((family) => family.slug),
          resolvedFamilyCount: resolvedFamilies.length,
          targetProfile,
          specimenPdfUrls,
          requiredFeatureTags,
          requiredFeatureTagsRaw: requiredFeatureTagsRawUnique,
          hintedFeatureTags,
          uniqueCodePointCount: globalCodePoints.size,
          totalCharacterSets,
          styleCount: sortedStyles.length
        }
      };
    } catch (error) {
      console.error("[SharpTypeScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "Sharp Type",
        fonts: [],
        originalUrl: url
      };
    }
  }
};






