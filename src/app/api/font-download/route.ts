import { NextResponse } from "next/server";

import type { DownloadRequest } from "@/lib/types";
import { runDownload } from "@/lib/server/font-downloader";
import { listOpenLicenses } from "@/lib/server/license-policy";
import { ZipService } from "@/lib/server/services/zip-service";
import path from "node:path";

export const runtime = "nodejs";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const pickString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
};

const toSafeFileToken = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) return undefined;
  // Prevent absurd filenames in Content-Disposition / client download prompts.
  return normalized.length > 80 ? normalized.slice(0, 80) : normalized;
};

const inferFoundryFromUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const host = new URL(url).host.toLowerCase();
    if (host.includes("cotypefoundry.com")) return "cotype";
    if (host === "205.tf" || host.endsWith(".205.tf")) return "205tf";
    if (host.includes("superiortype.com")) return "superior-type";
    if (host.includes("pangrampangram.com")) return "pangram";
    if (host.includes("klim.co.nz")) return "klim";
    if (host.includes("lineto.com")) return "lineto";
    if (host.includes("abcdinamo.com")) return "abcdinamo";
    if (host.includes("ohnotype.co")) return "ohno";
    if (host.includes("wtypefoundry.com")) return "w-type";
    if (host.includes("swisstypefaces.com")) return "swisstypefaces";
    if (host.includes("brandingwithtype.com")) return "branding-with-type";

    const trimmed = host.replace(/^www\./, "");
    const parts = trimmed.split(".").filter(Boolean);
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join("-");
  } catch {
    return undefined;
  }
};

const inferFamilyFromUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return undefined;
    // Prefer <prefix>/<slug> patterns used by foundries.
    if ((segments[0] === "font-family" || segments[0] === "our-fonts") && segments[1]) return segments[1];
    if ((segments[0] === "collection" || segments[0] === "typefaces" || segments[0] === "typeface") && segments[1]) return segments[1];
    return segments[segments.length - 1];
  } catch {
    return undefined;
  }
};

const buildZipBaseName = (payload: DownloadRequest, resultOutputDir: string): string => {
  const meta = isRecord(payload.metadata) ? payload.metadata : {};
  const nested = isRecord(meta.metadata) ? meta.metadata : {};
  const payloadFirstFontMeta =
    payload.mode === "batch-direct" && Array.isArray(payload.fonts) && isRecord((payload.fonts[0] as any)?.metadata)
      ? ((payload.fonts[0] as any).metadata as Record<string, unknown>)
      : undefined;
  const metaFirstFontMeta =
    Array.isArray((meta as any).fonts) && isRecord((meta as any).fonts[0]?.metadata)
      ? ((meta as any).fonts[0].metadata as Record<string, unknown>)
      : undefined;
  const targetProfile =
    (isRecord(meta.targetProfile) ? meta.targetProfile : undefined) ||
    (isRecord(nested.targetProfile) ? nested.targetProfile : undefined) ||
    (isRecord(metaFirstFontMeta?.targetProfile) ? metaFirstFontMeta?.targetProfile : undefined) ||
    (isRecord(payloadFirstFontMeta?.targetProfile) ? payloadFirstFontMeta?.targetProfile : undefined);

  const derivedFromFonts = (() => {
    const fonts = Array.isArray((meta as any).fonts) ? (meta as any).fonts : [];
    for (const font of fonts) {
      if (!font || typeof font !== "object") continue;
      const fontMeta = isRecord((font as any).metadata) ? (font as any).metadata : {};
      const foundry = pickString((font as any).foundry, fontMeta.foundry);
      const family = pickString((font as any).family, fontMeta.family);
      const category = pickString(fontMeta.category);
      if (foundry || family) return { foundry, family, category };
    }
    return {};
  })();

  const foundry = pickString(meta.foundry, nested.foundry, derivedFromFonts.foundry, payload.mode === "batch-direct" ? (payload.fonts?.[0] as any)?.foundry : undefined);
  const family = pickString(meta.family, nested.family, derivedFromFonts.family, payload.mode === "batch-direct" ? (payload.fonts?.[0] as any)?.family : undefined);
  const category = pickString(meta.category, nested.category, derivedFromFonts.category);

  const urlHint =
    payload.mode === "browser-intercept"
      ? payload.targetUrl
      : payload.mode === "direct-url"
        ? payload.fileUrl
        : payload.mode === "css-url"
          ? payload.cssUrl
          : payload.mode === "api-json"
            ? payload.apiUrl
            : payload.mode === "batch-direct"
              ? pickString(
                  (meta as any).targetUrl,
                  (nested as any).targetUrl,
                  (meta as any).pageUrl,
                  (nested as any).pageUrl,
                  Array.isArray((meta as any).fonts) && isRecord((meta as any).fonts[0]?.metadata)
                    ? pickString(
                        ((meta as any).fonts[0].metadata as any).pageUrl,
                        ((meta as any).fonts[0].metadata as any).targetUrl,
                        ((meta as any).fonts[0].metadata as any).originalUrl
                      )
                    : undefined,
                  typeof payload.source === "string" && /^https?:\/\//i.test(payload.source) ? payload.source : undefined
                )
              : undefined;

  const foundryToken = toSafeFileToken(pickString(foundry, inferFoundryFromUrl(urlHint)));
  const targetSlug = pickString(
    isRecord(targetProfile) ? targetProfile.targetSlug : undefined,
    isRecord(targetProfile) ? targetProfile.collectionSlug : undefined,
    inferFamilyFromUrl(urlHint)
  );
  const collectionFamilyCount = Number(isRecord(targetProfile) ? targetProfile.collectionFamilyCount || 0 : 0);
  const linkedFamilies = isRecord(targetProfile) && Array.isArray(targetProfile.collectionFamilies)
    ? targetProfile.collectionFamilies.length
    : 0;
  const shouldPreferTargetSlug =
    Boolean(targetSlug) &&
    (collectionFamilyCount > 1 || linkedFamilies > 1 || /(?:^|-)family(?:-|$)|(?:^|-)collection(?:-|$)/i.test(targetSlug || ""));

  const familyToken = toSafeFileToken(
    shouldPreferTargetSlug
      ? pickString(targetSlug, family, inferFamilyFromUrl(urlHint))
      : pickString(family, targetSlug, inferFamilyFromUrl(urlHint))
  );
  const categoryToken = toSafeFileToken(category);

  if (foundryToken && familyToken) {
    if (categoryToken && categoryToken !== familyToken) return `${foundryToken}-${familyToken}-${categoryToken}`;
    return `${foundryToken}-${familyToken}`;
  }
  if (foundryToken) return `${foundryToken}-fonts`;

  const outputBase = path.basename(resultOutputDir || "").trim();
  const safeOutputBase = toSafeFileToken(outputBase);
  return safeOutputBase || "fonts";
};

