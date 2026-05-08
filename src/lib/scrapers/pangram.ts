import { Scraper, ScrapeResult } from "./scraper-protocol";

const toReadableFamily = (value: string): string =>
  value
    .split("-")
    .filter(Boolean)
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || "Pangram Font";

const PANGRAM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const extractPangramCollectionFamilyUrls = (
  html: string,
  origin: string,
  collectionSlug: string
): string[] => {
  const urls = new Set<string>();
  const patterns = [
    /href=["'](\/products\/[^"'?#]+)["']/gi,
    /\\"href\\"\s*:\s*\\"(\/products\/[^\\\"?#]+)\\"/gi
  ];
  const normalizedSlug = collectionSlug.toLowerCase();

  const add = (raw: string) => {
    if (!raw) return;
    const cleaned = raw.trim();
    try {
      const parsed = new URL(cleaned, origin);
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts[0] !== "products" || !pathParts[1]) return;
      const slug = pathParts[1].toLowerCase();
      if (slug === normalizedSlug) return;
      if (!slug.startsWith(`${normalizedSlug}-`)) return;
      urls.add(`${parsed.origin}/products/${slug}`);
    } catch {
      // ignore malformed URL
    }
  };

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      add(String(match[1] || ""));
    }
  }

  return Array.from(urls);
};

const decodePangramHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const normalizePangramStyleLabel = (value: string): string =>
  value
    .replace(/\bsemibld\b/gi, "Semibold")
    .replace(/\bextabold\b/gi, "Extrabold")
    .replace(/\bital\b/gi, "Italic")
    .replace(/\s+/g, " ")
    .trim();

const normalizePangramPostscriptName = (value: string): string => {
  let out = value.trim();
  out = out.replace(/_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, "");
  out = out.replace(/_[0-9a-f]{8}$/i, "");
  out = out.replace(/VariableVF$/i, "Variable");
  out = out.replace(/UprightVariable$/i, "Variable");
  out = out.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return out;
};

const normalizePangramToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const extractPangramSubfamilyVariant = (slug: string): string | undefined => {
  const match = slug.match(/-(condensed|narrow|normal)$/i);
  if (!match || !match[1]) return undefined;
  const token = match[1].toLowerCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
};

const applyPangramVariantPrefix = (styles: string[], variant?: string): string[] => {
  if (!variant) return styles;
  const variantToken = normalizePangramToken(variant);
  return styles.map((style) => {
    const cleaned = (style || "").trim();
    if (!cleaned) return cleaned;
    if (normalizePangramToken(cleaned).startsWith(variantToken)) return cleaned;
    return `${variant} ${cleaned}`;
  });
};

const extractPangramPostscriptNamesFromHtml = (html: string, familyPostscript: string): string[] => {
  const postscriptNames = new Set<string>();
  const familyToken = normalizePangramToken(familyPostscript);
  const patterns = [
    /https?:\/\/[^\s"'<>]+?\.(?:woff2|woff|ttf|otf)(?:\?[^\s"'<>]*)?/gi,
    /["'](\/\/[^"'\\s<>]+\.(?:woff2|woff|ttf|otf)(?:\?[^"'\\s<>]*)?)["']/gi,
    /["'](\/cdn\/shop\/[^"'\\s<>]+\.(?:woff2|woff|ttf|otf)(?:\?[^"'\\s<>]*)?)["']/gi,
    /\\?"(\/\/[^"\\]+\.(?:woff2|woff|ttf|otf)(?:\?[^"\\]*)?)\\?"/gi,
    /\\?"(\/cdn\/shop\/[^"\\]+\.(?:woff2|woff|ttf|otf)(?:\?[^"\\]*)?)\\?"/gi
  ];

  const addCandidate = (rawValue: string) => {
    if (!rawValue) return;
    try {
      const resolved = /^https?:\/\//i.test(rawValue)
        ? new URL(rawValue)
        : new URL(rawValue, "https://pangrampangram.com");
      const fileName = resolved.pathname.split("/").pop() || "";
      const stem = fileName.replace(/\.[^.]+$/, "");
      const normalized = normalizePangramPostscriptName(stem);
      if (!normalized) return;
      const normalizedToken = normalizePangramToken(normalized);
      if (familyToken && !normalizedToken.startsWith(familyToken)) return;
      postscriptNames.add(normalized);
    } catch {
      // ignore malformed candidates
    }
  };

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      addCandidate(String(match[1] || match[0] || ""));
    }
  }

  return Array.from(postscriptNames).sort();
};

const toPangramPostscriptFamily = (slug: string): string => {
  const cleaned = slug
    .replace(/^pp-/i, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) return "PangramFont";
  return `PP${cleaned
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("")}`;
};

