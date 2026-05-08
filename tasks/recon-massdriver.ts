import * as fs from 'fs';

async function main() {
  const url = "https://mass-driver.com/";
  console.log(`Fetching ${url}...`);
  const res = await fetch(url, {
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    }
  });
  
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(`HTML Length: ${text.length} bytes`);
  
  // Look for Next.js data
  const nextDataMatch = text.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
      console.log("Found Next.js __NEXT_DATA__ payload!");
      fs.writeFileSync("tasks/massdriver-nextdata.json", nextDataMatch[1]);
      console.log("Dumped to tasks/massdriver-nextdata.json");
  } else {
      console.log("No Next.js __NEXT_DATA__ found.");
  }
  
  // Look for Nuxt data
  const nuxtDataMatch = text.match(/window\.__NUXT__\s*=\s*([\s\S]*?);<\/script>/i);
  if (nuxtDataMatch) {
      console.log("Found Nuxt.js payload!");
      fs.writeFileSync("tasks/massdriver-nuxtdata.js", nuxtDataMatch[1]);
      console.log("Dumped to tasks/massdriver-nuxtdata.js");
  } else {
      console.log("No Nuxt.js payload found.");
  }
  
  // Look for arbitrary JSON blobs in script tags
  const jsonMatches = [...text.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)];
  if (jsonMatches.length > 0) {
      console.log(`Found ${jsonMatches.length} generic JSON script blobs.`);
      jsonMatches.forEach((m, i) => {
          if (m[1].length > 1000) {
            fs.writeFileSync(`tasks/massdriver-blob-${i}.json`, m[1]);
            console.log(`Dumped blob ${i} (${m[1].length} bytes) to tasks/massdriver-blob-${i}.json`);
          }
      });
  }
  
  // Extract all WOFF2 references
  const woff2Matches = [...text.matchAll(/https?:\/\/[a-zA-Z0-9.\-/_]+\.woff2/gi)].map(m => m[0]);
  const uniqueWoff2 = [...new Set(woff2Matches)];
  console.log(`Found ${uniqueWoff2.length} direct WOFF2 URLs in HTML.`);
  if (uniqueWoff2.length > 0) {
      console.log(uniqueWoff2.slice(0, 5).join("\n"));
  }
  
  fs.writeFileSync("tasks/massdriver-index.html", text);
  console.log("Dumped full HTML to tasks/massdriver-index.html");
}

main().catch(console.error);
