import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type SovereignJobStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

export interface SovereignJobRecord {
  jobId: string;
  status: SovereignJobStatus;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  result?: {
    zipPath?: string;
    zipFileName?: string;
    downloadedCount?: number;
    error?: string;
  };
  logs: string[];
}

const JOBS_DIR = path.join(process.cwd(), ".temp-staging", "jobs");

/**
 * Initializes the Sovereign Job Registry directory.
 */
async function ensureJobsDirectory(): Promise<void> {
  try {
    await fs.mkdir(JOBS_DIR, { recursive: true });
  } catch (error) {
    // Ignore if directory already exists
  }
}

/**
 * Generates a unique Job ID.
 */
function generateJobId(): string {
  return `job_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Returns the absolute path to the job's JSON registry file.
 */
function getJobFilePath(jobId: string): string {
  return path.join(JOBS_DIR, `${jobId}.json`);
}

const jobLocks = new Map<string, Promise<void>>();

async function runWithLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  let currentLock = jobLocks.get(jobId) || Promise.resolve();
  let nextLock = currentLock.then(() => fn().catch(() => {})).then(() => {});
  jobLocks.set(jobId, nextLock);
  return currentLock.then(() => fn());
}

/**
 * Creates a new background job in the registry.
 */
export async function createJob(metadata: Record<string, unknown> = {}): Promise<SovereignJobRecord> {
  await ensureJobsDirectory();

  const jobId = generateJobId();
  const now = new Date().toISOString();
  
  const record: SovereignJobRecord = {
    jobId,
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
    metadata,
    logs: ["[DAEMON] Job dispatched successfully."],
  };

  await runWithLock(jobId, async () => {
    await fs.writeFile(getJobFilePath(jobId), JSON.stringify(record, null, 2), "utf8");
  });
  return record;
}

/**
 * Retrieves a job from the registry.
 */
export async function getJob(jobId: string): Promise<SovereignJobRecord | null> {
  return runWithLock(jobId, async () => {
    try {
      const raw = await fs.readFile(getJobFilePath(jobId), "utf8");
      return JSON.parse(raw) as SovereignJobRecord;
    } catch (error) {
      return null;
    }
  });
}

/**
 * Updates the status of an existing job.
 */
export async function updateJobStatus(
  jobId: string, 
  status: SovereignJobStatus, 
  resultData?: SovereignJobRecord["result"]
): Promise<void> {
  await runWithLock(jobId, async () => {
    try {
      const raw = await fs.readFile(getJobFilePath(jobId), "utf8");
      const job = JSON.parse(raw) as SovereignJobRecord;
      
      job.status = status;
      job.updatedAt = new Date().toISOString();
      if (resultData) {
        job.result = { ...job.result, ...resultData };
      }
      
      await fs.writeFile(getJobFilePath(jobId), JSON.stringify(job, null, 2), "utf8");
    } catch (e) {
      // Ignore
    }
  });
}

/**
 * Appends a log line to the job's telemetry record.
 */
export async function appendJobLog(jobId: string, message: string): Promise<void> {
  await runWithLock(jobId, async () => {
    try {
      const raw = await fs.readFile(getJobFilePath(jobId), "utf8");
      const job = JSON.parse(raw) as SovereignJobRecord;
      
      const timestamp = new Date().toISOString();
      job.logs.push(`[${timestamp}] ${message}`);
      job.updatedAt = timestamp;
      
      await fs.writeFile(getJobFilePath(jobId), JSON.stringify(job, null, 2), "utf8");
    } catch (e) {
      // Ignore
    }
  });
}
