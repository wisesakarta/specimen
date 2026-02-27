import { Scraper, ScrapeResult } from "./types";

const DEFAULT_FAMILY = "MM205 Var";
const CANONICAL_HOST = "www.205.tf";
const KNOWN_HOSTS = new Set(["205.tf", "www.205.tf", "250.tf", "www.250.tf"]);
const RESERVED_ROOT_PATHS = new Set([
  "typefaces",
  "collection",
  "designers",
  "articles",
  "eula",
  "customs",
  "irregular",
  "about",
  "contact",
  "faq",
  "technical-specifications",
  "legal",
  "terms-and-conditions-of-sale",
  "privacy-policy",
  "account",
  "cart"
]);
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const toReadableFamily = (value: string): string =>
  value
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || DEFAULT_FAMILY;

const normalizeSourceUrl = (rawUrl: string): URL => {
  const parsed = new URL(rawUrl);
  if (KNOWN_HOSTS.has(parsed.hostname.toLowerCase())) {
    parsed.protocol = "https:";
    parsed.hostname = CANONICAL_HOST;
  }
  return parsed;
};

const toCleanPath = (pathname: string): string => {
  const clean = pathname.trim().replace(/\/{2,}/g, "/");
  if (!clean || clean === "/") return "/";
  return clean.endsWith("/") ? clean.slice(0, -1) : clean;
};

const getPathHead = (pathname: string): string => {
  const head = toCleanPath(pathname).split("/").filter(Boolean)[0];
  return (head || "").toLowerCase();
};

const fetchCatalogSlugs = async (origin: string): Promise<Set<string>> => {
  try {
    const res = await fetch(`${origin}/typefaces`, {
      headers: { "User-Agent": BROWSER_UA }
    });
    if (!res.ok) return new Set();
    const html = await res.text();
    const slugs = new Set<string>();
    const patterns = [/"slug":"([^"]+)"/g, /\\"slug\\":\\"([^\\"]+)\\"/g];
    for (const pattern of patterns) {
      for (const match of html.matchAll(pattern)) {
        const slug = String(match[1] || "").trim().toLowerCase();
        if (!slug || slug.includes("/")) continue;
        if (RESERVED_ROOT_PATHS.has(slug)) continue;
        slugs.add(slug);
      }
    }
    return slugs;
  } catch {
    return new Set();
  }
};

const isReachable = async (url: string): Promise<boolean> => {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA }
    });
    return res.ok;
  } catch {
    return false;
  }
};

const extractCollectionFamilySlugs = (html: string, catalogSlugs: Set<string>, collectionSlug: string): string[] => {
  const result = new Set<string>();
  const patterns = [
    /href=["']\/([^"'/?#]+)["']/g,
    /\\"href\\":\\"\/([^\\\"/?#]+)\\"/g
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const slug = String(match[1] || "").trim().toLowerCase();
      if (!slug) continue;
      if (!catalogSlugs.has(slug)) continue;
      if (slug === collectionSlug || slug.startsWith(`${collectionSlug}-`) || slug.includes(collectionSlug)) {
        result.add(slug);
      }
    }
  }

  if (result.size === 0) {
    for (const slug of catalogSlugs) {
      if (slug.startsWith(`${collectionSlug}-`) || slug.includes(collectionSlug)) {
        result.add(slug);
      }
    }
  }

  return Array.from(result);
};

type Resolved205Target = {
  targetUrl: string;
  familyName: string;
  collectionSlug?: string;
  collectionFamilySlugs?: string[];
};

type TF205StyleProfileEntry = {
  fontFile: string;
  postscriptName: string;
  styleName: string;
  weight: string;
  isItalic: boolean;
};

const parse205StyleProfileEntries = (payload: string): TF205StyleProfileEntry[] => {
  const entries = new Map<string, TF205StyleProfileEntry>();
  const pattern =
    /\{[^{}]*"fontFile":"([^"]+?\.woff2)"[^{}]*"name":"([^"]+)"[^{}]*"postscriptName":"([^"]+)"[^{}]*"weight":"([^"]*)"[^{}]*"isItalic":(true|false)[^{}]*\}/g;

  for (const match of payload.matchAll(pattern)) {
    const fontFile = String(match[1] || "").trim();
    const styleName = String(match[2] || "").trim();
    const postscriptName = String(match[3] || "").trim();
    const weight = String(match[4] || "").trim();
    const isItalic = String(match[5] || "").toLowerCase() === "true";
    if (!fontFile || !postscriptName) continue;
    if (!entries.has(fontFile)) {
      entries.set(fontFile, {
        fontFile,
        postscriptName,
        styleName,
        weight,
        isItalic
      });
    }
  }

  return Array.from(entries.values());
};

