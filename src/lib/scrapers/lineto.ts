import { Scraper, ScrapeResult } from "./types";

const LINETO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const LINETO_ORIGIN = "https://lineto.com";

const toSafeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const normalizeCompareToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const str = asString(item);
    if (!str) continue;
    out.push(str);
  }
  return out;
};

const extractFamilySlug = (url: URL): string => {
  const parts = url.pathname
    .split("/")
    .filter((part) => part && part !== "typefaces" && part !== "en");
  return parts.length > 0 ? parts[parts.length - 1] : "lineto-font";
};

const toReadableFamily = (slug: string): string =>
  slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || "Lineto Font";

const extractLinetoPostscriptNames = (html: string, familySlug: string): string[] => {
  const familyTokens = new Set<string>();
  const slugParts = familySlug.split("-").filter(Boolean);
  familyTokens.add(toSafeToken(familySlug));
  if (slugParts.length > 0) familyTokens.add(toSafeToken(slugParts[0]));
  if (slugParts.length > 1) familyTokens.add(toSafeToken(`${slugParts[0]}${slugParts[1]}`));
  const orderedTokens = Array.from(familyTokens)
    .filter((token) => token.length >= 4)
    .sort((a, b) => b.length - a.length);

  const styleHint = /(thin|light|regular|book|roman|medium|semi|demi|bold|black|heavy|italic|mono|var|variable)/i;
  const candidates = new Set<string>();
  for (const match of html.matchAll(/\b([A-Z][A-Za-z0-9]{2,}(?:-[A-Za-z0-9]+)+)\b/g)) {
    const name = String(match[1] || "").trim();
    if (!name || !styleHint.test(name)) continue;
    const collapsed = toSafeToken(name);
    if (!collapsed) continue;
    if (!orderedTokens.some((token) => collapsed.startsWith(token))) continue;
    candidates.add(name);
  }
  return Array.from(candidates).sort();
};

const extractLinetoStylesFromPostscript = (postscriptNames: string[]): string[] => {
  const styles = new Set<string>();
  for (const ps of postscriptNames) {
    const idx = ps.indexOf("-");
    if (idx < 0) continue;
    const style = ps.slice(idx + 1).trim();
    if (!style) continue;
    styles.add(style);
  }
  return Array.from(styles);
};

type LinetoFamilySummary = {
  id: number;
  name: string;
  ref: string;
  refs: string[];
  overviewShowItalics?: boolean;
  technicalTabEnabled?: boolean;
  documentNames: string[];
};

type LinetoFamilyCut = {
  postscriptName: string;
  styleName: string;
  setName?: string;
  setRef?: string;
};

type LinetoProbeEntry = {
  postscriptName: string;
  available: boolean;
  status?: number;
  note?: string;
};

const extractOgTitle = (html: string): string => {
  const match = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  return match?.[1]?.trim() || "";
};

const extractStyleFromPostscript = (postscriptName: string): string => {
  const idx = postscriptName.indexOf("-");
  if (idx < 0) return "";
  return postscriptName.slice(idx + 1).trim();
};

const parseFamilySummaries = (payload: unknown): LinetoFamilySummary[] => {
  if (!Array.isArray(payload)) return [];
  const out: LinetoFamilySummary[] = [];
  for (const item of payload) {
    if (!isRecord(item)) continue;
    const idRaw = Number(item.id);
    if (!Number.isFinite(idRaw) || idRaw <= 0) continue;
    const name = asString(item.name);
    const ref = asString(item.ref);
    const refs = asStringArray(item.refs);
    const overview = isRecord(item.overview) ? item.overview : undefined;
    const tabs = isRecord(item.tabs) ? item.tabs : undefined;
    const documents = Array.isArray(item.documents) ? item.documents : [];
    const documentNames = documents
      .map((doc) => (isRecord(doc) ? asString(doc.name) : ""))
      .filter(Boolean);
    if (ref && !refs.includes(ref)) refs.push(ref);
    out.push({
      id: idRaw,
      name: name || `Lineto Family ${idRaw}`,
      ref,
      refs,
      overviewShowItalics:
        typeof overview?.showItalics === "boolean" ? (overview.showItalics as boolean) : undefined,
      technicalTabEnabled:
        typeof tabs?.showTechnical === "boolean" ? (tabs.showTechnical as boolean) : undefined,
      documentNames
    });
  }
  return out;
};

