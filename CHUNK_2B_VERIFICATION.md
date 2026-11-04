# Chunk 2B verification record

Chunk 2B is **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/rebatehq/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. No Chunk 2C work is included.

| Acceptance | Evidence and scope |
|---|---|
| Fresh migration application and runtime role/no-context checks | Verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500), 2026-10-28 |
| 88 fresh pgTAP checks, planned = ran; repeated suites with unchanged row counts | Verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500), 2026-10-28 |
| New pricing/rebate tables: tenant indexes, forced RLS, own-row controls, cross-tenant denials, exact ACLs, audit and browser-role denial | Verified by the database suites in both runs |
| Pricing/rebate golden tests, original margin goldens, seeded migration and runtime SQL tests | Verified by pnpm test in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500); seeded backfill uses PGlite in that test suite |
| Local logical dump/restore, four function ACL checkpoints, strict role/table/function/schema ACL and count comparisons, sentinel/runtime checks | Verified in [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/rebatehq/actions/runs/40730343531), 2026-10-28 |
| 91 restored-database pgTAP checks, planned = ran; repeated suites with unchanged row counts | Verified in [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/rebatehq/actions/runs/40730343531), 2026-10-28 |
| Application table inventory | 33 tenant tables; all included in isolation and restore comparisons |
| Hosted-target restore | **unverified** — hosted steps skipped in Restore Drill #11 |
| Supabase-managed backup/PITR and deployed UI/browser flows | **unverified** — not exercised by those jobs |

Migration: `20261028162156_chunk2b_pricing_rebate_tiers.sql`. Promoted from pending to locked without SQL content changes. Line-ending-normalized SHA-256:

```text
4f5e2795ffa22974e69cb3d2c3fc745a78653ff81bfa4385494884aa8f0b413a
```

All four earlier locked migration hashes and evidence remain unchanged. No new public SQL functions were added; the existing single function ACL registry/default privilege checks passed. The restore uses dump grants plus restore-only platform cleanup.

Full commit: `13cea5a7d17c614e8bd9ccd18bacf2d97b6bd12a`.
