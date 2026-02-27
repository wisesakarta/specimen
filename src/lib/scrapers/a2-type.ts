import type { FontMetadata, ScrapeResult, Scraper } from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const normalizeTargetUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    parsed.protocol = "https:";
    parsed.hostname = "a2-type.co.uk";
    return parsed.href;
  } catch {
    return rawUrl;
  }
};

const extractTitle = (html: string): string => {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return (match?.[1] || "").trim();
};

const extractFamilyFromTitle = (title: string): string => {
  // Examples:
  // "Home | A2-TYPE" => "A2-TYPE"
  // "PRISMAX | A2-TYPE" => "PRISMAX"
  // "BOING MONO | A2-TYPE" => "BOING MONO"
  const parts = title
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
    
  if (parts.length === 0) return "A2-TYPE";

  // If the first part is just "Home", look for later parts.
  if (/^(home|index)$/i.test(parts[0])) {
    return parts.length > 1 ? parts[parts.length - 1] : "A2-TYPE";
  }

  // A2-Type titles are usually "FAMILY | A2-TYPE" or "FAMILY SUBFAMILY | A2-TYPE"
  // We take the first part entirely as it often contains the specific subfamily/collection name.
  return parts[0];
};

const extractExpectedCountHint = (html: string): number | undefined => {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const normalized = text.replace(/\s+/g, " ");

  const styleDirectMatches = [...normalized.matchAll(/(\d{1,3})\s+Styles?\b/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 512);
  const direct = styleDirectMatches.length ? Math.max(...styleDirectMatches) : undefined;
  if (direct) return direct;

  const weightMatches = [...normalized.matchAll(/(\d{1,3})\s+Weights?\b/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 256);
  const weights = weightMatches.length ? Math.max(...weightMatches) : undefined;
  if (!weights) return undefined;

  // Heuristic: "Weights + Italics" implies x2. "(\d) Styles" implies extra cuts.
  const hasItalics = /Weights?\s*\+?\s*Italics?/i.test(normalized) || /Italics?\b/i.test(normalized);
  const parenStyleMatches = [...normalized.matchAll(/\((\d{1,2})\s+Styles?\)/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 8);
  const cutStyles = parenStyleMatches.length ? Math.max(...parenStyleMatches) : undefined;

  let multiplier = hasItalics ? 2 : 1;
  if (cutStyles && cutStyles > 1) multiplier *= cutStyles;

  const hint = weights * multiplier;
  if (hint > 0 && hint < 512) return hint;
  return undefined;
};

const normalizeToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const normalizeFamilyDisplay = (rawLabel: string, fallbackFamily: string): string => {
  const base = rawLabel.includes("-")
    ? rawLabel.slice(0, rawLabel.lastIndexOf("-"))
    : rawLabel;

  const expanded = base
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!expanded) return fallbackFamily;

  return expanded
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
};

const inferStyleAndWeight = (fontFamilyLabel: string): { style: "Normal" | "Italic"; weight: number } => {
  const stylePart = fontFamilyLabel.includes("-")
    ? fontFamilyLabel.slice(fontFamilyLabel.lastIndexOf("-") + 1)
    : fontFamilyLabel;
  const lower = stylePart.toLowerCase();

  const style: "Normal" | "Italic" = /italic|oblique|kursiv/.test(lower) ? "Italic" : "Normal";

  if (/hairline|thin/.test(lower)) return { style, weight: 100 };
  if (/extra-?light|ultra-?light/.test(lower)) return { style, weight: 200 };
  if (/light/.test(lower)) return { style, weight: 300 };
  if (/regular|book|normal/.test(lower)) return { style, weight: 400 };
  if (/medium/.test(lower)) return { style, weight: 500 };
  if (/semi-?bold|demi-?bold/.test(lower)) return { style, weight: 600 };
  if (/extra-?bold|ultra-?bold/.test(lower)) return { style, weight: 800 };
  if (/black|heavy/.test(lower)) return { style, weight: 900 };
  if (/bold/.test(lower)) return { style, weight: 700 };

  return { style, weight: 400 };
};

const extractLoadFontMappings = (html: string, targetUrl: string, fallbackFamily: string): FontMetadata[] => {
  const regex =
    /@font-face\s*\{[\s\S]*?font-family:\s*["']([^"']+)["'][\s\S]*?src:\s*url\(['"]?(\/load-font\/\d+)['"]?\)[\s\S]*?\}/gi;

  const deduped = new Map<string, FontMetadata>();
  const fallbackToken = normalizeToken(fallbackFamily);

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const fontFamilyLabel = String(match[1] || "").trim();
    const loadPath = String(match[2] || "").trim();
    if (!fontFamilyLabel || !loadPath) continue;

    // Ignore unrelated UI fonts if present.
    if (fallbackToken) {
      const labelToken = normalizeToken(fontFamilyLabel);
      if (labelToken && !labelToken.includes(fallbackToken)) {
        continue;
      }
    }

    const resolvedUrl = new URL(loadPath, targetUrl).href;
    const family = normalizeFamilyDisplay(fontFamilyLabel, fallbackFamily);
    const { style, weight } = inferStyleAndWeight(fontFamilyLabel);
    const key = `${fontFamilyLabel}|${resolvedUrl}`;

    if (!deduped.has(key)) {
      deduped.set(key, {
        url: resolvedUrl,
        family,
        format: "woff2",
        style,
        weight,
        downloadable: true,
        note: "A2 direct font endpoint mapping detected.",
        metadata: {
          pageUrl: targetUrl,
          foundry: "A2-TYPE",
          family,
          sourceFamilyLabel: fontFamilyLabel,
          format: "woff2",
          forceMetadataRepair: true,
          headers: {
            Origin: "https://a2-type.co.uk",
            Referer: targetUrl,
            Accept: "*/*"
          }
        }
      });
    }
  }

  const result = [...deduped.values()];
  result.sort((a, b) => {
    const aw = typeof a.weight === "number" ? a.weight : 400;
    const bw = typeof b.weight === "number" ? b.weight : 400;
    if (aw !== bw) return aw - bw;
    return String(a.style || "").localeCompare(String(b.style || ""));
  });
  return result;
};

const buildA2ProvocationScript = (familyName: string): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const probe = "Sphinx of black quartz, judge my vow 0123456789 !@#$%^&*()";
    
    // Target contenteditable fields in A2-Type's type tester
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"], [contenteditable]'));
    for (const field of editables) {
      try {
        field.textContent = probe;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("keyup", { bubbles: true }));
      } catch {}
    }

    // A2-Type often used specific selectors for font styles
    const styles = Array.from(document.querySelectorAll('.font-style, .style-selector, button[data-font]'));
    for (const style of styles) {
      try {
        style.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await sleep(150);
      } catch {}
    }

    window.scrollTo(0, document.body.scrollHeight / 2);
    await sleep(500);
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(500);

    window.__specimen_extraction_complete = true;

    window.__saka_extraction_complete = true;
  })();
`;

export const A2TypeScraper: Scraper = {
  id: "a2-type",
  name: "A2-TYPE Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)a2-type\.co\.uk/i.test(url) || url.includes("a2-type.co.uk");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const targetUrl = normalizeTargetUrl(url);

    try {
      const parsed = new URL(targetUrl);
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml"
        }
      });
      const html = await response.text();

      const title = extractTitle(html);
      const family = parsed.pathname === "/" ? "A2-TYPE" : extractFamilyFromTitle(title);
      const mappedFonts = extractLoadFontMappings(html, targetUrl, family);
      const expectedCount =
        mappedFonts.length > 0
          ? mappedFonts.length
          : (parsed.pathname === "/" ? undefined : extractExpectedCountHint(html));

      if (mappedFonts.length > 0) {
        return {
          scraperName: this.name,
          foundryName: "A2-TYPE",
          fonts: mappedFonts,
          originalUrl: url,
          targetUrl,
          expectedCount,
          masterFoundry: false
        };
      }

      return {
        scraperName: this.name,
        foundryName: "A2-TYPE",
        fonts: [
          {
            url: "browser-intercept",
            family,
            format: "woff2",
            style: "Normal",
            weight: "Regular",
            downloadable: true,
            note: "Capturing via Saka Engine.",
            metadata: {
              pageUrl: targetUrl,
              foundry: "A2-TYPE",
              family
            }
          }
        ],
        originalUrl: url,
        targetUrl,
        injectScript: buildA2ProvocationScript(family),
        masterFoundry: true,
        expectedCount
      };
    } catch (error) {
      console.error("[A2TypeScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "A2-TYPE",
        fonts: [],
        originalUrl: url,
        targetUrl
      };
    }
  }
};
