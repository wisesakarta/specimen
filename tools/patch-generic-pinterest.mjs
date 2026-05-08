import fs from "node:fs";

const path = "D:/01PROJECTS/ACTIVE/SPECIMEN/src/lib/scrapers/generic.ts";
let text = fs.readFileSync(path, "utf8");

const replaceOrThrow = (from, to) => {
  if (!text.includes(from)) throw new Error("Pattern not found:\n" + from.slice(0, 160));
  text = text.replace(from, to);
};

replaceOrThrow(
  String.raw`  { pattern: /\bblack\s+italic$/i, styleLabel: "Black Italic", weight: "900", style: "Italic" },
  { pattern: /\bitalic$/i, styleLabel: "Italic", weight: "400", style: "Italic" },
`,
  String.raw`  { pattern: /\bblack\s+italic$/i, styleLabel: "Black Italic", weight: "900", style: "Italic" },
  { pattern: /\bheavy\s+italic$/i, styleLabel: "Heavy Italic", weight: "850", style: "Italic" },
  { pattern: /\bitalic$/i, styleLabel: "Italic", weight: "400", style: "Italic" },
`
);

replaceOrThrow(
  String.raw`  { pattern: /\bbold$/i, styleLabel: "Bold", weight: "700", style: "Normal" },
  { pattern: /\bblack$/i, styleLabel: "Black", weight: "900", style: "Normal" }
];
`,
  String.raw`  { pattern: /\bbold$/i, styleLabel: "Bold", weight: "700", style: "Normal" },
  { pattern: /\bblack$/i, styleLabel: "Black", weight: "900", style: "Normal" },
  { pattern: /\bheavy$/i, styleLabel: "Heavy", weight: "850", style: "Normal" }
];
`
);

replaceOrThrow(
  'const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");\n',
  String.raw`const inferStyleSuffixFromLabel = (
  label: string
): { family: string; styleLabel: string; weight: string; style: "Normal" | "Italic" } | undefined => {
  const normalized = normalizeSpace(label);
  if (!normalized) return undefined;
  for (const suffix of STYLE_SUFFIX_PATTERNS) {
    if (!suffix.pattern.test(normalized)) continue;
    const family = normalizeSpace(normalized.replace(suffix.pattern, ""));
    if (!family || family.length === normalized.length) continue;
    if (normalizeToken(family).length < 3) continue;
    return { family, styleLabel: suffix.styleLabel, weight: suffix.weight, style: suffix.style };
  }
  return undefined;
};

const normalizeToken = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
`
);

replaceOrThrow(
  String.raw`const normalizeFamilyAlias = (family: string, styleLabel: string): string => {
  let normalized = normalizeSpace(family);
  if (/\s+Normal$/i.test(normalized) && /^(Regular|Italic|Regular Italic)$/i.test(styleLabel)) {
    normalized = normalized.replace(/\s+Normal$/i, "");
  }
  if (/\s+Extra$/i.test(normalized) && /(Bold|Black|Heavy|Extra)/i.test(styleLabel)) {
    normalized = normalized.replace(/\s+Extra$/i, "");
  }
  return normalizeSpace(normalized);
};
`,
  String.raw`const normalizeFamilyAlias = (family: string, styleLabel: string): string => {
  let normalized = normalizeSpace(family);
  if (/\s+Normal$/i.test(normalized) && /^(Regular|Italic|Regular Italic)$/i.test(styleLabel)) {
    normalized = normalized.replace(/\s+Normal$/i, "");
  }
  if (/\s+Extra$/i.test(normalized) && /(Bold|Black|Heavy|Extra)/i.test(styleLabel)) {
    normalized = normalized.replace(/\s+Extra$/i, "");
  }
  const styleBase = normalizeSpace(String(styleLabel || "").replace(/\s+Italic$/i, ""));
  if (styleBase && styleBase !== "Regular") {
    const suffixPattern = new RegExp(`\s+\${escapeRegExp(styleBase)}$`, "i");
    if (suffixPattern.test(normalized)) {
      normalized = normalized.replace(suffixPattern, "");
    }
  }
  return normalizeSpace(normalized);
};
`
);

