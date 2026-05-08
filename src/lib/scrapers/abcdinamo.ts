import { Scraper, ScrapeResult, FontMetadata } from "./scraper-protocol";

const DINAMO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const DINAMO_FONT_LIST_CSS_URL = "https://abcdinamo.com/fonts/font-list-css";
const DINAMO_STATIC_LIST_URL = "https://abcdinamo.com/fonts/static-list";
const DINAMO_VARIABLE_LIST_URL = "https://abcdinamo.com/fonts/variable-list";
const DINAMO_OPTIONAL_STYLE_QUALIFIERS = new Set<string>(["mix"]);
const DINAMO_FETCH_TIMEOUT_MS = 45000;
const DINAMO_FETCH_MAX_RETRIES = 3;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeToken = (value: string): string =>
  String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const toTitleWords = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

const toReadableFamilyFromSlug = (slug: string): string =>
  slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Dinamo";

const toCanonicalDinamoStyle = (value: string): string => {
  const titled = toTitleWords(value || "") || "Regular";
  return titled
    .replace(/\bNormal\b/gi, "Regular")
    .replace(/\s+/g, " ")
    .trim();
};

const normalizeTargetUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    parsed.protocol = "https:";
    parsed.hostname = "abcdinamo.com";
    return parsed.href;
  } catch {
    return rawUrl;
  }
};

const extractDinamoFamilySlug = (targetUrl: string): string | undefined => {
  try {
    const parsed = new URL(targetUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((segment) => segment.toLowerCase() === "typefaces");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1].toLowerCase();
    return undefined;
  } catch {
    return undefined;
  }
};

const inferWeightFromStyle = (styleName: string): string | number | undefined => {
  const token = normalizeToken(styleName);
  if (/hairline/.test(token)) return "Hairline";
  if (/thin/.test(token)) return "Thin";
  if (/extralight|ultralight/.test(token)) return "ExtraLight";
  if (/light/.test(token)) return "Light";
  if (/book/.test(token)) return "Book";
  if (/regular|normal/.test(token)) return "Regular";
  if (/medium/.test(token)) return "Medium";
  if (/semibold|demibold/.test(token)) return "SemiBold";
  if (/extrabold|ultrabold/.test(token)) return "ExtraBold";
  if (/bold/.test(token)) return "Bold";
  if (/heavy/.test(token)) return "Heavy";
  if (/black/.test(token)) return "Black";
  if (/super/.test(token)) return "Super";
  return undefined;
};

const dedupeStringArray = (values: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const token = normalizeToken(value);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(value);
  }
  return out;
};

const isPrimaryDinamoFamilyAsset = (asset: DinamoCssAsset, primaryToken: string, slugToken: string): boolean => {
  if (!primaryToken && !slugToken) return true;

  const familyToken = normalizeToken(asset.familyName);
  const groupToken = asset.groupPath.length > 0 ? normalizeToken(asset.groupPath[asset.groupPath.length - 1] || "") : "";
  const candidates = [familyToken, groupToken].filter(Boolean);
  if (candidates.length === 0) return true;

  const anchor = primaryToken || slugToken;
  if (!anchor) return true;

  return candidates.some((token) => token === anchor);
};

const extractDinamoFamilyQualifier = (familyName: string, primaryFamilyName: string): string | undefined => {
  const primaryWords = toTitleWords(primaryFamilyName || "")
    .split(/\s+/)
    .filter(Boolean);
  const familyWords = toTitleWords(familyName || "")
    .split(/\s+/)
    .filter(Boolean);
  if (familyWords.length === 0) return undefined;

  let idx = 0;
  while (
    idx < primaryWords.length &&
    idx < familyWords.length &&
    normalizeToken(primaryWords[idx]) === normalizeToken(familyWords[idx])
  ) {
    idx += 1;
  }

  const qualifierWords = familyWords.slice(idx);
  return qualifierWords.length > 0 ? qualifierWords.join(" ") : undefined;
};

