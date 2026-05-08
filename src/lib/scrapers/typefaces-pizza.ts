import crypto from "node:crypto";
import { load as loadHtml } from "cheerio";
import { putInlineFontAsset, type InlineFontAssetFormat } from "@/lib/server/inline-font-cache";
import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const PIZZA_ORIGIN = "https://typefaces.pizza";
const PAGE_DATA_TIMEOUT_MS = 25_000;
const RESERVED_PIZZA_PATHS = new Set(["infos", "licences", "custom-fonts"]);

const BROWSER_HEADERS: Record<string, string> = {
  accept: "application/json,text/plain,*/*",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
};

type AnyRecord = Record<string, unknown>;

type PizzaScope = {
  origin: string;
  mode: "catalog" | "family";
  familySlug?: string;
  targetUrl: string;
};

type PizzaAssetCandidate = {
  sourceType: "trial" | "typeface";
  label: string;
  mimeType?: string;
  base64?: string;
  url?: string;
};

type PizzaHtmlAxis = {
  name: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
};

type PizzaHtmlInsights = {
  instanceStyles: string[];
  licenceOptions: string[];
  companySizeBands: string[];
  purchaseModes: string[];
  variableAxes: PizzaHtmlAxis[];
  informationText?: string;
};

const isRecord = (value: unknown): value is AnyRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const normalizeSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const dedupeStringList = (input: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of input) {
    const normalized = normalizeSpace(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
};

const parseNumericAttr = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseCompanySizeOptions = (raw: string): string[] =>
  dedupeStringList(
    raw
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.replace(/\[.*$/, "").trim())
      .filter(Boolean)
  );

const safeJsonParse = (raw: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const parseProductHtmlInsights = (html: string): PizzaHtmlInsights => {
  const $ = loadHtml(html);
  const headingStyles: string[] = [];
  const metadataStyles: string[] = [];
  const licenceOptions: string[] = [];
  const companySizeBands: string[] = [];
  const purchaseModes: string[] = [];
  const variableAxes: PizzaHtmlAxis[] = [];

  $("#section-family h2").each((_, el) => {
    const label = normalizeSpace($(el).text());
    if (label) headingStyles.push(label);
  });

  $("#section-variable input[type='range']").each((_, el) => {
    const node = $(el);
    const axisName = normalizeSpace(node.attr("name") || "");
    if (!axisName) return;
    variableAxes.push({
      name: axisName,
      min: parseNumericAttr(node.attr("min")),
      max: parseNumericAttr(node.attr("max")),
      step: parseNumericAttr(node.attr("step")),
      value: parseNumericAttr(node.attr("value"))
    });
  });

  $(".variations").each((_, el) => {
    const block = $(el);
    const label = normalizeSpace(block.find(".label span").first().text());
    const options = block
      .find("button.btn-variation")
      .map((__, button) => normalizeSpace($(button).text()))
      .get()
      .filter(Boolean);
    if (/licence/i.test(label)) {
      licenceOptions.push(...options);
    } else if (/company\s*size/i.test(label)) {
      companySizeBands.push(...options);
    }
  });

  $("input.snipcart-add-item-").each((_, el) => {
    const node = $(el);
    const metadataRaw = node.attr("data-item-metadata");
    let mode = "";
    if (metadataRaw) {
      const parsed = safeJsonParse(metadataRaw);
      mode = normalizeSpace(asString(parsed?.type) || "").toLowerCase();
      if (mode) purchaseModes.push(mode);
      if (mode === "instance") {
        const instance = normalizeSpace(asString(parsed?.instance) || "");
        if (instance && !/^(custom|westy)$/i.test(instance)) metadataStyles.push(instance);
      }
    }

    for (let idx = 1; idx <= 8; idx += 1) {
      const nameRaw = normalizeSpace(node.attr(`data-item-custom${idx}-name`) || "");
      if (!nameRaw) continue;
      if (/company\s*size/i.test(nameRaw)) {
        const optionsRaw = node.attr(`data-item-custom${idx}-options`) || "";
        companySizeBands.push(...parseCompanySizeOptions(optionsRaw));
      } else if (!/licence/i.test(nameRaw)) {
        licenceOptions.push(nameRaw);
      }
    }
  });

  const informationText = normalizeSpace($("#section-informations .texte").text());

  return {
    instanceStyles: dedupeStringList([...headingStyles, ...metadataStyles]),
    licenceOptions: dedupeStringList(licenceOptions),
    companySizeBands: dedupeStringList(companySizeBands),
    purchaseModes: dedupeStringList(purchaseModes),
    variableAxes,
    informationText: informationText || undefined
  };
};

const toSafeSlug = (value: string): string => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const inferStyleMode = (styleName: string): string =>
  /\b(italic|oblique|slanted)\b/i.test(styleName) ? "Italic" : "Normal";

const inferWeight = (styleName: string): string => {
  const token = styleName.toLowerCase();
  if (/\bthin\b/.test(token)) return "100";
  if (/\bextra\s*light\b|\bultra\s*light\b/.test(token)) return "200";
  if (/\blight\b/.test(token)) return "300";
  if (/\bbook\b|\bregular\b|\btext\b|\bvariable\b/.test(token)) return "400";
  if (/\bmedium\b/.test(token)) return "500";
  if (/\bsemi\s*bold\b|\bdemi\s*bold\b/.test(token)) return "600";
  if (/\bbold\b/.test(token)) return "700";
  if (/\bextra\s*bold\b|\bultra\s*bold\b/.test(token)) return "800";
  if (/\bblack\b|\bheavy\b/.test(token)) return "900";
  return "400";
};

const normalizeStyleLabel = (rawLabel: string, familyName: string, sourceType: PizzaAssetCandidate["sourceType"]): string => {
  const compactLabel = normalizeSpace(rawLabel);
  const strippedFamily = compactLabel.replace(new RegExp(`^${escapeRegExp(familyName)}\\s*`, "i"), "").trim();
  const cleaned = normalizeSpace(strippedFamily || compactLabel);

  if (sourceType === "trial") {
    if (!cleaned || normalizeToken(cleaned) === normalizeToken(familyName)) return "Trial";
    if (/\btrial\b/i.test(cleaned)) return cleaned;
    return `Trial ${cleaned}`;
  }

  if (!cleaned || normalizeToken(cleaned) === normalizeToken(familyName)) return "Variable";
  if (/\bvariable\b/i.test(cleaned)) return "Variable";
  return cleaned;
};

const decodeBase64ToBuffer = (rawBase64: string): Buffer | undefined => {
  const normalized = rawBase64
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .trim();

  if (!normalized) return undefined;
  try {
    const buffer = Buffer.from(normalized, "base64");
    return buffer.length > 0 ? buffer : undefined;
  } catch {
    return undefined;
  }
};

const inferFormatFromMime = (mimeType?: string): InlineFontAssetFormat | undefined => {
  const token = (mimeType || "").toLowerCase();
  if (token.includes("woff2")) return "woff2";
  if (token.includes("woff")) return "woff";
  if (token.includes("opentype") || token.includes("otf")) return "otf";
  if (token.includes("truetype") || token.includes("ttf")) return "ttf";
  if (token.includes("zip")) return "zip";
  return undefined;
};

const inferFormatFromUrl = (url: string): InlineFontAssetFormat | undefined => {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".woff2")) return "woff2";
    if (pathname.endsWith(".woff")) return "woff";
    if (pathname.endsWith(".otf")) return "otf";
    if (pathname.endsWith(".ttf")) return "ttf";
    if (pathname.endsWith(".zip")) return "zip";
  } catch {
    // ignore malformed url
  }
  return undefined;
};

