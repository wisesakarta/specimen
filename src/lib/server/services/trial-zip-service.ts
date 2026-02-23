
import path from "node:path";
import fs from "node:fs/promises";
import AdmZip from "adm-zip";

export class TrialZipService {
  /**
   * Identifies candidate font files inside a captured ZIP.
   */
  static async extractBestSkeleton(zipBuffer: Buffer, outputDir: string): Promise<string | null> {
    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      
      // Look for OTF/TTF first (best skeletons)
      const fontEntries = entries.filter(e => 
        !e.isDirectory && 
        (e.entryName.toLowerCase().endsWith(".otf") || e.entryName.toLowerCase().endsWith(".ttf")) &&
        !e.entryName.includes("__MACOSX")
      );

      if (fontEntries.length === 0) return null;

      // Pick the best one (usually the largest or most standard looking)
      const bestEntry = fontEntries.sort((a, b) => b.header.size - a.header.size)[0];
      
      const targetPath = path.join(outputDir, `skeleton-${path.basename(bestEntry.entryName)}`);
      await fs.writeFile(targetPath, bestEntry.getData());
      
      console.log(`[TRIAL-ZIP] Extracted skeleton: ${targetPath} (${bestEntry.header.size} bytes)`);
      return targetPath;
    } catch (e) {
      console.error("[TRIAL-ZIP] Failed to process ZIP:", e);
      return null;
    }
  }
}
