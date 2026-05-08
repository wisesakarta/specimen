
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
// @ts-ignore -- adm-zip uses export=.
import AdmZip from "adm-zip";
import type { BrowserRequest, DownloadResult, DownloadedFile, SkippedItem } from "@/lib/downloader-protocol";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";
import { InterceptionService } from "./services/interception";
import { acquireBrowserSession } from "./services/browser-session-pool";
import { runValidationLog } from "./services/validation";
import { runPureSuccessProtocol } from "./services/pure-success-protocol";
import { runTechnicalQa } from "./services/technical-qa";
import { convertToMultipleFormats } from "./font-converter";
import { getBaseDownloadRoot, getStagingRoot, joinOpaquePath } from "./opaque-path";
import { collectSpecimenPdfAudit } from "./specimen-audit";

puppeteer.use(StealthPlugin());

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

type CapturedAsset = {
  url: string;
  buffer: Buffer;
  contentType: string;
  kind: "font" | "metadata";
  timestamp: number;
};

type CoTypeFontRow = Record<string, unknown>;
type NormalizedProxyCandidate = {
  server: string;
  username?: string;
  password?: string;
  key: string;
  label: string;
};

type BrowserExecutionPolicy = {
  sessionEnabled: boolean;
  sessionKey: string;
  sessionTtlMs: number;
  sessionMaxUses: number;
  proxies: NormalizedProxyCandidate[];
  maxAttempts: number;
  rotateOnBlocked: boolean;
  blockedStatusCodes: Set<number>;
  blockedPatterns: RegExp[];
  blockedStrongPatterns: RegExp[];
};

const toRelative = (absolutePath: string): string => path.relative(process.cwd(), absolutePath);

const toSafeSegment = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "job";
};

const toSafeOutputFolderPath = (value: string): string => {
  const sanitizePart = (part: string): string => {
    const normalized = part
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || "job";
  };
  const parts = value
    .split(/[\\/]+/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => sanitizePart(part));
  if (parts.length === 0) return "job";
  return path.join(...parts);
};

const toSafeFileName = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const clamped = normalized.slice(0, 140).replace(/-+$/g, "");
  return clamped || "font-file";
};

const shortHash = (buffer: Buffer): string =>
  crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 12);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const asNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeProxyServer = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    if (!parsed.protocol || !parsed.hostname) return "";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    // fallback for raw host:port proxies
    if (/^[a-z0-9_.-]+:\d+$/i.test(trimmed)) return `http://${trimmed}`;
    return trimmed;
  }
};

const normalizeProxyCandidate = (value: unknown): NormalizedProxyCandidate | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const server = normalizeProxyServer(trimmed);
    if (!server) return undefined;

    let username: string | undefined;
    let password: string | undefined;
    try {
      const parsed = new URL(trimmed);
      username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
      password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
    } catch {
      // best effort
    }

    const key = `${server}|${username || ""}`;
    return {
      server,
      username,
      password,
      key,
      label: username ? `${server} (${username})` : server
    };
  }

  if (!isRecord(value)) return undefined;
  const rawServer = asString(value.server || value.url || value.proxy);
  if (!rawServer) return undefined;
  const server = normalizeProxyServer(rawServer);
  if (!server) return undefined;
  const username = asString(value.username || value.user);
  const password = asString(value.password || value.pass);
  const key = `${server}|${username || ""}`;
  return {
    server,
    username,
    password,
    key,
    label: username ? `${server} (${username})` : server
  };
};

const defaultBlockedPatterns = [
  /access denied/i,
  /request blocked/i,
  /forbidden/i,
  /verify (that )?you are human/i,
  /challenge required/i,
  /bot detection/i,
  /captcha/i,
  /turnstile/i,
  /just a moment/i,
  /attention required/i
];

const defaultBlockedStrongPatterns = [
  /cf-challenge/i,
  /challenge-platform/i,
  /ray id/i,
  /perimeterx/i,
  /datadome/i,
  /hcaptcha/i,
  /recaptcha/i,
  /turnstile/i
];

const resolveBrowserExecutionPolicy = (request: BrowserRequest): BrowserExecutionPolicy => {
  const host = new URL(request.targetUrl).host.toLowerCase();
  const metadata = isRecord(request.metadata) ? request.metadata : {};
  const browserSession = isRecord(metadata.browserSession) ? metadata.browserSession : {};
  const sessionEnabledRaw = browserSession.enabled ?? metadata.sessionEnabled;
  const sessionEnabled = typeof sessionEnabledRaw === "boolean" ? sessionEnabledRaw : false;
  const sessionKey =
    asString(browserSession.key) ||
    asString((metadata as any).sessionKey) ||
    `${host}:browser-intercept`;
  const sessionTtlMs = asNumber(browserSession.ttlMs) ?? asNumber((metadata as any).sessionTtlMs) ?? 10 * 60 * 1000;
  const sessionMaxUses = asNumber(browserSession.maxUses) ?? asNumber((metadata as any).sessionMaxUses) ?? 12;

  const rawProxyCandidates: unknown[] = [];
  if (Array.isArray((metadata as any).proxyPool)) rawProxyCandidates.push(...(metadata as any).proxyPool);
  if (Array.isArray((metadata as any).proxyRotation)) rawProxyCandidates.push(...(metadata as any).proxyRotation);
  if (Array.isArray((metadata as any).proxies)) rawProxyCandidates.push(...(metadata as any).proxies);
  if ((metadata as any).proxy) rawProxyCandidates.push((metadata as any).proxy);
  if ((browserSession as any).proxy) rawProxyCandidates.push((browserSession as any).proxy);
  if (Array.isArray((browserSession as any).proxyPool)) rawProxyCandidates.push(...(browserSession as any).proxyPool);

  const proxyMap = new Map<string, NormalizedProxyCandidate>();
  for (const rawCandidate of rawProxyCandidates) {
    const normalized = normalizeProxyCandidate(rawCandidate);
    if (!normalized) continue;
    if (!proxyMap.has(normalized.key)) proxyMap.set(normalized.key, normalized);
  }
  const proxies = Array.from(proxyMap.values());

  const rotateOnBlockedRaw = browserSession.rotateOnBlocked ?? (metadata as any).rotateOnBlocked;
  const rotateOnBlocked = typeof rotateOnBlockedRaw === "boolean" ? rotateOnBlockedRaw : true;
  const maxAttemptsRaw = asNumber(browserSession.maxAttempts) ?? asNumber((metadata as any).maxAttempts);
  const maxAttempts = Math.max(
    1,
    Math.min(8, Math.floor(maxAttemptsRaw && maxAttemptsRaw > 0 ? maxAttemptsRaw : proxies.length > 0 ? proxies.length : 1))
  );

  const statusCodesFromMetadata = Array.isArray((metadata as any).blockedStatusCodes)
    ? (metadata as any).blockedStatusCodes
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isFinite(value) && value > 0)
    : [];
  const blockedStatusCodes = new Set<number>(
    statusCodesFromMetadata.length > 0
      ? statusCodesFromMetadata
      : [401, 403, 407, 409, 423, 429, 444, 451, 500, 502, 503, 504, 520, 521, 522, 523, 524, 530]
  );

  const compilePatterns = (rawValues: unknown, fallback: RegExp[]): RegExp[] => {
    if (!Array.isArray(rawValues) || rawValues.length === 0) return fallback;
    const out: RegExp[] = [];
    for (const rawValue of rawValues) {
      if (rawValue instanceof RegExp) {
        out.push(rawValue);
        continue;
      }
      if (typeof rawValue !== "string") continue;
      const trimmed = rawValue.trim();
      if (!trimmed) continue;
      try {
        out.push(new RegExp(trimmed, "i"));
      } catch {
        // skip invalid regex
      }
    }
    return out.length > 0 ? out : fallback;
  };

  const blockedPatterns = compilePatterns((metadata as any).blockedPatterns, defaultBlockedPatterns);
  const blockedStrongPatterns = compilePatterns((metadata as any).blockedStrongPatterns, defaultBlockedStrongPatterns);

  return {
    sessionEnabled,
    sessionKey,
    sessionTtlMs: Math.max(30_000, Math.floor(sessionTtlMs)),
    sessionMaxUses: Math.max(1, Math.floor(sessionMaxUses)),
    proxies,
    maxAttempts,
    rotateOnBlocked,
    blockedStatusCodes,
    blockedPatterns,
    blockedStrongPatterns
  };
};

const buildSessionPoolKey = (
  host: string,
  policy: BrowserExecutionPolicy,
  proxy: NormalizedProxyCandidate | undefined
): string => {
  const proxyKey = proxy ? proxy.key : "no-proxy";
  return `${toSafeSegment(policy.sessionKey)}::${toSafeSegment(host)}::${toSafeSegment(proxyKey)}`;
};

const applyProxyAuthIfNeeded = async (
  page: Page,
  proxy: NormalizedProxyCandidate | undefined
): Promise<void> => {
  if (!proxy || !proxy.username) return;
  await page.authenticate({
    username: proxy.username,
    password: proxy.password || ""
  });
};

const classifyBlockedNavigation = async (params: {
  page: Page;
  status?: number;
  policy: BrowserExecutionPolicy;
}): Promise<{ blocked: boolean; reason?: string; signals: string[] }> => {
  const signals: string[] = [];
  const status = Number(params.status);
  if (Number.isFinite(status) && params.policy.blockedStatusCodes.has(status)) {
    signals.push(`status:${status}`);
  }

  let title = "";
  try {
    title = (await params.page.title()) || "";
  } catch {
    // best effort
  }

  let contentSample = "";
  try {
    const html = await params.page.content();
    contentSample = html.slice(0, 30_000);
  } catch {
    // best effort
  }

  const combined = `${title}\n${contentSample}`;
  const normalized = combined.toLowerCase();

  let softHits = 0;
  let strongHits = 0;
  for (const pattern of params.policy.blockedPatterns) {
    if (pattern.test(normalized)) {
      softHits += 1;
      signals.push(`pattern:${pattern.source}`);
    }
  }
  for (const pattern of params.policy.blockedStrongPatterns) {
    if (pattern.test(normalized)) {
      strongHits += 1;
      signals.push(`strong:${pattern.source}`);
    }
  }

  const blockedByStatus = Number.isFinite(status) && params.policy.blockedStatusCodes.has(status);
  const blockedBySignals = strongHits > 0 || softHits >= 2;
  const blocked = blockedByStatus || blockedBySignals;
  if (!blocked) return { blocked: false, signals };

  const reasonParts: string[] = [];
  if (blockedByStatus) reasonParts.push(`status ${status}`);
  if (strongHits > 0) reasonParts.push(`strong-signals ${strongHits}`);
  if (softHits > 0) reasonParts.push(`signals ${softHits}`);
  const reason = `Blocked page detected (${reasonParts.join(", ")}).`;
  return { blocked: true, reason, signals };
};

class RotateProxyAttemptError extends Error {
  nextAttempt: number;

