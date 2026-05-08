import { Scraper, ScrapeResult } from "./scraper-protocol";

type SuperiorInferredStyle = "Normal" | "Italic" | "Slanted";

const tokenizeSuperiorStyle = (raw: string): string[] => {
  const spaced = raw.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
};

const inferSuperiorWeight = (tokens: string[]): number | null => {
  const joined = tokens.join("");
  const has = (value: string) => tokens.includes(value) || joined.includes(value);

  if (has("thin")) return 100;
  if ((has("extra") && has("light")) || has("extralight") || (has("ultra") && has("light")) || has("ultralight"))
    return 200;
  if (has("light")) return 300;
  if (has("regular") || has("buch") || has("book")) return 400;
  if (has("medium")) return 500;
  if ((has("semi") && has("bold")) || has("semibold") || (has("demi") && has("bold")) || has("demibold") || has("halbfett"))
    return 600;
  if ((has("extra") && has("bold")) || has("extrabold") || has("extrafett")) return 800;
  if (has("bold") || has("fett")) return 700;
  if (has("black")) return 900;

  return null;
};

const inferSuperiorStyle = (tokens: string[]): SuperiorInferredStyle => {
  if (tokens.includes("slanted") || tokens.includes("oblique") || tokens.includes("slant")) return "Slanted";
  if (tokens.includes("italic")) return "Italic";
  return "Normal";
};

const toSuperiorWeightLabel = (weight: string | number): string => {
  if (typeof weight === "number") {
    if (weight <= 100) return "Thin";
    if (weight <= 200) return "ExtraLight";
    if (weight <= 300) return "Light";
    if (weight <= 400) return "Regular";
    if (weight <= 500) return "Medium";
    if (weight <= 600) return "SemiBold";
    if (weight <= 700) return "Bold";
    if (weight <= 800) return "ExtraBold";
    return "Black";
  }

  const token = String(weight || "").trim().toLowerCase();
  if (token === "var" || token === "variable") return "Variable";
  if (!token) return "Regular";
  return token.charAt(0).toUpperCase() + token.slice(1);
};

const composeSuperiorStyleLabel = (weight: string | number, style: SuperiorInferredStyle): string => {
  const weightLabel = toSuperiorWeightLabel(weight);
  if (weightLabel === "Variable") return "Variable";
  if (style === "Italic" || style === "Slanted") {
    return weightLabel === "Regular" ? "Italic" : `${weightLabel} Italic`;
  }
  return weightLabel;
};

const normalizeSuperiorTargetUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const section = (parts[0] || "").toLowerCase();

    if (section === "typeface") {
      const slug = parts[1] || "";
      parsed.pathname = slug ? `/fonts/${slug}` : "/fonts";
    }

    return parsed.href;
  } catch {
    return rawUrl;
  }
};

