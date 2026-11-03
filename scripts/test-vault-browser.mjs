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
let page = await context.newPage();
page.on("pageerror", () => failures.push("Unhandled page error"));
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
function csv(rows) { const lines = []; for (let i = 1; i <= rows; i++) lines.push(`${i},${i % 20000 + 1},${i % 2000 + 1},2025-01-01,1,${numericMarker},0.50,0.25,0.00,8.00\n`); return Buffer.from(header + lines.join("")); }
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
  await page.getByLabel("Vault passphrase").fill(secret); await page.getByRole("button", { name: "Create encrypted vault", exact: true }).click();
  await page.getByRole("button", { name: "Lock vault", exact: true }).waitFor();
  await page.getByRole("link", { name: "Data Hub", exact: true }).click();
  const csvPath = path.resolve("test-results", marker + ".csv"); await writeFile(csvPath, csv(100000));
  await page.evaluate(() => { window.__vaultLongTasks = []; });
  const start = performance.now();
  await page.getByTestId("csv-file").setInputFiles(csvPath);
  await page.getByRole("button", { name: "Confirm and import locally" }).click();
  await page.getByTestId("line-count").filter({ hasText: /^100000$/ }).waitFor({ timeout: 90000 });
  results.measurements.import100kMs = Math.round(performance.now() - start);
  const tasks = await page.evaluate(() => window.__vaultLongTasks); results.measurements.maxImportLongTaskMs = Math.max(0, ...tasks); assert.ok(results.measurements.maxImportLongTaskMs <= 200, "Import blocked main thread for over 200 ms");
  await page.getByRole("link", { name: "Reports", exact: true }).click(); await page.getByRole("button", { name: "Verify audit chain" }).click(); await page.getByRole("status").filter({ hasText: /Audit chain verified/ }).waitFor();
  await page.getByRole("link", { name: "Margin", exact: true }).click(); await page.getByRole("heading", { name: "Imported line totals" }).waitFor(); await page.locator("dt").filter({ hasText: /^margin$/i }).waitFor();
  await page.getByRole("link", { name: "Data Hub", exact: true }).click();
  const capPath = path.resolve("test-results", "synthetic-over-cap.csv"); await writeFile(capPath, csv(100001));
  await page.getByTestId("csv-file").setInputFiles(capPath); await page.getByRole("button", { name: "Confirm and import locally" }).click();
  await page.getByRole("alert").filter({ hasText: /exceeds your starter limit/ }).waitFor(); assert.equal(await page.getByTestId("line-count").innerText(), "100000"); results.checks.capRollback = true;
  const invalid = path.resolve("test-results", "synthetic-invalid.csv"); await writeFile(invalid, header + `1,1,1,2025-01-01,1,${marker},0.00,0.00,0.00,1.00\n`);
  await page.getByTestId("csv-file").setInputFiles(invalid); await page.getByRole("button", { name: "Confirm and import locally" }).click();
  await page.getByRole("alert").filter({ hasText: /Row 2, column F/ }).waitFor(); results.checks.invalidCellNoLeak = true;
  const duplicate = path.resolve("test-results", "synthetic-duplicate.csv"), oneRow = csv(1).toString().slice(header.length);
  await writeFile(duplicate, header + oneRow + oneRow); await page.getByTestId("csv-file").setInputFiles(duplicate); await page.getByRole("button", { name: "Confirm and import locally" }).click();
  await page.getByRole("alert").filter({ hasText: /Row 3, column A: line_id is repeated/ }).waitFor(); assert.equal(await page.getByTestId("line-count").innerText(), "100000"); results.checks.locatedDuplicate = true;
  const cancelPath = path.resolve("test-results", "synthetic-cancel.csv"); await writeFile(cancelPath, csv(1000000));
  await page.getByTestId("csv-file").setInputFiles(cancelPath); await page.getByRole("button", { name: "Confirm and import locally" }).click();
  await page.getByRole("button", { name: "Cancel import" }).click(); await page.getByRole("alert").filter({ hasText: /Import cancelled/ }).waitFor();
  assert.equal(await page.getByTestId("line-count").innerText(), "100000"); results.checks.cancelRollback = true;
  await page.getByRole("link", { name: "Settings", exact: true }).click(); await page.getByRole("button", { name: "Request persistent storage" }).click();
  await page.getByRole("status").filter({ hasText: /Storage status refreshed/ }).waitFor(); results.checks.storage = await worker("storage");
  results.checks.cipherOnly = await worker("cipherOnly");
  // A killed renderer cannot complete a pagehide save. Success must already be durable.
  const cdp = await context.newCDPSession(page); await Promise.race([cdp.send("Page.crash").catch(() => undefined), new Promise(resolve => setTimeout(resolve, 3000))]); await page.close().catch(() => undefined);
  page = await context.newPage(); await page.goto(base + route); await ready(); await unlock(); assert.equal(await page.getByTestId("line-count").innerText(), "100000"); results.checks.killedTabRecovery = true;
  await page.getByRole("button", { name: "Lock vault", exact: true }).click(); await ready();
  await page.getByLabel("Vault passphrase").fill("deliberately-wrong-passphrase"); await page.getByRole("button", { name: "Unlock vault", exact: true }).click(); await page.getByRole("alert").filter({ hasText: /Wrong passphrase/ }).waitFor(); results.checks.wrongPassphrase = true;
  await unlock(); await page.reload(); await ready(); await unlock(); assert.equal(await page.getByTestId("line-count").innerText(), "100000"); results.checks.reload = true;
  await page.getByRole("link", { name: "Data Hub", exact: true }).click();
  const afterReload = path.resolve("test-results", "synthetic-after-reload.csv"); await writeFile(afterReload, csv(1));
  await page.getByTestId("csv-file").setInputFiles(afterReload); await page.getByRole("button", { name: "Confirm and import locally" }).click();
  await page.getByTestId("line-count").filter({ hasText: /^100001$/ }).waitFor({ timeout: 45000 });
  await page.reload(); await ready(); await unlock(); assert.equal(await page.getByTestId("line-count").innerText(), "100001"); results.checks.firstMutationAfterUnlock = true;
  await page.getByRole("button", { name: "Lock vault", exact: true }).click(); await ready();
  if (full) {
    assert.ok(!auth, "Synthetic benchmark must not reset an authenticated vault");
    for (const rows of [1000000, 2000000]) {
      results.measurements[`seed${rows}`] = await worker("seed", { rows });
      await context.close(); context = await chromium.launchPersistentContext(profile, browserOptions); await configureContext();
      page = await context.newPage(); await page.goto(base + route); await ready(); await unlock();
      assert.equal(await page.getByTestId("line-count").innerText(), String(rows));
      results.measurements[`navigationToUnlocked${rows}Ms`] = await page.evaluate(() => Math.round(performance.now()));
      results.checks[`startup${rows}Under3s`] = results.measurements[`navigationToUnlocked${rows}Ms`] < 3000;
      if (rows === 1000000) assert.ok(results.checks.startup1000000Under3s, "1M encrypted startup missed the local three-second target");
      await page.getByRole("button", { name: "Lock vault", exact: true }).click(); await ready();
      await page.evaluate(() => { window.__vaultLongTasks = []; });
      const change = await worker("firstChange", { rows });
      const changeTasks = await page.evaluate(() => window.__vaultLongTasks);
      results.measurements[`firstChange${rows}`] = { ...change, maxMainThreadLongTaskMs: Math.max(0, ...changeTasks) };
      results.checks[`firstChange${rows}OpenItem`] = change.overTenSeconds || Math.max(0, ...changeTasks) > 200;
      console.log(`First change at ${rows} lines: rebuild ${change.rebuildMs} ms, committed/encrypted ${change.totalMs} ms, max observed UI long task ${Math.max(0, ...changeTasks)} ms.`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile shell overflows"); results.checks.mobile = true;
  await Promise.all(headerChecks); assert.deepEqual(failures, []); results.checks.privacy = true;
  results.requests = { count: requests.length, paths: [...new Set(requests)].filter(p => !p.startsWith("/_next/")) };
  results.status = "passed"; console.log(JSON.stringify({ status: "passed", auth, browser: results.browser, checks: Object.keys(results.checks), startupTargets: full ? { oneMillion: results.checks.startup1000000Under3s, twoMillion: results.checks.startup2000000Under3s } : undefined, measurements: results.measurements }, null, 2));
} catch (error) { results.status = "failed"; results.error = error.message; throw error; }
finally { await writeFile(`test-results/vault-${channel}${auth ? "-auth" : ""}.json`, JSON.stringify(results, null, 2)); await context.close(); }
