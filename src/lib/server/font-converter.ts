import { promises as fs } from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';

const FONT_CONVERT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.FONT_CONVERT_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 10000) return raw;
  return 120000;
})();

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

  await conversionSemaphore.acquire();

  try {
    return await new Promise<ConversionResult>((resolve) => {
      let attempts = 0;
      const maxAttempts = 3;

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
            `[CONVERT] Timeout ${FONT_CONVERT_TIMEOUT_MS}ms for ${path.basename(inputPath)} (attempt ${attempts}/${maxAttempts}).`
          );
          try {
            py.kill();
          } catch {
            // ignore
          }
        }, FONT_CONVERT_TIMEOUT_MS);

        py.on('error', (err: any) => {
            clearTimeout(timeoutHandle);
            if (attempts < maxAttempts && (err.code === 'ENOENT' || err.code === 'UNKNOWN' || err.errno === -4094)) {
                console.warn(`[CONVERT] Spawn error (${err.code}), retrying (${attempts}/${maxAttempts})...`);
                setTimeout(run, 1000);
            } else {
                console.error('[CONVERT] Final spawn failure:', err);
                resolve({ ttf: null, otf: null, woff: null, woff2: inputPath });
            }
        });

        py.on('close', (code) => {
          clearTimeout(timeoutHandle);
          if (timedOut) {
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

          // Fallback: manual check
          const check = (p: string | undefined) => {
              try { return p && require('fs').existsSync(p) ? p : null; } catch { return null; }
          };
          resolve({
              ttf: check(ttfPath),
              otf: check(otfPath),
              woff: check(woffPath),
              woff2: check(woff2Path) || inputPath
          });
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

  const originalBase = inputPath.replace(/\.(woff2|ttf|otf)$/i, '');
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
