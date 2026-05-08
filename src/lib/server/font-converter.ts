import { promises as fs } from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';

const FONT_CONVERT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.FONT_CONVERT_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 10000) return raw;
  return 120000;
})();

const inspectVariableInstanceCount = async (inputPath: string): Promise<number> => {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const fontkit = require('fontkit');
    const font = fontkit.openSync(inputPath);
    const count = Number(font?.fvar?.instanceCount || 0);
    try {
      font?.close?.();
    } catch {
      // ignore best-effort close failures
    }
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
};

function resolveExpectedInstanceCount(options?: ConvertOptions): number {
  const raw = Number(options?.expectedInstanceCount);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(0, Math.floor(raw));
}

const resolveConvertTimeoutMs = async (inputPath: string, options?: ConvertOptions): Promise<number> => {
  const base = FONT_CONVERT_TIMEOUT_MS;
  if (options?.disableInstanceExplosion) return base;

  let sizeExtraMs = 0;
  try {
    const stats = await fs.stat(inputPath);
    const sizeMb = stats.size / (1024 * 1024);
    if (Number.isFinite(sizeMb) && sizeMb > 1.5) {
      sizeExtraMs = Math.ceil((sizeMb - 1.5) * 240000);
    }
  } catch {
    sizeExtraMs = 0;
  }

  const inspectedInstanceCount = await inspectVariableInstanceCount(inputPath);
  const hintedInstanceCount = resolveExpectedInstanceCount(options);
  const instanceCount = Math.max(inspectedInstanceCount, hintedInstanceCount);
  const instanceExtraMs = instanceCount > 8 ? (instanceCount - 8) * 9000 : 0;
  const hardCapMs = instanceCount >= 64 ? 1800000 : 900000;
  return Math.max(base, Math.min(hardCapMs, base + sizeExtraMs + instanceExtraMs));
};

// Resolve the full python path once at module load.
// Without shell:true, spawn() can't find 'python' on Windows.
// With shell:true, paths with parentheses like "(1)" get mangled by cmd.exe.
// Solution: resolve the real executable path up front.
let _pythonPath: string | null = null;
function getPythonPath(): string {
  if (_pythonPath) return _pythonPath;
  try {
    const cmd = process.platform === 'win32' ? 'where python' : 'which python3';
    _pythonPath = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0].trim();
  } catch {
    _pythonPath = process.platform === 'win32' ? 'python' : 'python3';
  }
  console.log(`[CONVERT] Python resolved: ${_pythonPath}`);
  return _pythonPath;
}

export interface ConversionResult {
  ttf: string | null;
  otf: string | null;
  woff: string | null;
  woff2: string;
  instances?: string[];
}

export interface ConvertOptions {
  disableOtf?: boolean;
  disableInstanceExplosion?: boolean;
  expectedInstanceCount?: number;
  /**
   * Preserve the input's base filename when converting (avoid renaming outputs),
   * while still allowing metadata-based name table repair inside the font.
   */
  preserveBaseName?: boolean;
}

/**
 * Convert WOFF2 to multiple formats using a Python wrapper (tools/convert-font.py)
 */
/**
 * Convert WOFF2 to multiple formats using a Python wrapper (tools/convert-font.py)
 */
/**
 * Simple Semaphore to limit concurrent Python processes
 */
class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private max: number) {}

  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release() {
    this.active--;
    if (this.queue.length > 0) {
      this.active++;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const conversionSemaphore = new Semaphore(5); // Limit to 5 concurrent conversions

const FONT_OUTPUT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

const fileExists = async (candidate: string | undefined): Promise<string | null> => {
  if (!candidate) return null;
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    return null;
  }
};

const snapshotFontOutputs = async (candidates: Array<string | undefined>): Promise<Set<string>> => {
  const directories = [...new Set(
    candidates
      .filter((candidate): candidate is string => Boolean(candidate))
      .map((candidate) => path.dirname(path.resolve(candidate)))
  )];

  const snapshot = new Set<string>();
  for (const directory of directories) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!FONT_OUTPUT_EXTENSIONS.has(ext)) continue;
        snapshot.add(path.resolve(directory, entry.name));
      }
    } catch {
      // ignore missing output directories before first conversion
    }
  }

  return snapshot;
};