  constructor(message: string, nextAttempt: number) {
    super(message);
    this.name = "RotateProxyAttemptError";
    this.nextAttempt = nextAttempt;
  }
}
const resolveBrowserExecutablePath = (): string | undefined => {
  // Keep local browser usage opt-in to preserve stable background behavior.
  const envCandidates = [
    asString(process.env.SPECIMEN_BROWSER_PATH),
    asString(process.env.AKSARA_BROWSER_PATH),
    asString(process.env.PUPPETEER_EXECUTABLE_PATH)
  ].filter((value): value is string => Boolean(value));

  for (const candidate of envCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
};

const ensureUniqueFilePath = (dirPath: string, baseName: string): string => {
  const ext = path.extname(baseName);
  const stem = path.basename(baseName, ext);
  let candidate = joinOpaquePath(dirPath, baseName);
  if (!fs.existsSync(candidate)) return candidate;
  for (let i = 1; i <= 999; i += 1) {
    candidate = joinOpaquePath(dirPath, `${stem}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return candidate;
};

const ensureUniqueDirPath = (candidate: string): string => {
  if (!fs.existsSync(candidate)) return candidate;
  for (let i = 2; i <= 999; i += 1) {
    const nextCandidate = `${candidate}-${i}`;
    if (!fs.existsSync(nextCandidate)) return nextCandidate;
  }
  return `${candidate}-${Date.now()}`;
};

const detectBufferFontExt = (buffer: Buffer): ".woff2" | ".woff" | ".ttf" | ".otf" | ".zip" | undefined => {
  if (!buffer || buffer.length < 4) return undefined;
  const signature = buffer.readUInt32BE(0);
  if (signature === 0x774f4632) return ".woff2";
  if (signature === 0x774f4646) return ".woff";
  if (signature === 0x00010000) return ".ttf";
  if (signature === 0x4f54544f) return ".otf";
  if (signature === 0x504b0304) return ".zip";
  return undefined;
};

const detectUrlFontExt = (url: string): ".woff2" | ".woff" | ".ttf" | ".otf" | ".zip" | undefined => {
  const lower = url.toLowerCase();
  if (lower.includes(".woff2")) return ".woff2";
  if (lower.includes(".woff")) return ".woff";
  if (lower.includes(".ttf")) return ".ttf";
  if (lower.includes(".otf")) return ".otf";
  if (lower.includes(".zip")) return ".zip";
  return undefined;
};

const detectFontExt = (buffer: Buffer, contentType: string, url: string): ".woff2" | ".woff" | ".ttf" | ".otf" | ".zip" | undefined => {
  const byBuffer = detectBufferFontExt(buffer);
  if (byBuffer) return byBuffer;
  const lowerType = (contentType || "").toLowerCase();
  if (lowerType.includes("text/html") || lowerType.includes("application/json") || lowerType.includes("text/plain")) {
    return undefined;
  }
  if (lowerType.includes("font/woff2")) return ".woff2";
  if (lowerType.includes("font/woff")) return ".woff";
  if (lowerType.includes("font/ttf")) return ".ttf";
  if (lowerType.includes("font/otf")) return ".otf";
  if (lowerType.includes("application/zip")) return ".zip";
  if (lowerType && !lowerType.includes("octet-stream") && !lowerType.includes("binary") && !lowerType.includes("x-font")) {
    return undefined;
  }
  return detectUrlFontExt(url);
};

const composeDisplayNameFromFileName = (fileName: string, suffix?: string): string => {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext).replace(/[-_]+/g, " ").trim();
  if (!stem) return suffix ? `font (${suffix})` : "font";
  return suffix ? `${stem} (${suffix})` : stem;
};

const splitFamilySubFamily = (fileName: string): { family: string; subFamily: string } => {
  const stem = path.basename(fileName, path.extname(fileName));
  const cleaned = stem.replace(/[-_]+/g, " ").trim();
  const pieces = cleaned.split(/\s+/).filter(Boolean);
  if (pieces.length <= 1) return { family: cleaned || "Unknown", subFamily: "Regular" };
  const sub = pieces[pieces.length - 1];
  const family = pieces.slice(0, -1).join(" ");
  return { family: family || cleaned, subFamily: sub || "Regular" };
};

const resolveCoTypeFamilyHint = (absolutePath: string): string | undefined => {
  const stem = path.basename(absolutePath, path.extname(absolutePath)).toLowerCase();
  const normalized = stem.replace(/^[0-9]+-/, "").replace(/[^a-z0-9]+/g, "");
  if (!normalized) return undefined;

  if (normalized.includes("aeoniksoft")) return "Aeonik Soft";
  if (normalized.includes("aeonikcondensed")) return "Aeonik Condensed";
  if (normalized.includes("aeonikextended")) return "Aeonik Extended";
  if (normalized.includes("aeonikfono")) return "Aeonik Fono";
  if (normalized.includes("aeonikmono")) return "Aeonik Mono";
  if (normalized.includes("aeonik")) return "Aeonik";
  return undefined;
};

const extractTargetSlug = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean).map((item) => item.toLowerCase());
    if (segments.length === 0) return undefined;
    if ((segments[0] === "font-family" || segments[0] === "our-fonts" || segments[0] === "typefaces" || segments[0] === "collection") && segments[1]) {
      return segments[1];
    }
    const last = segments[segments.length - 1];
    if (last === "font-family" || last === "our-fonts" || last === "typefaces" || last === "collection") return undefined;
    return last;
  } catch {
    return undefined;
  }
};

const sanitizeToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const extractTargetTokens = (request: BrowserRequest): string[] => {
  const out = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const token = sanitizeToken(value);
    if (token.length >= 4 && token.length <= 40 && !token.startsWith("http")) {
      out.add(token);
    }
  };
  const addTargetProfileTokens = (profile: Record<string, unknown>) => {
    add(profile.family as string);
    add(profile.familyDisplay as string);
    add(profile.familyPostscript as string);
    add(profile.targetSlug as string);
    const selectedSourceFamilies = Array.isArray(profile.selectedSourceFamilies)
      ? profile.selectedSourceFamilies
      : [];
    for (const sourceFamily of selectedSourceFamilies) {
      add(sourceFamily);
    }
    const expectedAssetTokens = Array.isArray(profile.expectedAssetTokens)
      ? profile.expectedAssetTokens
      : [];
    for (const token of expectedAssetTokens) {
      add(token);
    }
    const profileFamilyToken = sanitizeToken(
      String(profile.familyPostscript || profile.familyDisplay || profile.family || "")
    );

    const expectedPostscriptNames = Array.isArray(profile.expectedPostscriptNames)
      ? profile.expectedPostscriptNames
      : [];
    for (const postscriptName of expectedPostscriptNames) {
      if (typeof postscriptName !== "string") continue;
      add(postscriptName);
      const prefix = postscriptName.split("-")[0];
      if (prefix) {
        const prefixToken = sanitizeToken(prefix);
        const isBroadPrefixForProfile =
          Boolean(profileFamilyToken) &&
          prefixToken.length > 0 &&
          prefixToken.length < profileFamilyToken.length &&
          profileFamilyToken.startsWith(prefixToken);
        if (!isBroadPrefixForProfile) {
          add(prefix);
        }
      }
    }
  };

  add(extractTargetSlug(request.targetUrl));

  if (isRecord(request.metadata)) {
    add(request.metadata.family as string);
    add(request.metadata.category as string);
    add(request.metadata.collection as string);
    if (isRecord(request.metadata.targetProfile)) {
      addTargetProfileTokens(request.metadata.targetProfile);
    }

    const topCollectionFamilies = Array.isArray(request.metadata.collectionFamilies)
      ? request.metadata.collectionFamilies
      : [];
    for (const familySlug of topCollectionFamilies) {
      add(familySlug);
    }

    const fonts = Array.isArray(request.metadata.fonts) ? request.metadata.fonts : [];
    for (const font of fonts) {
      if (!isRecord(font)) continue;
      add(font.family as string);
      if (isRecord(font.metadata)) {
        add(font.metadata.family as string);
        add(font.metadata.category as string);
        add(font.metadata.collection as string);
        if (isRecord(font.metadata.targetProfile)) {
          addTargetProfileTokens(font.metadata.targetProfile);
        }

        const collectionFamilies = Array.isArray(font.metadata.collectionFamilies)
          ? font.metadata.collectionFamilies
          : [];
        for (const familySlug of collectionFamilies) {
          add(familySlug);
        }
      }
    }
  }

  return Array.from(out);
};

const shouldApplyTokenFilter = (host: string): boolean =>
  host.includes("205.tf") ||
  host.includes("abcdinamo.com") ||
  host.includes("abjadfonts.com") ||
  host.includes("lineto.com") ||
  host.includes("pangrampangram.com") ||
  host.includes("grillitype.com") ||
  host.includes("klim.co.nz") ||
  host.includes("gt-type.com") ||
  host.includes("wtypefoundry.com") ||
  host.includes("superiortype.com") ||
  host.includes("type.hanli.eu") ||
  host.includes("narrowtype.com") ||
  host.includes("productiontype.com") ||
  host.includes("typefaces.pizza") ||
  host.includes("nuformtype.com");

const is205CoreHashedAsset = (url: string): boolean =>
  /\/(?:pf|f)-[0-9a-f]{24,}(?:\.[a-z0-9]+)?(?:[?#]|$)/i.test(url || "");

const is205UiChromeAsset = (url: string): boolean =>
  /-s\.p\.woff2?(?:[?#]|$)/i.test(url || "");

const assetMatchesTokens = (url: string, tokens: string[]): boolean => {
  if (tokens.length === 0) return true;
  const parsed = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const normalized = sanitizeToken(parsed);
  const normalizedWithoutLl = normalized.replace(/ll/g, "");
  return tokens.some((token) => normalized.includes(token) || normalizedWithoutLl.includes(token));
};

type LinetoGateInfo = {
  isGate: boolean;
  purpose?: string;
  postscriptNames: string[];
  isSubset: boolean;
  isContours: boolean;
  isBlockedPurpose: boolean;
};

const parseLinetoGateInfo = (url: string): LinetoGateInfo => {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    if (!pathname.includes("/api/front/font-cuts/web-font")) {
      return {
        isGate: false,
        purpose: undefined,
        postscriptNames: [],
        isSubset: false,
        isContours: false,
        isBlockedPurpose: false
      };
    }
    const purposeRaw = parsed.searchParams.get("purpose")?.trim().toLowerCase();
    const purpose = purposeRaw || undefined;
    const postscriptNames = parsed.searchParams
      .getAll("postscriptNames")
      .map((item) => item.trim())
      .filter(Boolean);
    const isSubset = purpose === "subset";
    const isContours = purpose === "contours";
    return {
      isGate: true,
      purpose,
      postscriptNames,
      isSubset,
      isContours,
      isBlockedPurpose: isSubset || isContours
    };
  } catch {
    return {
      isGate: false,
      purpose: undefined,
      postscriptNames: [],
      isSubset: false,
      isContours: false,
      isBlockedPurpose: false
    };
  }
};

const extractFontUrlsFromText = (payload: string, baseUrl?: string): string[] => {
  const out = new Set<string>();
  const patterns = [
    /https?:\/\/[^\s"'<>]+?\.(?:woff2|woff|ttf|otf|zip)(?:\?[^\s"'<>]*)?/gi,
    /"url"\s*:\s*"([^"]+?\.(?:woff2|woff|ttf|otf|zip)(?:\?[^"]*)?)"/gi,
    /\\?"(\/[^"\\]+\.(?:woff2|woff|ttf|otf|zip)(?:\?[^"\\]*)?)\\?"/gi,
    /\\?"(\/\/[^"\\]+\.(?:woff2|woff|ttf|otf|zip)(?:\?[^"\\]*)?)\\?"/gi
  ];

  for (const pattern of patterns) {
    for (const match of payload.matchAll(pattern)) {
      const candidate = String(match[1] || match[0] || "").trim();
      if (!candidate) continue;
      try {
        const parsed = /^https?:\/\//i.test(candidate)
          ? new URL(candidate)
          : baseUrl
            ? new URL(candidate, baseUrl)
            : null;
        if (!parsed) continue;
        out.add(parsed.href);
      } catch {
        // ignore malformed URLs
      }
    }
  }

  return Array.from(out);
};

const extractEmbeddedWoffPayloads = (buffer: Buffer): Array<{ ext: ".woff2" | ".woff"; data: Buffer; index: number }> => {
  const out: Array<{ ext: ".woff2" | ".woff"; data: Buffer; index: number }> = [];
  const signatures = [
    { ext: ".woff2" as const, sig: Buffer.from("wOF2") },
    { ext: ".woff" as const, sig: Buffer.from("wOFF") }
  ];

  for (const { ext, sig } of signatures) {
    let cursor = 0;
    while (cursor >= 0 && cursor < buffer.length) {
      const idx = buffer.indexOf(sig, cursor);
      if (idx < 0) break;
      cursor = idx + 1;

      if (idx + 12 > buffer.length) continue;
      const totalLength = buffer.readUInt32BE(idx + 8);
      if (!Number.isFinite(totalLength) || totalLength <= 0) continue;
      if (totalLength > 64 * 1024 * 1024) continue;
      if (idx + totalLength > buffer.length) continue;

      const slice = buffer.subarray(idx, idx + totalLength);
      out.push({ ext, data: slice, index: idx });
    }
  }

  return out;
};

const parseLinetoPostscriptNames = (gateUrl: string): string[] => {
  return parseLinetoGateInfo(gateUrl).postscriptNames;
};

const splitLinetoChunkedPayload = (buffer: Buffer): Buffer[] => {
  const out: Buffer[] = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    offset += 4;
    if (!Number.isFinite(chunkLength) || chunkLength <= 0) break;
    if (chunkLength > 64 * 1024 * 1024) break;
    if (offset + chunkLength > buffer.length) break;
    out.push(buffer.subarray(offset, offset + chunkLength));
    offset += chunkLength;
  }
  return out;
};

const applyByteShift = (buffer: Buffer, delta: number): Buffer => {
  const out = Buffer.from(buffer);
  if (delta === 0) return out;
  for (let i = out.length - 1; i >= 0; i -= 1) {
    out[i] = (out[i] + delta) & 0xff;
  }
  return out;
};

const decodeLinetoGatePayload = (
  gateUrl: string,
  payload: Buffer
): Array<{ postscriptName?: string; buffer: Buffer }> => {
  const names = parseLinetoPostscriptNames(gateUrl);
  if (names.length === 0) return [];

  const chunks = names.length > 1 ? splitLinetoChunkedPayload(payload) : [payload];
  if (chunks.length === 0) return [];

  return chunks.map((chunk, idx) => {
    const postscriptName = names[idx];
    const shift = -(postscriptName?.length || 0);
    return {
      postscriptName,
      buffer: applyByteShift(chunk, shift)
    };
  });
};

const makeJobFolder = (request: BrowserRequest): string => {
  const baseRoot = request.outputFolder && request.outputFolder.trim() ? getBaseDownloadRoot() : getStagingRoot();
  if (request.outputFolder && request.outputFolder.trim()) {
    return joinOpaquePath(baseRoot, toSafeOutputFolderPath(request.outputFolder));
  }
  const finalize = (candidate: string): string => ensureUniqueDirPath(candidate);

  let hostToken = "unknown";
  try {
    hostToken = toSafeSegment(new URL(request.targetUrl).hostname.replace(/^www\./, "").replace(/\./g, "-"));
    if (hostToken === "job") hostToken = "unknown";
  } catch {
    // keep fallback
  }

  const meta = isRecord(request.metadata) ? request.metadata : {};
  const familyToken = typeof meta.family === "string" ? toSafeSegment(meta.family) : undefined;
  if (familyToken && familyToken !== "job") {
    return finalize(joinOpaquePath(baseRoot, `${hostToken}-${familyToken}`));
  }

  const slug = extractTargetSlug(request.targetUrl);
  if (slug) {
    return finalize(joinOpaquePath(baseRoot, `${hostToken}-${toSafeSegment(slug)}`));
  }

  const foundryToken = asString(meta.foundry) ? toSafeSegment(String(meta.foundry)) : undefined;
  if (foundryToken && foundryToken !== "job") {
    return finalize(joinOpaquePath(baseRoot, `${foundryToken}-fonts`));
  }

  return finalize(joinOpaquePath(baseRoot, `${hostToken}-fonts`));
};

const extractBaseNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const raw = path.basename(parsed.pathname);
    const stem = raw.replace(/\.[^.]+$/, "");
    return stem || "font";
  } catch {
    const stem = path.basename(url).replace(/\.[^.]+$/, "");
    return stem || "font";
  }
};

const toPangramPpToken = (value: string): string => {
  const cleaned = value
    .replace(/^pp-/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) return "";
  return `PP${cleaned
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
};

const normalizePangramBaseName = (base: string, targetSlug?: string): string => {
  let out = (base || "").replace(/_/g, "-");
  out = out.replace(/[-_][0-9a-f]{8}(?:[-_][0-9a-f]{4}){3}[-_][0-9a-f]{12}$/i, "");
  out = out.replace(/-[0-9a-f]{8}$/i, "");
  out = out.replace(/VariableUprightVF/gi, "VariableUpright");
  out = out.replace(/VariableItalicVF/gi, "VariableItalic");
  out = out.replace(/VariableVF/gi, "Variable");
  out = out.replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  if (/^[a-z0-9-]+$/.test(out) && !/^pp/i.test(out)) {
    const converted = toPangramPpToken(out);
    if (converted) out = converted;
  }

  if (targetSlug) {
    const targetToken = sanitizeToken(targetSlug);
    const outToken = sanitizeToken(out);
    if (targetToken && outToken === targetToken) {
      const convertedTarget = toPangramPpToken(targetSlug);
      if (convertedTarget) out = convertedTarget;
    }
  }

  return out || base;
};

const normalizeKlimBaseName = (base: string): string => {
  let out = (base || "").replace(/_/g, "-");
  out = out.replace(/-[A-Za-z0-9]{6,10}$/g, "");
  out = out.replace(/-[0-9a-f]{12,}$/gi, "");
  out = out.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return out || base;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed);
  }
  return out;
};

const shouldIncludeSpecimenPdf = (request: BrowserRequest): boolean => {
  if (!isRecord(request.metadata)) return true;
  const explicit = request.metadata.includeSpecimenPdf;
  if (typeof explicit === "boolean") return explicit;
  if (isRecord(request.metadata.options) && typeof request.metadata.options.includeSpecimenPdf === "boolean") {
    return request.metadata.options.includeSpecimenPdf;
  }
  return true;
};

const normalizeCoverageToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bsemibld\b/g, "semibold")
    .replace(/\bsemibd\b/g, "semibold")
    .replace(/\bsemi[\s-]?bold\b/g, "semibold")
    .replace(/\bextra[\s-]?light\b/g, "extralight")
    .replace(/\bextra[\s-]?bold\b/g, "extrabold")
    .replace(/\bex[\s-]?light\b/g, "extralight")
    .replace(/\bex[\s-]?bold\b/g, "extrabold")
    .replace(/\bexlgt\b/g, "extralight")
    .replace(/\bexbld\b/g, "extrabold")
    .replace(/\blgt(?=italic\b)/g, "light")
    .replace(/\bmed(?=italic\b)/g, "medium")
    .replace(/\bbld(?=italic\b)/g, "bold")
    .replace(/\bblk(?=italic\b)/g, "black")
    .replace(/\blgt\b/g, "light")
    .replace(/\bmed\b/g, "medium")
    .replace(/\bbld\b/g, "bold")
    .replace(/\bblk\b/g, "black")
    .replace(/\breg\b/g, "regular")
    .replace(/\bital\b/g, "italic")
    .replace(/[^a-z0-9]+/g, "");

const extractStyleFromPostscript = (postscript: string): string => {
  const idx = postscript.indexOf("-");
  if (idx < 0) return "";
  return postscript.slice(idx + 1);
};

const normalizeItalicStyleLabel = (style: string, fileName: string): string => {
  const cleaned = (style || "").trim();
  if (!cleaned) return cleaned;
  if (!/italic|oblique/i.test(fileName || "")) return cleaned;
  if (/italic|oblique/i.test(cleaned)) return cleaned;
  if (/^(regular|normal)$/i.test(cleaned)) return "Regular Italic";
  return `${cleaned} Italic`.replace(/\s+/g, " ").trim();
};

const collapseDominantPostscriptPrefix = (values: string[]): string[] => {
  if (values.length < 3) return values;
  const prefixCounts = new Map<string, number>();
  for (const value of values) {
    const prefix = value.split("-")[0]?.trim();
    if (!prefix) continue;
    prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
  }
  if (prefixCounts.size <= 1) return values;
  const maxCount = Math.max(...Array.from(prefixCounts.values()));
  if (!Number.isFinite(maxCount) || maxCount < 2) return values;
  const dominantPrefixes = new Set(
    Array.from(prefixCounts.entries())
      .filter(([, count]) => count === maxCount)
      .map(([prefix]) => prefix)
  );
  const filtered = values.filter((value) => dominantPrefixes.has(value.split("-")[0]?.trim() || ""));
  return filtered.length > 0 ? filtered : values;
};

const isCoverageNoiseStyle = (style: string): boolean => {
  const normalized = (style || "").trim();
  if (!normalized) return true;
  if (/^\d+$/.test(normalized)) return true;
  return false;
};

const getTargetProfile = (request: BrowserRequest): Record<string, unknown> | undefined => {
  if (!isRecord(request.metadata)) return undefined;
  const top = request.metadata.targetProfile;
  if (isRecord(top)) return top;

  const fonts = Array.isArray(request.metadata.fonts) ? request.metadata.fonts : [];
  for (const font of fonts) {
    if (!isRecord(font) || !isRecord(font.metadata)) continue;
    const nested = font.metadata.targetProfile;
    if (isRecord(nested)) return nested;
  }
  return undefined;
};

const readJsonRecord = async (filePath: string): Promise<Record<string, unknown> | undefined> => {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const pruneGrotesklyContamination = async (params: {
  outputDir: string;
  validationLogPath: string;
  downloaded: DownloadedFile[];
  seenPaths: Set<string>;
  skipped: SkippedItem[];
  logProgress: (message: string) => Promise<void>;
}): Promise<number> => {
  const { outputDir, validationLogPath, downloaded, seenPaths, skipped, logProgress } = params;
  const validation = await readJsonRecord(validationLogPath);
  if (!validation) return 0;

  const contamination = Array.isArray(validation.contamination) ? validation.contamination : [];
  if (contamination.length === 0) return 0;

  const outputRoot = path.resolve(outputDir).toLowerCase();
  const removedAbsolute = new Set<string>();

  for (const entry of contamination) {
    if (!isRecord(entry)) continue;
    const pathValue = asString(entry.path);
    if (!pathValue) continue;

    const absolutePath = path.isAbsolute(pathValue)
      ? path.resolve(pathValue)
      : path.resolve(outputDir, pathValue);
    if (!absolutePath.toLowerCase().startsWith(outputRoot)) continue;
    if (!fs.existsSync(absolutePath)) continue;

    try {
      await unlink(absolutePath);
      removedAbsolute.add(absolutePath);
    } catch {
      // keep best-effort cleanup; do not fail run
    }
  }

  if (removedAbsolute.size === 0) return 0;

  const removedRelative = new Set(Array.from(removedAbsolute).map((item) => toRelative(item)));
  for (let i = downloaded.length - 1; i >= 0; i -= 1) {
    const item = downloaded[i];
    if (!removedRelative.has(item.filePath)) continue;
    seenPaths.delete(item.filePath);
    downloaded.splice(i, 1);
  }

  skipped.push({
    index: skipped.length,
    reason: `Groteskly cleanup removed ${removedAbsolute.size} likely contamination files via validation gate.`
  });
  await logProgress(`[Groteskly] Removed ${removedAbsolute.size} contamination files from output.`);

  return removedAbsolute.size;
};

type TF205StyleMapEntry = {
  fontFile: string;
  postscriptName: string;
  styleName?: string;
  weight?: string;
  isItalic?: boolean;
};

const build205StyleMap = (request: BrowserRequest): Map<string, TF205StyleMapEntry> => {
  const out = new Map<string, TF205StyleMapEntry>();
  const profile = getTargetProfile(request);
  if (!profile) return out;

  const styleMap = Array.isArray(profile.styleMap) ? profile.styleMap : [];
  const addKey = (key: string, value: TF205StyleMapEntry) => {
    const normalized = key.trim().toLowerCase();
    if (!normalized) return;
    if (!out.has(normalized)) out.set(normalized, value);
  };

  for (const item of styleMap) {
    if (!isRecord(item)) continue;
    const fontFile = asString(item.fontFile);
    const postscriptName = asString(item.postscriptName);
    if (!fontFile || !postscriptName) continue;

    const entry: TF205StyleMapEntry = {
      fontFile,
      postscriptName,
      styleName: asString(item.styleName) || asString(item.name),
      weight: asString(item.weight) || undefined,
      isItalic: typeof item.isItalic === "boolean" ? item.isItalic : undefined
    };

    const fileName = path.basename(fontFile).toLowerCase();
    const stem = fileName.replace(/\.[^.]+$/, "");
    addKey(fileName, entry);
    addKey(stem, entry);
  }

  return out;
};

const resolve205MappedBaseName = (
  assetUrl: string,
  styleMap: Map<string, TF205StyleMapEntry>
): string | undefined => {
  if (styleMap.size === 0) return undefined;

  let fileName = "";
  try {
    fileName = path.basename(new URL(assetUrl).pathname).toLowerCase();
  } catch {
    fileName = path.basename(assetUrl).toLowerCase();
  }

  const stem = (fileName || "").replace(/\.[^.]+$/, "");
  const fallbackStem = extractBaseNameFromUrl(assetUrl).toLowerCase();
  const probeKeys = new Set<string>([
    fileName,
    stem,
    fallbackStem,
    stem ? `${stem}.woff2` : "",
    fallbackStem ? `${fallbackStem}.woff2` : ""
  ]);

  for (const key of probeKeys) {
    if (!key) continue;
    const hit = styleMap.get(key);
    if (!hit) continue;
    if (hit.postscriptName && hit.postscriptName.trim()) return hit.postscriptName.trim();
  }
  return undefined;
};

type HanliStyleMapEntry = {
  styleName: string;
  familyName?: string;
  fontStyle?: string;
  fontWeight?: string;
};

const normalizeAssetUrlKey = (value: string): string => {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.search = "";
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return String(value || "")
      .split("?")[0]
      .split("#")[0]
      .toLowerCase();
  }
};

const parseCssDeclarationValue = (cssBlock: string, property: string): string | undefined => {
  const re = new RegExp(`${property}\\s*:\\s*([^;]+);?`, "i");
  const match = cssBlock.match(re);
  const value = asString(match?.[1]);
  if (!value) return undefined;
  return value
    .replace(/^['"]|['"]$/g, "")
    .replace(/&quot;/gi, '"')
    .trim();
};

const buildHanliStyleMap = (captured: CapturedAsset[]): Map<string, HanliStyleMapEntry> => {
  const out = new Map<string, HanliStyleMapEntry>();

  for (const asset of captured) {
    if (asset.kind !== "metadata") continue;

    const urlLower = (asset.url || "").toLowerCase();
    if (!urlLower.includes("fonts.fontdue.com/")) continue;
    if (!urlLower.includes("/css/")) continue;
    if (!urlLower.includes(".css")) continue;

    const cssText = asset.buffer.toString("utf8");
    if (!cssText.includes("@font-face")) continue;

    const blocks = cssText.match(/@font-face\s*\{[\s\S]*?\}/gi) || [];
    for (const block of blocks) {
      const familyNameRaw = parseCssDeclarationValue(block, "font-family");
      if (!familyNameRaw) continue;
      const familyName = familyNameRaw.replace(/\s+/g, " ").trim();
      if (!familyName) continue;

      const fontStyle = parseCssDeclarationValue(block, "font-style");
      const fontWeight = parseCssDeclarationValue(block, "font-weight");

      let styleName = familyName;
      if (fontStyle && /italic|oblique/i.test(fontStyle) && !/italic|oblique/i.test(styleName)) {
        styleName = `${styleName} Italic`.replace(/\s+/g, " ").trim();
      }

      const srcValue = parseCssDeclarationValue(block, "src") || "";
      const srcMatches = srcValue.match(/url\(([^)]+)\)/gi) || [];
      for (const srcMatch of srcMatches) {
        const rawUrl = asString(srcMatch.match(/url\(([^)]+)\)/i)?.[1]);
        if (!rawUrl) continue;

        const cleaned = rawUrl
          .replace(/^['"]|['"]$/g, "")
          .replace(/\\\//g, "/")
          .trim();

        let absolute = "";
        try {
          absolute = cleaned.startsWith("http://") || cleaned.startsWith("https://") ? new URL(cleaned).href : new URL(cleaned, asset.url).href;
        } catch {
          continue;
        }

        const absoluteLower = absolute.toLowerCase();
        if (!absoluteLower.includes("fonts.fontdue.com/hanli/fonts/")) continue;

        const key = normalizeAssetUrlKey(absolute);
        if (!key) continue;
        if (!out.has(key)) {
          out.set(key, {
            styleName,
            familyName,
            fontStyle,
            fontWeight
          });
        }
      }
    }
  }

  return out;
};

const resolveHanliMappedStyleName = (
  assetUrl: string,
  styleMap: Map<string, HanliStyleMapEntry>
): string | undefined => {
  if (styleMap.size === 0) return undefined;

  const direct = styleMap.get(normalizeAssetUrlKey(assetUrl));
  if (direct?.styleName) return direct.styleName;

  let fileName = "";
  try {
    fileName = path.basename(new URL(assetUrl).pathname).toLowerCase();
  } catch {
    fileName = path.basename(assetUrl).toLowerCase();
  }
  if (!fileName) return undefined;

  for (const [key, value] of styleMap.entries()) {
    if (key.endsWith(`/${fileName}`) && value.styleName) {
      return value.styleName;
    }
  }

  return undefined;
};

const selectHanliCandidateStreams = (
  candidates: CapturedAsset[],
  styleMap: Map<string, HanliStyleMapEntry>
): CapturedAsset[] => {
  if (candidates.length === 0) return [];
  if (styleMap.size === 0) return candidates;

  const chosenByStyleAndExt = new Map<string, CapturedAsset>();
  const passthrough: CapturedAsset[] = [];

  for (const asset of candidates) {
    const ext = detectFontExt(asset.buffer, asset.contentType, asset.url);
    const mappedStyle = resolveHanliMappedStyleName(asset.url, styleMap);
    const styleToken = mappedStyle ? normalizeCoverageToken(mappedStyle) : "";
    if (!ext || !styleToken) {
      passthrough.push(asset);
      continue;
    }

    const key = `${styleToken}|${ext}`;
    const previous = chosenByStyleAndExt.get(key);
    if (!previous || asset.buffer.length < previous.buffer.length) {
      chosenByStyleAndExt.set(key, asset);
    }
  }

  return [...passthrough, ...Array.from(chosenByStyleAndExt.values())];
};

const buildTargetCoverageAudit = async (params: {
  request: BrowserRequest;
  host: string;
  outputDir: string;
  validationLogPath?: string;
  targetTokens: string[];
  linetoSessionPostscriptNames: string[];
}): Promise<Record<string, unknown> | undefined> => {
  const { request, host, outputDir, validationLogPath, targetTokens, linetoSessionPostscriptNames } = params;
  const profile = getTargetProfile(request);
  const catalogExpectedStyles = asStringArray(profile?.expectedStyles);
  const catalogExpectedPostscriptNames = asStringArray(profile?.expectedPostscriptNames);
  const sessionExpectedPostscriptNames = Array.from(
    new Set(
      linetoSessionPostscriptNames
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  const normalizedSessionPostscriptNames = collapseDominantPostscriptPrefix(sessionExpectedPostscriptNames);

  let expectedPostscriptNames: string[] = [];
  if (catalogExpectedPostscriptNames.length > 0 && normalizedSessionPostscriptNames.length > 0) {
    const catalogTokens = new Set(
      catalogExpectedPostscriptNames
        .map((value) => normalizeCoverageToken(value))
        .filter(Boolean)
    );
    const intersection = normalizedSessionPostscriptNames.filter((value) =>
      catalogTokens.has(normalizeCoverageToken(value))
    );
    expectedPostscriptNames = intersection.length > 0 ? intersection : catalogExpectedPostscriptNames;
  } else if (normalizedSessionPostscriptNames.length > 0) {
    expectedPostscriptNames = normalizedSessionPostscriptNames;
  } else {
    expectedPostscriptNames = catalogExpectedPostscriptNames;
  }
  const expectedStylesFromPostscript = expectedPostscriptNames.map((ps) => extractStyleFromPostscript(ps));
  const profileSourceToken = (asString(profile?.source) || "").toLowerCase();
  const shouldPreferCatalogStyles =
    catalogExpectedStyles.length > 0 &&
    (
      profileSourceToken.includes("html-option-scan") ||
      profileSourceToken.includes("collection-page-crawl") ||
      catalogExpectedStyles.length <= 120
    ) &&
    expectedStylesFromPostscript.length < catalogExpectedStyles.length;
  const expectedStyles =
    shouldPreferCatalogStyles
      ? catalogExpectedStyles
      : expectedStylesFromPostscript.length > 0
        ? expectedStylesFromPostscript
        : catalogExpectedStyles;

  const normalizedExpectedStyles = new Map<string, string>();
  for (const style of expectedStyles) {
    const token = normalizeCoverageToken(style);
    if (!token) continue;
    if (!normalizedExpectedStyles.has(token)) normalizedExpectedStyles.set(token, style);
  }

  const normalizedExpectedPostscript = new Map<string, string>();
  for (const ps of expectedPostscriptNames) {
    const token = normalizeCoverageToken(ps);
    if (!token) continue;
    if (!normalizedExpectedPostscript.has(token)) normalizedExpectedPostscript.set(token, ps);
  }
  const expectedPostscriptTokens = Array.from(normalizedExpectedPostscript.keys());

  const absoluteValidationPath = validationLogPath
    ? path.resolve(process.cwd(), validationLogPath)
    : path.join(outputDir, "validation-log.json");

  let validationData: Record<string, unknown> | undefined;
  try {
    const raw = await readFile(absoluteValidationPath, "utf8");
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) validationData = parsed;
  } catch {
    validationData = undefined;
  }

  const validationFullFonts = Array.isArray(validationData?.full_fonts) ? validationData?.full_fonts : [];
  const observedStyles = new Map<string, string>();
  const observedPostscript = new Map<string, string>();

  for (const entry of validationFullFonts) {
    if (!isRecord(entry)) continue;
    const entryFileName =
      asString(entry.filename) ||
      (typeof entry.path === "string" ? path.basename(entry.path) : "") ||
      "";
    const postscriptName = asString(entry.postscript_name);
    const subfamilyName = asString(entry.subfamily_name);
    if (postscriptName) {
      const psToken = normalizeCoverageToken(postscriptName);
      if (psToken && !observedPostscript.has(psToken)) observedPostscript.set(psToken, postscriptName);

      const styleFromPs = normalizeItalicStyleLabel(
        extractStyleFromPostscript(postscriptName),
        entryFileName
      );
      if (!isCoverageNoiseStyle(styleFromPs)) {
        const styleToken = normalizeCoverageToken(styleFromPs);
        if (styleToken && !observedStyles.has(styleToken)) observedStyles.set(styleToken, styleFromPs);
      }
    }
    if (subfamilyName) {
      const normalizedSubfamily = normalizeItalicStyleLabel(subfamilyName, entryFileName);
      if (!isCoverageNoiseStyle(normalizedSubfamily)) {
        const subToken = normalizeCoverageToken(normalizedSubfamily);
        if (subToken && !observedStyles.has(subToken)) observedStyles.set(subToken, normalizedSubfamily);
      }
    }

    if (profileSourceToken.includes("hanli-wordpress-fontdue-css") && normalizedExpectedStyles.size > 0) {
      const fileStemToken = normalizeCoverageToken(entryFileName.replace(/.[^.]+$/, ""));
      if (fileStemToken) {
        for (const [expectedToken, expectedStyle] of normalizedExpectedStyles.entries()) {
          if (!fileStemToken.includes(expectedToken)) continue;
          if (!observedStyles.has(expectedToken)) {
            observedStyles.set(expectedToken, expectedStyle);
          }
        }
      }
    }
  }
  const observedPostscriptTokens = Array.from(observedPostscript.keys());
  const optionalExpectedStyleTokens = new Set<string>();
  const hasTextVariableSignal =
    observedPostscriptTokens.some((token) => token.includes("textvariable")) ||
    expectedPostscriptTokens.some((token) => token.includes("textvariable"));
  const hasTextStaticSignal =
    observedPostscriptTokens.some((token) => token.includes("text") && !token.includes("variable")) ||
    expectedPostscriptTokens.some((token) => token.includes("text") && !token.includes("variable"));
  if (hasTextVariableSignal && !hasTextStaticSignal) {
    for (const [token] of normalizedExpectedStyles.entries()) {
      if (token.startsWith("text")) optionalExpectedStyleTokens.add(token);
    }
  }

  const effectiveExpectedStyles = new Map(
    Array.from(normalizedExpectedStyles.entries()).filter(([token]) => !optionalExpectedStyleTokens.has(token))
  );
  const postscriptTokensMatch = (expectedToken: string, observedToken: string): boolean =>
    expectedToken === observedToken ||
    observedToken.startsWith(expectedToken) ||
    expectedToken.startsWith(observedToken);

  if (observedStyles.size === 0 && effectiveExpectedStyles.size === 0 && normalizedExpectedPostscript.size === 0) {
    return undefined;
  }

  const missingStyles = Array.from(effectiveExpectedStyles.entries())
    .filter(([token]) => !observedStyles.has(token))
    .map(([, source]) => source);
  const unexpectedStyles =
    effectiveExpectedStyles.size > 0
      ? Array.from(observedStyles.entries())
          .filter(([token]) => !effectiveExpectedStyles.has(token))
          .map(([, source]) => source)
      : [];

  const missingPostscriptNames = Array.from(normalizedExpectedPostscript.entries())
    .filter(([token]) => !observedPostscriptTokens.some((observedToken) => postscriptTokensMatch(token, observedToken)))
    .map(([, source]) => source);
  const unexpectedPostscriptNames =
    normalizedExpectedPostscript.size > 0
      ? Array.from(observedPostscript.entries())
          .filter(([token]) => !expectedPostscriptTokens.some((expectedToken) => postscriptTokensMatch(expectedToken, token)))
          .map(([, source]) => source)
      : [];

  const summary = isRecord(validationData?.summary) ? validationData?.summary : {};
  const asFiniteNumber = (value: unknown): number | undefined => {
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  };
  const validationStatus = asString(summary.status) || "unknown";
  const totalFonts = Number(summary.total_files || 0);
  const validFonts = Number(summary.valid_fonts || 0);
  const fullFonts = Number(summary.full_fonts || 0);
  const subsettedFonts = Number(summary.subsetted_fonts || 0);
  const invalidFonts = Number(summary.invalid_fonts || 0);
  const contaminationFonts = Number(summary.contamination_fonts || 0);
  const italicMismatches = Number(summary.italic_mismatches || 0);
  const nameTableBadFonts = Number(summary.name_table_bad_fonts || 0);
  const averageGlyphs = asFiniteNumber(summary.average_glyphs);
  const averageFeatureCount = asFiniteNumber(summary.average_feature_count);
  const commonFeatureTagsRaw = Array.isArray(summary.common_feature_tags) ? summary.common_feature_tags : [];
  const commonFeatureTags = commonFeatureTagsRaw
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      tag: asString(item.tag),
      count: Number(item.count || 0)
    }))
    .filter((item) => Boolean(item.tag) && Number.isFinite(item.count) && item.count > 0)
    .map((item) => ({ tag: item.tag as string, count: item.count }));

  let desktopFonts = 0;
  let desktopFullFonts = 0;
  for (const entry of validationFullFonts) {
    if (!isRecord(entry)) continue;
    const ext = asString(entry.ext)?.toLowerCase();
    if (ext !== "otf" && ext !== "ttf") continue;
    desktopFonts += 1;
    const isSubset = entry.is_subetted;
    const isSubsetTrue = isSubset === true || isSubset === 1 || String(isSubset).toLowerCase() === "true";
    if (!isSubsetTrue) desktopFullFonts += 1;
  }

  const printReadiness: "likely-safe" | "warn" | "high-risk" =
    desktopFonts === 0 || validFonts === 0
      ? "high-risk"
      : invalidFonts > 0 || nameTableBadFonts > 0 || italicMismatches > 0 || desktopFullFonts < desktopFonts
        ? "warn"
        : "likely-safe";

  const expectedStyleCount = effectiveExpectedStyles.size;
  const observedStyleCount = observedStyles.size;
  const matchedStyleCount = Math.max(0, expectedStyleCount - missingStyles.length);
  const styleAccuracyPct =
    expectedStyleCount > 0 ? Number(((matchedStyleCount / expectedStyleCount) * 100).toFixed(2)) : undefined;
  const strictMissingStyles = profile?.strictMissingStyles === true;
  const contaminationRatio = totalFonts > 0 ? contaminationFonts / totalFonts : 0;

  let status: "pass" | "warn" | "fail" = "pass";
  if (validationStatus === "fail") {
    status = "fail";
  } else if (strictMissingStyles && expectedStyleCount === 0 && observedStyleCount > 0) {
    status = "fail";
  } else if (expectedStyleCount > 0 && matchedStyleCount === 0) {
    status = "fail";
  } else if (contaminationFonts > 0 && contaminationRatio >= 0.3) {
    status = "fail";
  } else if (
    missingStyles.length > 0 ||
    missingPostscriptNames.length > 0 ||
    invalidFonts > 0 ||
    contaminationFonts > 0 ||
    italicMismatches > 0 ||
    nameTableBadFonts > 0
  ) {
    status = "warn";
  }

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: "analysis-audit-v2",
    mode: "browser-intercept",
    targetUrl: request.targetUrl,
    host,
    targetTokens,
    profile: {
      profileId: asString(profile?.profileId),
      source: asString(profile?.source),
      familyDisplay: asString(profile?.familyDisplay) || asString(profile?.family),
      familyPostscript: asString(profile?.familyPostscript),
      targetSlug: asString(profile?.targetSlug),
      strictMissingStyles,
      catalogExpectedStyleCount: catalogExpectedStyles.length,
      catalogExpectedPostscriptCount: catalogExpectedPostscriptNames.length
    },
    expected: {
      styles: Array.from(effectiveExpectedStyles.values()),
      optionalExcludedStyles: Array.from(optionalExpectedStyleTokens.values())
        .map((token) => normalizedExpectedStyles.get(token) || "")
        .filter(Boolean),
      postscriptNames: Array.from(normalizedExpectedPostscript.values()),
      sessionPostscriptNames: normalizedSessionPostscriptNames
    },
    observed: {
      styles: Array.from(observedStyles.values()),
      postscriptNames: Array.from(observedPostscript.values()),
      observedStyleCount,
      observedPostscriptCount: observedPostscript.size
    },
    coverage: {
      expectedStyleCount,
      matchedStyleCount,
      missingStyleCount: missingStyles.length,
      styleAccuracyPct
    },
    missingStyles,
    unexpectedStyles,
    missingPostscriptNames,
    unexpectedPostscriptNames,
    validationSnapshot: {
      status: validationStatus,
      totalFonts,
      validFonts,
      fullFonts,
      subsettedFonts,
      invalidFonts,
      contaminationFonts,
      contaminationRatio: Number(contaminationRatio.toFixed(4)),
      italicMismatches,
      nameTableBadFonts,
      averageGlyphs,
      averageFeatureCount,
      commonFeatureTags
    },
    qualitySignals: {
      styleAccuracyPct,
      printReadiness,
      desktopFonts,
      desktopFullFonts,
      averageGlyphs,
      averageFeatureCount,
      commonFeatureTags
    },
    status
  };
};

const buildQualityAuditFromTargetCoverage = (
  targetAudit: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (!isRecord(targetAudit)) return undefined;
  const coverage = isRecord(targetAudit.coverage) ? targetAudit.coverage : {};
  const profile = isRecord(targetAudit.profile) ? targetAudit.profile : {};
  const validationSnapshot = isRecord(targetAudit.validationSnapshot) ? targetAudit.validationSnapshot : {};
  const statusRaw = asString(targetAudit.status)?.toLowerCase();
  const status: "pass" | "warn" | "fail" =
    statusRaw === "fail" ? "fail" : statusRaw === "warn" ? "warn" : "pass";

  const expectedStyleCount = Number((coverage as any).expectedStyleCount);
  const matchedStyleCount = Number((coverage as any).matchedStyleCount);
  const missingStyleCount = Number((coverage as any).missingStyleCount);
  const observedStyleCount = Number((targetAudit as any)?.observed?.observedStyleCount);
  const styleCoveragePercent = Number((coverage as any).styleAccuracyPct);
  const qualitySignals = isRecord((targetAudit as any).qualitySignals) ? (targetAudit as any).qualitySignals : {};
  const targetUrl = asString((targetAudit as any).targetUrl);
  const host = asString((targetAudit as any).host);

  const failReasons: string[] = [];
  const warnReasons: string[] = [];
  if (status === "fail") {
    const missingStyles = Array.isArray((targetAudit as any).missingStyles) ? (targetAudit as any).missingStyles : [];
    const strictMissingStyles = Boolean((profile as any).strictMissingStyles);
    const contaminationFonts = Number((validationSnapshot as any).contaminationFonts);
    const contaminationRatio = Number((validationSnapshot as any).contaminationRatio);
    if (missingStyles.length > 0) {
      failReasons.push(`missing styles: ${missingStyles.join(", ")}`);
    } else if (strictMissingStyles && expectedStyleCount === 0 && observedStyleCount > 0) {
      failReasons.push("strict style profile is empty while observed fonts exist");
    } else if (
      Number.isFinite(contaminationFonts) &&
      Number.isFinite(contaminationRatio) &&
      contaminationFonts > 0 &&
      contaminationRatio >= 0.3
    ) {
      failReasons.push(
        `contamination too high: ${contaminationFonts} files (${(contaminationRatio * 100).toFixed(1)}%)`
      );
    } else {
      failReasons.push("target coverage gate marked this run as fail");
    }
  }
  if (status === "warn") {
    const missingStyles = Array.isArray((targetAudit as any).missingStyles) ? (targetAudit as any).missingStyles : [];
    const missingPostscriptNames = Array.isArray((targetAudit as any).missingPostscriptNames)
      ? (targetAudit as any).missingPostscriptNames
      : [];
    if (missingStyles.length > 0) warnReasons.push(`missing styles: ${missingStyles.join(", ")}`);
    if (missingPostscriptNames.length > 0) warnReasons.push(`missing postscript names: ${missingPostscriptNames.join(", ")}`);
    if (warnReasons.length === 0) warnReasons.push("target coverage gate marked this run as warn");
  }

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: "quality-audit-v2",
    mode: "browser-intercept",
    targetUrl,
    host,
    foundry: asString(profile.foundry) || asString(profile.familyDisplay) || "Unknown Foundry",
    status,
    qualityStatus: status,
    profile: {
      profileId: asString(profile.profileId),
      source: asString(profile.source),
      familyDisplay: asString(profile.familyDisplay),
      familyPostscript: asString(profile.familyPostscript),
      targetSlug: asString(profile.targetSlug)
    },
    summary: {
      expectedStyleCount: Number.isFinite(expectedStyleCount) ? expectedStyleCount : undefined,
      observedStyleCount: Number.isFinite(observedStyleCount) ? observedStyleCount : undefined,
      styleCoveragePercent: Number.isFinite(styleCoveragePercent) ? styleCoveragePercent : undefined,
      failReasonCount: failReasons.length,
      warnReasonCount: warnReasons.length
    },
    failReasons,
    warnReasons,
    coverage: {
      expectedStyleCount: Number.isFinite(expectedStyleCount) ? expectedStyleCount : undefined,
      matchedStyleCount: Number.isFinite(matchedStyleCount)
        ? matchedStyleCount
        : Number.isFinite(expectedStyleCount) && Number.isFinite(missingStyleCount)
          ? Math.max(0, expectedStyleCount - missingStyleCount)
          : undefined,
      missingStyleCount: Number.isFinite(missingStyleCount) ? missingStyleCount : undefined,
      styleCoveragePercent: Number.isFinite(styleCoveragePercent) ? styleCoveragePercent : undefined,
      expectedStyles: Array.isArray((targetAudit as any)?.expected?.styles) ? (targetAudit as any).expected.styles : [],
      observedStyles: Array.isArray((targetAudit as any)?.observed?.styles) ? (targetAudit as any).observed.styles : [],
      missingStyles: Array.isArray((targetAudit as any).missingStyles) ? (targetAudit as any).missingStyles : []
    },
    validationSnapshot,
    qualitySignals
  };
};

