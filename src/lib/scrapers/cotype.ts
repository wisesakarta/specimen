import type { FontMetadata, ScrapeResult, Scraper } from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const toCleanPath = (pathname: string): string => {
  const cleaned = pathname.trim().replace(/\/{2,}/g, "/");
  if (!cleaned || cleaned === "/") return "/";
  return cleaned.endsWith("/") ? cleaned.slice(0, -1) : cleaned;
};

const extractTitle = (html: string): string => {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return (match?.[1] || "").trim();
};

const extractFamilyFromTitle = (title: string): string => {
  const parts = title.split("|").map((p) => p.trim()).filter(Boolean);
  return parts[0] || "CoType";
};

const normalizeTargetUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    parsed.protocol = "https:";
    parsed.hostname = "cotypefoundry.com";
    return parsed.href;
  } catch {
    return rawUrl;
  }
};

const extractCotypeSlug = (targetUrl: string): string | undefined => {
  try {
    const parsed = new URL(targetUrl);
    const segments = toCleanPath(parsed.pathname)
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.toLowerCase());

    if (segments.length === 0) return undefined;

    const head = segments[0];
    if ((head === "font-family" || head === "our-fonts") && segments.length === 1) {
      return undefined;
    }

    if ((head === "font-family" || head === "our-fonts") && segments[1]) {
      return segments[1];
    }

    // Fallback: accept the last segment as a slug as long as it's not a reserved root.
    const tail = segments[segments.length - 1];
    if (tail === "font-family" || tail === "our-fonts") return undefined;
    return tail || undefined;
  } catch {
    return undefined;
  }
};

const parseNextData = (html: string): unknown => {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i
  );
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
};

const extractAllFonts = (nextData: unknown): Record<string, unknown>[] => {
  if (!isRecord(nextData)) return [];
  const props = nextData.props;
  if (!isRecord(props)) return [];
  const siteSettings = props.siteSettings;
  if (!isRecord(siteSettings)) return [];
  const allFonts = siteSettings.allFonts;
  if (!Array.isArray(allFonts)) return [];
  return allFonts.filter(isRecord);
};

const getFontSlug = (row: Record<string, unknown>): string | undefined => asString(row.slug)?.toLowerCase();
const getFontTitle = (row: Record<string, unknown>): string | undefined => asString(row.title);

const getFontFamilySlug = (row: Record<string, unknown>): string | undefined => {
  const family = row.fontFamily;
  if (!isRecord(family)) return undefined;
  return asString(family.slug)?.toLowerCase();
};

const getFontFamilyTitle = (row: Record<string, unknown>): string | undefined => {
  const family = row.fontFamily;
  if (!isRecord(family)) return undefined;
  return asString(family.title);
};

const normalizeToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const toTitleWords = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

const toPascalToken = (value: string): string =>
  value
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase())
    .join("");

const toTitleFromSlug = (slug: string): string =>
  slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripLeadingFamilyLabel = (styleLabel: string, familyLabel: string): string => {
  const style = styleLabel.trim();
  const family = familyLabel.trim();
  if (!style || !family) return style;
  const reg = new RegExp(`^${escapeRegExp(family)}\\s+`, "i");
  const stripped = style.replace(reg, "").trim();
  return stripped || style;
};

const resolveRowFamilyDisplay = (
  row: Record<string, unknown>,
  fallbackFamily: string
): string => {
  const rowSlug = getFontSlug(row);
  const familySlug = getFontFamilySlug(row);
  const rowTitle = getFontTitle(row);
  const familyTitle = getFontFamilyTitle(row);
  const fallbackToken = normalizeToken(fallbackFamily);

  const slugCandidates = [rowSlug, familySlug]
    .filter((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate))
    .map((candidate) => toTitleFromSlug(candidate));
  for (const candidate of slugCandidates) {
    if (!candidate) continue;
    if (normalizeToken(candidate) !== fallbackToken) return candidate;
  }

  const titleCandidates = [rowTitle, familyTitle]
    .filter((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate));
  for (const candidate of titleCandidates) {
    if (!candidate) continue;
    if (normalizeToken(candidate) !== fallbackToken) return candidate;
  }

  return fallbackFamily;
};

