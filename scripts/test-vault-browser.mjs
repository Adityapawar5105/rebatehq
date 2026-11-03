import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
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
const failures = [], requests = [], headerChecks = [];
let dataPlaneActive = false;
await mkdir("test-results", { recursive: true });
await build({ entryPoints: ["tests/browser/vault-worker.ts"], outfile: "test-results/vault-tests.js", bundle: true, platform: "browser", format: "esm", minify: true });
const testCode = await readFile("test-results/vault-tests.js", "utf8");
const profile = await mkdtemp(path.join(os.tmpdir(), "margindesk-vault-"));
const browserOptions = { ...(channel === "chromium" ? {} : { channel }), headless: true, viewport: { width: 1365, height: 900 } };
let context = await chromium.launchPersistentContext(profile, browserOptions);
const results = { date: new Date().toISOString(), auth, channel, browser: context.browser().version(), machine: { cpu: os.cpus()[0].model, ram: String(os.totalmem()), os: os.type() + " " + os.release() }, checks: {}, measurements: {} };
async function configureContext() {
await context.route("**/spike/vault-tests.js", r => r.fulfill({ status: 200, contentType: "application/javascript", headers: { "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" }, body: testCode }));
context.on("request", r => {
  headerChecks.push(r.allHeaders().then(headers => {
    const text = [r.url(), JSON.stringify(headers), r.postDataBuffer()?.toString("utf8") || ""].join("\n");
    if (markers.some(m => text.includes(m))) failures.push("Private fixture value appeared in a network request");
  }).catch(() => { failures.push("Could not inspect complete request headers"); }));
  const url = new URL(r.url());
  if (dataPlaneActive && (url.origin !== new URL(base).origin || !["GET", "HEAD"].includes(r.method()) || url.pathname.startsWith("/api/"))) failures.push("Vault flow made an unexpected external or API request");
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
async function worker(action, data = {}) {
  return page.evaluate(({ action, data }) => new Promise((resolve, reject) => {
    const w = new Worker("/spike/vault-tests.js", { type: "module" });
    const timeout = setTimeout(() => { w.terminate(); reject(new Error("Test worker deadline exceeded")); }, 180000);
    w.onmessage = e => { clearTimeout(timeout); w.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result); };
    w.onerror = e => { clearTimeout(timeout); w.terminate(); reject(new Error("Test worker failed: " + e.message)); }; w.postMessage({ action, ...data });
  }), { action, data });
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
  if (auth) await signInLocal(context, page, base);
  const response = await page.goto(base + route); assert.equal(response.status(), 200); assert.equal(response.headers()["cross-origin-embedder-policy"], "require-corp"); assert.ok(!response.headers()["content-security-policy"].includes("'unsafe-eval'"));
  await ready();
  dataPlaneActive = true;
  if (makeFixture) {
    const raw = await worker("fixture");
    await mkdir("tests/fixtures/vault", { recursive: true }); await writeFile("tests/fixtures/vault/v1.enc", Buffer.from(Object.values(raw)));
    console.log("Created committed synthetic encrypted v1 fixture.");
  }
  const fixture = await readFile("tests/fixtures/vault/v1.enc");
  results.checks.v1 = await worker("v1", { bytes: new Uint8Array(fixture) });
  results.checks.integrity = await worker("integrity");
  results.checks.studio = await worker("studio");
  results.checks.warmup = await worker("warmup");
  await page.getByLabel("Vault passphrase").fill(secret); await page.getByRole("button", { name: "Create encrypted vault", exact: true }).click();
  await page.getByRole("button", { name: "Lock vault", exact: true }).waitFor();
  await page.getByRole("link", { name: "Data Hub", exact: true }).click();
  const csvPath = path.resolve("test-results", marker + ".csv"); await writeFile(csvPath, csv(100000));
  await page.evaluate(() => { window.__vaultLongTasks = []; });
  const start = performance.now();
  await importFiles([csvPath], 100000);
  results.measurements.import100kMs = Math.round(performance.now() - start);
  const tasks = await page.evaluate(() => window.__vaultLongTasks); results.measurements.maxImportLongTaskMs = Math.max(0, ...tasks); assert.ok(results.measurements.maxImportLongTaskMs <= 200, "Import blocked main thread for over 200 ms");
  await page.getByRole("link", { name: "Reports", exact: true }).click(); await page.getByRole("button", { name: "Verify audit chain" }).click(); await page.getByRole("status").filter({ hasText: /Audit chain verified/ }).waitFor();
  await page.getByRole("link", { name: "Margin", exact: true }).click(); await page.getByRole("heading", { name: "Imported line totals" }).waitFor(); await page.locator("dt").filter({ hasText: /^margin$/i }).waitFor();
  await page.getByRole("link", { name: "Data Hub", exact: true }).click();
  const capPath = path.resolve("test-results", "synthetic-over-cap.csv"); await writeFile(capPath, csv(100001, 200001));
  await review([capPath]);
  await page.getByRole("alert").filter({ hasText: /exceeds your starter limit/ }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Confirm and import locally" }).isDisabled(), "Over-cap batch must not be importable");
  assert.equal(await page.getByTestId("line-count").innerText(), "100000"); results.checks.capRollback = true; await clearBatch();
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
  assert.equal(download.suggestedFilename(), "margindesk-converted.zip"); assert.ok((await readFile(await download.path())).length > 100, "Converted ZIP is empty");
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
  await page.getByRole("button", { name: "Lock vault", exact: true }).click(); await ready();
  if (full) {
    assert.ok(!auth, "Synthetic benchmark must not reset an authenticated vault");
    results.measurements.studio1M = await worker("studioBenchmark", { rows: 1000000 });
    console.log(`Studio 1M CSV: convert+stage+validate ${results.measurements.studio1M.convertStageValidateMs} ms, commit+encrypted save ${results.measurements.studio1M.commitAndEncryptedSaveMs} ms.`);
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
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile shell overflows"); results.checks.mobile = true;
  await Promise.all(headerChecks); assert.deepEqual(failures, []); results.checks.privacy = true;
  results.requests = { count: requests.length, paths: [...new Set(requests)].filter(p => !p.startsWith("/_next/")) };
  results.status = "passed"; console.log(JSON.stringify({ status: "passed", auth, browser: results.browser, checks: Object.keys(results.checks), startupTargets: full ? { oneMillion: results.checks.startup1000000Under3s, twoMillion: results.checks.startup2000000Under3s } : undefined, measurements: results.measurements }, null, 2));
} catch (error) { results.status = "failed"; results.error = error.message; results.diagnostics = await diagnose(); console.error("Failure diagnostics:", JSON.stringify(results.diagnostics)); throw error; }
finally { await writeFile(`test-results/vault-${channel}${auth ? "-auth" : ""}.json`, JSON.stringify(results, null, 2)); await context.close(); }
