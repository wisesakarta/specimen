import * as fs from 'fs';

const CHARACTER_VIEWER_QUERY = `query CharacterViewerIDQuery($collectionId: ID!){node(id:$collectionId){__typename ... on FontCollection {id name cssUrl collectionType glyphGroups {name characterSets {features}} featureStyle {cssFamily name glyphNames {features name} verticalMetrics {unitsPerEm ascender descender xHeight capHeight lineGap}} fontStyles {id cssFamily name} children(collectionTypes:[FAMILY]) {id name cssUrl fontStyles {id cssFamily name}}}}}`;

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
    const id = "Rm9udENvbGxlY3Rpb246MTAyNTIyNzEwNDI4NDg0MTg1OA==";
    console.log(`Querying CharacterViewerIDQuery for UUID: ${id}`);
    const data = await queryFontdueGraphQL("CharacterViewerIDQuery", CHARACTER_VIEWER_QUERY, { collectionId: id });
    
    fs.writeFileSync('tasks/massdriver-graphql-real.json', JSON.stringify(data, null, 2));
    console.log(`Saved output to tasks/massdriver-graphql-real.json`);
}

main().catch(console.error);
