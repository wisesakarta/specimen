import * as fs from 'fs';

const STORE_MODAL_PRODUCT_QUERY = `query StoreModalProductRefetchQuery($licenseOptions:[LicenseOptionsSpec]!,$orderVariables:[OrderVariableSelectionInput!],$id:ID!){node(id:$id){__typename ... on FontCollection {id name cssUrl featureStyle {cssFamily name supportedLanguages} fontStyles {id name cssFamily cssWeight supportedLanguages sku {id}} children(collectionTypes:[FAMILY]) {id name cssUrl featureStyle {cssFamily name supportedLanguages} fontStyles {id name cssFamily cssWeight supportedLanguages sku {id}}} licenses {id name defaultSelected variables:licenseVariables {id name variableType options:licenseOptions {id name amount}}}}}}`;
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
    // We need to know the 'collectionId'. Usually it's the slug of the font, e.g., 'md-nichrome'
    const targetSlugs = ['md-nichrome', 'md-polychrome', 'md-lorien', 'md-io', 'md-system', 'md-primer', 'md-thermochrome'];
    const results: any[] = [];
    
    for (const slug of targetSlugs) {
        console.log(`Querying Fontdue GraphQL for: ${slug}`);
        const data = await queryFontdueGraphQL("CharacterViewerIDQuery", CHARACTER_VIEWER_QUERY, { collectionId: slug });
        if (data && data.node) {
            console.log(`[OK] Extracted data for ${slug}`);
            results.push(data.node);
        } else {
            console.log(`[WARN] Not found or error for ${slug}`);
            // Attempt to get the Store product details
            const storeData = await queryFontdueGraphQL("StoreModalProductRefetchQuery", STORE_MODAL_PRODUCT_QUERY, { id: slug, licenseOptions: [], orderVariables: [] });
            if (storeData && storeData.node) {
                console.log(`[OK] Extracted StoreModal data for ${slug}`);
                results.push(storeData.node);
            }
        }
    }
    
    fs.writeFileSync('tasks/massdriver-graphql.json', JSON.stringify(results, null, 2));
    console.log(`Done. Saved ${results.length} collections to tasks/massdriver-graphql.json`);
}

main().catch(console.error);
