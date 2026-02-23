import { Scraper, ScrapeResult } from "./types";

const DISPLAAY_HOST = "displaay.net";
const DISPLAAY_API = "https://displaay.net/api/global-data";
const DISPLAAY_WORKER = "https://w.displaay.net";
const DISPLAAY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const DISPLAAY_FETCH_TIMEOUT_MS = 20000;
const DISPLAAY_FETCH_MAX_RETRIES = 3;

type DisplaayAxis = { name?: string; value?: number };
type DisplaayInstance = {
  id?: string;
  name?: string;
  key?: string;
  axes?: DisplaayAxis[];
  family?: { id?: string; name?: string };
};
type DisplaayGlyphFamily = {
  family?: {
    id?: string;
    name?: string;
    instances?: DisplaayInstance[];
  };
};
type DisplaayTypefaceFamily = {
  id?: string;
  name?: string;
  presentableName?: string;
  slug?: string;
  glyphsFamilies?: DisplaayGlyphFamily[];
};
type DisplaayCollection = {
  id?: string;
  name?: string;
  slug?: string;
  languageGroup?: string;
  typefaceFamilies?: DisplaayTypefaceFamily[];
};
type DisplaayTypeface = {
  id?: string;
  name?: string;
  link?: { url?: string };
  typefaceCollections?: DisplaayCollection[];
};
type DisplaayGlobalData = {
  typefaces?: DisplaayTypeface[];
};

type ResolvedInstance = {
  id: string;
  name: string;
  familyName: string;
  weight: string | number;
  style: string;
  sourceFamilyId?: string;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const normalizeToken = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const toReadableWords = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .trim();

const extractFamilySlug = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] === "typeface" && segments[1]) return segments[1].toLowerCase();
    return undefined;
  } catch {
    return undefined;
  }
};

const extractSubFamilySlug = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] === "typeface" && segments[2]) return segments[2].toLowerCase();
    return undefined;
  } catch {
    return undefined;
  }
};

const parseWeightFromStyle = (style: string): string | number | undefined => {
  const token = normalizeToken(style);
  if (/hairline|thin/.test(token)) return "Thin";
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
  return undefined;
};

