import { createPrivateKey, sign, generateKeyPairSync } from 'node:crypto';
import { RETIRED_API_PATHS } from '../config/http-boundary.mjs';
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Script } from "node:vm";
import { build } from "esbuild";
import JSZip from "jszip";
import net from "node:net";
import { chromium, firefox } from "@playwright/test";
import { signInLocal } from "./vault-test-auth.mjs";
const auth = process.argv.includes("--auth"), full = process.argv.includes("--full"), makeFixture = process.argv.includes("--make-fixture");
const channel = process.argv.find(v => v.startsWith("--browser="))?.split("=")[1] || "chrome";
const base = process.env.VAULT_TEST_URL || "http://127.0.0.1:3100", route = auth ? "/home" : "/lab/vault";
const secret = "synthetic-local-vault-passphrase", marker = "MD-PRIVATE-" + crypto.randomUUID(), numericMarker = "98765.43";
const markers = [marker, numericMarker, "9876543", "98,765.43", secret];
// Independent fixture key: never put the app's issuer private key in any browser bundle.
const fixturePair=generateKeyPairSync('ed25519');
const fixturePublic=fixturePair.publicKey.export({format:'der',type:'spki'}).toString('base64');
const fixturePrivate=fixturePair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
const failures = [], requests = [], headerChecks = [], pageErrors=[],consoleErrors=[];
let dataPlaneActive = false;
// Assert the actual issuer/HMAC secret is absent from every served client asset.
async function checkBundleKeys(dir){for(const item of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await checkBundleKeys(file);else if(/\.(js|json|html)$/.test(item.name)){const text=await readFile(file,'utf8');for(const value of [process.env.LICENCE_SIGNING_KEY,process.env.ACTOR_SIGNING_SECRET].filter(Boolean))assert.ok(!text.includes(value),'A server signing secret was bundled into a served client asset');}}}
await checkBundleKeys('public/spike');await checkBundleKeys('.next/static');

await mkdir("test-results", { recursive: true });
const assetPins=JSON.parse(await readFile('public/spike/assets.json','utf8')).pins;
assert.ok(assetPins?.['duckdb-eh.wasm']&&assetPins?.['vault-ram-worker.js'],'Engine asset integrity pins must exist');
await build({ entryPoints: ["tests/browser/vault-worker.ts"], outfile: "test-results/vault-tests.js", bundle: true, platform: "browser", format: "esm", minify: true,define:{__DUCKDB_ASSET_PINS__:JSON.stringify(assetPins),"process.env.NEXT_PUBLIC_LICENCE_VERIFY_KEY":JSON.stringify(fixturePublic),"process.env.TEST_LICENCE_PRIVATE_KEY":JSON.stringify(fixturePrivate)} });
const testCode = await readFile("test-results/vault-tests.js", "utf8");
const productionWorkerCsp=(await fetch(base+'/spike/vault-worker.js')).headers.get('content-security-policy');
assert.ok(productionWorkerCsp?.includes("connect-src 'self' blob:")&&!productionWorkerCsp.includes("'unsafe-eval'"),'Production worker must support verified WASM blobs under CSP');
const profile = await mkdtemp(path.join(os.tmpdir(), "rebatehq-vault-"));
const browserType = channel === "firefox" ? firefox : chromium;
// Service workers are blocked except in the offline check: Playwright routes (the test-code and quota seams) do not see
// requests a service worker answers.
const browserOptions = { ...(["chromium","firefox"].includes(channel) ? {} : { channel }), headless: true, serviceWorkers: "block", ...(channel === "firefox" ? {firefoxUserPrefs:{"dom.storageManager.prompt.testing":true,"dom.storageManager.prompt.testing.allow":true}} : {}), viewport: { width: 1365, height: 900 } };
let context = await browserType.launchPersistentContext(profile, browserOptions);
const results = { date: new Date().toISOString(), auth, channel, browser: context.browser().version(), machine: { cpu: os.cpus()[0].model, ram: String(os.totalmem()), os: os.type() + " " + os.release() }, checks: {}, measurements: {} };
let quotaActive = false;
async function configureContext() {
// Firefox has no CDP quota/crash APIs. Test-only interception injects a real
// QuotaExceededError at OPFS createWritable, without a production test switch.
if(channel === 'firefox') {
 await context.route('**/spike/vault-worker.js', async route => {
  const response = await route.fetch();
  const seam = `let __quota = ${quotaActive};
addEventListener('message', e => { if(e.data?.__opfsQuotaTest !== undefined) { __quota=e.data.__opfsQuotaTest; e.stopImmediatePropagation(); } });
const __write = FileSystemFileHandle.prototype.createWritable;
FileSystemFileHandle.prototype.createWritable = function(...args) { if(__quota) return Promise.reject(new DOMException('Synthetic capacity exhaustion','QuotaExceededError')); return __write.apply(this,args); };\n`;
  const headers={...response.headers()};delete headers['content-length'];delete headers['content-encoding'];
  await route.fulfill({response,headers,body:seam+await response.text()});
 });
 await context.addInitScript(() => { const RealWorker = Worker; window.__vaultWorkers=[]; window.Worker=class extends RealWorker { constructor(...args) { super(...args); window.__vaultWorkers.push(this); } }; });
}
if(!auth)await context.route('**/api/licence?device=*',async r=>{
 const issued=Math.floor(Date.now()/1000),device=new URL(r.request().url()).searchParams.get('device'),payload=JSON.stringify({v:1,sub:'synthetic-lab-user',workspace:'synthetic-lab-workspace',device,tier:'scale',state:'active',issued,expires:issued+3600,offlineUntil:issued+86400,reason:''});
 const key=createPrivateKey({key:Buffer.from(process.env.LICENCE_SIGNING_KEY,'base64'),format:'der',type:'pkcs8'});
 await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({payload,signature:sign(null,Buffer.from(payload),key).toString('base64')})});
});
await context.route("**/spike/vault-tests.js", r => r.fulfill({ status: 200, contentType: "application/javascript", headers: { "Content-Security-Policy":productionWorkerCsp, "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" }, body: testCode }));
context.on("request", r => {
  headerChecks.push(r.allHeaders().then(headers => {
    const text = [r.url(), JSON.stringify(headers), r.postDataBuffer()?.toString("utf8") || ""].join("\n");
    if (markers.some(m => text.includes(m))) failures.push("Private fixture value appeared in a network request");
  }).catch(() => { failures.push("Could not inspect complete request headers"); }));
  const url = new URL(r.url());
  // 8D: only while the benchmark check has opened the Owner-click phase may /api/bench be called (the check asserts each body).
  if (dataPlaneActive && !(benchOpen && url.origin === new URL(base).origin && url.pathname === "/api/bench") && (![new URL(base).origin, relayOrigin].includes(url.origin) || !["GET", "HEAD"].includes(r.method()) || (url.pathname.startsWith("/api/") && !(url.pathname==="/api/licence"&&r.method()==="GET"&&[...url.searchParams.keys()].every(k=>k==="device")&&!r.postData())))) failures.push("Vault flow made an unexpected external or API request");
  requests.push(new URL(r.url()).pathname);
});
context.on("console", m => {
  if(m.type()==="error")consoleErrors.push(m.text());
  if (markers.some(value => m.text().includes(value))) failures.push("Private fixture value appeared in console output");
  headerChecks.push(Promise.all(m.args().map(arg => arg.jsonValue())).then(values => {
    const text = JSON.stringify(values, (_key, value) => typeof value === "bigint" ? value.toString() : value);
    if (markers.some(value => text.includes(value))) failures.push("Private fixture value appeared in a console argument");
  }).catch(() => { failures.push("Could not inspect console arguments"); }));
});
await context.addInitScript(() => {
 window.__vaultLongTasks = [];
 if(PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => { for(const e of list.getEntries()) window.__vaultLongTasks.push(e.duration); }).observe({type:'longtask',buffered:true});
 else { let last=performance.now(); setInterval(() => { const now=performance.now(); if(now-last>50)window.__vaultLongTasks.push(now-last); last=now; },10); }
});
}
await configureContext();
// VAULT_TEST_CPU_THROTTLE (e.g. 4) slows each page to approximate a small CI runner.
const throttle = Number(process.env.VAULT_TEST_CPU_THROTTLE || 0);
async function openPage() {
  const opened = await context.newPage();
  opened.on("pageerror", e => {failures.push("Unhandled page error");pageErrors.push(e.message);});
  if(throttle > 1 && channel === 'firefox') throw Error('CDP CPU throttling is not available in Firefox');
  if (throttle > 1) await (await context.newCDPSession(opened)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
  return opened;
}
let page = await openPage();
// On failure, record what the user would see. Diagnostics are scrubbed of fixture markers.
async function diagnose() {
  const scrub = text => markers.reduce((value, m) => value.split(m).join("[marker]"), String(text));
  const diagnostics = {pageErrors:pageErrors.map(scrub),consoleErrors:consoleErrors.map(scrub)};
  try { await page.screenshot({ path: `test-results/vault-${channel}${auth ? "-auth" : ""}-failure.png`, fullPage: true }); } catch { diagnostics.screenshot = "unavailable"; }
  try { diagnostics.alerts = (await page.getByRole("alert").allInnerTexts()).map(scrub); diagnostics.status = (await page.getByRole("status").allInnerTexts()).map(scrub); } catch { diagnostics.alerts = "unavailable"; }
  try { diagnostics.buttons = (await page.getByRole("button").allInnerTexts()).map(scrub); } catch { diagnostics.buttons = "unavailable"; }
  try { diagnostics.locks = await page.evaluate(async () => { const q = await navigator.locks.query(); return { held: q.held.map(l => l.mode), pending: q.pending.map(l => l.mode) }; }); } catch { diagnostics.locks = "unavailable"; }
  return diagnostics;
}
async function worker(action, data = {}, deadline = 180000) {
  console.log("Worker gate: "+action);
  return page.evaluate(({ action, data, deadline }) => new Promise((resolve, reject) => {
    const w = new Worker("/spike/vault-tests.js", { type: "module" });
    const timeout = setTimeout(() => { w.terminate(); reject(new Error("Test worker deadline exceeded")); }, deadline);
    w.onmessage = e => { clearTimeout(timeout); w.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result); };
    w.onerror = e => { clearTimeout(timeout); w.terminate(); reject(new Error("Test worker failed: " + e.message)); }; w.postMessage({ action, ...data });
  }), { action, data, deadline });
}
async function ready() { await page.getByRole("button", { name: /Create encrypted vault|Unlock vault/ }).waitFor(); }
async function unlock() { await page.getByLabel("Vault passphrase").fill(secret); await page.getByRole("button", { name: "Unlock vault", exact: true }).click(); await page.getByRole("button", { name: "Lock vault", exact: true }).waitFor({ timeout: 45000 }); }
const header = "line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount\n";
// 19,990 products leaves room under the Starter 20,000-product cap for the multi-format batch.
function csv(rows, first = 1) { const lines = []; for (let i = first; i < first + rows; i++) lines.push(`${i},${i % 19990 + 1},${i % 2000 + 1},2025-01-01,1,${numericMarker},0.50,0.25,0.00,8.00\n`); return Buffer.from(header + lines.join("")); }
// Import Studio flow: add files, review the batch report, optionally confirm.
async function review(paths) {
  await page.getByTestId("studio-files").setInputFiles(paths);
  if(!results.checks.currencyUi){
    const rate=page.getByLabel('Rate to workspace currency',{exact:true});await rate.fill('');await rate.pressSequentially('1.000',{delay:25});
    assert.equal(await rate.inputValue(),'1.000','FX editing disabled the field or dropped typed digits');results.checks.currencyUi=true;
  }
  await page.getByRole("button", { name: "Review import" }).click();
  await page.getByRole("heading", { name: "Batch report" }).waitFor({ timeout: 120000 });
}
async function importFiles(paths, lines, acknowledge = false) {
  await review(paths);
  if (acknowledge) await page.getByTestId("studio-ack").check();
  await page.getByRole("button", { name: "Confirm and import locally" }).click();
  await page.locator(`[data-testid="line-count"][data-value="${lines}"]`).waitFor({ timeout: 120000 });
}
async function clearBatch() { await page.getByRole("button", { name: "Clear batch" }).click(); await page.getByRole("heading", { name: "Batch report" }).waitFor({ state: "detached" }); }

