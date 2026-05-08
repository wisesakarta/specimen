import * as fs from 'fs';

async function main() {
    const res = await fetch("https://js.fontdue.com/fontdue.js");
    const text = await res.text();
    
    // Find all strings in the JS file that look like GraphQL queries
    const queryMatches = [...text.matchAll(/query\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*\{[\s\S]{10,2000}?\}\s*\}/g)];
    const queries = queryMatches.map(m => m[0]);
    
    const queryMatchesNoVars = [...text.matchAll(/query\s+[A-Za-z0-9_]+\s*\{[\s\S]{10,2000}?\}\s*\}/g)];
    const queriesNoVars = queryMatchesNoVars.map(m => m[0]);
    
    console.log(`Found ${queries.length} queries with vars, ${queriesNoVars.length} queries without vars.`);
    
    fs.writeFileSync("tasks/fontdue-queries.json", JSON.stringify({ vars: queries, noVars: queriesNoVars }, null, 2));
    
    // Also, extract by looking for specific operation names
    const operations = [...text.matchAll(/operationName:\s*"([^"]+)",/gi)];
    console.log(`Found operation names: ${[...new Set(operations.map(m => m[1]))].join(", ")}`);
    
    // Extract exact query string literals
    const strings = [...text.matchAll(/(?:query|mutation)\s+[a-zA-Z0-9_]+[\s\S]{10,1000}?\}/g)];
    console.log(`Found ${strings.length} raw query strings.`);
    if (strings.length > 0) {
        fs.writeFileSync("tasks/fontdue-raw-queries.txt", strings.map(s => s[0]).join("\n\n=====\n\n"));
    }
}

main().catch(console.error);