const extractPangramExpectedStyles = (html: string): string[] => {
  const styleHint =
    /(thin|extra|ultra|light|book|regular|medium|semi|demi|bold|black|heavy|italic|text|display|upright|slanted)/i;
  const pricingHint =
    /(\+\$|up to|workstation|pageviews|followers|impressions|employees|license|not selected|company size|checkout|cart)/i;
  const bundleHint = /(family|collection|essential|styles?\s*\+|variables?)/i;
  const styles = new Set<string>();

  for (const match of html.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)) {
    const raw = String(match[1] || "");
    if (!raw) continue;
    const text = decodePangramHtmlEntities(raw.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    if (pricingHint.test(text)) continue;
    if (bundleHint.test(text)) continue;
    if (!styleHint.test(text)) continue;
    styles.add(normalizePangramStyleLabel(text));
  }

  return Array.from(styles);
};

const extractPangramPdfUrlsFromHtml = (html: string, pageUrl: string): string[] => {
  const out = new Set<string>();
  const add = (raw: string) => {
    if (!raw) return;
    const decoded = decodePangramHtmlEntities(raw.trim().replace(/\\\//g, "/"));
    try {
      const resolved = /^https?:\/\//i.test(decoded)
        ? new URL(decoded)
        : decoded.startsWith("//")
          ? new URL(`https:${decoded}`)
          : new URL(decoded, pageUrl);
      if (!/\.pdf(?:$|\?)/i.test(resolved.href)) return;
      out.add(resolved.href);
    } catch {
      // ignore malformed candidates
    }
  };

  const patterns = [
    /https?:\/\/[^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?/gi,
    /["'](\/\/[^"'<>]+?\.pdf(?:\?[^"'<>]*)?)["']/gi,
    /["'](\/[^"'<>]+?\.pdf(?:\?[^"'<>]*)?)["']/gi,
    /\\"(https?:\/\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi,
    /\\"(\/\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi,
    /\\"(\/[^\\"]+?\.pdf(?:\?[^\\"]*)?)\\"/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      add(String(match[1] || match[0] || ""));
    }
  }

  return Array.from(out);
};

const buildPangramInjectScript = (familyName: string): string => {
  const familyToken = familyName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const token = "${familyToken}";
      const styleHint = /(thin|extra|ultra|light|book|regular|medium|semi|demi|bold|black|heavy|italic|text|display|variable|upright|slanted)/i;
      const moneyHint = /(\\+\\$|up to|workstation|pageviews|followers|impressions|employees|not selected|license)/i;
      const probe = "Sphinx of black quartz, judge my vow 0123456789 !@#$%^&*()";
      const normalize = (value) => (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

      const editable = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [contenteditable]'));
      for (const field of editable) {
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
      for (const sel of selects) {
        const options = Array.from(sel.options || []);
        if (options.length < 4) continue;

        const styleOptions = options.filter((opt) => {
          const label = (opt.textContent || "").trim();
          if (!label || opt.disabled) return false;
          if (moneyHint.test(label)) return false;
          return styleHint.test(label);
        });
        if (styleOptions.length < 4) continue;

        const shouldPrioritizeToken = options.some((opt) => normalize(opt.textContent || "").includes(token));
        const candidateOptions = shouldPrioritizeToken
          ? styleOptions.filter((opt) => normalize(opt.textContent || "").includes(token) || styleHint.test(opt.textContent || ""))
          : styleOptions;

        for (const opt of candidateOptions.slice(0, 48)) {
          try {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("input", { bubbles: true }));
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            sel.dispatchEvent(new Event("blur", { bubbles: true }));
            await sleep(140);
          } catch {}
        }
      }

      const allowedButton = /(text|display|standard|upright|italic|variable|style|weight|preview|try)/i;
      const blockedButton = /(buy|cart|checkout|add|license|workstation|pageviews|followers|impressions|employees|contact|faq|menu|search)/i;
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const btn of buttons) {
        const label = ((btn.textContent || "") + " " + (btn.getAttribute("aria-label") || "")).trim();
        if (!label) continue;
        if (blockedButton.test(label)) continue;
        if (!allowedButton.test(label)) continue;
        try {
          btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          btn.click();
          await sleep(180);
        } catch {}
      }

      for (let pass = 1; pass <= 5; pass++) {
        window.scrollTo(0, Math.floor((document.body.scrollHeight * pass) / 5));
        await sleep(300);
      }
      window.scrollTo(0, 0);
      await sleep(700);

      console.log("[SPECIMEN] Provokasi Selesai");
      window.__specimen_extraction_complete = true;
      window.__specimen_extraction_complete = true;
    })();
  `;
};

type PangramStyleDescriptor = {
  styleName: string;
  weight: string;
  style: "Normal" | "Italic";
  fileStem: string;
};

const escapePangramRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripPangramVariantPrefix = (styleLabel: string, variant?: string): string => {
  if (!variant) return styleLabel;
  const pattern = new RegExp(`^${escapePangramRegExp(variant)}\\s+`, "i");
  return styleLabel.replace(pattern, "").trim();
};

const buildPangramStyleDescriptor = (styleLabel: string, variant?: string): PangramStyleDescriptor => {
  const normalized = normalizePangramStyleLabel(styleLabel);
  const core = stripPangramVariantPrefix(normalized, variant);
  const isItalic = /(?:^|\s)italic$/i.test(core);
  const weight = (isItalic ? core.replace(/(?:^|\s)italic$/i, "") : core).trim() || "Regular";
  const fileLabel = weight === "Italic" ? "Regular Italic" : isItalic ? `${weight} Italic` : weight;
  return {
    styleName: normalized,
    weight,
    style: isItalic ? "Italic" : "Normal",
    fileStem: fileLabel.replace(/\s+/g, "")
  };
};

const isPangramCoreStyle = (styleLabel: string): boolean => !/^text\b/i.test(styleLabel.trim());

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const probePangramDirectAsset = async (url: string): Promise<boolean> => {
  const headers: HeadersInit = {
    "User-Agent": PANGRAM_UA,
    Accept: "*/*"
  };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { ...headers, Range: "bytes=0-0" },
        redirect: "follow",
        signal: controller.signal
      });
      if (response.ok || response.status === 206) return true;
      if (response.status === 403 || response.status === 405 || response.status === 416) {
        const headResponse = await fetch(url, {
          method: "HEAD",
          headers,
          redirect: "follow",
          signal: controller.signal
        });
        if (headResponse.ok) return true;
      }
    } catch {
      // retry
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 3) await sleep(240 * attempt);
  }
  return false;
};

const buildPangramDirectFonts = async (params: {
  familyName: string;
  familyPostscript: string;
  normalizedTargetUrl: string;
  expectedStyles: string[];
  targetProfile: Record<string, unknown>;
  specimenPdfUrls: string[];
  variant?: string;
}): Promise<any[]> => {
  const { familyName, familyPostscript, normalizedTargetUrl, expectedStyles, targetProfile, specimenPdfUrls, variant } = params;
  const fonts: any[] = [];
  const seenUrls = new Set<string>();

  const pushIfReachable = async (descriptor: PangramStyleDescriptor | null, url: string) => {
    if (!descriptor || seenUrls.has(url)) return;
    if (!(await probePangramDirectAsset(url))) return;
    seenUrls.add(url);
    fonts.push({
      url,
      family: familyName,
      format: "woff2",
      weight: descriptor.weight,
      style: descriptor.style,
      downloadable: true,
      note: "Verified Pangram direct asset.",
      metadata: {
        pageUrl: normalizedTargetUrl,
        targetUrl: normalizedTargetUrl,
        foundry: "Pangram Pangram",
        family: familyName,
        familyPostscript,
        styleName: descriptor.styleName,
        fullName: `${familyName} ${descriptor.styleName}`,
        forceMetadataRepair: true,
        specimenPdfUrls,
        targetProfile
      }
    });
  };

  await pushIfReachable(
    {
      styleName: "Variable",
      weight: "Variable",
      style: "Normal",
      fileStem: "Variable"
    },
    `https://files.pangrampangram.com/fonts/${familyPostscript}-Variable.woff2`
  );

  const coreExpectedStyles = expectedStyles.filter((style) => isPangramCoreStyle(style) && !/variable/i.test(style));
  for (const styleLabel of coreExpectedStyles) {
    const descriptor = buildPangramStyleDescriptor(styleLabel, variant);
    await pushIfReachable(
      descriptor,
      `https://files.pangrampangram.com/fonts/${familyPostscript}-${descriptor.fileStem}.woff2`
    );
  }

  return fonts;
};

