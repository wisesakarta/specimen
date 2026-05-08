import type { FontMetadata, ScrapeResult, Scraper } from "./scraper-protocol";

const HOST = "commercialtype.com";
const ORIGIN = `https://${HOST}`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const TIMEOUT_MS = 30000;
const RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const asString = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const asNumber = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};
const asNumberArray = (v: unknown): number[] =>
  Array.isArray(v)
    ? v.map((item) => asNumber(item)).filter((n): n is number => n !== undefined)
    : [];
const normalizeToken = (v: string): string => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const dedupe = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = item.trim();
    if (!text) continue;
    const key = normalizeToken(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};
const toSlug = (value: string): string => value.toLowerCase().replace(/\s/g, "_");
const compact = (value: string): string => value.replace(/\s/g, "");
const splitPath = (pathname: string): string[] =>
  pathname.split("/").map((part) => decodeURIComponent(part || "").trim()).filter(Boolean);
const pathEq = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (normalizeToken(left[i]) !== normalizeToken(right[i])) return false;
  }
  return true;
};


const normalizeUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl);
  parsed.protocol = "https:";
  if (parsed.hostname.toLowerCase() === `www.${HOST}`) parsed.hostname = HOST;
  return parsed.href;
};

const fetchText = async (url: string, referer?: string): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...(referer ? { Referer: referer } : {})
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Commercial Type fetch failed");
};

const fetchJson = async (url: string, referer?: string): Promise<Record<string, unknown>> => {
  const text = await fetchText(url, referer);
  const parsed = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("Commercial Type catalog is not an object");
  return parsed;
};

