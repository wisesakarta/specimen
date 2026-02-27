const http = require('http');

const FOUNDRIES = [
  { name: 'Lineto', url: 'https://lineto.com/typefaces/akkurat' },
  { name: 'ABC Dinamo', url: 'https://abcdinamo.com/typefaces/ginto' },
  { name: '205TF', url: 'https://205.tf' },
  { name: 'Klim', url: 'https://klim.co.nz/collections/soehne' },
  { name: 'Swiss', url: 'https://swisstypefaces.com/fonts/akzidenz-grotesk' },
  { name: 'Pangram', url: 'https://pangrampangram.com/products/surface' },
];

async function testFoundry(foundry) {
  return new Promise((resolve) => {
    const analyzeData = JSON.stringify({ url: foundry.url });
    
    const req = http.request({
      hostname: 'localhost',
      port: 3003,
      path: '/api/analyze-url',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(analyzeData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve({
            name: foundry.name,
            success: result.foundryName ? true : false,
            foundryName: result.foundryName,
            error: result.error || null
          });
        } catch (e) {
          resolve({
            name: foundry.name,
            success: false,
            error: 'Parse error'
          });
        }
      });
    });
    
    req.on('error', e => resolve({ name: foundry.name, success: false, error: e.message }));
    req.write(analyzeData);
    req.end();
  });
}

async function runTests() {
  console.log('=== TESTING ALL FOUNDRIES ===\n');
  
  const results = [];
  for (const foundry of FOUNDRIES) {
    process.stdout.write(`Testing ${foundry.name}... `);
    const result = await testFoundry(foundry);
    results.push(result);
    console.log(result.success ? `✓ ${result.foundryName}` : `✗ ${result.error}`);
  }
  
  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.success).length;
  console.log(`Passed: ${passed}/${FOUNDRIES.length}`);
  
  if (passed < FOUNDRIES.length) {
    console.log('\nFailed:');
    results.filter(r => !r.success).forEach(r => console.log(`  - ${r.name}: ${r.error}`));
  }
}

runTests();
