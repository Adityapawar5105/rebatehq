// Review R3 (28 Nov 2026; review blocker B4): the invite → accept → device approval path, end to end against the real
// local stack. An Owner invites a colleague through the app's own form; the app sends the invitation through its normal
// Resend call, which CI points (RESEND_API_URL) at the small receiver below; the colleague opens the link, signs in by
// a real magic link from the local mail server, joins as a Sales Rep with a seat, and their device waits until the Owner
// approves it; then their vault opens with an active licence. Rate limits run through a real Redis behind an
// Upstash-compatible endpoint, as in production (CI starts it). No auth bypass and no admin key in the browser.
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import pg from 'pg';
import { signInLocal, localUrl, localDatabaseUrl, emailLink } from './vault-test-auth.mjs';

const channel = process.argv.find(v => v.startsWith('--browser='))?.split('=')[1] ?? 'chromium';
const base = process.env.VAULT_TEST_URL ?? 'http://localhost:3000';
localUrl(base, 'Invite gate app');
for (const name of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RESEND_API_KEY', 'RESEND_API_URL', 'EMAIL_FROM', 'VAULT_MAIL_URL', 'NEXT_PUBLIC_SUPABASE_URL'])
  assert.ok(process.env[name], `The invite gate needs ${name} (the app server must run with the same values)`);
const receiver = localUrl(process.env.RESEND_API_URL, 'Invitation email receiver');
const db = new pg.Client({ connectionString: localDatabaseUrl(process.env.SEED_DATABASE_URL, 'Invite gate database').href });
const passphrase = 'invite-gate-passphrase-' + randomUUID(), invitee = `invite-gate-${randomUUID()}@example.test`;
const checks = {}, outbox = [];

// The Resend stand-in: accepts only the app's bearer key and the Resend request shape, and records the message.
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 65536) req.destroy(); });
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/emails' || req.headers.authorization !== 'Bearer ' + process.env.RESEND_API_KEY) { res.writeHead(401).end(); return; }
    try { const m = JSON.parse(body); assert.ok(m.from && Array.isArray(m.to) && m.subject && m.text && m.html); outbox.push(m); res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: randomUUID() })); }
    catch { res.writeHead(422).end(); }
  });
});
await new Promise(r => server.listen(Number(receiver.port), receiver.hostname, r));

async function until(test, message, ms = 60000) { const end = Date.now() + ms; for (;;) { const v = await test(); if (v) return v; if (Date.now() > end) throw new Error(message); await new Promise(r => setTimeout(r, 500)); } }
async function createVault(page, owner) {
  await page.getByLabel('Vault passphrase').fill(passphrase); await page.getByLabel('Type the passphrase again').fill(passphrase);
  await page.getByLabel('Pricing Owner (name)').fill(owner); await page.getByRole('button', { name: 'Create encrypted vault', exact: true }).click();
  await page.getByRole('button', { name: 'Lock vault', exact: true }).waitFor({ timeout: 120000 });
}
const tone = page => page.getByTestId('licence-status').getAttribute('data-tone');

