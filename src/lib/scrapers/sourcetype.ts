import { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const SOURCETYPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const SOURCETYPE_HOST = "www.sourcetype.com";
const SOURCETYPE_ORIGIN = `https://${SOURCETYPE_HOST}`;
const SAMPLE_FONTS_BASE = `${SOURCETYPE_ORIGIN}/sample-fonts`;
const KNOWN_WEIGHTS = [
  "Thin",
  "ThinItalic",
  "ExtraLight",
  "ExtraLightItalic",
  "Light",
  "LightItalic",
  "Regular",
  "Italic",
  "Medium",
  "MediumItalic",
  "SemiBold",
  "SemiBoldItalic",
  "Bold",
  "BoldItalic",
  "ExtraBold",
  "ExtraBoldItalic",
  "Black",
  "BlackItalic",
];
const FAMILY_PATH_RE = /^\/typefaces\/\d+\/[a-z0-9-]+\/?$/i;

type SourceTypeScope = {
  mode: "family" | "section";
  targetUrl: string;
  familySlug?: string;
  sectionId?: string;
};

type ProbeResult = {
  url: string;
  weight: string;
  available: boolean;
  contentLength?: number;
};

type HtmlFontFace = {
  cssFamilyKey: string;
  url: string;
  format: FontMetadata["format"];
};

type DeclaredCut = {
  cssFamilyKey: string;
  label: string;
  familyName: string;
  styleName: string;
  fullName: string;
};

type FamilyScrapePayload = {
  pageUrl: string;
  familySlug: string;
  familyName: string;
  htmlCuts: string[];
  fonts: FontMetadata[];
  targetProfile: Record<string, unknown>;
};

const toToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const toReadable = (slug: string): string =>
  slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Source Type Font";

const dedupeList = (values: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
};

const normalizeInputUrl = (rawUrl: string): URL => {
  const parsed = /^https?:\/\//i.test(rawUrl) ? new URL(rawUrl) : new URL(`https://${rawUrl}`);
  parsed.protocol = "https:";
  parsed.hostname = SOURCETYPE_HOST;
  return parsed;
};

const toAbsoluteSourceUrl = (value: string): string => new URL(value, SOURCETYPE_ORIGIN).href;

const extractFamilySlug = (targetUrl: string): string => {
  try {
    const parsed = normalizeInputUrl(targetUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const typefacesIndex = segments.findIndex((segment) => segment.toLowerCase() === "typefaces");
    if (typefacesIndex >= 0 && segments[typefacesIndex + 2]) return segments[typefacesIndex + 2].toLowerCase();
    if (typefacesIndex >= 0 && segments[typefacesIndex + 1]) return segments[typefacesIndex + 1].toLowerCase();
    return segments[segments.length - 1]?.toLowerCase() || "font";
  } catch {
    return "font";
  }
};

const resolveScope = (rawUrl: string): SourceTypeScope => {
  const parsed = normalizeInputUrl(rawUrl);
  const hashToken = toToken(parsed.hash.replace(/^#/, ""));
  const segments = parsed.pathname.split("/").filter(Boolean);
  const head = segments[0]?.toLowerCase() || "";

  if (head === "typefaces" && segments.length >= 2) {
    const familySlug = extractFamilySlug(parsed.href);
    parsed.hash = "";
    return {
      mode: "family",
      targetUrl: parsed.href,
      familySlug,
    };
  }

  const sectionId = hashToken || toToken(head) || "space";
  return {
    mode: "section",
    targetUrl: `${SOURCETYPE_ORIGIN}/#${sectionId}`,
    sectionId,
  };
};

const fetchHtml = async (url: string, referer?: string): Promise<string> => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": SOURCETYPE_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Origin: SOURCETYPE_ORIGIN,
      Referer: referer || SOURCETYPE_ORIGIN,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.text();
};

const extractOgTitle = (html: string): string => {
  const match = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  return match?.[1]?.trim() || "";
};

const decodeHtml = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const normalizeCutLabel = (value: string): string => {
  const human = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = human.split(" ").filter(Boolean);
  const normalized = tokens
    .map((token) => {
      const lower = token.toLowerCase();
      if (lower === "extralight") return "ExtraLight";
      if (lower === "extrabold") return "ExtraBold";
      if (lower === "semibold") return "SemiBold";
      if (lower === "book") return "Book";
      if (lower === "italic") return "Italic";
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ")
    .replace(/^Regular Italic$/i, "Italic");
  return normalized || "Regular";
};

const normalizeCssFamilyKey = (value: string): string =>
  value.replace(/^['"]|['"]$/g, "").replace(/\s+/g, " ").trim();

const describeFamilyVariant = (
  baseFamilyName: string,
  rawLabel: string
): { label: string; familyName: string; styleName: string; fullName: string } => {
  const label = normalizeCutLabel(rawLabel);
  if (/^Mono\s+/i.test(label)) {
    const styleName = normalizeCutLabel(label.replace(/^Mono\s+/i, "")) || "Regular";
    const familyName = `${baseFamilyName} Mono`.replace(/\s+/g, " ").trim();
    return {
      label,
      familyName,
      styleName,
      fullName: `${familyName} ${styleName}`.replace(/\s+/g, " ").trim(),
    };
  }

  return {
    label,
    familyName: baseFamilyName,
    styleName: label,
    fullName: `${baseFamilyName} ${label}`.replace(/\s+/g, " ").trim(),
  };
};

const extractAvailableCuts = (html: string): string[] => {
  const section = html.match(/Available\s+Cuts[\s\S]*?(?=<h2|<\/section|$)/i)?.[0];
  if (!section) return [];

  const fromSpans = Array.from(
    section.matchAll(/<span[^>]*class=["'][^"']*type-cuts__cut-inner[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)
  )
    .map((match) => decodeHtml(String(match[1] || "")).replace(/<[^>]+>/g, " "))
    .map((value) => normalizeCutLabel(value))
    .filter(Boolean);
  if (fromSpans.length > 0) return dedupeList(fromSpans);

  const cuts: string[] = [];
  const cutRe =
    /(?:>|^)\s*((?:Mono\s+)?(?:Regular|Italic|Thin|Book|(?:Extra\s*)?Light|Medium|(?:Semi\s*)?Bold|(?:Extra\s*)?Bold|Black|Heavy))(\s*Italic)?\s*(?:<|$)/gi;
  for (const match of Array.from(section.matchAll(cutRe))) {
    const base = (match[1] || "").replace(/\s+/g, " ").trim();
    const ital = (match[2] || "").replace(/\s+/g, " ").trim();
    const label = normalizeCutLabel(`${base}${ital ? ` ${ital}` : ""}`);
    if (label) cuts.push(label);
  }

  return dedupeList(cuts);
};

const extractDeclaredCuts = (html: string, familyName: string): DeclaredCut[] => {
  const section = html.match(/Available\s+Cuts[\s\S]*?(?=<h2|<\/section|$)/i)?.[0];
  if (!section) return [];

  const cuts: DeclaredCut[] = [];
  const spanRe =
    /<span[^>]*class=["'][^"']*type-cuts__cut-inner[^"']*["'][^>]*style=["'][^"']*font-family:\s*['"]?([^;'"\s]+)['"]?[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  for (const match of Array.from(section.matchAll(spanRe))) {
    const cssFamilyKey = normalizeCssFamilyKey(String(match[1] || ""));
    const rawLabel = decodeHtml(String(match[2] || "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!cssFamilyKey || !rawLabel) continue;
    const variant = describeFamilyVariant(familyName, rawLabel);
    cuts.push({
      cssFamilyKey,
      label: variant.label,
      familyName: variant.familyName,
      styleName: variant.styleName,
      fullName: variant.fullName,
    });
  }

  return cuts;
};

const buildFileStem = (slug: string): string => {
  const base = slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `${base}ST`;
};

const detectNumericWeight = (label: string): number => {
  const lower = normalizeCutLabel(label).toLowerCase();
  if (lower.includes("thin")) return 100;
  if (lower.includes("extralight")) return 200;
  if (lower.includes("light")) return 300;
  if (lower.includes("book")) return 400;
  if (lower.includes("regular") || lower === "italic") return 400;
  if (lower.includes("medium")) return 500;
  if (lower.includes("semibold")) return 600;
  if (lower.includes("extrabold")) return 800;
  if (lower.includes("black") || lower.includes("heavy")) return 900;
  if (lower.includes("bold")) return 700;
  return 400;
};

const detectStyle = (label: string): "Normal" | "Italic" =>
  /italic/i.test(normalizeCutLabel(label)) ? "Italic" : "Normal";

const parseContentLength = (raw: string | null): number | undefined => {
  const value = Number(raw || "0");
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const isFontLikeResponse = (contentType: string, bytes?: Uint8Array): boolean => {
  const lower = contentType.toLowerCase();
  if (lower.includes("text/html")) return false;
  if (lower.includes("font") || lower.includes("woff") || lower.includes("octet-stream") || lower.includes("opentype")) {
    return true;
  }
  if (!bytes || bytes.length < 4) return false;
  const signature = Buffer.from(bytes.subarray(0, 4)).toString("ascii");
  return signature === "wOF2" || signature === "wOFF" || signature === "OTTO" || signature === "\u0000\u0001\u0000\u0000";
};

const probeFont = async (fontUrl: string, weight: string, referer: string): Promise<ProbeResult> => {
  const commonHeaders = {
    "User-Agent": SOURCETYPE_UA,
    Accept: "*/*",
    Origin: SOURCETYPE_ORIGIN,
    Referer: referer,
  };

  try {
    const headResponse = await fetch(fontUrl, {
      method: "HEAD",
      headers: commonHeaders,
    });
    const headType = headResponse.headers.get("content-type") || "";
    const headLength = parseContentLength(headResponse.headers.get("content-length"));
    if (headResponse.ok && isFontLikeResponse(headType)) {
      return { url: fontUrl, weight, available: true, contentLength: headLength };
    }
  } catch {
    // Fall through to ranged GET.
  }

  try {
    const getResponse = await fetch(fontUrl, {
      method: "GET",
      headers: {
        ...commonHeaders,
        Range: "bytes=0-1023",
      },
    });
    const body = new Uint8Array(await getResponse.arrayBuffer());
    const contentType = getResponse.headers.get("content-type") || "";
    const contentLength = parseContentLength(getResponse.headers.get("content-length")) || body.byteLength;
    const available = getResponse.ok && isFontLikeResponse(contentType, body) && body.byteLength >= 4;
    return { url: fontUrl, weight, available, contentLength: available ? contentLength : undefined };
  } catch {
    return { url: fontUrl, weight, available: false };
  }
};

const buildInjectScript = (familyName: string, styleNames: string[]): string => `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const styles = ${JSON.stringify(styleNames.slice(0, 18))};
  const family = ${JSON.stringify(familyName)};
  const clickable = Array.from(document.querySelectorAll('.type-cuts__cut, .type-cuts__cut-inner, button, [role="button"]'));

  for (const node of clickable) {
    const label = (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!label) continue;
    if (!styles.some((style) => label.includes(String(style).toLowerCase()))) continue;
    try {
      node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } catch {}
    await sleep(180);
  }

  for (let i = 0; i <= 6; i += 1) {
    window.scrollTo(0, Math.floor(document.body.scrollHeight * (i / 6)));
    await sleep(180);
  }
  window.scrollTo(0, 0);

  const probeText = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789';
  for (const style of styles) {
    const span = document.createElement('span');
    span.style.cssText = 'position:fixed;inset:auto auto 0 0;opacity:0;pointer-events:none;font-size:24px;';
    span.style.fontFamily = family + " " + style + ", " + family + ", sans-serif";
    span.textContent = probeText;
    document.body.appendChild(span);
  }

  await sleep(1200);
})();
`;

const extractInlineFontFaces = (html: string): HtmlFontFace[] => {
  const faces: HtmlFontFace[] = [];
  const blocks = html.match(/@font-face\s*\{[\s\S]*?\}/gi) || [];
  for (const block of blocks) {
    const cssFamilyKey = normalizeCssFamilyKey(block.match(/font-family:\s*["']([^"']+)["']/i)?.[1] || "");
    if (!cssFamilyKey) continue;

    const sourceMatch =
      block.match(/url\((['"]?)([^)'"]+?\.woff2(?:\?[^)'"]*)?)\1\)\s*format\(['"]woff2['"]\)/i) ||
      block.match(/url\((['"]?)([^)'"]+?\.woff(?:\?[^)'"]*)?)\1\)\s*format\(['"]woff['"]\)/i);
    const sourceUrl = sourceMatch?.[2] ? toAbsoluteSourceUrl(sourceMatch[2]) : "";
    if (!sourceUrl) continue;

    faces.push({
      cssFamilyKey,
      url: sourceUrl,
      format: /\.woff2(?:$|\?)/i.test(sourceUrl) ? "woff2" : "woff",
    });
  }
  return faces;
};

const extractSpecimenPdfUrls = (html: string, pageUrl: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/(?:https?:\/\/|\/\/|\/)[^"'<>\\\s]+?\.pdf(?:\?[^"'<>\\\s]*)?/gi)) {
    const raw = decodeHtml(String(match[0] || "").replace(/\\\//g, "/").trim());
    if (!raw) continue;
    try {
      const resolved = /^https?:\/\//i.test(raw)
        ? new URL(raw)
        : raw.startsWith("//")
          ? new URL(`https:${raw}`)
          : new URL(raw, pageUrl);
      out.add(resolved.href);
    } catch {
      // ignore malformed candidates
    }
  }
  return Array.from(out);
};

const extractSectionTypefaceUrls = (html: string, sectionId: string): string[] => {
  const scriptRe = new RegExp(`<script id=["']${sectionId}-3d-data["'] type=["']application/json["']>([\\s\\S]*?)<\\/script>`, "i");
  const payload = html.match(scriptRe)?.[1];
  if (!payload) return [];

  try {
    const parsed = JSON.parse(payload) as Array<Record<string, unknown>>;
    const urls = parsed
      .map((entry) => (typeof entry.url === "string" ? entry.url.trim() : ""))
      .filter((entry) => FAMILY_PATH_RE.test(entry))
      .map((entry) => toAbsoluteSourceUrl(entry));
    return dedupeList(urls);
  } catch {
    return [];
  }
};

const buildFontMetadata = (
  pageUrl: string,
  familyName: string,
  probe: ProbeResult,
  specimenPdfUrls: string[] = []
): FontMetadata => {
  const variant = describeFamilyVariant(familyName, probe.weight);
  return {
    url: probe.url,
    format: "woff2",
    family: variant.familyName,
    weight: detectNumericWeight(variant.styleName),
    style: detectStyle(variant.styleName),
    downloadable: true,
    note: `Web Font (${variant.label})`,
    metadata: {
      foundry: "Source Type",
      family: variant.familyName,
      pageUrl,
      styleName: variant.styleName,
      fullName: variant.fullName,
      forceMetadataRepair: true,
      contentLength: probe.contentLength,
      specimenPdfUrls,
      headers: {
        Origin: SOURCETYPE_ORIGIN,
        Referer: pageUrl,
        Accept: "*/*",
      },
    },
  };
};

const scrapeFamilyPage = async (targetUrl: string): Promise<FamilyScrapePayload> => {
  const pageUrl = normalizeInputUrl(targetUrl).href.replace(/#.*$/, "");
  const html = await fetchHtml(pageUrl, pageUrl);
  const familySlug = extractFamilySlug(pageUrl);
  const fileStem = buildFileStem(familySlug);
  const fallbackFamily = toReadable(familySlug);
  const ogTitle = extractOgTitle(html);
  const familyName = ogTitle ? ogTitle.replace(/\s*[-–—]\s*Typefaces.*$/i, "").trim() : fallbackFamily;
  const htmlCuts = extractAvailableCuts(html);
  const declaredCuts = extractDeclaredCuts(html, familyName);
  const inlineFaces = extractInlineFontFaces(html);
  const specimenPdfUrls = extractSpecimenPdfUrls(html, pageUrl);

  const faceByCssKey = new Map<string, HtmlFontFace>();
  for (const face of inlineFaces) {
    if (!faceByCssKey.has(face.cssFamilyKey)) faceByCssKey.set(face.cssFamilyKey, face);
  }

  const exactFonts: FontMetadata[] = [];
  const seenExact = new Set<string>();
  for (const cut of declaredCuts) {
    const face = faceByCssKey.get(cut.cssFamilyKey);
    if (!face) continue;
    const key = `${face.url}::${cut.fullName}`;
    if (seenExact.has(key)) continue;
    seenExact.add(key);
    exactFonts.push({
      url: face.url,
      format: face.format,
      family: cut.familyName,
      weight: detectNumericWeight(cut.styleName),
      style: detectStyle(cut.styleName),
      downloadable: true,
      note: `Web Font (${cut.label})`,
      metadata: {
        foundry: "Source Type",
        family: cut.familyName,
        pageUrl,
        styleName: cut.styleName,
        fullName: cut.fullName,
        forceMetadataRepair: true,
        specimenPdfUrls,
        headers: {
          Origin: SOURCETYPE_ORIGIN,
          Referer: pageUrl,
          Accept: "*/*",
        },
      },
    });
  }

  const cutsToProbe = (htmlCuts.length > 0 ? htmlCuts : KNOWN_WEIGHTS).map((cut) => cut.replace(/\s+/g, ""));
  const probeResults =
    exactFonts.length > 0
      ? []
      : await Promise.all(
          cutsToProbe.map((weight) => probeFont(`${SAMPLE_FONTS_BASE}/${fileStem}_${weight}.woff2`, weight, pageUrl))
        );

  if (exactFonts.length === 0 && htmlCuts.length === 0) {
    const altStem = familySlug
      .split(/[-_]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    if (altStem && altStem !== fileStem.replace(/ST$/, "")) {
      const fallbackResults = await Promise.all(
        ["Regular", "Italic", "Medium", "Bold"].map((weight) =>
          probeFont(`${SAMPLE_FONTS_BASE}/${altStem}_${weight}.woff2`, weight, pageUrl)
        )
      );
      probeResults.push(...fallbackResults.filter((item) => item.available));
    }
  }

  const availableFonts = probeResults.filter((item) => item.available);
  const fonts =
    exactFonts.length > 0
      ? exactFonts
      : availableFonts.map((probe) => buildFontMetadata(pageUrl, familyName, probe, specimenPdfUrls));

  const expectedStyles =
    declaredCuts.length > 0
      ? dedupeList(declaredCuts.map((cut) => cut.fullName))
      : dedupeList(
          (htmlCuts.length > 0 ? htmlCuts : availableFonts.map((item) => item.weight)).map((label) =>
            describeFamilyVariant(familyName, label).fullName
          )
        );
  const unavailableWeights =
    declaredCuts.length > 0
      ? dedupeList(declaredCuts.filter((cut) => !faceByCssKey.has(cut.cssFamilyKey)).map((cut) => cut.fullName))
      : dedupeList(
          probeResults
            .filter((item) => !item.available)
            .map((item) => describeFamilyVariant(familyName, item.weight).fullName)
        );

  return {
    pageUrl,
    familySlug,
    familyName,
    htmlCuts,
    fonts,
    targetProfile: {
      profileId: "sourcetype-target-profile-v1",
      foundry: "Source Type",
      targetUrl: pageUrl,
      targetSlug: familySlug,
      familyDisplay: familyName,
      fileStem,
      styleScope: "family-style",
      source: exactFonts.length > 0 ? "inline-font-face-map" : htmlCuts.length > 0 ? "html-cut-scan" : "range-probe",
      detectedCuts: htmlCuts,
      expectedStyles,
      specimenPdfUrls,
      probedWeights: dedupeList(cutsToProbe.map(normalizeCutLabel)),
      availableCount: fonts.length,
      unavailableWeights,
      strictMissingStyles: false,
    },
  };
};

const aggregateSectionFonts = async (scope: SourceTypeScope): Promise<ScrapeResult> => {
  const sectionId = scope.sectionId || "space";
  const homeHtml = await fetchHtml(SOURCETYPE_ORIGIN, SOURCETYPE_ORIGIN);
  const familyUrls = extractSectionTypefaceUrls(homeHtml, sectionId);
  const pages = familyUrls.length > 0 ? familyUrls : [];
  const fonts: FontMetadata[] = [];
  const familyProfiles: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const familyUrl of pages) {
    try {
      const family = await scrapeFamilyPage(familyUrl);
      familyProfiles.push(family.targetProfile);
      for (const font of family.fonts) {
        if (seen.has(font.url)) continue;
        seen.add(font.url);
        fonts.push(font);
      }
    } catch {
      // Best effort collection crawl.
    }
  }

  if (fonts.length === 0) {
    return {
      scraperName: SourceTypeScraper.name,
      foundryName: "Source Type",
      fonts: [
        {
          url: "browser-intercept",
          format: "woff2" as const,
          family: `Source Type ${toReadable(sectionId)}`,
          weight: "Regular",
          style: "Normal",
          downloadable: true,
          metadata: {
            foundry: "Source Type",
            pageUrl: scope.targetUrl,
            note: `Fallback browser interception for section ${sectionId}`,
          },
        },
      ],
      originalUrl: scope.targetUrl,
      targetUrl: scope.targetUrl,
      expectedCount: 1,
      injectScript: buildInjectScript(`Source Type ${toReadable(sectionId)}`, ["Regular", "Italic", "Medium", "Bold"]),
      metadata: {
        targetProfile: {
          profileId: "sourcetype-section-profile-v1",
          foundry: "Source Type",
          targetUrl: scope.targetUrl,
          sectionId,
          familyPages: familyUrls,
          source: "space-section-json",
        },
      },
    };
  }

  return {
    scraperName: SourceTypeScraper.name,
    foundryName: "Source Type",
    fonts,
    originalUrl: scope.targetUrl,
    targetUrl: scope.targetUrl,
    expectedCount: fonts.length,
    metadata: {
      targetProfile: {
        profileId: "sourcetype-section-profile-v1",
        foundry: "Source Type",
        targetUrl: scope.targetUrl,
        sectionId,
        familyPages: familyUrls,
        familyCount: familyProfiles.length,
        expectedStyles: familyProfiles.flatMap((profile) =>
          Array.isArray((profile as any).expectedStyles) ? ((profile as any).expectedStyles as string[]) : []
        ),
        specimenPdfUrls: familyProfiles.flatMap((profile) =>
          Array.isArray((profile as any).specimenPdfUrls) ? ((profile as any).specimenPdfUrls as string[]) : []
        ),
        source: "space-section-json",
      },
      familyProfiles,
    },
  };
};

export const SourceTypeScraper: Scraper = {
  id: "sourcetype",
  name: "Source Type Extractor",

  canHandle(url: string): boolean {
    try {
      const parsed = /^https?:\/\//i.test(url) ? new URL(url) : new URL(`https://${url}`);
      const host = parsed.hostname.toLowerCase();
      return host === "sourcetype.com" || host === SOURCETYPE_HOST;
    } catch {
      return false;
    }
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const scope = resolveScope(url);
      if (scope.mode === "section") {
        return await aggregateSectionFonts(scope);
      }

      const family = await scrapeFamilyPage(scope.targetUrl);
      const fonts = family.fonts.length > 0
        ? family.fonts
        : [
            {
              url: "browser-intercept",
              format: "woff2" as const,
              family: family.familyName,
              weight: "Regular",
              style: "Normal",
              downloadable: true,
              metadata: {
                foundry: "Source Type",
                pageUrl: family.pageUrl,
                note: "Fallback to browser interception - direct probes returned 0 assets",
              },
            },
          ];

      return {
        scraperName: this.name,
        foundryName: "Source Type",
        fonts,
        originalUrl: url,
        targetUrl: family.pageUrl,
        expectedCount: fonts.length,
        injectScript: buildInjectScript(
          family.familyName,
          family.htmlCuts.length > 0 ? family.htmlCuts : ["Regular", "Italic", "Medium", "Bold"]
        ),
        metadata: { targetProfile: family.targetProfile },
      };
    } catch {
      return {
        scraperName: this.name,
        foundryName: "Source Type",
        fonts: [],
        originalUrl: url,
      };
    }
  },
};