const scoreFamilyCandidate = (
  family: LinetoFamilySummary,
  familySlug: string,
  familySlugToken: string,
  ogTitleToken: string
): number => {
  let score = 0;
  const refToken = normalizeCompareToken(family.ref);
  const refTokens = family.refs.map(normalizeCompareToken).filter(Boolean);
  const nameToken = normalizeCompareToken(family.name);

  if (family.ref === familySlug) score += 140;
  if (family.refs.includes(familySlug)) score += 130;
  if (refToken && refToken === familySlugToken) score += 120;
  if (refTokens.includes(familySlugToken)) score += 110;

  if (ogTitleToken && nameToken === ogTitleToken) score += 120;
  if (ogTitleToken && refToken === ogTitleToken) score += 90;

  if (familySlugToken && refToken && familySlugToken.includes(refToken) && refToken.length >= 4) score += 70;
  if (ogTitleToken && nameToken && (nameToken.includes(ogTitleToken) || ogTitleToken.includes(nameToken))) score += 50;

  return score;
};

const pickBestFamilyCandidate = (
  families: LinetoFamilySummary[],
  familySlug: string,
  ogTitle: string
): LinetoFamilySummary | undefined => {
  const familySlugToken = normalizeCompareToken(familySlug);
  const ogTitleToken = normalizeCompareToken(ogTitle);
  let best: LinetoFamilySummary | undefined;
  let bestScore = 0;
  for (const family of families) {
    const score = scoreFamilyCandidate(family, familySlug, familySlugToken, ogTitleToken);
    if (score > bestScore) {
      best = family;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : undefined;
};

const parseFamilyCuts = (payload: unknown): LinetoFamilyCut[] => {
  if (!isRecord(payload)) return [];
  const shopSets = Array.isArray(payload.fontShopSets) ? payload.fontShopSets : [];
  const out: LinetoFamilyCut[] = [];
  for (const set of shopSets) {
    if (!isRecord(set)) continue;
    const setName = asString(set.name);
    const setRef = asString(set.ref);
    const cuts = Array.isArray(set.fontCuts) ? set.fontCuts : [];
    for (const cut of cuts) {
      if (!isRecord(cut)) continue;
      const postscriptName = asString(cut.postscriptName);
      if (!postscriptName) continue;
      const styleName = asString(cut.name) || extractStyleFromPostscript(postscriptName);
      out.push({
        postscriptName,
        styleName,
        setName: setName || undefined,
        setRef: setRef || undefined
      });
    }
  }
  return out;
};

const fetchJson = async (url: string): Promise<unknown | undefined> => {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": LINETO_UA,
        Accept: "application/json, text/plain, */*",
        Origin: LINETO_ORIGIN,
        Referer: LINETO_ORIGIN
      }
    });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
};

const buildItalicProbeCandidates = (postscriptNames: string[]): string[] => {
  const out = new Set<string>();
  for (const postscriptName of postscriptNames) {
    const idx = postscriptName.indexOf("-");
    if (idx < 0) continue;
    const familyPart = postscriptName.slice(0, idx);
    const stylePart = postscriptName.slice(idx + 1);
    if (!familyPart || !stylePart) continue;
    if (/italic|oblique/i.test(stylePart)) continue;

    const italicStyle = /^regular$/i.test(stylePart) ? "Italic" : `${stylePart}Italic`;
    out.add(`${familyPart}-${italicStyle}`);
  }
  return Array.from(out);
};