const dedupeByToken = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const token = normalizeToken(cleaned);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(cleaned);
  }
  return out;
};

type CotypeStyleEntry = {
  familyDisplay: string;
  styleDisplay: string;
  expectedStyle: string;
  postscriptName: string;
  weight?: number;
  italic?: boolean;
  styleSlug?: string;
  fontSlug?: string;
  excludeFromRequired?: boolean;
};

const extractStyleEntriesFromRows = (
  rows: Record<string, unknown>[],
  fallbackFamily: string
): CotypeStyleEntry[] => {
  const out: CotypeStyleEntry[] = [];

  for (const row of rows) {
    const familyDisplay = resolveRowFamilyDisplay(row, fallbackFamily);
    const postscriptPrefix = toPascalToken(familyDisplay || "CoType");
    const fontSlug = getFontSlug(row);
    const hasVariableUpright = Boolean(extractVariableFontUrlFromRow(row));
    const hasVariableItalic = Boolean(extractVariableFontItalicUrlFromRow(row));
    const variableOnlyUpright = hasVariableUpright && !hasVariableItalic;
    const fontStyles = Array.isArray(row.fontStyles) ? row.fontStyles.filter(isRecord) : [];

    for (const style of fontStyles) {
      const rawStyleTitle = asString(style.title) || asString(style.name) || toTitleWords(asString(style.slug) || "");
      const styleDisplay = stripLeadingFamilyLabel(rawStyleTitle || "Regular", familyDisplay);
      const styleSuffix = toPascalToken(styleDisplay) || "Regular";
      const expectedStyle = `${familyDisplay} ${styleDisplay}`.trim();

      const weightRaw = Number(style.weight);
      const weight = Number.isFinite(weightRaw) ? weightRaw : undefined;
      const italic = typeof style.italic === "boolean" ? style.italic : /italic/i.test(styleDisplay);

      out.push({
        familyDisplay,
        styleDisplay,
        expectedStyle,
        postscriptName: `${postscriptPrefix}-${styleSuffix}`,
        weight,
        italic,
        styleSlug: asString(style.slug),
        fontSlug,
        excludeFromRequired: variableOnlyUpright && italic
      });
    }
  }

  return out;
};

type PickedGroup = {
  groupSlug?: string;
  groupTitle?: string;
  fonts: Record<string, unknown>[];
};

