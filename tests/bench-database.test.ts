// Chunk 8D: the benchmark migration and every store call, end to end in PGlite under the restricted app role.
import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./helpers/database";
import { relayFixture, asRelay } from "./helpers/relay-fixtures";
import { consent, setConsent, share, figures, withdraw, pseudonym } from "../lib/bench/store";

process.env.BENCH_PSEUDONYM_KEY = "22".repeat(32);
const payload = (band: number) => ({ v: 1, quarter: "2025-Q1", sizeBand: "S2", rows: [{ family: "electrical", metric: "pocket_margin", band }, { family: "electrical", metric: "discount_rate", band: 10 }] });

test("8D benchmarks in PGlite: Owner-only consent and sharing, pseudonymous storage, k-gated release, give to get, withdrawal", async () => {
  const db = await testDatabase();
  try {
    const { tenantId, actors } = await relayFixture(db), [owner, manager, rep] = actors.map(a => a.actor);
    const as = <T>(actor: typeof owner, work: () => Promise<T>) => asRelay(db, actor, work);
    assert.equal(await as(owner, () => consent(db, tenantId)), null);
    assert.deepEqual((await as(owner, () => setConsent(db, tenantId, owner.userId, true)))?.optedIn, true);
    for (const who of [manager, rep]) await assert.rejects(as(who, () => setConsent(db, tenantId, who.userId, false)), /row-level security/, "only the Owner decides");
    assert.equal(await as(manager, () => consent(db, tenantId)), null, "a manager cannot read the consent");
    assert.deepEqual(await as(owner, () => share(db, tenantId, payload(29))), { quarter: "2025-Q1", stored: 2 });
    await assert.rejects(as(rep, () => share(db, tenantId, payload(29))), (e: { code?: string }) => e.code === "42501");
    // Stored rows carry the keyed pseudonym and bands only.
    const stored = (await db.query("SELECT * FROM rebatehq_private.bench_contribution")).rows;
    assert.equal(stored.length, 2); assert.ok(stored.every((r: { tenant_id: unknown; pseudonym: Uint8Array }) => r.tenant_id === null && Buffer.from(r.pseudonym).equals(pseudonym(tenantId, "2025-Q1"))));
    assert.ok(!JSON.stringify(stored).includes(tenantId), "no tenant ID in the stored contribution");
    // Eleven more workspaces share the same quarter, so the cell reaches k = 10; then the operator releases it.
    for (let i = 0; i < 11; i++) {
      const f = await relayFixture(db), o = f.actors[0].actor;
      await asRelay(db, o, () => setConsent(db, f.tenantId, o.userId, true));
      await asRelay(db, o, () => share(db, f.tenantId, payload(20 + i % 5)));
    }
    await assert.rejects(as(owner, () => db.query("SELECT public.bench_publish('2025-Q1',1,10)")), /permission denied/, "the app role cannot release");
    await db.query("SELECT setseed(0.42)");
    assert.equal((await db.query("SELECT public.bench_publish('2025-Q1',1,10) AS n")).rows[0].n, 2);
    const { benchPrivateSql } = await import("../scripts/verify-restore-equivalence.mjs");
    const fp = (await db.query(benchPrivateSql)).rows[0];
    assert.ok([fp.submissions, fp.contributions, fp.releases, fp.release_log].every(v => /^[0-9a-f]{32}$/.test(v)), "the restore drill fingerprints all four tables");
    const fig = await as(owner, () => figures(db, tenantId, "2025-Q1"));
    assert.deepEqual(fig.cells.map(c => [c.family, c.metric, c.sizeBand]).sort(), [["electrical", "discount_rate", "S2"], ["electrical", "pocket_margin", "S2"]]);
    assert.ok(fig.cells.every(c => [c.p25, c.p50, c.p75].every(v => (v + 20) % 5 === 0) && c.p25 <= c.p50 && c.p50 <= c.p75));
    // Give to get: a workspace that did not share this quarter cannot see it.
    const outsider = await relayFixture(db), oo = outsider.actors[0].actor;
    await asRelay(db, oo, () => setConsent(db, outsider.tenantId, oo.userId, true));
    await assert.rejects(asRelay(db, oo, () => figures(db, outsider.tenantId, "2025-Q1")), (e: { code?: string }) => e.code === "42501");
    // Withdrawal deletes the stored rows and records the opt-out; figures stay but this workspace no longer sees them.
    const w = await as(owner, () => withdraw(db, tenantId, owner.userId));
    assert.equal(w.deleted, 1); assert.equal(w.consent?.optedIn, false);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM rebatehq_private.bench_submission WHERE pseudonym=$1", [pseudonym(tenantId, "2025-Q1")])).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM rebatehq_private.bench_release WHERE quarter='2025-Q1'")).rows[0].n, 2, "released figures are aggregates and stay");
    // A Starter workspace may record a refusal but not opt in.
    await db.query("UPDATE public.workspace_licence SET tier='starter' WHERE tenant_id=$1::uuid", [tenantId]);
    await assert.rejects(as(owner, () => setConsent(db, tenantId, owner.userId, true)), /row-level security/);
    // Consent changes are audited; contributions never are.
    const audit = (await db.query("SELECT entity_type FROM public.audit_log WHERE entity_type LIKE 'bench%'")).rows.map((r: { entity_type: string }) => r.entity_type);
    assert.ok(audit.length > 0 && audit.every((t: string) => t === "bench_consent"));
  } finally { await db.close(); }
});