const parseWeightFromAxes = (axes: DisplaayAxis[] | undefined): number | undefined => {
  if (!Array.isArray(axes)) return undefined;
  for (const axis of axes) {
    if (!axis) continue;
    if (normalizeToken(String(axis.name || "")) !== "wght") continue;
    const value = Number(axis.value);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
};

const inferStyleLabel = (name: string, axes: DisplaayAxis[] | undefined): string => {
  const normalized = name.replace(/\s+/g, " ").trim();
  if (normalized) return normalized;

  const weight = parseWeightFromAxes(axes) || 400;
  const italic = Array.isArray(axes)
    ? axes.some((axis) => normalizeToken(String(axis?.name || "")) === "ital" && Number(axis?.value) >= 1)
    : false;

  const weightLabel =
    weight <= 100
      ? "Thin"
      : weight <= 200
        ? "ExtraLight"
        : weight <= 300
          ? "Light"
          : weight <= 400
            ? "Regular"
            : weight <= 500
              ? "Medium"
              : weight <= 600
                ? "SemiBold"
                : weight <= 700
                  ? "Bold"
                  : weight <= 800
                    ? "ExtraBold"
                    : "Black";

  return italic ? `${weightLabel} Italic` : weightLabel;
};

const normalizeFamilyLabel = (typefaceName: string, rawFamilyName: string): string => {
  const typeface = asString(typefaceName) || "Displaay";
  const familyRaw = asString(rawFamilyName) || typeface;
  const familyNoItalic = familyRaw.replace(/\s+italic$/i, "").trim() || typeface;

  const typeToken = normalizeToken(typeface);
  const famToken = normalizeToken(familyNoItalic);

  if (!famToken) return typeface;
  if (famToken === typeToken) return typeface;
  if (famToken.startsWith(typeToken)) return familyNoItalic;

  return `${typeface} ${familyNoItalic}`;
};

const fetchGlobalDataWithRetry = async (): Promise<DisplaayGlobalData> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DISPLAAY_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISPLAAY_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(DISPLAAY_API, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "User-Agent": DISPLAAY_UA,
          Accept: "application/json,text/plain,*/*",
          Origin: "https://displaay.net",
          Referer: "https://displaay.net/typefaces"
        }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const json = (await response.json()) as DisplaayGlobalData;
      if (!json || !Array.isArray(json.typefaces)) {
        throw new Error("Displaay API returned invalid shape");
      }
      return json;
    } catch (error) {
      lastError = error;
      if (attempt < DISPLAAY_FETCH_MAX_RETRIES) {
        await sleep(600 * attempt);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to fetch Displaay global data");
};

const resolveTypeface = (typefaces: DisplaayTypeface[], familySlug: string): DisplaayTypeface | undefined => {
  const slugToken = normalizeToken(familySlug);
  const byLink = typefaces.find((item) => {
    const url = asString(item?.link?.url);
    if (!url) return false;
    return normalizeToken(url) === normalizeToken(`/typeface/${familySlug}`);
  });
  if (byLink) return byLink;

  const byName = typefaces.find((item) => normalizeToken(asString(item?.name)) === slugToken);
  if (byName) return byName;

  return typefaces.find((item) => normalizeToken(asString(item?.link?.url)).includes(slugToken));
};

const resolveCollection = (
  collections: DisplaayCollection[],
  familySlug: string,
  subFamilySlug?: string
): DisplaayCollection | undefined => {
  if (collections.length === 0) return undefined;

  if (subFamilySlug) {
    const subToken = normalizeToken(subFamilySlug);
    const bySub = collections.find((col) => normalizeToken(asString(col.slug)) === subToken);
    if (bySub) return bySub;

    const bySubName = collections.find((col) => normalizeToken(asString(col.name)).includes(subToken));
    if (bySubName) return bySubName;
  }

  const famToken = normalizeToken(familySlug);
  const bySlug = collections.find((col) => normalizeToken(asString(col.slug)) === famToken);
  if (bySlug) return bySlug;

  const byName = collections.find((col) => normalizeToken(asString(col.name)) === famToken);
  if (byName) return byName;

  return collections[0];
};

const collectCollectionInstances = (
  collection: DisplaayCollection,
  typefaceName: string
): ResolvedInstance[] => {
  const out = new Map<string, ResolvedInstance>();
  const families = Array.isArray(collection.typefaceFamilies) ? collection.typefaceFamilies : [];

  for (const family of families) {
    const fallbackFamilyRaw = asString(family.presentableName) || asString(family.name) || typefaceName;
    const glyphsFamilies = Array.isArray(family.glyphsFamilies) ? family.glyphsFamilies : [];

    for (const glyphs of glyphsFamilies) {
      const glyphFamily = isRecord(glyphs.family) ? glyphs.family : undefined;
      const sourceFamilyRaw =
        asString(glyphFamily?.name) ||
        fallbackFamilyRaw ||
        typefaceName;
      const sourceFamilyLabel = normalizeFamilyLabel(typefaceName, sourceFamilyRaw);

      const instances = Array.isArray(glyphFamily?.instances) ? glyphFamily.instances : [];
      for (const instance of instances) {
        const id = asString(instance?.id);
        if (!id) continue;

        const style = inferStyleLabel(asString(instance?.name) || asString(instance?.key), instance?.axes);
        const styleWeight = parseWeightFromStyle(style);
        const axisWeight = parseWeightFromAxes(instance?.axes);
        const weight = styleWeight ?? axisWeight ?? "Regular";

        const next: ResolvedInstance = {
          id,
          name: style,
          familyName: sourceFamilyLabel,
          weight,
          style,
          sourceFamilyId: asString(glyphFamily?.id) || undefined
        };

        const prev = out.get(id);
        if (!prev || (prev.name === "Regular" && next.name !== "Regular")) {
          out.set(id, next);
        }
      }
    }
  }

  return Array.from(out.values());
};

export const DisplaayScraper: Scraper = {
  id: "displaay",
  name: "Displaay Type Foundry Scraper",

  canHandle(url: string): boolean {
    return url.includes(DISPLAAY_HOST);
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const familySlug = extractFamilySlug(url);
      const subFamilySlug = extractSubFamilySlug(url);

      if (!familySlug) {
        return {
          scraperName: this.name,
          foundryName: "Displaay Type Foundry",
          fonts: [],
          originalUrl: url
        };
      }

      const fallbackFamily = toReadableWords(familySlug);
      const globalData = await fetchGlobalDataWithRetry();
      const typefaces = Array.isArray(globalData.typefaces) ? globalData.typefaces : [];
      const typeface = resolveTypeface(typefaces, familySlug);

      if (!typeface) {
        return {
          scraperName: this.name,
          foundryName: "Displaay Type Foundry",
          fonts: [],
          originalUrl: url,
          targetUrl: url,
          metadata: {
            foundry: "Displaay Type Foundry",
            family: fallbackFamily,
            reason: `Target typeface not found in Displaay global-data: ${familySlug}`
          }
        };
      }

      const typefaceName = asString(typeface.name) || fallbackFamily;
      const collections = Array.isArray(typeface.typefaceCollections) ? typeface.typefaceCollections : [];
      const collection = resolveCollection(collections, familySlug, subFamilySlug);

      if (!collection) {
        return {
          scraperName: this.name,
          foundryName: "Displaay Type Foundry",
          fonts: [],
          originalUrl: url,
          targetUrl: url,
          metadata: {
            foundry: "Displaay Type Foundry",
            family: typefaceName,
            reason: `No collection found for target: ${familySlug}${subFamilySlug ? `/${subFamilySlug}` : ""}`
          }
        };
      }

      const instances = collectCollectionInstances(collection, typefaceName);
      const styles = Array.from(new Set(instances.map((item) => item.style).filter(Boolean)));
      const instanceIds = instances.map((item) => item.id);

      const targetProfile = {
        profileId: "displaay-target-profile-v2",
        source: "global-data-typefaceCollections",
        foundry: "Displaay Type Foundry",
        targetUrl: url,
        targetSlug: familySlug,
        subFamilySlug: subFamilySlug || undefined,
        typefaceId: asString(typeface.id) || undefined,
        typefaceName,
        collectionId: asString(collection.id) || undefined,
        collectionSlug: asString(collection.slug) || undefined,
        collectionName: asString(collection.name) || typefaceName,
        collectionLanguageGroup: asString(collection.languageGroup) || undefined,
        collectionFamilyCount: Array.isArray(collection.typefaceFamilies) ? collection.typefaceFamilies.length : 0,
        expectedStyles: styles,
        expectedStyleCount: styles.length,
        expectedInstanceIds: instanceIds,
        expectedInstanceCount: instanceIds.length,
        workerHost: DISPLAAY_WORKER,
        collectedAt: new Date().toISOString()
      };

      const fonts = instances.map((item) => ({
        url: `${DISPLAAY_WORKER}/tester/file/instance/${item.id}/ttf`,
        family: item.familyName,
        format: "ttf" as const,
        style: item.style,
        weight: item.weight,
        downloadable: true,
        metadata: {
          foundry: "Displaay Type Foundry",
          pageUrl: url,
          family: item.familyName,
          style: item.style,
          weight: item.weight,
          instanceId: item.id,
          instanceName: item.name,
          sourceFamilyId: item.sourceFamilyId,
          targetProfile,
          headers: {
            Origin: "https://displaay.net",
            Referer: url,
            Accept: "*/*"
          }
        }
      }));

      return {
        scraperName: this.name,
        foundryName: "Displaay Type Foundry",
        fonts,
        originalUrl: url,
        targetUrl: url,
        expectedCount: fonts.length,
        metadata: {
          foundry: "Displaay Type Foundry",
          family: typefaceName,
          targetProfile
        }
      };
    } catch (error) {
      console.error("[DisplaayScraper] Error:", error);
      return {
        scraperName: this.name,
        foundryName: "Displaay Type Foundry",
        fonts: [],
        originalUrl: url
      };
    }
  }
};
