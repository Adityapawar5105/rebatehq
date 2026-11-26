// 8D Safari desktop pre-check (blueprint v2.6 gap 5). Runs Playwright's WebKit build against a production build in lab
// mode and RECORDS what works: cross-origin isolation and SharedArrayBuffer (DuckDB-Wasm threads), OPFS, creating a
// vault, importing a file, persistence after a reload, and the offline service worker. WebKit on Windows/Linux is not
// Safari (different storage, process and media stacks), so these results never support a Safari claim; the real spike
// needs Safari on a Mac. Writes test-results/webkit-precheck.json and exits 0 whatever the outcome.
//   VAULT_TEST_URL=http://127.0.0.1:3100 node scripts/webkit-precheck.mjs
import { webkit } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const base = process.env.VAULT_TEST_URL || "http://127.0.0.1:3100", route = "/lab/vault", secret = "WebKit pre-check passphrase 2026!";
const result = { browser: "Playwright WebKit (not Safari)", version: null, platform: process.platform, startedAt: new Date().toISOString(), checks: {}, errors: [] };
const step = async (name, work) => { try { result.checks[name] = await work(); } catch (e) { result.checks[name] = false; result.errors.push(`${name}: ${String(e?.message ?? e).split("\n")[0].slice(0, 300)}`); } };
const profile = await mkdtemp(path.join(os.tmpdir(), "rebatehq-webkit-"));
const context = await webkit.launchPersistentContext(profile, { headless: true });
result.version = context.browser()?.version() ?? null;
// Test-only: the production CSP says upgrade-insecure-requests. WebKit applies it to http://127.0.0.1 (Chromium exempts
// loopback), so every subresource would be upgraded to an https port that this local server does not serve. Production
// runs on https, where the directive is a no-op. WebKit also applies HSTS to 127.0.0.1, so that header is removed too. The
// result records both.
result.cspNote = "upgrade-insecure-requests and Strict-Transport-Security removed from responses for the local http server only";
await context.route(u => u.origin === new URL(base).origin, async r => {
  const response = await r.fetch(), headers = { ...response.headers() };
  delete headers["strict-transport-security"];
  if (headers["content-security-policy"]) headers["content-security-policy"] = headers["content-security-policy"].replace(/;s*upgrade-insecure-requests/, "");
  await r.fulfill({ response, headers });
});
const page = context.pages()[0] ?? await context.newPage();
result.console = [];
page.on("console", m => { if (["error", "warning"].includes(m.type()) && result.console.length < 20) result.console.push(m.type() + ": " + m.text().slice(0, 240)); });
result.failed = [];
page.on("requestfailed", r => { if (result.failed.length < 8) result.failed.push(r.url().slice(0, 120) + " " + (r.failure()?.errorText ?? "")); });
page.on("pageerror", e => { if (result.console.length < 20) result.console.push("pageerror: " + String(e.message).slice(0, 240)); });
try {
  await page.goto(base + route, { waitUntil: "load", timeout: 60000 });
  await step("crossOriginIsolated", () => page.evaluate(() => self.crossOriginIsolated === true));
  await step("sharedArrayBuffer", () => page.evaluate(() => typeof SharedArrayBuffer === "function"));
  await step("opfsDirectory", () => page.evaluate(async () => { const d = await navigator.storage.getDirectory(); await d.getFileHandle("webkit-probe.txt", { create: true }); return true; }));
  await step("persistRequestAvailable", () => page.evaluate(() => typeof navigator.storage.persist === "function"));
  await step("createVault", async () => {
    await page.getByRole("button", { name: /Create encrypted vault|Unlock vault/ }).waitFor({ timeout: 60000 });
    await page.getByLabel("Vault passphrase").fill(secret); await page.getByLabel("Type the passphrase again").fill(secret); await page.getByLabel("Pricing Owner (name)").fill("WebKit pre-check owner");
    await page.getByRole("button", { name: "Create encrypted vault", exact: true }).click(); await page.getByRole("button", { name: "Lock vault", exact: true }).waitFor({ timeout: 120000 }); return true;
  });
  await step("importCsv", async () => {
    await page.locator('nav a[href="#data-hub"]').click();
    await page.getByTestId("studio-files").setInputFiles([{ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from("line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount\n1,P1,C1,2026-01-05,2,20.00,0,0,0,12.00\n2,P1,C2,2026-01-06,1,10.00,0,0,0,6.00\n") }]);
    await page.getByRole("button", { name: "Review import" }).click(); await page.getByRole("heading", { name: "Batch report" }).waitFor({ timeout: 120000 });
    if (await page.getByTestId("studio-ack").count()) await page.getByTestId("studio-ack").check();
    await page.getByRole("button", { name: "Confirm and import locally" }).click(); await page.locator('[data-testid="line-count"][data-value="2"]').waitFor({ timeout: 120000 }); return true;
  });
  await step("persistsAfterReload", async () => {
    await page.reload(); await page.getByRole("button", { name: "Unlock vault", exact: true }).waitFor({ timeout: 60000 });
    await page.getByLabel("Vault passphrase").fill(secret); await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
    await page.locator('[data-testid="line-count"][data-value="2"]').waitFor({ timeout: 120000 }); return true;
  });
  await step("serviceWorkerControls", () => page.evaluate(async () => { if (!("serviceWorker" in navigator)) return false; await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 15000))]); return !!navigator.serviceWorker.controller || !!(await navigator.serviceWorker.getRegistration("/")); }));
} catch (e) { result.errors.push(String(e?.message ?? e).split("\n")[0].slice(0, 300)); }
finally {
  result.finishedAt = new Date().toISOString();
  await page.screenshot({ path: "test-results/webkit-precheck.png" }).catch(() => undefined);
  await context.close();
  await mkdir("test-results", { recursive: true }); await writeFile("test-results/webkit-precheck.json", JSON.stringify(result, null, 2));
  console.log("WebKit pre-check (not Safari):", JSON.stringify(result.checks), result.errors.length ? "errors: " + result.errors.join(" | ") : "", "| failed:", JSON.stringify(result.failed));
}
