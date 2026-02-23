import { Page, CDPSession } from "puppeteer";
import { EventEmitter } from "events";

type PendingRequest = {
  url: string;
  headers: Record<string, unknown>;
};

export class InterceptionService extends EventEmitter {
  private client: CDPSession | null = null;
  private patterns: RegExp[] = [];
  private pendingByRequestId = new Map<string, PendingRequest>();
  private emittedRequestIds = new Set<string>();
  private emittedResponseKeys = new Set<string>();
  private pageResponseHandler: ((response: any) => Promise<void>) | null = null;

  constructor(patterns: RegExp[] = [/\.(woff2|woff|ttf|otf)/i, /font-cuts/i, /\.zip/i]) {
    super();
    this.patterns = [...patterns, /_next\/static\/media/i, /_next\/data/i];
  }

  private isTarget(url: string, resourceType?: string, headers?: Record<string, unknown>): boolean {
    return this.isFont(url, resourceType) || this.isMetadata(url, resourceType, headers);
  }

  private isFont(url: string, resourceType?: string): boolean {
    return this.patterns.some((p) => p.test(url)) || (resourceType || "").toLowerCase() === "font" || url.toLowerCase().endsWith(".zip");
  }

  private isMetadata(url: string, resourceType?: string, headers?: Record<string, unknown>): boolean {
    const lowerType = (resourceType || "").toLowerCase();
    const isNextData = url.includes("_next/data") || url.includes("typeface.json") || url.includes("_next/static/chunks");
    const isNextRSC = lowerType === "document" || lowerType === "fetch" || lowerType === "xhr" || url.includes("collection") || url.includes("pinokio");
    const hasRSCHeader = !!(headers && String(headers["content-type"] || "").includes("x-component"));
    return !!(isNextData || isNextRSC || hasRSCHeader);
  }

  private emitCapturedAsset(
    buffer: Buffer,
    url: string,
    headers: Record<string, unknown>,
    requestId?: string
  ): void {
    if (buffer.length === 0) return;
    if (requestId && this.emittedRequestIds.has(requestId)) return;

    const key = `${url}|${buffer.length}`;
    if (this.emittedResponseKeys.has(key)) {
      if (requestId) this.emittedRequestIds.add(requestId);
      return;
    }

    this.emittedResponseKeys.add(key);
    if (requestId) this.emittedRequestIds.add(requestId);

    const isMetadata = this.isMetadata(url, undefined, headers) || buffer.toString().includes("self.__next_f.push");
    const eventName = isMetadata ? "metadata-captured" : "font-captured";

    console.log(`[${new Date().toLocaleTimeString()}] <- Intercept Emitting ${eventName}: ${url.slice(-40)} (${buffer.length} bytes)`);

    this.emit(eventName, {
      buffer,
      url,
      headers,
      timestamp: Date.now()
    });
  }

  private async tryEmitFromRequestId(requestId: string, url: string, headers: Record<string, unknown>): Promise<void> {
    if (!this.client) return;
    if (this.emittedRequestIds.has(requestId)) return;

    try {
      const { body, base64Encoded } = await this.client.send("Network.getResponseBody", { requestId });
      if (!body) return;

      const buffer = Buffer.from(body, base64Encoded ? "base64" : "utf8");
      this.emitCapturedAsset(buffer, url, headers, requestId);
    } catch (e: any) {
      // Ignore errors related to sessions or frames being closed/detached during body retrieval
      if (e.message?.includes("closed") || e.message?.includes("detached") || e.message?.includes("No resource")) {
        return;
      }
      // console.warn(`[CDP] Failed to get body for ${url.slice(-30)}: ${e.message}`);
    }
  }

  /**
   * @param page Puppeteer Page object
   * @description Attaches to Chrome DevTools Protocol for low-level network interception.
   */
  async attach(page: Page): Promise<void> {
    console.log(`[${new Date().toLocaleTimeString()}] -> Intercept Attaching CDP session...`);

    try {
      // Reduce cache/service-worker interference so response bodies remain retrievable.
      await page.setCacheEnabled(false);
      await page.setBypassServiceWorker(true);

      this.client = await page.target().createCDPSession();
      await this.client.send("Network.enable");
      await this.client.send("Network.setCacheDisabled", { cacheDisabled: true });
      await this.client.send("Network.setBypassServiceWorker", { bypass: true });

      this.client.on("Network.responseReceived", async (params: any) => {
        const url = String(params.response?.url || "");
        const requestId = String(params.requestId || "");
        if (!requestId || !url) return;
        const respHeaders = (params.response?.headers || {}) as Record<string, unknown>;
        if (!this.isTarget(url, params.type, respHeaders)) return;

        console.log(`[${new Date().toLocaleTimeString()}] <- Intercept Detected target stream: ${url.slice(-40)}`);

        const headers = (params.response?.headers || {}) as Record<string, unknown>;
        this.pendingByRequestId.set(requestId, { url, headers });
        await this.tryEmitFromRequestId(requestId, url, headers);
      });

      // Fallback path: many responses are only readable after loading finishes.
      this.client.on("Network.loadingFinished", async (params: any) => {
        const requestId = String(params.requestId || "");
        if (!requestId) return;

        const pending = this.pendingByRequestId.get(requestId);
        if (!pending) return;

        await this.tryEmitFromRequestId(requestId, pending.url, pending.headers);
        this.pendingByRequestId.delete(requestId);
      });

      this.client.on("Network.loadingFailed", (params: any) => {
        const requestId = String(params.requestId || "");
        if (!requestId) return;
        this.pendingByRequestId.delete(requestId);
      });

      // Puppeteer response fallback handles sites where CDP body retrieval is flaky.
      this.pageResponseHandler = async (response) => {
        const url = response.url();
        const resourceType = response.request().resourceType();
        if (!this.isTarget(url, resourceType, response.headers() as Record<string, unknown>)) return;
        try {
          // Check if response is still valid and frame is not detached
          const request = response.request();
          const frame = request.frame();
          if (frame && frame.isDetached()) return;

          const buffer = await response.buffer();
          this.emitCapturedAsset(buffer, url, response.headers() as Record<string, unknown>);
        } catch (e: any) {
          // Silently ignore navigation failures; CDP path or subsequent retries often succeed.
          if (e.message?.includes("detached") || e.message?.includes("closed") || e.message?.includes("No resource")) {
            return;
          }
        }
      };
      page.on("response", this.pageResponseHandler);

      console.log(`[${new Date().toLocaleTimeString()}] OK Intercept Active Protocol: responseReceived + loadingFinished`);
    } catch (e) {
      console.error("[FATAL] CDP Attachment Failed:", e);
    }
  }

  async detach(page?: Page): Promise<void> {
    if (page && this.pageResponseHandler) {
      try {
        page.off("response", this.pageResponseHandler);
      } catch {
        // best-effort
      }
      this.pageResponseHandler = null;
    }

    if (this.client) {
      try {
        this.client.removeAllListeners();
      } catch {
        // best-effort
      }

      try {
        await this.client.detach();
      } catch {
        // best-effort
      }
      this.client = null;
    }

    this.pendingByRequestId.clear();
    this.emittedRequestIds.clear();
    this.emittedResponseKeys.clear();
  }
}
