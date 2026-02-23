import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { promises as fs } from "node:fs";

type ValidationRunOptions = {
  outputDir: string; // absolute path
  tokens?: string[];
  outputFileName?: string; // default: validation-log.json
};

export type ValidationRunResult = {
  ok: boolean;
  outputPath: string; // absolute path
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

const sanitizeTokens = (tokens: string[]): string[] => {
  const out = new Set<string>();
  for (const raw of tokens) {
    if (typeof raw !== "string") continue;
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
    // Avoid substring false positives ("rom" in "from") and huge URL-derived garbage.
    if (cleaned.length < 4 || cleaned.length > 40) continue;
    if (cleaned.startsWith("http") || cleaned.includes("www")) continue;
    out.add(cleaned);
  }
  return Array.from(out);
};

export const runValidationLog = async (options: ValidationRunOptions): Promise<ValidationRunResult> => {
  const outputPath = path.join(options.outputDir, options.outputFileName || "validation-log.json");
  const scriptPath = path.join(process.cwd(), "tools", "validate-fonts.py");

  const tokenList = Array.isArray(options.tokens) ? sanitizeTokens(options.tokens) : [];
  const args = [scriptPath, options.outputDir, "--output", outputPath];
  if (tokenList.length > 0) {
    args.push("--tokens", tokenList.join(","));
  }

  const pythonCmd = resolvePythonPath();

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(pythonCmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", (err) => reject(err));
      proc.on("close", (code) => {
        if (code === 0) return resolve();
        reject(new Error(stderr.trim() || `validator exit=${code}`));
      });
    });

    return { ok: true, outputPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    const fallback = {
      summary: {
        status: "fail",
        error: message
      }
    };
    try {
      await fs.writeFile(outputPath, JSON.stringify(fallback, null, 2), "utf8");
    } catch {
      // best-effort
    }
    return { ok: false, outputPath, error: message };
  }
};

