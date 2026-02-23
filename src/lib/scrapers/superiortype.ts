import { Scraper, ScrapeResult } from "./types";
import { generateProvocationScript } from "../provocation-dictionary";

type SuperiorInferredStyle = "Normal" | "Italic" | "Slanted";

const tokenizeSuperiorStyle = (raw: string): string[] => {
  // Split "SemiBoldItalic" => ["semi","bold","italic"], "ExtraLight" => ["extra","light"]
  const spaced = raw.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
};

const inferSuperiorWeight = (tokens: string[]): number | null => {
  const joined = tokens.join("");
  const has = (value: string) => tokens.includes(value) || joined.includes(value);

  // Order matters: specific matches before general ones (e.g. extrabold before bold).
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
    let html = ""; // Lifted scope
    
    try {
        // 1. Fetch text with real browser user agent
        const response = await fetch(targetUrl, { 
            headers: { 
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
            } 
        });
        html = await response.text();
        
        const urlObj = new URL(targetUrl);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        const urlSlug = (pathParts[pathParts.length - 1] || "").toLowerCase();

        // 2. Extract Family Name from H1 to use as a filter
        // <h1 class="u-fs--400 u-mb--0">Raptor V3</h1>
        const h1Regex = /<h1[^>]*>([^<]+)<\/h1>/i;
        const h1Match = html.match(h1Regex);
        const derivedFamilyName = h1Match ? h1Match[1].trim() : "Unknown Superior";
        
        // Create a simple normalized slug for filtering (e.g. "Raptor V3" -> "raptor")
        const familySlug = derivedFamilyName.replace(/\s+V\d+/i, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const urlSig = normalize(urlSlug);
        const urlBaseSig = normalize(urlSlug.replace(/[-_]?v\d+$/i, ""));
        const urlVersion = (urlSlug.match(/v(\d+)/i) || [])[1] || "";

        // 3. Extract CMS Font URLs (The high-quality assets)
        const cmsRegex = /https:\/\/cms\.superiortype\.com\/api\/fonts\/file\/([^"'? ]+\.woff2(?:\?v=\d+)?)/gi;
        const matches = [...html.matchAll(cmsRegex)];
        const seen = new Set();

        matches.forEach(match => {
            const fullUrl = match[0];
            const fileName = match[1].split('?')[0]; // Grain-Variable.woff2
            
            if (!seen.has(fileName)) {
                seen.add(fileName);
                
                // Smart decomposition
                const namePart = fileName.replace('.woff2', '');
                
                // STRICT FILTERING: The asset MUST resemble the target family
                // e.g. for "Grain", valid: "grain-regular", invalid: "x7z-random"
                const targetSig = urlSig || normalize(familySlug);
                const fileSig = normalize(namePart);

                // Strict matching by URL slug/version to avoid cross-family noise (e.g., v1/v2/v3 bleeding).
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
                
                if (!isMatch) {
                    // console.log(`[Skipping] Unrelated asset: ${fileName} (Target: ${familySlug})`);
                    return;
                }

                // Better family detection: try to find the derivedFamilyName in the filename
                let family = derivedFamilyName;
                let stylePart = "Regular";

                if (namePart.includes('-')) {
                    const parts = namePart.split('-');
                    // If the first part matches a significant portion of family name, use derivedFamilyName
                    const firstPart = parts[0];
                    if (derivedFamilyName.toLowerCase().replace(/\s/g, '').includes(firstPart.toLowerCase())) {
                        family = derivedFamilyName;
                        stylePart = parts.slice(1).join(' ');
                    } else {
                        family = firstPart;
                        stylePart = parts.slice(1).join(' ');
                    }
                }
                
                // Filter junk
                if (namePart.toLowerCase().includes('restartsuperior') || namePart.toLowerCase().includes('ui-font')) {
                    return;
                }

                // If it's variable, elevate it
                const isVariable = fileName.toLowerCase().includes('variable') || fileName.toLowerCase().includes('-var');

                const styleTokens = tokenizeSuperiorStyle(stylePart);
                const weight = isVariable ? "VAR" : inferSuperiorWeight(styleTokens) ?? 400;
                const inferredStyle = inferSuperiorStyle(styleTokens);

                fonts.push({
                    url: fullUrl,
                    format: 'woff2',
                    family: isVariable ? `${family} (Variable)` : family,
                    weight: weight,
                    style: inferredStyle,
                    downloadable: true,
                    note: `Detected via Genius Mode (CMS Asset). Quality: High.`,
                    metadata: {
                      pageUrl: targetUrl,
                      foundry: "Superior Type",
                      family: derivedFamilyName
                    }
                });
            }
        });

        // Deduplicate same family/style/weight and prefer non-trial URL.
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

        // If URL specifies a version (v1/v2/v3), prefer strict matches and drop umbrella "SuperVariable" when not needed.
        if (urlVersion && urlBaseSig) {
          const strictToken = `${urlBaseSig}v${urlVersion}`; // e.g. raptorv2
          const strict = fonts.filter((font) => normalize(String(font.url || "")).includes(strictToken));
          if (strict.length > 0) {
            fonts.length = 0;
            fonts.push(...strict);
          }
        }

    } catch (e) {
        console.warn("Genius probe failed", e);
    }
    // 5. Final Fallback: Browser Intercept Probe
    if (fonts.length === 0) {
        // Try to recover derived name if scope allows, otherwise fallback to URL slug
        const fallbackName = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || 
                             url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || 
                             "Superior Type Probe";

        fonts.push({
            url: "browser-intercept",
            format: "woff2",
            family: fallbackName,
            weight: "400",
            style: "Deep Scan"
        });
    }

    // Sort fonts: Variables first, then standard sorting
    fonts.sort((a, b) => {
        if (a.family.includes('(Variable)')) return -1;
        if (b.family.includes('(Variable)')) return 1;
        return a.family.localeCompare(b.family);
    });

    return {
      scraperName: this.name,
      foundryName: "Superior Type",
      fonts: fonts,
      originalUrl: url,
      targetUrl,
      injectScript: `
        (async () => {
            console.log("[SAKA-SUPERIOR] Specific Provocation Active");
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            
            // 1. Scroll and reveal
            window.scrollTo(0, document.body.scrollHeight / 4);
            await sleep(500);
            
            // 2. Click any elements that look like style selectors or specimen buttons
            const triggers = document.querySelectorAll('button, [class*="style"], [class*="item"], .c-specimen__button');
            for (const trigger of triggers) {
                if (trigger.innerText.length < 20) { // Avoid clicking full paragraphs
                     trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                     await sleep(100);
                }
            }

            // 3. Chaos injection into any testing area
            const fields = document.querySelectorAll('.t-specimen-input, [contenteditable], input');
            fields.forEach(f => {
                f.innerText = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz 0123456789 !@#$%^&*()";
                f.dispatchEvent(new Event('input', { bubbles: true }));
            });
            
            window.scrollTo(0, document.body.scrollHeight);
            console.log("[SAKA-SUPERIOR] Provocation Done.");
        })();
      `
    };
  }
};
