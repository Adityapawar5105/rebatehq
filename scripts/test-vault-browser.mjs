import { createPrivateKey, sign, generateKeyPairSync } from 'node:crypto';
import { RETIRED_API_PATHS } from '../config/http-boundary.mjs';
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
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
const failures = [], requests = [], headerChecks = [];
let dataPlaneActive = false;
// Assert the actual issuer/HMAC secret is absent from every served client asset.
async function checkBundleKeys(dir){for(const item of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await checkBundleKeys(file);else if(/\.(js|json|html)$/.test(item.name)){const text=await readFile(file,'utf8');for(const value of [process.env.LICENCE_SIGNING_KEY,process.env.ACTOR_SIGNING_SECRET].filter(Boolean))assert.ok(!text.includes(value),'A server signing secret was bundled into a served client asset');}}}
await checkBundleKeys('public/spike');await checkBundleKeys('.next/static');

await mkdir("test-results", { recursive: true });
await build({ entryPoints: ["tests/browser/vault-worker.ts"], outfile: "test-results/vault-tests.js", bundle: true, platform: "browser", format: "esm", minify: true,define:{"process.env.NEXT_PUBLIC_LICENCE_VERIFY_KEY":JSON.stringify(fixturePublic),"process.env.TEST_LICENCE_PRIVATE_KEY":JSON.stringify(fixturePrivate)} });
const testCode = await readFile("test-results/vault-tests.js", "utf8");
const profile = await mkdtemp(path.join(os.tmpdir(), "rebatehq-vault-"));
const browserOptions = { ...(channel === "chromium" ? {} : { channel }), headless: true, viewport: { width: 1365, height: 900 } };
let context = await chromium.launchPersistentContext(profile, browserOptions);
const results = { date: new Date().toISOString(), auth, channel, browser: context.browser().version(), machine: { cpu: os.cpus()[0].model, ram: String(os.totalmem()), os: os.type() + " " + os.release() }, checks: {}, measurements: {} };
async function configureContext() {
if(!auth)await context.route('**/api/licence?device=*',async r=>{
 const issued=Math.floor(Date.now()/1000),device=new URL(r.request().url()).searchParams.get('device'),payload=JSON.stringify({v:1,sub:'synthetic-lab-user',workspace:'synthetic-lab-workspace',device,tier:'scale',state:'active',issued,expires:issued+3600,offlineUntil:issued+86400,reason:''});
 const key=createPrivateKey({key:Buffer.from(process.env.LICENCE_SIGNING_KEY,'base64'),format:'der',type:'pkcs8'});
 await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({payload,signature:sign(null,Buffer.from(payload),key).toString('base64')})});
});
await context.route("**/spike/vault-tests.js", r => r.fulfill({ status: 200, contentType: "application/javascript", headers: { "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" }, body: testCode }));
context.on("request", r => {
  headerChecks.push(r.allHeaders().then(headers => {
    const text = [r.url(), JSON.stringify(headers), r.postDataBuffer()?.toString("utf8") || ""].join("\n");
    if (markers.some(m => text.includes(m))) failures.push("Private fixture value appeared in a network request");
  }).catch(() => { failures.push("Could not inspect complete request headers"); }));
  const url = new URL(r.url());
  if (dataPlaneActive && (url.origin !== new URL(base).origin || !["GET", "HEAD"].includes(r.method()) || (url.pathname.startsWith("/api/") && !(url.pathname==="/api/licence"&&r.method()==="GET"&&[...url.searchParams.keys()].every(k=>k==="device")&&!r.postData())))) failures.push("Vault flow made an unexpected external or API request");
  requests.push(new URL(r.url()).pathname);
});
context.on("console", m => {
  if (markers.some(value => m.text().includes(value))) failures.push("Private fixture value appeared in console output");
  headerChecks.push(Promise.all(m.args().map(arg => arg.jsonValue())).then(values => {
    const text = JSON.stringify(values, (_key, value) => typeof value === "bigint" ? value.toString() : value);
    if (markers.some(value => text.includes(value))) failures.push("Private fixture value appeared in a console argument");
  }).catch(() => { failures.push("Could not inspect console arguments"); }));
});
await context.addInitScript(() => { window.__vaultLongTasks = []; new PerformanceObserver(list => { for (const e of list.getEntries()) window.__vaultLongTasks.push(e.duration); }).observe({ type: "longtask", buffered: true }); });
}
await configureContext();
// VAULT_TEST_CPU_THROTTLE (e.g. 4) slows each page to approximate a small CI runner.
const throttle = Number(process.env.VAULT_TEST_CPU_THROTTLE || 0);
async function openPage() {
  const opened = await context.newPage();
  opened.on("pageerror", () => failures.push("Unhandled page error"));
  if (throttle > 1) await (await context.newCDPSession(opened)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
  return opened;
}
let page = await openPage();
// On failure, record what the user would see. Diagnostics are scrubbed of fixture markers.
async function diagnose() {
  const scrub = text => markers.reduce((value, m) => value.split(m).join("[marker]"), String(text));
  const diagnostics = {};
  try { await page.screenshot({ path: `test-results/vault-${channel}${auth ? "-auth" : ""}-failure.png`, fullPage: true }); } catch { diagnostics.screenshot = "unavailable"; }
  try { diagnostics.alerts = (await page.getByRole("alert").allInnerTexts()).map(scrub); diagnostics.status = (await page.getByRole("status").allInnerTexts()).map(scrub); } catch { diagnostics.alerts = "unavailable"; }
  try { diagnostics.buttons = (await page.getByRole("button").allInnerTexts()).map(scrub); } catch { diagnostics.buttons = "unavailable"; }
  try { diagnostics.locks = await page.evaluate(async () => { const q = await navigator.locks.query(); return { held: q.held.map(l => l.mode), pending: q.pending.map(l => l.mode) }; }); } catch { diagnostics.locks = "unavailable"; }
  return diagnostics;
}
async function worker(action, data = {}, deadline = 180000) {
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
  await page.getByRole("button", { name: "Review import" }).click();
  await page.getByRole("heading", { name: "Batch report" }).waitFor({ timeout: 120000 });
}
async function importFiles(paths, lines, acknowledge = false) {
  await review(paths);
  if (acknowledge) await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm and import locally" }).click();
  await page.getByTestId("line-count").filter({ hasText: new RegExp(`^${lines}$`) }).waitFor({ timeout: 120000 });
}
async function clearBatch() { await page.getByRole("button", { name: "Clear batch" }).click(); await page.getByRole("heading", { name: "Batch report" }).waitFor({ state: "detached" }); }
// Synthetic multi-format fixtures (TSV, JSON, XML, XLSX) with the private marker in product_id.
await build({ entryPoints: ["tests/helpers/studio-fixtures.ts"], outfile: "test-results/studio-fixtures.mjs", bundle: true, platform: "node", format: "esm" });
const fixtures = await import(new URL("../test-results/studio-fixtures.mjs", import.meta.url).href);
try {
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
  await ready();
  await page.getByTestId("licence-status").filter({hasText:"Licensed: scale"}).waitFor();results.checks.signedLicence=true;
  dataPlaneActive = true;
  if (makeFixture) {
    const raw = await worker("fixture");
    await mkdir("tests/fixtures/vault", { recursive: true }); await writeFile("tests/fixtures/vault/v1.enc", Buffer.from(Object.values(raw)));
    console.log("Created committed synthetic encrypted v1 fixture.");
  }
  if (process.argv.includes("--margin-bench")) { const m = await worker("marginBenchmark", { rows: Number(process.env.MARGIN_BENCH_ROWS || 2000000) }, 900000); console.log(JSON.stringify(m, null, 2)); await writeFile(`test-results/vault-margin-bench-${channel}.json`, JSON.stringify({ date: new Date().toISOString(), browser: results.browser, machine: results.machine, margin2M: m }, null, 2)); process.exit(0); }
  if(process.argv.includes('--pricing-bench')){const m=await worker('pricingBenchmark',{},900000);console.log(JSON.stringify(m,null,2));await writeFile('test-results/pricing-benchmark-'+channel+'.json',JSON.stringify({browser:results.browser,machine:results.machine,...m},null,2));process.exit(0);}
  if(process.argv.includes('--phase5a-bench')){const m=await worker('phase5aBenchmark',{},900000);console.log(JSON.stringify(m,null,2));await writeFile('test-results/phase5a-benchmark-'+channel+'.json',JSON.stringify({browser:results.browser,machine:results.machine,...m},null,2));process.exit(0);}
  if(process.argv.includes('--pricing-only')){console.log(JSON.stringify(await worker('pricing',{},600000),null,2));process.exit(0);}
  const fixture = await readFile("tests/fixtures/vault/v1.enc");
  results.checks.v1 = await worker("v1", { bytes: new Uint8Array(fixture) });
  results.checks.integrity = await worker("integrity");
  results.checks.studio = await worker("studio");
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
  await page.getByRole("alert").filter({ hasText: /exceeds your starter limit/ }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Confirm and import locally" }).isDisabled(), "Over-cap batch must not be importable");
  assert.equal(await page.getByTestId("line-count").innerText(), "100000"); assert.match(await page.getByRole("alert").filter({hasText:/exceeds your starter limit/}).innerText(),/upgrade/i);results.checks.licenceUpgradePrompt=true;results.checks.capRollback = true; await clearBatch();
  const invalid = path.resolve("test-results", "synthetic-invalid.csv"); await writeFile(invalid, header + `1,1,1,2025-01-01,1,${marker},0.00,0.00,0.00,1.00\n`);
  await review([invalid]);
  await page.getByText(/Row 2, column F: Use a non-negative amount/).waitFor(); await page.getByRole("alert").filter({ hasText: /No valid rows to load/ }).waitFor();
  results.checks.invalidCellNoLeak = true; await clearBatch();
  const duplicate = path.resolve("test-results", "synthetic-duplicate.csv"), oneRow = csv(1).toString().slice(header.length);
  await writeFile(duplicate, header + oneRow + oneRow); await review([duplicate]);
  await page.getByText(/Row 2: Already loaded from another file/).waitFor(); await page.getByText(/Row 3: Exact copy of an earlier row/).waitFor();
  assert.equal(await page.getByTestId("line-count").innerText(), "100000"); results.checks.locatedDuplicate = true; await clearBatch();
  const cancelPath = path.resolve("test-results", "synthetic-cancel.csv"); await writeFile(cancelPath, csv(1000000, 300001));
  await page.getByTestId("studio-files").setInputFiles(cancelPath); await page.getByRole("button", { name: "Review import" }).click();
  await page.getByRole("button", { name: "Cancel import" }).click(); await page.getByRole("alert").filter({ hasText: /Import cancelled/ }).waitFor();
  assert.equal(await page.getByTestId("line-count").innerText(), "100000"); results.checks.cancelRollback = true; await clearBatch();
  // Privacy gate across formats: the marker sits in product_id inside TSV, JSON, XML and XLSX files.
  const marked = fixtures.markedSales(marker, 600001).map(f => ({ ...f, path: path.resolve("test-results", f.name) }));
  for (const f of marked) await writeFile(f.path, f.bytes);
  await review(marked.map(f => f.path));
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download all as ZIP" }).click()]);
  assert.equal(download.suggestedFilename(), "rebatehq-converted.zip"); assert.ok((await readFile(await download.path())).length > 100, "Converted ZIP is empty");
  await page.getByRole("button", { name: "Confirm and import locally" }).click();
  await page.getByTestId("line-count").filter({ hasText: /^100016$/ }).waitFor({ timeout: 120000 });
  results.checks.multiFormatImport = { files: marked.map(f => f.name), lines: 16 };
  await page.getByRole("link", { name: "Settings", exact: true }).click(); await page.getByRole("button", { name: "Request persistent storage" }).click();
  await page.getByRole("status").filter({ hasText: /Storage status refreshed/ }).waitFor(); results.checks.storage = await worker("storage");
  results.checks.cipherOnly = await worker("cipherOnly");
  // A killed renderer cannot complete a pagehide save. Success must already be durable.
  const cdp = await context.newCDPSession(page); await Promise.race([cdp.send("Page.crash").catch(() => undefined), new Promise(resolve => setTimeout(resolve, 3000))]); await page.close().catch(() => undefined);
  page = await openPage(); await page.goto(base + route); await ready(); await unlock(); assert.equal(await page.getByTestId("line-count").innerText(), "100016"); results.checks.killedTabRecovery = true;
  await page.getByRole("button", { name: "Lock vault", exact: true }).click(); await ready();
  await page.getByLabel("Vault passphrase").fill("deliberately-wrong-passphrase"); await page.getByRole("button", { name: "Unlock vault", exact: true }).click(); await page.getByRole("alert").filter({ hasText: /Wrong passphrase/ }).waitFor(); results.checks.wrongPassphrase = true;
  await unlock(); await page.reload(); await ready(); await unlock(); assert.equal(await page.getByTestId("line-count").innerText(), "100016"); results.checks.reload = true;
  // First change straight after unlock: the import waits for the background warm-up instead of failing.
  await page.getByRole("link", { name: "Data Hub", exact: true }).click();
  const afterReload = path.resolve("test-results", "synthetic-after-reload.csv"); await writeFile(afterReload, csv(1, 700001));
  await importFiles([afterReload], 100017);
  await page.reload(); await ready(); await unlock(); assert.equal(await page.getByTestId("line-count").innerText(), "100017"); results.checks.firstMutationAfterUnlock = true;
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
  await page.getByTestId("line-count").filter({ hasText: /^100037$/ }).waitFor({ timeout: 120000 });
  await page.getByLabel("New customer_id for all rows in this group").fill("CASH-SALE");
  await page.getByRole("button", { name: "Set customer_id for all rows" }).click(); await page.getByRole("status").filter({ hasText: /Re-check the group/ }).waitFor();
  await page.getByRole("button", { name: "Re-check and load customer_id rows" }).click();
  await page.getByTestId("line-count").filter({ hasText: /^100039$/ }).waitFor({ timeout: 60000 });
  await page.getByRole("heading", { name: /^Data health: \d+%$/ }).waitFor();
  results.checks.mappingAndFixLater = { confirmedMapping: true, loaded: 20, fixedThenLoaded: 2 };
  // 4D: the cancellation row loads from Fix Later as a credit line, then the Margin UI is driven end to end.
  await page.getByRole("button", { name: "Load negative-quantity rows of retail-like.csv as returns and credits" }).click();
  await page.getByTestId("line-count").filter({ hasText: /^100040$/ }).waitFor({ timeout: 60000 });
  // The retail-like fixture's invoices span several customers: reconciliation must flag them, never adjust them.
  const diffs = page.getByRole("table", { name: "Reconciliation differences" }); await diffs.waitFor({ timeout: 60000 });
  const levels = await diffs.locator("tbody tr td:first-child").allInnerTexts();
  assert.ok(levels.length > 0 && levels.every(l => l === "invoice"), `Unexpected reconciliation differences: ${levels.join(",")}`);
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
  const priceSku=marker+'-4E';const files4E={
    'pricing-items.csv':'product_id,description,category,uom,current_cost,list_price\n'+priceSku+',Private pricing item,Privacy category,EA,66.00,100.00\n',
    'pricing-customers.csv':'customer_id,name,tier,branch\nE-CUSTOMER,Private customer,E-TIER,East\n',
    'pricing-costs.csv':'vendor,product_id,cost,effective_date\nPrivacy Mills,'+priceSku+',60.00,2025-01-01\nPrivacy Mills,'+priceSku+',66.00,2025-02-01\n',
    'pricing-sales.csv':header+'9000001,'+priceSku+',E-CUSTOMER,2025-03-01,1,100.00,10.00,1.00,0.00,66.00\n'
  };const pricePaths=[];for(const [name,body]of Object.entries(files4E)){const file=path.resolve('test-results',name);await writeFile(file,body);pricePaths.push(file);}
  const oldCount=BigInt(await page.getByTestId('line-count').innerText());await importFiles(pricePaths,String(oldCount+BigInt(1)));
  await page.getByRole('link',{name:'Settings',exact:true}).click();
  await page.evaluate(()=>{window.showDirectoryPicker=async()=>await(await navigator.storage.getDirectory()).getDirectoryHandle('privacy-backup-seam',{create:true});});
  await page.getByRole('button',{name:'Choose backup folder',exact:true}).click();await page.getByRole('status').filter({hasText:'Encrypted folder backup written.'}).waitFor();
  await page.getByRole('link',{name:'Pricing',exact:true}).click();await page.getByLabel('Pricing Owner name',{exact:true}).fill('Synthetic Pricing Owner');
  await page.getByRole('button',{name:'Name me as Pricing Owner',exact:true}).click();await page.getByRole('status').filter({hasText:'Pricing Owner saved.'}).waitFor();
  for(const [key,value]of Object.entries({tier:'E-TIER',category:'Privacy category',start:'11000',target:'10500',floor:'9500'}))await page.getByLabel('Guardrail '+key,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Save guardrails',exact:true}).click();await page.getByRole('status').filter({hasText:'Guardrails saved.'}).waitFor();
  for(const [key,value]of Object.entries({name:marker+' rule',category:'Privacy category',vendor:'Privacy Mills',threshold:'5',increase:'4.5'}))await page.getByLabel('Rule '+key,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Save rule version',exact:true}).click();await page.getByRole('status').filter({hasText:'Rule version saved.'}).waitFor();
  await page.getByRole('button',{name:'Simulate price change',exact:true}).click();await page.getByRole('heading',{name:'Change preview',exact:true}).waitFor();
  await page.getByRole('cell',{name:'⚠ Yellow · owner review',exact:true}).waitFor();await page.getByRole('cell',{name:'104.50',exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Approve as Pricing Owner',exact:true}).click();await page.getByRole('heading',{name:'Export Studio',exact:true}).waitFor();
  const outputs=[];const capture=d=>outputs.push(d);page.on('download',capture);await page.getByRole('button',{name:'Export prices and change log',exact:true}).click();
  await page.getByRole('status').filter({hasText:/unverified until tested on a real import/}).waitFor();assert.equal(outputs.length,2,'Missing ERP export or change log');
  for(const d of outputs){const bytes=await readFile(await d.path());assert.ok(bytes.includes(Buffer.from('104.50')),'Export omitted approved cents');}
  page.off('download',capture);
  await page.getByRole('link',{name:'Settings',exact:true}).click();const encrypted=page.waitForEvent('download');await page.getByRole('button',{name:'Download encrypted backup',exact:true}).click();const enc=await encrypted;assert.ok((await readFile(await enc.path())).subarray(0,8).toString()==='MDVAULT1','Backup export is not encrypted');
  if(!auth){await page.getByRole('button',{name:'Use licensed capacity',exact:true}).click();await page.getByRole('status').filter({hasText:'Licensed capacity applied'}).waitFor();results.checks.licensedCapacityUpgrade=true;}
  results.checks.pricingUi={owner:true,guardrails:true,rule:true,simulation:true,preview:true,approval:true,erpExportAndLog:true,folderHandleSeam:true,encryptedBackup:true};

  await page.getByRole("button", { name: "Lock vault", exact: true }).click(); await ready();
  if (full) {
    assert.ok(!auth, "Synthetic benchmark must not reset an authenticated vault");
    results.measurements.studio1M = await worker("studioBenchmark", { rows: 1000000 });
    console.log(`Studio 1M CSV: convert+stage+validate ${results.measurements.studio1M.convertStageValidateMs} ms, commit+encrypted save ${results.measurements.studio1M.commitAndEncryptedSaveMs} ms.`);
    results.measurements.margin2M = await worker("marginBenchmark", { rows: 2000000 }, 900000);
    console.log(`Margin on 2M lines: waterfall ${results.measurements.margin2M.waterfallMs} ms, product drill ${results.measurements.margin2M.drillProductMs} ms, customer drill ${results.measurements.margin2M.drillCustomerMs} ms, leak finder ${results.measurements.margin2M.leakFinderMs} ms.`);
    for (const rows of [1000000, 2000000]) {
      results.measurements[`seed${rows}`] = await worker("seed", { rows });
      await context.close(); context = await chromium.launchPersistentContext(profile, browserOptions); await configureContext();
      page = await openPage(); await page.goto(base + route); await ready(); await unlock();
      assert.equal(await page.getByTestId("line-count").innerText(), String(rows));
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
} catch (error) { results.status = "failed"; results.error = error.message; results.diagnostics = await diagnose(); console.error("Failure diagnostics:", JSON.stringify(results.diagnostics)); throw error; }
finally { await writeFile(`test-results/vault-${channel}${auth ? "-auth" : ""}.json`, JSON.stringify(results, null, 2)); await context.close(); }
