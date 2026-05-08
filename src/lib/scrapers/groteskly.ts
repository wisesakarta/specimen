import { Scraper, ScrapeResult } from "./scraper-protocol";

const GROTESKLY_HOST = "groteskly.xyz";
const GROTESKLY_ZIP_HOST_PATTERN = /(?:grtskly|groteskly)\.xyz/i;
const GROTESKLY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const GROTESKLY_FETCH_TIMEOUT_MS = 20000;
const GROTESKLY_FETCH_MAX_RETRIES = 3;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fetchHtmlWithRetry = async (url: string): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GROTESKLY_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROTESKLY_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": GROTESKLY_UA,
          Accept: "text/html,application/xhtml+xml"
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < GROTESKLY_FETCH_MAX_RETRIES) {
        const backoffMs = 600 * attempt;
        await sleep(backoffMs);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to fetch target HTML");
};

const toReadableWords = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .trim();

const normalizeToken = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeStyleToken = (value: string): string =>
  normalizeToken(value)
    .replace(/smbold/g, "semibold")
    .replace(/extralight/g, "exlight")
    .replace(/extrabold/g, "exbold");

const normalizeTargetUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  parsed.hostname = GROTESKLY_HOST;
  return parsed.href;
};

const extractFamilySlug = (targetUrl: string): string | undefined => {
  try {
    const parsed = new URL(targetUrl);
    const segments = parsed.pathname.split("/").filter(Boolean).map((item) => item.toLowerCase());
    if (segments.length === 0) return undefined;

    if (segments[0] === "fonts" && segments[1]) return segments[1];
    if (segments[0] && segments[0].endsWith("-family")) return segments[0];
    if (segments[0] && !["trials", "fonts", "about", "blog", "contact", "faq"].includes(segments[0])) {
      return segments[0];
    }
    return undefined;
  } catch {
    return undefined;
  }
};

const decodeHtml = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const normalizeStyleLabel = (value: string): string =>
  value
    .replace(/\bexlight\b/gi, "ExLight")
    .replace(/\bextralight\b/gi, "ExLight")
    .replace(/\bexbold\b/gi, "ExBold")
    .replace(/\bextrabold\b/gi, "ExBold")
    .replace(/\bsmbold\b/gi, "SemiBold")
    .replace(/\bsemibold\b/gi, "SemiBold")
    .replace(/\s+/g, " ")
    .trim();

const extractFamilyName = (html: string, fallback: string): string => {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = (titleMatch?.[1] || "").trim();
  if (title) {
    const first = title.split("|")[0]?.trim() || "";
    const head = first.split("-")[0]?.trim() || first;
    if (head) return head;
  }

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) {
    const h1 = decodeHtml(h1Match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (h1) return h1;
  }

  return fallback;
};

const extractExpectedStyles = (html: string): string[] => {
  const out = new Set<string>();
  const styleHint = /(thin|light|regular|medium|semi|bold|black|italic|oblique|exlight|exbold|smbold)/i;
  const excluded = /(select license|up to|users|views|impressions|purchase|desktop|web|app|video|digital ads|logo|full family|variable font|€)/i;

  for (const match of html.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)) {
    const raw = decodeHtml((match[1] || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!raw) continue;
    if (excluded.test(raw)) continue;
    if (!styleHint.test(raw)) continue;
    const cleaned = normalizeStyleLabel(raw);
    if (cleaned) out.add(cleaned);
  }

  return Array.from(out);
};

const extractSpecimenUrls = (html: string, targetUrl: string): string[] => {
  const out = new Set<string>();
  const patterns = [
    /href=["']([^"']+?\.pdf(?:\?[^"']*)?)["']/gi,
    /href=["']([^"']*drive\.google\.com[^"']*)["']/gi
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = (match[1] || "").trim();
      if (!raw) continue;
      try {
        out.add(new URL(raw, targetUrl).href);
      } catch {
        // ignore malformed URL
      }
    }
  }
  return Array.from(out);
};

