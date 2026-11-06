// UI review screenshots (chunk 7V). Creates a fresh lab vault with the Playground's fictional sample data and
// captures every section in light and dark, at desktop (1366x768) and phone (375x812) width.
// Usage: node scripts/ui-screenshots.mjs --out=docs/ui/after [--url=http://localhost:3001] [--browser=chrome]
// Needs a server with VAULT_LAB_ENABLED=true (next dev or next start). Only synthetic data is shown.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const arg = (name, fallback) => process.argv.find(v => v.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const out = arg("out", "docs/ui/after"), base = arg("url", process.env.VAULT_TEST_URL || "http://localhost:3001"), channel = arg("browser", "chrome");
const SECTIONS = ["home", "data-hub", "margin", "pricing", "quotes", "reports", "settings"];
const SIZES = { desktop: { width: 1366, height: 768 }, phone: { width: 375, height: 812 } };
const secret = "synthetic-ui-review-passphrase";

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ ...(channel === "chromium" ? {} : { channel }), headless: true });
const context = await browser.newContext({ viewport: SIZES.desktop, reducedMotion: "reduce" });
const page = await context.newPage(); page.setDefaultTimeout(60000);
const settle = async () => { await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined); await page.waitForTimeout(500); };
// Grow the viewport to the page height instead of a stitched full-page capture, so sticky bars stay at the top.
const shot = async name => { const vp = page.viewportSize(); const h = await page.evaluate(() => document.documentElement.scrollHeight); await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 6000) }); await page.waitForTimeout(200); await page.screenshot({ path: path.join(out, `${name}.png`) }); await page.setViewportSize(vp); console.log("saved", name); };
const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const issues = [];
try {
  await page.goto(base + "/lab/vault");
  await page.getByLabel("Vault passphrase").waitFor(); await settle();
  for (const [size, viewport] of Object.entries(SIZES)) { await page.setViewportSize(viewport); await settle(); await shot(`create-light-${size}`); }
  await page.setViewportSize(SIZES.desktop);
  await page.getByLabel("Vault passphrase").fill(secret); await page.getByLabel("Pricing Owner (name)").fill("Synthetic Pricing Owner");
  await page.getByRole("button", { name: "Create encrypted vault", exact: true }).click();
  await page.getByRole("button", { name: "Lock vault", exact: true }).waitFor();
  await page.locator('nav a[href="#data-hub"]').click();
  await page.getByRole("button", { name: "Load the Playground", exact: true }).click();
  await page.getByText(/^Playground loaded:/).first().waitFor({ timeout: 180000 });
  for (const theme of ["light", "dark"]) {
    await page.getByTestId("theme").first().selectOption(theme);
    for (const [size, viewport] of Object.entries(SIZES)) {
      await page.setViewportSize(viewport);
      for (const section of SECTIONS) {
        await page.evaluate(s => { location.hash = s; }, section); await settle();
        if (await overflow()) issues.push(`${section} ${theme} ${size}: horizontal overflow`);
        await shot(`${section}-${theme}-${size}`);
      }
    }
  }
  await page.setViewportSize(SIZES.desktop);
  await page.getByRole("button", { name: "Lock vault", exact: true }).first().click();
  await page.getByLabel("Vault passphrase").waitFor(); await settle();
  for (const theme of ["light", "dark"]) { await page.getByTestId("theme").first().selectOption(theme); await settle(); await shot(`unlock-${theme}-desktop`); }
  console.log(JSON.stringify({ out, overflow: issues }, null, 1));
} finally { await context.close(); await browser.close(); }