const inferFormatFromBuffer = (buffer: Buffer): InlineFontAssetFormat | undefined => {
  if (!buffer || buffer.length < 4) return undefined;
  const signature = buffer.subarray(0, 4).toString("hex");
  if (signature === "774f4632") return "woff2";
  if (signature === "774f4646") return "woff";
  if (signature === "4f54544f") return "otf";
  if (signature === "00010000" || signature === "74727565") return "ttf";
  if (signature === "504b0304") return "zip";
  return undefined;
};

const resolveHost = (hostname: string): string => hostname.replace(/^www\./i, "").toLowerCase();

const normalizeInputUrl = (url: string): URL => {
  try {
    return new URL(url);
  } catch {
    const prefixed = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
    try {
      return new URL(prefixed);
    } catch {
      return new URL(PIZZA_ORIGIN);
    }
  }
};

const extractScope = (url: string): PizzaScope => {
  const parsed = normalizeInputUrl(url);
  const host = resolveHost(parsed.hostname);
  const safeOrigin = host === "typefaces.pizza" ? parsed.origin : PIZZA_ORIGIN;
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (segments[0]?.toLowerCase() === "type" && segments[1]) {
    const slug = segments[1].toLowerCase();
    return {
      origin: safeOrigin,
      mode: "family",
      familySlug: slug,
      targetUrl: `${safeOrigin}/type/${slug}`
    };
  }

  if (segments[0] && !RESERVED_PIZZA_PATHS.has(segments[0].toLowerCase())) {
    const slug = segments[0].toLowerCase();
    return {
      origin: safeOrigin,
      mode: "family",
      familySlug: slug,
      targetUrl: `${safeOrigin}/type/${slug}`
    };
  }

  return {
    origin: safeOrigin,
    mode: "catalog",
    targetUrl: `${safeOrigin}/`
  };
};

