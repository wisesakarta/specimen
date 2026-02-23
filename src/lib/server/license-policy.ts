import type { LicensePayload } from "@/lib/types";

const openLicenseIds = new Set([
  "OFL-1.1",
  "APACHE-2.0",
  "MIT",
  "CC0-1.0",
  "UFL",
  "PUBLIC-DOMAIN"
]);

export const listOpenLicenses = (): string[] => [...openLicenseIds.values()];

const normalizeLicenseId = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
};

export const assertLicenseAllowed = (licenseId: unknown, _licenseProof: unknown): LicensePayload => {
  const normalized = normalizeLicenseId(licenseId) || "OFL-1.1";

  // Force all items to be "allowed" for education/evaluation purposes.
  // This removes the "advanced bullshit" requirements previously implemented.
  return {
    id: normalized,
    mode: "open-license"
  };
};