const isSafeZipEntryPath = (entryName: string): boolean => {
  const normalized = entryName.replace(/\\/g, "/");
  if (!normalized) return false;
  if (normalized.startsWith("/") || normalized.startsWith("\\")) return false;
  if (normalized.includes("\u0000")) return false;
  if (normalized.split("/").some((segment) => segment === "..")) return false;
  return true;
};

const extractZipFonts = async (
  zipPath: string,
  outputDir: string,
  sourceUrl: string,
  downloaded: DownloadedFile[],
  seenPaths: Set<string>
): Promise<void> => {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const folderName = toSafeSegment(path.basename(zipPath, path.extname(zipPath)) || "zip-fonts");
  const extractionDir = joinOpaquePath(outputDir, folderName);
  await mkdir(extractionDir, { recursive: true });

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!isSafeZipEntryPath(entry.entryName)) continue;
    const normalized = entry.entryName.replace(/\\/g, "/");
    const ext = path.extname(normalized).toLowerCase();
    if (![".woff2", ".woff", ".ttf", ".otf", ".eot"].includes(ext)) continue;

    const baseName = toSafeFileName(path.basename(normalized));
    const targetPath = ensureUniqueFilePath(extractionDir, baseName);
    await writeFile(targetPath, entry.getData());

    const relative = toRelative(targetPath);
    if (seenPaths.has(relative)) continue;
    seenPaths.add(relative);
    downloaded.push({
      fileName: path.basename(targetPath),
      filePath: relative,
      sourceUrl,
      name: composeDisplayNameFromFileName(path.basename(targetPath))
    });
  }
};

