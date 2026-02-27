
/**
 * SAKA ENGINE - PROVOCATION DICTIONARY
 * Kumpulan string dan skrip untuk memancing ("provoke") browser agar mengunduh
 * subset font yang lebih lengkap dari server yang menggunakan dynamic subsetting.
 */

export const PROVOCATION_STRATEGIES = {
    // Basic Latin A-Z
    STANDARD: "The quick brown fox jumps over the lazy dog. 1234567890",

    // Extended with common symbols and punctuation
    EXTENDED: `The quick brown fox jumps over the lazy dog. 
    1234567890 
    !@#$%^&*()_+{}|:<>?~-=[]\;',./
    ABCDEFGHIJKLMNOPQRSTUVWXYZ
    abcdefghijklmnopqrstuvwxyz`,

    // "Chaos Mode" - Includes diacritics, currency, and common unnecessary chars
    // Goals: Trigger Latin-1 Supplement, Currency Symbols, etc.
    CHAOS: `
    AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz
    0123456789
    !@#$%^&*()_+-=[]{}|;':",./<>?
    ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß
    àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ
    €£¥¢₹₽₺₱
    ©®™°•
    “‘’”«»
    —–-
    `,

    // Developer / Code specific (for coding fonts)
    CODE: `
    function hack() { return "0xDEADBEEF"; }
    const array = [1, 2, 3].map(x => x * 2);
    if (a !== b && c >= d) { console.log(null || undefined); }
    // Ligatures test: => === != !== -> --> |- -- ::
    `
};

/**
 * Generates a browser-side script to inject the chosen strategy into all inputs.
 * @param strategyKey Key of the strategy to use (STANDARD, EXTENDED, CHAOS, CODE)
 */
export function generateProvocationScript(strategyKey: keyof typeof PROVOCATION_STRATEGIES = 'CHAOS'): string {
    const text = PROVOCATION_STRATEGIES[strategyKey] || PROVOCATION_STRATEGIES.CHAOS;
    // Compress text a bit to avoid massive strings in log
    const safeText = text.replace(/`/g, '\\`').replace(/\n/g, '\\n');

    return `
    (async () => {
        const PANGRAM = \`${safeText}\`;
        console.log("[SAKA-PROVOKE] Strategy: ${strategyKey} | Mode: DOM-Pressure");

        function provoke(el) {
            try {
                el.focus();
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    el.value = PANGRAM;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (el.isContentEditable) {
                    el.innerText = PANGRAM;
                }
            } catch(e) {}
        }

        const inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
        inputs.forEach(provoke);

        // DOM-PRESSURE: Force render every font in the document
        try {
            const allFonts = Array.from(document.fonts);
            const stage = document.createElement('div');
            stage.style.cssText = 'position:fixed;bottom:0;right:0;opacity:0.01;pointer-events:none;z-index:-1;';
            document.body.appendChild(stage);
            
            for (const f of allFonts) {
                try {
                    // Try to load it first
                    f.load().catch(() => {});
                    // Append a character to force a layout/texture upload
                    const span = document.createElement('span');
                    span.style.fontFamily = '"' + f.family + '"';
                    span.textContent = 'A'; 
                    stage.appendChild(span);
                } catch(e) {}
            }
        } catch(e) {}

        // Scroll to trigger lazy loaders
        window.scrollTo(0, document.body.scrollHeight);
        
        // Safety delay to allow font streams to start downloading
        await new Promise(r => setTimeout(r, 6000));
        
        // Signal completion to the interceptor
        window.__specimen_extraction_complete = true;
        window.__saka_extraction_complete = true;
    })();`;
}