const collectMaterializedOutputs = async (params: {
  inputPath: string;
  ttfPath: string;
  otfPath?: string;
  woffPath?: string;
  woff2Path?: string;
  snapshot: Set<string>;
}): Promise<ConversionResult> => {
  const directOutputSet = new Set(
    [params.ttfPath, params.otfPath, params.woffPath, params.woff2Path]
      .filter((candidate): candidate is string => Boolean(candidate))
      .map((candidate) => path.resolve(candidate))
  );

  const instances = new Set<string>();
  const directories = [...new Set(
    [params.ttfPath, params.otfPath, params.woffPath, params.woff2Path, params.inputPath]
      .filter((candidate): candidate is string => Boolean(candidate))
      .map((candidate) => path.dirname(path.resolve(candidate)))
  )];

  for (const directory of directories) {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!FONT_OUTPUT_EXTENSIONS.has(ext)) continue;
        const absolute = path.resolve(directory, entry.name);
        if (absolute === path.resolve(params.inputPath)) continue;
        if (params.snapshot.has(absolute)) continue;
        if (directOutputSet.has(absolute)) continue;
        instances.add(absolute);
      }
    } catch {
      // ignore output directories that disappeared during cleanup
    }
  }

  return {
    ttf: await fileExists(params.ttfPath),
    otf: await fileExists(params.otfPath),
    woff: await fileExists(params.woffPath),
    woff2: (await fileExists(params.woff2Path)) || params.inputPath,
    instances: [...instances].sort()
  };
};

async function convertViaPython(
  inputPath: string, 
  ttfPath: string, 
  otfPath?: string, 
  woffPath?: string,
  woff2Path?: string,
  metadata?: { family: string, subFamily: string },
  options?: ConvertOptions
): Promise<ConversionResult> {
  const script = path.join(process.cwd(), 'tools', 'convert-font.py');

  console.log(`[CONVERT] Converting: ${path.basename(inputPath)}`);
  // NO quoting needed — without shell:true, Node.js passes args directly
  // to the process without shell interpretation.
  const args = [inputPath, ttfPath, otfPath || '', woffPath || ''].filter((s) => s !== '');
  
  if (woff2Path) args.push('--woff2', woff2Path);

  if (metadata?.family) args.push('--family', metadata.family);
  if (metadata?.subFamily) args.push('--subfamily', metadata.subFamily);
  if (options?.disableOtf) args.push('--no-otf');
  if (options?.disableInstanceExplosion) args.push('--no-explode');

  const inspectedVariableInstanceCount = options?.disableInstanceExplosion ? 0 : await inspectVariableInstanceCount(inputPath);
  const hintedVariableInstanceCount = options?.disableInstanceExplosion ? 0 : resolveExpectedInstanceCount(options);
  const variableInstanceCount = Math.max(inspectedVariableInstanceCount, hintedVariableInstanceCount);
  const timeoutMs = await resolveConvertTimeoutMs(inputPath, options);
  if (timeoutMs > FONT_CONVERT_TIMEOUT_MS) {
    console.log(`[CONVERT] Extended timeout ${timeoutMs}ms for ${path.basename(inputPath)}.`);
  }

  await conversionSemaphore.acquire();
  const outputSnapshot = await snapshotFontOutputs([inputPath, ttfPath, otfPath, woffPath, woff2Path]);

  try {
    return await new Promise<ConversionResult>((resolve) => {
      let attempts = 0;
      const maxAttempts = variableInstanceCount >= 32 ? 1 : 3;

      const run = () => {
        attempts++;
        const pythonCmd = getPythonPath();
        
        // [FIX] Do NOT use shell:true — it causes cmd.exe to re-parse arguments,
        // breaking paths with parentheses like "abc-dinamo-connect (1)".
        // Node.js [DEP0190] explicitly warns against shell:true with arguments.
        const py = spawn(pythonCmd, [script, ...args], { 
            stdio: ['ignore','pipe','pipe']
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        py.stdout.on('data', (d) => (stdout += d.toString()));
        py.stderr.on('data', (d) => (stderr += d.toString()));

        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          console.warn(
            `[CONVERT] Timeout ${timeoutMs}ms for ${path.basename(inputPath)} (attempt ${attempts}/${maxAttempts}).`
          );
          try {
            py.kill();
          } catch {
            // ignore
          }
        }, timeoutMs);

        py.on('error', async (err: any) => {
            clearTimeout(timeoutHandle);
            if (attempts < maxAttempts && (err.code === 'ENOENT' || err.code === 'UNKNOWN' || err.errno === -4094)) {
                console.warn(`[CONVERT] Spawn error (${err.code}), retrying (${attempts}/${maxAttempts})...`);
                setTimeout(run, 1000);
            } else {
                console.error('[CONVERT] Final spawn failure:', err);
                resolve(await collectMaterializedOutputs({
                  inputPath,
                  ttfPath,
                  otfPath,
                  woffPath,
                  woff2Path,
                  snapshot: outputSnapshot
                }));
            }
        });

        py.on('close', async (code) => {
          clearTimeout(timeoutHandle);
          if (timedOut) {
            const recovered = await collectMaterializedOutputs({
              inputPath,
              ttfPath,
              otfPath,
              woffPath,
              woff2Path,
              snapshot: outputSnapshot
            });
            const recoveredInstanceCount = Array.isArray(recovered.instances) ? recovered.instances.length : 0;
            const hasRecoveredArtifacts = Boolean(
              recovered.ttf ||
              recovered.otf ||
              recovered.woff ||
              recoveredInstanceCount > 0
            );
            const recoveryLooksComplete =
              variableInstanceCount <= 0 ||
              options?.disableInstanceExplosion === true ||
              recoveredInstanceCount >= Math.max(1, variableInstanceCount - 1);
            if (hasRecoveredArtifacts && recoveryLooksComplete) {
              console.warn(`[CONVERT] Using materialized outputs after timeout for ${path.basename(inputPath)}.`);
              resolve(recovered);
              return;
            }
            if (attempts < maxAttempts) {
              console.warn(`[CONVERT] Retrying after timeout (${attempts}/${maxAttempts}) for ${path.basename(inputPath)}...`);
              setTimeout(run, 1000 * attempts);
              return;
            }
            console.error(`[CONVERT] Final timeout failure for ${path.basename(inputPath)}.`);
          }

          if (code !== 0) console.warn(`[CONVERT] Python exit=${code}, stderr=${stderr.substring(0, 300)}`);
          try {
            const data = stdout.trim();
            if (data) {
                const parsed = JSON.parse(data);
                resolve({
                  ttf: parsed.ttf ?? null,
                  otf: parsed.otf ?? null,
                  woff: parsed.woff ?? null,
                  woff2: parsed.woff2 ?? inputPath,
                  instances: parsed.instances ?? []
                });
                return;
            }
          } catch (e) {
            console.error(`[CONVERT] JSON parse error for ${path.basename(inputPath)}`);
          }

          if (code !== 0 && code !== null) {
              console.error(`[CONVERT] Python Exited ${code}:`, stderr.trim());
          }

          resolve(await collectMaterializedOutputs({
            inputPath,
            ttfPath,
            otfPath,
            woffPath,
            woff2Path,
            snapshot: outputSnapshot
          }));
        });
      };

      run();
    });
  } finally {
    conversionSemaphore.release();
  }
}

