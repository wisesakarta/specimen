import * as fs from 'fs';

async function main() {
  const url = "https://mass-driver.com/typefaces/md-nichrome";
  console.log(`Fetching ${url}...`);
  const res = await fetch(url, {
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    }
  });
  
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  
  const woff2Matches = [...text.matchAll(/https?:\/\/[a-zA-Z0-9.\-/_]+\.woff2/gi)].map(m => m[0]);
  const uniqueWoff2 = [...new Set(woff2Matches)];
  console.log(`Found ${uniqueWoff2.length} direct WOFF2 URLs in HTML.`);
  if (uniqueWoff2.length > 0) {
      console.log(uniqueWoff2.slice(0, 5).join("\n"));
  }
  
  const jsonMatches = [...text.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)];
  console.log(`Found ${jsonMatches.length} generic JSON script blobs.`);
  
  // any window objects
  const jsMatch = text.match(/window\.\w+\s*=/i);
  if (jsMatch) console.log("Found window assignment:", jsMatch[0]);

  // fontdue mentions
  console.log("Fontdue mentions in HTML:", text.match(/fontdue/gi)?.length || 0);

  const ids = [...text.matchAll(/collection-id=["']([^"']+)["']/gi)].map(m => m[1]);
  console.log("Found Collection IDs:", [...new Set(ids)]);

  fs.writeFileSync("tasks/massdriver-nichrome.html", text);
  console.log("Dumped full HTML to tasks/massdriver-nichrome.html");
}

main().catch(console.error);