const browser = await chromium.launch({ headless: true });
try {
  await mkdir('test-results', { recursive: true });
  await db.connect();
  const options = { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' };

  // 1. The Owner: a workspace with a Scale licence and their own (first, so auto-approved) device and vault.
  const ownerContext = await browser.newContext(options), ownerPage = await ownerContext.newPage(); ownerPage.setDefaultTimeout(45000);
  const owner = await signInLocal(ownerContext, ownerPage, base);
  await createVault(ownerPage, 'Invite gate owner');
  await until(async () => (await tone(ownerPage)) === 'ok', 'The Owner\'s licence did not turn active');
  checks.ownerReady = { tenant: true, deviceActive: true };

  // 2. The invitation, through the app's own form and its normal Resend call.
  await ownerPage.goto(new URL('/account/users', base).href);
  await ownerPage.locator('#invite-email').fill(invitee); await ownerPage.locator('#invite-role').selectOption('rep');
  await ownerPage.getByRole('button', { name: 'Invite user', exact: true }).click();
  const mail = await until(() => outbox.find(m => m.to.includes(invitee)), 'The app sent no invitation email');
  assert.equal(mail.from, process.env.EMAIL_FROM);
  const inviteUrl = (mail.text.match(/https?:\/\/\S+\/invite\/[A-Za-z0-9_-]{43}/) || [])[0];
  assert.ok(inviteUrl && new URL(inviteUrl).origin === new URL(base).origin, 'The invitation has no link to this app');
  assert.ok(mail.html.includes(inviteUrl), 'The HTML and text invitations differ');
  const pending = await db.query("SELECT role FROM public.invite WHERE tenant_id=$1::uuid AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL", [owner.tenantId, invitee]);
  assert.equal(pending.rows[0]?.role, 'rep', 'The invitation row is missing or has the wrong role');
  checks.invitationSent = { viaResendCall: true, linkToApp: true, rowRole: 'rep' };

  // 3. The colleague opens the link, asks for a sign-in link on the invitation page, and follows the real magic link.
  const inviteeContext = await browser.newContext(options), inviteePage = await inviteeContext.newPage(); inviteePage.setDefaultTimeout(45000);
  await inviteePage.goto(inviteUrl);
  await inviteePage.getByLabel('Work email').fill(invitee);
  await inviteePage.getByRole('button', { name: 'Email me a sign-in link', exact: true }).click();
  await inviteePage.getByText('Check your email for a secure sign-in link', { exact: false }).waitFor();
  const link = await emailLink(new URL(process.env.VAULT_MAIL_URL), invitee, new URL(process.env.NEXT_PUBLIC_SUPABASE_URL));
  await inviteePage.goto(link); await inviteePage.waitForURL(u => u.pathname === '/home', { timeout: 60000 });
  const joined = await db.query("SELECT m.role,m.status,(SELECT count(*)::int FROM public.licence_seat s WHERE s.tenant_id=m.tenant_id AND s.user_id=m.user_id) AS seats,(SELECT accepted_at IS NOT NULL FROM public.invite i WHERE i.tenant_id=m.tenant_id AND i.email=m.email) AS accepted FROM public.membership m WHERE m.tenant_id=$1::uuid AND m.email=$2", [owner.tenantId, invitee]);
  assert.deepEqual(joined.rows[0], { role: 'rep', status: 'active', seats: 1, accepted: true }, 'Accepting did not make an active Sales Rep with a seat');
  checks.invitationAccepted = { realMagicLink: true, role: 'rep', seat: true };

  // 4. The colleague's device waits for the Owner: not the workspace's first device, so it starts pending.
  await inviteePage.getByRole('button', { name: /Create encrypted vault|Unlock vault/ }).waitFor();
  const device = await until(async () => (await db.query("SELECT d.id,d.status FROM public.licence_device d JOIN public.membership m ON m.tenant_id=d.tenant_id AND m.user_id=d.user_id WHERE d.tenant_id=$1::uuid AND m.email=$2", [owner.tenantId, invitee])).rows[0], 'The colleague\'s device did not register');
  assert.equal(device.status, 'pending', 'A second device was approved without the Owner');
  checks.devicePending = { status: 'pending' };

  // 5. The Owner approves it in Settings › Licence, seats and devices.
  await ownerPage.goto(new URL('/account/licence', base).href);
  await ownerPage.locator('button:not([disabled])', { hasText: 'Approve device' }).first().click();
  await until(async () => (await db.query('SELECT status FROM public.licence_device WHERE id=$1::uuid', [device.id])).rows[0]?.status === 'active', 'Approving did not activate the device');
  checks.deviceApproved = { byOwner: true };

  // 6. The colleague's vault now opens with an active licence.
  await inviteePage.reload(); await createVault(inviteePage, 'Invite gate colleague');
  await until(async () => (await tone(inviteePage)) === 'ok', 'The colleague\'s licence did not turn active after approval');
  checks.inviteeLicensed = { tone: 'ok' };

  const count = Object.keys(checks).length;
  assert.equal(count, 6, 'The invite gate ran fewer checks than planned');
  await writeFile(`test-results/invite-gate-${channel}.json`, JSON.stringify({ date: new Date().toISOString(), browser: browser.version(), checks }, null, 2));
  console.log(`Invite gate: ${count} checks passed (${channel}, real authenticated local Supabase).`);
} finally {
  await browser.close().catch(() => {}); await db.end().catch(() => {}); server.close();
}