const fetchJsonWithTimeout = async <T>(url: string): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_DATA_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: BROWSER_HEADERS,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};

const fetchTextWithTimeout = async (url: string): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_DATA_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: BROWSER_HEADERS,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

const getIndexProducts = (payload: unknown): AnyRecord[] => {
  if (!isRecord(payload)) return [];
  const result = isRecord(payload.result) ? payload.result : undefined;
  const data = result && isRecord(result.data) ? result.data : undefined;
  const page = data && isRecord(data.sanityPageModulaire) ? data.sanityPageModulaire : undefined;
  const modules = asArray(page?.modules);
  for (const module of modules) {
    if (!isRecord(module)) continue;
    if (asString(module._type) !== "productListUI") continue;
    return asArray(module.products).filter(isRecord);
  }
  return [];
};

const getTypePageProduct = (payload: unknown): AnyRecord | undefined => {
  if (!isRecord(payload)) return undefined;
  const result = isRecord(payload.result) ? payload.result : undefined;
  const data = result && isRecord(result.data) ? result.data : undefined;
  return data && isRecord(data.sanityProduct) ? data.sanityProduct : undefined;
};

const extractFamilySlug = (product: AnyRecord): string | undefined => {
  const slugRecord = isRecord(product.slug) ? product.slug : undefined;
  return asString(slugRecord?.current)?.toLowerCase();
};

const extractFamilyName = (product: AnyRecord): string => {
  const title = normalizeSpace(asString(product.title) || "");
  if (title) return title;
  const displayTitle = normalizeSpace(asString(product.displayTitle) || "");
  if (displayTitle) return displayTitle;
  const slug = extractFamilySlug(product);
  return slug ? slug.replace(/-/g, " ") : "Pizza Typefaces Family";
};

const extractScripts = (product: AnyRecord): string[] => {
  const entries = asArray(product.scriptsSupporter).map((item) => normalizeSpace(asString(item) || "")).filter(Boolean);
  return dedupeStringList(entries);
};

const extractExpectedStyles = (product: AnyRecord, familyName: string): string[] => {
  const out = new Set<string>();
  const productVariations = isRecord(product.productVariations) ? product.productVariations : undefined;
  const variations = asArray(productVariations?.variations);

  for (const variation of variations) {
    if (!isRecord(variation)) continue;
    const variationLabel = normalizeSpace(asString(variation.label) || "");
    const variationToken = variationLabel.toLowerCase();
    const options = asArray(variation.options);

    for (const optionNode of options) {
      if (!isRecord(optionNode)) continue;
      const optionLabel = normalizeSpace(asString(optionNode.option) || asString(optionNode.name) || "");
      if (!optionLabel) continue;

      if (
        !variationToken.includes("instance") &&
        !variationToken.includes("font") &&
        !variationToken.includes("style") &&
        /^(print|web|app|video|logo|complete|custom)/i.test(optionLabel)
      ) {
        continue;
      }

      const style = normalizeStyleLabel(optionLabel, familyName, "typeface");
      const fullName = normalizeSpace(`${familyName} ${style}`.trim());
      if (fullName) out.add(fullName);
    }
  }

  return [...out];
};

