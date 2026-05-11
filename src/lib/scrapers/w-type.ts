import { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

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

const WTYPE_WIDTH_PREFIXES = [
  ["compressed", "Compressed"],
  ["condensed", "Condensed"],
  ["expanded", "Expanded"],
  ["wide", "Wide"]
] as const;

const toTitle = (value: string): string =>
  value
    .split("-")
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
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

const detectWeight = (value: string): number => {
  const lower = value.toLowerCase().replace(/\s+/g, "");
  if (/thin|hairline/.test(lower)) return 100;
  if (/ultralight|extralight/.test(lower)) return 200;
  if (/light/.test(lower)) return 300;
  if (/normal|regular|roman/.test(lower)) return 400;
  if (/medium/.test(lower)) return 500;
  if (/semibold|demibold/.test(lower)) return 600;
  if (/ultrabold|extrabold/.test(lower)) return 800;
  if (/black|heavy/.test(lower)) return 900;
  if (/bold/.test(lower)) return 700;
  return 400;
};

const extractPdfLinks = (html: string, pageUrl: string): string[] => {
  const hits = new Set<string>();
  for (const match of html.matchAll(/(?:https?:\/\/|\/\/|\/)[^"'<>\\\s]+?\.pdf(?:\?[^"'<>\\\s]*)?/gi)) {
    const raw = String(match[0] || "").replace(/\\\//g, "/").trim();
    if (!raw) continue;
    try {
      const resolved = /^https?:\/\//i.test(raw)
        ? new URL(raw)
        : raw.startsWith("//")
          ? new URL(`https:${raw}`)
          : new URL(raw, pageUrl);
      hits.add(resolved.href);
    } catch {
      // best effort
    }
  }
  return Array.from(hits);
};

const buildWTypeStyleDescriptor = (
  assetUrl: string,
  familyName: string
): { styleName: string; fullName: string; style: "normal" | "italic"; weight: number } => {
  const fileName = decodeURIComponent(new URL(assetUrl).pathname.split("/").pop() || "");
  const stem = fileName.replace(/\.(woff2?|ttf|otf)$/i, "");
  const familyToken = familyName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  let token = stem.toLowerCase()
    .replace(/^wtfforma[-_]?/i, "")
    .replace(new RegExp(`^${familyToken}[-_]?`), "");
  let widthLabel = "";

  for (const [prefix, label] of WTYPE_WIDTH_PREFIXES) {
    if (!token.startsWith(prefix)) continue;
    widthLabel = label;
    token = token.slice(prefix.length);
    break;
  }

  const italic = token.endsWith("italic");
  if (italic) token = token.slice(0, -6);

  let weightLabel = "Regular";
  if (token === "thin" || token === "hairline") weightLabel = "Thin";
  else if (token === "ultralight" || token === "extralight") weightLabel = "Ultra Light";
  else if (token === "light") weightLabel = "Light";
  else if (token === "normal") weightLabel = "Normal";
  else if (token === "regular" || token === "roman") weightLabel = "Regular";
  else if (token === "medium") weightLabel = "Medium";
  else if (token === "semibold" || token === "demibold") weightLabel = "Semibold";
  else if (token === "ultrabold" || token === "extrabold") weightLabel = "Ultra Bold";
  else if (token === "black") weightLabel = "Black";
  else if (token === "heavy") weightLabel = "Heavy";
  else if (token === "bold") weightLabel = "Bold";

  let styleName = [widthLabel, weightLabel].filter(Boolean).join(" ").trim() || "Regular";
  if (italic) {
    if (styleName === "Regular" || styleName === "Normal") styleName = "Italic";
    else if (styleName.endsWith(" Regular")) styleName = styleName.replace(/ Regular$/i, " Italic");
    else styleName = `${styleName} Italic`;
  }

  return {
    styleName,
    fullName: `${familyName} ${styleName}`.replace(/\s+/g, " ").trim(),
    style: italic ? "italic" : "normal",
    weight: detectWeight(styleName)
  };
};

const parseFontFaceCss = (
  cssText: string,
  cssUrl: string,
  pageUrl: string,
  familyName: string,
  specimenPdfUrls: string[]
): FontMetadata[] => {
  const fonts: FontMetadata[] = [];
  const blocks = cssText.split(/@font-face\s*\{/gi).slice(1);
  const deduped = new Map<string, FontMetadata>();

  for (const blockRaw of blocks) {
    const block = blockRaw.split("}")[0] || blockRaw;
    const familyMatch = block.match(/font-family:\s*['"]?([^;'"\n]+)['"]?/i);
    if (!familyMatch) continue;

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
    const descriptor = buildWTypeStyleDescriptor(bestUrl, familyName);
    const key = `${descriptor.styleName.toLowerCase()}|${bestUrl.toLowerCase()}`;
    deduped.set(key, {
      url: bestUrl,
      family: familyName,
      format: bestFormat,
      style: descriptor.style,
      weight: descriptor.weight,
      downloadable: true,
      note: "Parsed from W Type fontface.css",
      metadata: {
        pageUrl,
        foundry: "W Type Foundry",
        family: familyName,
        styleName: descriptor.styleName,
        fullName: descriptor.fullName,
        specimenPdfUrls,
        forceMetadataRepair: true
      }
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

const parseDirectFontUrlsFromHtml = (
  html: string,
  targetUrl: URL,
  familyName: string,
  specimenPdfUrls: string[]
): FontMetadata[] => {
  const matches = [...html.matchAll(/value="(https?:\/\/wtypefoundry\.com\/typefaces\/[^\"]+\/fonts\/[^\"]+\.(?:woff2?|ttf|otf)(?:\?[^\"]*)?)"/gi)];
  const deduped = new Map<string, FontMetadata>();

  for (const match of matches) {
    const directUrl = match[1];
    const descriptor = buildWTypeStyleDescriptor(directUrl, familyName);

    deduped.set(directUrl, {
      url: directUrl,
      family: familyName,
      format: detectFormat(directUrl),
      style: descriptor.style,
      weight: descriptor.weight,
      downloadable: true,
      note: "Parsed from W Type HTML value URLs",
      metadata: {
        pageUrl: targetUrl.href,
        foundry: "W Type Foundry",
        family: familyName,
        styleName: descriptor.styleName,
        fullName: descriptor.fullName,
        specimenPdfUrls,
        forceMetadataRepair: true
      }
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
    window.__specimen_extraction_complete = true;
    window.__specimen_extraction_complete = true;
  })();
`;

const buildWTypeFallbackResult = (rawUrl: string, reason: unknown): ScrapeResult => {
  const targetUrl = normalizeTargetUrl(rawUrl);
  const familySlug = extractFamilySlug(targetUrl);
  const familyName = toTitle(familySlug);
  const expectedAssetTokens = Array.from(
    new Set(
      [familySlug, familyName, familySlug.replace(/[^a-z0-9]+/gi, "")]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
  const targetProfile = {
    profileId: "wtype-target-profile-fallback-v1",
    foundry: "W Type Foundry",
    familyDisplay: familyName,
    familySlug,
    targetUrl: targetUrl.href,
    source: "wtypefoundry-browser-intercept-fallback",
    styleScope: "style",
    strictMissingStyles: false,
    expectedStyles: [],
    expectedAssetTokens
  };

  return {
    scraperName: WTypeScraper.name,
    foundryName: "W Type Foundry",
    fonts: [
      {
        url: "browser-intercept",
        family: familyName,
        format: "woff2",
        weight: "Regular",
        style: "Normal",
        downloadable: true,
        note: "W Type browser-intercept fallback.",
        metadata: {
          foundry: "W Type Foundry",
          family: familyName,
          pageUrl: targetUrl.href,
          targetUrl: targetUrl.href,
          targetProfile,
          fallbackReason: reason instanceof Error ? reason.message : String(reason)
        }
      }
    ],
    originalUrl: rawUrl,
    targetUrl: targetUrl.href,
    injectScript: buildWTypeInjectScript(familyName),
    expectedCount: 1,
    metadata: {
      bypassWhitelist: true,
      targetProfile,
      fallbackReason: reason instanceof Error ? reason.message : String(reason)
    }
  };
};

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
      const specimenPdfUrls = extractPdfLinks(html, targetUrl.href);

      const fontfaceMatch = html.match(/href="([^"]*fontface\.css[^"]*)"/i);
      if (fontfaceMatch && fontfaceMatch[1]) {
        const fontfaceUrl = new URL(fontfaceMatch[1], targetUrl.href).href;
        const cssResponse = await fetch(fontfaceUrl, {
          headers: { "User-Agent": BROWSER_UA, Accept: "text/css,*/*;q=0.1" }
        });
        const cssText = await cssResponse.text();
        const parsedFonts = parseFontFaceCss(cssText, fontfaceUrl, targetUrl.href, familyName, specimenPdfUrls);
        const expectedStyles = Array.from(
          new Set(
            parsedFonts
              .map((font) => (typeof font.metadata?.styleName === "string" ? font.metadata.styleName.trim() : ""))
              .filter(Boolean)
          )
        );

        if (parsedFonts.length > 0) {
          return {
            scraperName: this.name,
            foundryName: "W Type Foundry",
            fonts: parsedFonts,
            originalUrl: url,
            targetUrl: targetUrl.href,
            expectedCount: parsedFonts.length,
            metadata: {
              targetProfile: {
                profileId: "wtype-target-profile-v2",
                foundry: "W Type Foundry",
                familyDisplay: familyName,
                styleScope: "style",
                expectedStyles,
                specimenPdfUrls,
                source: "wtypefoundry.com",
                strictMissingStyles: false
              }
            }
          };
        }
      }

      const fallbackFonts = parseDirectFontUrlsFromHtml(html, targetUrl, familyName, specimenPdfUrls);
      if (fallbackFonts.length > 0) {
        const expectedStyles = Array.from(
          new Set(
            fallbackFonts
              .map((font) => (typeof font.metadata?.styleName === "string" ? font.metadata.styleName.trim() : ""))
              .filter(Boolean)
          )
        );
        return {
          scraperName: this.name,
          foundryName: "W Type Foundry",
          fonts: fallbackFonts,
          originalUrl: url,
          targetUrl: targetUrl.href,
          expectedCount: fallbackFonts.length,
          metadata: {
            targetProfile: {
              profileId: "wtype-target-profile-v2",
              foundry: "W Type Foundry",
              familyDisplay: familyName,
              styleScope: "style",
              expectedStyles,
              specimenPdfUrls,
              source: "wtypefoundry.com",
              strictMissingStyles: false
            }
          }
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
          bypassWhitelist: true,
          targetProfile: {
            profileId: "wtype-target-profile-v2",
            foundry: "W Type Foundry",
            familyDisplay: familyName,
            styleScope: "style",
            specimenPdfUrls,
            source: "wtypefoundry.com",
            strictMissingStyles: false
          }
        }
      };
    } catch (error) {
      console.error("[WTypeScraper] Error:", error);
      return buildWTypeFallbackResult(url, error);
    }
  }
};
