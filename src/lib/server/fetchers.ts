import { writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";

const ensureOk = async (response: Response, sourceUrl: string): Promise<void> => {
  if (response.ok) {
    return;
  }

  const body = await response.text();
  throw new Error(`Request gagal (${response.status}) ke ${sourceUrl}\n${body.slice(0, 280)}`);
};

export const fetchText = async (url: string, headers: HeadersInit = {}): Promise<string> => {
  const response = await fetch(url, { headers });
  await ensureOk(response, url);
  return response.text();
};

export const fetchJson = async <T>(url: string, headers: HeadersInit = {}): Promise<T> => {
  const response = await fetch(url, { headers });
  await ensureOk(response, url);
  return response.json() as Promise<T>;
};

export const downloadBinary = async (
  url: string,
  filePath: string,
  headers: HeadersInit = {},
  maxRetries = 3
): Promise<void> => {
  const TIMEOUT_MS = 60_000; // 60 detik per request
  const normalizeHeaders = (value: HeadersInit): Record<string, string> => {
    if (value instanceof Headers) {
      const out: Record<string, string> = {};
      value.forEach((v, k) => {
        out[k] = v;
      });
      return out;
    }
    if (Array.isArray(value)) {
      const out: Record<string, string> = {};
      for (const [k, v] of value) out[String(k)] = String(v);
      return out;
    }
    return { ...(value as Record<string, string>) };
  };

  const requestViaNodeHttp = async (): Promise<Buffer> => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;

    return new Promise<Buffer>((resolve, reject) => {
      const req = client.request(
        parsed,
        {
          method: "GET",
          headers: normalizeHeaders(headers),
          timeout: TIMEOUT_MS
        },
        (res) => {
          const status = Number(res.statusCode || 0);
          const redirectLocation = typeof res.headers.location === "string" ? res.headers.location : undefined;
          if (status >= 300 && status < 400 && redirectLocation) {
            res.resume();
            reject(new Error(`redirect:${redirectLocation}`));
            return;
          }
          if (status < 200 || status >= 300) {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              body += chunk;
              if (body.length > 280) body = body.slice(0, 280);
            });
            res.on("end", () => {
              reject(new Error(`Request gagal (${status}) ke ${url}\n${body}`));
            });
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        }
      );

      req.on("timeout", () => req.destroy(new Error("socket timeout")));
      req.on("error", reject);
      req.end();
    });
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch(url, {
        headers,
        signal: controller.signal
      });
      clearTimeout(timer);

      await ensureOk(response, url);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(filePath, buffer);
      return; // Sukses, keluar
    } catch (error: any) {
      // Fallback: some endpoints intermittently fail on fetch/undici transport.
      try {
        const nodeBuffer = await requestViaNodeHttp();
        await writeFile(filePath, nodeBuffer);
        return;
      } catch (fallbackError: any) {
        // Follow a single redirect in fallback path when provider gives 3xx location.
        const redirectMatch = /^redirect:(.+)$/i.exec(String(fallbackError?.message || ""));
        if (redirectMatch?.[1]) {
          try {
            const redirectedUrl = new URL(redirectMatch[1], url).href;
            const redirectedResponse = await fetch(redirectedUrl, { headers });
            await ensureOk(redirectedResponse, redirectedUrl);
            const redirectedBuffer = Buffer.from(await redirectedResponse.arrayBuffer());
            await writeFile(filePath, redirectedBuffer);
            return;
          } catch {
            // keep original retry flow below
          }
        }
      }

      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt) throw error;

      const backoffMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      const reason = error instanceof Error ? error.message : String(error);
      console.log(
        `[RETRY] Attempt ${attempt}/${maxRetries} failed for ${url.split('/').pop()} (${reason}), retrying in ${backoffMs}ms...`
      );
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
};

export const parseCssFontUrls = (cssText: string, baseCssUrl: string): string[] => {
  const regex = /url\(([^)]+)\)/gi;
  const urls = new Set<string>();
  let match = regex.exec(cssText);

  while (match) {
    const raw = match[1]?.trim().replace(/^['"]|['"]$/g, "");
    if (raw && !raw.startsWith("data:")) {
      try {
        urls.add(new URL(raw, baseCssUrl).href);
      } catch {
        // URL invalid, skip.
      }
    }
    match = regex.exec(cssText);
  }

  return [...urls.values()];
};

export const pickByPath = <T>(value: unknown, dotPath: string): T | undefined => {
  if (!dotPath || dotPath === ".") {
    return value as T;
  }

  const parts = dotPath.split(".");
  let current: unknown = value;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current as T;
};