const extractAssetCandidates = (product: AnyRecord, familyName: string): PizzaAssetCandidate[] => {
  const out: PizzaAssetCandidate[] = [];

  const trialRecord = isRecord(product.trial) ? product.trial : undefined;
  const trialTypeface = trialRecord && isRecord(trialRecord.typeface) ? trialRecord.typeface : undefined;
  if (trialTypeface) {
    out.push({
      sourceType: "trial",
      label: normalizeSpace(asString(trialRecord?.title) || `${familyName} Trial`) || `${familyName} Trial`,
      mimeType: asString(trialTypeface.mimeType),
      base64: asString(trialTypeface.base64),
      url: asString(trialTypeface.url)
    });
  }

  const typefaces = asArray(product.typefaces);
  for (const item of typefaces) {
    if (!isRecord(item)) continue;
    const typeface = isRecord(item.typeface) ? item.typeface : undefined;
    if (!typeface) continue;

    out.push({
      sourceType: "typeface",
      label: normalizeSpace(asString(item.title) || asString(item.style) || familyName) || familyName,
      mimeType: asString(typeface.mimeType),
      base64: asString(typeface.base64),
      url: asString(typeface.url)
    });
  }

  return out;
};

const buildTargetProfile = (params: {
  familyName: string;
  familySlug: string;
  scripts: string[];
  expectedStyles: string[];
  declaredStyles: string[];
  declaredStaticStylesFromUi: string[];
  licenceOptionsFromUi: string[];
  companySizeBandsFromUi: string[];
  purchaseModesFromUi: string[];
  variableAxesFromUi: PizzaHtmlAxis[];
  informationTextFromUi?: string;
  targetUrl: string;
  sourceType: PizzaScope["mode"];
}): Record<string, unknown> => ({
  profileId: "typefaces-pizza-target-profile-v1",
  source: "gatsby-page-data-inline-payload",
  foundry: "Pizza Typefaces",
  family: params.familyName,
  familySlug: params.familySlug,
  scripts: params.scripts,
  targetUrl: params.targetUrl,
  scope: params.sourceType,
  styleScope: "family-style",
  expectedStyles: params.expectedStyles,
  expectedStyleCount: params.expectedStyles.length,
  declaredStylesFromCatalog: params.declaredStyles,
  declaredStyleCount: params.declaredStyles.length,
  declaredStaticStylesFromUi: params.declaredStaticStylesFromUi,
  declaredStaticStyleCount: params.declaredStaticStylesFromUi.length,
  licenceOptionsFromUi: params.licenceOptionsFromUi,
  companySizeBandsFromUi: params.companySizeBandsFromUi,
  purchaseModesFromUi: params.purchaseModesFromUi,
  variableAxesFromUi: params.variableAxesFromUi,
  informationTextFromUi: params.informationTextFromUi,
  outputNaming: {
    prefix: "typefaces-pizza",
    pattern: "typefaces-pizza-{family-slug}-{style-slug}.{ext}",
    separator: "-",
    styleTokenCase: "lowercase"
  },
  formatPolicy: "inline-page-data-payload (ttf/otf/woff2/woff/zip)",
  outputFormats: ["ttf", "otf", "woff2", "woff", "zip"],
  collectedAt: new Date().toISOString()
});

const buildProvocationScript = (familySlug?: string): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    try { await fetch("/page-data/index/page-data.json", { cache: "no-store" }); } catch {}
    ${familySlug ? `try { await fetch("/page-data/type/${familySlug}/page-data.json", { cache: "no-store" }); } catch {}` : ""}
    const nodes = Array.from(document.querySelectorAll("button,a,[role='button'],[data-style],[data-font]"));
    for (const node of nodes.slice(0, 120)) {
      try {
        if (node instanceof HTMLElement) {
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      } catch {}
      await sleep(22);
    }
    await sleep(800);
  })();