const extractCatalogPointer = (html: string): string | undefined => {
  const fromBody = asString(html.match(/<body[^>]*\bdata-catalog\s*=\s*["']([^"']+)["']/i)?.[1]);
  if (fromBody) return fromBody;
  const fromDataset = asString(html.match(/dataset\.catalog\s*=\s*["']([^"']+)["']/i)?.[1]);
  if (fromDataset) return fromDataset;
  const fromJsonPath = asString(html.match(/\/json\/(catalog\.js\/?\?t=[^"'\s<]+)/i)?.[1]);
  if (fromJsonPath) return fromJsonPath;
  return undefined;
};

const toCatalogUrl = (pointer: string): string => {
  if (/^https?:\/\//i.test(pointer)) return pointer;
  const cleaned = pointer.replace(/^\/+/, "");
  if (cleaned.startsWith("json/")) return `${ORIGIN}/${cleaned}`;
  if (cleaned.startsWith("catalog.js")) return `${ORIGIN}/json/${cleaned}`;
  return `${ORIGIN}/json/${cleaned}`;
};

const extractPdfs = (html: string, baseUrl: string): string[] => {
  const out = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+?\.pdf(?:\?[^"']*)?)["']/gi)) {
    const raw = asString(match[1]);
    if (!raw) continue;
    try {
      out.add(new URL(raw, baseUrl).href);
    } catch {
      // ignore
    }
  }
  return Array.from(out);
};

const decodeLanguages = (
  encoded: unknown,
  scriptsMap: Record<string, string>,
  languagesMap: Record<string, string>
): string[] => {
  if (!Array.isArray(encoded)) return [];
  const out: string[] = [];
  for (const row of encoded) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const scriptId = asNumber(row[0]);
    const scriptName = scriptId !== undefined ? scriptsMap[String(scriptId)] : undefined;
    const langIds = Array.isArray(row[1]) ? row[1] : [];
    for (const langRaw of langIds) {
      const langId = asNumber(langRaw);
      if (langId === undefined) continue;
      const langName = languagesMap[String(langId)];
      if (langName && scriptName) out.push(`${scriptName}:${langName}`);
      else if (langName) out.push(langName);
    }
  }
  return dedupe(out);
};

const decodeFeatureTags = (encoded: unknown): string[] => {
  if (!Array.isArray(encoded)) return [];
  const tags: string[] = [];
  for (const group of encoded) {
    if (!Array.isArray(group) || group.length < 2) continue;
    const entries = Array.isArray(group[1]) ? group[1] : [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const maybeTags = Array.isArray(entry[1]) ? entry[1] : [];
      for (const tagRaw of maybeTags) {
        const tag = asString(tagRaw);
        if (tag) tags.push(tag.toLowerCase());
      }
    }
  }
  return dedupe(tags);
};

const buildScopeSegments = (targetUrl: string): string[] => {
  const parsed = new URL(targetUrl);
  const seg = splitPath(parsed.pathname);
  const idx = seg.findIndex((item) => normalizeToken(item) === "catalog");
  return idx >= 0 ? seg.slice(idx + 1) : seg;
};

const fallbackInjectScript = () => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const controls = Array.from(document.querySelectorAll("button,a,[role='button'],[data-style],[data-font],[data-weight]"));
    for (const node of controls.slice(0, 220)) {
      try {
        if (node instanceof HTMLElement) {
          node.scrollIntoView({ behavior: "smooth", block: "center" });
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      } catch {}
      await sleep(70);
    }
    await sleep(1200);
    window.__specimen_commercialtype_probe_done = true;
    window.__specimen_commercialtype_probe_done = true;
  })();
`;

export const CommercialTypeScraper: Scraper = {
  id: "commercialtype",
  name: "Commercial Type Catalog Scraper",

  canHandle(url: string): boolean {
    return /(^|\/\/)(www\.)?commercialtype\.com/i.test(url);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const targetUrl = normalizeUrl(url);
      const html = await fetchText(targetUrl, ORIGIN);
      const specimenPdfUrls = extractPdfs(html, targetUrl);

      const pointer = extractCatalogPointer(html);
      if (!pointer) {
        return {
          scraperName: this.name,
          foundryName: "Commercial Type",
          fonts: [
            {
              url: "browser-intercept",
              family: "Commercial Type",
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: { foundry: "Commercial Type", pageUrl: targetUrl, targetUrl, reason: "catalog-pointer-not-found" }
            }
          ],
          originalUrl: url,
          targetUrl,
          injectScript: fallbackInjectScript(),
          metadata: { foundry: "Commercial Type", family: "Commercial Type", specimenPdfUrls }
        };
      }

      const catalogUrl = toCatalogUrl(pointer);
      const catalog = await fetchJson(catalogUrl, targetUrl);
      const names = Array.isArray(catalog.names) ? catalog.names : [];
      const weights = Array.isArray(catalog.weights) ? catalog.weights : [];

      const scriptsMap: Record<string, string> = isRecord(catalog.scripts)
        ? Object.fromEntries(Object.entries(catalog.scripts).map(([k, v]) => [k, asString(v) || ""]))
        : {};
      const languagesMap: Record<string, string> = isRecord(catalog.languages)
        ? Object.fromEntries(Object.entries(catalog.languages).map(([k, v]) => [k, asString(v) || ""]))
        : {};
      const axesMap = isRecord(catalog.axes) ? (catalog.axes as Record<string, unknown>) : {};

      const styleOptionMap = new Map<number, { suffix: string; position: number }>();
      const styleOptions = Array.isArray(catalog.style_options) ? catalog.style_options : [];
      for (const row of styleOptions) {
        if (!Array.isArray(row)) continue;
        const id = asNumber(row[0]);
        if (id === undefined) continue;
        styleOptionMap.set(id, {
          suffix: asString(row[2]) || "",
          position: asNumber(row[3]) ?? 0
        });
      }

      const collections = new Map<number, { id: number; name: string; slug: string; path: string }>();
      const collectionRows = Array.isArray(catalog.collections) ? catalog.collections : [];
      for (const row of collectionRows) {
        if (!Array.isArray(row)) continue;
        const id = asNumber(row[0]);
        if (id === undefined) continue;
        const name = asString(row[2]) || `Collection ${id}`;
        const slug = toSlug(name);
        collections.set(id, { id, name, slug, path: `/catalog/${slug}` });
      }

      const families = new Map<
        number,
        { id: number; name: string; slug: string; path: string; collectionId: number; styleOptionIds: number[]; languages: string[] }
      >();
      const familyRows = Array.isArray(catalog.families) ? catalog.families : [];
      for (const row of familyRows) {
        if (!Array.isArray(row)) continue;
        const id = asNumber(row[0]);
        if (id === undefined) continue;
        const collectionId = asNumber(row[2]) ?? 0;
        const collection = collections.get(collectionId);
        const name = asString(row[4]) || `Family ${id}`;
        const slug = toSlug(name);
        families.set(id, {
          id,
          name,
          slug,
          collectionId,
          path: collection ? `${collection.path}/${slug}` : `/catalog/${slug}`,
          styleOptionIds: asNumberArray(row[8]),
          languages: decodeLanguages(row[6], scriptsMap, languagesMap)
        });
      }

      const styles: Array<{
        id: number;
        familyId: number;
        collectionId: number;
        familyName: string;
        styleName: string;
        fullName: string;
        path: string;
        webfontBasePath: string;
        weight: number;
        italic: boolean;
        featureTags: string[];
        languages: string[];
        styleOptionSuffixes: string[];
      }> = [];

      const styleRows = Array.isArray(catalog.styles) ? catalog.styles : [];
      for (const row of styleRows) {
        if (!Array.isArray(row)) continue;
        const id = asNumber(row[0]);
        if (id === undefined) continue;

        const familyId = asNumber(row[2]) ?? 0;
        const family = families.get(familyId);
        const familyName = family?.name || asString(row[10]) || "Commercial Type";
        const familySlug = toSlug(familyName);
        const styleName = asString(names[asNumber(row[3]) ?? -1]) || "Regular";
        const styleSlug = toSlug(styleName);
        const path = family ? `${family.path}/${styleSlug}` : `/catalog/${familySlug}/${styleSlug}`;

        const ids = asNumberArray(row[11]);
        const resolvedIds = ids.length > 0 ? ids : family?.styleOptionIds || [];
        const suffixes = resolvedIds
          .map((sid) => ({ sid, info: styleOptionMap.get(sid) }))
          .filter((entry) => !!entry.info)
          .sort((a, b) => (a.info?.position || 0) - (b.info?.position || 0))
          .map((entry) => entry.info?.suffix?.trim() || "")
          .filter(Boolean);
        const suffix = suffixes.length > 0 ? `-${suffixes.join("-")}` : "";

        const webfontBasePath = `/webfonts/${familySlug}/${compact(familyName)}-${compact(styleName)}${suffix}-Web`;
        const weight = asNumber(weights[asNumber(row[5]) ?? -1]) ?? 400;
        const italicForId = asNumber(row[7]) ?? 0;
        const italic = italicForId > 0 || /italic|oblique/i.test(styleName);

        styles.push({
          id,
          familyId,
          collectionId: family?.collectionId ?? 0,
          familyName,
          styleName,
          fullName: `${familyName} ${styleName}`.replace(/\s+/g, " ").trim(),
          path,
          webfontBasePath,
          weight,
          italic,
          featureTags: decodeFeatureTags(row[8]),
          languages: decodeLanguages(row[9], scriptsMap, languagesMap),
          styleOptionSuffixes: suffixes
        });
      }

      const variableFonts: Array<{
        id: number;
        familyId: number;
        collectionId: number;
        familyName: string;
        styleName: string;
        fullName: string;
        webfontBasePath: string;
        italic: boolean;
        axisTags: string[];
        featureTags: string[];
        languages: string[];
      }> = [];

      const vfRows = Array.isArray(catalog.variable_fonts) ? catalog.variable_fonts : [];
      for (const row of vfRows) {
        if (!Array.isArray(row)) continue;
        const id = asNumber(row[0]);
        if (id === undefined) continue;

        const collectionId = asNumber(row[2]) ?? 0;
        const familyId = asNumber(row[3]) ?? 0;
        const family = families.get(familyId);
        const collection = collections.get(collectionId);
        const rawName = asString(row[4]) || `Variable ${id}`;
        const familyName = family?.name || collection?.name || rawName;
        const italicForId = asNumber(row[10]) ?? 0;
        const italic = italicForId > 0 || /italic|oblique/i.test(rawName);
        const styleName = italic ? "Variable Italic" : "Variable";

        const styleOpts = Array.isArray(row[9])
          ? row[9].map((item) => asString(item)).filter((item): item is string => Boolean(item))
          : [];
        const styleOptSuffix = styleOpts.length > 0 ? `-${styleOpts.join("-")}` : "";
        const parentPath = family ? `${toSlug(family.name)}/` : collection ? `${toSlug(collection.name)}/` : "";
        const webfontBasePath = `/webfonts/${parentPath}${compact(rawName)}${styleOptSuffix}-VF-Web`;

        const axisTags = dedupe(
          asNumberArray(row[12])
            .map((axisId) => (isRecord(axesMap[String(axisId)]) ? asString((axesMap[String(axisId)] as any).tag) : undefined))
            .filter((item): item is string => Boolean(item))
        );

        variableFonts.push({
          id,
          familyId,
          collectionId,
          familyName,
          styleName,
          fullName: `${familyName} ${styleName}`.replace(/\s+/g, " ").trim(),
          webfontBasePath,
          italic,
          axisTags,
          featureTags: decodeFeatureTags(row[6]),
          languages: decodeLanguages(row[7], scriptsMap, languagesMap)
        });
      }

      const scopeSegments = buildScopeSegments(targetUrl);

      let scopedStyles: typeof styles = [];
      let scopedFamilies: Array<ReturnType<typeof families.get>> = [];
      let scopedCollections: Array<ReturnType<typeof collections.get>> = [];
      let scopeType: "style" | "family" | "collection" | "fallback" = "fallback";

      const styleExact = styles.filter((style) => pathEq(splitPath(style.path).slice(1), scopeSegments));
      if (styleExact.length > 0) {
        scopeType = "style";
        scopedStyles = styleExact;
      } else {
        const familyExact = Array.from(families.values()).filter((family) => pathEq(splitPath(family.path).slice(1), scopeSegments));
        if (familyExact.length > 0) {
          scopeType = "family";
          const familyIds = new Set(familyExact.map((family) => family.id));
          scopedStyles = styles.filter((style) => familyIds.has(style.familyId));
        } else {
          const collectionExact = Array.from(collections.values()).filter((collection) =>
            pathEq(splitPath(collection.path).slice(1), scopeSegments)
          );
          if (collectionExact.length > 0) {
            scopeType = "collection";
            const collectionIds = new Set(collectionExact.map((collection) => collection.id));
            const familyIds = new Set(
              Array.from(families.values())
                .filter((family) => collectionIds.has(family.collectionId))
                .map((family) => family.id)
            );
            scopedStyles = styles.filter((style) => familyIds.has(style.familyId));
          } else {
            const styleTail = scopeSegments.length >= 2
              ? styles.filter((style) => {
                  const seg = splitPath(style.path).slice(1);
                  return seg.length >= 2 && pathEq(seg.slice(-2), scopeSegments.slice(-2));
                })
              : [];
            if (styleTail.length > 0) {
              scopeType = "style";
              scopedStyles = styleTail;
            }
          }
        }
      }

      if (scopedStyles.length === 0) {
        scopedStyles = styles.slice(0, 64);
        scopeType = "fallback";
      }

      const familyIds = new Set(scopedStyles.map((style) => style.familyId));
      const collectionIds = new Set(scopedStyles.map((style) => style.collectionId).filter((id) => id > 0));
      scopedFamilies = Array.from(families.values()).filter((family) => familyIds.has(family.id));
      scopedCollections = Array.from(collections.values()).filter((collection) => collectionIds.has(collection.id));

      const scopedVariables = variableFonts.filter(
        (vf) => familyIds.has(vf.familyId) || (vf.collectionId > 0 && collectionIds.has(vf.collectionId))
      );

      const expectedStyles = dedupe(scopedStyles.map((style) => style.fullName));
      const expectedVariableStyles = dedupe(scopedVariables.map((style) => style.fullName));
      const supportedLanguages = dedupe([
        ...scopedStyles.flatMap((style) => style.languages),
        ...scopedVariables.flatMap((vf) => vf.languages)
      ]);
      const catalogFeatureTags = dedupe([
        ...scopedStyles.flatMap((style) => style.featureTags),
        ...scopedVariables.flatMap((vf) => vf.featureTags)
      ]).map((tag) => tag.toLowerCase());

      const targetProfile = {
        profileId: "commercialtype-target-profile-v1",
        source: "commercialtype-html-data-catalog+catalog-json",
        foundry: "Commercial Type",
        styleScope: "family-style",
        strictMissingStyles: true,
        requiredFeatureTags: [],
        catalogFeatureTags,
        targetUrl,
        catalogUrl,
        scopeType,
        catalogSegments: scopeSegments,
        collectionSlug: scopedCollections[0]?.slug,
        collectionFamilyCount: scopedFamilies.length,
        collectionFamilies: scopedFamilies.map((family) => family?.name).filter(Boolean),
        expectedStyles,
        expectedStyleCount: expectedStyles.length,
        expectedVariableStyles,
        expectedVariableStyleCount: expectedVariableStyles.length,
        styleMap: scopedStyles.map((style) => ({
          id: style.id,
          familyId: style.familyId,
          collectionId: style.collectionId,
          familyName: style.familyName,
          styleName: style.styleName,
          expectedStyle: style.fullName,
          path: style.path,
          style: style.italic ? "Italic" : "Normal",
          weight: style.weight,
          styleOptionSuffixes: style.styleOptionSuffixes,
          webfontBasePath: style.webfontBasePath
        })),
        variableMap: scopedVariables.map((vf) => ({
          id: vf.id,
          familyId: vf.familyId,
          collectionId: vf.collectionId,
          familyName: vf.familyName,
          styleName: vf.styleName,
          expectedStyle: vf.fullName,
          style: vf.italic ? "Italic" : "Normal",
          axisTags: vf.axisTags,
          webfontBasePath: vf.webfontBasePath
        })),
        supportedLanguages,
        specimenPdfUrls,
        collectedAt: new Date().toISOString()
      };

      const fonts: FontMetadata[] = [];
      const seenUrls = new Set<string>();
      const push = (font: FontMetadata) => {
        if (seenUrls.has(font.url)) return;
        seenUrls.add(font.url);
        fonts.push(font);
      };

      for (const style of scopedStyles) {
        const assetUrl = new URL(ORIGIN);
        assetUrl.pathname = `${style.webfontBasePath}.woff2`;
        push({
          url: assetUrl.href,
          family: style.familyName,
          format: "woff2",
          style: style.italic ? "Italic" : "Normal",
          weight: style.weight,
          downloadable: true,
          note: "Commercial Type webfont (catalog style).",
          metadata: {
            foundry: "Commercial Type",
            pageUrl: targetUrl,
            targetUrl,
            family: style.familyName,
            styleName: style.styleName,
            fullName: style.fullName,
            styleId: style.id,
            familyId: style.familyId,
            collectionId: style.collectionId,
            featureTags: style.featureTags,
            supportedLanguages: style.languages,
            targetProfile,
            headers: { Origin: ORIGIN, Referer: targetUrl, Accept: "*/*" }
          }
        });
      }

      for (const vf of scopedVariables) {
        const assetUrl = new URL(ORIGIN);
        assetUrl.pathname = `${vf.webfontBasePath}.woff2`;
        push({
          url: assetUrl.href,
          family: vf.familyName,
          format: "woff2",
          style: vf.italic ? "Italic" : "Normal",
          weight: "Variable",
          downloadable: true,
          note: "Commercial Type variable webfont.",
          metadata: {
            foundry: "Commercial Type",
            pageUrl: targetUrl,
            targetUrl,
            family: vf.familyName,
            styleName: vf.styleName,
            fullName: vf.fullName,
            variableFontId: vf.id,
            familyId: vf.familyId,
            collectionId: vf.collectionId,
            axisTags: vf.axisTags,
            featureTags: vf.featureTags,
            supportedLanguages: vf.languages,
            targetProfile,
            headers: { Origin: ORIGIN, Referer: targetUrl, Accept: "*/*" }
          }
        });
      }

      if (fonts.length === 0) {
        return {
          scraperName: this.name,
          foundryName: "Commercial Type",
          fonts: [
            {
              url: "browser-intercept",
              family: "Commercial Type",
              format: "woff2",
              style: "Normal",
              weight: "Regular",
              downloadable: true,
              metadata: {
                foundry: "Commercial Type",
                pageUrl: targetUrl,
                targetUrl,
                targetProfile,
                reason: "no-fonts-after-catalog-resolve"
              }
            }
          ],
          originalUrl: url,
          targetUrl,
          injectScript: fallbackInjectScript(),
          metadata: { foundry: "Commercial Type", family: "Commercial Type", targetProfile, specimenPdfUrls }
        };
      }

      return {
        scraperName: this.name,
        foundryName: "Commercial Type",
        fonts,
        originalUrl: url,
        targetUrl,
        expectedCount: expectedStyles.length || fonts.length,
        metadata: {
          foundry: "Commercial Type",
          family: scopedFamilies[0]?.name || scopedStyles[0]?.familyName || scopedVariables[0]?.familyName || "Commercial Type",
          targetProfile,
          specimenPdfUrls,
          catalogUrl
        }
      };
    } catch (error) {
      console.error("[CommercialTypeScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "Commercial Type",
        fonts: [],
        originalUrl: url
      };
    }
  }
};