const validatePayload = (value: unknown): DownloadRequest => {
  if (!isRecord(value)) {
    throw new Error("Body request harus berupa object JSON.");
  }

  const mode = value.mode;
  if (mode !== "css-url" && mode !== "api-json" && mode !== "direct-url" && mode !== "browser-intercept" && mode !== "batch-direct") {
    throw new Error("Field `mode` invalid.");
  }

  if (mode === "css-url") {
    if (typeof value.cssUrl !== "string" || !value.cssUrl.trim()) {
      throw new Error("Mode `css-url` membutuhkan `cssUrl`.");
    }
  }

  if (mode === "api-json") {
    if (typeof value.apiUrl !== "string" || !value.apiUrl.trim()) {
      throw new Error("Mode `api-json` membutuhkan `apiUrl`.");
    }
  }

  if (mode === "direct-url") {
    if (typeof value.fileUrl !== "string" || !value.fileUrl.trim()) {
      throw new Error("Mode `direct-url` membutuhkan `fileUrl`.");
    }
  }

  if (mode === "batch-direct") {
    if (!Array.isArray(value.fonts) || value.fonts.length === 0) {
      throw new Error("Mode `batch-direct` membutuhkan array `fonts` yang tidak kosong.");
    }
  }

  if (mode === "browser-intercept") {
    if (typeof value.targetUrl !== "string" || !value.targetUrl.trim()) {
      throw new Error("Mode `browser-intercept` membutuhkan `targetUrl`.");
    }
    // expectedCount should only come from explicit hints, never placeholder font arrays.
    if (typeof value.expectedCount !== "number" && value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)) {
      if (typeof (value.metadata as any).expectedCount === "number") {
        (value as any).expectedCount = (value.metadata as any).expectedCount;
      }
    }
  }

  return value as DownloadRequest;
};


const encoder = new TextEncoder();

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    console.log("[API] Received download request:", JSON.stringify(body, null, 2));
    
    // Validate and enrich payload
    const payload = validatePayload(body);

    
    // [PROGRESSIVE-STREAMING] Handle browser-intercept via ReadableStream
    if (payload.mode === 'browser-intercept') {
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    (payload as any).onProgress = (event: any) => {
                        const data = JSON.stringify(event) + '\n';
                        controller.enqueue(encoder.encode(data));
                    };

                    const result = await runDownload(payload);
                    
                    // After browser-intercept completes, we ZIP and signal the client
                    const zipBuffer = await ZipService.createZip(result.outputDir);
                    const base64Zip = zipBuffer.toString('base64');
                    const zipFileBase = buildZipBaseName(payload, result.outputDir);
                    
                    controller.enqueue(encoder.encode(JSON.stringify({ 
                      type: 'result', 
                      result,
                      zipBase64: base64Zip,
                      zipFile: `${zipFileBase}.zip`
                    }) + '\n'));
                    
                    controller.close();
                    
                    // Delayed cleanup
                    setTimeout(() => ZipService.autoCleanup(result.outputDir), 5000);
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Stream Error";
                    console.error("[API] Stream failed:", message);
                    controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: message }) + '\n'));
                    controller.close();
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'application/x-ndjson',
                'Cache-Control': 'no-cache',
            }
        });
    }

    // [ZIP-AND-SHIP] Standard mode for Scrapers (ABC Dinamo, etc.)
    const result = await runDownload(payload);
    console.log("[API] Download complete, generating distribution ZIP...");

    const zipBuffer = await ZipService.createZip(result.outputDir);
    const zipFileBase = buildZipBaseName(payload, result.outputDir);
    const fileName = `${zipFileBase}.zip`;

    // Trigger auto-cleanup in background
    setTimeout(() => ZipService.autoCleanup(result.outputDir), 10000);

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Download-Result": JSON.stringify({ 
          ok: true, 
          downloadedCount: result.downloaded.length,
          family: zipFileBase
        })
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[API] Download failed:", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400 }
    );
  }
}