`;

const toPageDataTypeUrl = (origin: string, familySlug: string): string =>
  `${origin}/page-data/type/${encodeURIComponent(familySlug)}/page-data.json`;

const toPageDataIndexUrl = (origin: string): string => `${origin}/page-data/index/page-data.json`;

export const TypefacesPizzaScraper: Scraper = {
  id: "typefaces-pizza",
  name: "Typefaces Pizza Deep Payload Scraper",

  canHandle(url: string): boolean {
    try {
      const parsed = normalizeInputUrl(url);
      return resolveHost(parsed.hostname) === "typefaces.pizza";
    } catch {
      return /typefaces\.pizza/i.test(url);
    }
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const scope = extractScope(url);
      const indexUrl = toPageDataIndexUrl(scope.origin);
      const familyUrl = scope.familySlug ? toPageDataTypeUrl(scope.origin, scope.familySlug) : undefined;

      let indexProducts: AnyRecord[] = [];
      let products: AnyRecord[] = [];

      if (scope.mode === "family" && familyUrl) {
        try {
          const familyPayload = await fetchJsonWithTimeout<unknown>(familyUrl);
          const familyProduct = getTypePageProduct(familyPayload);
          if (familyProduct) products = [familyProduct];
        } catch {
          // fallback to catalog payload
        }
      }

      const indexPayload = await fetchJsonWithTimeout<unknown>(indexUrl);
      indexProducts = getIndexProducts(indexPayload);
      const scriptsBySlug = new Map<string, string[]>();
      for (const product of indexProducts) {
        const slug = extractFamilySlug(product);
        if (!slug) continue;
        scriptsBySlug.set(slug, extractScripts(product));
      }

      if (products.length === 0) {
        if (scope.mode === "family" && scope.familySlug) {
          products = indexProducts.filter((product) => extractFamilySlug(product) === scope.familySlug);
        } else {
          products = indexProducts;
        }
      }

      const htmlInsightsBySlug = new Map<string, PizzaHtmlInsights>();
      if (scope.mode === "family" && scope.familySlug) {
        try {
          const html = await fetchTextWithTimeout(`${scope.origin}/type/${scope.familySlug}`);
          htmlInsightsBySlug.set(scope.familySlug, parseProductHtmlInsights(html));
        } catch {
          // best-effort: keep scraper resilient if HTML enrichment fails
        }
      }

      if (products.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "Pizza Typefaces",
          fonts: [],
          originalUrl: url,
          targetUrl: scope.targetUrl,
          injectScript: buildProvocationScript(scope.familySlug),
          metadata: {
            foundry: "Pizza Typefaces",
            reason: "product-not-found",
            mode: scope.mode,
            familySlug: scope.familySlug,
            pageDataUrl: scope.mode === "family" ? familyUrl : indexUrl
          }
        };
      }

      const fonts: FontMetadata[] = [];
      const seenInlineHashes = new Set<string>();
      const seenDirectUrls = new Set<string>();
      const targetProfiles: Record<string, unknown>[] = [];

      for (const product of products) {
        const familySlug = extractFamilySlug(product) || scope.familySlug || toSafeSlug(extractFamilyName(product)) || "family";
        const familyName = extractFamilyName(product);
        const scripts = extractScripts(product).length > 0 ? extractScripts(product) : scriptsBySlug.get(familySlug) || [];
        const htmlInsights = htmlInsightsBySlug.get(familySlug);
        const uiDeclaredFamilyStyles = dedupeStringList(
          (htmlInsights?.instanceStyles || []).map((style) =>
            normalizeSpace(`${familyName} ${normalizeStyleLabel(style, familyName, "typeface")}`)
          )
        );
        const declaredStyles = dedupeStringList([
          ...extractExpectedStyles(product, familyName),
          ...uiDeclaredFamilyStyles
        ]);
        const rawCandidates = extractAssetCandidates(product, familyName);
        const hasNonTrialTypeface = rawCandidates.some(
          (candidate) => candidate.sourceType === "typeface" && Boolean(candidate.base64 || candidate.url)
        );
        const candidates = hasNonTrialTypeface
          ? rawCandidates.filter((candidate) => candidate.sourceType === "typeface")
          : rawCandidates;
        const qualityCandidates = [...candidates].sort((a, b) => {
          if (a.sourceType === b.sourceType) return 0;
          return a.sourceType === "typeface" ? -1 : 1;
        });
        const qualityExpectedStyles = dedupeStringList(
          qualityCandidates.map((candidate) => {
            const styleLabel = normalizeStyleLabel(candidate.label, familyName, candidate.sourceType);
            if (candidate.sourceType === "typeface" && /\bvariable\b/i.test(styleLabel)) {
              // Validation often resolves variable files to a concrete default instance
              // (for example "Westy Thin"), so we match at family-scope.
              return familyName;
            }
            return normalizeSpace(`${familyName} ${styleLabel}`);
          })
        );
        const expectedStylesForValidation =
          uiDeclaredFamilyStyles.length > 0
            ? uiDeclaredFamilyStyles
            : qualityExpectedStyles.length > 0
            ? qualityExpectedStyles
            : declaredStyles;

        const targetProfile = buildTargetProfile({
          familyName,
          familySlug,
          scripts,
          expectedStyles: expectedStylesForValidation,
          declaredStyles,
          declaredStaticStylesFromUi: htmlInsights?.instanceStyles || [],
          licenceOptionsFromUi: htmlInsights?.licenceOptions || [],
          companySizeBandsFromUi: htmlInsights?.companySizeBands || [],
          purchaseModesFromUi: htmlInsights?.purchaseModes || [],
          variableAxesFromUi: htmlInsights?.variableAxes || [],
          informationTextFromUi: htmlInsights?.informationText,
          targetUrl: `${scope.origin}/type/${familySlug}`,
          sourceType: scope.mode
        });
        targetProfiles.push(targetProfile);

        for (const candidate of candidates) {
          const styleLabel = normalizeStyleLabel(candidate.label, familyName, candidate.sourceType);
          const style = inferStyleMode(styleLabel);
          const weight = inferWeight(styleLabel);
          const styleSlug = toSafeSlug(styleLabel) || (candidate.sourceType === "trial" ? "trial" : "variable");
          const fullName = normalizeSpace(`${familyName} ${styleLabel}`.trim());
          const fileNameStem = `typefaces-pizza-${toSafeSlug(familySlug) || "family"}-${styleSlug}`;

          if (candidate.base64) {
            const buffer = decodeBase64ToBuffer(candidate.base64);
            if (!buffer) continue;

            const format =
              inferFormatFromBuffer(buffer) ||
              inferFormatFromMime(candidate.mimeType) ||
              (candidate.url ? inferFormatFromUrl(candidate.url) : undefined);
            if (!format) continue;

            const hash = crypto.createHash("sha256").update(buffer).digest("hex");
            if (seenInlineHashes.has(hash)) continue;
            seenInlineHashes.add(hash);

            const token = putInlineFontAsset({
              buffer,
              format,
              fileNameHint: `${fileNameStem}.${format}`,
              foundry: "Pizza Typefaces",
              family: familyName
            });

            fonts.push({
              url: `inline-font://${token}`,
              format,
              family: familyName,
              style,
              weight,
              downloadable: true,
              note:
                candidate.sourceType === "trial"
                  ? "Pizza Typefaces trial payload (inline)."
                  : "Pizza Typefaces typeface payload (inline).",
              metadata: {
                foundry: "Pizza Typefaces",
                family: familyName,
                familySlug,
                styleName: styleLabel,
                fullName,
                sourceType: `page-data-${candidate.sourceType}-inline`,
                pageUrl: `${scope.origin}/type/${familySlug}`,
                targetUrl: scope.targetUrl,
                mimeType: candidate.mimeType,
                fileNameHint: `${fileNameStem}.${format}`,
                skipConversion: candidate.sourceType === "trial",
                disableInstanceExplosion: candidate.sourceType === "trial",
                targetProfile
              }
            });
            continue;
          }

          const directUrl = candidate.url ? asString(candidate.url) : undefined;
          if (!directUrl) continue;
          const resolved = new URL(directUrl, scope.origin).href;
          if (seenDirectUrls.has(resolved)) continue;
          seenDirectUrls.add(resolved);

          const format = inferFormatFromUrl(resolved) || inferFormatFromMime(candidate.mimeType) || "ttf";
          fonts.push({
            url: resolved,
            format,
            family: familyName,
            style,
            weight,
            downloadable: true,
            note: "Pizza Typefaces payload URL.",
            metadata: {
              foundry: "Pizza Typefaces",
              family: familyName,
              familySlug,
              styleName: styleLabel,
              fullName,
              sourceType: `page-data-${candidate.sourceType}-url`,
              pageUrl: `${scope.origin}/type/${familySlug}`,
              targetUrl: scope.targetUrl,
              mimeType: candidate.mimeType,
              fileNameHint: `${fileNameStem}.${format}`,
              skipConversion: candidate.sourceType === "trial",
              disableInstanceExplosion: candidate.sourceType === "trial",
              targetProfile
            }
          });
        }
      }

      return {
        scraperName: this.name,
        foundryName: "Pizza Typefaces",
        fonts,
        originalUrl: url,
        targetUrl: scope.targetUrl,
        injectScript: buildProvocationScript(scope.familySlug),
        expectedCount: fonts.length > 0 ? fonts.length : undefined,
        metadata: {
          foundry: "Pizza Typefaces",
          mode: scope.mode,
          familySlug: scope.familySlug,
          catalogCount: indexProducts.length,
          scopedProducts: products.length,
          pageDataUrls: {
            index: indexUrl,
            family: familyUrl
          },
          targetProfiles
        }
      };
    } catch (error) {
      return {
        scraperName: this.name,
        foundryName: "Pizza Typefaces",
        fonts: [],
        originalUrl: url,
        metadata: {
          foundry: "Pizza Typefaces",
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
};
