import type { BatchDirectRequest, DownloadResult } from "@/lib/downloader-protocol";

const fetchLikeFailurePattern =
  /failed to fetch|fetch failed|request gagal|inline asset token missing|socket timeout|timed out|econnreset|enotfound|abort/i;
const blockedResponsePattern = /request gagal \((401|403|407|429|444|500|502|503|504)\)/i;
const htmlLikeSkipPattern = /<!doctype html|<html[\s>]|access denied|forbidden|cloudflare|captcha/i;

const hostRequiresAggressiveEscalation = (host: string): boolean =>
  host.includes("typefaces.pizza");

const getHostFromUrl = (value: string): string => {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return "";
  }
};

const getSkipReasons = (result: DownloadResult): string[] =>
  (Array.isArray(result.skipped) ? result.skipped : []).map((item) => String(item.reason || ""));

const hasSkipPattern = (result: DownloadResult, pattern: RegExp): boolean =>
  getSkipReasons(result).some((reason) => pattern.test(reason));

const countDownloadedFontLikeFiles = (result: DownloadResult): number =>
  (Array.isArray(result.downloaded) ? result.downloaded : []).filter((item) =>
    /\.(woff2?|ttf|otf|zip)$/i.test(String(item.fileName || ""))
  ).length;

const extractStyleCoveragePercent = (result: DownloadResult): number | undefined => {
  const qualityAudit = (result as any).qualityAudit;
  if (!qualityAudit || typeof qualityAudit !== "object") return undefined;

  const summaryCoverage = Number((qualityAudit as any)?.summary?.styleCoveragePercent);
  if (Number.isFinite(summaryCoverage)) return summaryCoverage;

  const directCoverage = Number((qualityAudit as any)?.coverage?.styleCoveragePercent);
  if (Number.isFinite(directCoverage)) return directCoverage;

  return undefined;
};

const countInlineAssets = (fonts: BatchDirectRequest["fonts"]): number =>
  fonts.filter((font) => /^inline-font:\/\/[a-z0-9]+$/i.test(String(font.url || "").trim())).length;

export const shouldFallbackToBrowserIntercept = (params: {
  targetUrl: string;
  directFonts: BatchDirectRequest["fonts"];
  batchResult: DownloadResult;
}): boolean => {
  const host = getHostFromUrl(params.targetUrl);
  const hasFetchFailure = hasSkipPattern(params.batchResult, fetchLikeFailurePattern);
  const hasBlockedFailure = hasSkipPattern(params.batchResult, blockedResponsePattern);
  const hasHtmlLikeSkip = hasSkipPattern(params.batchResult, htmlLikeSkipPattern);
  const downloadedFontLike = countDownloadedFontLikeFiles(params.batchResult);
  const styleCoveragePercent = extractStyleCoveragePercent(params.batchResult);
  const directCount = Math.max(1, params.directFonts.length);
  const inlineAssetCount = countInlineAssets(params.directFonts);

  const hasFailureSignal = hasFetchFailure || hasBlockedFailure || hasHtmlLikeSkip;
  if (!hasFailureSignal) return false;

  if (downloadedFontLike === 0) return true;

  if (inlineAssetCount > 0) {
    const minExpectedInline = Math.max(1, Math.min(inlineAssetCount, 2));
    if (downloadedFontLike < minExpectedInline) return true;
  }

  const downloadRatio = downloadedFontLike / directCount;
  if ((hasBlockedFailure || hasHtmlLikeSkip) && downloadRatio < 0.6) return true;

  if (typeof styleCoveragePercent === "number" && styleCoveragePercent < 90 && hasFailureSignal) return true;

  if (hostRequiresAggressiveEscalation(host)) return true;

  return false;
};

export const shouldFallbackAfterBatchDirectError = (params: {
  targetUrl: string;
  directFonts: BatchDirectRequest["fonts"];
  errorReason: string;
}): boolean => {
  const host = getHostFromUrl(params.targetUrl);
  if (hostRequiresAggressiveEscalation(host)) return true;

  const hasInlineAsset = countInlineAssets(params.directFonts) > 0;
  if (hasInlineAsset) return true;

  return fetchLikeFailurePattern.test(params.errorReason) || blockedResponsePattern.test(params.errorReason);
};