/** "$1,234.56" or "-CA$0.05" (en) to exact cents, without floating point. */
const centsOf=text=>{const t=text.trim(),neg=t.startsWith('-')||t.startsWith('\u2212'),[i,f='']=t.replace(/[^0-9.]/g,'').split('.');return String((neg?-1n:1n)*BigInt((i||'0')+f.padEnd(2,'0').slice(0,2)));};
const intOf=text=>text.replace(/[^0-9-]/g,'');
async function gridColumn(grid,n){return grid.locator('tbody tr td:nth-child('+n+')').allInnerTexts();}
async function until(test,message,ms=30000){const end=Date.now()+ms;for(;;){if(await test())return;if(Date.now()>end)throw new Error(message);await new Promise(r=>setTimeout(r,200));}}
const ordered=(values,dir)=>values.every((v,i)=>i===0||(dir==='asc'?BigInt(values[i-1])<=BigInt(v):BigInt(values[i-1])>=BigInt(v)));
async function rebatesUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-rebates-')),browserOptions);await configureContext();page=await openPage();
 try{
  dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();
  await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic rebate owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
  await page.locator('nav a[href="#settings"]').click();await page.locator('section[aria-labelledby="currency-heading"] select').selectOption('CAD');await page.getByRole('button',{name:'Save currency',exact:true}).click();await page.getByText('Current currency: CAD',{exact:true}).waitFor();
  const customer=marker+'-RC',sku=marker+'-RP',ref=marker+'-NORTH';
  const sales=Buffer.from('line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount\n1,'+sku+','+customer+',2026-03-31,1,29500.00,0,0,350.00,10000.00\n');
  const agreement=Buffer.from('program_id,party,rate_percent,threshold_amount,period_start,period_end,calculation_mode,to_amount,eligible_skus,excluded_skus,party_type,rebate_treatment\n'+ref+','+customer+',2,0,2026-01-01,2026-03-31,retroactive,,,,customer,replace\n');
  await page.locator('nav a[href="#data-hub"]').click();await importFiles([{name:'synthetic-customer-rebate-agreement.csv',mimeType:'text/csv',buffer:agreement},{name:'synthetic-rebate-sales.csv',mimeType:'text/csv',buffer:sales}],'1',true);
  await page.locator('nav a[href="#rebates"]').click();const progress=page.getByTestId('rebate-progress');await page.getByTestId('rebate-earned').filter({hasText:'CA$590.00'}).waitFor();assert.ok((await progress.innerText()).includes('CA$29,500.00'),'Rebate spend lost CAD denomination');assert.ok((await progress.innerText()).includes('CA$240.00'),'Adjustment differs');
  const rebateGrid=page.getByTestId('rebate-table');await rebateGrid.getByTestId('grid-select-all').check();const earnedTotal=rebateGrid.getByTestId('grid-total-earned');await earnedTotal.waitFor();assert.equal(await earnedTotal.getAttribute('data-sum'),'59000','Rebate selection total differs from the earned amount');assert.ok((await earnedTotal.innerText()).includes('CA$590.00'),'Rebate selection total lost its currency');await rebateGrid.getByRole('button',{name:'Clear selection',exact:true}).click();
  await progress.getByRole('button',{name:'Show the math',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('cell',{name:'CA$350.00',exact:true}).waitFor();assert.equal(await dialog.getByRole('cell',{name:'CA$590.00',exact:true}).count(),2);await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('nav a[href="#margin"]').click();await page.getByTestId('wf-rebate').filter({hasText:'-CA$590.00'}).waitFor();await page.getByTestId('wf-rebate').click();await page.getByTestId('math-value').filter({hasText:'CA$590.00'}).waitFor();await page.getByRole('dialog').getByText('CA$350.00',{exact:false}).waitFor();
  await page.locator('nav a[href="#rebates"]').click();await page.getByTestId('rebate-reference').fill(marker+'-MANUAL');await page.getByTestId('rebate-customer').fill(marker+'-OTHER');await page.getByTestId('rebate-confirm').check();await page.getByRole('button',{name:'Save approved terms',exact:true}).click();await page.getByTestId('rebate-program-row').filter({hasText:marker+'-MANUAL'}).waitFor();const row=page.getByTestId('rebate-program-row').filter({hasText:marker+'-MANUAL'});await row.getByRole('button',{name:'Edit terms',exact:true}).click();await page.getByLabel('Program active',{exact:true}).uncheck();await page.getByTestId('rebate-confirm').check();await page.getByRole('button',{name:'Save approved terms',exact:true}).click();await row.getByText('Paused',{exact:true}).waitFor();await row.getByRole('button',{name:'Remove manual program',exact:true}).click();await row.waitFor({state:'detached'});
  for(const theme of ['light','dark','contrast']){await page.evaluate(v=>{document.documentElement.dataset.theme=v;},theme);await page.setViewportSize({width:375,height:812});await page.waitForTimeout(400);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Rebates overflow at 375px');await page.screenshot({path:'test-results/rebates-'+channel+'-'+theme+'.png',fullPage:true});}await page.setViewportSize({width:1280,height:800});
  await page.locator('nav a[href="#settings"]').click();await page.getByLabel('Preview as').selectOption('sales_rep');await page.getByTestId('preview-banner').waitFor();await page.locator('nav a[href="#rebates"]').click();await page.getByTestId('rebate-earned').filter({hasText:'CA$590.00'}).waitFor();assert.equal(await page.getByTestId('rebate-form').count(),0);assert.equal(await page.getByRole('button',{name:'Show the math',exact:true}).count(),0);assert.ok(!/cost|margin/i.test(await progress.innerText()),'Rep UI exposed margin or cost');await page.getByRole('button',{name:'Return to my own view'}).click();
  await page.evaluate(()=>localStorage.setItem('rebatehq.locale','pseudo'));await page.reload();await page.locator('form input[type="password"]').fill(secret);await page.locator('form:has(input[type="password"]) button').click();await page.getByTestId('line-count').waitFor();await page.evaluate(()=>{location.hash='#rebates';});await page.getByTestId('rebate-program-row').waitFor();assert.ok((await progress.innerText()).includes('⟦'));assert.ok((await page.getByTestId('rebate-form').innerText()).includes('⟦'));
  results.checks.rebatesUi={gridTotalsInCad:true,cadAmount:'CA$590.00',cadSpend:'CA$29,500.00',cadAdjustment:'CA$240.00',sourceMath:true,manualCrud:true,repProgressOnly:true,encryptedReload:true,pseudo:true,themes:true,phone375:true};
 }finally{await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}


// 7E-1 Vendors: price review of a supplier cost sheet and purchase price variance, in CAD, in a fresh vault
// under the same request/console marker sensors.
async function vendorsUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-vendors-')),browserOptions);await configureContext();page=await openPage();
 try{
 dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic vendor owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
 await page.locator('nav a[href="#settings"]').click();await page.locator('section[aria-labelledby="currency-heading"] select').selectOption('CAD');await page.getByRole('button',{name:'Save currency',exact:true}).click();await page.getByText('Current currency: CAD',{exact:true}).waitFor();
 const sku=marker+'-VALVE',vendor=marker+'-MILLS',unknown=marker+'-NOT-IN-ITEMS';
 const batch=async files=>{await page.locator('nav a[href="#data-hub"]').click();await review(files);await page.getByRole('button',{name:'Confirm and import locally',exact:true}).click();await page.getByRole('heading',{name:'Batch report'}).waitFor({state:'detached'});};
 await batch([
  {name:'synthetic-items.csv',mimeType:'text/csv',buffer:Buffer.from('product_id,description,category,uom,current_cost,list_price\n'+sku+',Synthetic valve,Valves,EA,60.00,100.00\n')},
  {name:'synthetic-sales.csv',mimeType:'text/csv',buffer:Buffer.from('line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount\n1,'+sku+','+marker+'-CUST,2026-03-01,4,400.00,0,0,0,240.00\n')},
  {name:'synthetic-costs-jan.csv',mimeType:'text/csv',buffer:Buffer.from('vendor,product_id,cost,effective_date\n'+vendor+','+sku+',50.00,2026-01-01\n')},
  {name:'synthetic-po.csv',mimeType:'text/csv',buffer:Buffer.from('line_id,receipt_ref,supplier,product_id,receipt_date,quantity,purchase_amount,entry_kind,uom\n1,PO1,'+vendor+','+sku+',2026-02-01,10,500.00,receipt,EA\n2,PO2,'+marker+'-OTHER,'+sku+',2026-02-10,10,800.00,receipt,EA\n')}]);
 await batch([{name:'synthetic-costs-mar.csv',mimeType:'text/csv',buffer:Buffer.from('vendor,product_id,cost,effective_date\n'+vendor+','+sku+',55.00,2026-03-01\n'+vendor+','+unknown+',9.00,2026-03-01\n')}]);
 await page.locator('nav a[href="#vendors"]').click();const reviewGrid=page.getByTestId('vendor-review-grid');await reviewGrid.waitFor({timeout:60000});
 assert.ok((await page.getByTestId('vendor-sheet').locator('option:checked').innerText()).includes('synthetic-costs-mar.csv'),'The newest supplier sheet is not reviewed first');
 // 50.00 to 55.00 = +5.00 (+10.00%); 4 units sold in the window: margin effect -20.00 (CAD). The unknown SKU is a line to check.
 const row=reviewGrid.locator('tbody tr').filter({hasText:sku});await row.getByText('Increase',{exact:true}).waitFor();assert.ok((await row.innerText()).includes('CA$5.00')&&(await row.innerText()).includes('10.00'),'Review row lost the exact change or its currency');
 assert.equal(await page.getByTestId('vendor-impact').getAttribute('data-value'),'-2000');assert.ok((await page.getByTestId('vendor-impact').innerText()).includes('CA$'),'Margin effect lost its currency');
 assert.equal(await page.getByTestId('vendor-conflicts').innerText(),'1');await reviewGrid.locator('tbody tr').filter({hasText:unknown}).getByText('Not in item master',{exact:true}).waitFor();
 await page.getByTestId('vendor-quotes').waitFor();
 await page.getByTestId('vendor-tab-ppv').click();const ppvGrid=page.getByTestId('ppv-grid');await ppvGrid.waitFor({timeout:60000});
 // Receipts: 10 @ 50.00 and 10 @ 80.00 from two suppliers; standard 60.00: variance 1,300.00 - 1,200.00 = +100.00.
 assert.equal(await page.getByTestId('ppv-total').getAttribute('data-value'),'10000');const ppvRow=ppvGrid.locator('tbody tr').filter({hasText:sku});
 for(const text of ['CA$50.00','CA$80.00','CA$65.00','CA$100.00'])await ppvRow.getByText(text,{exact:true}).first().waitFor();
 await ppvGrid.getByTestId('grid-select-all').check();const varianceTotal=ppvGrid.getByTestId('grid-total-variance');await varianceTotal.waitFor();assert.equal(await varianceTotal.getAttribute('data-sum'),'10000');assert.ok((await varianceTotal.innerText()).includes('CA$100.00'),'Variance total lost its currency');
 await ppvRow.getByTestId('ppv-show-lines').click();const lines=page.getByTestId('ppv-lines-grid');await lines.waitFor();assert.equal(await lines.locator('tbody tr').count(),2);
 await page.setViewportSize({width:375,height:812});for(const tab of ['review','ppv']){await page.getByTestId('vendor-tab-'+tab).click();await page.waitForTimeout(400);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Vendors page overflows a phone');}await page.screenshot({path:'test-results/vendors-'+channel+'.png',fullPage:true});await page.setViewportSize({width:1280,height:800});
 await page.locator('nav a[href="#settings"]').click();await page.getByLabel('Preview as').selectOption('sales_rep');await page.getByTestId('preview-banner').waitFor();assert.equal(await page.locator('nav a[href="#vendors"]').count(),0,'A Sales Rep sees the Vendors section');await page.getByRole('button',{name:'Return to my own view'}).click();
 results.checks.vendorsUi={currency:'CAD',reviewChange:true,marginEffect:true,unknownSkuFlagged:true,ppvVariance:true,ppvGridTotals:true,ppvLines:true,phone375:true,repHidden:true,privacyMarkers:true};
 }catch(error){console.error('Vendor UI diagnostics:',JSON.stringify(await diagnose()));throw error;}finally{await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}
// 7E-2 historical scenario simulator (Scale licence in the lab and CI): replay two months with +10% price, in CAD,
// in a fresh vault under the same request/console marker sensors.
async function simUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-sim-')),browserOptions);await configureContext();page=await openPage();
 try{
 dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic simulator owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
 await page.locator('nav a[href="#settings"]').click();await page.locator('section[aria-labelledby="currency-heading"] select').selectOption('CAD');await page.getByRole('button',{name:'Save currency',exact:true}).click();await page.getByText('Current currency: CAD',{exact:true}).waitFor();
 const sku=marker+'-SIMVALVE',customer=marker+'-SIMCUST';
 await page.locator('nav a[href="#data-hub"]').click();await review([
  {name:'synthetic-items.csv',mimeType:'text/csv',buffer:Buffer.from('product_id,description,category,uom,current_cost,list_price\n'+sku+',Synthetic valve,Valves,EA,60.00,100.00\n')},
  {name:'synthetic-sales.csv',mimeType:'text/csv',buffer:Buffer.from('line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount\n1,'+sku+','+customer+',2026-03-01,4,400.00,0,0,0,240.00\n2,'+sku+','+customer+',2026-04-10,1,100.00,10.00,0,0,60.00\n')}]);
 await page.getByRole('button',{name:'Confirm and import locally',exact:true}).click();await page.getByRole('heading',{name:'Batch report'}).waitFor({state:'detached'});
 await page.locator('nav a[href="#vendors"]').click();await page.getByTestId('vendor-tab-sim').click();await page.getByTestId('sim-run').waitFor({timeout:60000});
 await page.getByTestId('sim-from').fill('2026-03');await page.getByTestId('sim-to').fill('2026-04');await page.getByTestId('sim-pct').fill('10');await page.getByTestId('sim-run').click();
 // +10% price: line 1 list 400.00→440.00 (margin 160.00→200.00); line 2 list 100.00→110.00, discount 10.00→11.00 (margin 30.00→39.00). Change +49.00 CAD.
 const change=page.getByTestId('sim-margin-change');await change.waitFor({timeout:60000});
 assert.equal(await change.getAttribute('data-value'),'4900');assert.ok((await change.innerText()).includes('CA$49.00'),'Margin change lost its currency');
 assert.equal(await page.getByTestId('sim-scenario-margin').getAttribute('data-value'),'23900');assert.equal(await page.getByTestId('sim-actual-margin').getAttribute('data-value'),'19000');assert.equal(await page.getByTestId('sim-lines').innerText(),'2');
 await page.getByTestId('sim-dim').selectOption('month');const grid=page.getByTestId('sim-grid');await grid.locator('tbody tr').filter({hasText:'2026-04'}).waitFor();assert.equal(await grid.locator('tbody tr').count(),2);
 await grid.getByTestId('grid-select-all').check();const total=grid.getByTestId('grid-total-margin_change');await total.waitFor();assert.equal(await total.getAttribute('data-sum'),'4900');assert.ok((await total.innerText()).includes('CA$49.00'),'Breakdown total lost its currency');
 // The run survives a tab switch while the data is unchanged.
 await page.getByTestId('vendor-tab-ppv').click();await page.getByTestId('vendor-tab-sim').click();await change.waitFor();assert.equal(await change.getAttribute('data-value'),'4900');assert.equal(await page.getByTestId('sim-pct').inputValue(),'10','The restored run lost its changes');
 await page.setViewportSize({width:375,height:812});await page.waitForTimeout(400);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Simulator overflows a phone');await page.screenshot({path:'test-results/simulator-'+channel+'.png',fullPage:true});await page.setViewportSize({width:1280,height:800});
 await page.locator('nav a[href="#settings"]').click();await page.getByLabel('Preview as').selectOption('accountant');await page.getByTestId('preview-banner').waitFor();await page.locator('nav a[href="#vendors"]').click();await page.getByTestId('vendor-tab-review').waitFor();assert.equal(await page.getByTestId('vendor-tab-sim').count(),0,'An Accountant sees the simulator');
 await page.locator('nav a[href="#settings"]').click();await page.getByRole('button',{name:'Return to my own view'}).click();
 results.checks.simUi={currency:'CAD',marginChange:true,scenarioMargin:true,breakdownTotals:true,keptAcrossTabs:true,phone375:true,nonPricingHidden:true,privacyMarkers:true};
 }catch(error){console.error('Simulator UI diagnostics:',JSON.stringify(await diagnose()));throw error;}finally{await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}
// 7F-2: the converters in the real Import Studio (fresh vault, under the request/console marker sensors): a fixed-width
// print report with the column ruler, a wrong boundary corrected by hand and detected again, a recipe; a PDF price list
// (pdf.js chunk loaded on demand) and a Parquet customer list (DuckDB with the pinned extension); then folder re-import
// through the picker seam (an OPFS folder stands in for the native picker, which automation cannot drive).
let parquetFixture=null;
async function converterFixtures(){
 const out=await build({entryPoints:['tests/helpers/converter-fixtures.ts'],bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
async function convertersUi(){
 if(!parquetFixture){if(!page.url().startsWith(base)){await page.goto(base+route);await ready();}const r=await worker('converters',{},240000);results.checks.converters={...r,parquetBytes:undefined};parquetFixture=Buffer.from(r.parquetBytes,'base64');}
 const {printReport,priceListPdf}=await converterFixtures();
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-converters-')),browserOptions);await configureContext();
 await context.addInitScript(()=>{window.showDirectoryPicker=async()=>await(await navigator.storage.getDirectory()).getDirectoryHandle('rebatehq-import-seam',{create:true});});
 page=await openPage();
 try{
 dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic converter owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
 // Short customer IDs fit the report's fixed columns; the privacy marker travels in the saved recipe's name.
 const c1='CV-1',c2='CV-2',recipeName='Print sales '+marker;
 const sales=printReport([['1','P-100',c1,'2026-01-05','2','200.00','120.00'],['2','P-200',c2,'2026-01-06','10','1250.50','900.00'],['3','P-100',c1,'2026-01-07','1','100.00','60.00']]);
 await page.locator('nav a[href="#data-hub"]').click();
 await page.getByTestId('studio-files').setInputFiles([{name:'sales.prn',mimeType:'text/plain',buffer:Buffer.from(sales)}]);
 const boundaries=page.getByTestId('studio-boundaries');await boundaries.waitFor({timeout:60000});
 assert.equal(await page.getByTestId('studio-layout').inputValue(),'fixed','A print report was not read as fixed width');
 assert.equal(await boundaries.inputValue(),'8, 20, 33, 45, 55, 68');
 assert.ok((await page.getByLabel('First lines of the file with a position ruler and the column starts').innerText()).includes('line_id  product_id'),'The ruler lost the raw lines');
 // A missing boundary merges two columns in the preview; "Detect again" restores them.
 await boundaries.fill('8, 20, 33, 55, 68');await page.getByTestId('studio-boundaries-apply').click();
 await page.locator('table td').filter({hasText:/^sale_date\s+quantity$/}).first().waitFor();
 await page.getByTestId('studio-boundaries-detect').click();await page.waitForFunction(()=>document.querySelector('[data-testid="studio-boundaries"]')?.value==='8, 20, 33, 45, 55, 68');
 await page.getByTestId('studio-columns').screenshot({path:'test-results/converters-columns-'+channel+'.png'});
 await page.getByText('I checked this mapping',{exact:false}).first().click();
 await page.getByLabel('Recipe name (ERP or supplier)').fill(recipeName);await page.getByRole('button',{name:'Save as recipe',exact:true}).click();await page.getByText(/Saved recipes: .*Print sales/).waitFor();
 // A PDF price list and a Parquet customer list in the same batch.
 const pdf=priceListPdf([['P-100','Brass valve 1/2 in','12.50','20.00'],['P-200','Steel pipe','8.00','13.25']]);
 await page.getByTestId('studio-files').setInputFiles([{name:'prices.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf)},{name:'customers.parquet',mimeType:'application/octet-stream',buffer:parquetFixture}]);
 await page.getByText('2 rows and 3 columns read with DuckDB on this device.',{exact:false}).first().waitFor({timeout:60000});
 await page.getByRole('row').filter({hasText:'prices.pdf'}).getByRole('button',{name:'Preview and fix'}).click();
 await page.getByText('2 pages read, 7 lines of text',{exact:false}).first().waitFor({timeout:60000});assert.equal(await page.getByTestId('studio-layout').count(),0,'A PDF offers a delimiter layout');await page.getByTestId('studio-boundaries').waitFor();
 await page.setViewportSize({width:375,height:812});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Import Studio overflows a phone with the column ruler');await page.setViewportSize({width:1280,height:800});
 await page.getByRole('button',{name:'Review import',exact:true}).click();await page.getByRole('heading',{name:'Batch report'}).waitFor({timeout:120000});
 if(await page.getByTestId('studio-ack').count())await page.getByTestId('studio-ack').check();
 await page.getByRole('button',{name:'Confirm and import locally',exact:true}).click();await page.locator('[data-testid="line-count"][data-value="3"]').waitFor({timeout:120000});
 // Folder re-import: next month's report in the remembered folder is added with the saved recipe; files of other types
 // (notes.docx) are never read.
 const feb=printReport([['4','P-200',c2,'2026-02-05','3','15.00','9.30'],['5','P-100',c1,'2026-02-06','1','20.00','12.50']]);
 await page.evaluate(async files=>{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('rebatehq-import-seam',{create:true});for(const [name,text] of files){const w=await(await dir.getFileHandle(name,{create:true})).createWritable();await w.write(text);await w.close();}},[['february.prn',feb],['notes.docx','not a report']]);
 await page.getByTestId('folder-choose').click();await page.getByText('Import folder set to rebatehq-import-seam.',{exact:false}).first().waitFor();
 await page.getByTestId('folder-reimport-run').click();await page.getByText('1 file added to the batch with its saved recipe; 0 left out.',{exact:false}).first().waitFor({timeout:60000});
 await page.getByText('Recipe "Print sales" was applied',{exact:false}).first().waitFor().catch(()=>undefined);
 await page.getByRole('button',{name:'Review import',exact:true}).click();await page.getByRole('heading',{name:'Batch report'}).waitFor({timeout:120000});
 if(await page.getByTestId('studio-ack').count())await page.getByTestId('studio-ack').check();
 await page.getByRole('button',{name:'Confirm and import locally',exact:true}).click();await page.locator('[data-testid="line-count"][data-value="5"]').waitFor({timeout:120000});
 // Re-importing the same folder again adds nothing: the file is already imported, unchanged.
 await page.getByTestId('folder-reimport-run').click();await page.getByText('0 files added to the batch with their saved recipes; 1 left out.',{exact:false}).first().waitFor({timeout:60000});
 results.checks.convertersUi={fixedWidthRuler:true,manualBoundaries:true,detectAgain:true,recipe:true,pdfTable:true,parquetDuckdb:true,exactLines:true,folderReimport:true,alreadyImportedSkipped:true,phone375:true,privacyMarkers:true};
 }catch(error){console.error('Converters UI diagnostics:',JSON.stringify(await diagnose()));throw error;}finally{await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}
// 8A: explainable deal guidance and cross-sell in Quote Desk (fresh vault, under the request/console marker sensors),
// the Sales Rep preview (guidance shown, no margin), and the v2.6 relay onboarding card where the relay is available.
async function guidanceUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-guidance-')),browserOptions);await configureContext();page=await openPage();
 try{
 dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic guidance owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
 // v2.6 gap 2: the relay set-up card appears only where the relay answers and this device has no key; "Not now" is remembered.
 await page.waitForTimeout(1500);let relayOnboarding='relay-unavailable';
 if(await page.getByTestId('relay-onboarding').count()){await page.getByTestId('relay-onboarding-dismiss').click();await page.getByTestId('relay-onboarding').waitFor({state:'detached'});await page.locator('nav a[href="#settings"]').click();await page.locator('nav a[href="#home"]').click();await page.waitForTimeout(1000);assert.equal(await page.getByTestId('relay-onboarding').count(),0,'The dismissed relay card came back');relayOnboarding='dismissed-and-remembered';}
 const a=marker+'-GA',b=marker+'-GB',c=marker+'-GC',g1=marker+'-G1',g2=marker+'-G2',g3=marker+'-G3';
 // G1 bought A twice at 97.00 a unit (history median 9,700). A and B are on three invoices together; with seven invoices
 // in all (A on 5, B on 3) the lift of A -> B is 3 x 7 / (5 x 3) = 1.40 and confidence 3 / 5 = 60.00%.
 const s=(n,p,cu,d,q,l,inv)=>[n,p,cu,d,q,l,'0','0','0','',inv].join(',');
 await page.locator('nav a[href="#data-hub"]').click();await importFiles([
  {name:'guidance-items.csv',mimeType:'text/csv',buffer:Buffer.from('product_id,description,category,uom,current_cost,list_price\n'+a+',Synthetic valve,Valves,EA,60.00,110.00\n'+b+',Synthetic gasket,Valves,EA,1.00,5.00\n'+c+',Synthetic tape,Misc,EA,0.10,1.00\n')},
  {name:'guidance-customers.csv',mimeType:'text/csv',buffer:Buffer.from('customer_id,name,tier\n'+g1+',Guide one,T1\n'+g2+',Guide two,T1\n'+g3+',Guide three,T1\n')},
  {name:'guidance-sales.csv',mimeType:'text/csv',buffer:Buffer.from('line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount,invoice_id\n'+[
   s(1,a,g1,'2026-09-01',1,'97.00','H1'),s(2,a,g1,'2026-10-01',2,'194.00','H2'),s(3,a,g2,'2026-10-02',1,'105.00','X1'),s(4,b,g2,'2026-10-02',1,'5.00','X1'),
   s(5,a,g2,'2026-10-03',1,'105.00','X2'),s(6,b,g2,'2026-10-03',1,'5.00','X2'),s(7,a,g3,'2026-10-04',1,'106.00','X3'),s(8,b,g3,'2026-10-04',1,'5.00','X3'),
   s(9,c,g2,'2026-10-05',1,'1.00','Y1'),s(10,c,g3,'2026-10-06',1,'1.00','Y2')].join('\n')+'\n')}],'10');
 await page.locator('nav a[href="#pricing"]').click();for(const [label,value]of Object.entries({'Customer tier':'T1','Product category':'Valves','Start price (cents)':'12000','Target price (cents)':'10000','Floor price (cents)':'8000'}))await page.getByLabel(label,{exact:true}).fill(value);await page.getByRole('button',{name:'Save guardrails',exact:true}).click();await page.getByRole('status').filter({hasText:'Guardrails saved.'}).waitFor();
 const quoteFor=async()=>{await page.locator('nav a[href="#quotes"]').click();await page.getByRole('button',{name:'Quote',exact:true}).click();await page.getByTestId('quote-customer').fill(g1);await page.getByTestId('quote-customer').press('Enter');await page.getByTestId('add-sku').fill(a);await page.getByTestId('add-sku').press('Enter');await page.getByTestId('quote-total').filter({hasText:'$110.00'}).waitFor();};
 await quoteFor();
 const guide=page.getByTestId('guidance-1');await guide.waitFor({timeout:60000});
 assert.equal(await guide.getAttribute('data-suggested'),'9700');assert.equal(await guide.getAttribute('data-basis'),'history');
 await guide.getByText('Why',{exact:true}).click();await guide.getByText(/2 recent sales to this customer: median \$97\.00/).waitFor();await guide.getByText(/Target price \$100\.00; floor \$80\.00\./).waitFor();
 await page.getByTestId('guidance-use-1').click();await page.getByTestId('quote-total').filter({hasText:'$97.00'}).waitFor();assert.equal(await page.getByTestId('price-1').inputValue(),'97.00');
 const cross=page.getByTestId('cross-sell-grid');await cross.waitFor({timeout:60000});const row=cross.locator('tbody tr').filter({hasText:b});await row.waitFor();assert.ok((await row.innerText()).includes('60'),'Cross-sell confidence missing');
 await page.getByTestId('cross-add-'+b).click();await page.getByTestId('quote-lines').locator('tbody tr').nth(1).waitFor();assert.equal(await page.getByTestId('quote-lines').locator('tbody tr').count(),2);
 await page.setViewportSize({width:375,height:812});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Quote Desk overflows a phone with guidance');await page.setViewportSize({width:1280,height:800});
 // A Sales Rep sees the suggested price and its reasons, never margin.
 await page.locator('nav a[href="#settings"]').click();await page.getByLabel('Preview as').selectOption('sales_rep');await page.getByTestId('preview-banner').waitFor();
 await quoteFor();await page.getByTestId('guidance-1').waitFor({timeout:60000});assert.equal(await page.getByTestId('guidance-1').getAttribute('data-suggested'),'9700');assert.equal(await page.getByTestId('quote-margin').count(),0,'A Sales Rep sees quote margin');
 await page.getByTestId('preview-banner').getByRole('button',{name:'Return to my own view'}).click();await page.getByTestId('preview-banner').waitFor({state:'detached'});
 results.checks.guidanceUi={suggestion9700:true,reasons:true,useSuggestion:true,crossSellLift:true,addFromCrossSell:true,repSeesGuidanceNoMargin:true,phone375:true,relayOnboarding,privacyMarkers:true};
 }catch(error){console.error('Guidance UI diagnostics:',JSON.stringify(await diagnose()));throw error;}finally{await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}
// 8B-1: Margin Drain agents on Home and cost index triggers (fresh vault, under the request/console marker sensors).
// A freight leak of $30.00 becomes an inbox finding once the leak threshold is lowered to $1.00; a copper index read
// from a Data Hub file (100 -> 106.5 = +6.50%) fires a 5% trigger with a 50% share, so the expected cost change is
// +3.25% and a $60.00 SKU is expected at $61.95. A Sales Rep sees neither the agents nor Vendors.
async function agentsUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-agents-')),browserOptions);await configureContext();page=await openPage();
 try{
 dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic agents owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
 const sku=marker+'-AGWIRE',other=marker+'-AGVALVE',customer=marker+'-AGCUST',series='Copper '+marker;
 await page.locator('nav a[href="#data-hub"]').click();await importFiles([
  {name:'agents-items.csv',mimeType:'text/csv',buffer:Buffer.from('product_id,description,category,uom,current_cost,list_price\n'+sku+',Synthetic wire,Wire,EA,60.00,100.00\n'+other+',Synthetic valve,Valves,EA,20.00,40.00\n')},
  {name:'agents-customers.csv',mimeType:'text/csv',buffer:Buffer.from('customer_id,name,tier\n'+customer+',Synthetic,T1\n')},
  {name:'agents-sales.csv',mimeType:'text/csv',buffer:Buffer.from('line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount,invoice_id\n1,'+sku+','+customer+',2026-10-02,1,100.00,0,30.00,0,60.00,AG1\n')},
  {name:'copper-index.csv',mimeType:'text/csv',buffer:Buffer.from('index_name,period_date,index_value\n'+series+',2026-01-01,100\n'+series+',2026-06-01,103.25\n'+series+',2026-10-01,106.5\n')}],'1');
 // Home: the card says checks run only while the app is open; the first check runs at opening.
 await page.locator('nav a[href="#home"]').click();const card=page.getByTestId('agents');await card.waitFor({timeout:60000});
 assert.ok((await card.innerText()).includes('open'),'The agents card does not say checks run only while the app is open');
 await page.getByTestId('agents-settings').click();await page.getByLabel('Leaks of at least (amount)',{exact:true}).fill('1.00');await page.getByTestId('agents-settings-save').click();await page.getByTestId('agents-settings-form').waitFor({state:'detached'});
 await page.getByTestId('agents-run').click();await page.getByTestId('agents-last-checked').filter({hasText:'run by hand'}).waitFor({timeout:60000});
 const inbox=page.getByTestId('agents-inbox');const leak=inbox.locator('tbody tr[data-rule="leak"]');await leak.first().waitFor({timeout:60000});
 assert.ok((await leak.first().innerText()).includes('$30.00'),'The freight leak finding lost its amount');
 // Vendors > Cost index: the series read from the file, a trigger and the SKUs it covers.
 await page.locator('nav a[href="#vendors"]').click();await page.getByTestId('vendor-tab-index').click();const seriesGrid=page.getByTestId('index-series-grid');await seriesGrid.locator('tbody tr').filter({hasText:series}).waitFor({timeout:60000});
 assert.ok((await seriesGrid.locator('tbody tr').filter({hasText:series}).innerText()).includes('3'),'The index series lost its points');
 await page.getByTestId('index-new').click();await page.getByTestId('index-name').fill('Copper wire '+marker);await page.getByTestId('index-series-select').selectOption(series);await page.getByTestId('index-value').fill('Wire');await page.getByTestId('index-base').fill('2026-01-01');await page.getByTestId('index-threshold').fill('5');await page.getByTestId('index-pass').fill('50');await page.getByTestId('index-save').click();
 const trig=page.getByTestId('index-triggers-grid').locator('tbody tr').filter({hasText:'Copper wire'});await trig.waitFor({timeout:60000});
 assert.equal(await trig.getAttribute('data-status'),'triggered');assert.equal(await trig.getAttribute('data-cost-bp'),'325');
 await trig.getByTestId('index-show-skus').click();const skuRow=page.getByTestId('index-skus-grid').locator('tbody tr').filter({hasText:sku});await skuRow.waitFor({timeout:60000});
 assert.ok((await skuRow.innerText()).includes('$61.95'),'Expected cost is not $61.95');assert.equal(await page.getByTestId('index-skus-grid').locator('tbody tr').filter({hasText:other}).count(),0,'A SKU outside the category is covered');
 await page.setViewportSize({width:375,height:812});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Cost index overflows a phone');await page.setViewportSize({width:1280,height:800});
 // The next check adds the trigger to the inbox; marking the leak read keeps it in the default view.
 await page.locator('nav a[href="#home"]').click();await page.getByTestId('agents-run').click();await inbox.locator('tbody tr[data-rule="index_trigger"]').waitFor({timeout:60000});
 assert.equal(await page.getByTestId('agents-new').innerText(),'2');
 await leak.first().getByTestId('agents-mark-read').click();await inbox.locator('tbody tr[data-rule="leak"][data-status="read"]').waitFor();assert.equal(await page.getByTestId('agents-new').innerText(),'1');
 await page.setViewportSize({width:375,height:812});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The agents card overflows a phone');await page.screenshot({path:'test-results/agents-'+channel+'.png',fullPage:true});await page.setViewportSize({width:1280,height:800});
 // A Sales Rep sees no agents card and no Vendors.
 await page.locator('nav a[href="#settings"]').click();await page.getByLabel('Preview as').selectOption('sales_rep');await page.getByTestId('preview-banner').waitFor();await page.locator('nav a[href="#home"]').click();await page.waitForTimeout(800);
 assert.equal(await page.getByTestId('agents').count(),0,'A Sales Rep sees the agents');assert.equal(await page.locator('nav a[href="#vendors"]').count(),0,'A Sales Rep sees Vendors');
 await page.getByTestId('preview-banner').getByRole('button',{name:'Return to my own view'}).click();await page.getByTestId('preview-banner').waitFor({state:'detached'});
 results.checks.agentsUi={leakAtThreshold:true,manualCheck:true,indexFromFile:true,trigger325bp:true,expectedCost6195:true,inboxTrigger:true,markRead:true,phone375:true,repHidden:true,privacyMarkers:true};
 }catch(error){console.error('Agents UI diagnostics:',JSON.stringify(await diagnose()));throw error;}finally{await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}
// 8B-2: the dead-stock clearance optimiser (fresh vault, under the request/console marker sensors). Dates are relative to
// today so CI on any day gives the same figures. D1 last sold 200 days ago with 10 on hand at $60.00 and a $100.00 list
// price; with 12% cost of capital, $0.05 storage and a 6-month horizon: capital $600.00, carrying $6.50 a month, clearance
// price $96.10. A1 sold 10 days ago in the same category and unit, so it is D1's substitute and not dead itself. The draft
// is approved by the Pricing Owner through the normal path. A Sales Rep sees no Vendors.
async function deadStockUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-dead-')),browserOptions);await configureContext();page=await openPage();
 try{
 dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic dead-stock owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
 const d1=marker+'-DEAD',a1=marker+'-LIVE',customer=marker+'-DC',ago=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
 await page.locator('nav a[href="#data-hub"]').click();await importFiles([
  {name:'dead-items.csv',mimeType:'text/csv',buffer:Buffer.from('product_id,description,category,uom,current_cost,list_price\n'+d1+',Synthetic slow valve,Valves,EA,60.00,100.00\n'+a1+',Synthetic fast valve,Valves,EA,50.00,90.00\n')},
  {name:'dead-customers.csv',mimeType:'text/csv',buffer:Buffer.from('customer_id,name,tier\n'+customer+',Synthetic,T1\n')},
  {name:'dead-sales.csv',mimeType:'text/csv',buffer:Buffer.from('line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount,invoice_id\n1,'+d1+','+customer+','+ago(200)+',1,100.00,0,0,0,60.00,DS1\n2,'+a1+','+customer+','+ago(10)+',3,270.00,0,0,0,150.00,DS2\n')},
  {name:'stock-on-hand.csv',mimeType:'text/csv',buffer:Buffer.from('product_id,location,on_hand\n'+d1+',North,4\n'+d1+',South,6\n'+a1+',North,5\n')}],'2');
 await page.locator('nav a[href="#vendors"]').click();await page.getByTestId('vendor-tab-dead').click();await page.getByTestId('dead-stock').waitFor({timeout:60000});
 await page.getByTestId('dead-settings').click();await page.getByTestId('dead-idle').fill('90');await page.getByTestId('dead-rate').fill('12');await page.getByTestId('dead-storage').fill('0.05');await page.getByTestId('dead-horizon').fill('6');await page.getByTestId('dead-settings-save').click();await page.getByTestId('dead-settings-form').waitFor({state:'detached'});
 await page.locator('[data-testid="dead-capital"][data-value="60000"]').waitFor({timeout:60000});assert.equal(await page.getByTestId('dead-carrying').getAttribute('data-value'),'650');assert.equal(await page.getByTestId('dead-skus').innerText(),'1');
 const grid=page.getByTestId('dead-grid'),row=grid.locator('tbody tr').filter({hasText:d1});await row.waitFor();
 assert.equal(await row.getAttribute('data-suggested'),'9610');assert.equal(await row.getAttribute('data-status'),'suggested');const text=await row.innerText();
 for(const want of ['$600.00','$6.50','$96.10','$3.90',a1])assert.ok(text.includes(want),'Dead-stock row is missing '+want);
 assert.equal(await grid.locator('tbody tr').filter({hasText:a1+' ·'}).count(),0,'A selling item is listed as dead stock');
 await page.setViewportSize({width:375,height:812});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Dead stock overflows a phone');await page.screenshot({path:'test-results/dead-stock-'+channel+'.png',fullPage:true});await page.setViewportSize({width:1280,height:800});
 await page.getByTestId('dead-pick-'+d1).check();await page.getByTestId('dead-draft').click();await page.locator('[data-testid="dead-draft-count"][data-value="1"]').waitFor({timeout:60000});
 // The normal path: the run is a preview until the Pricing Owner approves it, then it can be exported.
 await page.locator('nav a[href="#pricing"]').click();await page.getByRole('link',{name:'Rules',exact:true}).click().catch(()=>undefined);
 await page.getByRole('button',{name:'Review run',exact:true}).first().click();await page.getByRole('cell',{name:'$96.10',exact:true}).first().waitFor({timeout:60000});
 await page.getByRole('button',{name:'Approve as Pricing Owner',exact:true}).click();await page.getByRole('heading',{name:'Export Studio',exact:true}).waitFor({timeout:60000});
 await page.locator('nav a[href="#settings"]').click();await page.getByLabel('Preview as').selectOption('sales_rep');await page.getByTestId('preview-banner').waitFor();await page.waitForTimeout(500);
 assert.equal(await page.locator('nav a[href="#vendors"]').count(),0,'A Sales Rep sees Vendors');
 await page.getByTestId('preview-banner').getByRole('button',{name:'Return to my own view'}).click();await page.getByTestId('preview-banner').waitFor({state:'detached'});
 results.checks.deadStockUi={stockFromFile:true,capital60000:true,carrying650:true,clearance9610:true,substitute:true,draftApproved:true,phone375:true,repHidden:true,privacyMarkers:true};
 }catch(error){console.error('Dead-stock UI diagnostics:',JSON.stringify(await diagnose()));throw error;}finally{await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}
// 8C-1: win/loss log, audit pack and negotiation sheet (fresh vault, under the request/console marker sensors). A quote
// for one unit at the $120.00 list price, item cost $70.00, is submitted and recorded as lost to a competitor: lost value
// $120.00 and lost margin $50.00 for the owner; the Sales Rep preview sees the value and no margin. The audit pack's
// verification.json says the chain is valid; the negotiation sheet names the cheaper vendor.
async function winLossUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-winloss-')),browserOptions);await configureContext();page=await openPage();
 try{
 dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic win/loss owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
 const sku=marker+'-WL',customer=marker+'-WLC',day=new Date(Date.now()-20*86400000).toISOString().slice(0,10);
 await page.locator('nav a[href="#data-hub"]').click();await importFiles([
  {name:'winloss-items.csv',mimeType:'text/csv',buffer:Buffer.from('product_id,description,category,uom,current_cost,list_price\n'+sku+',Synthetic fitting,Fittings,EA,70.00,120.00\n')},
  {name:'winloss-customers.csv',mimeType:'text/csv',buffer:Buffer.from('customer_id,name,tier\n'+customer+',Synthetic,T1\n')},
  {name:'winloss-sales.csv',mimeType:'text/csv',buffer:Buffer.from('line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount,invoice_id\n1,'+sku+','+customer+','+day+',1,120.00,0,0,0,70.00,WL1\n')},
  {name:'vendor-costs.csv',mimeType:'text/csv',buffer:Buffer.from('vendor,product_id,cost,effective_date\nVendor A,'+sku+',70.00,'+day+'\nVendor B,'+sku+',65.00,'+day+'\n')}],'1');
 await page.locator('nav a[href="#quotes"]').click();await page.getByRole('button',{name:'Quote',exact:true}).click();await page.getByTestId('quote-customer').fill(customer);await page.getByTestId('quote-customer').press('Enter');
 await page.getByTestId('add-sku').fill(sku);await page.getByTestId('add-sku').press('Enter');await page.getByTestId('quote-total').filter({hasText:'$120.00'}).waitFor();
 await page.getByRole('button',{name:'Submit quote',exact:true}).click();await page.locator('[data-testid="quote"][data-status="submitted"]').waitFor({timeout:60000});
 const panel=page.getByTestId('quote-outcome');await panel.waitFor();await page.getByTestId('outcome-select').selectOption('lost');await page.getByTestId('outcome-reason').selectOption('competitor');await page.getByTestId('outcome-competitor').fill('Rival '+marker);await page.getByTestId('outcome-note').fill('Lost on price '+marker);
 await page.getByTestId('outcome-save').click();await page.locator('[data-testid="quote-outcome"][data-outcome="lost"]').waitFor({timeout:60000});
 await page.getByRole('button',{name:'Win/loss',exact:true}).click();await page.getByTestId('winloss-report').waitFor();
 await page.locator('[data-testid="winloss-lost-value"][data-value="12000"]').waitFor({timeout:60000});assert.equal(await page.getByTestId('winloss-lost-margin').getAttribute('data-value'),'5000');assert.equal(await page.getByTestId('winloss-lost').innerText(),'1');
 await page.getByTestId('winloss-grid').locator('tbody tr[data-key="competitor"]').waitFor();
 await page.setViewportSize({width:375,height:812});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Win/loss overflows a phone');await page.screenshot({path:'test-results/winloss-'+channel+'.png',fullPage:true});await page.setViewportSize({width:1280,height:800});
 // The audit pack: a ZIP whose verification.json says the chain is valid, with a PDF cover page.
 await page.locator('nav a[href="#reports"]').click();const packEvent=page.waitForEvent('download');await page.getByTestId('audit-pack').click();const pack=await packEvent;
 assert.ok(pack.suggestedFilename().endsWith('.zip'));const zip=await JSZip.loadAsync(await readFile(await pack.path()));const verification=JSON.parse(await zip.file('verification.json').async('string'));
 assert.ok(verification.chain_valid===true&&Number(verification.entries)>0&&verification.files.length===8,'The audit pack does not verify');assert.ok((await zip.file('cover.pdf').async('string')).startsWith('%PDF-1.4'));
 assert.ok(!(await Promise.all(Object.values(zip.files).map(x=>x.async('string')))).join('').includes('Lost on price '+marker),'The audit pack carries a win/loss note');
 // The negotiation sheet for Vendor A names Vendor B's lower cost.
 await page.locator('nav a[href="#vendors"]').click();await page.getByTestId('negotiation-sheet').waitFor({timeout:60000});await page.getByTestId('negotiation-vendor').selectOption('Vendor A');
 const sheetEvent=page.waitForEvent('download');await page.getByTestId('negotiation-download').click();const sheet=(await readFile(await(await sheetEvent).path())).toString('latin1').replace(/\\([0-7]{3})/g,(_,o)=>String.fromCharCode(parseInt(o,8)));
 assert.ok(sheet.startsWith('%PDF-1.4')&&sheet.includes('Negotiation sheet: Vendor A')&&sheet.includes('$65.00'),'The negotiation sheet lost its content');
 // A Sales Rep: their own outcome and value, never margin; no audit pack.
 await page.locator('nav a[href="#settings"]').click();await page.getByLabel('Preview as').selectOption('sales_rep');await page.getByTestId('preview-banner').waitFor();
 await page.locator('nav a[href="#quotes"]').click();await page.getByRole('button',{name:'Win/loss',exact:true}).click();await page.locator('[data-testid="winloss-lost-value"][data-value="12000"]').waitFor({timeout:60000});
 assert.equal(await page.getByTestId('winloss-lost-margin').count(),0,'A Sales Rep sees lost margin');
 await page.locator('nav a[href="#reports"]').click();await page.waitForTimeout(500);assert.equal(await page.getByTestId('audit-pack').count(),0,'A Sales Rep can download the audit pack');
 await page.getByTestId('preview-banner').getByRole('button',{name:'Return to my own view'}).click();await page.getByTestId('preview-banner').waitFor({state:'detached'});
 results.checks.winLossUi={outcomeRecorded:true,lostValue12000:true,lostMargin5000:true,auditPackVerified:true,noNotesInPack:true,negotiationSheet:true,repNoMargin:true,repNoPack:true,phone375:true,privacyMarkers:true};
 }catch(error){console.error('Win/loss UI diagnostics:',JSON.stringify(await diagnose()));throw error;}finally{await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}
// 8C-2: offline mode (Chrome and Edge). In a fresh profile: create a vault and import marked data online, let the
// service worker take control, reload once online, then cut the network, reload and unlock: the app opens from the
// stored shell and the data comes from the encrypted vault. The cache scan lists every stored response and proves it
// holds only shell paths and no business data (no import marker, no /api/). "Remove offline copy" empties it.
// A TCP relay to the app server on another port of the same host. Closing it cuts every connection, including the
// service worker's own fetches, which Playwright's offline emulation does not cover.
let relayOrigin=null,benchOpen=false;
async function tcpRelay(target){
 const t=new URL(target),sockets=new Set();
 const server=net.createServer(c=>{const u=net.connect(Number(t.port||80),t.hostname);for(const x of [c,u]){sockets.add(x);x.on('error',()=>x.destroy());x.on('close',()=>{sockets.delete(x);c.destroy();u.destroy();});}c.pipe(u);u.pipe(c);});
 await new Promise((ok,no)=>{server.once('error',no);server.listen(0,t.hostname,ok);});
 let open=true;return {url:t.protocol+'//'+t.hostname+':'+server.address().port,close:()=>open?new Promise(ok=>{open=false;for(const x of sockets)x.destroy();server.close(()=>ok());}):Promise.resolve()};
}
async function offlineUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-offline-')),{...browserOptions,serviceWorkers:'allow'});await configureContext();page=await openPage();
 const relay=await tcpRelay(base);relayOrigin=new URL(relay.url).origin;const cut=r=>r.abort('internetdisconnected');
 try{
 // Session cookies are per host, not per port, so a sign-in on the app server also signs in through the relay.
 dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(relay.url+route);await ready();await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic offline owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
 const sku=marker+'-OFF',customer=marker+'-OFFC';
 await page.locator('nav a[href="#data-hub"]').click();await importFiles([
  {name:'offline-items.csv',mimeType:'text/csv',buffer:Buffer.from('product_id,description,category,uom,current_cost,list_price\n'+sku+',Synthetic offline item,Offline,EA,4.00,9.00\n')},
  {name:'offline-customers.csv',mimeType:'text/csv',buffer:Buffer.from('customer_id,name,tier\n'+customer+',Synthetic,T1\n')},
  {name:'offline-sales.csv',mimeType:'text/csv',buffer:Buffer.from('line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount\n1,'+sku+','+customer+',2026-01-05,2,18.00,0,0,0,8.00\n2,'+sku+','+customer+',2026-01-06,1,9.00,0,0,0,4.00\n')}],'2');
 await page.waitForFunction(async()=>!!(await navigator.serviceWorker.ready)&&!!navigator.serviceWorker.controller,null,{timeout:60000});
 // Online reload: the page and the engine go through the worker once, so they are stored.
 dataPlaneActive=false;await page.reload();await ready();await unlock();await page.locator('[data-testid="line-count"][data-value="2"]').waitFor({timeout:60000});dataPlaneActive=true;
 await page.locator('nav a[href="#settings"]').click();await page.locator('[data-testid="offline-card"][data-state="ready"]').waitFor({timeout:60000});
 // Offline: reload, unlock, read the same data.
 await relay.close();await context.route('**/api/licence?device=*',cut);await context.setOffline(true);dataPlaneActive=false;
 await page.reload();await ready();await unlock();await page.locator('[data-testid="line-count"][data-value="2"]').waitFor({timeout:60000});dataPlaneActive=true;
 assert.ok(await page.evaluate(()=>!navigator.onLine),'The browser was not offline');const probe=await page.evaluate(async()=>{try{await fetch('/spike/assets.json?probe=1',{cache:'no-store'});return 'reached';}catch{return 'blocked';}});assert.equal(probe,'blocked','The server was still reachable in the offline phase');
 await page.locator('nav a[href="#settings"]').click();await page.getByTestId('offline-card').waitFor();const grace=(await page.getByTestId('offline-card').innerText()).includes('Working offline');
 await page.setViewportSize({width:375,height:812});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Settings overflows a phone offline');await page.screenshot({path:'test-results/offline-'+channel+'.png',fullPage:true});await page.setViewportSize({width:1280,height:800});
 // The cache scan: every stored response, its path and whether its body carries the import marker.
 const scan=await page.evaluate(async m=>{const out=[];for(const name of await caches.keys()){const c=await caches.open(name);for(const req of await c.keys()){const res=await c.match(req);const body=new Uint8Array(await res.arrayBuffer());let text='';try{text=new TextDecoder('utf-8',{fatal:false}).decode(body);}catch{}out.push({cache:name,path:new URL(req.url).pathname,search:new URL(req.url).search,bytes:body.length,marker:text.includes(m)});}}return out;},marker);
 assert.ok(scan.length>5,'The offline copy is empty');
 const allowed=/^(\/home|\/lab\/vault|\/_next\/static\/.+|\/spike\/.+|\/manifest\.webmanifest|\/icon\.svg)$/;
 for(const e of scan){assert.equal(e.cache,'rebatehq-shell-v1');assert.ok(allowed.test(e.path)&&!e.search,'Unexpected cached path '+e.path);assert.ok(!e.marker,'Business data in the offline copy: '+e.path);}
 assert.ok(scan.some(e=>e.path===route)&&scan.some(e=>/^\/spike\/.+\.wasm$/.test(e.path)),'The shell or the engine was not stored');
 await context.setOffline(false);await context.unroute('**/api/licence?device=*',cut);
 assert.ok(grace,'The offline licence grace note was not shown');
 await page.getByTestId('offline-remove').click();await page.locator('[data-testid="offline-card"][data-state="off"]').waitFor({timeout:30000});
 assert.equal(await page.evaluate(async()=>(await caches.keys()).length),0,'Remove offline copy left a cache');
 results.checks.offlineUi={swControls:true,serverCut:true,offlineReloadUnlock:true,sameLines:true,cacheScan:{entries:scan.length,businessData:0,api:0},licenceGrace:true,removeCopy:true,phone375:true,privacyMarkers:true};
 }catch(error){await context.setOffline(false).catch(()=>undefined);console.error('Offline UI diagnostics:',JSON.stringify(await diagnose()));throw error;}finally{await relay.close();relayOrigin=null;await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}
// 8D: opt-in anonymous benchmarks. 240 Wire lines over 24 customers in the last complete quarter (list 100.00, discount
// 10.00, rebate 2.00, freight 3.00, cost 60.00): bands pocket margin 29, discount 10, rebate 2, freight 3; size S1. Nothing
// reaches /api/bench until the Owner clicks; the share request carries exactly that payload, with no fixture marker. In
// lab mode a stand-in server answers /api/bench; in CI the real API and database do.
async function benchUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-bench-')),browserOptions);await configureContext();page=await openPage();
 const calls=[];context.on('request',r=>{const u=new URL(r.url());if(u.pathname==='/api/bench')calls.push({method:r.method(),mode:u.searchParams.get('mode'),body:r.postData()?JSON.parse(r.postData()):null});});
 const now=new Date(),qn=Math.floor(now.getUTCMonth()/3)+1,qy=now.getUTCFullYear(),quarter=qn===1?(qy-1)+'-Q4':qy+'-Q'+(qn-1),[y,n]=[Number(quarter.slice(0,4)),Number(quarter.slice(6))],start=Date.UTC(y,(n-1)*3,1);
 if(!auth){let state=null;await context.route('**/api/bench**',async r=>{const q=r.request(),u=new URL(q.url()),b=q.postData()?JSON.parse(q.postData()):{};
  if(q.method()==='GET'&&u.searchParams.get('mode')==='state')return r.fulfill({json:{consent:state}});
  if(b.action==='consent'){state={optedIn:b.optedIn,version:1,decidedAt:new Date().toISOString()};return r.fulfill({json:{consent:state}});}
  if(b.action==='share')return r.fulfill({json:{quarter:b.payload.quarter,stored:b.payload.rows.length}});
  if(q.method()==='GET'&&u.searchParams.get('mode')==='figures')return r.fulfill({json:{quarter,cells:[{sizeBand:'S1',family:'electrical',metric:'pocket_margin',p25:25,p50:25,p75:30,epsilon:'1.000',releasedAt:new Date().toISOString()}]}});
  if(b.action==='withdraw'){state={optedIn:false,version:1,decidedAt:new Date().toISOString()};return r.fulfill({json:{deleted:1,consent:state}});}
  return r.fulfill({status:400,json:{error:'unexpected'}});});}
 try{
 dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic benchmark owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
 const wire='Wire '+marker,pipe='Pipe '+marker,w=marker+'-BW',p=marker+'-BP',day=i=>new Date(start+(i%60)*86400000).toISOString().slice(0,10),lines=['line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount'];
 for(let i=1;i<=240;i++)lines.push([i,w,marker+'-BC'+(i%24+1),day(i),1,'100.00','10.00','3.00','2.00','60.00'].join(','));
 for(let i=241;i<=245;i++)lines.push([i,p,marker+'-BC1',day(i),1,'50.00','10.00','0','0','30.00'].join(','));
 await page.locator('nav a[href="#data-hub"]').click();await importFiles([
  {name:'bench-items.csv',mimeType:'text/csv',buffer:Buffer.from('product_id,description,category,uom,current_cost,list_price\n'+w+',Synthetic wire,'+wire+',EA,60.00,100.00\n'+p+',Synthetic pipe,'+pipe+',EA,30.00,50.00\n')},
  {name:'bench-customers.csv',mimeType:'text/csv',buffer:Buffer.from('customer_id,name,tier\n'+Array.from({length:24},(_,i)=>marker+'-BC'+(i+1)+',Synthetic '+(i+1)+',T1').join('\n')+'\n')},
  {name:'bench-sales.csv',mimeType:'text/csv',buffer:Buffer.from(lines.join('\n')+'\n')}],'245');
 await page.locator('nav a[href="#reports"]').click();await page.getByTestId('benchmarks').waitFor({timeout:60000});
 await page.getByTestId('bench-family-'+wire).selectOption('electrical');await page.getByTestId('bench-family-'+pipe).selectOption('plumbing');await page.getByTestId('bench-map-save').click();
 await page.getByTestId('bench-families').locator('tbody tr[data-included="yes"]').waitFor({timeout:60000});
 const expected={v:1,quarter,sizeBand:'S1',rows:[{family:'electrical',metric:'pocket_margin',band:29},{family:'electrical',metric:'discount_rate',band:10},{family:'electrical',metric:'rebate_rate',band:2},{family:'electrical',metric:'freight_rate',band:3}]};
 assert.deepEqual(JSON.parse(await page.getByTestId('bench-payload').innerText()),expected,'The reviewed payload is not the expected bands');
 await page.waitForTimeout(800);assert.equal(calls.length,0,'The Benchmarks screen sent a request before any click');
 // From here, only the Owner's clicks reach /api/bench.
 benchOpen=true;
 await page.getByTestId('bench-check').click();await page.locator('[data-testid="bench-consent"][data-state="off"]').waitFor({timeout:30000});
 await page.getByTestId('bench-agree').check();await page.getByTestId('bench-optin').click();await page.getByTestId('bench-share').waitFor({timeout:30000});
 await page.getByTestId('bench-share').click();await page.getByTestId('bench-note').filter({hasText:'shared: 4 bands'}).waitFor({timeout:30000});
 const shares=calls.filter(c=>c.body?.action==='share');assert.equal(shares.length,1);assert.deepEqual(shares[0].body,{action:'share',payload:expected},'The share request is not exactly the reviewed payload');
 await page.getByTestId('bench-figures-get').click();
 if(auth)await page.getByTestId('bench-note').filter({hasText:'No figures released'}).waitFor({timeout:30000});
 else await page.getByTestId('bench-figures-grid').locator('tbody tr').filter({hasText:'25–29%'}).waitFor({timeout:30000});
 await page.setViewportSize({width:375,height:812});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Benchmarks overflow a phone');await page.screenshot({path:'test-results/benchmarks-'+channel+'.png',fullPage:true});await page.setViewportSize({width:1280,height:800});
 await page.getByTestId('bench-withdraw').click();await page.getByTestId('bench-withdraw-confirm').click();await page.getByTestId('bench-note').filter({hasText:'Deleted 1 shared quarters'}).waitFor({timeout:30000});
 benchOpen=false;
 assert.deepEqual(calls.map(c=>c.body?.action??c.mode),['state','consent','share','figures','withdraw'],'Unexpected benchmark requests');
 assert.ok(!JSON.stringify(calls).includes(marker),'A fixture marker reached a benchmark request');
 // A Sales Rep sees no benchmarks.
 await page.locator('nav a[href="#settings"]').click();await page.getByLabel('Preview as').selectOption('sales_rep');await page.getByTestId('preview-banner').waitFor();
 await page.locator('nav a[href="#reports"]').click();await page.waitForTimeout(600);assert.equal(await page.getByTestId('benchmarks').count(),0,'A Sales Rep sees benchmarks');
 await page.getByTestId('preview-banner').getByRole('button',{name:'Return to my own view'}).click();await page.getByTestId('preview-banner').waitFor({state:'detached'});
 results.checks.benchUi={noRequestBeforeClick:true,exactPayload:true,bands:[29,10,2,3],sizeBand:'S1',server:auth?'real API':'lab stand-in',figures:true,withdraw:true,repHidden:true,phone375:true,privacyMarkers:true};
 }catch(error){console.error('Benchmarks UI diagnostics:',JSON.stringify(await diagnose()));throw error;}finally{benchOpen=false;await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}
async function reportsUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-reports-')),browserOptions);await configureContext();page=await openPage();
 try{
 dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic review owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
 await page.locator('nav a[href="#settings"]').click();await page.locator('section[aria-labelledby="currency-heading"] select').selectOption('CAD');await page.getByRole('button',{name:'Save currency',exact:true}).click();await page.getByText('Current currency: CAD',{exact:true}).waitFor();
 const sku=marker+'-REVIEW-P',customer=marker+'-REVIEW-C';
 await page.locator('nav a[href="#data-hub"]').click();await importFiles([
 {name:'review-items.csv',mimeType:'text/csv',buffer:Buffer.from('product_id,description,category,uom,current_cost,list_price\n'+sku+',Synthetic valve,Valves,EA,80.00,120.00\n')},
 {name:'review-customers.csv',mimeType:'text/csv',buffer:Buffer.from('customer_id,name,tier\n'+customer+',Synthetic,T\n')},
 {name:'review-sales.csv',mimeType:'text/csv',buffer:Buffer.from('line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount,invoice_id\n1,'+sku+','+customer+',2026-11-01,1,100.00,10.00,20.00,0,80.00,NOV\n2,'+sku+','+customer+',2026-10-01,1,100.00,0,0,0,70.00,OCT\n3,'+sku+','+customer+',2026-07-01,1,100.00,0,0,0,10.00,JUL1\n4,'+sku+','+customer+',2026-07-02,1,100.00,0,0,0,10.00,JUL2\n')}],'4');
 await page.locator('nav a[href="#reports"]').click();await page.getByTestId('cadence-month').fill('2026-11');await page.getByTestId('cadence-check').click();await page.getByTestId('cadence-prepare').waitFor({timeout:60000});
 const pack=page.getByTestId('cadence-pack');assert.ok((await pack.innerText()).includes('CA$20.00'),'Review leak lost CAD or deduplicated value');assert.ok((await pack.innerText()).includes('CA$40.00'),'Review bridge lost CAD');await page.getByTestId('cadence-last-checked').filter({hasText:'Last checked:'}).waitFor();
 const pdfText=async()=>{await page.getByTestId('cadence-prepare').click();await page.getByTestId('cadence-download').waitFor();const event=page.waitForEvent('download');await page.getByTestId('cadence-download').click();const bytes=await readFile(await(await event).path());assert.ok(bytes.subarray(0,8).toString().startsWith('%PDF-1.4'));return bytes.toString('latin1').replace(/\\([0-7]{3})/g,(_,oct)=>String.fromCharCode(parseInt(oct,8)));};
 for(const [locale,title]of [['en','Monthly Pricing Review Pack'],['es','Paquete mensual de revisión de precios'],['fr','Dossier mensuel de revue des prix']]){await page.getByTestId('language').first().selectOption(locale);const text=await pdfText();assert.ok(text.includes(title),'PDF language differs from the user language');assert.ok(text.includes('CAD'),'PDF omitted the workspace currency');}
 await page.getByTestId('language').first().selectOption('en');await page.getByTestId('cadence-kind').selectOption('weekly');await page.getByTestId('cadence-check').click();await page.getByTestId('cadence-prepare').waitFor();assert.ok((await pack.innerText()).includes('Customers flagged'));const weekly=await pdfText();assert.ok(weekly.includes('Weekly digest')&&weekly.includes('app is open'),'Weekly digest omitted its honest execution limit');
 await page.locator('nav a[href="#pricing"]').click();for(const [label,value]of Object.entries({'Customer tier':'T','Product category':'Valves','Start price (cents)':'12000','Target price (cents)':'10000','Floor price (cents)':'8000'}))await page.getByLabel(label,{exact:true}).fill(value);await page.getByRole('button',{name:'Save guardrails',exact:true}).click();await page.getByRole('status').filter({hasText:'Guardrails saved.'}).waitFor();
 await page.locator('nav a[href="#quotes"]').click();await page.getByRole('button',{name:'Quote',exact:true}).click();await page.getByTestId('quote-customer').fill(customer);await page.getByTestId('quote-customer').press('Enter');await page.getByTestId('add-sku').fill(sku);await page.getByTestId('add-sku').press('Enter');await page.getByTestId('quote-total').filter({hasText:'CA$120.00'}).waitFor();await page.getByRole('button',{name:'Submit quote',exact:true}).click();
 await page.locator('nav a[href="#reports"]').click();await page.getByRole('link',{name:'Team compliance',exact:true}).click();await page.getByTestId('scorecard-from').fill('2026-11-01');await page.getByTestId('scorecard-to').fill('2026-12-31');await page.getByTestId('scorecard').getByRole('button',{name:'Check now',exact:true}).click();await page.getByTestId('scorecard-points').filter({hasText:/^2$/}).waitFor();const grid=page.getByTestId('scorecard-grid');await grid.getByTestId('grid-select-all').check();const total=grid.getByTestId('grid-total-protectedPoints');await total.waitFor();assert.equal(await total.getAttribute('data-sum'),'2');
 await page.locator('nav a[href="#settings"]').click();await page.getByLabel('Preview as').selectOption('sales_rep');await page.getByTestId('preview-banner').waitFor();await page.locator('nav a[href="#reports"]').click();await page.getByTestId('scorecard').waitFor();assert.equal(await page.getByRole('link',{name:'Review packs',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'Recovery tracker',exact:true}).count(),0);assert.equal(await page.getByTestId('scorecard-view').inputValue(),'team');
 await page.getByTestId('scorecard-consent').check();await page.getByTestId('scorecard-view').locator('option[value=mine]').waitFor({state:'attached'});await page.getByTestId('scorecard-view').selectOption('mine');await page.getByTestId('scorecard-points').filter({hasText:/^2$/}).waitFor();await page.getByTestId('scorecard-consent').uncheck();await until(async()=>await page.getByTestId('scorecard-view').inputValue()==='team','Opt-out did not return to team aggregate');
 await page.getByTestId('preview-banner').getByRole('button',{name:'Return to my own view'}).click();await page.getByTestId('preview-banner').waitFor({state:'detached'});await page.locator('nav a[href="#reports"]').click();
 for(const theme of ['light','dark','contrast']){await page.evaluate(v=>document.documentElement.dataset.theme=v,theme);await page.setViewportSize({width:375,height:812});for(const hash of ['review','roi','scorecard']){await page.evaluate(v=>location.hash='#reports-'+v,hash);await page.getByTestId(hash==='review'?'cadence-pack':hash==='roi'?'roi-v2':'scorecard').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Reports overflow phone');}await page.screenshot({path:'test-results/reports-'+channel+'-'+theme+'.png',fullPage:true});}
 await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>localStorage.setItem('rebatehq.locale','pseudo'));await page.reload();await page.locator('form input[type="password"]').fill(secret);await page.locator('form:has(input[type="password"]) button').click();await page.getByTestId('line-count').waitFor();for(const hash of ['review','roi','scorecard']){await page.evaluate(v=>location.hash='#reports-'+v,hash);await page.getByText(/⟦/).first().waitFor();}await page.getByTestId('language').first().selectOption('en');await page.evaluate(()=>location.hash='#reports-review');await page.getByTestId('cadence-last-checked').filter({hasText:'Last checked:'}).waitFor();assert.equal(await page.getByTestId('cadence-prepare').count(),0,'Reload retained a stale report');
 results.checks.reportsUi={currency:'CAD',monthly:true,weeklyHealth:true,pdfLanguages:['en','es','fr'],retainedDownload:true,scorecardPoints:true,workerGridTotals:true,teamDefault:true,selfOptIn:true,repPrivateTabsHidden:true,phoneThemes:true,pseudoLocale:true,lastCheckedSurvivesReload:true,privacyMarkers:true};
 }catch(error){console.error('Reports UI diagnostics:',JSON.stringify(await diagnose()));throw error;}finally{await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}
async function recoveryUi(){
 // A real (non-sample) finding of its own: one line whose freight (30.00) exceeds 10% of list (100.00), recorded by the leak finder on the
 // Margin page. Sales line IDs are unique across the vault, so the line uses an ID the main data does not.
 // The main page sits idle while the fresh-vault checks run in their own contexts, so it may have locked.
 if(await page.getByRole('button',{name:'Unlock vault',exact:true}).count())await unlock();
 const sku=marker+'-ROI-P',customer=marker+'-ROI-C',before=BigInt(await page.getByTestId('line-count').getAttribute('data-value'));
 await page.locator('nav a[href="#data-hub"]').click();await review([{name:'roi-items.csv',mimeType:'text/csv',buffer:Buffer.from('product_id,description,category,uom,current_cost,list_price\n'+sku+',Synthetic ROI item,ROI,EA,10.00,100.00\n')},{name:'roi-customers.csv',mimeType:'text/csv',buffer:Buffer.from('customer_id,name,tier\n'+customer+',Synthetic,ROI\n')},{name:'roi-sales.csv',mimeType:'text/csv',buffer:Buffer.from('line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount,invoice_id\n987654321,'+sku+','+customer+',2026-11-02,1,100.00,0,30.00,0,10.00,ROI1\n')}]);
 if(await page.getByTestId('studio-ack').count())await page.getByTestId('studio-ack').check();
 await page.getByRole('button',{name:'Confirm and import locally'}).click();await page.locator('[data-testid="line-count"][data-value="'+(before+BigInt(1))+'"]').waitFor({timeout:120000});
 await page.locator('nav a[href="#margin"]').click();await page.getByTestId('leak-total').waitFor({timeout:60000});
 await page.locator('nav a[href="#reports"]').click();await page.getByRole('link',{name:'Recovery tracker',exact:true}).click();await page.getByTestId('roi-recovered').filter({hasText:'$0.00'}).waitFor();await page.getByTestId('roi-grid').getByRole('button',{name:'Choose for recovery',exact:true}).first().click();
 await page.getByRole('link',{name:'Rule runs',exact:true}).click();await page.getByTestId('roi-grid').locator('tbody tr').filter({hasText:'exported'}).first().getByRole('button',{name:'Choose for recovery',exact:true}).click();await page.getByTestId('roi-amount').fill('125.25');await page.getByTestId('roi-reference').fill(marker+'-RECOVERY');await page.getByTestId('roi-confirm').check();await page.getByTestId('roi-form').getByRole('button',{name:'Record recovery',exact:true}).click();await page.getByTestId('roi-recovered').filter({hasText:'$125.25'}).waitFor();
 await page.getByRole('link',{name:'Recovery records',exact:true}).click();await page.getByTestId('roi-grid').locator('tbody tr').filter({hasText:marker+'-RECOVERY'}).getByRole('button',{name:'Void recovery',exact:true}).click();await page.getByTestId('roi-recovered').filter({hasText:'$0.00'}).waitFor();results.checks.roiUi={currency:'USD',attested12525:true,linkedToFindingAndExport:true,voidRestoresZero:true,markerSensors:true};
}
async function suppliersUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-suppliers-')),browserOptions);await configureContext();page=await openPage();
 try{
 dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic supplier owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
 await page.locator('nav a[href="#settings"]').click();await page.locator('section[aria-labelledby="currency-heading"] select').selectOption('CAD');await page.getByRole('button',{name:'Save currency',exact:true}).click();await page.getByText('Current currency: CAD',{exact:true}).waitFor();
 const supplier=marker+'-SUP',sku=marker+'-PURCHASE',ref=marker+'-CLAIM';
 const csv=Buffer.from('line_id,receipt_ref,supplier,product_id,receipt_date,quantity,purchase_amount,entry_kind,uom\n1,PO1,'+supplier+','+sku+',2026-03-31,1,30000.00,receipt,EA\n2,PO2,'+supplier+','+sku+',2026-03-31,1,400.00,return,EA\n3,PO3,'+supplier+','+sku+',2026-03-31,0,100.00,credit_memo,EA\n');
 await page.locator('nav a[href="#data-hub"]').click();await review([{name:'synthetic-po-receipts.csv',mimeType:'text/csv',buffer:csv}]);await page.getByRole('button',{name:'Confirm and import locally',exact:true}).click();await page.getByRole('heading',{name:'Batch report'}).waitFor({state:'detached'});
 await page.locator('nav a[href="#rebates"]').click();await page.getByTestId('supplier-tab-claims').click();const form=page.getByTestId('supplier-form');await form.waitFor();await page.getByTestId('supplier-reference').fill(ref);await page.getByTestId('supplier-supplier').fill(supplier);await page.getByTestId('supplier-program').fill('Synthetic quarterly');await page.getByTestId('supplier-from').fill('2026-01-01');await page.getByTestId('supplier-to').fill('2026-03-31');await page.getByTestId('supplier-due').fill('2026-04-30');await page.getByTestId('supplier-confirm').check();await form.getByRole('button',{name:'Save claim draft',exact:true}).click();const claim=page.getByTestId('supplier-review');await page.getByTestId('supplier-earned').filter({hasText:'CA$590.00'}).waitFor();assert.ok((await claim.innerText()).includes('CA$29,500.00'),'Supplier UI lost CAD spend');
 const checkDownload=async(name,format)=>{await claim.getByRole('button',{name,exact:true}).click();const link=claim.getByRole('link',{name:'Download prepared '+format.toUpperCase(),exact:true});await link.waitFor();await page.waitForTimeout(1500);const wait=page.waitForEvent('download');await link.click();const d=await wait,bytes=await readFile(await d.path());assert.ok(d.suggestedFilename().endsWith('.'+format)&&bytes.length>100,'Empty claim download');if(format==='csv'){const text=bytes.toString('utf8');assert.ok(text.includes('CAD')&&text.includes('590.00')&&text.includes('29500.00'),'Claim CSV lost CAD amounts');assert.ok(!text.includes('notes'),'Claim CSV includes notes');}};
 // Deliberately expire transient activation: asynchronous export work must not auto-download.
 await page.evaluate(()=>{const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...args){if(message.action==='supplierClaimExport')setTimeout(()=>original.call(this,message,...args),6500);else original.call(this,message,...args);};});
 await checkDownload('Prepare claim CSV','csv');await claim.getByText('Recorded claimed amount: CA$590.00',{exact:false}).waitFor();await checkDownload('Prepare claim XLSX','xlsx');
 for(const name of ['Mark submitted','Mark approved','Mark paid']){await claim.getByRole('button',{name,exact:true}).click();await page.getByTestId('supplier-claims-grid').getByRole('cell',{name:name==='Mark submitted'?'Submitted by operator':name==='Mark approved'?'Approved by supplier':'Paid (operator confirmed)',exact:true}).waitFor();}
 assert.equal(await claim.getByRole('link',{name:/Download prepared/}).count(),0,'A status change retained a stale prepared link');
 await page.getByTestId('supplier-tab-purchases').click();const receipts=page.getByTestId('supplier-purchases-grid');await receipts.getByRole('cell',{name:'CA$30,000.00',exact:true}).waitFor();await receipts.getByTestId('grid-select-all').check();const total=receipts.getByTestId('grid-total-amount_cents');await total.waitFor();assert.equal(await total.getAttribute('data-sum'),'2950000');assert.ok((await total.innerText()).includes('CA$29,500.00'),'Supplier total lost currency');
 await page.getByTestId('supplier-tab-progress').click();await page.getByTestId('supplier-progress-grid').getByRole('cell',{name:'CA$590.00',exact:true}).first().waitFor();
 for(const theme of ['light','dark','contrast']){await page.evaluate(v=>document.documentElement.dataset.theme=v,theme);await page.setViewportSize({width:375,height:812});for(const tab of ['claims','purchases','progress']){await page.getByTestId('supplier-tab-'+tab).click();await page.getByTestId('supplier-section').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Supplier page overflows phone');}await page.screenshot({path:'test-results/suppliers-'+channel+'-'+theme+'.png',fullPage:true});}await page.setViewportSize({width:1280,height:800});
 await page.locator('nav a[href="#settings"]').click();await page.getByLabel('Preview as').selectOption('sales_rep');await page.getByTestId('preview-banner').waitFor();await page.locator('nav a[href="#rebates"]').click();assert.equal(await page.getByTestId('supplier-tab-claims').count(),0,'Rep sees supplier navigation');await page.getByRole('button',{name:'Return to my own view'}).click();
 await page.evaluate(()=>localStorage.setItem('rebatehq.locale','pseudo'));await page.reload();await page.locator('form input[type="password"]').fill(secret);await page.locator('form:has(input[type="password"]) button').click();await page.getByTestId('line-count').waitFor();for(const hash of ['claims','purchases','supplier']){await page.evaluate(v=>location.hash='#rebates-'+v,hash);await page.getByTestId('supplier-section').waitFor();assert.ok((await page.getByTestId('supplier-section').innerText()).includes('⟦'),'Supplier pseudo missing');}
 results.checks.suppliersUi={currency:'CAD',earned590:true,spend29500:true,localCsvXlsx:true,statusFlow:true,workerGridTotals:true,repHidden:true,encryptedReload:true,pseudo:true,themes:true,phone375:true,privacyMarkers:true};
 }catch(error){console.error('Supplier UI diagnostics:',JSON.stringify(await diagnose()));throw error;}finally{await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}

async function monitorUi(){
 const savedContext=context,savedPage=page,active=dataPlaneActive;
 context=await browserType.launchPersistentContext(await mkdtemp(path.join(os.tmpdir(),'rebatehq-monitor-')),browserOptions);await configureContext();page=await openPage();
 try{
  dataPlaneActive=false;if(auth)await signInLocal(context,page,base);await page.goto(base+route);await ready();
  await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic monitor owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();dataPlaneActive=true;
  await page.locator('nav a[href="#settings"]').click();await page.locator('section[aria-labelledby="currency-heading"] select').selectOption('CAD');await page.getByRole('button',{name:'Save currency',exact:true}).click();await page.getByText('Current currency: CAD',{exact:true}).waitFor();
  const today=new Date().toISOString().slice(0,10),before=new Date(Date.now()-100*86400000).toISOString().slice(0,10),sku=marker+'-MON',customer=marker+'-CUSTOMER';
  const items=Buffer.from('product_id,category,current_cost,list_price\n'+[[sku,'Parts','50.00','100.00'],[sku+'-A','Parts','60.00','120.00'],[sku+'-B','Parts','60.00','110.00'],[sku+'-C','Parts','60.00','110.00']].map(r=>r.join(',')).join('\n')+'\n');
  const values=[[1,sku,customer,before,1,'100.00','0','0','0','50.00','OLD-1'],[2,sku,customer,before,1,'100.00','0','0','0','50.00','OLD-2'],[3,sku,customer,before,1,'100.00','0','0','0','50.00','OLD-3'],[4,sku,customer,today,1,'100.00','10.00','20.00','0','90.00','NEW'],[5,sku+'-A',customer,today,1,'120.00','0','0','0','60.00','NEW'],[6,sku+'-B',customer,today,1,'110.00','0','0','0','60.00','NEW'],[7,sku+'-C',customer,today,1,'110.00','0','0','0','60.00','NEW']];
  await page.locator('nav a[href="#data-hub"]').click();await importFiles([{name:'monitor-items.csv',mimeType:'text/csv',buffer:items},{name:'monitor-sales.csv',mimeType:'text/csv',buffer:Buffer.from(header.trim()+',invoice_id\n'+values.map(r=>r.join(',')).join('\n')+'\n')}],'7');
  await page.locator('nav a[href="#home"]').click();await page.getByTestId('cash-leak-value').filter({hasText:'CA$20.00'}).waitFor();await page.getByTestId('health-last-checked').waitFor();
  const health=page.getByTestId('customer-health');assert.ok((await health.innerText()).includes('50.00%'),'Health basis points were not formatted as percentages');if(!auth)await page.screenshot({path:'test-results/7c3b-'+channel+'-home-cad.png',fullPage:true});await health.getByRole('button',{name:'Show the math',exact:true}).click();await page.getByRole('dialog').getByRole('table',{name:'Customer health alerts',exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByTestId('cash-leak').getByRole('button',{name:'Show the math',exact:true}).click();assert.ok((await page.getByRole('dialog').innerText()).includes('CA$20.00'),'Hero math lost the CAD symbol');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('nav a[href="#margin"]').click();await page.getByRole('link',{name:'Competitor prices',exact:true}).click();await page.getByTestId('competitor-product').fill(sku);await page.getByTestId('competitor-log').getByLabel('Customer',{exact:true}).fill(customer);await page.getByLabel('Competitor',{exact:true}).fill(marker+'-MON-COMP');await page.getByLabel('New unit price',{exact:true}).fill('99.00');await page.getByLabel('Source (plain text; never fetched)',{exact:true}).fill(marker+'-MON-SOURCE');await page.getByRole('button',{name:'Save observation locally',exact:true}).click();await page.getByTestId('competitor-alternative').first().waitFor();
  const alts=page.getByTestId('competitor-alternative');assert.equal(await alts.count(),3);assert.ok((await alts.first().innerText()).includes(sku+'-A'));assert.ok((await alts.first().innerText()).includes('CA$60.00'),'Alternative amount/currency differs');assert.ok((await alts.first().innerText()).includes('CA$120.00'));
  for(const hash of ['#home','#margin-competitors']){await page.evaluate(h=>{location.hash=h;},hash);await page.setViewportSize({width:375,height:812});await page.waitForTimeout(500);await page.waitForFunction(()=>!document.querySelector('main [aria-busy="true"]'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Monitor UI overflow at 375px');}
  await page.evaluate(()=>localStorage.setItem('rebatehq.locale','pseudo'));await page.reload();await page.locator('form input[type="password"]').fill(secret);await page.locator('form:has(input[type="password"]) button').click();await page.getByTestId('line-count').waitFor();await page.evaluate(()=>{location.hash='#home';});await page.getByTestId('health-last-checked').waitFor();assert.ok((await health.innerText()).includes('⟦'),'Home monitoring did not translate');await page.evaluate(()=>{location.hash='#margin-competitors';});await page.getByTestId('competitor-log').waitFor();assert.ok((await page.getByTestId('competitor-log').innerText()).includes('⟦'),'Alternatives did not translate');
  results.checks.monitorUi={cadHero:'CA$20.00',cadAlternative:'CA$60.00',showMath:true,rankedThree:true,pseudo:true,phone375:true};
 }finally{await context.close();context=savedContext;page=savedPage;dataPlaneActive=active;}
}
// Synthetic multi-format fixtures (TSV, JSON, XML, XLSX) with the private marker in product_id.
await build({ entryPoints: ["tests/helpers/studio-fixtures.ts"], outfile: "test-results/studio-fixtures.mjs", bundle: true, platform: "node", format: "esm" });
const fixtures = await import(new URL("../test-results/studio-fixtures.mjs", import.meta.url).href);
try {
 if(process.argv.includes('--bench-ui-only')){await benchUi();await Promise.all(headerChecks);assert.deepEqual(failures,[]);results.status='passed';console.log('Benchmarks UI focused gate passed ('+channel+').');}else if(process.argv.includes('--offline-ui-only')){await offlineUi();await Promise.all(headerChecks);assert.deepEqual(failures,[]);results.status='passed';console.log('Offline UI focused gate passed ('+channel+').');}else if(process.argv.includes('--winloss-ui-only')){await winLossUi();await Promise.all(headerChecks);assert.deepEqual(failures,[]);results.status='passed';console.log('Win/loss UI focused gate passed ('+channel+').');}else if(process.argv.includes('--dead-ui-only')){await deadStockUi();await Promise.all(headerChecks);assert.deepEqual(failures,[]);results.status='passed';console.log('Dead-stock UI focused gate passed ('+channel+').');}else if(process.argv.includes('--agents-ui-only')){await agentsUi();await Promise.all(headerChecks);assert.deepEqual(failures,[]);results.status='passed';console.log('Agents UI focused gate passed ('+channel+').');}else if(process.argv.includes('--guidance-ui-only')){await guidanceUi();await Promise.all(headerChecks);assert.deepEqual(failures,[]);results.status='passed';console.log('Guidance UI focused gate passed ('+channel+').');}else if(process.argv.includes('--converters-ui-only')){await convertersUi();await Promise.all(headerChecks);assert.deepEqual(failures,[]);results.status='passed';console.log('Converters UI focused gate passed ('+channel+').');}else if(process.argv.includes('--reports-ui-only')){await reportsUi();await Promise.all(headerChecks);assert.deepEqual(failures,[]);results.status='passed';console.log('Reports UI focused gate passed ('+channel+').');}else if(process.argv.includes('--sim-ui-only')){await simUi();await Promise.all(headerChecks);assert.deepEqual(failures,[]);results.status='passed';console.log('Simulator UI focused gate passed ('+channel+').');}else if(process.argv.includes('--vendors-ui-only')){await vendorsUi();await Promise.all(headerChecks);assert.deepEqual(failures,[]);results.status='passed';console.log('Vendor UI focused gate passed ('+channel+').');}else if(process.argv.includes('--suppliers-ui-only')){await suppliersUi();await Promise.all(headerChecks);assert.deepEqual(failures,[]);results.status='passed';console.log('Supplier UI focused gate passed ('+channel+').');}else{
  if (auth) {
    assert.notEqual(process.env.LEGACY_BUSINESS_ENABLED,'true','Privacy gate must run with legacy business routes OFF');
    await signInLocal(context,page,base);
    let testedHandlers=0;
    for(const path of RETIRED_API_PATHS){const source=await readFile('app/api/'+path+'/route.ts','utf8'),methods=[...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)].map(m=>m[1]);assert.ok(methods.length);
      for(const method of methods){const result=await context.request.fetch(base+'/api/'+path.replace('[quoteId]','00000000-0000-4000-8000-000000000001'),{method,...(method==='GET'?{}:{data:'{}',headers:{'Content-Type':'application/json'}})});assert.equal(result.status(),410,'Retired API '+method+' '+path);assert.deepEqual(Object.keys(await result.json()),['error']);testedHandlers++;}}
    results.checks.retiredHandlers=testedHandlers;
    results.checks.retiredRoutesOff={routes:RETIRED_API_PATHS.length,noData:true};
  }
  const response = await page.goto(base + route); assert.equal(response.status(), 200); assert.equal(response.headers()["cross-origin-embedder-policy"], "require-corp"); assert.ok(!response.headers()["content-security-policy"].includes("'unsafe-eval'"));
  assert.match(response.headers()["content-security-policy"], /connect-src 'self';/, 'Page fetch policy must remain self-only; Blob fetch is worker-only');
  await ready();
  await page.getByTestId("licence-status").filter({hasText:"Licensed: Scale"}).waitFor();results.checks.signedLicence=true;
  dataPlaneActive = true;
  for(const name of ['vault-ram-worker.js','duckdb-eh.wasm']) {
    const pattern='**/spike/'+name;
    await context.route(pattern,async r=>{
      const original=await r.fetch();assert.equal(original.status(),200);
      const bytes=await original.body(),wasm=name.endsWith('.wasm');
      // Semantically neutral mutations: without integrity enforcement these
      // assets still execute normally, so a parser error cannot pass this probe.
      const changed=Buffer.concat([bytes,wasm?Buffer.from([0,1,0]):Buffer.from('\n/* synthetic integrity mutation */\n')]);
      if(wasm)assert.ok(WebAssembly.validate(changed),'Tampered WASM must remain valid');
      else new Script(changed.toString('utf8'));
      await r.fulfill({status:200,contentType:wasm?'application/wasm':'text/javascript',body:changed});
    });
    try { results.checks['rejectTampered-'+name]=await worker('assetRejection'); }
    finally { await context.unroute(pattern); }
  }
  if (makeFixture) {
    const raw = await worker("fixture");
    await mkdir("tests/fixtures/vault", { recursive: true }); await writeFile("tests/fixtures/vault/v1.enc", Buffer.from(Object.values(raw)));
    console.log("Created committed synthetic encrypted v1 fixture.");
  }
  if (process.argv.includes("--margin-bench")) { const m = await worker("marginBenchmark", { rows: Number(process.env.MARGIN_BENCH_ROWS || 2000000) }, 900000); console.log(JSON.stringify(m, null, 2)); await writeFile(`test-results/vault-margin-bench-${channel}.json`, JSON.stringify({ date: new Date().toISOString(), browser: results.browser, machine: results.machine, margin2M: m }, null, 2)); process.exit(0); }
  if(process.argv.includes('--pricing-bench')){const m=await worker('pricingBenchmark',{},900000);console.log(JSON.stringify(m,null,2));await writeFile('test-results/pricing-benchmark-'+channel+'.json',JSON.stringify({browser:results.browser,machine:results.machine,...m},null,2));process.exit(0);}
  if(process.argv.includes('--phase5a-bench')){const m=await worker('phase5aBenchmark',{},900000);console.log(JSON.stringify(m,null,2));await writeFile('test-results/phase5a-benchmark-'+channel+'.json',JSON.stringify({browser:results.browser,machine:results.machine,...m},null,2));process.exit(0);}
  if(process.argv.includes('--pricing-only')){console.log(JSON.stringify(await worker('pricing',{},600000),null,2));process.exit(0);}
  await ready();assert.equal(await page.getByTestId('browser-support-notice').count(),0,'Supported browser is incorrectly flagged unsupported');results.checks.browserSupport=true;
  results.checks.pricingTools=await worker("pricingTools",{},180000);console.log("7C-2 worker transactions, audit, role denial and encrypted reload: PASS");
  results.checks.pricingOps=await worker("pricingOps",{},180000);console.log("7C-1 worker transactions, audit and encrypted reload: PASS");
  if(process.argv.includes("--pricing-ops-only")){console.log(JSON.stringify(results.checks.pricingOps));process.exit(0);}
  const fixture = await readFile("tests/fixtures/vault/v1.enc");
  results.checks.v1 = await worker("v1", { bytes: new Uint8Array(fixture) });
  results.checks.integrity = await worker("integrity");
  results.checks.studio = await worker("studio");
  results.checks.currency = await worker("currency");
  results.checks.monitor = await worker("monitor");
  results.checks.rebates = await worker("rebates",{},180000);
  results.checks.suppliers = await worker("suppliers",{},180000);
  results.checks.reports = await worker("reports",{},180000);
  { const r=await worker("converters",{},240000); parquetFixture=Buffer.from(r.parquetBytes,'base64'); delete r.parquetBytes; results.checks.converters=r; }
  results.checks.warmup = await worker("warmup");
  results.checks.mapper = await worker("mapper");
  results.checks.playground = await worker("playground");
  results.checks.margin = await worker("margin");
  results.checks.legacyStorage = await worker("legacyStorage",{},120000);
  results.checks.pricing = await worker("pricing",{},600000);
  results.checks.phase5a = await worker("phase5a",{},600000);
  // The recovery suite intentionally deleted every OPFS handle, including the shell’s empty scope. Reinitialise it.
  await page.reload(); await ready();
  if (process.argv.includes("--margin-only")) { console.log(JSON.stringify(results.checks.margin, null, 2)); process.exit(0); }
  await page.getByLabel("Vault passphrase").fill(secret); await page.getByLabel("Pricing Owner (name)").fill("Synthetic Pricing Owner");
  assert.ok(await page.getByRole("button", { name: "Create encrypted vault", exact: true }).isEnabled()); await page.getByLabel("Pricing Owner (name)").fill(""); assert.ok(await page.getByRole("button", { name: "Create encrypted vault", exact: true }).isDisabled(), "A vault can be created without naming the Pricing Owner");
  await page.getByLabel("Pricing Owner (name)").fill("Synthetic Pricing Owner"); await page.getByRole("button", { name: "Create encrypted vault", exact: true }).click();
  await page.getByRole("button", { name: "Lock vault", exact: true }).waitFor();
  await page.getByRole("link", { name: "Data Hub", exact: true }).click();
  const csvPath = path.resolve("test-results", marker + ".csv"); await writeFile(csvPath, csv(100000));
  await page.evaluate(() => { window.__vaultLongTasks = []; });
  const start = performance.now();
  await importFiles([csvPath], 100000);
  results.measurements.import100kMs = Math.round(performance.now() - start);
  const tasks = await page.evaluate(() => window.__vaultLongTasks); results.measurements.maxImportLongTaskMs = Math.max(0, ...tasks); assert.ok(results.measurements.maxImportLongTaskMs <= 200, "Import blocked main thread for over 200 ms");
  await page.getByRole("link", { name: "Reports", exact: true }).click(); await page.getByRole("button", { name: "Verify audit chain" }).click(); await page.getByRole("status").filter({ hasText: /Audit chain verified/ }).waitFor();
  await page.getByRole("link", { name: "Margin", exact: true }).click(); await page.getByRole("heading", { name: "Margin waterfall" }).waitFor(); await page.getByTestId("wf-margin").waitFor();
  await page.getByRole("link", { name: "Data Hub", exact: true }).click();
  const capPath = path.resolve("test-results", "synthetic-over-cap.csv"); await writeFile(capPath, csv(100001, 200001));
  await review([capPath]);
  await page.getByRole("alert").filter({ hasText: /exceeds your starter limit/i }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Confirm and import locally" }).isDisabled(), "Over-cap batch must not be importable");
  assert.equal(await page.getByTestId("line-count").getAttribute("data-value"), "100000"); assert.match(await page.getByRole("alert").filter({hasText:/exceeds your starter limit/i}).innerText(),/upgrade/i);results.checks.licenceUpgradePrompt=true;results.checks.capRollback = true; await clearBatch();
  const invalid = path.resolve("test-results", "synthetic-invalid.csv"); await writeFile(invalid, header + `1,1,1,2025-01-01,1,${marker},0.00,0.00,0.00,1.00\n`);
  await review([invalid]);
  await page.getByText(/Row 2, column F: Use a non-negative amount/).waitFor(); await page.getByRole("alert").filter({ hasText: /No valid rows to load/ }).waitFor();
  results.checks.invalidCellNoLeak = true; await clearBatch();
  const duplicate = path.resolve("test-results", "synthetic-duplicate.csv"), oneRow = csv(1).toString().slice(header.length);
  await writeFile(duplicate, header + oneRow + oneRow); await review([duplicate]);
  await page.getByText(/Row 2: Already loaded from another file/).waitFor(); await page.getByText(/Row 3: Exact copy of an earlier row/).waitFor();
  assert.equal(await page.getByTestId("line-count").getAttribute("data-value"), "100000"); results.checks.locatedDuplicate = true; await clearBatch();
  const cancelPath = path.resolve("test-results", "synthetic-cancel.csv"); await writeFile(cancelPath, csv(1000000, 300001));
  await page.getByTestId("studio-files").setInputFiles(cancelPath); await page.getByRole("button", { name: "Review import" }).click();
  await page.getByRole("button", { name: "Cancel import" }).click(); await page.getByRole("alert").filter({ hasText: /Import cancelled/ }).waitFor();
  assert.equal(await page.getByTestId("line-count").getAttribute("data-value"), "100000"); results.checks.cancelRollback = true; await clearBatch();
  // Privacy gate across formats: the marker sits in product_id inside TSV, JSON, XML and XLSX files.
  const marked = fixtures.markedSales(marker, 600001).map(f => ({ ...f, path: path.resolve("test-results", f.name) }));
  for (const f of marked) await writeFile(f.path, f.bytes);
  await review(marked.map(f => f.path));
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all as ZIP" }).click()]);
  assert.equal(download.suggestedFilename(), "rebatehq-converted.zip"); assert.ok((await readFile(await download.path())).length > 100, "Converted ZIP is empty");
  await page.getByRole("button", { name: "Confirm and import locally" }).click();
  await page.locator('[data-testid="line-count"][data-value="100016"]').waitFor({ timeout: 120000 });
  results.checks.multiFormatImport = { files: marked.map(f => f.name), lines: 16 };
  await page.getByRole("link", { name: "Settings", exact: true }).click(); await page.getByRole("button", { name: "Request persistent storage" }).click();
  await page.getByRole("status").filter({ hasText: /Storage status refreshed/ }).waitFor(); results.checks.storage = await worker("storage");
  if(channel === "firefox")assert.equal(results.checks.storage.persistent,true,"Granted persistent-storage permission did not take effect");
  results.checks.cipherOnly = await worker("cipherOnly");
  // A killed renderer cannot complete a pagehide save. Success must already be durable.
  if(channel === 'firefox') await page.evaluate(() => { for(const worker of window.__vaultWorkers)worker.terminate(); });
  else { const cdp = await context.newCDPSession(page); await Promise.race([cdp.send('Page.crash').catch(() => undefined), new Promise(resolve => setTimeout(resolve,3000))]); }
  await page.close().catch(() => undefined);
  page = await openPage(); await page.goto(base + route); await ready(); await unlock(); assert.equal(await page.getByTestId("line-count").getAttribute("data-value"), "100016"); results.checks.killedTabRecovery = true;
  await page.getByRole("button", { name: "Lock vault", exact: true }).click(); await ready();
  await page.getByLabel("Vault passphrase").fill("deliberately-wrong-passphrase"); await page.getByRole("button", { name: "Unlock vault", exact: true }).click(); await page.getByRole("alert").filter({ hasText: /Wrong passphrase/ }).waitFor(); results.checks.wrongPassphrase = true;
  await unlock(); await page.reload(); await ready(); await unlock(); assert.equal(await page.getByTestId("line-count").getAttribute("data-value"), "100016"); results.checks.reload = true;
  // First change straight after unlock: the import waits for the background warm-up instead of failing.
  await page.getByRole("link", { name: "Data Hub", exact: true }).click();
  const afterReload = path.resolve("test-results", "synthetic-after-reload.csv"); await writeFile(afterReload, csv(1, 700001));
  await importFiles([afterReload], 100017);
  await page.reload(); await ready(); await unlock(); assert.equal(await page.getByTestId("line-count").getAttribute("data-value"), "100017"); results.checks.firstMutationAfterUnlock = true;
  // 6A: storage near quota. The origin quota is cut to current usage + 64 KiB, so the next encrypted save cannot fit.
  const quotaCdp = channel === 'firefox' ? null : await context.newCDPSession(page), origin = new URL(base).origin;
  const setQuota = async on => {
    if(quotaCdp) return quotaCdp.send('Storage.overrideQuotaForOrigin',on?{origin,quotaSize:await page.evaluate(async()=>(await navigator.storage.estimate()).usage)+65536}:{origin});
    quotaActive=on; await page.evaluate(on=>{for(const w of window.__vaultWorkers)w.postMessage({__opfsQuotaTest:on});},on);
  };
  const nearQuota = path.resolve("test-results", "synthetic-near-quota.csv"); await writeFile(nearQuota, csv(1, 700002));
  const importOverQuota = async () => {
    await page.getByRole("link", { name: "Data Hub", exact: true }).click(); await review([nearQuota]);
    await page.getByRole("button", { name: "Confirm and import locally" }).click();
    await page.getByRole("alert").filter({ hasText: /could not be saved/ }).waitFor({ timeout: 120000 });
    await page.getByText("A change is not yet saved").waitFor();
  };
  await setQuota(true); await importOverQuota();
  // The failed save left the previous encrypted snapshot intact: a reload drops only the unsaved change.
  await page.reload(); await ready(); await unlock(); assert.equal(await page.getByTestId("line-count").getAttribute("data-value"), "100017", "A failed save damaged or replaced the previous snapshot");
  // Fail again, free space, and Retry Save makes the same change durable.
  await importOverQuota(); await setQuota(false);
  await page.getByRole("button", { name: "Retry Save", exact: true }).click(); await page.getByRole("status").filter({ hasText: "Encrypted save completed." }).waitFor({ timeout: 120000 });
  await page.reload(); await ready(); await unlock(); assert.equal(await page.getByTestId("line-count").getAttribute("data-value"), "100018"); await quotaCdp?.detach().catch(() => undefined);
  results.measurements.quotaMechanism = channel === 'firefox' ? 'OPFS QuotaExceededError injection (test only)' : 'CDP origin quota';
  results.measurements.terminationMechanism = channel === 'firefox' ? 'terminate workers without lock/save' : 'CDP renderer crash';
  results.checks.nearQuota = { failedSaveKeptPreviousSnapshot: true, retryAfterFreeingSpaceSaved: true };
  // Real-world shaped export (InvoiceNo/StockCode/UnitPrice, M/D/YY dates, blank customers): mapping must be
  // confirmed, rejected rows go to Fix Later, a bulk fix and group re-check loads them. Marker sits in StockCode.
  await page.getByRole("link", { name: "Data Hub", exact: true }).click();
  const retail = path.resolve("test-results", "retail-like.csv"); await writeFile(retail, fixtures.retailLike(marker).bytes);
  await page.getByTestId("studio-files").setInputFiles(retail); await page.getByRole("button", { name: "Review import" }).click();
  await page.getByRole("alert").filter({ hasText: /check the column mapping/ }).waitFor();
  // The preview panel opens automatically for the file just added.
  await page.getByRole("table", { name: /Column mapping for retail-like.csv/ }).waitFor();
  assert.equal(await page.getByLabel("Source for list_amount").inputValue(), "unit:5", "UnitPrice x quantity should be suggested");
  await page.getByLabel("I checked this mapping").check();
  // Wait until the worker has saved the confirmation, not just the optimistic tick.
  await page.getByText("Check the column mapping below and confirm it.").waitFor({ state: "detached", timeout: 30000 });
  await page.getByRole("button", { name: "Review import" }).click(); await page.getByRole("heading", { name: "Batch report" }).waitFor();
  await page.getByText(/sale_date: expanded two-digit years/).waitFor();
  await page.getByRole("checkbox", { name: /Load the 20 valid rows/ }).check();
  await page.getByRole("button", { name: "Confirm and import locally" }).click();
  await page.locator('[data-testid="line-count"][data-value="100038"]').waitFor({ timeout: 120000 });
  await page.getByLabel("New customer_id for all rows in this group").fill("CASH-SALE");
  await page.getByRole("button", { name: "Set customer_id for all rows" }).click(); await page.getByRole("status").filter({ hasText: /Re-check the group/ }).waitFor();
  await page.getByRole("button", { name: "Re-check and load customer_id rows" }).click();
  await page.locator('[data-testid="line-count"][data-value="100040"]').waitFor({ timeout: 60000 });
  await page.getByRole("heading", { name: /^Data health: \d+%$/ }).waitFor();
  results.checks.mappingAndFixLater = { confirmedMapping: true, loaded: 20, fixedThenLoaded: 2 };
  // 4D: the cancellation row loads from Fix Later as a credit line, then the Margin UI is driven end to end.
  await page.getByRole("button", { name: "Load negative-quantity rows of retail-like.csv as returns and credits" }).click();
  await page.locator('[data-testid="line-count"][data-value="100041"]').waitFor({ timeout: 60000 });
  // The retail-like fixture's invoices span several customers: reconciliation must flag them, never adjust them.
  const diffs = page.getByRole("table", { name: "Reconciliation differences" }); await diffs.waitFor({ timeout: 60000 });
  const levels = await diffs.locator("tbody tr td:nth-child(2)").allInnerTexts();
  assert.ok(levels.length > 0 && levels.every(l => l === "Invoice"), `Unexpected reconciliation differences: ${levels.join(",")}`);
  await page.getByRole("button", { name: "Accept all differences" }).click();
  await page.getByTestId("recon-ok").waitFor({ timeout: 60000 });
  results.checks.reconciliation = { invoiceSplitsFlagged: levels.length, accepted: true };
  await page.getByRole("link", { name: "Margin", exact: true }).click();
  await page.getByTestId("wf-credits").filter({ hasText: /^-\$27\.50$/ }).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Show the math for Discounts", exact: true }).click();
  await page.getByRole("heading", { name: "Show the math: Discounts" }).waitFor();
  await page.getByText(/Recomputed by the margin engine from these inputs: same to the cent/).waitFor();
  await page.getByText(/source lines add up to it/).waitFor();
  await page.getByRole("table", { name: "Source rows" }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTestId("leak-total").waitFor({ timeout: 60000 });
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Leak Report (PDF)" }).click()]);
  const pdfBytes = await readFile(await pdf.path());
  assert.ok(/^rebatehq-leak-report-\d{4}-\d{2}-\d{2}\.pdf$/.test(pdf.suggestedFilename()) && pdfBytes.subarray(0, 8).toString("latin1") === "%PDF-1.4" && pdfBytes.toString("latin1").includes("Margin Leak Report"), "Leak Report PDF download malformed");
  await page.getByRole("status").filter({ hasText: /nothing was uploaded/ }).waitFor();
  await page.getByRole("link", { name: "Home", exact: true }).click(); await page.getByTestId("roi-total").waitFor();
  results.checks.marginUi = { creditLoaded: true, mathPanel: true, leakReportBytes: pdfBytes.length, roiTracker: true };
  // 5A UI: role banner, 7-day checklist, cleanup and cost basis panels, and a role preview that hides cost.
  await page.getByTestId("setup-checklist").waitFor();
  assert.match(await page.getByTestId("setup-progress-text").innerText(), /of 7 steps done/);
  assert.equal(await page.getByTestId("setup-import").getAttribute("data-done"), "yes", "A real import did not complete the first checklist step");
  assert.equal(await page.getByTestId("setup-team").getAttribute("data-done"), "no");
  await page.getByTestId("role-banner").getByText("Owner / CFO").waitFor();
  await page.getByRole("link", { name: "Data Hub", exact: true }).click();
  await page.getByTestId("cleanup").waitFor({ timeout: 60000 }); await page.getByTestId("cost-basis").waitFor({ timeout: 60000 });
  await page.getByRole("table", { name: "Margin by cost basis" }).waitFor();
  await page.getByRole("link", { name: "Settings", exact: true }).click(); await page.getByTestId("roles").waitFor();
  await page.getByLabel("Preview as").selectOption("sales_rep"); await page.getByTestId("preview-banner").waitFor();
  for (const hidden of ["Margin", "Data Hub", "Settings"]) assert.equal(await page.getByRole("link", { name: hidden, exact: true }).count(), 0, `${hidden} is visible in the Sales Rep preview`);
  await page.getByRole("link", { name: "Home", exact: true }).click(); await page.getByText("Cost and margin are not shown to this role.").waitFor();
  assert.equal(await page.getByTestId("roi-total").count(), 0, "The Sales Rep preview shows the ROI total"); assert.equal(await page.getByTestId("home-margin").count(), 0, "The Sales Rep preview shows margin");
  await page.getByRole("button", { name: "Return to my own view" }).click(); await page.getByTestId("preview-banner").waitFor({ state: "detached" });
  await page.getByRole("link", { name: "Margin", exact: true }).waitFor(); await page.getByTestId("roi-total").waitFor();
  results.checks.roleViewsUi = { banner: true, checklist: true, cleanupPanel: true, costBasisPanel: true, repPreviewHidesCost: true };

  // 4E: UI flow stays under the same marker sensors, including --auth in CI.
  await page.getByRole('link',{name:'Data Hub',exact:true}).click();
  if(await page.getByRole('button',{name:'Clear batch',exact:true}).isVisible())await clearBatch();
  const priceSku=marker+'-4E',expirySku=marker+'-EXP',expiryDate=new Date(Date.now()+14*86400000).toISOString().slice(0,10);const files4E={
    'pricing-items.csv':'product_id,description,category,uom,current_cost,list_price\n'+priceSku+',Private pricing item,Privacy category,EA,66.00,100.00\n'+expirySku+',Expiry fixture,Expiry category,EA,50.00,70.00\n',
    'pricing-contracts.csv':'product_id,customer_id,price,valid_from,valid_to\n'+expirySku+',E-CUSTOMER,70.00,2025-01-01,'+expiryDate+'\n',
    'pricing-customers.csv':'customer_id,name,tier,branch\nE-CUSTOMER,Private customer,E-TIER,East\n',
    'pricing-costs.csv':'vendor,product_id,cost,effective_date\nPrivacy Mills,'+priceSku+',60.00,2025-01-01\nPrivacy Mills,'+priceSku+',66.00,2025-02-01\n',
    'pricing-sales.csv':header+'9000001,'+priceSku+',E-CUSTOMER,2025-03-01,1,100.00,10.00,1.00,0.00,66.00\n'
  };const pricePaths=[];for(const [name,body]of Object.entries(files4E)){const file=path.resolve('test-results',name);await writeFile(file,body);pricePaths.push(file);}
  const oldCount=BigInt(await page.getByTestId('line-count').getAttribute('data-value'));await importFiles(pricePaths,String(oldCount+BigInt(1)));
  await page.getByRole('link',{name:'Settings',exact:true}).click();
  await page.evaluate(()=>{window.showDirectoryPicker=async()=>await(await navigator.storage.getDirectory()).getDirectoryHandle('privacy-backup-seam',{create:true});});
  await page.getByRole('button',{name:'Choose backup folder',exact:true}).click();await page.getByRole('status').filter({hasText:'Encrypted folder backup written.'}).waitFor();
  await page.getByRole('link',{name:'Pricing',exact:true}).click();await page.getByLabel('Pricing Owner name',{exact:true}).fill('Synthetic Pricing Owner');
  await page.getByRole('button',{name:'Name me as Pricing Owner',exact:true}).click();await page.getByRole('status').filter({hasText:'Pricing Owner saved.'}).waitFor();
  for(const [label,value]of Object.entries({'Customer tier':'E-TIER','Product category':'Privacy category','Start price (cents)':'11000','Target price (cents)':'10500','Floor price (cents)':'9500'}))await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Save guardrails',exact:true}).click();await page.getByRole('status').filter({hasText:'Guardrails saved.'}).waitFor();
  for(const [label,value]of Object.entries({'Rule name':marker+' rule','Rule category':'Privacy category','Cost source (supplier)':'Privacy Mills','Cost rise threshold (%)':'5','Price increase (%)':'4.5'}))await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Save rule version',exact:true}).click();await page.getByRole('status').filter({hasText:'Rule version saved.'}).waitFor();
  await page.getByRole('button',{name:'Simulate price change',exact:true}).click();await page.getByRole('heading',{name:'Change preview',exact:true}).waitFor();
  await page.getByRole('cell',{name:'⚠ Yellow · owner review',exact:true}).waitFor();await page.getByRole('cell',{name:'$104.50',exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Approve as Pricing Owner',exact:true}).click();await page.getByRole('heading',{name:'Export Studio',exact:true}).waitFor();
  const outputs=[];const capture=d=>outputs.push(d);page.on('download',capture);await page.getByRole('button',{name:'Export prices and change log',exact:true}).click();
  await page.getByRole('status').filter({hasText:/unverified until tested on a real import/}).waitFor();assert.equal(outputs.length,2,'Missing ERP export or change log');
  for(const d of outputs){const bytes=await readFile(await d.path());assert.ok(bytes.includes(Buffer.from('104.50')),'Export omitted approved cents');}
  page.off('download',capture);
  await page.getByRole('link',{name:'Settings',exact:true}).click();const encrypted=page.waitForEvent('download');await page.getByRole('button',{name:'Download encrypted backup',exact:true}).click();const enc=await encrypted;assert.ok((await readFile(await enc.path())).subarray(0,8).toString()==='MDVAULT1','Backup export is not encrypted');
  if(!auth){await page.getByRole('button',{name:'Use licensed capacity',exact:true}).click();await page.getByRole('status').filter({hasText:'Licensed capacity applied'}).waitFor();results.checks.licensedCapacityUpgrade=true;}
  results.checks.pricingUi={owner:true,guardrails:true,rule:true,simulation:true,preview:true,approval:true,erpExportAndLog:true,folderHandleSeam:true,encryptedBackup:true};


  // 7C-1: every operation stays under the same real authenticated privacy sensors.
  const opsShot=async name=>{if(!auth)await page.screenshot({path:`test-results/7c-${channel}-${name}.png`,fullPage:true});};
  const invoiceRowsBefore=await page.getByTestId('line-count').getAttribute('data-value');
  await page.locator('nav a[href="#margin"]').click();await page.getByRole('link',{name:'Margin bridge',exact:true}).click();await page.getByTestId('bridge-delta').waitFor();
  const bridgeValue=async k=>BigInt(await page.getByTestId('bridge-'+k).getAttribute('data-value'));
  assert.equal(await bridgeValue('delta'),await bridgeValue('price')+await bridgeValue('volume')+await bridgeValue('mix')+await bridgeValue('cost'),'UI bridge does not reconcile');
  await page.getByRole('combobox',{name:'Drill down',exact:true}).selectOption('branch');await page.getByRole('button',{name:'Show results',exact:true}).click();await page.getByRole('table',{name:'Drill down'}).getByRole('columnheader',{name:'Branch',exact:true}).waitFor();await opsShot('bridge');
  await page.locator('nav a[href="#pricing"]').click();await page.getByRole('link',{name:'Increase planner',exact:true}).click();await page.getByRole('combobox',{name:'Segment value',exact:true}).selectOption('Privacy category');await page.getByLabel('Increase (%)',{exact:true}).fill('5');
  await page.getByRole('button',{name:'Create increase preview',exact:true}).click();await page.getByTestId('ops-draft').waitFor();
  const letterEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download draft increase letter',exact:true}).click();const letterText=await readFile(await(await letterEvent).path(),'utf8');assert.ok(letterText.includes('5')&&!letterText.includes('66.00'),'Letter leaked cost or omitted rate');await opsShot('planner');
  await page.getByRole('button',{name:'Review draft and approval',exact:true}).click();await page.getByRole('cell',{name:'$109.73',exact:true}).first().waitFor();await page.getByRole('button',{name:'Approve as Pricing Owner',exact:true}).click();await page.getByRole('heading',{name:'Export Studio',exact:true}).waitFor();
  await page.getByRole('link',{name:'Price versions',exact:true}).click();await page.getByRole('button',{name:'Draft reversal',exact:true}).first().waitFor();await opsShot('versions');await page.getByRole('button',{name:'Draft reversal',exact:true}).first().click();await page.getByTestId('ops-draft').waitFor();await page.getByRole('button',{name:'Review draft and approval',exact:true}).click();await page.getByRole('cell',{name:'$104.50',exact:true}).first().waitFor();await page.getByRole('button',{name:'Approve as Pricing Owner',exact:true}).click();await page.getByRole('heading',{name:'Export Studio',exact:true}).waitFor();
  const reversed=[];const collect=d=>reversed.push(d);page.on('download',collect);await page.getByRole('button',{name:'Export prices and change log',exact:true}).click();await page.getByRole('status').filter({hasText:/unverified until tested on a real import/}).waitFor();page.off('download',collect);assert.equal(reversed.length,2);for(const d of reversed)assert.ok((await readFile(await d.path())).includes(Buffer.from('104.50')),'Reversal export differs');
  await page.getByRole('link',{name:'Price exceptions',exact:true}).click();await page.getByTestId('price-exceptions').waitFor();await page.getByLabel('Product',{exact:true}).fill(priceSku);await page.getByRole('button',{name:'Show results',exact:true}).click();await page.getByRole('table',{name:'Price exceptions'}).getByRole('cell',{name:priceSku,exact:true}).first().waitFor();await opsShot('exceptions');
  await page.getByRole('link',{name:'Contract expiry',exact:true}).click();await page.getByRole('table',{name:'Contract expiry'}).getByRole('cell',{name:expirySku,exact:true}).waitFor();await opsShot('expiry');
  assert.equal(await page.getByTestId('line-count').getAttribute('data-value'),invoiceRowsBefore,'Pricing ops changed invoice row counts');
  results.checks.pricingOpsUi={bridgeReconciles:true,branchDrill:true,planner:true,letter:true,ownerApproval:true,reversalDraft:true,reversalExport:true,exceptionsSourceRows:true,contractExpiry:true,invoiceRowsUnchanged:true};


  // 7C-2: new screens remain inside the authenticated request/console marker sensors.
  await page.getByRole('link',{name:'Price grid',exact:true}).click();await page.getByTestId('price-grid').waitFor();await page.getByLabel('Filter product, category or customer',{exact:true}).fill(priceSku);await page.getByRole('button',{name:'Load local rows',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-testid=price-grid]')?.getAttribute('aria-busy')==='false');await page.waitForFunction(sku=>document.querySelector('[data-testid=grid-price-0]')?.getAttribute('aria-label')==='New unit price '+sku,priceSku);
  // Gecko discards constructor-supplied clipboardData on an untrusted ClipboardEvent.
  // Supply the same DataTransfer on a bubbling paste event in every browser; this
  // exercises the real React handler and parser without touching the OS clipboard.
  await page.getByTestId('grid-price-0').evaluate(el=>{const transfer=new DataTransfer();transfer.setData('text/plain','120.01');const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:transfer});el.dispatchEvent(event);});await page.waitForFunction(()=>document.querySelector('[data-testid="grid-price-0"]')?.value==='120.01');
  await opsShot('grid');await page.getByTestId('grid-review').click();await page.getByRole('heading',{name:'Change preview',exact:true}).waitFor();await page.getByRole('cell',{name:'$120.01',exact:true}).first().waitFor();await page.getByRole('button',{name:'Approve as Pricing Owner',exact:true}).click();await page.getByRole('heading',{name:'Export Studio',exact:true}).waitFor();
  const gridDownloads=[];const receive=d=>gridDownloads.push(d);page.on('download',receive);await page.getByRole('button',{name:'Export prices and change log',exact:true}).click();await page.getByText('Generic file only: preserve the price kind, category, customer, quantity break and dates. Test with your ERP before applying.',{exact:true}).waitFor();page.off('download',receive);assert.equal(gridDownloads.length,2);
  const gridBytes=await readFile(await gridDownloads[0].path());await page.getByRole('link',{name:'Price-change landed check',exact:true}).click();await page.getByTestId('landed-check').waitFor();await page.getByTestId('landed-check').locator('input[type=file]').setInputFiles({name:'synthetic-next-erp.csv',mimeType:'text/csv',buffer:gridBytes});await page.getByRole('button',{name:'Compare locally',exact:true}).click();await page.getByText('1 of 1 exported rows applied.',{exact:true}).waitFor();await opsShot('landed');
  await page.getByRole('link',{name:'Rules and previews',exact:true}).click();await page.getByLabel('Saved rule',{exact:true}).selectOption({index:1});const slider=page.getByTestId('what-if').locator('input[type=range]');await slider.focus();await slider.press('ArrowRight');await page.getByTestId('what-if').getByText('Exact rounded impact on release. Save the rate, then simulate to create an approvable draft.',{exact:true}).waitFor();
  await page.locator('nav a[href="#margin"]').click();await page.getByRole('link',{name:'Competitor prices',exact:true}).click();await page.getByTestId('competitor-product').fill(priceSku);await page.getByLabel('Competitor',{exact:true}).fill(marker+' competitor');await page.getByLabel('New unit price',{exact:true}).fill('119.01');await page.getByLabel('Source (plain text; never fetched)',{exact:true}).fill(marker+' local note');await page.getByRole('button',{name:'Save observation locally',exact:true}).click();await page.getByRole('cell',{name:marker+' competitor',exact:true}).waitFor();await page.getByRole('cell',{name:'$119.01',exact:true}).waitFor();await opsShot('competitors');
  await page.getByRole('link',{name:'Cost to serve',exact:true}).click();await page.getByTestId('service-orders').waitFor();assert.equal(await page.getByTestId('line-count').getAttribute('data-value'),invoiceRowsBefore);
  results.checks.pricingToolsUi={excelPaste:true,ownerApproval:true,scopeExport:true,landed:true,exactSlider:true,competitor:true,costToServe:true,invoiceRowsUnchanged:true};

  // 7V-3a grid standard: sort, multi-value filter, "N of M", selection totals (worker/DuckDB) on every kind of grid.
  await page.evaluate(()=>{location.hash='#margin';});const drillGrid=page.getByTestId('drill-table');await drillGrid.waitFor({timeout:60000});
  await drillGrid.getByTestId('grid-sort-lines').click();await drillGrid.locator('th[aria-sort="ascending"]').waitFor();
  await until(async()=>ordered((await gridColumn(drillGrid,3)).map(intOf),'asc'),'Drill-down did not sort by lines in the worker');
  await drillGrid.getByTestId('grid-sort-lines').click();await drillGrid.locator('th[aria-sort="descending"]').waitFor();
  await until(async()=>ordered((await gridColumn(drillGrid,3)).map(intOf),'desc'),'Drill-down did not sort descending');
  await drillGrid.getByTestId('grid-filter-key').click();const panel=page.getByRole('dialog',{name:/^Filter /});await panel.getByRole('list').waitFor();
  await panel.getByRole('button',{name:'Select none',exact:true}).click();await panel.getByRole('list').getByRole('checkbox').nth(1).check();await panel.getByTestId('grid-filter-apply').click();
  await drillGrid.getByTestId('grid-count').filter({hasText:/^1 of [\d,]+ rows$/}).waitFor();await until(async()=>(await drillGrid.locator('tbody tr').count())===1,'Filter did not narrow the drill-down to one group');
  const oneLines=intOf((await gridColumn(drillGrid,3))[0]);await drillGrid.getByTestId('grid-select-all').check();
  const linesTotal=drillGrid.getByTestId('grid-total-lines');await linesTotal.waitFor();assert.equal(await linesTotal.getAttribute('data-sum'),oneLines,'Totals of all matching rows differ from the row');assert.equal(await linesTotal.getAttribute('data-count'),'1');
  await drillGrid.getByRole('button',{name:'Clear filters',exact:true}).click();await drillGrid.getByTestId('grid-count').waitFor({state:'detached'});
  await until(async()=>(await drillGrid.locator('tbody tr').count())>=3,'Drill-down did not reload every group after clearing the filter');const picks=drillGrid.getByTestId('grid-select');await picks.nth(0).click();await drillGrid.getByTestId('grid-status').filter({hasText:'1 row selected'}).waitFor();await picks.nth(2).click({modifiers:['Shift']});
  const pocketCells=(await gridColumn(drillGrid,7)).slice(0,3).map(centsOf),pocketTotal=drillGrid.getByTestId('grid-total-pocket');
  await until(async()=>(await pocketTotal.getAttribute('data-count'))==='3','Shift-click did not select a range of three rows');
  assert.equal(await pocketTotal.getAttribute('data-sum'),String(pocketCells.reduce((a,b)=>a+BigInt(b),0n)),'Selection total differs from the selected cells');
  await page.getByRole('link',{name:'Data Hub',exact:true}).click();const basisGrid=page.getByTestId('cost-basis-grid');await basisGrid.waitFor({timeout:60000});
  await basisGrid.getByTestId('grid-sort-lines').click();await basisGrid.getByTestId('grid-sort-lines').click();await until(async()=>ordered((await gridColumn(basisGrid,3)).map(intOf),'desc'),'Browser grid did not sort numerically');
  await basisGrid.getByTestId('grid-select-all').check();const basisLines=(await gridColumn(basisGrid,3)).map(intOf);const basisTotal=basisGrid.getByTestId('grid-total-lines');await basisTotal.waitFor();
  assert.equal(await basisTotal.getAttribute('data-sum'),String(basisLines.reduce((a,b)=>a+BigInt(b),0n)),'Browser-grid totals differ from the cells');
  await page.locator('nav a[href="#pricing"]').click();await page.getByRole('link',{name:'Price grid',exact:true}).click();await page.getByLabel('Filter product, category or customer',{exact:true}).fill('');await page.getByRole('button',{name:'Load local rows',exact:true}).click();
  const priceTable=page.getByTestId('price-grid-table');await priceTable.waitFor();await priceTable.getByTestId('grid-sort-price').click();await priceTable.getByTestId('grid-sort-price').click();await priceTable.locator('th[aria-sort="descending"]').waitFor();
  await until(async()=>{const v=(await gridColumn(priceTable,4)).map(centsOf);return v.length>1&&ordered(v,'desc');},'Price grid did not sort by price in the worker');
  // 7V-3b row notes: written under the same request/console marker sensors, so a note never leaves the device.
  const pickOnly=async(grid,col,value)=>{await grid.getByTestId('grid-filter-'+col).click();const panel=page.getByRole('dialog',{name:/^Filter /});await panel.getByTestId('grid-filter-search').fill(value);await panel.getByRole('checkbox',{name:new RegExp('^'+value+'\\b')}).first().waitFor();await panel.getByRole('button',{name:'Select none',exact:true}).click();await panel.getByRole('checkbox',{name:new RegExp('^'+value+'\\b')}).first().check();await panel.getByTestId('grid-filter-apply').click();await grid.getByTestId('grid-count').filter({hasText:/^1 of /}).waitFor();};
  await page.getByRole('link',{name:'Data Hub',exact:true}).click();const customerGrid=page.getByTestId('customer-grid');await customerGrid.waitFor({timeout:60000});
  await pickOnly(customerGrid,'customer_id','E-CUSTOMER');const customerNote=marker+' prefers email, call before quoting';
  await customerGrid.getByTestId('note-edit').click();await customerGrid.getByTestId('note-input').fill(customerNote);await customerGrid.getByTestId('note-save').click();await customerGrid.getByTestId('note-text').filter({hasText:customerNote}).waitFor();
  const itemGrid=page.getByTestId('item-grid');await itemGrid.waitFor();await pickOnly(itemGrid,'product_id',priceSku);await itemGrid.getByTestId('note-edit').click();
  await itemGrid.getByTestId('note-input').fill('x'.repeat(1001));await itemGrid.getByText('1,001 of 1,000 characters',{exact:true}).waitFor();assert.ok(await itemGrid.getByTestId('note-save').isDisabled(),'A note over 1,000 characters can be saved');
  const itemNote='Fragile '+marker+' <b>plain text</b> =SUM(A1)';await itemGrid.getByTestId('note-input').fill(itemNote);await itemGrid.getByTestId('note-save').click();await itemGrid.getByTestId('note-text').filter({hasText:itemNote}).waitFor();
  assert.equal(await itemGrid.locator('[data-testid="note-text"] b').count(),0,'A note was rendered as HTML');
  await page.getByRole('link',{name:'Home',exact:true}).click();await page.getByRole('link',{name:'Data Hub',exact:true}).click();await page.getByTestId('customer-grid').waitFor({timeout:60000});
  await pickOnly(page.getByTestId('customer-grid'),'notes',marker);await page.getByTestId('customer-grid').getByTestId('note-text').filter({hasText:customerNote}).waitFor();
  await page.keyboard.press('Control+k');await page.getByTestId('command-palette').waitFor();await page.getByTestId('command-palette').getByRole('combobox').fill(marker);
  await page.getByRole('option',{name:/E-CUSTOMER/}).waitFor({timeout:15000});await page.keyboard.press('Escape');await page.getByTestId('command-palette').waitFor({state:'hidden'});
  await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByLabel('Preview as').selectOption('sales_rep');await page.getByTestId('preview-banner').waitFor();
  await page.keyboard.press('Control+k');await page.getByTestId('command-palette').waitFor();await page.getByTestId('command-palette').getByRole('combobox').fill(marker);await page.waitForTimeout(1500);
  assert.equal(await page.getByRole('option',{name:/E-CUSTOMER/}).count(),0,'A Sales Rep can find a customer by its private note');assert.ok(!(await page.getByTestId('command-palette').innerText()).includes('prefers email'),'A Sales Rep sees a row note');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Return to my own view'}).click();await page.getByTestId('preview-banner').waitFor({state:'detached'});
  results.checks.notesUi={customerNote:true,itemNote:true,limit1000:true,plainText:true,persistsAndFilters:true,paletteSearch:true,repCannotSearchNotes:true,markerSensorsActive:true};
  results.checks.gridsUi={pagedWorkerSort:true,workerFilterOneOfN:true,totalsAllMatching:true,shiftRangeTotals:true,browserGridSort:true,browserGridTotals:true,priceGridSort:true,rebateTotalsInCurrency:'checked in rebatesUi'};

  // 7B: Price Check answers on Enter (barcode scanners send Enter), a below-floor quote asks for a
  // reason, the Owner sees margin, the Sales Rep preview never does, and the quote fits a phone.
  await page.getByRole('link',{name:'Quotes',exact:true}).click();
  await page.getByTestId('check-sku').fill(priceSku);await page.getByTestId('check-customer').fill('E-CUSTOMER');await page.getByTestId('check-customer').press('Enter');
  const checked=page.getByTestId('price-check-result');await checked.waitFor();assert.equal(await checked.getAttribute('data-zone'),'yellow','Price Check zone for a price below target');
  await page.getByRole('meter',{name:'Price position for '+priceSku}).first().waitFor();await page.getByTestId('credit-signal').getByText('Credit: unknown').waitFor();
  await page.getByRole('button',{name:'Quote',exact:true}).click();await page.getByTestId('quote-customer').fill('E-CUSTOMER');await page.getByTestId('quote-customer').press('Enter');
  await page.getByTestId('quote').waitFor();await page.getByTestId('add-sku').fill(priceSku);await page.getByTestId('add-sku').press('Enter');
  await page.getByTestId('price-1').waitFor();await page.getByTestId('price-1').fill('90.00');await page.getByRole('button',{name:'Update prices',exact:true}).click();
  await page.locator('[data-testid="quote"] tr[data-zone="red"]').waitFor();await page.getByText('A line is below its floor price.',{exact:false}).waitFor();
  assert.ok(await page.getByRole('button',{name:'Request exception',exact:true}).isDisabled(),'An exception can be requested without a reason');
  await page.getByTestId('exception-reason').fill('Competitor match');await page.getByRole('button',{name:'Request exception',exact:true}).click();
  await page.locator('[data-testid="quote"][data-status="pending"]').waitFor();await page.getByTestId('quote-margin').waitFor();
  await page.setViewportSize({width:375,height:812});
  const fits=await page.getByTestId('quote').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.getBoundingClientRect().right<=window.innerWidth+1);
  await page.setViewportSize({width:1280,height:900});assert.ok(fits,'The quote overflows a 375px phone screen');
  await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByLabel('Preview as').selectOption('sales_rep');await page.getByTestId('preview-banner').waitFor();
  await page.getByRole('link',{name:'Quotes',exact:true}).click();await page.getByRole('button',{name:'History',exact:true}).click();
  await page.getByRole('heading',{name:'Quote history',exact:true}).waitFor();await page.getByRole('table',{name:'Quote history',exact:true}).locator('tbody').getByRole('button').first().click();
  await page.locator('[data-testid="quote"][data-status="pending"]').waitFor();
  assert.equal(await page.getByTestId('quote-margin').count(),0,'The Sales Rep preview shows quote margin');
  assert.equal(await page.getByRole('columnheader',{name:'Margin',exact:true}).count(),0,'The Sales Rep preview shows a margin column');
  assert.equal(await page.getByRole('button',{name:'Approve exception',exact:true}).count(),0,'A Sales Rep can approve an exception');
  await page.getByRole('button',{name:'Return to my own view'}).click();await page.getByTestId('preview-banner').waitFor({state:'detached'});
  results.checks.quotesUi={priceCheckOnEnter:true,thermometer:true,exceptionNeedsReason:true,ownerSeesMargin:true,repPreviewHidesMargin:true,phoneWidth:true};

  // 7V: no section overflows horizontally at desktop or phone width, in light or dark; the phone menu opens
  // the navigation drawer and closes it again.
  const overflowed=[];
  for(const theme of ['light','dark']){
    await page.getByTestId('theme').first().selectOption(theme);
    for(const size of [{width:1366,height:768},{width:375,height:812}]){
      await page.setViewportSize(size);
      for(const hash of ['#home','#data-hub','#margin','#margin-bridge','#pricing','#pricing-planner','#pricing-versions','#pricing-exceptions','#pricing-expiry','#quotes','#rebates','#vendors','#vendors-ppv','#vendors-sim','#reports','#settings']){
        await page.evaluate(h=>{location.hash=h;},hash);await page.waitForTimeout(300);await page.waitForFunction(()=>!document.querySelector('main [aria-busy="true"]'),null,{timeout:60000});if(hash==='#pricing-versions'&&theme==='dark'&&size.width===375)await opsShot('versions-dark-mobile');
        if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))overflowed.push(`${hash} ${theme} ${size.width}px`);
      }
    }
  }
  await page.getByRole('button',{name:'Open menu',exact:true}).click();await page.locator('nav a[href="#pricing"]').click();
  await page.getByRole('heading',{level:1,name:'Pricing'}).waitFor();assert.equal(await page.getByRole('button',{name:'Close menu',exact:true}).count(),0,'The phone menu did not close after navigating');
  await page.setViewportSize({width:1365,height:900});await page.getByTestId('theme').first().selectOption('system');
  assert.deepEqual(overflowed,[],'Sections overflow horizontally');
  results.checks.uiLayout={noOverflow:['1366px','375px'],themes:['light','dark'],phoneDrawer:true};

  // 7U: a language switch changes every screen and the generated text. The pseudo-locale brackets
  // every message (⟦…⟧), so any visible word outside a bracket is hard-coded or untranslated text.
  // Data the test imported is marked translate="no" by the UI and skipped.
  const sectionLinks=['#home','#data-hub','#margin','#pricing','#quotes','#reports','#settings'];
  async function untranslated(){
    return page.evaluate(()=>{const out=[];const roots=[...document.querySelectorAll('header,nav,main')];
      const skip=n=>{for(let e=n.parentElement;e;e=e.parentElement){if(e.getAttribute('translate')==='no'||['SCRIPT','STYLE','CODE','OPTION'].includes(e.tagName)||e.hidden)return true;const st=getComputedStyle(e);if(st.display==='none'||st.visibility==='hidden')return true;}return false;};
      for(const root of roots){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let n=walker.nextNode();n;n=walker.nextNode()){if(skip(n))continue;let t=n.textContent||'';
        // Remove bracketed pseudo text, innermost first (nested references).
        for(let i=0;i<5;i++)t=t.replace(/⟦[^⟦⟧]*⟧/g,' ');
        // Intl-formatted dates use the pseudo-locale's en-US month names; they are values, not messages.
        t=t.replace(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2},\s\d{4}(,\s\d{1,2}:\d{2}\s[AP]M)?/g,' ');
        const words=t.match(/[A-Za-z]{3,}/g);if(words)out.push(t.trim().slice(0,120));}}
      for(const el of document.querySelectorAll('main [aria-label],header [aria-label],nav [aria-label],main [placeholder],main [title]'))for(const a of ['aria-label','placeholder','title']){const v=el.getAttribute(a);if(v&&/[A-Za-z]{3,}/.test(v.replace(/⟦[^⟧]*⟧/g,''))&&el.closest('[translate="no"]')===null)out.push(`@${a}=${v.slice(0,80)}`);}
      return [...new Set(out)];});
  }
  await page.evaluate(()=>localStorage.setItem('rebatehq.locale','pseudo'));
  await page.reload();await page.locator('form input[type="password"]').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.lang),'en-XA','The pseudo-locale did not apply after reload');
  const lockedLeft=await untranslated();assert.deepEqual(lockedLeft,[],'Untranslated text on the unlock screen');
  await page.locator('form input[type="password"]').fill(secret);await page.locator('form:has(input[type="password"]) button').click();
  await page.locator('[data-testid="line-count"]').waitFor({timeout:45000});
  const pseudoFindings={};
  for(const hash of sectionLinks){const link=page.locator(`nav a[href="${hash}"]`);if(!await link.count())continue;await link.click();
    await page.waitForFunction(()=>!document.querySelector('main [aria-busy="true"]'),null,{timeout:60000}).catch(()=>undefined);await page.waitForTimeout(1500);
    const left=await untranslated();if(left.length)pseudoFindings[hash]=left;
    if(hash==='#margin'||hash==='#pricing'){
      const ids=hash==='#margin'?['margin-bridge','competitors','service']:['grid','landed','planner','versions','exceptions','expiry'];
      for(const id of ids){const tab=page.getByTestId('ops-tab-'+id);if(!await tab.count())continue;await tab.click();await page.waitForTimeout(1800);const extra=await untranslated();if(extra.length)pseudoFindings[hash+'/'+id]=extra;assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Pricing ops overflow in pseudo locale');}
    }
  }
  assert.deepEqual(pseudoFindings,{},'Untranslated text in the pseudo-locale:\n'+JSON.stringify(pseudoFindings,null,1));
  // Switch to French with the language picker: navigation, headings and the generated PDF follow.
  await page.getByTestId('language').first().selectOption('fr');
  await page.locator('nav a[href="#home"]').filter({hasText:'Accueil'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.lang),'fr');
  await page.locator('nav a[href="#reports"]').click();await page.getByRole('heading',{name:'Rapport des fuites de marge'}).waitFor();
  const [frPdf]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Télécharger le rapport des fuites (PDF)'}).click()]);
  const frBytes=(await readFile(await frPdf.path())).toString('latin1');
  assert.ok(frBytes.includes('Rapport des fuites de marge')&&!frBytes.includes('Margin Leak Report'),'The Leak Report PDF did not follow the chosen language');
  assert.ok(/\\351/.test(frBytes),'French accents were not encoded in the PDF');
  await page.locator('nav a[href="#data-hub"]').click();await page.getByRole('heading',{name:"Studio d'importation"}).waitFor();
  // Spanish and Canadian French both switch the same screen.
  await page.getByTestId('language').first().selectOption('es');await page.getByRole('heading',{name:'Estudio de importación'}).waitFor();
  await page.getByTestId('language').first().selectOption('fr-CA');await page.getByRole('heading',{name:"Studio d'importation"}).waitFor();
  await page.getByTestId('language').first().selectOption('en');await page.getByRole('heading',{name:'Import Studio'}).waitFor();
  // Themes: the picker sets data-theme and the tokens change the rendered colours.
  const bg=()=>page.evaluate(()=>getComputedStyle(document.querySelector('header')).backgroundColor);
  const light=await bg();await page.getByTestId('theme').first().selectOption('dark');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');assert.notEqual(await bg(),light,'The dark theme did not change the background');
  await page.getByTestId('theme').first().selectOption('contrast');assert.equal(await bg(),'rgb(255, 255, 255)','The high-contrast theme background is not white');
  await page.getByTestId('theme').first().selectOption('system');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme??null),null);
  // Command palette: Ctrl+K opens it, typing filters screens and finds a SKU from the vault.
  await page.keyboard.press('Control+k');await page.getByTestId('command-palette').waitFor();
  await page.getByRole('combobox',{name:'Search screens, commands, SKUs and customers'}).fill('pricing');
  await page.getByRole('option',{name:/Pricing/}).first().waitFor();
  await page.getByTestId('command-palette').getByRole('combobox').fill(priceSku);await page.getByRole('option',{name:new RegExp(priceSku)}).waitFor({timeout:15000});
  await page.keyboard.press('Escape');await page.getByTestId('command-palette').waitFor({state:'hidden'});
  results.checks.i18nUi={pseudoLocaleEveryScreen:true,french:true,spanish:true,canadianFrench:true,frenchLeakReportPdf:true,themes:['light','dark','contrast','system'],commandPalette:true};

  await page.getByRole("button", { name: "Lock vault", exact: true }).click(); await ready();
  if (full) {
    assert.ok(!auth, "Synthetic benchmark must not reset an authenticated vault");
    results.measurements.studio1M = await worker("studioBenchmark", { rows: 1000000 });
    console.log(`Studio 1M CSV: convert+stage+validate ${results.measurements.studio1M.convertStageValidateMs} ms, commit+encrypted save ${results.measurements.studio1M.commitAndEncryptedSaveMs} ms.`);
    results.measurements.margin2M = await worker("marginBenchmark", { rows: 2000000 }, 900000);
    console.log(`Margin on 2M lines: waterfall ${results.measurements.margin2M.waterfallMs} ms, product drill ${results.measurements.margin2M.drillProductMs} ms, customer drill ${results.measurements.margin2M.drillCustomerMs} ms, leak finder ${results.measurements.margin2M.leakFinderMs} ms.`);
    for (const rows of [1000000, 2000000]) {
      results.measurements[`seed${rows}`] = await worker("seed", { rows });
      await context.close(); context = await browserType.launchPersistentContext(profile, browserOptions); await configureContext();
      page = await openPage(); await page.goto(base + route); await ready(); await unlock();
      assert.equal(await page.getByTestId("line-count").getAttribute("data-value"), String(rows));
      results.measurements[`navigationToUnlocked${rows}Ms`] = await page.evaluate(() => Math.round(performance.now()));
      results.checks[`startup${rows}Under3s`] = results.measurements[`navigationToUnlocked${rows}Ms`] < 3000;
      if (rows === 1000000) assert.ok(results.checks.startup1000000Under3s, "1M encrypted startup missed the local three-second target");
      await page.getByRole("button", { name: "Lock vault", exact: true }).click(); await ready();
      await page.evaluate(() => { window.__vaultLongTasks = []; });
      const change = await worker("firstChange", { rows });
      const changeTasks = await page.evaluate(() => window.__vaultLongTasks);
      results.measurements[`firstChange${rows}`] = { ...change, maxMainThreadLongTaskMs: Math.max(0, ...changeTasks) };
      results.checks[`firstChange${rows}Under2sAfterWarmup`] = change.underTwoSeconds && Math.max(0, ...changeTasks) <= 200;
      console.log(`First change at ${rows} lines: background warm-up ${change.warmupMs} ms (read during warm-up ${change.readDuringWarmupMs} ms), post-warm-up first change committed/encrypted ${change.postWarmupFirstChangeMs} ms, max observed UI long task ${Math.max(0, ...changeTasks)} ms.`);
    }
  }
  await monitorUi();
  await rebatesUi();
  await suppliersUi(); await vendorsUi(); await simUi(); await reportsUi(); await convertersUi(); await guidanceUi(); await agentsUi(); await deadStockUi(); await winLossUi(); await benchUi(); if (channel !== 'firefox') await offlineUi();
  await recoveryUi();
  if(auth){
    const device=await page.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('rebatehq-device-v1:'));return localStorage.getItem(key);});assert.ok(device);
    const revoked=await context.request.post(base+'/api/licence/devices',{data:{id:device,status:'revoked'}});assert.equal(revoked.status(),200);
    await page.reload();await ready();await page.getByTestId('licence-status').filter({hasText:'Read-only'}).waitFor();await unlock();
    await page.getByRole('link',{name:'Settings',exact:true}).click();const backup=page.waitForEvent('download');await page.getByRole('button',{name:'Download encrypted backup',exact:true}).click();assert.ok((await readFile(await(await backup).path())).subarray(0,8).toString()==='MDVAULT1');
    results.checks.revokedReadOnlyRecovery=true;
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile shell overflows"); results.checks.mobile = true;
  await Promise.all(headerChecks); assert.deepEqual(failures, []); results.checks.privacy = true;
  results.requests = { count: requests.length, paths: [...new Set(requests)].filter(p => !p.startsWith("/_next/")) };
  results.status = "passed"; console.log(JSON.stringify({ status: "passed", auth, browser: results.browser, checks: Object.keys(results.checks), startupTargets: full ? { oneMillion: results.checks.startup1000000Under3s, twoMillion: results.checks.startup2000000Under3s } : undefined, measurements: results.measurements }, null, 2));
}
} catch (error) { results.status = "failed"; results.error = error.message; results.diagnostics = await diagnose(); console.error("Failure diagnostics:", JSON.stringify(results.diagnostics)); throw error; }
finally { await writeFile(`test-results/vault-${channel}${auth ? "-auth" : ""}.json`, JSON.stringify(results, null, 2)); await context.close(); }
