const http = require('http');

const analyzeData = JSON.stringify({ url: "https://lineto.com/typefaces/akkurat" });

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
  res.on('end', async () => {
    const result = JSON.parse(data);
    console.log('✓ Analyze:', result.foundryName);
    console.log('✓ Target URL:', result.targetUrl);
    
    // Download
    const downloadData = JSON.stringify({
      mode: "browser-intercept",
      targetUrl: result.targetUrl,
      injectScript: result.injectScript,
      metadata: { foundry: result.foundryName, family: result.fonts[0].family }
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
      timeout: 180000
    }, (res2) => {
      res2.on('data', chunk => dlData += chunk);
      res2.on('end', () => {
        const lines = dlData.split('\n').filter(l => l.trim());
        const lastLine = lines[lines.length - 1];
        const dlResult = JSON.parse(lastLine);
        
        console.log('\n=== DOWNLOAD COMPLETE ===');
        console.log('Files:', dlResult.result.downloaded.length);
        console.log('\nFirst 10 files:');
        dlResult.result.downloaded.slice(0, 10).forEach(f => {
          console.log('  -', f.fileName);
        });
        
        // Check for converted files
        const converted = dlResult.result.downloaded.filter(f => f.fileName.endsWith('.ttf') || f.fileName.endsWith('.otf'));
        console.log('\nConverted files (TTF/OTF):', converted.length);
        converted.forEach(f => console.log('  -', f.fileName));
        
        process.exit(0);
      });
    });
    
    dlReq.on('error', e => console.error('Error:', e));
    dlReq.write(downloadData);
    dlReq.end();
  });
});

req.on('error', e => console.error('Error:', e));
req.write(analyzeData);
req.end();
