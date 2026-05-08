import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { promises as fs } from "node:fs";

type TechnicalQaRunOptions = {
  outputDir: string;
  outputFileName?: string;
  requiredFormats?: string[];
  sourceLimitedFormats?: string[];
  skipFontbakery?: boolean;
  fontbakeryTimeoutSec?: number;
};

export type TechnicalQaRunResult = {
  ok: boolean;
  outputPath: string;
  audit?: Record<string, unknown>;
  error?: string;
};

let cachedPythonPath: string | null = null;

const resolvePythonPath = (): string => {
  if (cachedPythonPath) return cachedPythonPath;
  try {
    const cmd = process.platform === "win32" ? "where python" : "which python3";
    cachedPythonPath = execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0].trim();
  } catch {
    cachedPythonPath = process.platform === "win32" ? "python" : "python3";
  }
  return cachedPythonPath;
};

const parseAudit = async (outputPath: string): Promise<Record<string, unknown> | undefined> => {
  try {
    const text = await fs.readFile(outputPath, "utf8");
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // best-effort only
  }
  return undefined;
};

export const runTechnicalQa = async (options: TechnicalQaRunOptions): Promise<TechnicalQaRunResult> => {
  const outputPath = path.join(options.outputDir, options.outputFileName || "technical-qa-log.json");
  const scriptPath = path.join(process.cwd(), "tools", "technical-qa.py");
  const requiredFormats = Array.isArray(options.requiredFormats)
    ? options.requiredFormats.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const sourceLimitedFormats = Array.isArray(options.sourceLimitedFormats)
    ? options.sourceLimitedFormats.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
    : [];

  const args = [scriptPath, options.outputDir, "--output", outputPath];
  if (requiredFormats.length > 0) {
    args.push("--required-formats", requiredFormats.join(","));
  }
  if (sourceLimitedFormats.length > 0) {
    args.push("--source-limited-formats", sourceLimitedFormats.join(","));
  }
  if (options.skipFontbakery === true) {
    args.push("--skip-fontbakery");
  }
  if (Number.isFinite(options.fontbakeryTimeoutSec) && Number(options.fontbakeryTimeoutSec) > 0) {
    args.push("--fontbakery-timeout", String(Math.max(30, Math.floor(Number(options.fontbakeryTimeoutSec)))));
  }

  const pythonCmd = resolvePythonPath();

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(pythonCmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("error", (error) => reject(error));
      proc.on("close", (code) => {
        if (code === 0) return resolve();
        reject(new Error(stderr.trim() || `technical-qa exit=${code}`));
      });
    });

    const audit = await parseAudit(outputPath);
    return { ok: true, outputPath, audit };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    const fallback = {
      generatedAt: new Date().toISOString(),
      status: "warn",
      summary: {
        warning_reasons: [`technical_qa_failed:${message}`]
      }
    };
    try {
      await fs.writeFile(outputPath, JSON.stringify(fallback, null, 2), "utf8");
    } catch {
      // best-effort
    }
    const audit = await parseAudit(outputPath);
    return { ok: false, outputPath, audit, error: message };
  }
};
