import * as fs from 'fs';

async function queryFontdueGraphQL(queryName: string, queryBody: string, variables: any = {}) {
  const url = `https://store.mass-driver.com/graphql?queryName=${queryName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      "Content-Type": "application/json",
      "Origin": "https://mass-driver.com",
      "Referer": "https://mass-driver.com/"
    },
    body: JSON.stringify({ query: queryBody, variables })
  });
  
  const envelope = await res.json();
  if (envelope.errors) {
      console.error(`GraphQL Error: ${JSON.stringify(envelope.errors)}`);
  }
  return envelope.data;
}

async function main() {
    console.log(`Querying simple collections...`);
    const SIMPLE_QUERY = `query SimpleCollectionsQuery { collections { id slug name } }`;
    const data = await queryFontdueGraphQL("SimpleCollectionsQuery", SIMPLE_QUERY);
    console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
