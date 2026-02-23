
/**
 * Unicode Blocks for deep glyph provocation.
 * Used to force foundries to deliver comprehensive font subsets.
 */
export const PROVOCATION_LEVELS = {
  LATIN_BASIC: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  LATIN_EXTENDED: "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ",
  SYMBOLS: "!@#$%^&*()_+-=[]{}|;':\",./<>?`~™®©§†‡¶•‣",
  CURRENCY: "€$£¥¢₹₽₺₦₱",
  PUNCTUATION_EXTENDED: "«»“”‘’‚„‹›—–…",
  MATHEMATICAL: "×÷±≈≠≤≥∞√π∂∆∏∑",
  GREEK: "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω",
};

export const getFullProvocationString = (): string => {
  return Object.values(PROVOCATION_LEVELS).join("");
};

/**
 * Builds a script to be injected into Puppeteer to cycle through Unicode blocks.
 * This forces the dynamic font loader to fetch missing glyphs.
 */
export const buildExhaustionScript = (selector: string): string => {
  const fullText = getFullProvocationString();
  return `
    (async () => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) return;
      
      const blocks = ${JSON.stringify(Object.values(PROVOCATION_LEVELS))};
      for (const block of blocks) {
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          target.value = block;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          target.innerText = block;
        }
        await new Promise(r => setTimeout(r, 150)); // Allow time for font server request
      }
    })();
  `;
};