export const PangramScraper: Scraper = {
  id: "pangram",
  name: "Pangram Pangram Scraper",

  canHandle(url: string): boolean {
    return url.includes("pangram");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      const productsIdx = pathParts.indexOf("products");
      let normalizedTargetUrl = url;
      let familySlug = pathParts.length > 0 ? pathParts[pathParts.length - 1] : "";
      let collectionFamilyUrls: string[] = [];
      let expectedStyles: string[] = [];
      let specimenPdfUrls: string[] = [];
      const expectedPostscriptNames = new Set<string>();

      if (productsIdx >= 0 && pathParts[productsIdx + 1]) {
        familySlug = pathParts[productsIdx + 1];
        const canonicalSlug = familySlug.replace(/^pp-/i, "");
        normalizedTargetUrl = `${urlObj.origin}/products/${canonicalSlug}`;
        familySlug = canonicalSlug;
      }
      const familyName = toReadableFamily(familySlug || "pangram-font");
      const familyPostscript = toPangramPostscriptFamily(familySlug || "pangram-font");
      const subfamilyVariant = extractPangramSubfamilyVariant(familySlug || "");

      try {
        const response = await fetch(normalizedTargetUrl, {
          headers: { "User-Agent": PANGRAM_UA }
        });
        if (response.ok) {
          const html = await response.text();
          collectionFamilyUrls = extractPangramCollectionFamilyUrls(html, urlObj.origin, familySlug);
          expectedStyles = applyPangramVariantPrefix(extractPangramExpectedStyles(html), subfamilyVariant);
          specimenPdfUrls = extractPangramPdfUrlsFromHtml(html, normalizedTargetUrl).filter((pdfUrl) => {
            const token = normalizePangramToken(pdfUrl);
            return token.includes(normalizePangramToken(familySlug)) || token.includes(normalizePangramToken(familyPostscript));
          });
          for (const postscript of extractPangramPostscriptNamesFromHtml(html, familyPostscript)) {
            expectedPostscriptNames.add(postscript);
          }
        }
      } catch {
        // best effort only
      }

      for (const familyUrl of collectionFamilyUrls.slice(0, 8)) {
        try {
          const response = await fetch(familyUrl, {
            headers: { "User-Agent": PANGRAM_UA }
          });
          if (!response.ok) continue;
          const html = await response.text();
          for (const postscript of extractPangramPostscriptNamesFromHtml(html, familyPostscript)) {
            expectedPostscriptNames.add(postscript);
          }
        } catch {
          // best effort only
        }
      }

      const collectionFamilySlugs = collectionFamilyUrls
        .map((familyUrl) => {
          try {
            const parsed = new URL(familyUrl);
            const parts = parsed.pathname.split("/").filter(Boolean);
            return parts[1] || "";
          } catch {
            return "";
          }
        })
        .filter(Boolean);

      const coreExpectedStyles = expectedStyles.filter((style) => isPangramCoreStyle(style));
      const optionalExcludedStyles = expectedStyles.filter((style) => !isPangramCoreStyle(style));

      const targetProfile = {
        profileId: "pangram-target-profile-v2",
        foundry: "Pangram Pangram",
        targetUrl: normalizedTargetUrl,
        targetSlug: familySlug || undefined,
        familyDisplay: familyName,
        familyPostscript,
        expectedStyles: coreExpectedStyles,
        optionalExcludedStyles,
        expectedPostscriptNames: Array.from(expectedPostscriptNames),
        expectedPostscriptCount: expectedPostscriptNames.size,
        expectedStyleCount: coreExpectedStyles.length,
        collectionFamilies: collectionFamilySlugs,
        specimenPdfUrls,
        collectedAt: new Date().toISOString(),
        source: "html-option-scan"
      };

      const directFonts = await buildPangramDirectFonts({
        familyName,
        familyPostscript,
        normalizedTargetUrl,
        expectedStyles: coreExpectedStyles,
        targetProfile,
        specimenPdfUrls,
        variant: subfamilyVariant
      });

      const expectedCount =
        directFonts.length > 0
          ? directFonts.length
          : expectedPostscriptNames.size > 0
            ? expectedPostscriptNames.size
            : expectedStyles.length > 0
              ? expectedStyles.length
              : collectionFamilySlugs.length > 0
                ? collectionFamilySlugs.length * 10
                : (familyName.toLowerCase().includes("frama") ? 28 : undefined);

      return {
        scraperName: this.name,
        foundryName: "Pangram Pangram",
        fonts: directFonts.length > 0
          ? directFonts
          : [
              {
                url: "browser-intercept",
                family: familyName,
                format: "woff2",
                weight: "Regular",
                style: "Normal",
                downloadable: true,
                note: "Ekstraksi melalui intersepsi browser.",
                metadata: {
                  pageUrl: normalizedTargetUrl,
                  collection: collectionFamilySlugs.length > 0 ? familySlug : undefined,
                  collectionFamilies: collectionFamilySlugs,
                  collectionFamilyUrls,
                  specimenPdfUrls,
                  targetProfile
                }
              }
            ],
        originalUrl: url,
        targetUrl: normalizedTargetUrl,
        injectScript: buildPangramInjectScript(familyName),
        expectedCount,
        metadata: {
          targetProfile,
          collectionFamilyUrls,
          collectionFamilies: collectionFamilySlugs,
          specimenPdfUrls
        }
      };
    } catch (e) {
      console.error("Pangram Scraper Error:", e);
      return {
        scraperName: this.name,
        foundryName: "Pangram Pangram",
        fonts: [],
        originalUrl: url
      };
    }
  }
};

