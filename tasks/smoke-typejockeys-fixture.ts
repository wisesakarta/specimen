import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { TypejockeysScraper } from "../src/lib/scrapers/typejockeys.ts";

type FixtureRoot = {
  slugs?: string[];
  results?: Record<string, unknown>;
};

type TypejockeysCollection = {
  fontStyles?: Array<{
    webfontSources?: Array<{ format?: string; url?: string }>;
  }>;
  children?: TypejockeysCollection[];
};

const FIXTURE_PATH = "tmp/typejockeys-fontdue-deep.json";
const GRAPHQL_ENDPOINT = "https://fontdue.typejockeys.com/graphql";

const pickWebfontUrl = (
  sources: Array<{ format?: string; url?: string }> | undefined
): string | undefined => {
  const list = Array.isArray(sources) ? sources : [];
  const woff2 = list.find((item) => String(item?.format || "").toLowerCase() === "woff2")?.url;
  const woff = list.find((item) => String(item?.format || "").toLowerCase() === "woff")?.url;
  const url = String(woff2 || woff || "").trim();
  return url ? url : undefined;
};

const countExpectedFonts = (collection: TypejockeysCollection | undefined): number => {
  if (!collection) return 0;
  const urls = new Set<string>();
  const stack: TypejockeysCollection[] = [collection];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) continue;
    const styles = Array.isArray(next.fontStyles) ? next.fontStyles : [];
    for (const style of styles) {
      const url = pickWebfontUrl(style?.webfontSources);
      if (url) urls.add(url);
    }
    const children = Array.isArray(next.children) ? next.children : [];
    for (const child of children) stack.push(child);
  }
  return urls.size;
};

async function run() {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  const fixture = JSON.parse(raw) as FixtureRoot;
  const slugs = Array.isArray(fixture.slugs) ? fixture.slugs : [];
  const results = (fixture.results || {}) as Record<string, any>;

  assert.equal(TypejockeysScraper.canHandle("https://www.typejockeys.com/en/font/marie"), true);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input || "");
    if (!url.startsWith(GRAPHQL_ENDPOINT)) {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    const bodyRaw = typeof init?.body === "string" ? init.body : "";
    const payload = bodyRaw ? JSON.parse(bodyRaw) : {};
    const slug = String(payload?.variables?.name || "").trim();
    const value = results[slug];

    const envelope = { data: value };
    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as any;

  try {
    let passed = 0;
    let failed = 0;

    for (const slug of slugs) {
      try {
        const scraped = await TypejockeysScraper.scrape(`https://www.typejockeys.com/en/font/${slug}`);
        const collection = results[slug]?.viewer?.slug?.fontCollection as TypejockeysCollection | undefined;
        const expected = countExpectedFonts(collection);
        assert.equal(scraped.fonts.length, expected, `${slug}: font count mismatch`);

        for (const font of scraped.fonts) {
          assert.equal(typeof (font.metadata as any)?.headers?.Referer, "string", `${slug}: missing Referer header`);
          assert.equal((font.metadata as any)?.headers?.Origin, "https://www.typejockeys.com", `${slug}: Origin mismatch`);
        }
        passed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[FAIL] ${slug}:`, error instanceof Error ? error.message : String(error));
      }
    }

    console.log(`[Typejockeys Fixture] PASS=${passed} FAIL=${failed}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch((error) => {
  console.error("Typejockeys fixture smoke failed:", error);
  process.exitCode = 1;
});
