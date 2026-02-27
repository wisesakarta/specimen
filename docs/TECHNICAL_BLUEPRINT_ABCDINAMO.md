# 📄 TECHNICAL_BLUEPRINT_ABCDINAMO.md: Advanced Extraction Protocol

**Operation:** Integrated Interception
**Target:** ABC Dinamo
**Mission:** Automated Full-Glyph Extraction via Stealth Interception

---

## I. MANDATORY PRE-EXECUTION INTERROGATION (Technical Principles)

### 1. ABC Dinamo: Incremental Font Loading Simulation
**The Challenge:** Server detects and blocks massive "Unicode Flood" requests.
**The Logic:** Real users typically request glyph subsets through specific interaction patterns (scroll, hover, navigation).
**The Simulation Algorithm:**
1.  **State Initialization:** Browser opens page. Loads "Critical CSS" (Latin Subset ~30 glyphs).
2.  **Scroll Trigger:**
    *   Inject invisible `div` elements at the bottom of the DOM containing text from different Unicode ranges.
    *   `Range 1 (Latin-1 Supplement)`: "£©®..." (Delay: 0ms)
    *   `Scroll Event`: Dispatch `window.scrollBy(0, 500)`.
    *   `Range 2 (Greek)`: "αβγ..." (Delay: +200ms)
    *   `Hover Event`: Dispatch `mouseover` on navigation elements.
    *   `Range 3 (Symbols)`: "←↑→↓..." (Delay: +450ms)
3.  **Network Fusion:** The browser will fire *separate* requests for these ranges. Our `InterceptionService` captures *each* fragment.
4.  **Reconstruction:** The engine reconstructs the full font file in-memory from the valid fragments voluntarily sent by the server.

### 2. Lineto: De-obfuscation Algorithm
**The Cipher:** Simple XOR cipher using the `postscriptName` as the key.
**The Logic:**
*   **Key Derivation:** `key = -1 * postscriptName.length`
*   **Decryption:** `decryptedByte = (encryptedByte + key) & 0xFF`
*   **Stream Handling:**
    *   Detect signature `0x774F4632` (WOFF2) or `0x00010000` (TTF) at offset 0.
    *   If invalid, apply decryption to first 4 bytes using candidate keys (from URL params).
    *   If signature matches, decrypt full stream.

### 3. Architecture: Autonomous Services
**Design Pattern:** Dependency Injection with Interface-based Isolation.
*   **`StealthService`**: A wrapper around Puppeteer launch options for automated evasions.
    *   `applyStealth(page)`: Rotates User-Agents, patches `navigator.webdriver`, randomizes `window.screen`.
    *   **Automated TLS Fingerprinting:** Uses specific TLS cipher suite configurations to match modern browser signatures (Chrome 130+).

*   **`InterceptionService`**: Pure CDP Listener.
    *   `attach(page)`: Connects to `Network` domain.
    *   `onFragmentCaptured(callback)`: Emits raw buffers.

*   **`RestorationService`**: In-Memory Font Processor (Smart Merge Logic).
    *   **Re-indexing Strategy:**
        1.  **Parse:** Convert Buffer A and Buffer B into `Font Objects` (using `fonteditor-core` IR).
        2.  **Glyph Union:**
            *   Create a new Master Font Object.
            *   Iterate Buffer B's `glyf` table.
            *   Assign new indices to avoid collisions.
        3.  **CMAP Remapping:** Ensure Unicode-to-Glyph mapping is maintained across merged fragments.

---

## II. TECHNICAL IMPLEMENTATION PLAN (ABC Dinamo)

### 1. Stealth Upgrade (`StealthService`)
**Objective:** Bypass advanced bot protection mechanisms.
**Specs:**
*   **Mouse/Keyboard Simulation:** Uses realistic movement patterns to simulate human interaction.
*   **Request Randomization:** Randomizes `waitUntil` conditions and delays (340ms - 1200ms) to avoid signature detection.

### 2. CDP Interception Core (`InterceptionService`)
**Objective:** Capture raw `.woff2` data directly from the network stream for processing.

### 3. The "Incremental loader" Script
**Action:** An automated script that forces the browser to request missing glyphs by rendering hidden text ranges in sequence.

## III. Verification Plan

1.  **Unit Test - Interception:**
    *   Verify `InterceptionService` captures multiple unique `.woff2` chunks per font family.
2.  **Forensic Test - Reconstruction:**
    *   Verify the final glyph count matches expected full-set ranges (e.g., > 400 glyphs).
3.  **Visual Test - Accuracy:**
    *   Compare rendered output of reconstructed font vs original for pixel-perfect matches.

---
**Status:** Technical Blueprint Validated.