const fetch205TargetProfile = async (
  targetUrl: string,
  familyName: string,
  targetSlug?: string
): Promise<Record<string, unknown> | undefined> => {
  try {
    const profileUrl = new URL(targetUrl);
    profileUrl.searchParams.set("_rsc", "1");

    const response = await fetch(profileUrl.href, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/x-component,*/*;q=0.8",
        RSC: "1"
      }
    });
    if (!response.ok) return undefined;

    const payload = await response.text();
    const entries = parse205StyleProfileEntries(payload);
    if (entries.length === 0) return undefined;

    const expectedStyles = entries.map((entry) => entry.styleName).filter(Boolean);
    const expectedPostscriptNames = entries.map((entry) => entry.postscriptName).filter(Boolean);
    const familyPostscript = expectedPostscriptNames[0]?.split("-")[0] || undefined;

    return {
      profileId: `205tf-${targetSlug || "target"}`,
      source: "205tf-rsc",
      family: familyName,
      familyDisplay: familyName,
      familyPostscript,
      targetSlug,
      expectedStyles,
      expectedPostscriptNames,
      styleMap: entries
    };
  } catch {
    return undefined;
  }
};

const resolveTargetUrl = async (rawUrl: string): Promise<Resolved205Target> => {
  const normalized = normalizeSourceUrl(rawUrl);
  const origin = normalized.origin;
  const cleanPath = toCleanPath(normalized.pathname);
  const segments = cleanPath.split("/").filter(Boolean);
  const catalogSlugs = await fetchCatalogSlugs(origin);

  // Root entry should go to catalog, not homepage UI preload.
  if (cleanPath === "/") {
    return { targetUrl: `${origin}/typefaces`, familyName: "205TF Catalog" };
  }

  // If user gives /typefaces/{slug}, map it to /{slug} when available.
  if (segments[0] === "typefaces" && segments[1]) {
    const slug = segments[1].toLowerCase();
    if (catalogSlugs.has(slug)) {
      const mapped = `${origin}/${slug}`;
      if (await isReachable(mapped)) {
        return { targetUrl: mapped, familyName: toReadableFamily(slug) };
      }
    }
    return { targetUrl: `${origin}/typefaces`, familyName: "205TF Catalog" };
  }

  // /typefaces without slug => catalog mode.
  if (segments[0] === "typefaces") {
    return { targetUrl: `${origin}/typefaces`, familyName: "205TF Catalog" };
  }

  // Collection mode, e.g. /collection/pinokio
  if (segments[0] === "collection" && segments[1]) {
    const slug = segments[1].toLowerCase();
    const mapped = `${origin}/collection/${slug}`;
    if (await isReachable(mapped)) {
      let familySlugs: string[] = [];
      try {
        const response = await fetch(mapped, { headers: { "User-Agent": BROWSER_UA } });
        if (response.ok) {
          const html = await response.text();
          familySlugs = extractCollectionFamilySlugs(html, catalogSlugs, slug);
        }
      } catch {
        // fallback to heuristics below
      }

      if (familySlugs.length === 0) {
        const heuristicSlugs = [`${slug}-sans`, `${slug}-petit`, `${slug}-moyen`, `${slug}-grand`, `${slug}-text`, `${slug}-mono`, `${slug}-var`, slug];
        familySlugs = heuristicSlugs.filter((familySlug) => catalogSlugs.has(familySlug));
      }

      return {
        targetUrl: mapped,
        familyName: `${toReadableFamily(slug)} Collection`,
        collectionSlug: slug,
        collectionFamilySlugs: familySlugs
      };
    }
    return { targetUrl: `${origin}/typefaces`, familyName: "205TF Catalog" };
  }

  // Root slug mode, e.g. /zenith
  const head = getPathHead(cleanPath);
  if (head && !RESERVED_ROOT_PATHS.has(head)) {
    const candidate = `${origin}/${head}`;
    if (catalogSlugs.size === 0 || catalogSlugs.has(head)) {
      if (await isReachable(candidate)) {
        return { targetUrl: candidate, familyName: toReadableFamily(head) };
      }
    }
  }

  // Fallback to catalog whenever path is unknown or reserved.
  return { targetUrl: `${origin}/typefaces`, familyName: "205TF Catalog" };
};

const build205ProvocationScript = (familyName: string): string => `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const probe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲijĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž";
    const familyToken = ${JSON.stringify(familyName.toLowerCase().replace(/[^a-z0-9]+/g, ""))};
    const hints = [
      "thin", "light", "regular", "medium", "bold", "black", "italic",
      "variable", "mono", "sans", "serif", "display", "text", "205"
    ];
    const norm = (value) => (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

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

    const clickables = Array.from(
      document.querySelectorAll(
        'button, [role="button"], [data-style], [data-font], [data-weight], [class*="style" i], [class*="weight" i], [class*="axis" i], [class*="font" i]'
      )
    );

    const selects = Array.from(document.querySelectorAll("select"));

    for (let pass = 0; pass < 4; pass += 1) {
      // Force-select every available style option to trigger on-demand font loads.
      for (const select of selects) {
        const optionCount = Math.min(select.options ? select.options.length : 0, 80);
        for (let idx = 0; idx < optionCount; idx += 1) {
          try {
            select.selectedIndex = idx;
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
          } catch {}
          await sleep(110);
        }
      }

      for (const node of clickables) {
        if (node instanceof HTMLAnchorElement) {
          const href = (node.getAttribute("href") || "").trim().toLowerCase();
          if (href && !href.startsWith("#") && !href.startsWith("javascript:")) continue;
        }
        const text = norm(node.textContent);
        const attrs =
          norm(node.getAttribute("data-style")) +
          norm(node.getAttribute("data-font")) +
          norm(node.getAttribute("data-weight")) +
          norm(node.getAttribute("data-family")) +
          norm(node.getAttribute("class")) +
          norm(node.getAttribute("aria-label"));
        const haystack = text + attrs;
        if (!haystack) continue;
        const likelyTarget = familyToken && haystack.includes(familyToken);
        if (!likelyTarget && !hints.some((hint) => haystack.includes(hint))) continue;
        try {
          node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        } catch {}
        await sleep(120);
      }

      const ratio = (pass + 1) / 4;
      window.scrollTo(0, Math.floor(document.body.scrollHeight * ratio));
      await sleep(600);
    }

    window.__specimen_extraction_complete = true;

    window.__saka_extraction_complete = true;
  })();
`;

export const TF205Scraper: Scraper = {
  id: "205tf",
  name: "205.tf Scraper",

  canHandle(url: string): boolean {
    try {
      return KNOWN_HOSTS.has(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const resolved = await resolveTargetUrl(url);
    const { targetUrl, familyName } = resolved;
    const origin = new URL(targetUrl).origin;
    const collectionFamilySlugs = Array.isArray(resolved.collectionFamilySlugs)
      ? resolved.collectionFamilySlugs
      : [];
    const collectionFamilyUrls = collectionFamilySlugs.map((slug) => `${origin}/${slug}`);
    const targetProfile = await fetch205TargetProfile(targetUrl, familyName, resolved.collectionSlug);
    const targetProfileStyles = Array.isArray(targetProfile?.styleMap) ? targetProfile.styleMap.length : 0;
    const expectedCount =
      targetProfileStyles > 0
        ? targetProfileStyles
        :
      collectionFamilySlugs.length > 0
        ? collectionFamilySlugs.length * 16
        : undefined;
    const provocationToken = resolved.collectionSlug || familyName;

    return {
      scraperName: this.name,
      foundryName: "205TF",
      fonts: [
        {
      url: "browser-intercept",
      family: familyName,
      format: "woff2",
      weight: "Regular",
      style: "Normal",
      downloadable: true,
      note: "Extraction via browser interception.",
      metadata: {
        pageUrl: targetUrl,
        foundry: "205TF",
        family: familyName,
        collection: resolved.collectionSlug,
        collectionFamilies: collectionFamilySlugs,
        collectionFamilyUrls,
        ...(targetProfile ? { targetProfile } : {})
      }
    }
      ],
      originalUrl: url,
      targetUrl,
      injectScript: build205ProvocationScript(provocationToken),
      masterFoundry: true,
      expectedCount,
      ...(targetProfile ? { metadata: { targetProfile } } : {})
    };
  }
};
