const http = require('http');

const TEST_CASES = [
  { name: 'Lineto - Akkurat', url: 'https://lineto.com/typefaces/akkurat' },
  { name: '205TF - Moss', url: 'https://205.tf/typefaces/moss' },
  { name: 'Klim - Söhne', url: 'https://klim.co.nz/buy/soehne' },
];

async function testFoundry(testCase) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing: ${testCase.name}`);
  console.log('='.repeat(50));

  // Analyze
  const analyzeData = JSON.stringify({ url: testCase.url });
  
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
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
          console.log(`✓ Analyze: ${result.foundryName}`);
          console.log(`  Fonts found: ${result.fonts?.length || 0}`);
          console.log(`  Has injectScript: ${!!result.injectScript}`);
          
          if (!result.injectScript) {
            console.log(`❌ NO INJECT SCRIPT - Download won't work!`);
            resolve({ name: testCase.name, success: false, error: 'No injectScript' });
            return;
          }
          
          // Try download
          const downloadData = JSON.stringify({
            mode: "browser-intercept",
            targetUrl: result.targetUrl || result.originalUrl,
            injectScript: result.injectScript,
            metadata: { foundry: result.foundryName, family: result.fonts?.[0]?.family }
          });
          
          let dlData = '';
          const dlReq = http.request({
            hostname: 'localhost',
            port: 3000,
            path: '/api/font-download',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(downloadData)
            },
            timeout: 90000
          }, (res2) => {
            res2.on('data', chunk => dlData += chunk);
            res2.on('end', () => {
              try {
                const lines = dlData.split('\n').filter(l => l.trim());
                const lastLine = lines[lines.length - 1];
                const dlResult = JSON.parse(lastLine);
                
                if (dlResult.error) {
                  console.log(`❌ Download Error: ${dlResult.error}`);
                  resolve({ name: testCase.name, success: false, error: dlResult.error });
                } else if (dlResult.result) {
                  console.log(`✓ Download: ${dlResult.result.downloaded?.length || 0} files`);
                  resolve({ name: testCase.name, success: true, files: dlResult.result.downloaded?.length || 0 });
                } else {
                  console.log(`❌ Unknown result`);
                  resolve({ name: testCase.name, success: false, error: 'Unknown' });
                }
              } catch (e) {
                console.log(`❌ Parse Error: ${e.message}`);
                resolve({ name: testCase.name, success: false, error: e.message });
              }
            });
          });
          
          dlReq.on('error', e => {
            console.log(`❌ Request Error: ${e.message}`);
            resolve({ name: testCase.name, success: false, error: e.message });
          });
          
          dlReq.write(downloadData);
          dlReq.end();
          
        } catch (e) {
          console.log(`❌ Analyze Error: ${e.message}`);
          resolve({ name: testCase.name, success: false, error: e.message });
        }
      });
    });
    
    req.on('error', e => {
      console.log(`❌ Request Error: ${e.message}`);
      resolve({ name: testCase.name, success: false, error: e.message });
    });
    
    req.write(analyzeData);
    req.end();
  });
}

async function main() {
  console.log('Testing All Foundries...\n');
  
  const results = [];
  for (const tc of TEST_CASES) {
    const result = await testFoundry(tc);
    results.push(result);
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log(`\n${'='.repeat(50)}`);
  console.log('SUMMARY');
  console.log('='.repeat(50));
  
  results.forEach(r => {
    const status = r.success ? '✅' : '❌';
    console.log(`${status} ${r.name}: ${r.success ? r.files + ' files' : r.error}`);
  });
  
  const successCount = results.filter(r => r.success).length;
  console.log(`\nSuccess: ${successCount}/${results.length}`);
  
  process.exit(successCount === results.length ? 0 : 1);
}

main();