const buildOptionalDinamoStyleLabel = (asset: DinamoCssAsset, primaryFamilyName: string): string | undefined => {
  const style = toCanonicalDinamoStyle(asset.styleName || "");
  if (!style) return undefined;

  const qualifier = extractDinamoFamilyQualifier(asset.familyName, primaryFamilyName);
  if (!qualifier) return undefined;
  if (!DINAMO_OPTIONAL_STYLE_QUALIFIERS.has(normalizeToken(qualifier))) return undefined;

  return toCanonicalDinamoStyle(`${qualifier} ${style}`);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fetchText = async (
  url: string,
  accept: string,
  options?: {
    timeoutMs?: number;
    referer?: string;
    origin?: string;
  }
): Promise<string> => {
  let lastError: unknown;
  const timeoutMs = options?.timeoutMs ?? DINAMO_FETCH_TIMEOUT_MS;

  for (let attempt = 1; attempt <= DINAMO_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        "User-Agent": DINAMO_UA,
        Accept: accept
      };
      if (options?.referer) headers.Referer = options.referer;
      if (options?.origin) headers.Origin = options.origin;

      const response = await fetch(url, {
        signal: controller.signal,
        headers
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} (${url})`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < DINAMO_FETCH_MAX_RETRIES) {
        await sleep(500 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Fetch failed (${url})`);
};

type DinamoCatalogMeta = {
  assetId: number;
  itemName?: string;
  faceName?: string;
  featureTags: string[];
  setTags: string[];
  axes: string[];
  source: "static-list" | "variable-list" | "merged";
  hidden?: boolean;
};

type DinamoCssAsset = {
  assetId: number;
  url: string;
  postscriptName: string;
  familyName: string;
  styleName: string;
  isItalic: boolean;
  isVariable: boolean;
  groupPath: string[];
};

const mergeCatalogMeta = (a: DinamoCatalogMeta | undefined, b: DinamoCatalogMeta): DinamoCatalogMeta => {
  if (!a) return b;
  return {
    assetId: b.assetId,
    itemName: b.itemName || a.itemName,
    faceName: b.faceName || a.faceName,
    featureTags: dedupeStringArray([...a.featureTags, ...b.featureTags]),
    setTags: dedupeStringArray([...a.setTags, ...b.setTags]),
    axes: dedupeStringArray([...a.axes, ...b.axes]),
    source: "merged",
    hidden: typeof b.hidden === "boolean" ? b.hidden : a.hidden
  };
};

const fetchDinamoCatalogMeta = async (referer?: string): Promise<Map<number, DinamoCatalogMeta>> => {
  const out = new Map<number, DinamoCatalogMeta>();

  try {
    const staticText = await fetchText(DINAMO_STATIC_LIST_URL, "application/json,text/plain,*/*", { referer });
    const staticJson = JSON.parse(staticText);
    const families = Array.isArray(staticJson?.data) ? staticJson.data : [];
    for (const family of families) {
      if (!isRecord(family)) continue;
      const familyName = asString(family.name);
      const familyHidden = typeof family.hidden === "boolean" ? family.hidden : undefined;
      const faces = Array.isArray(family.faces) ? family.faces : [];
      for (const face of faces) {
        if (!isRecord(face)) continue;
        const assetId = Number(face.assetId);
        if (!Number.isFinite(assetId) || assetId <= 0) continue;
        const sets = isRecord(face.sets) ? face.sets : {};
        const setTags = Object.keys(sets).filter((key) => normalizeToken(key).length > 0);
        const incoming: DinamoCatalogMeta = {
          assetId,
          itemName: familyName,
          faceName: asString(face.name),
          featureTags: [],
          setTags,
          axes: [],
          source: "static-list",
          hidden: familyHidden
        };
        out.set(assetId, mergeCatalogMeta(out.get(assetId), incoming));
      }
    }
  } catch {
    // best-effort enrichment
  }

  try {
    const variableText = await fetchText(DINAMO_VARIABLE_LIST_URL, "application/json,text/plain,*/*", { referer });
    const variableJson = JSON.parse(variableText);
    const items = Array.isArray(variableJson?.data) ? variableJson.data : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      const assetId = Number(item.assetId);
      if (!Number.isFinite(assetId) || assetId <= 0) continue;
      const sets = isRecord(item.sets) ? item.sets : {};
      const axes = Array.isArray(item.axes) ? item.axes : [];
      const axisTags = axes
        .map((axis) => (isRecord(axis) ? asString(axis.tag) : undefined))
        .filter((tag): tag is string => Boolean(tag));
      const featureTags = Array.isArray(item.features)
        ? item.features
            .map((feature) => asString(feature))
            .filter((feature): feature is string => Boolean(feature))
        : [];
      const incoming: DinamoCatalogMeta = {
        assetId,
        itemName: asString(item.name),
        faceName: asString(item.name),
        featureTags,
        setTags: Object.keys(sets).filter((key) => normalizeToken(key).length > 0),
        axes: axisTags,
        source: "variable-list",
        hidden: typeof item.hidden === "boolean" ? item.hidden : undefined
      };
      out.set(assetId, mergeCatalogMeta(out.get(assetId), incoming));
    }
  } catch {
    // best-effort enrichment
  }

  return out;
};