const probeLinetoPostscriptNames = async (params: {
  pageUrl: string;
  postscriptNames: string[];
}): Promise<LinetoProbeEntry[]> => {
  const { pageUrl, postscriptNames } = params;
  const out: LinetoProbeEntry[] = [];

  for (const postscriptName of postscriptNames) {
    try {
      const endpoint = `${LINETO_ORIGIN}/api/front/font-cuts/web-font?postscriptNames=${encodeURIComponent(postscriptName)}`;
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": LINETO_UA,
          Accept: "*/*",
          Origin: LINETO_ORIGIN,
          Referer: pageUrl
        }
      });

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const bytes = Buffer.from(await response.arrayBuffer());
      const isJsonLike = contentType.includes("json") || bytes.subarray(0, 1).toString("utf8") === "{";
      const isXmlLike =
        contentType.includes("xml") ||
        bytes.subarray(0, 5).toString("utf8").toLowerCase().startsWith("<?xml");
      const likelyFontPayload = response.ok && bytes.length > 1024 && !isJsonLike && !isXmlLike;

      out.push({
        postscriptName,
        available: likelyFontPayload,
        status: response.status,
        note: likelyFontPayload
          ? undefined
          : `${response.status}${contentType ? ` ${contentType}` : ""}`
      });
    } catch (error) {
      out.push({
        postscriptName,
        available: false,
        note: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return out;
};

const buildLinetoTargetProfile = async (params: {
  pageUrl: string;
  familySlug: string;
  fallbackFamilyName: string;
  html: string;
}): Promise<{
  familyName: string;
  targetProfile: Record<string, unknown>;
}> => {
  const { pageUrl, familySlug, fallbackFamilyName, html } = params;
  const ogTitle = extractOgTitle(html);

  const familyListPayload = await fetchJson(`${LINETO_ORIGIN}/api/front/font-families`);
  const summaries = parseFamilySummaries(familyListPayload);
  const selectedFamily = pickBestFamilyCandidate(summaries, familySlug, ogTitle);

  if (selectedFamily) {
    const detailPayload = await fetchJson(`${LINETO_ORIGIN}/api/front/font-families/${selectedFamily.id}`);
    const cuts = parseFamilyCuts(detailPayload);
    const detailRecord = isRecord(detailPayload) ? detailPayload : undefined;
    const detailOverview = detailRecord && isRecord(detailRecord.overview) ? detailRecord.overview : undefined;
    const detailTabs = detailRecord && isRecord(detailRecord.tabs) ? detailRecord.tabs : undefined;
    const detailDocuments = detailRecord && Array.isArray(detailRecord.documents) ? detailRecord.documents : [];
    const detailDocumentNames = detailDocuments
      .map((doc) => (isRecord(doc) ? asString(doc.name) : ""))
      .filter(Boolean);
    if (cuts.length > 0) {
      const expectedPostscriptNames: string[] = [];
      const seenPostscript = new Set<string>();
      const expectedStyles: string[] = [];
      const seenStyles = new Set<string>();
      const shopSetRefs = new Set<string>();

      for (const cut of cuts) {
        const normalizedPs = normalizeCompareToken(cut.postscriptName);
        if (normalizedPs && !seenPostscript.has(normalizedPs)) {
          seenPostscript.add(normalizedPs);
          expectedPostscriptNames.push(cut.postscriptName);
        }
        const normalizedStyle = normalizeCompareToken(cut.styleName);
        if (normalizedStyle && !seenStyles.has(normalizedStyle)) {
          seenStyles.add(normalizedStyle);
          expectedStyles.push(cut.styleName);
        }
        if (cut.setRef) shopSetRefs.add(cut.setRef);
      }

      const hasCatalogItalicStyles = expectedStyles.some((style) => /italic|oblique/i.test(style));
      const italicProbeCandidates = hasCatalogItalicStyles
        ? []
        : buildItalicProbeCandidates(expectedPostscriptNames).slice(0, 12);
      const italicProbeResults =
        italicProbeCandidates.length > 0
          ? await probeLinetoPostscriptNames({
              pageUrl,
              postscriptNames: italicProbeCandidates
            })
          : [];

      const familyDisplay = selectedFamily.name || ogTitle || fallbackFamilyName;
      return {
        familyName: familyDisplay,
        targetProfile: {
          profileId: "lineto-target-profile-v2",
          foundry: "Lineto",
          targetUrl: pageUrl,
          targetSlug: familySlug,
          familyDisplay,
          familyId: selectedFamily.id,
          familyRef: selectedFamily.ref,
          familyRefs: selectedFamily.refs,
          shopSetRefs: Array.from(shopSetRefs),
          catalogShowItalics:
            typeof detailOverview?.showItalics === "boolean"
              ? (detailOverview.showItalics as boolean)
              : selectedFamily.overviewShowItalics,
          catalogTechnicalTabEnabled:
            typeof detailTabs?.showTechnical === "boolean"
              ? (detailTabs.showTechnical as boolean)
              : selectedFamily.technicalTabEnabled,
          catalogDocuments:
            detailDocumentNames.length > 0 ? detailDocumentNames : selectedFamily.documentNames,
          italicProbe: {
            attempted: italicProbeCandidates,
            available: italicProbeResults.filter((item) => item.available).map((item) => item.postscriptName),
            unavailable: italicProbeResults.filter((item) => !item.available),
            checkedAt: new Date().toISOString()
          },
          expectedPostscriptNames,
          expectedPostscriptCount: expectedPostscriptNames.length,
          expectedStyles,
          expectedStyleCount: expectedStyles.length,
          collectedAt: new Date().toISOString(),
          source: "lineto-font-families-api"
        }
      };
    }
  }

  const expectedPostscriptNames = extractLinetoPostscriptNames(html, familySlug);
  const expectedStyles = extractLinetoStylesFromPostscript(expectedPostscriptNames);
  const familyDisplay = ogTitle || fallbackFamilyName;
  return {
    familyName: familyDisplay,
    targetProfile: {
      profileId: "lineto-target-profile-v1",
      foundry: "Lineto",
      targetUrl: pageUrl,
      targetSlug: familySlug,
      familyDisplay,
      expectedPostscriptNames,
      expectedPostscriptCount: expectedPostscriptNames.length,
      expectedStyles,
      expectedStyleCount: expectedStyles.length,
      collectedAt: new Date().toISOString(),
      source: "html-postscript-scan"
    }
  };
};

export const LinetoScraper: Scraper = {
  id: "lineto",
  name: "Lineto Premium Extractor",

  canHandle(url: string): boolean {
    return url.includes("lineto.com");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    try {
      const urlObj = new URL(url);
      const familySlug = extractFamilySlug(urlObj);
      const fallbackFamilyName = toReadableFamily(familySlug);
      let html = "";
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": LINETO_UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          }
        });
        if (response.ok) html = await response.text();
      } catch {
        html = "";
      }

      const { familyName, targetProfile } = await buildLinetoTargetProfile({
        pageUrl: url,
        familySlug,
        fallbackFamilyName,
        html
      });

      const injectScript = `
        (async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const scriptTabHint = /^(latin|cyrillic|greek|vietnamese|paneuro|arabic|hebrew|devanagari)$/i;
          console.log("[Lineto-Saka] Focused script-tab sweep activated.");

          // Populate editable preview fields without touching navigation actions.
          const testString = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()";
          const editable = Array.from(document.querySelectorAll('input, textarea, [contenteditable=\"true\"], [contenteditable]'));
          for (const field of editable) {
            try {
              if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
                field.focus();
                field.value = testString;
                field.dispatchEvent(new Event("input", { bubbles: true }));
                field.dispatchEvent(new Event("change", { bubbles: true }));
              } else {
                field.textContent = testString;
                field.dispatchEvent(new Event("input", { bubbles: true }));
              }
            } catch {}
          }

          // Click only script/language tabs that do not navigate away from current page.
          const candidates = Array.from(document.querySelectorAll('.octo__link, button, [role=\"button\"]'));
          const seen = new Set();
          for (const candidate of candidates) {
            try {
              const label = ((candidate.textContent || "") + " " + (candidate.getAttribute?.("aria-label") || ""))
                .replace(/\\s+/g, " ")
                .trim();
              if (!label) continue;
              if (!scriptTabHint.test(label)) continue;
              if (candidate instanceof HTMLAnchorElement && candidate.getAttribute("href")) continue;

              const key = label.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);

              candidate.scrollIntoView({ behavior: "instant", block: "center" });
              candidate.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
              candidate.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
              candidate.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
              if (candidate instanceof HTMLElement) candidate.click();
              await sleep(420);
            } catch {}
          }

          // Hover preview areas to trigger lazy font fetches without opening other feature modules.
          const previewNodes = Array.from(
            document.querySelectorAll('[class*=\"specimen\" i], [class*=\"preview\" i], [class*=\"box\" i], [data-font]')
          );
          for (const node of previewNodes.slice(0, 24)) {
            try {
              node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
              await sleep(80);
            } catch {}
          }

          // Force text rendering in hidden layer to make browser request active cuts.
          const node = document.createElement('div');
          node.style.cssText = 'position:fixed;top:0;left:0;opacity:0.01;pointer-events:none;z-index:-1;font-size:32px;';
          node.innerText = testString;
          document.body.appendChild(node);

          for (let pass = 1; pass <= 3; pass++) {
            window.scrollTo(0, Math.floor((document.body.scrollHeight * pass) / 3));
            await sleep(260);
          }
          window.scrollTo(0, 0);
          await sleep(1200);
        })();
      `;

      return {
        scraperName: this.name,
        foundryName: "Lineto",
        fonts: [
          {
            url: "browser-intercept",
            family: familyName,
            format: "woff2",
            weight: "Regular",
            style: "Normal",
            downloadable: true,
            metadata: {
              pageUrl: url,
              targetProfile
            }
          }
        ],
        originalUrl: url,
        targetUrl: url,
        injectScript,
        metadata: {
          targetProfile
        }
      };
    } catch (e) {
      console.error("Lineto Scraper Error:", e);
      return { 
        scraperName: this.name, 
        foundryName: "Lineto", 
        fonts: [], 
        originalUrl: url 
      };
    }
  }
};