const extractDirectZipUrls = (html: string, targetUrl: string): string[] => {
  const out = new Set<string>();
  const directPattern = /https?:\/\/(?:grtskly|groteskly)\.xyz\/[^"'\s<>]+?\.zip(?:\?[^"'\s<>]*)?/gi;
  const escapedPattern = /https?:\\\/\\\/(?:grtskly|groteskly)\.xyz\\\/[^"'\s<>]+?\.zip(?:\?[^"'\s<>]*)?/gi;

  const normalizeCandidate = (raw: string): string => raw.replace(/\\\//g, "/");

  for (const match of html.matchAll(directPattern)) {
    const raw = normalizeCandidate(String(match[0] || "").trim());
    if (!raw) continue;
    try {
      out.add(new URL(raw, targetUrl).href);
    } catch {
      // ignore malformed URL
    }
  }

  for (const match of html.matchAll(escapedPattern)) {
    const raw = normalizeCandidate(String(match[0] || "").trim());
    if (!raw) continue;
    try {
      out.add(new URL(raw, targetUrl).href);
    } catch {
      // ignore malformed URL
    }
  }

  return Array.from(out);
};

const extractLinkedFontPageUrls = (html: string, targetUrl: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/\/fonts\/[a-z0-9-]+/gi)) {
    const candidate = String(match[0] || "").trim();
    if (!candidate) continue;
    try {
      out.add(new URL(candidate, targetUrl).href);
    } catch {
      // ignore malformed URL
    }
  }
  return Array.from(out);
};

const resolveStyleWeight = (styleName: string): string => {
  const token = normalizeStyleToken(styleName);
  if (token.includes("thin")) return "Thin";
  if (token.includes("exlight")) return "ExtraLight";
  if (token.includes("light")) return "Light";
  if (token.includes("medium")) return "Medium";
  if (token.includes("semibold")) return "SemiBold";
  if (token.includes("exbold")) return "ExtraBold";
  if (token.includes("bold")) return "Bold";
  if (token.includes("black")) return "Black";
  return "Regular";
};

const inferFamilyFromZipUrl = (zipUrl: string, fallbackFamily: string): string => {
  try {
    const parsed = new URL(zipUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const primarySegment = segments[0] || "";
    if (primarySegment && !/^(files?|download|assets?)$/i.test(primarySegment)) {
      const label = toReadableWords(primarySegment.replace(/\.(zip|woff2?|ttf|otf)$/i, ""));
      if (label) return label;
    }
  } catch {
    // continue with filename-based fallback
  }

  let fileName = "";
  try {
    fileName = decodeURIComponent(new URL(zipUrl).pathname.split("/").pop() || "");
  } catch {
    fileName = decodeURIComponent(zipUrl.split("/").pop() || "");
  }
  const stem = fileName
    .replace(/\.zip$/i, "")
    .replace(/[-_]?q[-_][a-z0-9]+$/i, "")
    .replace(/[-_](?:f|yd)-[a-z0-9]{3,8}$/i, "")
    .replace(
      /-(?:thin|extralight|exlight|light|regular|book|medium|semibold|smbold|bold|extrabold|exbold|black|heavy)(?:-(?:italic|oblique))?$/i,
      ""
    )
    .trim();
  const inferred = toReadableWords(stem);
  return inferred || fallbackFamily;
};

const inferStyleFromZipUrl = (zipUrl: string): string | undefined => {
  let fileName = "";
  try {
    fileName = decodeURIComponent(new URL(zipUrl).pathname.split("/").pop() || "");
  } catch {
    fileName = decodeURIComponent(zipUrl.split("/").pop() || "");
  }
  if (!fileName) return undefined;

  const stem = fileName
    .replace(/\.zip$/i, "")
    .replace(/[-_]?q[-_][a-z0-9]+$/i, "")
    .replace(/_/g, "-");
  const token = normalizeStyleToken(stem);
  if (!token) return undefined;

  if (token.includes("fullfamily")) return "Full Family";
  if (token.includes("variable")) return "Variable";

  const italic = token.includes("italic") || token.includes("oblique");
  const weight = resolveStyleWeight(token);
  if (italic) return weight === "Regular" ? "Regular Italic" : `${weight} Italic`;
  return weight;
};

const deriveExpectedStylesFromZipUrls = (zipUrls: string[]): string[] => {
  const out = new Set<string>();
  for (const zipUrl of zipUrls) {
    const style = inferStyleFromZipUrl(zipUrl);
    if (!style) continue;
    if (style === "Variable" || style === "Full Family") continue;
    out.add(style);
  }
  return Array.from(out);
};

const matchExpectedStyleFromZipUrl = (zipUrl: string, expectedStyles: string[]): string | undefined => {
  const zipToken = normalizeStyleToken(zipUrl);
  const candidates = expectedStyles
    .map((style) => ({ style, token: normalizeStyleToken(style) }))
    .filter((item) => item.token.length > 0)
    .sort((a, b) => b.token.length - a.token.length);
  const hit = candidates.find((candidate) => zipToken.includes(candidate.token));
  return hit?.style;
};

const isLikelyFamilyZip = (zipUrl: string): boolean => /full[_-]?family/i.test(zipUrl);
const isLikelyVariableZip = (zipUrl: string): boolean => /[_-]variable[_-]?/i.test(zipUrl);

const zipMatchesTarget = (zipUrl: string, familySlug: string | undefined, familyName: string): boolean => {
  const slugToken = normalizeStyleToken(familySlug || "");
  const familyToken = normalizeStyleToken(familyName);
  const urlToken = normalizeStyleToken(zipUrl);

  if (slugToken && urlToken.includes(slugToken)) return true;
  if (familyToken && urlToken.includes(familyToken)) return true;
  return false;
};

const buildDirectZipFonts = (params: {
  zipUrls: string[];
  targetUrl: string;
  familySlug?: string;
  familyName: string;
  expectedStyles: string[];
}): {
  fonts: ScrapeResult["fonts"];
  styleZipMap: Array<{ style: string; url: string }>;
  variableZipUrl?: string;
  fullFamilyZipUrl?: string;
} => {
  const { zipUrls, targetUrl, familySlug, familyName, expectedStyles } = params;
  const outFonts: ScrapeResult["fonts"] = [];
  const styleZipMap: Array<{ style: string; url: string }> = [];
  const seen = new Set<string>();
  let variableZipUrl: string | undefined;
  let fullFamilyZipUrl: string | undefined;

  for (const zipUrl of zipUrls) {
    if (!GROTESKLY_ZIP_HOST_PATTERN.test(zipUrl)) continue;
    if (!zipMatchesTarget(zipUrl, familySlug, familyName)) continue;

    if (!variableZipUrl && isLikelyVariableZip(zipUrl)) {
      variableZipUrl = zipUrl;
    }
    if (!fullFamilyZipUrl && isLikelyFamilyZip(zipUrl)) {
      fullFamilyZipUrl = zipUrl;
    }

    const inferredStyle = inferStyleFromZipUrl(zipUrl);
    const matchedStyle = matchExpectedStyleFromZipUrl(zipUrl, expectedStyles);
    const style =
      inferredStyle && /italic|oblique/i.test(inferredStyle) && matchedStyle && !/italic|oblique/i.test(matchedStyle)
        ? inferredStyle
        : matchedStyle || inferredStyle;
    if (!style) continue;
    if (style === "Variable" || style === "Full Family") continue;
    const zipFamily = inferFamilyFromZipUrl(zipUrl, familyName);

    const dedupeKey = `${normalizeStyleToken(style)}|${zipUrl}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    styleZipMap.push({ style, url: zipUrl });
    outFonts.push({
      url: zipUrl,
      family: zipFamily,
      format: "zip",
      weight: resolveStyleWeight(style),
      style: /italic|oblique/i.test(style) ? "Italic" : "Normal",
      downloadable: true,
      metadata: {
        pageUrl: targetUrl,
        foundry: "Groteskly Yours Studio",
        family: zipFamily,
        style,
        format: "zip",
        forceMetadataRepair: true,
        pruneRawZipAfterExtract: true,
        headers: {
          Origin: "https://groteskly.xyz",
          Referer: targetUrl,
          Accept: "*/*"
        }
      }
    });
  }

  return {
    fonts: outFonts,
    styleZipMap,
    variableZipUrl,
    fullFamilyZipUrl
  };
};

const buildInjectScript = (params: {
  familyName: string;
  styleNames: string[];
  familySlug?: string;
}): string => {
  const { familyName, styleNames, familySlug } = params;
  return `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const family = ${JSON.stringify(familyName)};
      const slugToken = ${JSON.stringify((familySlug || "").toLowerCase())};
      const styleNames = ${JSON.stringify(styleNames)};
      const probe = "Sphinx of black quartz, judge my vow 0123456789 !@#$%^&*()";
      const normalize = (value) => (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const familyToken = normalize(family);

      const styleToDescriptor = (styleLabel) => {
        const raw = String(styleLabel || "").trim();
        const token = normalize(raw);
        const italic = /italic|oblique/.test(token);
        let weight = 400;
        if (/thin/.test(token)) weight = 100;
        else if (/extralight|exlight/.test(token)) weight = 200;
        else if (/light/.test(token)) weight = 300;
        else if (/medium/.test(token)) weight = 500;
        else if (/semibold|semi/.test(token)) weight = 600;
        else if (/extrabold|exbold/.test(token)) weight = 800;
        else if (/bold/.test(token)) weight = 700;
        else if (/black/.test(token)) weight = 900;
        return { italic, weight };
      };

      const styleHint = /(thin|light|regular|medium|semi|bold|black|italic|oblique|exlight|exbold|smbold)/i;
      const licenseHint = /(select license|up to|users|views|impressions|purchase|desktop|web|app|video|digital ads|logo|full family|variable font|€)/i;

      const editables = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [contenteditable]'));
      for (const field of editables) {
        try {
          if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
            field.focus();
            field.value = probe;
            field.dispatchEvent(new Event("input", { bubbles: true }));
            field.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            field.textContent = probe;
            field.dispatchEvent(new Event("input", { bubbles: true }));
          }
        } catch {}
      }

      const selects = Array.from(document.querySelectorAll("select"));
      for (const select of selects) {
        const options = Array.from(select.options || []);
        const styleOptions = options.filter((opt) => {
          const label = (opt.textContent || "").trim();
          if (!label) return false;
          if (licenseHint.test(label)) return false;
          return styleHint.test(label);
        });
        if (styleOptions.length < 2) continue;

        for (const opt of styleOptions.slice(0, 64)) {
          try {
            select.value = opt.value;
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
          } catch {}
          await sleep(120);
        }
      }

      for (const styleName of styleNames) {
        const desc = styleToDescriptor(styleName);
        const cssText = \`\${desc.italic ? "italic" : "normal"} \${desc.weight} 72px "\${family}"\`;
        try {
          await document.fonts.load(cssText, probe);
        } catch {}
        try {
          const node = document.createElement("span");
          node.textContent = probe;
          node.style.cssText = \`position:fixed;left:-9999px;top:-9999px;font-family:"\${family}";font-weight:\${desc.weight};font-style:\${desc.italic ? "italic" : "normal"};font-size:72px;opacity:0.001;\`;
          document.body.appendChild(node);
        } catch {}
        await sleep(80);
      }

      const urls = new Set();
      const extractUrls = (src) => {
        const list = [];
        const re = /url\\(([^)]+)\\)/gi;
        let match;
        while ((match = re.exec(src || ""))) {
          let raw = (match[1] || "").trim().replace(/^['"]|['"]$/g, "");
          if (!raw) continue;
          try {
            raw = new URL(raw, location.href).href;
          } catch {}
          list.push(raw);
        }
        return list;
      };
      const visitRule = (rule) => {
        if (!rule) return;
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const familyValue = (rule.style.getPropertyValue("font-family") || "").replace(/["']/g, "").trim();
          const famToken = normalize(familyValue);
          const familyMatch = familyToken && famToken.includes(familyToken);
          const slugMatch = slugToken && famToken.includes(normalize(slugToken));
          if (familyMatch || slugMatch) {
            const src = rule.style.getPropertyValue("src") || "";
            for (const u of extractUrls(src)) urls.add(u);
          }
        }
        if (rule.cssRules && rule.cssRules.length) {
          for (const inner of Array.from(rule.cssRules)) visitRule(inner);
        }
      };

      for (const sheet of Array.from(document.styleSheets || [])) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules || [])) visitRule(rule);
      }

      for (const url of Array.from(urls)) {
        try {
          await fetch(url, { mode: "no-cors", credentials: "omit" });
        } catch {}
      }

      for (let pass = 1; pass <= 4; pass += 1) {
        window.scrollTo(0, Math.floor((document.body.scrollHeight * pass) / 4));
        await sleep(250);
      }
      window.scrollTo(0, 0);
      await sleep(800);

      window.__specimen_extraction_complete = true;

      window.__specimen_extraction_complete = true;
    })();
  `;
};

export const GrotesklyScraper: Scraper = {
  id: "groteskly",
  name: "Groteskly Yours Scraper",

  canHandle(url: string): boolean {
    return url.includes(GROTESKLY_HOST);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const targetUrl = normalizeTargetUrl(url);
    const slug = extractFamilySlug(targetUrl);
    const fallbackFamily = toReadableWords(slug || "groteskly-font");

    try {
      const html = await fetchHtmlWithRetry(targetUrl);

      const familyName = extractFamilyName(html, fallbackFamily);
      const directZipUrls = extractDirectZipUrls(html, targetUrl);
      const expectedStylesFromOptions = extractExpectedStyles(html);
      const expectedStylesFromZip = deriveExpectedStylesFromZipUrls(directZipUrls);
      const expectedStylesCurrentPage = Array.from(new Set([...expectedStylesFromOptions, ...expectedStylesFromZip]));
      const specimenUrls = extractSpecimenUrls(html, targetUrl);
      const directZip = buildDirectZipFonts({
        zipUrls: directZipUrls,
        targetUrl,
        familySlug: slug,
        familyName,
        expectedStyles: expectedStylesCurrentPage
      });

      const linkedFontPages = extractLinkedFontPageUrls(html, targetUrl).filter((pageUrl) => pageUrl !== targetUrl);
      const collectionFonts: ScrapeResult["fonts"] = [];
      const collectionExpectedStyles = new Set<string>();
      const collectionFamilySummaries: Array<{
        pageUrl: string;
        family: string;
        targetSlug?: string;
        expectedStyleCount: number;
        directZipUrlCount: number;
        directStyleZipCount: number;
      }> = [];

      if (directZip.fonts.length === 0 && linkedFontPages.length > 0) {
        for (const pageUrl of linkedFontPages.slice(0, 16)) {
          try {
            const subHtml = await fetchHtmlWithRetry(pageUrl);
            const subSlug = extractFamilySlug(pageUrl);
            const subFamily = extractFamilyName(subHtml, toReadableWords(subSlug || "groteskly-font"));
            const subDirectZipUrls = extractDirectZipUrls(subHtml, pageUrl);
            if (subDirectZipUrls.length === 0) continue;

            const subExpectedFromOptions = extractExpectedStyles(subHtml);
            const subExpectedFromZip = deriveExpectedStylesFromZipUrls(subDirectZipUrls);
            const subExpectedStyles =
              subExpectedFromOptions.length > 0 ? subExpectedFromOptions : subExpectedFromZip;
            const subDirectZip = buildDirectZipFonts({
              zipUrls: subDirectZipUrls,
              targetUrl: pageUrl,
              familySlug: subSlug,
              familyName: subFamily,
              expectedStyles: subExpectedStyles
            });
            if (subDirectZip.fonts.length === 0) continue;

            for (const style of subExpectedStyles) {
              if (style) collectionExpectedStyles.add(style);
            }
            collectionFamilySummaries.push({
              pageUrl,
              family: subFamily,
              targetSlug: subSlug,
              expectedStyleCount: subExpectedStyles.length,
              directZipUrlCount: subDirectZipUrls.length,
              directStyleZipCount: subDirectZip.styleZipMap.length
            });
            collectionFonts.push(...subDirectZip.fonts);
          } catch {
            // best-effort crawl for linked pages
          }
        }
      }

      const isDirectMode = directZip.fonts.length > 0;
      const isCollectionMode = !isDirectMode && collectionFonts.length > 0;
      const expectedStyles = isDirectMode
        ? expectedStylesCurrentPage
        : isCollectionMode
          ? Array.from(collectionExpectedStyles)
          : expectedStylesCurrentPage;

      const targetProfile = {
        profileId: isCollectionMode ? "groteskly-target-profile-v3-collection" : "groteskly-target-profile-v2",
        foundry: "Groteskly Yours Studio",
        targetUrl,
        targetSlug: slug,
        family: familyName,
        expectedStyles,
        expectedStyleCount: expectedStyles.length,
        specimenUrls,
        source: isDirectMode
          ? "html-option-scan+embedded-zip-scan"
          : isCollectionMode
            ? "collection-page-crawl+embedded-zip-scan"
            : "intercept-fallback",
        directZipUrlCount: directZipUrls.length,
        directStyleZipCount: directZip.styleZipMap.length,
        directStyleZipMap: directZip.styleZipMap,
        variableZipUrl: directZip.variableZipUrl,
        fullFamilyZipUrl: directZip.fullFamilyZipUrl,
        linkedFamilyPageCount: linkedFontPages.length,
        linkedFamilyPages: linkedFontPages,
        collectionFamilyCount: collectionFamilySummaries.length,
        collectionFamilies: collectionFamilySummaries,
        collectedAt: new Date().toISOString()
      };

      const baseFonts: ScrapeResult["fonts"] = isDirectMode
        ? directZip.fonts
        : isCollectionMode
          ? collectionFonts
          : [
              {
                url: "browser-intercept",
                family: familyName,
                format: "woff2",
                weight: "Regular",
                style: "Normal",
                downloadable: true,
                metadata: {
                  pageUrl: targetUrl,
                  foundry: "Groteskly Yours Studio",
                  family: familyName,
                  pruneRawZipAfterExtract: true,
                  targetProfile
                }
              }
            ];

      const fonts: ScrapeResult["fonts"] =
        baseFonts[0]?.url !== "browser-intercept"
          ? baseFonts.map((font) => ({
              ...font,
              metadata: {
                ...(font.metadata || {}),
                targetProfile
              }
            }))
          : baseFonts;

      const expectedCount =
        baseFonts[0]?.url !== "browser-intercept"
          ? baseFonts.length
          : expectedStyles.length > 0
            ? expectedStyles.length
            : undefined;

      return {
        scraperName: this.name,
        foundryName: "Groteskly Yours Studio",
        fonts,
        originalUrl: url,
        targetUrl,
        injectScript: buildInjectScript({
          familyName,
          styleNames: expectedStyles,
          familySlug: slug
        }),
        expectedCount,
        metadata: {
          foundry: "Groteskly Yours Studio",
          family: familyName,
          pruneRawZipAfterExtract: true,
          fonts,
          targetProfile
        }
      };
    } catch (error) {
      console.error("[GrotesklyScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "Groteskly Yours Studio",
        fonts: [],
        originalUrl: url,
        targetUrl
      };
    }
  }
};