const convertAndRegister = async (
  absolutePath: string,
  sourceUrl: string,
  downloaded: DownloadedFile[],
  seenPaths: Set<string>
): Promise<void> => {
  const ext = path.extname(absolutePath).toLowerCase();
  if (![".woff2", ".woff", ".ttf", ".otf"].includes(ext)) return;

  const parsed = splitFamilySubFamily(path.basename(absolutePath));
  try {
    let sourceHost = "";
    try {
      sourceHost = new URL(sourceUrl).host.toLowerCase();
    } catch {
      sourceHost = "";
    }
    const sourceBase = path.basename(absolutePath, path.extname(absolutePath)).toLowerCase();
    const isLikelyCoType =
      sourceHost.includes("cotypefoundry.com") ||
      /(?:^|-)aeonik|soft-pro-vf/.test(sourceBase);

    const conversionMetadata = (() => {
      if (!isLikelyCoType) return parsed;
      const cotypeFamily = resolveCoTypeFamilyHint(absolutePath);
      if (!cotypeFamily) return parsed;
      // Avoid numeric family leakage (e.g., "1742845938-Air.ttf") on exploded VF instances.
      return { family: cotypeFamily, subFamily: "Regular" };
    })();

    const converted = await convertToMultipleFormats(absolutePath, conversionMetadata, {
      preserveBaseName: true,
      // Pangram variable fonts often carry opaque VF identifiers in name tables.
      // Keep raw VF files, but skip instance explosion to avoid inaccurate style/family naming.
      disableInstanceExplosion: sourceHost.includes("pangrampangram.com")
    });

    const registerVariant = (variant: string | null | undefined, variantSourceUrl: string): void => {
      if (!variant) return;
      const normalized = path.resolve(variant);
      if (normalized === path.resolve(absolutePath)) return;
      const relative = toRelative(normalized);
      if (seenPaths.has(relative)) return;
      seenPaths.add(relative);

      const extLabel = path.extname(normalized).replace(".", "").toUpperCase();
      downloaded.push({
        fileName: path.basename(normalized),
        filePath: relative,
        sourceUrl: variantSourceUrl,
        name: composeDisplayNameFromFileName(path.basename(normalized), extLabel)
      });
    };

    const variants = [converted.ttf, converted.otf, converted.woff, converted.woff2];
    for (const variant of variants) {
      registerVariant(variant, sourceUrl);
    }

    if (Array.isArray(converted.instances) && converted.instances.length > 0) {
      const shouldConvertLinetoInstances = sourceHost.includes("lineto.com");
      for (const instancePath of converted.instances) {
        let normalizedInstance = path.resolve(instancePath);
        if (isLikelyCoType) {
          const parentBase = toSafeFileName(path.basename(absolutePath, path.extname(absolutePath)));
          const instanceBase = path.basename(normalizedInstance);
          const instanceExt = path.extname(instanceBase) || ".ttf";
          const instanceStem = path.basename(instanceBase, instanceExt);
          const parentToken = parentBase.toLowerCase();
          const instanceToken = instanceBase.toLowerCase();
          if (parentToken && !instanceToken.includes(parentToken)) {
            const prefixedName = `${toSafeFileName(`${parentBase}-${instanceStem}`)}${instanceExt}`;
            const prefixedPath = ensureUniqueFilePath(path.dirname(normalizedInstance), prefixedName);
            try {
              await rename(normalizedInstance, prefixedPath);
              normalizedInstance = path.resolve(prefixedPath);
            } catch {
              // best-effort naming cleanup
            }
          }
        }
        const relativeInstance = toRelative(normalizedInstance);
        if (!seenPaths.has(relativeInstance)) {
          seenPaths.add(relativeInstance);
          downloaded.push({
            fileName: path.basename(normalizedInstance),
            filePath: relativeInstance,
            sourceUrl,
            name: composeDisplayNameFromFileName(path.basename(normalizedInstance))
          });
        }

        if (!shouldConvertLinetoInstances) continue;

        try {
          const instanceParsed = splitFamilySubFamily(path.basename(normalizedInstance));
          const instanceConverted = await convertToMultipleFormats(normalizedInstance, instanceParsed, {
            preserveBaseName: true,
            disableInstanceExplosion: true
          });
          const instanceVariants = [
            instanceConverted.ttf,
            instanceConverted.otf,
            instanceConverted.woff,
            instanceConverted.woff2
          ];
          for (const variant of instanceVariants) {
            if (!variant) continue;
            const variantAbsolute = path.resolve(variant);
            if (variantAbsolute === normalizedInstance) continue;
            registerVariant(variantAbsolute, sourceUrl);
          }
        } catch {
          // Keep generated TTF instances even when additional conversion fails.
        }
      }
    }
  } catch {
    // Keep raw output even when conversion fails.
  }
};

