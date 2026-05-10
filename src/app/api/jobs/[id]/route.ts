import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/server/job-registry";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const jobId = resolvedParams.id;
    if (!jobId) {
      return NextResponse.json({ error: "Missing Job ID" }, { status: 400 });
    }

    const job = await getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found or expired" }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error: any) {
    console.error("[Job Registry API] Error fetching job:", error);
    return NextResponse.json({ error: "Failed to retrieve job status" }, { status: 500 });
  }
}