export const SuperiorTypeScraper: Scraper = {
  id: "superiortype",
  name: "Superior Type Genius Scraper",

  canHandle(url: string): boolean {
    return url.includes("superiortype.com");
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const fonts: any[] = [];
    const targetUrl = normalizeSuperiorTargetUrl(url);
    let html = "";
    let derivedFamilyName = "Unknown Superior";
    let targetProfile: Record<string, unknown> | undefined;

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      html = await response.text();

      const urlObj = new URL(targetUrl);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      const urlSlug = (pathParts[pathParts.length - 1] || "").toLowerCase();

      const h1Regex = /<h1[^>]*>([^<]+)<\/h1>/i;
      const h1Match = html.match(h1Regex);
      derivedFamilyName = h1Match ? h1Match[1].trim() : "Unknown Superior";

      const familySlug = derivedFamilyName.replace(/\s+V\d+/i, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const urlSig = normalize(urlSlug);
      const urlBaseSig = normalize(urlSlug.replace(/[-_]?v\d+$/i, ""));
      const urlVersion = (urlSlug.match(/v(\d+)/i) || [])[1] || "";

      const cmsRegex = /https:\/\/cms\.superiortype\.com\/api\/fonts\/file\/([^"'? ]+\.woff2(?:\?v=\d+)?)/gi;
      const matches = [...html.matchAll(cmsRegex)];
      const seen = new Set();

      matches.forEach((match) => {
        const fullUrl = match[0];
        const fileName = match[1].split("?")[0];

        if (seen.has(fileName)) return;
        seen.add(fileName);

        const namePart = fileName.replace(".woff2", "");
        const targetSig = urlSig || normalize(familySlug);
        const fileSig = normalize(namePart);

        let isMatch = false;
        if (urlVersion && urlBaseSig) {
          const exactVersion = `${urlBaseSig}v${urlVersion}`;
          const aliasV2Super =
            urlVersion === "2" && (fileSig.includes(`${urlBaseSig}super`) || fileSig.includes(`${urlBaseSig}supervariable`));
          isMatch = fileSig.includes(exactVersion) || aliasV2Super;
        } else if (targetSig) {
          isMatch = fileSig.includes(targetSig) || Boolean(urlBaseSig && fileSig.includes(urlBaseSig));
        } else {
          isMatch = fileSig.includes(familySlug);
        }

        if (!isMatch) return;
        if (namePart.toLowerCase().includes("restartsuperior") || namePart.toLowerCase().includes("ui-font")) return;

        let family = derivedFamilyName;
        let stylePart = "Regular";

        if (namePart.includes("-")) {
          const parts = namePart.split("-");
          const firstPart = parts[0];
          if (derivedFamilyName.toLowerCase().replace(/\s/g, "").includes(firstPart.toLowerCase())) {
            family = derivedFamilyName;
            stylePart = parts.slice(1).join(" ");
          } else {
            family = firstPart;
            stylePart = parts.slice(1).join(" ");
          }
        }

        const isVariable = fileName.toLowerCase().includes("variable") || fileName.toLowerCase().includes("-var");
        const styleTokens = tokenizeSuperiorStyle(stylePart);
        const weight = isVariable ? "VAR" : inferSuperiorWeight(styleTokens) ?? 400;
        const inferredStyle = inferSuperiorStyle(styleTokens);
        const styleName = composeSuperiorStyleLabel(weight, inferredStyle);
        const familyBase = derivedFamilyName;

        fonts.push({
          url: fullUrl,
          format: "woff2",
          family: isVariable ? `${family} (Variable)` : family,
          weight,
          style: inferredStyle,
          downloadable: true,
          note: "Detected via Genius Mode (CMS Asset). Quality: High.",
          metadata: {
            pageUrl: targetUrl,
            targetUrl,
            foundry: "Superior Type",
            family: derivedFamilyName,
            styleName,
            fullName: `${familyBase} ${styleName}`.trim(),
            forceMetadataRepair: true
          }
        });
      });

      const dedup = new Map<string, any>();
      for (const font of fonts) {
        const key = [
          String(font.family || "").toLowerCase(),
          String(font.style || "").toLowerCase(),
          String(font.weight || "").toLowerCase()
        ].join("|");
        const existing = dedup.get(key);
        if (!existing) {
          dedup.set(key, font);
          continue;
        }
        const existingTrial = /_trial/i.test(String(existing.url || ""));
        const currentTrial = /_trial/i.test(String(font.url || ""));
        if (existingTrial && !currentTrial) {
          dedup.set(key, font);
        }
      }
      fonts.length = 0;
      fonts.push(...dedup.values());

      if (urlVersion && urlBaseSig) {
        const strictToken = `${urlBaseSig}v${urlVersion}`;
        const strict = fonts.filter((font) => normalize(String(font.url || "")).includes(strictToken));
        if (strict.length > 0) {
          fonts.length = 0;
          fonts.push(...strict);
        }
      }

      const expectedStyles = Array.from(
        new Set(
          fonts
            .filter((font) => !String(font.family || "").includes("(Variable)"))
            .map((font) => composeSuperiorStyleLabel(font.weight, font.style as SuperiorInferredStyle))
            .filter((style) => typeof style === "string" && style.trim().length > 0)
        )
      );

      targetProfile = {
        profileId: "superiortype-target-profile-v1",
        foundry: "Superior Type",
        familyDisplay: derivedFamilyName,
        familySlug: urlSlug || undefined,
        targetUrl,
        source: "cms-asset-scan",
        styleScope: "style",
        strictMissingStyles: false,
        expectedStyles
      };

      for (const font of fonts) {
        font.metadata = {
          ...(font.metadata || {}),
          targetProfile
        };
      }
    } catch (e) {
      console.warn("Genius probe failed", e);
    }

    if (fonts.length === 0) {
      const fallbackName = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() ||
        url.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ||
        "Superior Type Probe";

      fonts.push({
        url: "browser-intercept",
        format: "woff2",
        family: fallbackName,
        weight: "400",
        style: "Deep Scan",
        metadata: targetProfile ? { targetProfile } : undefined
      });
    }

    fonts.sort((a, b) => {
      if (String(a.family || "").includes("(Variable)")) return -1;
      if (String(b.family || "").includes("(Variable)")) return 1;
      return String(a.family || "").localeCompare(String(b.family || ""));
    });

    return {
      scraperName: this.name,
      foundryName: "Superior Type",
      fonts,
      originalUrl: url,
      targetUrl,
      metadata: targetProfile ? { targetProfile } : undefined,
      injectScript: `
        (async () => {
            console.log("[SPECIMEN-SUPERIOR] Specific Provocation Active");
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));

            window.scrollTo(0, document.body.scrollHeight / 4);
            await sleep(500);

            const triggers = document.querySelectorAll('button, [class*="style"], [class*="item"], .c-specimen__button');
            for (const trigger of triggers) {
                if (trigger.innerText.length < 20) {
                     trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                     await sleep(100);
                }
            }

            const fields = document.querySelectorAll('.t-specimen-input, [contenteditable], input');
            fields.forEach(f => {
                f.innerText = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz 0123456789 !@#$%^&*()";
                f.dispatchEvent(new Event('input', { bubbles: true }));
            });

            window.scrollTo(0, document.body.scrollHeight);
            console.log("[SPECIMEN-SUPERIOR] Provocation Done.");
        })();
      `
    };
  }
};

