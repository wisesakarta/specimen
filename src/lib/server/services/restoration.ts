
// [ALIEN TECH] Restoration Service
// Uses fonteditor-core for in-memory merging and re-indexing
// Docs: https://github.com/kekee000/fonteditor-core

// We use dynamic imports or require because fonteditor-core might have type definition issues in ESM
import { Font, woff2 } from "fonteditor-core";

interface RestoredFont {
    buffer: Buffer;
    metadata: {
        family: string;
        subFamily: string;
        glyphCount: number;
    };
}

type FontBufferType = "woff2" | "woff" | "ttf" | "otf" | "unknown";

const detectBufferType = (buf: Buffer): FontBufferType => {
    if (!buf || buf.length < 4) return "unknown";
    const signature = buf.readUInt32BE(0);
    if (signature === 0x774f4632) return "woff2";
    if (signature === 0x774f4646) return "woff";
    if (signature === 0x00010000) return "ttf";
    if (signature === 0x4f54544f) return "otf";
    return "unknown";
};

export class RestorationService {

    /**
     * @param buffers Array of raw font buffers (woff2/ttf) intercepted from network
     * @description Merges multiple font subsets into a single master font using re-indexing strategy.
     */
    static async process(buffers: Buffer[]): Promise<RestoredFont | null> {
        if (buffers.length === 0) return null;

        // [FIX] Inisialisasi module WOFF2 untuk ESM environment
        try {
            await woff2.init();
        } catch (e) {
            console.error("[Restoration] WOFF2 Init Failed:", e);
        }

        // Use standard import for ESM compatibility
        // fonteditor-core often needs to be accessed via default or named Font
        // In ESM, the Font is already imported at top

        let masterFont: any = null;
        let masterObject: any = null;
        let loadedFragments = 0;
        let skippedFragments = 0;
        let failedFragments = 0;
        const failureSamples = new Map<string, number>();

        for (const buf of buffers) {
            const detectedType = detectBufferType(buf);
            if (detectedType === "unknown") {
                skippedFragments++;
                continue;
            }

            try {
                const font: any = Font.create(buf, { 
                    type: detectedType
                });
                
                const obj = font.get();
                const glyphCount = obj.glyf.length;
                loadedFragments++;
                console.log(`[Restoration] Fragment loaded: ${glyphCount} glyphs`);

                if (!masterFont) {
                    masterFont = font;
                    masterObject = obj;
                    continue;
                }

                // === SMART MERGE LOGIC ===
                // 1. Map existing Unicodes in Master
                const masterUnicodes = new Set<number>();
                const masterCmap = masterObject.cmap || {};
                
                // Build a quick lookup from cmap
                for (const u in masterCmap) {
                   masterUnicodes.add(parseInt(u));
                }

                // 2. Iterate Donor Glyphs
                const donorObject = obj;
                let addedCount = 0;

                for (let i = 0; i < donorObject.glyf.length; i++) {
                    const glyph = donorObject.glyf[i];
                    
                    // fonteditor-core glyph structure: { unicode: [123], name: 'a', contours: ... }
                    const unicodes = glyph.unicode || [];
                    
                    if (unicodes.length === 0) continue; // Skip unmapped glyphs (unless handled otherwise)

                    // Check if ANY of the unicodes exist in Master
                    const exists = unicodes.some((u: number) => masterUnicodes.has(u));

                    if (!exists) {
                        // Import Glyph
                        // Push to glyf array
                        masterObject.glyf.push(glyph);
                        const newIndex = masterObject.glyf.length - 1;
                        
                        // Update CMAP
                        for (const u of unicodes) {
                            masterObject.cmap[u] = newIndex;
                            masterUnicodes.add(u);
                        }
                        addedCount++;
                    }
                }
                
                console.log(`[Restoration] +${addedCount} unique glyphs merged.`);

            } catch (e: any) {
                failedFragments++;
                const message = String(e?.message || "unknown fragment error");
                failureSamples.set(message, (failureSamples.get(message) || 0) + 1);
            }
        }

        if (failedFragments > 0 || skippedFragments > 0) {
            const sample = [...failureSamples.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2)
                .map(([msg, count]) => `${count}x ${msg}`)
                .join(" | ");
            const suffix = sample ? ` | samples: ${sample}` : "";
            console.warn(
                `[Restoration] Summary: loaded=${loadedFragments}, failed=${failedFragments}, skipped=${skippedFragments}${suffix}`
            );
        }

        if (!masterObject) return null;

        // === METADATA SCRUBBING ===
        // Reset permissions (fsType 0 = Installable)
        if (!masterObject['OS/2']) masterObject['OS/2'] = {};
        masterObject['OS/2'].fsType = 0;
        
        // Standardize Names
        const nameTable = masterObject.name;
        // Logic: Try to keep original family but strip "Subset" labels
        if (nameTable.fontFamily) {
             nameTable.fontFamily = nameTable.fontFamily.replace('Subset', '').trim();
             nameTable.fullFontName = nameTable.fontFamily + " " + (nameTable.fontSubFamily || "Regular");
        }
        
        // Update valid glyph count in maxp
        if (!masterObject.maxp) masterObject.maxp = {};
        masterObject.maxp.numGlyphs = masterObject.glyf.length;
        
        // === REBUILD ===
        masterFont.set(masterObject);
        
        // Output WOFF2
        const outBuffer = masterFont.write({ 
            type: 'woff2'
        });

        console.log(`[${new Date().toLocaleTimeString()}] ✓ Processing Complete. Master contains ${masterObject.glyf.length} glyphs.`);

        return {
            buffer: outBuffer,
            metadata: {
                family: masterObject.name.fontFamily || "Unknown",
                subFamily: masterObject.name.fontSubFamily || "Regular",
                glyphCount: masterObject.glyf.length
            }
        };
    }
}
