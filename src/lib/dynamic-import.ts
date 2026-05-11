import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/**
 * Sovereign Recovery Protocol: ChunkLoadError Mitigation.
 * 
 * In a workstation-grade environment, a deployment must not result in 
 * a system failure. This wrapper catches Webpack ChunkLoadErrors 
 * (typically caused by a missing manifest after a deployment) and 
 * triggers a forensic reload to restore operational truth.
 */
export function safeDynamicImport<T>(importFn: () => Promise<{ default: ComponentType<T> }>) {
  return dynamic(async () => {
    try {
      return await importFn();
    } catch (error: any) {
      // Check for Webpack/Next.js chunk loading failures
      const isChunkError = 
        error.name === "ChunkLoadError" || 
        error.message?.includes("Loading chunk") ||
        error.message?.includes("Failed to fetch dynamically imported module");

      if (isChunkError) {
        console.warn("[Sovereign Runtime] Chunk load failure detected. Deployment likely in progress. Triggering recovery reload...");
        
        if (typeof window !== "undefined") {
          // Perform a hard reload to fetch the new manifest
          window.location.reload();
        }
      }
      
      throw error;
    }
  }, { ssr: false });
}