const pickFontGroup = (allFonts: Record<string, unknown>[], slug: string | undefined, fallbackTitle: string): PickedGroup => {
  if (allFonts.length === 0) return { fonts: [], groupTitle: fallbackTitle };

  if (!slug) {
    // No slug provided (e.g., homepage). Default to catalog scope.
    return { fonts: allFonts, groupTitle: "CoType Catalog" };
  }

  const normalizedSlug = slug.toLowerCase();
  const byFontSlug = allFonts.find((row) => getFontSlug(row) === normalizedSlug);
  const byFamilySlug = allFonts.filter((row) => getFontFamilySlug(row) === normalizedSlug);

  const candidates: Array<{ fonts: Record<string, unknown>[]; groupSlug?: string; groupTitle?: string; score: number }> = [];

  if (byFontSlug) {
    const familySlug = getFontFamilySlug(byFontSlug) || getFontSlug(byFontSlug) || normalizedSlug;
    const familyTitle = getFontFamilyTitle(byFontSlug) || getFontTitle(byFontSlug) || fallbackTitle;

    const groupFonts = allFonts.filter((row) => {
      const candidate = getFontFamilySlug(row) || getFontSlug(row);
      return candidate === familySlug;
    });

    candidates.push({
      fonts: groupFonts.length > 0 ? groupFonts : [byFontSlug],
      groupSlug: familySlug,
      groupTitle: familyTitle,
      // Prefer the largest group, then prefer direct font match.
      score: (groupFonts.length > 0 ? groupFonts.length : 1) * 10 + 2
    });
  }

  if (byFamilySlug.length > 0) {
    const familyTitle = getFontFamilyTitle(byFamilySlug[0]) || fallbackTitle;
    candidates.push({
      fonts: byFamilySlug,
      groupSlug: normalizedSlug,
      groupTitle: familyTitle,
      score: byFamilySlug.length * 10 + 1
    });
  }

  if (candidates.length === 0) {
    return { fonts: [], groupTitle: fallbackTitle, groupSlug: normalizedSlug };
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
};

const extractAssetUrl = (value: unknown): string | undefined => {
  const direct = asString(value);
  if (direct) {
    if (/^https?:\/\//i.test(direct)) return direct;
    if (/^\/\//.test(direct)) return `https:${direct}`;
  }

  if (!isRecord(value)) return undefined;
  const embedded = asString(value.url);
  if (embedded) {
    if (/^https?:\/\//i.test(embedded)) return embedded;
    if (/^\/\//.test(embedded)) return `https:${embedded}`;
  }
  return undefined;
};

const extractVariableFontUrlFromRow = (row: Record<string, unknown>): string | undefined =>
  extractAssetUrl(row.variableFontFile);

const extractVariableFontItalicUrlFromRow = (row: Record<string, unknown>): string | undefined =>
  extractAssetUrl(row.variableFontFileItalic);

const extractStyleFontUrl = (style: Record<string, unknown>): string | undefined =>
  extractAssetUrl(style.fontFile) ||
  extractAssetUrl(style.file) ||
  extractAssetUrl(style.downloadFile);

const inferFormatFromUrl = (assetUrl: string): FontMetadata["format"] => {
  let pathname = assetUrl.toLowerCase();
  try {
    pathname = new URL(assetUrl).pathname.toLowerCase();
  } catch {
    // Ignore and fallback to raw string check.
  }

  if (pathname.endsWith(".woff2")) return "woff2";
  if (pathname.endsWith(".woff")) return "woff";
  if (pathname.endsWith(".otf")) return "otf";
  if (pathname.endsWith(".ttf")) return "ttf";
  if (pathname.endsWith(".eot")) return "eot";
  if (pathname.endsWith(".zip")) return "zip";

  const fallback = pathname.match(/\.(woff2|woff|otf|ttf|eot|zip)(?:$|[?#])/i);
  if (fallback) return fallback[1].toLowerCase() as FontMetadata["format"];
  return "woff2";
};

const pushAsset = (params: {
  out: FontMetadata[];
  seen: Set<string>;
  url: string | undefined;
  family: string;
  weight?: FontMetadata["weight"];
  style?: FontMetadata["style"];
  note?: string;
  metadata?: any;
}): void => {
  const { out, seen, url, family, weight, style, note, metadata } = params;
  if (!url) return;
  const canonical = url.split("#")[0];
  if (seen.has(canonical)) return;
  seen.add(canonical);
  out.push({
    url,
    family,
    weight,
    style,
    format: inferFormatFromUrl(url),
    downloadable: true,
    note,
    metadata
  });
};

const buildCotypeDirectFonts = (params: {
  rows: Record<string, unknown>[];
  groupTitle: string;
  targetUrl: string;
  targetProfile: Record<string, unknown>;
}): FontMetadata[] => {
  const { rows, groupTitle, targetUrl, targetProfile } = params;
  const out: FontMetadata[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const familyDisplay = resolveRowFamilyDisplay(row, groupTitle);
    const variableUrl = extractVariableFontUrlFromRow(row);
    const variableItalicUrl = extractVariableFontItalicUrlFromRow(row);
    const fontStyles = Array.isArray(row.fontStyles) ? row.fontStyles.filter(isRecord) : [];
    const baseMetadata = {
      pageUrl: targetUrl,
      targetUrl,
      foundry: "CoType",
      family: familyDisplay,
      sourceType: "variable",
      forceMetadataRepair: true,
      targetProfile
    };

    pushAsset({
      out,
      seen,
      url: variableUrl,
      family: familyDisplay,
      weight: "100 900",
      style: "Normal",
      note: "Direct CoType variable font asset (upright).",
      metadata: {
        ...baseMetadata,
        style: "Normal",
        weightLabel: "Variable"
      }
    });

    pushAsset({
      out,
      seen,
      url: variableItalicUrl,
      family: familyDisplay,
      weight: "100 900",
      style: "Italic",
      note: "Direct CoType variable font asset (italic).",
      metadata: {
        ...baseMetadata,
        style: "Italic",
        weightLabel: "Variable Italic"
      }
    });

    // Some CoType families (e.g. Coanda) expose per-style fontFile assets instead of variable files.
    if (!variableUrl && !variableItalicUrl && fontStyles.length > 0) {
      for (const style of fontStyles) {
        const rawStyleTitle =
          asString(style.title) ||
          asString(style.name) ||
          toTitleWords(asString(style.slug) || "");
        const styleDisplay = stripLeadingFamilyLabel(rawStyleTitle || "Regular", familyDisplay);
        const italic = typeof style.italic === "boolean" ? style.italic : /italic/i.test(styleDisplay);
        const weightRaw = style.weight;
        const resolvedWeight =
          typeof weightRaw === "number" || typeof weightRaw === "string"
            ? String(weightRaw)
            : undefined;

        pushAsset({
          out,
          seen,
          url: extractStyleFontUrl(style),
          family: familyDisplay,
          weight: resolvedWeight,
          style: italic ? "Italic" : "Normal",
          note: "Direct CoType per-style font asset.",
          metadata: {
            ...baseMetadata,
            sourceType: "style-file",
            style: styleDisplay,
            styleSlug: asString(style.slug),
            weightLabel: resolvedWeight
          }
        });
      }
    }
  }

  return out;
};

const buildCotypeProvocationScript = (): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const probe = "Sphinx of black quartz, judge my vow 0123456789 !@#$%^&*()";
    const hasText = (node, re) => {
      try {
        const text = (node?.textContent || "").trim();
        return Boolean(text) && re.test(text);
      } catch {
        return false;
      }
    };

    const fields = Array.from(document.querySelectorAll("input, textarea, [contenteditable='true'], [contenteditable]"));
    for (const field of fields) {
      try {
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          field.focus();
          field.value = probe;
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
          field.blur();
        } else {
          field.textContent = probe;
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }
      } catch {}
    }

    // Prefer enabling Italic previews if the UI exposes an "Italic" toggle.
    // CoType pages often lazy-load italic sources only after interaction.
    const italicCandidates = Array.from(document.querySelectorAll("button, a, [role='button'], label, [data-style], [data-weight]"))
      .filter((node) => hasText(node, /italic|italics|oblique/i));
    for (const node of italicCandidates.slice(0, 12)) {
      try {
        (node as any).click?.();
      } catch {}
      await sleep(180);
    }

    // Click through style buttons/selectors to trigger every cut.
    const clickables = Array.from(
      document.querySelectorAll(
        "button, a, [role='button'], [data-style], [data-weight], [data-font], .font-style, .style-selector"
      )
    );
    let clicked = 0;
    for (const node of clickables) {
      try {
        (node as any).click?.();
        clicked += 1;
      } catch {}
      await sleep(140);
      if (clicked >= 80) break;
    }

    window.scrollTo(0, document.body.scrollHeight / 2);
    await sleep(400);
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(400);

    window.__specimen_extraction_complete = true;

    window.__saka_extraction_complete = true;
  })();
`;

export const CoTypeScraper: Scraper = {
  id: "cotype",
  name: "CoType Foundry Scraper",

  canHandle(url: string): boolean {
    return url.includes("cotypefoundry.com");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const targetUrl = normalizeTargetUrl(url);
    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml"
        }
      });
      const html = await response.text();

      const title = extractTitle(html);
      const fallbackFamily = extractFamilyFromTitle(title);

      const slug = extractCotypeSlug(targetUrl);
      const nextData = parseNextData(html);
      const allFonts = extractAllFonts(nextData);

      const picked = pickFontGroup(allFonts, slug, fallbackFamily);
      const groupTitle = picked.groupTitle || fallbackFamily;

      const collectionUrls = picked.fonts
        .map((row) => getFontSlug(row))
        .filter((slugCandidate): slugCandidate is string => typeof slugCandidate === "string" && Boolean(slugCandidate))
        .map((slugCandidate) => `https://cotypefoundry.com/our-fonts/${slugCandidate}`);

      const styleEntries = extractStyleEntriesFromRows(picked.fonts, groupTitle);
      const requiredStyleEntries = styleEntries.filter((entry) => !entry.excludeFromRequired);
      const optionalExcludedStyles = dedupeByToken(
        styleEntries
          .filter((entry) => entry.excludeFromRequired)
          .map((entry) => entry.expectedStyle)
      );
      const expectedStyles = dedupeByToken(requiredStyleEntries.map((entry) => entry.expectedStyle));
      const expectedStyleLabels = [...expectedStyles];
      const postscriptHints = dedupeByToken(styleEntries.map((entry) => entry.postscriptName));
      // CoType VF conversion can rewrite internal PS names, so hard PS pass/fail causes false-negative warnings.
      const expectedPostscriptNames: string[] = [];
      const expectedCount = requiredStyleEntries.length > 0 ? requiredStyleEntries.length : expectedStyles.length;

      const targetProfile = {
        profileId: "cotype-target-profile-v3",
        source: "next-data-fontStyles",
        styleScope: "family-style",
        foundry: "CoType",
        targetUrl,
        targetSlug: slug,
        familyDisplay: groupTitle,
        collectionUrls,
        collectionFamilyCount: collectionUrls.length,
        expectedStyles,
        expectedStyleCount: expectedStyles.length,
        expectedStyleLabels,
        optionalExcludedStyles,
        optionalExcludedStyleCount: optionalExcludedStyles.length,
        expectedPostscriptNames,
        expectedPostscriptCount: expectedPostscriptNames.length,
        postscriptHints,
        postscriptValidation: "disabled",
        styleMap: styleEntries.map((entry) => ({
          familyName: entry.familyDisplay,
          styleName: entry.styleDisplay,
          expectedStyle: entry.expectedStyle,
          postscriptName: entry.postscriptName,
          styleSlug: entry.styleSlug,
          fontSlug: entry.fontSlug,
          weight: entry.weight,
          italic: entry.italic
        })),
        collectedAt: new Date().toISOString()
      };

      const directFonts = buildCotypeDirectFonts({
        rows: picked.fonts,
        groupTitle,
        targetUrl,
        targetProfile
      });

      if (directFonts.length > 0) {
        return {
          scraperName: this.name,
          foundryName: "CoType",
          fonts: directFonts,
          originalUrl: url,
          targetUrl,
          expectedCount: expectedCount > 0 ? expectedCount : directFonts.length,
          metadata: {
            foundry: "CoType",
            family: groupTitle,
            targetProfile
          }
        };
      }

      return {
        scraperName: this.name,
        foundryName: "CoType",
        fonts: [
          {
            url: "browser-intercept",
            family: groupTitle,
            format: "woff2",
            downloadable: true,
            note: "High-fidelity intercept for CoType superfamily.",
            metadata: {
              pageUrl: targetUrl,
              foundry: "CoType",
              family: groupTitle,
              masterFoundry: true,
              collectionUrls,
              targetProfile
            }
          }
        ],
        originalUrl: url,
        targetUrl,
        injectScript: buildCotypeProvocationScript(),
        masterFoundry: true,
        expectedCount: expectedCount > 0 ? expectedCount : 88,
        metadata: {
          foundry: "CoType",
          family: groupTitle,
          targetProfile
        }
      };
    } catch (error) {
      console.error("[CoTypeScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "CoType",
        fonts: [],
        originalUrl: url,
        targetUrl
      };
    }
  }
};
