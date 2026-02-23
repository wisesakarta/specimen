export * from "./types";
import type { FoundryPreset } from "./types";

export const googleFontsPreset: FoundryPreset = {
  id: "google-fonts",
  name: "Google Fonts (CSS)",
  description: "Download fonts via Google Fonts CSS URL.",
  mode: "css-url",
  defaultValues: {
    source: "google-fonts",
    cssUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
    licenseField: "OFL-1.1"
  }
};

export const adobeFontsPreset: FoundryPreset = {
  id: "adobe-fonts",
  name: "Adobe Fonts (CSS)",
  description: "Download from Adobe Fonts (Typekit) CSS. Requires project ID.",
  mode: "css-url",
  defaultValues: {
    source: "adobe-fonts",
    cssUrl: "https://use.typekit.net/[project-id].css",
    licenseField: "Proprietary"
  }
};

export const genericApiPreset: FoundryPreset = {
  id: "generic-api",
  name: "Generic API (JSON)",
  description: "Generic JSON API scraper.",
  mode: "api-json",
  defaultValues: {
    source: "foundry-api",
    itemsPath: "data.fonts",
    urlField: "url",
    nameField: "family_name",
    licenseField: "license_type"
  }
};

export const linetoPreset: FoundryPreset = {
  id: "lineto",
  name: "Lineto (API)",
  description: "Extract fonts from Lineto JSON responses.",
  mode: "api-json",
  defaultValues: {
    source: "lineto",
     // User needs to find the actual JSON usually found in network tab
    apiUrl: "https://www.lineto.com/...",
    itemsPath: "styles", 
    urlField: "woff2",
    nameField: "name",
    licenseField: "Proprietary"
  }
};

export const presets: FoundryPreset[] = [
  googleFontsPreset,
  adobeFontsPreset,
  linetoPreset,
  genericApiPreset
];
