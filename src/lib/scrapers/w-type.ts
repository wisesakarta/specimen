import { FontMetadata, ScrapeResult, Scraper } from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const formatPriority: Record<FontMetadata["format"], number> = {
  woff2: 4,
  woff: 3,
  ttf: 2,
  otf: 1,
  eot: 0,
  zip: 0
};

const toTitle = (value: string): string =>
  value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "W Type Font";

const normalizeTargetUrl = (rawUrl: string): URL => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  parsed.hostname = "wtypefoundry.com";
  if (parsed.pathname.includes("/typeface/")) {
    parsed.pathname = parsed.pathname.replace("/typeface/", "/typefaces/");
  }
  return parsed;
};

const extractFamilySlug = (targetUrl: URL): string => {
  const parts = targetUrl.pathname.split("/").filter(Boolean);
  const typefacesIdx = parts.indexOf("typefaces");
  if (typefacesIdx >= 0 && parts[typefacesIdx + 1]) {
    return parts[typefacesIdx + 1].toLowerCase();
  }
  return (parts[parts.length - 1] || "wtype-font").toLowerCase();
};

const detectFormat = (value: string): FontMetadata["format"] => {
  const lower = value.toLowerCase();
  if (lower.includes("woff2")) return "woff2";
  if (lower.includes("woff")) return "woff";
  if (lower.includes("opentype") || lower.includes(".otf")) return "otf";
  return "ttf";
};

const detectStyle = (value: string): "normal" | "italic" =>
  /italic/i.test(value) ? "italic" : "normal";

const detectWeight = (value: string): number => {
  const lower = value.toLowerCase();
  if (/thin/.test(lower)) return 100;
  if (/ultralight|extra-?light/.test(lower)) return 200;
  if (/normal|light/.test(lower)) return 300;
  if (/regular|roman/.test(lower)) return 400;
  if (/medium/.test(lower)) return 500;
  if (/semi-?bold|demi-?bold/.test(lower)) return 600;
  if (/ultra-?bold|extra-?bold/.test(lower)) return 800;
  if (/black|heavy/.test(lower)) return 900;
  if (/bold/.test(lower)) return 700;
  return 400;
};

const parseFontFaceCss = (cssText: string, cssUrl: string): FontMetadata[] => {
  const fonts: FontMetadata[] = [];
  const blocks = cssText.split(/@font-face\s*\{/gi).slice(1);
  const deduped = new Map<string, FontMetadata>();

  for (const blockRaw of blocks) {
    const block = blockRaw.split("}")[0] || blockRaw;
    const familyMatch = block.match(/font-family:\s*['"]?([^;'"]+)['"]?/i);
    if (!familyMatch) continue;

    const family = familyMatch[1].trim();
    const style = (block.match(/font-style:\s*(normal|italic)/i)?.[1] || "normal").toLowerCase();
    const weightText = block.match(/font-weight:\s*(\d{2,3}|normal|bold)/i)?.[1] || "400";
    const weight =
      weightText === "normal"
        ? 400
        : weightText === "bold"
          ? 700
          : Number(weightText) || 400;

    const srcParts = [...block.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)\s*format\(\s*['"]?([^'")]+)['"]?\s*\)/gi)];
    if (srcParts.length === 0) continue;

    let bestUrl: string | null = null;
    let bestFormat: FontMetadata["format"] = "ttf";
    let bestScore = -1;

    for (const src of srcParts) {
      const rawUrl = src[1];
      const rawFormat = src[2] || "";
      const format = detectFormat(rawFormat || rawUrl);
      const score = formatPriority[format];
      if (score > bestScore) {
        bestScore = score;
        bestFormat = format;
        bestUrl = new URL(rawUrl, cssUrl).href;
      }
    }

    if (!bestUrl) continue;

    const key = `${family.toLowerCase()}|${weight}|${style}`;
    deduped.set(key, {
      url: bestUrl,
      family,
      format: bestFormat,
      style: style as "normal" | "italic",
      weight,
      downloadable: true,
      note: "Parsed from W Type fontface.css",
      metadata: { pageUrl: cssUrl, foundry: "W Type Foundry", family }
    });
  }

  for (const font of deduped.values()) {
    fonts.push(font);
  }

  return fonts.sort((a, b) => {
    const familyCompare = (a.family || "").localeCompare(b.family || "");
    if (familyCompare !== 0) return familyCompare;
    const weightA = typeof a.weight === "number" ? a.weight : Number(a.weight || 400);
    const weightB = typeof b.weight === "number" ? b.weight : Number(b.weight || 400);
    if (weightA !== weightB) return weightA - weightB;
    return String(a.style || "normal").localeCompare(String(b.style || "normal"));
  });
};

