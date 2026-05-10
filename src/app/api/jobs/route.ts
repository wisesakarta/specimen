import { NextRequest, NextResponse } from "next/server";
import type { DownloadRequest } from "@/lib/downloader-protocol";
import { runDownload } from "@/lib/server/font-downloader";
import { ZipService } from "@/lib/server/services/zip-service";
import { createJob, updateJobStatus, appendJobLog } from "@/lib/server/job-registry";

export const runtime = "nodejs";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validatePayload = (value: unknown): DownloadRequest => {
  if (!isRecord(value)) throw new Error("Request body must be a JSON object.");

  const mode = value.mode;
  if (
    mode !== "css-url" &&
    mode !== "api-json" &&
    mode !== "direct-url" &&
    mode !== "browser-intercept" &&
    mode !== "batch-direct"
  ) {
    throw new Error("Invalid `mode` field.");
  }

  if (mode === "browser-intercept" && (typeof value.targetUrl !== "string" || !value.targetUrl.trim())) {
    throw new Error("`browser-intercept` mode requires `targetUrl`.");
  }

  if (mode === "batch-direct" && (!Array.isArray(value.fonts) || value.fonts.length === 0)) {
    throw new Error("`batch-direct` mode requires a non-empty `fonts` array.");
  }

  return value as DownloadRequest;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const payload = validatePayload(body);

    // 1. Create a Sovereign Job in the Daemon Registry
    const job = await createJob({
      mode: payload.mode,
      targetUrl: (payload as any).targetUrl || (payload as any).fileUrl || (payload as any).cssUrl || "Unknown",
    });

    // 2. Attach Progress Listener
    (payload as any).onProgress = (event: any) => {
      const message =
        typeof event === "string"
          ? event
          : event.message
          ? event.message
          : JSON.stringify(event);
      // Append without awaiting to not block execution
      appendJobLog(job.jobId, message).catch(() => {});
    };

    // 3. Detached Execution (Run in background)
    Promise.resolve().then(async () => {
      try {
        await updateJobStatus(job.jobId, "RUNNING");
        await appendJobLog(job.jobId, `[Daemon] Commencing ${payload.mode} protocol...`);

        // Execute core logic
        const result = await runDownload(payload);

        await appendJobLog(
          job.jobId,
          `[Daemon] Download complete. Downloaded: ${result.downloaded.length}, Skipped: ${result.skipped.length}. Generating archive...`
        );

        // Package into ZIP
        const zipBuffer = await ZipService.createZip(result.outputDir);
        const zipFileName = `${result.outputDir.split(/[\/\\]/).pop() || job.jobId}.zip`;
        const zipPath = `${result.outputDir}.zip`;

        // Actually save the zip buffer to disk so the materialization API can read it
        // Note: ZipService returns the buffer, but we need it on disk.
        // Wait, ZipService.createZip usually creates an in-memory buffer, but we should write it.
        const { promises: fs } = require("fs");
        await fs.writeFile(zipPath, zipBuffer);

        await updateJobStatus(job.jobId, "SUCCESS", {
          zipPath,
          zipFileName,
          downloadedCount: result.downloaded.length,
        });

        await appendJobLog(job.jobId, `[Daemon] Operation SUCCESS. Archive ready.`);
      } catch (error: any) {
        console.error(`[Daemon Error - ${job.jobId}]`, error);
        await appendJobLog(job.jobId, `[ERROR] ${error.message}`);
        await updateJobStatus(job.jobId, "FAILED", { error: error.message });
      }
    });

    // 4. Return immediately to the OS Client
    return NextResponse.json({ jobId: job.jobId, status: "PENDING" }, { status: 202 });
  } catch (error: any) {
    console.error("[Job Dispatch API] Validation Error:", error);
    return NextResponse.json({ error: error.message || "Invalid Request" }, { status: 400 });
  }
}