const buildCoTypeSelfAwarenessReport = (downloaded: DownloadedFile[]) => {
  const fontEntries = downloaded.filter((item) => /\.(woff2|woff|ttf|otf)$/i.test(item.fileName));
  const variants = ["aeonik", "soft", "condensed", "extended", "fono", "mono"];
  const byVariant: Record<string, { total: number; italicFiles: number }> = {};

  for (const variant of variants) {
    const scoped = fontEntries.filter((item) => item.fileName.toLowerCase().includes(variant));
    byVariant[variant] = {
      total: scoped.length,
      italicFiles: scoped.filter((item) => /italic|oblique/i.test(item.fileName)).length
    };
  }

  const italicCount = fontEntries.filter((item) => /italic|oblique/i.test(item.fileName)).length;
  const notes: string[] = [];
  if (italicCount === 0) {
    notes.push("No Italic/Oblique tokens detected in filenames (likely missing italic VF capture).");
  }

  return {
    target: "cotypefoundry.com",
    generatedAt: new Date().toISOString(),
    totals: {
      downloadedEntries: downloaded.length,
      fontFiles: fontEntries.length,
      italicFiles: italicCount
    },
    variants: byVariant,
    notes
  };
};

const extractCoTypeSlugFromUrl = (targetUrl: string): string | undefined => {
  try {
    const parsed = new URL(targetUrl);
    const segments = parsed.pathname
      .trim()
      .replace(/\/{2,}/g, "/")
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.toLowerCase());

    if (segments.length === 0) return undefined;
    const head = segments[0];
    if ((head === "font-family" || head === "our-fonts") && segments[1]) return segments[1];
    const tail = segments[segments.length - 1];
    if (tail === "font-family" || tail === "our-fonts") return undefined;
    return tail || undefined;
  } catch {
    return undefined;
  }
};