const extractFamilyAndStyleFromPostscript = (postscriptName: string): { familyStem: string; styleStem: string } => {
  if (postscriptName.includes("-")) {
    const idx = postscriptName.lastIndexOf("-");
    const familyStem = postscriptName.slice(0, idx).trim();
    const styleStem = postscriptName.slice(idx + 1).trim();
    return {
      familyStem: familyStem || postscriptName,
      styleStem: styleStem || "Regular"
    };
  }

  const stripped = postscriptName.trim();
  if (!stripped) return { familyStem: "Dinamo", styleStem: "Regular" };

  if (/variableitalic$/i.test(stripped)) {
    return {
      familyStem: stripped.replace(/variableitalic$/i, "") || stripped,
      styleStem: "Variable Italic"
    };
  }
  if (/variable$/i.test(stripped)) {
    return {
      familyStem: stripped.replace(/variable$/i, "") || stripped,
      styleStem: "Variable"
    };
  }
  if (/italic$/i.test(stripped)) {
    return {
      familyStem: stripped.replace(/italic$/i, "") || stripped,
      styleStem: "Italic"
    };
  }

  return {
    familyStem: stripped,
    styleStem: "Regular"
  };
};

const parseDinamoFontListCss = (cssText: string): DinamoCssAsset[] => {
  const out: DinamoCssAsset[] = [];
  const seen = new Set<string>();
  const pattern =
    /@font-face\s*\{[^}]*?font-family:\s*"font-full-(\d+)"[^}]*?src:\s*url\("([^"]+\.woff2(?:\?[^"]*)?)"\)[^}]*\}/gi;

  for (const match of cssText.matchAll(pattern)) {
    const assetIdRaw = Number(match[1] || 0);
    const assetUrl = String(match[2] || "").trim();
    if (!Number.isFinite(assetIdRaw) || assetIdRaw <= 0 || !assetUrl) continue;
    const canonicalUrl = assetUrl.split("#")[0];
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);

    let pathname = "";
    try {
      pathname = new URL(canonicalUrl).pathname;
    } catch {
      pathname = canonicalUrl;
    }
    const segments = pathname.split("/").filter(Boolean);
    const fontsIdx = segments.findIndex((segment) => segment.toLowerCase() === "fonts");
    const mode = fontsIdx >= 0 && segments[fontsIdx + 1] ? segments[fontsIdx + 1].toLowerCase() : "";
    const groupPath = fontsIdx >= 0 ? segments.slice(fontsIdx + 2, -1) : [];
    const fileName = segments[segments.length - 1] || "";
    const postscriptName = fileName.replace(/\.[^.]+$/, "");
    if (!postscriptName) continue;

    const { familyStem, styleStem } = extractFamilyAndStyleFromPostscript(postscriptName);
    const preferredGroup = groupPath.length > 0 ? groupPath[groupPath.length - 1] : familyStem;
    const familyName = toTitleWords(preferredGroup || familyStem) || "Dinamo";
    const styleName = toTitleWords(styleStem) || "Regular";

    out.push({
      assetId: assetIdRaw,
      url: canonicalUrl,
      postscriptName,
      familyName,
      styleName,
      isItalic: /italic/i.test(styleName),
      isVariable: mode === "variable" || /variable/i.test(postscriptName),
      groupPath
    });
  }

  return out;
};

