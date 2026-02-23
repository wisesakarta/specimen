#!/usr/bin/env node
/**
 * Font Scrapper Test Suite
 * Tests all foundry download functionality
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const TEST_TIMEOUT = 300000;

const TEST_CASES = [
  {
    name: 'ABC Dinamo - Ginto',
    url: 'https://abcdinamo.com/typefaces/ginto',
    minFonts: 10
  },
  {
    name: 'Lineto - Akkurat',
    url: 'https://lineto.com/typefaces/akkurat',
    minFonts: 2
  }
];

function makeRequest(path, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: TEST_TIMEOUT
    };

    let responseData = '';
    const req = http.request(options, (res) => {
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const lines = responseData.split('\n').filter(l => l.trim());
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            resolve(JSON.parse(lastLine));
          } else {
            resolve({ error: 'Empty response' });
          }
        } catch (e) {
          resolve({ error: e.message });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(postData);
    req.end();
  });
}

async function runTest(testCase) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${testCase.name}`);
  console.log('='.repeat(60));

  try {
    // Analyze
    const analyzeResult = await makeRequest('/api/analyze-url', { url: testCase.url });
    if (analyzeResult.error) {
      console.log(`❌ Analyze failed: ${analyzeResult.error}`);
      return false;
    }

    console.log(`✓ Foundry: ${analyzeResult.foundryName}`);
    console.log(`✓ Inject script: ${analyzeResult.injectScript ? 'YES' : 'NO'}`);

    // Download
    const downloadData = {
      mode: 'browser-intercept',
      targetUrl: analyzeResult.targetUrl || analyzeResult.originalUrl,
      injectScript: analyzeResult.injectScript,
      metadata: {
        foundry: analyzeResult.foundryName,
        family: analyzeResult.fonts?.[0]?.family
      }
    };

    console.log('[Downloading...]');
    const downloadResult = await makeRequest('/api/font-download', downloadData);
    
    if (downloadResult.error || !downloadResult.result) {
      console.log(`❌ Download failed: ${downloadResult.error || 'No result'}`);
      return false;
    }

    const downloaded = downloadResult.result.downloaded || [];
    console.log(`✓ Downloaded: ${downloaded.length} files`);
    
    if (downloaded.length >= testCase.minFonts) {
      console.log(`✅ PASS: Expected ${testCase.minFonts}, got ${downloaded.length}`);
      return true;
    } else {
      console.log(`❌ FAIL: Expected ${testCase.minFonts}, got ${downloaded.length}`);
      return false;
    }

  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🧪 Font Scrapper Test Suite');
  console.log('Testing Rebuild System...\n');

  let passed = 0;
  let failed = 0;

  for (const test of TEST_CASES) {
    const result = await runTest(test);
    if (result) passed++;
    else failed++;
    
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Passed: ${passed}/${TEST_CASES.length}`);
  console.log(`Failed: ${failed}/${TEST_CASES.length}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