/**
 * Convert WOFF2 to multiple formats
 */
export async function convertToMultipleFormats(
  inputPath: string, 
  metadata?: { family: string, subFamily: string },
  options?: ConvertOptions
): Promise<ConversionResult> {
  const result: ConversionResult = {
    woff2: inputPath,
    ttf: null,
    otf: null,
    woff: null
  };

  const ext = path.extname(inputPath).toLowerCase();
  // Allow TTF, OTF, WOFF, WOFF2
  const allowedExts = ['.woff2', '.woff', '.ttf', '.otf'];
  if (!allowedExts.includes(ext)) {
    // console.log(`[CONVERT] Unsupported input format: ${ext}`);
    return result;
  }

  const originalBase = inputPath.replace(/\.(woff2?|ttf|otf)$/i, '');
  const preserveBaseName = options?.preserveBaseName === true;
  const baseName = preserveBaseName
    ? originalBase
    : metadata?.family
      ? path.join(
          path.dirname(inputPath),
          `${metadata.family.replace(/[^a-z0-9]+/gi, '-')}-${(metadata.subFamily || 'Regular').replace(/[^a-z0-9]+/gi, '-')}`
        )
      : originalBase;
    
  const ttfPath = `${baseName}.ttf`;
  const otfPath = `${baseName}.otf`;
  const woffPath = `${baseName}.woff`;
  // Only pass woff2 path to python if we need to generate/rename it, OR when we are doing
  // metadata repair and want the WOFF2 itself to carry the repaired name table.
  const shouldRewriteWoff2 = Boolean(metadata?.family && metadata?.subFamily);
  const woff2Path = (ext !== '.woff2' || baseName !== originalBase || shouldRewriteWoff2) ? `${baseName}.woff2` : undefined;

  // We need to update convertViaPython to accept woff2Path
  const conv = await convertViaPython(inputPath, ttfPath, otfPath, woffPath, woff2Path, metadata, options);
  if (conv.ttf) result.ttf = conv.ttf;
  if (conv.otf) result.otf = conv.otf;
  if (conv.woff) result.woff = conv.woff;
  if (conv.woff2) result.woff2 = conv.woff2; // Update if generated
  if (conv.instances) result.instances = conv.instances;

  return result;
}

/**
 * Legacy helper - keep for compatibility
 */
export async function convertToOtfLegacy(inputPath: string): Promise<string | null> {
  const res = await convertToMultipleFormats(inputPath);
  return res.otf ?? res.ttf;
}