const assetMatchesSlug = (asset: DinamoCssAsset, familySlug: string): boolean => {
  const slugToken = normalizeToken(familySlug);
  if (!slugToken) return false;

  const haystackToken = normalizeToken(
    [
      asset.url,
      asset.postscriptName,
      asset.familyName,
      asset.styleName,
      ...asset.groupPath
    ].join(" ")
  );
  if (!haystackToken) return false;
  if (haystackToken.includes(slugToken)) return true;

  const slugParts = familySlug.split("-").map(normalizeToken).filter((part) => part.length >= 3);
  if (slugParts.length > 1 && slugParts.every((part) => haystackToken.includes(part))) return true;

  return false;
};

const buildDinamoDirectAssets = async (
  targetUrl: string,
  familySlug: string,
  fallbackFamilyName: string
): Promise<{
  fonts: FontMetadata[];
  familyDisplay: string;
  targetProfile: Record<string, unknown>;
  expectedCount: number;
} | undefined> => {
  const cssText = await fetchText(DINAMO_FONT_LIST_CSS_URL, "text/css,*/*", {
    referer: targetUrl,
    origin: "https://abcdinamo.com"
  });
  const parsedAssets = parseDinamoFontListCss(cssText);
  if (parsedAssets.length === 0) return undefined;

  const targetAssets = parsedAssets.filter((asset) => assetMatchesSlug(asset, familySlug));
  if (targetAssets.length === 0) return undefined;

  const catalogMeta = await fetchDinamoCatalogMeta(targetUrl);

  const slugToken = normalizeToken(familySlug);
  const primaryFamilyToken = normalizeToken(fallbackFamilyName) || slugToken;
  const primaryAssets = targetAssets.filter((asset) => isPrimaryDinamoFamilyAsset(asset, primaryFamilyToken, slugToken));
  const primaryAssetIds = new Set<number>(primaryAssets.map((asset) => asset.assetId));
  const optionalAssets =
    primaryAssets.length > 0 ? targetAssets.filter((asset) => !primaryAssetIds.has(asset.assetId)) : [];

  const expectedPostscriptNames = dedupeStringArray(targetAssets.map((asset) => asset.postscriptName));
  const expectedStyles = dedupeStringArray(
    targetAssets.map((asset) => {
      return toCanonicalDinamoStyle(asset.styleName || "");
    })
  );
  const expectedStyleTokens = new Set(expectedStyles.map((style) => normalizeToken(style)));
  const optionalExcludedStyles = dedupeStringArray(
    optionalAssets
      .map((asset) => buildOptionalDinamoStyleLabel(asset, fallbackFamilyName))
      .filter((style): style is string => typeof style === "string" && style.length > 0)
      .filter((style) => !expectedStyleTokens.has(normalizeToken(style)))
  );
  const expectedStyleLabels = dedupeStringArray(
    targetAssets.map((asset) => `${asset.familyName} ${asset.styleName}`.replace(/\s+/g, " ").trim())
  );
  const featureTags = dedupeStringArray(
    targetAssets.flatMap((asset) => catalogMeta.get(asset.assetId)?.featureTags || [])
  );
  const setTags = dedupeStringArray(
    targetAssets.flatMap((asset) => catalogMeta.get(asset.assetId)?.setTags || [])
  );
  const optionalFamilyLabels = dedupeStringArray(optionalAssets.map((asset) => asset.familyName));

  const styleMap = targetAssets.map((asset) => {
    const detail = catalogMeta.get(asset.assetId);
    return {
      assetId: asset.assetId,
      url: asset.url,
      fontFile: asset.url,
      postscriptName: asset.postscriptName,
      familyName: asset.familyName,
      styleName: asset.styleName,
      sourceType: asset.isVariable ? "variable" : "static",
      italic: asset.isItalic,
      featureTags: detail?.featureTags || [],
      setTags: detail?.setTags || [],
      axes: detail?.axes || [],
      groupPath: asset.groupPath
    };
  });

  const familyDisplay = toReadableFamilyFromSlug(familySlug) || fallbackFamilyName;
  const targetProfile: Record<string, unknown> = {
    profileId: "abcdinamo-target-profile-v3",
    source: "font-list-css+catalog-api",
    foundry: "ABC Dinamo",
    targetUrl,
    targetSlug: familySlug,
    familyDisplay,
    expectedStyles,
    optionalExcludedStyles,
    expectedStyleCount: expectedStyles.length,
    expectedStyleLabels,
    expectedPostscriptNames,
    expectedPostscriptCount: expectedPostscriptNames.length,
    styleMap,
    expectedAssetIds: targetAssets.map((asset) => asset.assetId),
    expectedAssetCount: targetAssets.length,
    featureTags,
    setTags,
    optionalFamilyLabels,
    optionalFamilyCount: optionalFamilyLabels.length,
    optionalAssetCount: optionalAssets.length,
    collectedAt: new Date().toISOString()
  };

  const fonts: FontMetadata[] = targetAssets.map((asset) => {
    const detail = catalogMeta.get(asset.assetId);
    const styleLabel = toCanonicalDinamoStyle(asset.styleName || "");
    const normalizedWeight = styleLabel.replace(/\bitalic\b/i, "").replace(/\s+/g, " ").trim() || "Regular";
    const canonicalWeight = normalizedWeight.replace(/\bNormal\b/gi, "Regular").trim() || "Regular";
    const weight = inferWeightFromStyle(canonicalWeight) || canonicalWeight;
    const declaredStyle: FontMetadata["style"] = asset.isItalic ? "Italic" : "Normal";
    const categoryPath = asset.groupPath.length > 0 ? asset.groupPath.join(" / ") : undefined;

    return {
      url: asset.url,
      family: asset.familyName,
      style: declaredStyle,
      weight,
      format: "woff2",
      downloadable: true,
      note: "Direct ABC Dinamo CDN asset from font-list-css.",
      metadata: {
        foundry: "ABC Dinamo",
        pageUrl: targetUrl,
        family: asset.familyName,
        style: styleLabel,
        styleName: styleLabel,
        weightLabel: normalizedWeight,
        subfamilyGroup: categoryPath,
        forceMetadataRepair: true,
        disableInstanceExplosion: true,
        assetId: asset.assetId,
        postscriptName: asset.postscriptName,
        sourceType: asset.isVariable ? "variable" : "static",
        featureTags: detail?.featureTags || [],
        setTags: detail?.setTags || [],
        axes: detail?.axes || [],
        targetProfile,
        headers: {
          Origin: "https://abcdinamo.com",
          Referer: targetUrl,
          Accept: "*/*"
        }
      }
    };
  });

  return {
    fonts,
    familyDisplay,
    targetProfile,
    expectedCount: expectedPostscriptNames.length
  };
};