const parseCoTypeNextData = (html: string): unknown => {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
};

const extractCoTypeAssetUrl = (value: unknown): string | undefined => {
  const direct = asString(value);
  if (direct) {
    if (/^https?:\/\//i.test(direct)) return direct;
    if (/^\/\//.test(direct)) return `https:${direct}`;
  }

  if (!isRecord(value)) return undefined;
  const embedded = asString(value.url);
  if (!embedded) return undefined;
  if (/^https?:\/\//i.test(embedded)) return embedded;
  if (/^\/\//.test(embedded)) return `https:${embedded}`;
  return undefined;
};

const extractCoTypeAllFonts = (nextData: unknown): CoTypeFontRow[] => {
  if (!isRecord(nextData)) return [];
  const props = nextData.props;
  if (!isRecord(props)) return [];
  const siteSettings =
    (isRecord(props.siteSettings) ? props.siteSettings : undefined) ||
    (isRecord(props.pageProps) && isRecord(props.pageProps.siteSettings) ? props.pageProps.siteSettings : undefined);
  if (!isRecord(siteSettings)) return [];
  const allFonts = siteSettings.allFonts;
  if (!Array.isArray(allFonts)) return [];
  return allFonts.filter(isRecord);
};

const getCoTypeFontSlug = (row: CoTypeFontRow): string | undefined => asString(row.slug)?.toLowerCase();

const getCoTypeFontFamilySlug = (row: CoTypeFontRow): string | undefined => {
  const family = row.fontFamily;
  if (!isRecord(family)) return undefined;
  return asString(family.slug)?.toLowerCase();
};

const pickCoTypeGroupRows = (allFonts: CoTypeFontRow[], slug: string | undefined): CoTypeFontRow[] => {
  if (allFonts.length === 0 || !slug) return [];
  const normalizedSlug = slug.toLowerCase();
  const byFontSlug = allFonts.find((row) => getCoTypeFontSlug(row) === normalizedSlug);
  const byFamilySlug = allFonts.filter((row) => getCoTypeFontFamilySlug(row) === normalizedSlug);

  if (byFontSlug) {
    const familySlug = getCoTypeFontFamilySlug(byFontSlug) || getCoTypeFontSlug(byFontSlug) || normalizedSlug;
    return allFonts.filter((row) => {
      const candidate = getCoTypeFontFamilySlug(row) || getCoTypeFontSlug(row);
      return candidate === familySlug;
    });
  }

  return byFamilySlug;
};

const extractCoTypeVariableFontUrls = (html: string, pageUrl: string): string[] => {
  const nextData = parseCoTypeNextData(html);
  const allFonts = extractCoTypeAllFonts(nextData);
  if (allFonts.length === 0) return [];

  const slug = extractCoTypeSlugFromUrl(pageUrl);
  const rows = pickCoTypeGroupRows(allFonts, slug);
  const urls = new Set<string>();
  for (const row of rows) {
    const variable = extractCoTypeAssetUrl(row.variableFontFile);
    if (variable) urls.add(variable);
    const italic = extractCoTypeAssetUrl(row.variableFontFileItalic);
    if (italic) urls.add(italic);
  }
  return Array.from(urls);
};

export const fetchTextWithTimeout = async (
  url: string,
  timeoutMs = 30000,
  headers?: Record<string, string>
): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
};

export const fetchBufferWithTimeout = async (
  url: string,
  timeoutMs = 30000,
  headers?: Record<string, string>
): Promise<Buffer> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
};

const runCoTypeItalicSupplement = async (
  request: BrowserRequest,
  outputDir: string,
  downloaded: DownloadedFile[],
  skipped: SkippedItem[],
  seenPaths: Set<string>,
  logProgress: (message: string) => Promise<void>
): Promise<void> => {
  const pages = new Set<string>([request.targetUrl]);
  if (isRecord(request.metadata) && Array.isArray(request.metadata.collectionUrls)) {
    for (const url of request.metadata.collectionUrls) {
      if (typeof url === "string" && /^https?:\/\//i.test(url)) pages.add(url);
    }
  }

  const assetUrls = new Set<string>();
  for (const pageUrl of pages) {
    try {
      const html = await fetchTextWithTimeout(pageUrl, 45000, {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": BROWSER_UA
      });
      for (const asset of extractCoTypeVariableFontUrls(html, pageUrl)) {
        assetUrls.add(asset);
      }
    } catch {
      // best-effort
    }
  }

  const seenSourceUrls = new Set(downloaded.map((item) => item.sourceUrl));
  const pending = Array.from(assetUrls).filter((url) => !seenSourceUrls.has(url));
  if (pending.length === 0) return;

  await logProgress(`[CoType] NextData supplement downloading ${pending.length} hidden VF assets...`);

  for (const assetUrl of pending) {
    try {
      const buffer = await fetchBufferWithTimeout(assetUrl, 45000, {
        Accept: "*/*",
        Referer: request.targetUrl,
        "User-Agent": BROWSER_UA
      });

      const ext = detectFontExt(buffer, "application/octet-stream", assetUrl);
      if (!ext) {
        skipped.push({ index: skipped.length, reason: "CoType supplement: unsupported asset format.", name: assetUrl });
        continue;
      }

      const stem = toSafeFileName(extractBaseNameFromUrl(assetUrl).replace(/\.[^.]+$/, ""));
      const fullPath = ensureUniqueFilePath(outputDir, `${stem}${ext}`);
      await writeFile(fullPath, buffer);

      const relative = toRelative(fullPath);
      if (!seenPaths.has(relative)) {
        seenPaths.add(relative);
        downloaded.push({
          fileName: path.basename(fullPath),
          filePath: relative,
          sourceUrl: assetUrl,
          name: composeDisplayNameFromFileName(path.basename(fullPath))
        });
      }
      await convertAndRegister(fullPath, assetUrl, downloaded, seenPaths);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      skipped.push({ index: skipped.length, reason: `CoType supplement failed: ${reason}`, name: assetUrl });
    }
  }
};

const collectPangramCollectionPages = (request: BrowserRequest): string[] => {
  const pages = new Set<string>([request.targetUrl]);

  const addPage = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) return;
    pages.add(trimmed);
  };

  if (!isRecord(request.metadata)) return Array.from(pages);

  const topCollectionUrls = Array.isArray(request.metadata.collectionFamilyUrls)
    ? request.metadata.collectionFamilyUrls
    : [];
  for (const pageUrl of topCollectionUrls) addPage(pageUrl);

  const topLegacyUrls = Array.isArray(request.metadata.collectionUrls)
    ? request.metadata.collectionUrls
    : [];
  for (const pageUrl of topLegacyUrls) addPage(pageUrl);

  const fonts = Array.isArray(request.metadata.fonts) ? request.metadata.fonts : [];
  for (const font of fonts) {
    if (!isRecord(font) || !isRecord(font.metadata)) continue;
    const nestedCollectionUrls = Array.isArray(font.metadata.collectionFamilyUrls)
      ? font.metadata.collectionFamilyUrls
      : [];
    for (const pageUrl of nestedCollectionUrls) addPage(pageUrl);

    const nestedLegacyUrls = Array.isArray(font.metadata.collectionUrls)
      ? font.metadata.collectionUrls
      : [];
    for (const pageUrl of nestedLegacyUrls) addPage(pageUrl);
  }

  return Array.from(pages);
};

const runPangramCollectionSupplement = async (params: {
  request: BrowserRequest;
  outputDir: string;
  downloaded: DownloadedFile[];
  skipped: SkippedItem[];
  seenPaths: Set<string>;
  seenHashes: Set<string>;
  targetTokens: string[];
  targetSlug?: string;
  logProgress: (message: string) => Promise<void>;
}): Promise<void> => {
  const { request, outputDir, downloaded, skipped, seenPaths, seenHashes, targetTokens, targetSlug, logProgress } = params;
  const pageUrls = collectPangramCollectionPages(request);
  if (pageUrls.length <= 1) return;

  const discoveredAssetUrls = new Set<string>();
  for (const pageUrl of pageUrls) {
    try {
      const html = await fetchTextWithTimeout(pageUrl, 45000, {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": BROWSER_UA
      });
      for (const assetUrl of extractFontUrlsFromText(html, pageUrl)) {
        discoveredAssetUrls.add(assetUrl);
      }
    } catch {
      // best-effort diagnostics only
    }
  }

  if (discoveredAssetUrls.size === 0) return;

  const seenSourceUrls = new Set(downloaded.map((item) => item.sourceUrl));
  const pendingUrls = Array.from(discoveredAssetUrls).filter((url) => !seenSourceUrls.has(url));
  if (pendingUrls.length === 0) return;

  await logProgress(`[Pangram] Collection supplement discovered ${pendingUrls.length} additional asset candidates.`);

  let filteredByToken = 0;
  for (const assetUrl of pendingUrls) {
    if (shouldApplyTokenFilter("pangrampangram.com") && targetTokens.length > 0 && !assetMatchesTokens(assetUrl, targetTokens)) {
      filteredByToken += 1;
      continue;
    }

    try {
      const buffer = await fetchBufferWithTimeout(assetUrl, 45000, {
        Accept: "*/*",
        Referer: request.targetUrl,
        "User-Agent": BROWSER_UA
      });
      const ext = detectFontExt(buffer, "application/octet-stream", assetUrl);
      if (!ext) {
        skipped.push({
          index: skipped.length,
          reason: "Pangram supplement: unsupported asset format.",
          name: assetUrl
        });
        continue;
      }

      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);

      let base = extractBaseNameFromUrl(assetUrl).replace(/\.[^.]+$/, "") || shortHash(buffer);
      base = normalizePangramBaseName(base, targetSlug);
      const fileName = toSafeFileName(base) + ext;
      const filePath = ensureUniqueFilePath(outputDir, fileName);
      await writeFile(filePath, buffer);

      const relative = toRelative(filePath);
      if (!seenPaths.has(relative)) {
        seenPaths.add(relative);
        downloaded.push({
          fileName: path.basename(filePath),
          filePath: relative,
          sourceUrl: assetUrl,
          name: composeDisplayNameFromFileName(path.basename(filePath))
        });
      }

      if (ext === ".zip") {
        await extractZipFonts(filePath, outputDir, assetUrl, downloaded, seenPaths);
      } else {
        await convertAndRegister(filePath, assetUrl, downloaded, seenPaths);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      skipped.push({
        index: skipped.length,
        reason: `Pangram supplement failed: ${reason}`,
        name: assetUrl
      });
    }
  }

  if (filteredByToken > 0) {
    skipped.push({
      index: skipped.length,
      reason: `Pangram supplement filtered by target token (${filteredByToken}).`,
      name: request.targetUrl
    });
  }
};

const waitForCaptureStability = async (
  captured: CapturedAsset[],
  maxMs = 30000,
  stableRoundsThreshold = 4
): Promise<void> => {
  const start = Date.now();
  let lastCount = captured.length;
  let stableRounds = 0;
  while (Date.now() - start < maxMs) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (captured.length > lastCount) {
      lastCount = captured.length;
      stableRounds = 0;
      continue;
    }
    stableRounds += 1;
    if (stableRounds >= stableRoundsThreshold) break;
  }
};

const navigateWithRetry = async (
  page: Page,
  targetUrl: string,
  logProgress: (message: string) => Promise<void>
): Promise<{ status?: number; finalUrl: string }> => {
  const attempts: Array<{ waitUntil: "domcontentloaded" | "networkidle2"; timeout: number }> = [
    { waitUntil: "domcontentloaded", timeout: 60000 },
    { waitUntil: "networkidle2", timeout: 90000 },
    { waitUntil: "domcontentloaded", timeout: 120000 }
  ];

  let lastError: unknown;
  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    try {
      const response = await page.goto(targetUrl, { waitUntil: attempt.waitUntil, timeout: attempt.timeout });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return {
        status: response?.status(),
        finalUrl: page.url()
      };
    } catch (error) {
      lastError = error;
      const reason = error instanceof Error ? error.message : String(error);
      const attemptLabel = `${i + 1}/${attempts.length}`;
      await logProgress(`[Nav] Attempt ${attemptLabel} failed (${reason}).`);
      if (i < attempts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (i + 1)));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || "navigation failed"));
};

