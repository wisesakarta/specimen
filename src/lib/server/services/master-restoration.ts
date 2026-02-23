
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";

const execAsync = promisify(exec);

export interface MasterForgeOptions {
  family: string;
  subfamily: string;
  psName: string;
  outputFolder: string;
  skeletonPath?: string | null;
}

export class MasterRestorationService {
  /**
   * Orchestrates the fusion of font fragments using the Python Master Forge engine.
   */
  static async process(buffers: Buffer[], options: MasterForgeOptions): Promise<{ buffer: Buffer; metadata: any } | null> {
    if (buffers.length === 0) return null;

    const tempDir = path.join(process.cwd(), ".temp-staging", `forge-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const fragmentPaths: string[] = [];
      for (let i = 0; i < buffers.length; i++) {
        const fragPath = path.join(tempDir, `fragment-${i}.woff2`);
        await fs.writeFile(fragPath, buffers[i]);
        fragmentPaths.push(fragPath);
      }

      const outputPath = path.join(tempDir, `${options.psName}.otf`);
      const metaPath = `${outputPath}.json`;
      
      // Execute the Master Forge (Python)
      let cmd = `python tools/master_forge.py --fragments ${fragmentPaths.join(" ")} --output "${outputPath}" --family "${options.family}" --subfamily "${options.subfamily}" --psname "${options.psName}" --autoname`;
      
      if (options.skeletonPath) {
        cmd += ` --skeleton "${options.skeletonPath}"`;
      }
      
      console.log(`[MASTER-RESTORE] Executing Forge: ${cmd}`);
      await execAsync(cmd);

      // Check if output exists
      if (await fs.stat(outputPath).catch(() => null)) {
        const forgedBuffer = await fs.readFile(outputPath);
        
        let metadata = {
          family: options.family,
          subfamily: options.subfamily,
          psname: options.psName
        };

        // Try to read restored metadata from Python auto-naming
        try {
          const metaContent = await fs.readFile(metaPath, "utf-8");
          const parsed = JSON.parse(metaContent);
          metadata = { ...metadata, ...parsed };
          console.log(`[MASTER-RESTORE] Metadata auto-resolved: ${metadata.family} - ${metadata.subfamily}`);
        } catch (e) {
          // fallback to requested info
        }

        console.log(`[MASTER-RESTORE] SUCCESS: Master forged and retrieved (${forgedBuffer.length} bytes)`);
        return { buffer: forgedBuffer, metadata };
      }

      return null;
    } catch (e) {
      console.error("[MASTER-RESTORE] Forge Failed:", e);
      return null;
    } finally {
      // Cleanup temp fragments
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
    }
  }
}