/**
 * Script untuk memprovokasi browser agar memuat seluruh varian font ABC Dinamo.
 * Script ini akan mencari tab sub-keluarga (Condensed, Nord, dll.) dan mengkliknya.
 */
const buildDinamoProvocationScript = (familyName: string): string => {
  return `
    (async () => {
      // Setup logging to communicate with Puppeteer
      if (!window.__specimen_logs) window.__specimen_logs = [];
      const log = (msg) => {
        console.log(msg);
        window.__specimen_logs.push(msg);
        if (window.__specimen_logs.length > 50) window.__specimen_logs.shift();
      };
      
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const familyLabel = ${JSON.stringify(familyName)};
      const norm = (v) => (v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const familyToken = norm(familyLabel);
      const probeText = "Sphinx of black quartz, judge my vow 0123456789 !@#$%^&*() ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
      const styleHints = ["hairline", "thin", "light", "regular", "book", "medium", "bold", "black", "ultra", "italic", "condensed", "nord", "display", "text", "mono", "variable", "extended", "compressed"];
      const familyHints = familyLabel.split(/\\s+/g).map(norm).filter(Boolean);
      const hints = Array.from(new Set([familyToken, ...familyHints, ...styleHints]));

      const pulseClick = async (node) => {
        try {
          if (node instanceof HTMLElement) {
            node.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
          }
          await sleep(50);
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          if (typeof node.click === "function") node.click();
          await sleep(100);
        } catch (e) {
          // Silent fail for individual clicks
        }
      };

      const clickBatch = async (selectors, label) => {
        const nodes = Array.from(document.querySelectorAll(selectors));
        log("[SPECIMEN] " + label + ": " + nodes.length + " elements found");
        for (const node of nodes) {
          await pulseClick(node);
          const href = node.getAttribute && node.getAttribute("href");
          if (href && href.startsWith("#")) {
            window.location.hash = href;
            await sleep(150);
          }
        }
      };

      log("[SPECIMEN] Provokasi Dinamo 7.0 started for: " + familyLabel);

      // Wait for page to fully load
      await sleep(2000);

      try {
        log("[SPECIMEN] Attempting Beta Lock bypass...");
        const granted = new Set(["ginto", "ginto-rounded", "ginto-nord", "arizona", familyToken]);
        for (const hint of familyHints) granted.add(hint);
        localStorage.setItem("dinamo_granted_betas", JSON.stringify(Array.from(granted)));
        sessionStorage.setItem("dinamo_granted_betas", JSON.stringify(Array.from(granted)));
        
        // Try to find and trigger unlock slider
        const lock = document.querySelector(".unlock-slider__lock, [class*='unlock'], [class*='slider']");
        if (lock) {
          log("[SPECIMEN] Slider lock found, triggering drag...");
          lock.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          await sleep(300);
          window.dispatchEvent(new MouseEvent("mousemove", { clientX: 800, bubbles: true }));
          await sleep(300);
          lock.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        }
      } catch (e) {
        log("[SPECIMEN] Beta bypass info: " + (e && e.message ? e.message : e));
      }

      await sleep(1500);

      // Expanded selectors for ABC Dinamo's current UI
      const tabSelectors = [
        '[data-tab-name^="family-tab-"]',
        '.js-tab-anchor-link', 
        '.style-listing__panel',
        '.js-try-me',
        '[data-testid*="tab"]',
        '[role="tab"]',
        '[class*="tab" i]',
        '[class*="Tab" i]',
        'button[class*="family" i]',
        'a[href*="#family"]'
      ];

      const popupSelectors = [
        '.js-open-pop-up-listing',
        '.js-popup-listing-panel',
        '[data-pop-up-listing]',
        '.btn--text-icon',
        '.anchor-nav__expand',
        '[class*="popup" i]',
        '[class*="Popup" i]',
        '[class*="expand" i]',
        '[class*="Expand" i]',
        'button[class*="toggle" i]'
      ];

      for (let pass = 0; pass < 3; pass += 1) {
        log("[SPECIMEN] Pass " + (pass + 1) + "/3");

        // Click all tab-related elements
        for (const selector of tabSelectors) {
          await clickBatch(selector, "Tab selector: " + selector);
          await sleep(200);
        }

        // Click all popup-related elements
        for (const selector of popupSelectors) {
          await clickBatch(selector, "Popup selector: " + selector);
          await sleep(200);
        }

        // Navigate through hash links
        const hashLinks = Array.from(document.querySelectorAll('a[href^="#"], [data-href^="#"]'));
        log("[SPECIMEN] Found " + hashLinks.length + " hash links");
        for (const link of hashLinks) {
          const href = link.getAttribute("href") || link.getAttribute("data-href");
          if (!href) continue;
          window.location.hash = href;
          await sleep(200);
        }

        // Interact with elements matching hints
        const interactiveSelectors = [
          'button', 
          'a', 
          '[role="button"]', 
          '[class*="style" i]',
          '[class*="weight" i]',
          '[class*="variant" i]',
          '[class*="switch" i]',
          '[class*="font" i]',
          '[class*="Font" i]'
        ];
        
        for (const selector of interactiveSelectors) {
          const nodes = Array.from(document.querySelectorAll(selector));
          log("[SPECIMEN] Checking " + nodes.length + " " + selector + " elements");
          
          for (const node of nodes) {
            const text = norm(node.textContent || "");
            const cls = norm(node.getAttribute && node.getAttribute("class"));
            const href = norm(node.getAttribute && node.getAttribute("href"));
            const aria = norm(node.getAttribute && node.getAttribute("aria-label"));
            const tab = norm(node.getAttribute && node.getAttribute("data-tab-name"));
            const dataFamily = norm(node.getAttribute && node.getAttribute("data-family"));
            const haystack = text + cls + href + aria + tab + dataFamily;
            
            if (!haystack) continue;
            if (hints.some((hint) => hint && haystack.includes(hint))) {
              await pulseClick(node);
            }
          }
        }

        // Trigger input fields to load glyphs
        const editableSelectors = [
          'input[type="text"]',
          'textarea',
          '[contenteditable="true"]',
          '[contenteditable]',
          '.font-preview-input',
          '[class*="preview" i] input',
          '[class*="text" i] input'
        ];
        
        for (const selector of editableSelectors) {
          const fields = Array.from(document.querySelectorAll(selector));
          log("[SPECIMEN] Found " + fields.length + " editable fields with selector: " + selector);
          
          for (const field of fields) {
            try {
              if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
                field.focus();
                field.value = probeText;
                field.dispatchEvent(new Event("input", { bubbles: true }));
                field.dispatchEvent(new Event("change", { bubbles: true }));
                field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
              } else {
                field.textContent = probeText;
                field.dispatchEvent(new Event("input", { bubbles: true }));
              }
              await sleep(100);
            } catch (e) {}
          }
        }

        // Trigger select dropdowns
        const selects = Array.from(document.querySelectorAll("select, [role='listbox']"));
        log("[SPECIMEN] Found " + selects.length + " select elements");
        for (const sel of selects) {
          try {
            for (let i = 0; i < sel.options?.length || 0; i += 1) {
              sel.selectedIndex = i;
              sel.dispatchEvent(new Event("input", { bubbles: true }));
              sel.dispatchEvent(new Event("change", { bubbles: true }));
              await sleep(100);
            }
          } catch (e) {}
        }

        // Click expand buttons
        const expandButtons = Array.from(document.querySelectorAll("button, a, .btn, [role='button']")).filter((node) => {
          const text = (node.textContent || "").toLowerCase();
          return text.includes("show") || text.includes("more") || text.includes("expand") || 
                 text.includes("load") || text.includes("all") || text.includes("view");
        });
        log("[SPECIMEN] Found " + expandButtons.length + " expand buttons");
        for (const button of expandButtons) {
          await pulseClick(button);
        }

        // Scroll through page to trigger lazy loading
        const scrollStops = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
        for (const ratio of scrollStops) {
          const y = Math.floor(document.body.scrollHeight * ratio);
          window.scrollTo({ top: y, behavior: "smooth" });
          await sleep(400);
        }
      }

      // Final scroll and wait
      window.scrollTo(0, 0);
      await sleep(500);
      log("[SPECIMEN] Provokasi Dinamo completed successfully!");
      window.__specimen_extraction_complete = true;
      window.__specimen_extraction_complete = true;
    })();
  `;
};

