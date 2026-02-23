import path from "node:path";
import { rm, access } from "node:fs/promises";
import { Buffer } from "node:buffer";
// @ts-ignore — IDE shows ts(1192) for adm-zip export= pattern, but tsc handles it via esModuleInterop
import AdmZip from "adm-zip";

/**
 * Service for handling automated folder compression (Zip) 
 * and persistent directory cleanup.
 */
export class ZipService {
  /**
   * Compresses a directory into a ZIP buffer.
   * @param sourceDir The source directory path.
   */
  static async createZip(sourceDir: string): Promise<Buffer> {
    try {
      // Check if directory exists
      await access(sourceDir);
      
      const zip = new AdmZip();
      
      // Flatten: put the directory contents at ZIP root (no wrapper folder like `job-...`).
      zip.addLocalFolder(sourceDir, "");
      
      return zip.toBuffer();
    } catch (error: any) {
      console.error(`[ZIP-SERVICE] Error creating zip for ${sourceDir}:`, error.message);
      throw new Error(`Failed to bundle font assets: ${error.message}`);
    }
  }

  /**
   * Automatically removes temporary working directories.
   * @param dirPath The directory to remove.
   */
  static async autoCleanup(dirPath: string): Promise<void> {
    try {
      // Ensure we only cleanup temp directories, not root or system folders
      if (!dirPath.includes(".temp-staging") && !dirPath.includes("job-")) {
        console.warn(`[CLEANUP] Blocked cleanup of potentially sensitive path: ${dirPath}`);
        return;
      }

      await rm(dirPath, { recursive: true, force: true });
      console.log(`[CLEANUP] Automatically removed temporary directory: ${dirPath}`);
    } catch (error) {
      console.error(`[CLEANUP] Failed to remove temporary directory: ${dirPath}`, error);
    }
  }
}