export const runBrowserIntercept = async (request: BrowserRequest): Promise<DownloadResult> => {
  const outputDir = makeJobFolder(request);
  const host = new URL(request.targetUrl).host.toLowerCase();
  const policy = resolveBrowserExecutionPolicy(request);
  const requestMetadata = isRecord(request.metadata) ? request.metadata : {};
  const proxyAttemptRaw = asNumber((requestMetadata as any)._proxyAttempt);
  const proxyAttempt = Number.isFinite(proxyAttemptRaw) ? Math.max(0, Math.floor(proxyAttemptRaw as number)) : 0;
  const maxProxyAttempts = Math.max(1, Math.min(policy.maxAttempts, policy.proxies.length || 1));
  const activeProxy = policy.proxies.length > 0 ? policy.proxies[Math.min(proxyAttempt, policy.proxies.length - 1)] : undefined;
  const hasNextProxyAttempt =
    policy.rotateOnBlocked &&
    policy.proxies.length > 0 &&
    proxyAttempt + 1 < Math.min(policy.proxies.length, maxProxyAttempts);
  const targetTokens = extractTargetTokens(request);
  const tf205StyleMap = host.includes("205.tf") ? build205StyleMap(request) : new Map<string, TF205StyleMapEntry>();
  const targetSlug = extractTargetSlug(request.targetUrl);
  const targetProfile = getTargetProfile(request);
  const linetoExpectedPostscriptTokens = new Set(
    (host.includes("lineto.com") ? asStringArray(targetProfile?.expectedPostscriptNames) : [])
      .map((value) => normalizeCoverageToken(value))
      .filter(Boolean)
  );
  const shouldKeepLinetoPostscript = (value: string | undefined): boolean => {
    if (!value) return false;
    if (linetoExpectedPostscriptTokens.size === 0) return true;
    const token = normalizeCoverageToken(value);
    return Boolean(token) && linetoExpectedPostscriptTokens.has(token);
  };
  const hanliExpectedStyleTokens = new Set(
    (host.includes("type.hanli.eu") ? asStringArray(targetProfile?.expectedStyles) : [])
      .map((value) => normalizeCoverageToken(value))
      .filter(Boolean)
  );

  await mkdir(outputDir, { recursive: true });

  const captured: CapturedAsset[] = [];
  const downloaded: DownloadedFile[] = [];
  const skipped: SkippedItem[] = [];
  const seenHashes = new Set<string>();
  const seenPaths = new Set<string>();
  const linetoSessionPostscriptNames = new Set<string>();
  let hanliStyleMap = new Map<string, HanliStyleMapEntry>();
  let browser: Browser | null = null;
  let shouldDiscardSession = false;
  let sessionHandle:
    | Awaited<ReturnType<typeof acquireBrowserSession>>
    | null = null;
  let page: Page | null = null;
  let interceptor: InterceptionService | null = null;

  const logProgress = async (message: string): Promise<void> => {
    if (request.onProgress) {
      request.onProgress({ type: "log", message });
    }
    console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
  };

  try {
    await logProgress(`Connecting to ${request.targetUrl}...`);
    if (activeProxy) {
      await logProgress(
        `[Proxy] attempt ${proxyAttempt + 1}/${maxProxyAttempts} using ${activeProxy.label}`
      );
    } else if (policy.proxies.length > 0) {
      await logProgress(
        `[Proxy] attempt ${proxyAttempt + 1}/${maxProxyAttempts} has no usable proxy candidate; continuing without proxy.`
      );
    }
    const baseLaunchOptions = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1920,1080"
      ]
    };
    if (activeProxy?.server) {
      baseLaunchOptions.args.push(`--proxy-server=${activeProxy.server}`);
    }

    const preferredExecutablePath = resolveBrowserExecutablePath();
    const launchCandidates: Array<{ label: string; executablePath?: string }> = [
      { label: "puppeteer-managed Chrome" }
    ];
    if (preferredExecutablePath) {
      launchCandidates.push({
        label: `explicit executable (${preferredExecutablePath})`,
        executablePath: preferredExecutablePath
      });
    }

    const launchBrowser = async (): Promise<Browser> => {
      let launchError: unknown;
      for (let attempt = 0; attempt < launchCandidates.length; attempt += 1) {
        const candidate = launchCandidates[attempt];
        const launchOptions: Record<string, unknown> = { ...baseLaunchOptions };
        if (candidate.executablePath) {
          launchOptions.executablePath = candidate.executablePath;
        }

        try {
          await logProgress(`[Launch] Trying ${candidate.label}...`);
          const launched = await puppeteer.launch(launchOptions as any);
          await logProgress(`[Launch] Browser started via ${candidate.label}.`);
          return launched;
        } catch (error) {
          launchError = error;
          const reason = error instanceof Error ? error.message : String(error);
          await logProgress(`[Launch] ${candidate.label} failed (${reason}).`);
        }
      }
      throw launchError instanceof Error ? launchError : new Error("Unable to launch browser.");
    };

    sessionHandle = await acquireBrowserSession({
      key: buildSessionPoolKey(host, policy, activeProxy),
      createBrowser: launchBrowser,
      enabled: policy.sessionEnabled,
      maxUses: policy.sessionMaxUses,
      ttlMs: policy.sessionTtlMs
    });
    browser = sessionHandle.browser;
    await logProgress(
      `[Session] ${sessionHandle.reused ? "reused" : "created"} browser session key=${sessionHandle.key}`
    );

    page = await browser.newPage();
    await page.setUserAgent(BROWSER_UA);
    await page.setViewport({ width: 1920, height: 1080 });
    await applyProxyAuthIfNeeded(page, activeProxy);

    interceptor = new InterceptionService();
    interceptor.on("font-captured", (event: any) => {
      if (!event?.buffer || !Buffer.isBuffer(event.buffer)) return;
      captured.push({
        url: String(event.url || ""),
        buffer: event.buffer,
        contentType: String(event.headers?.["content-type"] || ""),
        kind: "font",
        timestamp: Number(event.timestamp || Date.now())
      });
    });
    interceptor.on("metadata-captured", (event: any) => {
      if (!event?.buffer || !Buffer.isBuffer(event.buffer)) return;
      captured.push({
        url: String(event.url || ""),
        buffer: event.buffer,
        contentType: String(event.headers?.["content-type"] || ""),
        kind: "metadata",
        timestamp: Number(event.timestamp || Date.now())
      });
    });
    await interceptor.attach(page);

    const navigation = await navigateWithRetry(page, request.targetUrl, logProgress);
    const blockedDecision = await classifyBlockedNavigation({
      page,
      status: navigation.status,
      policy
    });
    if (blockedDecision.blocked) {
      shouldDiscardSession = true;
      const blockedMessage = blockedDecision.reason || "Blocked page detected.";
      await logProgress(
        `[Blocked] ${blockedMessage} ${
          blockedDecision.signals.length > 0 ? `(signals: ${blockedDecision.signals.join(", ")})` : ""
        }`
      );

      if (hasNextProxyAttempt) {
        throw new RotateProxyAttemptError(blockedMessage, proxyAttempt + 1);
      }
      throw new Error(`Blocked while opening ${request.targetUrl}: ${blockedMessage}`);
    }

    if (request.injectScript && request.injectScript.trim()) {
      await logProgress("Injecting provocation script...");
      let injectError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await page.evaluate(request.injectScript);
          injectError = undefined;
          break;
        } catch (error) {
          injectError = error;
          const reason = error instanceof Error ? error.message : String(error);
          const contextReset =
            /execution context was destroyed|cannot find context with specified id|target closed|session closed|navigated/i.test(
              reason
            );
          if (attempt === 0 && contextReset) {
            await logProgress("[Inject] Context reset detected, retrying once after settle...");
            try {
              await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
            } catch {
              // best-effort
            }
            await new Promise((resolve) => setTimeout(resolve, 1200));
            continue;
          }
          break;
        }
      }
      if (injectError) {
        const reason = injectError instanceof Error ? injectError.message : String(injectError);
        skipped.push({ index: skipped.length, reason: `Inject script failed: ${reason}` });
      }
    }

    await waitForCaptureStability(captured);

    if (host.includes("type.hanli.eu")) {
      hanliStyleMap = buildHanliStyleMap(captured);
      await logProgress("[Hanli] Parsed " + hanliStyleMap.size + " mapped font URLs from captured Fontdue CSS.");
    }

    const rawCandidates = captured.filter((asset) => {
      const ext = detectFontExt(asset.buffer, asset.contentType, asset.url);
      if (ext) return true;
      if (host.includes("lineto.com")) {
        const gateInfo = parseLinetoGateInfo(asset.url);
        if (gateInfo.isGate && !gateInfo.isBlockedPurpose) return true;
      }
      return false;
    });
    const candidates = host.includes("type.hanli.eu")
      ? selectHanliCandidateStreams(rawCandidates, hanliStyleMap)
      : rawCandidates;
    if (candidates.length !== rawCandidates.length) {
      await logProgress(
        `[Hanli] Candidate stream dedupe: ${rawCandidates.length} -> ${candidates.length} (style+format smallest payload).`
      );
    }
    await logProgress(`Captured ${candidates.length} candidate font streams.`);

    for (const asset of candidates) {
      let ext = detectFontExt(asset.buffer, asset.contentType, asset.url);

      if (!ext && host.includes("lineto.com")) {
        const gateInfo = parseLinetoGateInfo(asset.url);
        if (gateInfo.isGate) {
          if (gateInfo.isBlockedPurpose) {
            skipped.push({
              index: skipped.length,
              reason: `Filtered Lineto gate payload with blocked purpose: ${gateInfo.purpose || "unknown"}.`,
              name: asset.url
            });
            continue;
          }

          const parsedPostscriptNames = gateInfo.postscriptNames.filter((name) => shouldKeepLinetoPostscript(name));
          for (const name of parsedPostscriptNames) {
            linetoSessionPostscriptNames.add(name);
          }
          const decodedFonts = decodeLinetoGatePayload(asset.url, asset.buffer);
          let decodedCount = 0;
          for (const decoded of decodedFonts) {
            if (decoded.postscriptName && !shouldKeepLinetoPostscript(decoded.postscriptName)) {
              skipped.push({
                index: skipped.length,
                reason: `Filtered Lineto gate font outside target profile: ${decoded.postscriptName}.`,
                name: asset.url
              });
              continue;
            }
            const decodedExt = detectFontExt(
              decoded.buffer,
              "application/octet-stream",
              decoded.postscriptName ? `${decoded.postscriptName}.ttf` : asset.url
            );
            if (!decodedExt) continue;

            const decodedHash = crypto.createHash("sha256").update(decoded.buffer).digest("hex");
            if (seenHashes.has(decodedHash)) continue;
            seenHashes.add(decodedHash);

            if (decoded.postscriptName) linetoSessionPostscriptNames.add(decoded.postscriptName);

            const decodedStem = decoded.postscriptName
              ? toSafeFileName(decoded.postscriptName)
              : toSafeFileName(`${extractBaseNameFromUrl(asset.url)}-decoded-${decodedCount + 1}`);
            const decodedPath = ensureUniqueFilePath(outputDir, `${decodedStem}${decodedExt}`);
            await writeFile(decodedPath, decoded.buffer);

            const decodedRelative = toRelative(decodedPath);
            if (!seenPaths.has(decodedRelative)) {
              seenPaths.add(decodedRelative);
              downloaded.push({
                fileName: path.basename(decodedPath),
                filePath: decodedRelative,
                sourceUrl: asset.url,
                name: composeDisplayNameFromFileName(path.basename(decodedPath))
              });
            }

            if (decodedExt === ".zip") {
              await extractZipFonts(decodedPath, outputDir, asset.url, downloaded, seenPaths);
            } else {
              await convertAndRegister(decodedPath, asset.url, downloaded, seenPaths);
            }
            decodedCount += 1;
          }

          if (decodedCount > 0) {
            continue;
          }

          const textPayload = asset.buffer.toString("utf8");
          const embeddedUrls = extractFontUrlsFromText(textPayload, request.targetUrl);
          const embeddedWoff = extractEmbeddedWoffPayloads(asset.buffer);

          for (const embeddedUrl of embeddedUrls) {
            try {
              const fetched = await fetchBufferWithTimeout(embeddedUrl, 45000, {
                Accept: "*/*",
                Referer: request.targetUrl,
                "User-Agent": BROWSER_UA
              });
              const fetchedExt = detectFontExt(fetched, "application/octet-stream", embeddedUrl);
              if (!fetchedExt) {
                skipped.push({
                  index: skipped.length,
                  reason: "Lineto gate URL fetched but format unsupported.",
                  name: embeddedUrl
                });
                continue;
              }

              const fetchedHash = crypto.createHash("sha256").update(fetched).digest("hex");
              if (seenHashes.has(fetchedHash)) continue;
              seenHashes.add(fetchedHash);

              const fetchedBase = extractBaseNameFromUrl(embeddedUrl).replace(/\.[^.]+$/, "") || shortHash(fetched);
              const fetchedFileName = toSafeFileName(fetchedBase) + fetchedExt;
              const fetchedPath = ensureUniqueFilePath(outputDir, fetchedFileName);
              await writeFile(fetchedPath, fetched);

              const fetchedRelative = toRelative(fetchedPath);
              if (!seenPaths.has(fetchedRelative)) {
                seenPaths.add(fetchedRelative);
                downloaded.push({
                  fileName: path.basename(fetchedPath),
                  filePath: fetchedRelative,
                  sourceUrl: embeddedUrl,
                  name: composeDisplayNameFromFileName(path.basename(fetchedPath))
                });
              }

              if (fetchedExt === ".zip") {
                await extractZipFonts(fetchedPath, outputDir, embeddedUrl, downloaded, seenPaths);
              } else {
                await convertAndRegister(fetchedPath, embeddedUrl, downloaded, seenPaths);
              }
            } catch (error) {
              const reason = error instanceof Error ? error.message : "unknown error";
              skipped.push({
                index: skipped.length,
                reason: `Lineto gate URL fetch failed: ${reason}`,
                name: embeddedUrl
              });
            }
          }

          for (const embedded of embeddedWoff) {
            const embeddedHash = crypto.createHash("sha256").update(embedded.data).digest("hex");
            if (seenHashes.has(embeddedHash)) continue;
            seenHashes.add(embeddedHash);

            const fileName = toSafeFileName(`${extractBaseNameFromUrl(asset.url)}-embedded-${embedded.index}`) + embedded.ext;
            const filePath = ensureUniqueFilePath(outputDir, fileName);
            await writeFile(filePath, embedded.data);

            const relative = toRelative(filePath);
            if (!seenPaths.has(relative)) {
              seenPaths.add(relative);
              downloaded.push({
                fileName: path.basename(filePath),
                filePath: relative,
                sourceUrl: asset.url,
                name: composeDisplayNameFromFileName(path.basename(filePath))
              });
            }
            await convertAndRegister(filePath, asset.url, downloaded, seenPaths);
          }

          if (embeddedUrls.length === 0 && embeddedWoff.length === 0) {
            skipped.push({
              index: skipped.length,
              reason: "Lineto gate payload captured but no extractable font URLs/signatures found.",
              name: asset.url
            });
          }
          continue;
        }
      }

      if (!ext) {
        skipped.push({
          index: skipped.length,
          reason: "Captured stream is not recognized as font/zip payload.",
          name: asset.url
        });
        continue;
      }

      if (host.includes("205.tf") && is205UiChromeAsset(asset.url)) {
        skipped.push({
          index: skipped.length,
          reason: "Filtered 205TF UI chrome asset.",
          name: asset.url
        });
        continue;
      }

      const mapped205Base = host.includes("205.tf") ? resolve205MappedBaseName(asset.url, tf205StyleMap) : undefined;
      const mappedHanliStyle = host.includes("type.hanli.eu")
        ? resolveHanliMappedStyleName(asset.url, hanliStyleMap)
        : undefined;
      const is205HashedAsset = host.includes("205.tf") && is205CoreHashedAsset(asset.url);
      const has205StyleMap = tf205StyleMap.size > 0;
      if (is205HashedAsset && has205StyleMap && !mapped205Base) {
        skipped.push({
          index: skipped.length,
          reason: "Filtered 205TF hashed asset without matching target style-map entry.",
          name: asset.url
        });
        continue;
      }

      if (host.includes("type.hanli.eu") && hanliExpectedStyleTokens.size > 0) {
        const mappedToken = mappedHanliStyle ? normalizeCoverageToken(mappedHanliStyle) : "";
        if (!mappedToken) {
          skipped.push({
            index: skipped.length,
            reason: "Filtered Hanli hashed asset without matching Fontdue style-map entry.",
            name: asset.url
          });
          continue;
        }
        if (!hanliExpectedStyleTokens.has(mappedToken)) {
          skipped.push({
            index: skipped.length,
            reason: "Filtered Hanli style outside expected profile: " + mappedHanliStyle,
            name: asset.url
          });
          continue;
        }
      }

      const tokenMatched =
        assetMatchesTokens(asset.url, targetTokens) ||
        (mapped205Base ? assetMatchesTokens(mapped205Base, targetTokens) : false) ||
        (mappedHanliStyle ? assetMatchesTokens(mappedHanliStyle, targetTokens) : false);
      const bypassTokenFilter = is205HashedAsset && !has205StyleMap;
      if (
        shouldApplyTokenFilter(host) &&
        targetTokens.length > 0 &&
        !bypassTokenFilter &&
        !tokenMatched
      ) {
        skipped.push({ index: skipped.length, reason: "Filtered as likely contamination (target token mismatch).", name: asset.url });
        continue;
      }

      const hash = crypto.createHash("sha256").update(asset.buffer).digest("hex");
      if (seenHashes.has(hash)) {
        skipped.push({ index: skipped.length, reason: "Duplicate stream hash.", name: asset.url });
        continue;
      }
      seenHashes.add(hash);

      let base =
        mapped205Base ||
        mappedHanliStyle ||
        extractBaseNameFromUrl(asset.url).replace(/\.[^.]+$/, "") ||
        shortHash(asset.buffer);
      if (host.includes("pangrampangram.com")) {
        base = normalizePangramBaseName(base, targetSlug);
      } else if (host.includes("klim.co.nz")) {
        base = normalizeKlimBaseName(base);
      }
      const fileName = toSafeFileName(base) + ext;
      const filePath = ensureUniqueFilePath(outputDir, fileName);
      await writeFile(filePath, asset.buffer);

      const relative = toRelative(filePath);
      if (!seenPaths.has(relative)) {
        seenPaths.add(relative);
        downloaded.push({
          fileName: path.basename(filePath),
          filePath: relative,
          sourceUrl: asset.url,
          name: composeDisplayNameFromFileName(path.basename(filePath))
        });
      }

      if (ext === ".zip") {
        await extractZipFonts(filePath, outputDir, asset.url, downloaded, seenPaths);
        continue;
      }

      await convertAndRegister(filePath, asset.url, downloaded, seenPaths);
    }

    if (host.includes("pangrampangram.com")) {
      await runPangramCollectionSupplement({
        request,
        outputDir,
        downloaded,
        skipped,
        seenPaths,
        seenHashes,
        targetTokens,
        targetSlug,
        logProgress
      });
    }

    if (host.includes("cotypefoundry.com")) {
      const hasItalic = downloaded.some((item) => /italic|oblique/i.test(item.fileName));
      if (!hasItalic) {
        await logProgress("[CoType] No italic assets detected in intercept; trying __NEXT_DATA__ supplement...");
        await runCoTypeItalicSupplement(request, outputDir, downloaded, skipped, seenPaths, logProgress);
      }

      try {
        const report = buildCoTypeSelfAwarenessReport(downloaded);
        const reportPath = path.join(outputDir, "cotype-self-awareness.json");
        await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
      } catch {
        // best-effort diagnostics
      }
    }

    let pureSuccessLogPath: string | undefined;
    let pureSuccessAudit: Record<string, unknown> | undefined;
    try {
      await logProgress("[Pure Success] Running self-heal protocol...");
      const pureSuccess = await runPureSuccessProtocol({
        outputDir,
        downloaded,
        foundry: host,
        family: targetSlug
      });
      pureSuccessAudit = pureSuccess as unknown as Record<string, unknown>;
      const pureSuccessPath = path.join(outputDir, "pure-success-log.json");
      await writeFile(pureSuccessPath, JSON.stringify(pureSuccess, null, 2), "utf8");
      pureSuccessLogPath = toRelative(pureSuccessPath);
      await logProgress(
        `[Pure Success] status=${pureSuccess.status} missing_before=${pureSuccess.missingFormatsBefore.length} missing_after=${pureSuccess.missingFormatsAfter.length}`
      );
    } catch {
      // best-effort
    }

    let validationLogPath: string | undefined;
    let technicalQaLogPath: string | undefined;
    let technicalQaAudit: Record<string, unknown> | undefined;
    try {
      await logProgress("[Audit] Running validation...");
      const validation = await runValidationLog({ outputDir, tokens: targetTokens });
      validationLogPath = toRelative(validation.outputPath);

      if (host.includes("groteskly.xyz") && validationLogPath) {
        const removed = await pruneGrotesklyContamination({
          outputDir,
          validationLogPath: path.resolve(process.cwd(), validationLogPath),
          downloaded,
          seenPaths,
          skipped,
          logProgress
        });
        if (removed > 0) {
          const rerun = await runValidationLog({ outputDir, tokens: targetTokens });
          validationLogPath = toRelative(rerun.outputPath);
        }
      }
    } catch {
      // best-effort
    }

    try {
      await logProgress("[Audit] Running technical QA...");
      const technicalQa = await runTechnicalQa({ outputDir });
      technicalQaLogPath = toRelative(technicalQa.outputPath);
      technicalQaAudit = technicalQa.audit;
    } catch {
      // best-effort
    }

    let targetAudit: Record<string, unknown> | undefined;
    let analysisLogPath: string | undefined;
    let qualityLogPath: string | undefined;
    let qualityAudit: Record<string, unknown> | undefined;
    try {
      await logProgress("[Audit] Running target coverage + quality audit...");
      targetAudit = await buildTargetCoverageAudit({
        request,
        host,
        outputDir,
        validationLogPath,
        targetTokens,
        linetoSessionPostscriptNames: Array.from(linetoSessionPostscriptNames)
      });
      if (targetAudit) {
        const analysisPath = path.join(outputDir, "analysis-log.json");
        await writeFile(analysisPath, JSON.stringify(targetAudit, null, 2), "utf8");
        analysisLogPath = toRelative(analysisPath);

        qualityAudit = buildQualityAuditFromTargetCoverage(targetAudit);
        if (qualityAudit) {
          const qualityPath = path.join(outputDir, "quality-log.json");
          await writeFile(qualityPath, JSON.stringify(qualityAudit, null, 2), "utf8");
          qualityLogPath = toRelative(qualityPath);
        }
      }
    } catch {
      // best-effort
    }

    let specimenAudit: Record<string, unknown> | undefined;
    let specimenLogPath: string | undefined;
    if (shouldIncludeSpecimenPdf(request)) {
      try {
        await logProgress("[Audit] Running specimen PDF audit...");
        const expectedStyles = Array.isArray((targetAudit as any)?.expected?.styles)
          ? ((targetAudit as any).expected.styles as string[])
          : [];
        const observedStyles = Array.isArray((targetAudit as any)?.observed?.styles)
          ? ((targetAudit as any).observed.styles as string[])
          : [];
        specimenAudit = await collectSpecimenPdfAudit({
          request,
          outputDir,
          expectedStyles,
          observedStyles,
          options: {
            maxPageUrls: host.includes("lineto.com") ? 8 : 24,
            maxPdfCandidates: host.includes("lineto.com") ? 10 : 24,
            pageFetchTimeoutMs: host.includes("lineto.com") ? 20000 : 45000,
            pdfFetchTimeoutMs: host.includes("lineto.com") ? 20000 : 45000,
            maxTotalMs: host.includes("lineto.com") ? 90000 : 180000,
            onProgress: async (message) => {
              await logProgress(message);
            }
          }
        });
        if (specimenAudit) {
          const specimenPath = path.join(outputDir, "specimen-log.json");
          await writeFile(specimenPath, JSON.stringify(specimenAudit, null, 2), "utf8");
          specimenLogPath = toRelative(specimenPath);
        }
        await logProgress("[Audit] Specimen PDF audit finished.");
      } catch {
        // best-effort
      }
    }

    const result: DownloadResult = {
      command: "browser-intercept",
      source: host,
      outputDir: toRelative(outputDir),
      downloadedAt: new Date().toISOString(),
      downloaded,
      skipped,
      logPath: toRelative(path.join(outputDir, "browser-log.json")),
      validationLogPath,
      analysisLogPath,
      targetAudit,
      qualityLogPath,
      qualityAudit,
      specimenLogPath,
      specimenAudit,
      pureSuccessLogPath,
      pureSuccessAudit,
      technicalQaLogPath,
      technicalQaAudit
    };

    await writeFile(path.join(outputDir, "browser-log.json"), JSON.stringify(result, null, 2), "utf8");
    await writeFile(path.join(outputDir, "download-log.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  } catch (error) {
    if (error instanceof RotateProxyAttemptError) {
      const nextMetadata = {
        ...(requestMetadata as Record<string, unknown>),
        _proxyAttempt: error.nextAttempt
      };
      await logProgress(
        `[Proxy] rotating proxy due to blocked detection (next attempt ${error.nextAttempt + 1}/${maxProxyAttempts}).`
      );
      return runBrowserIntercept({
        ...request,
        metadata: nextMetadata
      });
    }

    const reason = error instanceof Error ? error.message : String(error);
    const browserMissing = /could not find chrome|failed to launch the browser process|browser was not found/i.test(
      reason
    );
    if (browserMissing) {
      throw new Error(
        `browser-intercept failed: ${reason}\nHint: install browser cache via "npx puppeteer browsers install chrome" or set SPECIMEN_BROWSER_PATH (or AKSARA_BROWSER_PATH) to a local Chrome/Edge/Brave executable.`
      );
    }
    throw new Error(`browser-intercept failed: ${reason}`);
  } finally {
    if (interceptor && page) {
      await interceptor.detach(page).catch(() => undefined);
    }
    if (page) {
      await page.close().catch(() => undefined);
    }
    if (sessionHandle) {
      await sessionHandle.release({ discard: shouldDiscardSession }).catch(() => undefined);
      sessionHandle = null;
      browser = null;
    } else if (browser) {
      await browser.close().catch(() => undefined);
      browser = null;
    }
  }
};

export default runBrowserIntercept;




