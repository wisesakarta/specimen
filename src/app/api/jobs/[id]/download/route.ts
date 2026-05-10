import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/server/job-registry";
import { createReadStream, promises as fs } from "node:fs";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const jobId = resolvedParams.id;
    if (!jobId) {
      return new NextResponse("Missing Job ID", { status: 400 });
    }

    const job = await getJob(jobId);

    if (!job) {
      return new NextResponse("Job not found", { status: 404 });
    }

    if (job.status !== "SUCCESS") {
      return new NextResponse("Job is not ready or failed", { status: 400 });
    }

    const zipPath = job.result?.zipPath;
    const zipFileName = job.result?.zipFileName || `${jobId}.zip`;

    if (!zipPath) {
      return new NextResponse("Zip path not found in job result", { status: 500 });
    }

    // Verify file exists
    try {
      await fs.access(zipPath);
    } catch {
      return new NextResponse("Artifact file has been deleted or moved", { status: 410 });
    }

    const stat = await fs.stat(zipPath);

    // Using Node.js streams to stream the file efficiently
    const readStream = createReadStream(zipPath);
    const webStream = new ReadableStream({
      start(controller) {
        readStream.on("data", (chunk) => controller.enqueue(chunk));
        readStream.on("end", () => controller.close());
        readStream.on("error", (err) => controller.error(err));
      },
      cancel() {
        readStream.destroy();
      },
    });

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipFileName}"`,
        "Content-Length": stat.size.toString(),
      },
    });

  } catch (error: any) {
    console.error("[Job Download API] Error:", error);
    return new NextResponse("Failed to download artifact", { status: 500 });
  }
}
