const http = require('http');

async function analyzeAndDownload(foundryUrl, foundryName) {
  return new Promise((resolve) => {
    const analyzeData = JSON.stringify({ url: foundryUrl });
    
    const req = http.request({
      hostname: 'localhost',
      port: 3003,
      path: '/api/analyze-url',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(analyzeData)
      }
    }, async (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const result = JSON.parse(data);
          console.log(`\n=== ${foundryName} ===`);
          console.log(`Foundry: ${result.foundryName}`);
          console.log(`Target: ${result.targetUrl}`);
          
          if (!result.targetUrl) {
            resolve({ success: false, error: 'No target URL' });
            return;
          }
          
          // Start download
          const downloadData = JSON.stringify({
            mode: "browser-intercept",
            targetUrl: result.targetUrl,
            injectScript: result.injectScript,
            metadata: { foundry: result.foundryName }
          });
          
          let dlData = '';
          const dlReq = http.request({
            hostname: 'localhost',
            port: 3003,
            path: '/api/font-download',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(downloadData)
            },
            timeout: 120000
          }, (res2) => {
            res2.on('data', chunk => dlData += chunk);
            res2.on('end', () => {
              const lines = dlData.split('\n').filter(l => l.trim());
              const lastLine = lines[lines.length - 1];
              try {
                const dlResult = JSON.parse(lastLine);
                const files = dlResult.result?.downloaded || [];
                console.log(`Downloaded: ${files.length} files`);
                
                // Show first 5 files with proper naming
                console.log('Sample files:');
                files.slice(0, 5).forEach(f => {
                  console.log(`  - ${f.fileName}`);
                });
                
                resolve({ success: true, files });
              } catch (e) {
                resolve({ success: false, error: 'Parse error' });
              }
            });
          });
          
          dlReq.on('error', e => resolve({ success: false, error: e.message }));
          dlReq.write(downloadData);
          dlReq.end();
          
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    });
    
    req.on('error', e => resolve({ success: false, error: e.message }));
    req.write(analyzeData);
    req.end();
  });
}

async function runFullTest() {
  console.log('=== FULL DOWNLOAD TEST ===');
  
  // Test Lineto
  await analyzeAndDownload('https://lineto.com/typefaces/akkurat', 'Lineto');
  
  // Wait a bit between tests
  await new Promise(r => setTimeout(r, 2000));
  
  // Test ABC Dinamo
  await analyzeAndDownload('https://abcdinamo.com/typefaces/ginto', 'ABC Dinamo');
  
  console.log('\n=== TESTS COMPLETE ===');
}

runFullTest();