const parseDirectFontUrlsFromHtml = (html: string, targetUrl: URL, familyName: string): FontMetadata[] => {
  const matches = [...html.matchAll(/value="(https?:\/\/wtypefoundry\.com\/typefaces\/[^"]+\/fonts\/[^"]+\.(?:woff2?|ttf|otf)(?:\?[^"]*)?)"/gi)];
  const deduped = new Map<string, FontMetadata>();

  for (const match of matches) {
    const directUrl = match[1];
    const fileName = decodeURIComponent(new URL(directUrl).pathname.split("/").pop() || "");
    const stem = fileName.replace(/\.(woff2?|ttf|otf)$/i, "");

    deduped.set(directUrl, {
      url: directUrl,
      family: familyName,
      format: detectFormat(fileName),
      style: detectStyle(stem),
      weight: detectWeight(stem),
      downloadable: true,
      note: "Parsed from W Type HTML value URLs",
      metadata: { pageUrl: targetUrl.href, foundry: "W Type Foundry", family: familyName }
    });
  }

  return [...deduped.values()];
};

const buildWTypeInjectScript = (familyName: string): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const token = ${JSON.stringify(familyName.toLowerCase().replace(/[^a-z0-9]+/g, ""))};
    const probe = "Sphinx of black quartz, judge my vow 0123456789 !@#$%^&*()";
    const norm = (v) => (v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

    const styleButtons = Array.from(document.querySelectorAll('[data-font], [data-style], [data-stylename], .dropdown-item, button, a'));
    for (const node of styleButtons) {
      const haystack = norm(node.getAttribute && node.getAttribute("data-font")) +
        norm(node.getAttribute && node.getAttribute("data-style")) +
        norm(node.getAttribute && node.getAttribute("data-stylename")) +
        norm(node.textContent || "");
      if (!haystack) continue;
      if (token && !haystack.includes(token) && !haystack.includes("italic") && !haystack.includes("regular") && !haystack.includes("bold")) continue;
      try {
        node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      } catch {}
      await sleep(120);
    }

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

    window.scrollTo(0, document.body.scrollHeight);
    await sleep(600);
    window.__saka_extraction_complete = true;
  })();
`;

export const WTypeScraper: Scraper = {
  id: "w-type",
  name: "W Type Foundry",

  canHandle(url: string): boolean {
    return url.includes("wtypefoundry.com");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const targetUrl = normalizeTargetUrl(url);
      const familySlug = extractFamilySlug(targetUrl);
      const familyName = toTitle(familySlug);

      const pageResponse = await fetch(targetUrl.href, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml"
        }
      });
      const html = await pageResponse.text();

      const fontfaceMatch = html.match(/href="([^"]*fontface\.css[^"]*)"/i);
      if (fontfaceMatch && fontfaceMatch[1]) {
        const fontfaceUrl = new URL(fontfaceMatch[1], targetUrl.href).href;
        const cssResponse = await fetch(fontfaceUrl, {
          headers: { "User-Agent": BROWSER_UA, Accept: "text/css,*/*;q=0.1" }
        });
        const cssText = await cssResponse.text();
        const parsedFonts = parseFontFaceCss(cssText, fontfaceUrl).map((font) => ({
          ...font,
          metadata: {
            ...(font.metadata || {}),
            pageUrl: targetUrl.href,
            foundry: "W Type Foundry"
          }
        }));

        if (parsedFonts.length > 0) {
          return {
            scraperName: this.name,
            foundryName: "W Type Foundry",
            fonts: parsedFonts,
            originalUrl: url,
            targetUrl: targetUrl.href,
            expectedCount: parsedFonts.length
          };
        }
      }

      const fallbackFonts = parseDirectFontUrlsFromHtml(html, targetUrl, familyName);
      if (fallbackFonts.length > 0) {
        return {
          scraperName: this.name,
          foundryName: "W Type Foundry",
          fonts: fallbackFonts,
          originalUrl: url,
          targetUrl: targetUrl.href,
          expectedCount: fallbackFonts.length
        };
      }

      const styleHints = new Set<string>();
      for (const match of html.matchAll(/data-font="([^"]+)"/gi)) {
        styleHints.add(match[1]);
      }

      return {
        scraperName: this.name,
        foundryName: "W Type Foundry",
        fonts: [
          {
            url: "browser-intercept",
            family: familyName,
            format: "woff2",
            weight: "Regular",
            style: "Normal",
            downloadable: true,
            note: "Fallback browser intercept for dynamic type tester."
          }
        ],
        originalUrl: url,
        targetUrl: targetUrl.href,
        expectedCount: styleHints.size > 0 ? styleHints.size : undefined,
        injectScript: buildWTypeInjectScript(familyName),
        metadata: {
          bypassWhitelist: true
        }
      };
    } catch (error) {
      console.error("[WTypeScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "W Type Foundry",
        fonts: [],
        originalUrl: url
      };
    }
  }
};
