const http = require('http');

console.log('Testing ABC Dinamo Download...\n');

const analyzeData = JSON.stringify({ url: "https://abcdinamo.com/typefaces/ginto" });

const analyzeReq = http.request({
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
    const result = JSON.parse(data);
    console.log('✓ Analyze berhasil');
    console.log('  Foundry:', result.foundryName);
    console.log('  Family:', result.fonts[0].family);
    console.log('  Expected:', result.expectedCount);
    
    // Download
    const downloadData = JSON.stringify({
      mode: "browser-intercept",
      targetUrl: result.targetUrl,
      injectScript: result.injectScript,
      expectedCount: result.expectedCount,
      metadata: {
        foundry: result.foundryName,
        family: result.fonts[0].family
      }
    });
    
    console.log('\nStarting download...');
    let responseData = '';
    
    const dlReq = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/font-download',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(downloadData)
      },
      timeout: 120000
    }, (res2) => {
      res2.on('data', chunk => {
        responseData += chunk;
        // Show progress
        const lines = responseData.split('\n').filter(l => l.trim());
        const lastLine = lines[lines.length - 1];
        try {
          const event = JSON.parse(lastLine);
          if (event.type === 'log') {
            console.log('  >', event.message);
          }
        } catch (e) {}
      });
      
      res2.on('end', () => {
        try {
          const lines = responseData.split('\n').filter(l => l.trim());
          const lastLine = lines[lines.length - 1];
          const dlResult = JSON.parse(lastLine);
          
          if (dlResult.result) {
            console.log('\n✅ DOWNLOAD BERHASIL!');
            console.log('  Files:', dlResult.result.downloaded.length);
            console.log('  Output:', dlResult.result.outputDir);
            console.log('\nSample files:');
            dlResult.result.downloaded.slice(0, 5).forEach(f => {
              console.log('  -', f.fileName);
            });
          } else {
            console.log('\n❌ Download gagal:', dlResult.error || 'Unknown error');
          }
        } catch (e) {
          console.error('\n❌ Parse error:', e.message);
        }
        process.exit(0);
      });
    });
    
    dlReq.on('error', e => {
      console.error('❌ Download error:', e.message);
      process.exit(1);
    });
    
    dlReq.write(downloadData);
    dlReq.end();
  });
});

analyzeReq.on('error', e => {
  console.error('❌ Analyze error:', e.message);
  process.exit(1);
});

analyzeReq.write(analyzeData);
analyzeReq.end();