replaceOrThrow(
  String.raw`    const variableFace = isVariableFace(family, rawWeight, sources);
    const selectedSource = pickFontFaceSource(family, rawWeight, sources);
    if (!selectedSource) continue;

    out.push({
      family,
      styleLabel: buildStyleLabel(family, rawWeight, rawStyle, variableFace),
      weight: String(parseWeightValue(rawWeight) || rawWeight || "400"),
      style: /(italic|oblique)/i.test(rawStyle) ? "Italic" : "Normal",
      discovery: "font-face",
      source: selectedSource
    });
`,
  String.raw`    const variableFace = isVariableFace(family, rawWeight, sources);
    const selectedSource = pickFontFaceSource(family, rawWeight, sources);
    if (!selectedSource) continue;

    let resolvedFamily = family;
    let resolvedStyleLabel = buildStyleLabel(family, rawWeight, rawStyle, variableFace);
    let resolvedWeight = String(parseWeightValue(rawWeight) || rawWeight || "400");
    let resolvedStyle: "Normal" | "Italic" = /(italic|oblique)/i.test(rawStyle) ? "Italic" : "Normal";

    const familySplit = inferStyleSuffixFromLabel(family);
    if (familySplit) {
      resolvedFamily = familySplit.family;
      resolvedStyleLabel = familySplit.styleLabel;
      resolvedWeight = familySplit.weight;
      resolvedStyle = familySplit.style;
    }

    const sourceSplit = inferEntryFromFontUrl(selectedSource.url, preloadUrls);
    if (sourceSplit) {
      const currentFamilyToken = normalizeToken(resolvedFamily);
      const sourceFamilyToken = normalizeToken(sourceSplit.family);
      const familyLooksStyleBearing = currentFamilyToken !== sourceFamilyToken && currentFamilyToken.startsWith(sourceFamilyToken);
      const styleLooksGeneric = resolvedStyleLabel === "Regular" || resolvedStyleLabel === "Italic";
      if ((familyLooksStyleBearing || styleLooksGeneric) && sourceSplit.styleLabel) {
        resolvedFamily = sourceSplit.family;
        resolvedStyleLabel = sourceSplit.styleLabel;
        resolvedWeight = sourceSplit.weight;
        resolvedStyle = sourceSplit.style;
      }
    }

    out.push({
      family: resolvedFamily,
      styleLabel: resolvedStyleLabel,
      weight: resolvedWeight,
      style: resolvedStyle,
      discovery: "font-face",
      source: selectedSource
    });
`
);

replaceOrThrow(
  'const buildFontMetadataFromFaces = (\n',
  String.raw`const buildFileNameHint = (entry: FontFaceEntry): string => {
  const safePart = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "font";

  return `${safePart(entry.family)}-${safePart(entry.styleLabel)}.${entry.source.format}`;
};

const buildFontMetadataFromFaces = (
`
);

replaceOrThrow(
  String.raw`      sourceType: entry.discovery === "font-face" ? "generic-font-face" : "generic-passive-research",
      targetUrl,
`,
  String.raw`      sourceType: entry.discovery === "font-face" ? "generic-font-face" : "generic-passive-research",
      fileNameHint: buildFileNameHint(entry),
      targetUrl,
`
);

replaceOrThrow(
  String.raw`    let styleLabel = "Regular";
    let weight = "400";
    let style: "Normal" | "Italic" = "Normal";

    const split = inferStyleSuffixFromLabel(family);
    if (split) {
      family = split.family;
      styleLabel = split.styleLabel;
      weight = split.weight;
      style = split.style;
    }
`,
  String.raw`    let styleLabel = "Regular";
    let weight = "400";
    let style: "Normal" | "Italic" = "Normal";

    const split = inferStyleSuffixFromLabel(family);
    if (split) {
      family = split.family;
      styleLabel = split.styleLabel;
      weight = split.weight;
      style = split.style;
    }
`
);

fs.writeFileSync(path, text);
console.log("patched generic.ts");
