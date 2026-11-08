const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('relay privacy scanner rejects plaintext, binary, encoded values and table inventory omissions',async()=>{
 const {assertNoRelayPlaintext,scanRelayDatabase,RELAY_TABLES}=await import('../scripts/relay-privacy-scan.mjs');
 const marker='UNIQUE-PRIVATE-CONTENT-2437',amount='987654321098';
 for(const value of [{body:marker},{binary:Buffer.from(marker)},{encoded:Buffer.from(marker).toString('base64')},{hex:Buffer.from(marker).toString('hex')},{url:'/?content='+encodeURIComponent(marker)},{amount}])assert.throws(()=>assertNoRelayPlaintext(value,[marker,amount]),/Private fixture content/);
 assertNoRelayPlaintext({ciphertext:Buffer.from('opaque random bytes'),tenant_id:'public-metadata'},[marker,amount]);
 await assert.rejects(scanRelayDatabase({query:async()=>({rows:RELAY_TABLES.slice(0,3).map(tablename=>({tablename}))})},'tenant',[marker]),/Every relay table/);
});
test('authenticated relay gate is mandatory, real Auth is retained and the production route stays default-off',()=>{
 const workflow=fs.readFileSync('.github/workflows/ci.yml','utf8'),script=fs.readFileSync('scripts/test-relay-browser.mjs','utf8'),route=fs.readFileSync('app/api/relay/route.ts','utf8');
 assert.match(workflow,/Required authenticated local-vault privacy gate[\s\S]*RELAY_ENABLED: "true"[\s\S]*node scripts\/test-relay-browser.mjs --auth --browser=chromium/);
 assert.match(script,/signInLocal\(context,page,base/);assert.match(script,/scanRelayDatabase/);assert.match(script,/r\.allHeaders/);assert.match(script,/r\.postDataBuffer/);assert.match(script,/m\.args/);assert.match(script,/length,12/);
 assert.match(route,/process\.env\.RELAY_ENABLED!=='true'/);assert.match(route,/getAppContext\(request\.headers\)/);assert.match(route,/readJsonLimited\(request,96\*1024\)/);
});