export const ABCDinamoScraper: Scraper = {
  id: "abcdinamo",
  name: "ABC Dinamo Scraper (Interception Protocol)",

  canHandle(url: string): boolean {
    return url.includes("abcdinamo.com");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const targetUrl = normalizeTargetUrl(url);
      const familySlug = extractDinamoFamilySlug(targetUrl);
      const familyName = familySlug ? toReadableFamilyFromSlug(familySlug) : "Dinamo";

      if (familySlug) {
        try {
          const direct = await buildDinamoDirectAssets(targetUrl, familySlug, familyName);
          if (direct && direct.fonts.length > 0) {
            return {
              scraperName: this.name,
              foundryName: "ABC Dinamo",
              fonts: direct.fonts,
              originalUrl: url,
              targetUrl,
              expectedCount: direct.expectedCount,
              metadata: {
                foundry: "ABC Dinamo",
                family: direct.familyDisplay,
                targetProfile: direct.targetProfile
              }
            };
          }
        } catch (directError) {
          console.warn("[ABCDinamoScraper] direct catalog mode failed, fallback to intercept:", directError);
        }
      }

      if (familySlug) {
        return {
          scraperName: this.name,
          foundryName: "ABC Dinamo",
          fonts: [
            {
              url: "browser-intercept",
              family: familyName,
              format: "woff2",
              downloadable: true,
              note: "Fallback intersepsi Dinamo ketika direct catalog tidak tersedia."
            }
          ],
          originalUrl: url,
          targetUrl,
          masterFoundry: true,
          injectScript: buildDinamoProvocationScript(familyName),
          expectedCount: familyName.toLowerCase().includes("ginto") ? 64 : undefined
        };
      }

      return {
        scraperName: this.name,
        foundryName: "ABC Dinamo",
        fonts: [],
        originalUrl: url,
        targetUrl
      };

    } catch (e) {
      console.error("ABC Dinamo Scraper Error:", e);
      return {
        scraperName: this.name,
        foundryName: "ABC Dinamo",
        fonts: [],
        originalUrl: url
      };
    }
  }
};

