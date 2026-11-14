# RebateHQ

Security: [one-page whitepaper](./SECURITY_WHITEPAPER.md),
[STRIDE review and findings](./SECURITY_REVIEW.md), and
[independent reviewer checklist](./EXTERNAL_SECURITY_REVIEW.md).
Chunk 6B is CI-verified in [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464) on `ade310e` and, with its final integrity-probe follow-up, in [CI #77](https://github.com/Adityapawar5105/rebatehq/actions/runs/41992372460) on `0aae4aa`, 5 November 2026; see [verification](./CHUNK_6B_VERIFICATION.md).
These documents distinguish the local vault flow from control metadata and
remaining legacy readers. They make no app-wide or independently certified
security claim.

**Chunk 4E complete — verified in [MarginDesk CI #55](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704), 4 November 2026, commit `7fe3db82951e82d5ba8a049158a7ef0a17a69597`.** Guardrails, versioned rules, worker simulation, Pricing Owner approval, ERP exports and encrypted backup/restore are available in the local shell. CI passed 163 unit tests and the authenticated 25-check vault/privacy harness. All three local browser harnesses passed. See [CHUNK_4E_VERIFICATION.md](./CHUNK_4E_VERIFICATION.md) and [PHASE_4_VERIFICATION.md](./PHASE_4_VERIFICATION.md). ERP layouts and the real folder picker remain unverified; legacy server routes still exist. **5A is built (4 Nov 2026): item master cleanup with undo, cost basis comparison, 7-day checklist, ROI on Home, seven roles with worker-enforced cost hiding. **5A CI-verified** in [RebateHQ CI #59](https://github.com/Adityapawar5105/rebatehq/actions/runs/41854329390) on `632b24f`, [CI #60](https://github.com/Adityapawar5105/rebatehq/actions/runs/41855953059) on `7ec683e` (real-export evidence), and [CI #61](https://github.com/Adityapawar5105/rebatehq/actions/runs/41858525178) on `2fbb283` (merge-all and batch undo), 4 November 2026. See [CHUNK_5A_VERIFICATION.md](./CHUNK_5A_VERIFICATION.md); all measurements remain local only.** **5B CI-verified** in [RebateHQ CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee` with [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905) (local target), 4 November 2026: signed licences and tier caps, device revocation, legacy server business-data routes off by default, signed actor context and failed-login limits; see [CHUNK_5B_VERIFICATION.md](./CHUNK_5B_VERIFICATION.md). The revised table-retirement plan was approved on 5 Nov 2026 (wave 1 = chunk 6R after 6A, wave 2 = chunk 8R; see [RETIREMENT_PROPOSAL.md](./RETIREMENT_PROPOSAL.md)); 6R subsequently dropped 22 wave-1 tables (CI #73 / Restore Drill #18); 20 remain. **6A is CI-verified** in [CI #68](https://github.com/Adityapawar5105/rebatehq/actions/runs/41905416129) on `50263a5`: real public exports (UCI Online Retail I and II, AdventureWorks, Northwind) and synthetic Business Central, NetSuite, QuickBooks and SAP B1 layouts run to a Leak Report. 13 import failures were fixed with regression tests; date-range import added; vault schema v8. A follow-up built the four parked gaps (order-header joins, item-list cost, streamed XLSX sheets over 300,000 rows, German/French/Spanish/Dutch headers) and a near-quota browser check ([CI #69](https://github.com/Adityapawar5105/rebatehq/actions/runs/41960988113)); the 8 GB checklist was rerun and a 1M-line import memory fix passed [CI #70](https://github.com/Adityapawar5105/rebatehq/actions/runs/41965284570). See [PILOT_FILES.md](./PILOT_FILES.md) and [CHUNK_6A_VERIFICATION.md](./CHUNK_6A_VERIFICATION.md).

**Chunk 4B — CI-verified in [MarginDesk CI #44](https://github.com/Adityapawar5105/rebatehq/actions/runs/41660146540), 3 November 2026, commit `c382f7d`.** The GitHub job API confirms step 18, "Required authenticated local-vault privacy gate", completed successfully (not skipped). Its log records `pnpm test:vault:privacy --browser=chromium`, `auth: true`, `status: passed`: **one authenticated harness with 14 named checks**, not a Playwright test-runner count. The separate unit suite passed **67 JavaScript + 56 TypeScript = 123 tests**.

Privacy acceptance covers the **local vault flow only**. Legacy server business-data routes still exist; no app-wide "data never leaves your device" claim is made. **Unverified:** deployed Supabase sign-in, headed manual checks, physical crash/quota/multi-tab recovery, the historical storage-estimate discrepancy, and CI validation of the locally measured **~7.6 s / ~15–16 s first-change latency** (open item for 4C-1). Those timings remain local observations; Scale retains its 1M-line cap. 4C-1 has not started.

**4B CI-verified (CI #44, c382f7d).**
The signed-in `/home` shell now uses a single worker-hosted encrypted local
vault, audited native CSV ingestion, atomic snapshot generations and inactivity
locking. Phase 1 navigation is Home, Data Hub, Margin, Pricing, Reports and
Settings. Old server-backed screens are labelled **Legacy** under `/legacy/`.
See [CHUNK_4B_VERIFICATION.md](./CHUNK_4B_VERIFICATION.md) for measurements,
commands and limits, [VAULT_RESULTS.md](./VAULT_RESULTS.md) for startup and
first-change timings, and [STORAGE_FINDINGS.md](./STORAGE_FINDINGS.md) for the quota
investigation. The real authenticated local-vault privacy gate passed in CI #44; no app-wide privacy or deployment claim is made. **4C-1 has not started.**

**Chunk 4A — CI-verified in [MarginDesk CI #42](https://github.com/Adityapawar5105/rebatehq/actions/runs/41613748478), 3 November 2026, commit `395154d`.** `/lab/spike` runs a
self-hosted DuckDB-Wasm worker with synthetic OPFS persistence and memory-only
user-file imports. Full-size Chrome/Edge measurements and the pending manual
checklist are in [SPIKE_RESULTS.md](./SPIKE_RESULTS.md). CI passed 113 tests,
typecheck, the frozen migration lock and the production/self-hosted asset build.
The 4A browser harness and its measurements remain local evidence; that spike's
encrypted startup misses the three-second target. Those CI runs did not verify
headed manual checks, real Supabase sign-in, the production encrypted vault,
crash/quota/multi-tab recovery or the storage-estimate discrepancy. Current 4B
local evidence and remaining limits are recorded above. Reproduce the 4A spike with
`pnpm install --frozen-lockfile`, `pnpm build`, `pnpm start --hostname 127.0.0.1 --port 3100`,
then `pnpm benchmark:spike --browser=chrome` or `--browser=msedge` in another terminal.

**Chunk 3C and Phase 3 — verified in [MarginDesk CI #39](https://github.com/Adityapawar5105/rebatehq/actions/runs/40937330833) and [MarginDesk Restore Drill #13](https://github.com/Adityapawar5105/rebatehq/actions/runs/40938982321), 2026-10-30 (Asia/Calcutta), commit `2f8b06d`.** Acceptance covers **162 fresh / 165 restore-mode pgTAP checks**, planned = ran with repeatability, across **38 tenant tables**. The dashboard shows invoice data readiness with a visible equal-weight formula and improvement steps; the demo scores **25%** because standard costs and default zeros are not actual evidence. Sheets schedules stage read-only CSV reviews through existing tables; commits remain explicit. Email-in/SFTP interfaces are inert previews. Phase 4 has not started. See [CHUNK_3C_VERIFICATION.md](./CHUNK_3C_VERIFICATION.md).

Migration `20261029175710_chunk3c_invoice_actual_cost.sql` is now **locked** with its unchanged normalized hash; all six earlier locked migrations and hashes are unchanged. Apply all migrations to new databases. Restore Drill #13 passed the strict column metadata, evidence/ingestion hashes, ACL/count/sentinel/runtime comparisons and repeated restored-database suite on a **local target**.

**Still unverified:** authenticated Next.js behavior, the deployed Supabase app, hosted-target restore, serverless time limits, recurring execution of schedules (requires an operator-configured runner), live email and SFTP ingestion, and browser UI beyond the local harness.

**Import capacity follow-up — verified in [MarginDesk CI #37 on `32aff35`](https://github.com/Adityapawar5105/rebatehq/commit/32aff35cd2842723206272a4147769779aa5a0d3/checks), 2026-10-29; CI job duration: 10m 24s.** The default maximum is **10,000 data rows per file**, configured by `MAX_IMPORT_DATA_ROWS` in [lib/import-config.ts](./lib/import-config.ts). CI passed the fresh/populated PGlite boundary tests, batched commit/undo with exact restoration, and later-batch rollback inside one transaction and one audited catalog import job. No Restore Drill was run because no migration or restore inventory changed. Evidence and timing limits are in [IMPORT_CAPACITY_VERIFICATION.md](./IMPORT_CAPACITY_VERIFICATION.md). Authenticated Next.js behavior, the deployed Supabase app, hosted restore, serverless time limits and browser UI beyond the local harness remain **unverified**. Chunk 3C had not started at that milestone; its current status is recorded in CHUNK_3C_VERIFICATION.md.

**Chunk 3B baseline — verified in [MarginDesk CI #35](https://github.com/Adityapawar5105/rebatehq/actions/runs/40844679109), 2026-10-29, commit `87d7d90`:** Supplier files can produce a before/after import plan, resolve app/file conflicts, commit valid rows, and undo safely from history. **Export for Excel** adds protected row IDs and versions; re-upload detects edits since export. Dated costs and list prices feed the shared margin/price engine. That run exercised the former **200-data-row** limit, not the new capacity follow-up. CI passed the lifecycle, conflict, exact-undo, decimal/unit, dated pricing and SQL execution tests. Source bytes are not stored; normalized plans and before/after journals are retained in existing import jobs and audits. No Restore Drill was run because no migration or restore inventory changed. Authenticated Next.js behavior, the deployed Supabase app, hosted restore, and browser UI beyond the local harness remain **unverified**. See [Chunk 3B verification](./CHUNK_3B_VERIFICATION.md) and [assumptions](./ASSUMPTIONS.md). Chunk 3C had not started at that milestone; its current status is recorded in CHUNK_3C_VERIFICATION.md.

**Chunk 3A — verified in [MarginDesk CI #33](https://github.com/Adityapawar5105/rebatehq/actions/runs/40751595777), 2026-10-29, commit `7b27ba4`:** Price Lists has a three-step supplier-file review for data-only XLSX, CSV and TSV. It detects the sheet and header, suggests mappings, reports issues with original row and column, and saves supplier/file-type templates per tenant. This is a dry run: it stores review metadata and relevant data-quality issues, but does not import product, cost or price rows or retain the source file. CI passed the upload size/type/row/column/cell limits, streaming limits, macro and ZIP/XML rejection, malicious-text and formula-safe export tests, malformed-file fuzzing, messy-file parsing, and tenant-scoped template tests. Authenticated Next.js behavior, the deployed Supabase app, hosted restore, and browser UI beyond the local harness remain **unverified**. No Restore Drill was run for 3A because no migration or restore inventory changed. See [Chunk 3A verification](./CHUNK_3A_VERIFICATION.md) and [assumptions](./ASSUMPTIONS.md). Chunk 3B had not started at that milestone; its current status is recorded in CHUNK_3B_VERIFICATION.md.

Chunk 2C and Phase 2 are **verified in [MarginDesk CI #31](https://github.com/Adityapawar5105/rebatehq/actions/runs/40739445610) and [MarginDesk Restore Drill #12](https://github.com/Adityapawar5105/rebatehq/actions/runs/40740709133), 2026-10-28, commit `ed2aa6d`**. At that Phase 2 milestone, acceptance was **156 fresh / 159 restore-mode pgTAP checks**, planned = ran with two-run repeatability, across **38 tenant tables**. The Chunk 2C migration is locked with its unchanged normalized hash. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by these runs remain **unverified**. Chunk 3A builds on that baseline; Chunk 3B had not started at that milestone; its current status is recorded in CHUNK_3B_VERIFICATION.md. See [the Phase 2 verification record](./CHUNK_2C_VERIFICATION.md) and [current assumptions](./ASSUMPTIONS.md).

**Chunk 2B status — verified:** pricing precedence and tiered rebate audit are **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/rebatehq/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. The migration is locked with its unchanged normalized hash. Both suites passed with **88 fresh / 91 restore-mode pgTAP checks** and **33 tenant tables**. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by those runs remain **unverified**. See [the verification record](./CHUNK_2B_VERIFICATION.md). This records the earlier Chunk 2B milestone.


RebateHQ is being moved from a browser-local prototype to a multi-tenant app for mid-market distributors. Phase 1 adds the production foundation: Supabase Auth magic links, tenant and role enforcement, PostgreSQL RLS, audit logging, and a safe prototype import/export path. It does not add new pricing, rebate, or ERP features.

## Roadmap (Blueprint v2.4)

[BLUEPRINT.md](./BLUEPRINT.md) v2.4 now governs the product: customer pricing data moves to the browser (DuckDB-Wasm in a Web Worker, encrypted OPFS), and this server becomes the control plane (identity, workspaces, licences, ciphertext relay). The verified records above describe the earlier server-side phases and stay as historical evidence. **The privacy gates verify the local-vault flow; legacy server business-data paths remain default-off until retirement in 8R. No unqualified app-wide privacy claim is made.** [ARCHITECTURE_TRANSITION.md](./ARCHITECTURE_TRANSITION.md) classifies every route, module and table; [BLUEPRINT_EXECUTION_PLAN.md](./BLUEPRINT_EXECUTION_PLAN.md) holds the chunk prompts.

| Repo phase | Blueprint phase | Chunks | Status |
|---|---|---|---|
| 0–3 | Foundations | 0, 1, 2A–2C, 3A–3C | Verified (CI #39, Restore Drill #13) |
| 4 | Phase 1 core | 4.0, 4A, 4B, 4C-1/4C-2, 4D, 4E | Implemented; 4E CI-verified in [CI #55](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704), `7fe3db8`; performance remains local evidence |
| 5 | Phase 1b + control plane | 5A cleanup, cost basis, checklist, roles · 5B licences, retire server business-data paths, carried security fixes | **5A CI-verified** in [RebateHQ CI #59](https://github.com/Adityapawar5105/rebatehq/actions/runs/41854329390) on `632b24f`, [CI #60](https://github.com/Adityapawar5105/rebatehq/actions/runs/41855953059) on `7ec683e` (real-export evidence), and [CI #61](https://github.com/Adityapawar5105/rebatehq/actions/runs/41858525178) on `2fbb283` (merge-all and batch undo), 4 November 2026. See [CHUNK_5A_VERIFICATION.md](./CHUNK_5A_VERIFICATION.md). **5B CI-verified** in [CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee` and [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905); see [CHUNK_5B_VERIFICATION.md](./CHUNK_5B_VERIFICATION.md) |
| 6 | Pilot hardening + security | 6A real files · 6R legacy table retirement (wave 1) · 6B security review and whitepaper → sellable v1 | 6A CI-verified (CI #68, #69, #70); see [CHUNK_6A_VERIFICATION.md](./CHUNK_6A_VERIFICATION.md). 6R CI-verified (CI #73, Restore Drill #18; 22 server tables dropped, 20 remain); see [CHUNK_6R_VERIFICATION.md](./CHUNK_6R_VERIFICATION.md). 6B CI-verified ([CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464) on ade310e; [CI #77](https://github.com/Adityapawar5105/rebatehq/actions/runs/41992372460) on 0aae4aa); see [record](./CHUNK_6B_VERIFICATION.md) |
| 7 | Phase 2 | 7A, 7U, 7B–7F | 7A CI-verified ([CI #82](https://github.com/Adityapawar5105/rebatehq/actions/runs/42034048481), [Restore Drill #19](https://github.com/Adityapawar5105/rebatehq/actions/runs/42043079490); migration locked). 7U CI-verified ([CI #86](https://github.com/Adityapawar5105/rebatehq/actions/runs/42061581577)). 7B CI-verified ([CI #89](https://github.com/Adityapawar5105/rebatehq/actions/runs/42101094326)); see [CHUNK_7B_VERIFICATION.md](./CHUNK_7B_VERIFICATION.md). 7C-1 CI-verified ([CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986), `aecfa32`) ([record](./CHUNK_7C_VERIFICATION.md)). 7C-2 CI-verified ([CI #104](https://github.com/Adityapawar5105/rebatehq/actions/runs/42406059786) on `05ff468`; [record](./CHUNK_7C2_VERIFICATION.md)). 7C-3a CI-verified ([CI #108](https://github.com/Adityapawar5105/rebatehq/actions/runs/42444422694) on `155188f`, 8 November 2026; [record](./CHUNK_7C3_VERIFICATION.md)). 7C-3b CI-verified ([CI #111](https://github.com/Adityapawar5105/rebatehq/actions/runs/42449524974) on `fa93eab`; [part b](./CHUNK_7C3_VERIFICATION.md)). 7D-1 CI-verified ([CI #114](https://github.com/Adityapawar5105/rebatehq/actions/runs/42470690491) on `585ccf8`, 8 November 2026; [record](./CHUNK_7D_VERIFICATION.md)). 7D-2 CI-verified ([CI #123](https://github.com/Adityapawar5105/rebatehq/actions/runs/42606577225) on `2b1481d`, 9 November 2026; v16 / 47 local tables; 54 authenticated Chromium / 52 Firefox / 12 real-auth relay checks). 7E–7F not started. 7V-3a CI-verified ([CI #118](https://github.com/Adityapawar5105/rebatehq/actions/runs/42480527882) on `027a14d`; [record](./CHUNK_7V3_VERIFICATION.md)). 7V-3b CI-verified ([CI #120](https://github.com/Adityapawar5105/rebatehq/actions/runs/42487588209) on `7ef16fc`). 7E-1 CI-verified ([CI #126](https://github.com/Adityapawar5105/rebatehq/actions/runs/42616397012) on `2cee899`). 7E-2 CI-verified ([CI #128](https://github.com/Adityapawar5105/rebatehq/actions/runs/42640305379) on `b24f6c8`). 7F-1 CI-verified ([CI #130](https://github.com/Adityapawar5105/rebatehq/actions/runs/42674285171) on `1903986`). 7F-2 CI-verified ([CI #132](https://github.com/Adityapawar5105/rebatehq/actions/runs/42687463097) on `799c2f9`); Phase 2 complete except mobile. |
| 8 | Phase 3 | 8A–8D, 8R | 8A CI-verified ([CI #135](https://github.com/Adityapawar5105/rebatehq/actions/runs/42786807751) on `666608f`). 8B CI-verified (8B-1 [CI #137](https://github.com/Adityapawar5105/rebatehq/actions/runs/42847127386) on `509a0f8`; 8B-2 [CI #138](https://github.com/Adityapawar5105/rebatehq/actions/runs/42853411139) on `e23f5f7`; [record](./CHUNK_8B_VERIFICATION.md)). 8C CI-verified (8C-1 [CI #140](https://github.com/Adityapawar5105/rebatehq/actions/runs/42896532114) on `efe4291`; 8C-2 [CI #142](https://github.com/Adityapawar5105/rebatehq/actions/runs/43028662048) on `16622a9`; [record](./CHUNK_8C_VERIFICATION.md)). 8D CI-verified ([CI #146](https://github.com/Adityapawar5105/rebatehq/actions/runs/43059749723), [Restore Drill #20](https://github.com/Adityapawar5105/rebatehq/actions/runs/43070833569); [record](./CHUNK_8D_VERIFICATION.md)). 8R (wave-2 table retirement) CI-verified ([CI #150](https://github.com/Adityapawar5105/rebatehq/actions/runs/43453893489), [Restore Drill #21](https://github.com/Adityapawar5105/rebatehq/actions/runs/43467938552); [record](./CHUNK_8R_VERIFICATION.md)); the server now keeps only 13 control-plane tables. |
## Local app

Netlify hosting configuration and the real-sign-in deployment prerequisites are in [NETLIFY_DEPLOYMENT.md](./NETLIFY_DEPLOYMENT.md). Hosting and hosted sign-in remain unverified until the account and runtime prerequisites in that record are completed.

**Running it on this machine without Supabase (lab mode).** Without a Supabase project, pages that need sign-in fail with "Supabase Auth is not configured".

1. Put `VAULT_LAB_ENABLED=true` and a fresh key set from `generateKeys()` in `scripts/control-plane-keys.mjs` in a git-ignored `.env.local`.
2. Run `node scripts/build-spike.mjs` with those variables loaded, because the vault worker embeds the licence verify key at build time.
3. Start `next dev`.

`/` then opens `/lab/vault`. That is the real local vault with a synthetic user and workspace, and a short-lived Scale licence that `/api/licence` issues only in lab mode with nobody signed in. Sign-in, workspaces and the relay need Supabase: add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`).

Requirements: Node.js 20.9 or newer, pnpm 10, and Docker for local Supabase database tests.

```powershell
pnpm install
Copy-Item .env.example .env.local
# Fill in the local Supabase URL, publishable key, and the dedicated NOBYPASSRLS app login URL.
pnpm exec supabase start
pnpm dev
```

Open `http://localhost:3000`. Supabase local development sends magic links to its local Inbucket email viewer. Apply migrations with `pnpm exec supabase db reset`.

To review a supplier file, sign in as an owner or manager, open **Price Lists → Review a supplier file**, choose an XLSX/CSV/TSV file, confirm the suggested sheet, header and eight field mappings, and select **Review mapped file**. The result lists every detected issue and previews up to 50 source rows. A supplier/file-type template can be saved and reloaded for the same headers. Downloaded issue and preview CSVs neutralize formula-like cells. The file is processed in memory and is not retained; no business rows are imported.

To import, explicitly approve any numeric format/unit conversions and source warnings, then select **Preview changes**. Review new/changed/unchanged/rejected rows and choose current app or file values for conflicts. Changes and source issues are paged; every issue is available in the issue download. Conflict choices save when refreshing or changing pages. **Excel lifeline and import history** offers a CSV with `md_row_id` and `md_version` and an **Undo import** action. Keep metadata, SKU and base units intact; use blank metadata for new rows. Undo refuses later edits or dependencies and retains audit/history records. Amounts use tenant currency and standard cost basis.

### Configure import capacity

Edit **only `MAX_IMPORT_DATA_ROWS`** in `lib/import-config.ts` to change the build-wide maximum, then rebuild and rerun the capacity tests. Its default is **10,000**, including unchanged/rejected data rows, excluding the header and blank rows. The same maximum applies to XLSX/CSV/TSV review, import plans, commit and lifeline export. It is not a per-tenant setting. Lowering it blocks oversized pending commits. Undo has no row-count cap; journal and safety limits still apply.

`IMPORT_BATCH_SIZE` is 250 and review pages contain 100 rows. Batches share the request's single database transaction and catalog `import_job`: there are no intermediate commits or per-batch jobs. Every business write still invokes the existing audit triggers. Any later-batch error rolls back earlier batches, the final job update and their audit writes. Successful undo restores original business rows, IDs and counts; audit/history metadata stays.

Upload byte, raw-row, cell, diagnostic, ZIP-part and journal bounds derive from the same maximum; separate 64-column, 2,000-character cell, archive-ratio and XML protections remain. At the default, uploads are capped at 10,240,000 bytes, raw rows at 10,025 (header/preamble allowance), cells at 641,600, issues at 120,000 and journals at 81,920,000 bytes. Complex histories or oversized files may still need splitting. The routes allow 300 seconds and individual import SQL statements 60 seconds, transaction-local; hosting/pool limits must also permit the workload.

The **real-Postgres 10,000-row benchmark is verified in [CI #39](https://github.com/Adityapawar5105/rebatehq/actions/runs/40937330833), commit `2f8b06d`**: `commitImport` **11,605 ms**, `undoImport` **3,442 ms**, PostgreSQL **17.11**, restricted role **`margindesk_app`**. It excludes parsing, setup, network and durable COMMIT/WAL flush, and **is not a serverless latency guarantee**. Local PGlite timings in the capacity record are separate measurements. CI #37's 10m 24s was the whole job duration; that earlier run did not capture these real-Postgres timings. Deployed throughput and the unverified behaviors listed above remain unverified. See [the detailed capacity record](./IMPORT_CAPACITY_VERIFICATION.md).

## Verification

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check:service-role
pnpm check:db-role
pnpm test:db
```

`pnpm test` runs the Phase 0 margin-engine golden tests, role/import/CSV/secrets/rep-response tests, a static migration guard, and a scan for service-role credentials in user-facing code. `pnpm test:db` runs the pgTAP isolation and audit suite. It uses `TEST_DATABASE_URL` when set (including hosted disposable restore targets); otherwise it delegates to `supabase test db` for the local stack. `pnpm check:db-role` connects through `APP_DATABASE_URL`, checks the actual pool login and effective app role, and verifies that a request without user context sees zero tenants.

### Phase 1 verification status — 2026-10-26

Phase 1 is proven. [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598) passed on commit `aabfb20`, including migration, runtime role, unit/security, typecheck, build, and 53 fresh-mode pgTAP checks. [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508) passed end to end in local Supabase mode, including source/target comparisons and 56 restore-mode checks. Both test suites passed repeatability checks. Hosted-Supabase restore mode and managed backup/PITR remain **unverified**.

### Chunk 2A verification status — 2026-10-28

Chunk 2A and the restore-platform-ACL-cleanup procedure are **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`**. Migration `202610280001_chunk2a_cost_units_currency.sql` is locked in `migrations.lock` with its existing normalized hash. The historical Chunk 2A plans were 70 fresh and 73 restore-mode checks across at least 29 tenant tables. The local-target restore passed strict ACL/count comparisons, four function ACL checkpoints, sentinel/runtime checks and repeatability. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by these jobs remain **unverified**. See [`SECURITY_CHECK.md`](./SECURITY_CHECK.md) and [`OPERATIONS.md`](./OPERATIONS.md).

#### Run the database checks locally (Windows PowerShell)

```powershell
pnpm exec supabase start -x studio,edge-runtime,storage-api,imgproxy,logflare,vector
pnpm exec supabase db reset
$env:SEED_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
pnpm setup:test-db-role
```

Copy the `$env:APP_DATABASE_URL = '...'` assignment printed by the setup command into the same PowerShell session, then run:

```powershell
pnpm check:db-role
pnpm test:db
pnpm exec supabase stop --no-backup
```

The checked-in GitHub Actions workflow performs these steps on pull requests, pushes to `main`/`master`, or manual `workflow_dispatch`. It needs no database or Supabase secrets. Push the branch to GitHub, then open **Actions → RebateHQ CI → Run workflow**. The database URLs are derived from the local CLI status output, and the restricted app-login password is generated randomly for the disposable local stack and written only to the job environment.

Run **Actions → MarginDesk Restore Drill → Run workflow** to exercise a logical dump and restore. Dumps are restricted to the application-owned `public` schema; Supabase-managed schemas are excluded. The drill inventories source tables and counts, creates synthetic `auth.users` stand-ins for only referenced IDs, and then compares app-owned ACLs and row counts after restore. `local` mode needs no secrets. `hosted` mode requires the two disposable database URL secrets documented by name in `.env.example`; source must already have the MarginDesk migration applied and target must be a fresh empty Supabase project. Never point the workflow at production. The corrected local-target workflow is verified in [Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`; hosted-target mode remains **unverified**.

## Phase 1 security model

- Supabase Auth owns verified email sessions. No user can join an existing tenant without an owner-issued, single-use, seven-day invitation.
- A dedicated PostgreSQL login is a member of `rebatehq_app`, which is `NOLOGIN`, `NOSUPERUSER`, and `NOBYPASSRLS`. Each server request verifies the Supabase user, opens a short transaction, sets `LOCAL ROLE rebatehq_app`, sets the JWT claims and `app.real_actor_id`, and lets tenant-scoped RLS filter records. The pool rejects a session login that is superuser, `BYPASSRLS`, or not a member of `rebatehq_app`.
- Browser roles have no direct grants on public business tables. User data goes through Next.js APIs. User-facing code never uses the Supabase service-role key.
- The shared [`margin-engine.js`](./margin-engine.js) remains unchanged and is used for server quote recomputation and prototype import snapshots. Client-provided prices, margin values, and guardrail zones are discarded.
- Rep responses omit costs, margin dollars, and cost components. Reps see only their own quotes, assigned customers, product prices, guardrail zone, and headroom.
- Business writes are recorded by database triggers in an append-only audit log. Manual actions add specific action names alongside row mutation events.

## Prototype data migration

1. Open the static local prototype `index.html` in the browser where the data exists.
2. Open its local settings/Connectors view and choose **Export this browser data as JSON**. Inspect the export before sending or importing it.
3. In the hosted app, sign in as the destination tenant owner and open Account → Data migration & export.
4. Select the JSON, run a dry run, review row counts and warnings, then confirm the same file within 30 minutes.

The import is single-use per tenant, limited to 2 MB, and recomputes quote margins and monthly snapshots on the server. Demo role-switch values are not migrated; invite real users. `seed_data.json` contains synthetic fixture data only.

## Scripts and operations

- `pnpm seed:demo` creates an owner-owned demo tenant from `seed_data.json`. It requires an existing verified `DEMO_OWNER_USER_ID`, `SEED_DATABASE_URL`, and `APP_DATABASE_URL`.
- `pnpm import:prototype <file>` validates and records a dry run. Add `--commit` to commit a matching fresh dry run. Set `TENANT_ID` and `ACTOR_ID`.
- `scripts/purge-deleted-tenants.ts` removes business data for tenants disabled for 30 days; it preserves audit rows. Review `OPERATIONS.md` before running it.
- `supabase/migrations/` is canonical. `schema.sql` mirrors the Phase 1 migration for older tooling.
- Vercel deploys the Next.js app. Follow [`OPERATIONS.md`](./OPERATIONS.md) for project setup, backup, restore, and retention.

## Current limits and deferred work

- The four main pages remain Dashboard, Price Lists, Quoting, and Rebates. File review, catalog commit/undo, invoice readiness and staged Sheets reviews are implemented. Invoice-actuals import UI, supplier price comparison, full quote configuration, rebate claims, private-Sheets OAuth and ERP/CRM sync remain later work.
- There is no managed Supabase project or production credentials in this workspace. Live email delivery, hosted auth, deployment, and a managed-database restore drill remain operator setup items.
- Local Supabase/pgTAP checks require Docker. The real database suites are verified in CI #39 and local-target Restore Drill #13; this close-out's local commands use the PGlite harness, not a new local Supabase run.
- The virus-scan adapter is a placeholder. Files are processed in memory and not stored; connect a managed scanner before enabling persisted uploads.
- Owner export omits connector credential ciphertext; connectors must be reauthorized after restore.
- The current audit log is append-only and retained independently after tenant purge. Do not treat audit retention as a substitute for a legal retention policy.

## Chunk 3C ingestion and timing — verified in CI #39 / local Restore Drill #13

First insights in minutes from files; a live connector typically takes weeks.

The three server-only flags in `.env.example` default false: `MD_SHEETS_INGESTION`, `MD_EMAIL_DROP_STUB` and `MD_SFTP_DROP_STUB`. Enable Sheets explicitly, review a CSV in the existing wizard and save its supplier mapping, then choose **Price Lists → Scheduled file reviews**. Re-save older templates to add per-column header hashes; raw headers are not stored. Save a Google Sheets link, mapping, header row, interval and explicit number/unit approvals. Changed headers stop the fetch and identify the row/columns. **Fetch review now** stages issues and a dry run; inspect them and explicitly commit valid rows. Existing history/undo still applies.

Only public/link-readable Google Sheets CSV exports are supported; there is no OAuth or private-Sheets access. Initial host is exactly `docs.google.com`; export redirects use only `doc-…-sheets.googleusercontent.com` and `/export/`. Every hop is HTTPS and DNS/IP checked, with pinned TLS connections, a 15-second total deadline, 5-second idle timeout, three-redirect maximum and existing upload/parser limits. Use manual files for confidential/private sheets rather than publishing them. Preview email addresses use `.invalid` and cannot receive mail; no mail/SFTP servers or upload endpoints exist.

Configure a trusted external runner at least hourly with `APP_DATABASE_URL`, `MD_SHEETS_INGESTION=true`, `TENANT_ID` and an active owner/manager `ACTOR_ID`, then run `pnpm ingest:due`. It processes up to five due schedules per invocation with the non-bypass app pool; it never uses `SEED_DATABASE_URL`. Schedule metadata is UTC. Invoke separately per tenant and keep the operator identity/database URL server-side. The repo supplies the due runner, not a deployed recurring service.

`pnpm benchmark:import` passed in CI #39 with the timings above. It verifies audits/exact restoration, rolls back its fixture and checks every tenant-table count. The Sheets security/staging tests and expanded local restore passed in the same acceptance milestone; this completes Phase 3's automated scope. **Authenticated Next.js behavior, the deployed Supabase app, hosted restore, serverless time limits, recurring schedule execution without an operator-configured runner, live email/SFTP ingestion and browser UI beyond the local harness remain unverified.**

## Chunk 5B — CI-verified and Restore Drill passed (4 November 2026)

**5B CI-verified** in [RebateHQ CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee` (CI #63/#64 also passed) and [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905), local target. Migration `20261104160022_chunk5b_control_plane.sql` is now locked with its hash unchanged; the eight earlier locked migrations are unchanged. Suite: **188 fresh / 191 restore-mode checks**, **42 public tenant tables**, plus an owner-only private issuer table and a nontransactional login-budget sequence. See [CHUNK_5B_VERIFICATION.md](./CHUNK_5B_VERIFICATION.md). No 6A work or table retirement is authorized.

Licences are manually issued for pilots with `pnpm exec tsx scripts/issue-licence.ts <workspace-uuid> <starter|professional|scale> <ISO-expiry>`, using an operator's administrative `SEED_DATABASE_URL`. There is no billing integration. The first active owner is seated; other seats and devices are managed at /account/licence. Starter permits 1 seat and 1 location/ERP profile, Professional 5 seats and multiple locations, Scale 15 seats and multiple locations. Local SKU/line limits are in `lib/licence-policy.ts`: 20k/200k, 100k/1M, 200k/1M respectively. Scale's 1M limit remains provisional.

Configure `ACTOR_SIGNING_SECRET` (32 random bytes in hex), `LICENCE_SIGNING_KEY` (Ed25519 PKCS8 base64), and matching `NEXT_PUBLIC_LICENCE_VERIFY_KEY` (SPKI base64) in the operator's secret manager. Only the public verification key is bundled for the browser/worker. Install the audit key with `node scripts/control-plane-keys.mjs --install` using the admin URL. Never commit keys or dump contents. CI generates independent ephemeral keys, masks private values before export and needs no real secrets. A separate fixture signing key is used only by the intercepted synthetic test worker; the app's signing private key never enters that bundle.

Assertions last one hour online, refresh every five minutes, and allow up to 24 hours of offline grace, clipped to the licence end date. Invalid, absent, expired, revoked or unseated authority makes the vault read-only; viewing, unlocking, verification and encrypted backup remain available. New devices need owner approval after the workspace's first owner device. Revocation cannot be learned while offline; the fixed deadline still applies. Licences are application policy, not DRM against a device owner modifying the browser or its clock.

Keep `LEGACY_BUSINESS_ENABLED` unset/false. The retired class C/X handlers return 410 before request/auth/database access, pages 404, and legacy links are absent. Enabling the emergency legacy flag invalidates the local-only boundary. Historical business tables are retained and protected; [RETIREMENT_PROPOSAL.md](./RETIREMENT_PROPOSAL.md) awaits your approval. The old purge job is suspended and scheduled server ingestion fails closed while the flag is off.

After an operator upgrades the workspace licence, an Owner/Admin can choose **Use licensed capacity** in local Settings. It updates only the encrypted vault’s capacity metadata, with a local audit entry; it neither sends rows to the server nor recreates the vault. Lower profiles stay available at setup.


### Chunk 7C-1 — pricing operations (CI-verified: CI #100)

Verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) on `aecfa32` (239 unit tests, 41 named authenticated
privacy checks and 11 authenticated relay checks).

Professional and Scale now have **Margin → Margin bridge** and **Pricing →
Increase planner / Price versions / Price exceptions / Contract expiry**. The bridge
reconciles price, volume, mix and cost effects to the exact change in pocket margin.
Segment increases and version reversals create drafts; current guardrails and the
named Pricing Owner still control approval and export. Letters are generated locally
as translated text. Customer exports preserve customer_id in the generic layout.

The worker-only local schema is v11 (37 tables). All 11 applied Supabase migrations
and their hashes are unchanged. The bridge method, imported-unit limits, current
floors and quantity-break scope are explicit in [ASSUMPTIONS.md](./ASSUMPTIONS.md).
See [CHUNK_7C_VERIFICATION.md](./CHUNK_7C_VERIFICATION.md) for evidence and limits.
7C-2 adds competitor observations, the guarded Basic/full price grid, what-if sliders, cost-to-serve loss review and export-receipt landed checks. See [verification and limits](./CHUNK_7C2_VERIFICATION.md); verified in [CI #104](https://github.com/Adityapawar5105/rebatehq/actions/runs/42406059786) on `05ff468`. Blueprint unchanged.

### Chunk 7V — new look (CI-verified: 7V-1 in CI #95, approved by the user; 7V-2 in CI #96)

The app has a new shell: a sidebar with icons that collapses (a drawer on phones), a compact top bar with search and the language and theme pickers, page headers, and a summary strip. It is built from shared components in `components/ui` with design tokens in `app/theme.css`. The unlock screen and Home were rebuilt on them in 7V-1. 7V-2 added the Margin waterfall chart, KPI tiles and whale curve, "On this page" jump bars in Data Hub and Settings, a tidier Pricing and Quotes layout, and the same look on every remaining screen and the account pages. Before and after screenshots are in [CHUNK_7V_VERIFICATION.md](./CHUNK_7V_VERIFICATION.md).

### Chunk 7B — Quote Desk, Price Check and customer credit (CI-verified: CI #89)

A new **Quotes** section (Professional and Scale) has four tabs: **Price Check**, **Quote**, **Approval inbox** and **History**.

- **Price Check:** a SKU plus customer lookup. Enter submits, so a USB barcode scanner works.
- **Quote:** each line shows a thermometer between floor, target and start.
  - A line below its floor needs a reason and an approval (Sales Manager, Pricing Owner or Owner / CFO, never the author).
  - The exception can also go to the encrypted 7A team inbox.
- **Credit signal:** green, amber or red from the new **AR aging** import file type.
- **Sales Reps never see cost or margin** (decision 16). The 5A "Let Sales Reps see cost" switch is removed, and a test checks every payload a rep can receive.
- The local vault schema is v10. See [CHUNK_7B_VERIFICATION.md](./CHUNK_7B_VERIFICATION.md).

### Chunk 7U — themes, languages, command palette and glossary (CI-verified: CI #86)

Every screen now reads its text from message keys (`lib/i18n/locales`). The header has a **language** picker (English, Español, Français, Français (Canada)) and a **theme** picker (system, light, dark, high contrast). Both are display settings kept in this browser. Numbers, amounts, percentages and dates use `Intl`, and the Leak Report PDF is generated in the chosen language. **Ctrl/Cmd+K** opens a command palette for screens, commands, SKUs and customers. Typing only filters the list; SKU and customer matches come from the local vault and never include cost. A finance glossary on Home, and **?** buttons beside the margin numbers, explain the terms. ERP exports and the audit log stay language-neutral. Translations are machine-assisted and need native-speaker review before a pilot. See [CHUNK_7U_VERIFICATION.md](./CHUNK_7U_VERIFICATION.md).

### Chunk 7A — encrypted collaboration relay (CI-verified: CI #82, Restore Drill #19)

Home → **Open shared inbox** adds workspace-wide encrypted quote, price-change
and rebate references, one/two-level preset approvals, comments and mentions.
This is a reference workflow, not Quote Desk or a vault share. It requires an
active Professional/Scale seat and an approved device. Local Admin/IT cannot
open business collaboration. Existing Phase 1 Pricing Owner export approval stays.

Operators must explicitly set `RELAY_ENABLED=true`; it defaults off. Before
starting/rotating, verify every device fingerprint through a separate trusted
channel. Joining members enter the administrator fingerprint independently.
Private keys and workspace keys stay inside the encrypted browser vault. There
is no server recovery; revoke lost devices and rotate from a surviving trusted
admin device. Rotation cannot erase old plaintext or old keys already held.

Standard preset: one distinct approver through 5000.00 currency units, two above;
Conservative: always two. These are nominal per-currency presets, not FX-adjusted
or customer-configurable policy. Requesters cannot approve themselves. Rejection
is final for that revision. Sync retrieves the inbox; email/push is not implemented.
All approved relay members can decrypt a shared reference; mentions are attention
metadata and do not create private subgroups.

Limits: 60 active devices, 256 epochs, 10000 events/16 MiB ciphertext per workspace,
16 KiB encrypted message. Quotas stop new writes rather than delete history.
See [RELAY_DESIGN.md](./RELAY_DESIGN.md), [CHUNK_7A_VERIFICATION.md](./CHUNK_7A_VERIFICATION.md)
and the security review for metadata visibility and fork/rollback limits.
A malicious endpoint or trusted deployment can still read an unlocked vault.
New migration remains pending until green CI plus the user's Restore Drill.

The separate blueprint v2.4 update (`51001c0`, section 22 item 24) is preserved.
7C-2 verification covers its original items 6–10. Multi-currency and Firefox are now verified in 7C-3a; competitor alternatives, health alerts, relay sync status and the cash-leak hero are now verified in 7C-3b. See ASSUMPTIONS.md.


## Workspace currency and browser support (7C-3a)

Settings → Workspace currency chooses a two-decimal ISO currency (USD, CAD, AUD, GBP, EUR and other supported cent-based currencies). Existing vaults stay USD with identical amounts. Choose before importing: changing currency with business data is blocked; create an empty vault and re-import instead.

Each import file records its source currency and your rate to workspace currency. Enter workspace units for one source unit. We never fetch rates. Exact conversions round half away from zero to the cent; import review/history and source-linked margin math show the rate. Fix Later and returns retain it. Generic price exports include currency; named ERP layouts keep their original columns.

Chrome and Edge are primary desktop targets. Firefox is supported: the full required 44-check Firefox lab gate passed in [CI #108](https://github.com/Adityapawar5105/rebatehq/actions/runs/42444422694) on `155188f`, 8 November 2026, alongside 46 authenticated Chromium vault checks and 11 authenticated relay checks. Safari is not supported yet. Windows Firefox launch and other manual limits are recorded in [CHUNK_7C3_VERIFICATION.md](./CHUNK_7C3_VERIFICATION.md). 7C-3b is verified below; 7D is not started.

**7C-3a is CI-verified** in [CI #108](https://github.com/Adityapawar5105/rebatehq/actions/runs/42444422694) on `155188f`, 8 November 2026: 256 unit tests (78 JS + 178 TS), **46 authenticated Chromium vault checks**, **44 Firefox lab checks**, and **11 real-authenticated local-Supabase relay checks**. Both required browser steps ran and passed, with nonzero check counts. The fresh 152-check pgTAP suite ran twice with unchanged tenant row counts. Local vault **v13 / 42 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill was required or run because no Supabase migration/inventory changed.
**Next prompt: 7D**, only on explicit instruction.


## Home monitoring and competitor alternatives (7C-3b)

**7C-3b is CI-verified** in [CI #111](https://github.com/Adityapawar5105/rebatehq/actions/runs/42449524974) on `fa93eab`, 8 November 2026: 260 unit tests (78 JS + 182 TS), **48 authenticated Chromium vault checks**, **46 Firefox lab checks**, and **12 real-authenticated local-Supabase relay checks**. Both required browser steps ran and passed with nonzero check counts. The fresh 152-check pgTAP suite ran twice with unchanged tenant row counts. Local vault **v13 / 42 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill was needed or run: no Supabase migration or inventory changed.

Home checks run when its screen opens and when you choose Check now, with a last-checked timestamp; there is no background notification service. Compare today plus the preceding 89 UTC days with the prior 90. The strict margin-drop threshold defaults to five percentage points and lasts for the current Home session. A second alert requires fewer distinct orders and a deeper list-weighted discount. Missing invoice IDs and incomplete cost coverage are disclosed. Up to 50 alerted customers are shown with the total count.

The 90-day hero is the existing finder’s deduplicated total for this window, with overlap and formulas under Show the math. It is a read-only estimate and does not add findings to the separately recorded lifetime ROI ledger; use Margin to record findings. Alternatives are the top three same-category SKUs by estimated margin dollars/unit for the selected customer, using the current resolved book price and complete historical unit freight, rebate and cost. Review product/unit suitability before quoting. All amounts use workspace currency. These figures are restricted to cost-capable roles.

The relay inbox shows synced, pending or conflict and the last successful sync time from the encrypted session. It does not promise background synchronization. Hosted sign-in/restore, headed/native permission checks, physical recovery, language review, real ERP systems and new large-vault monitoring latency remain unverified. Blueprint unchanged.

### Grid standard (7V-3a)

Every data grid sorts and filters from its column headers (click a header to sort; the filter button lists the column's values with a search box), shows "N of M rows" while filtered, and totals the selected rows (sum, average, minimum, maximum, count) in the workspace currency. Paged grids sort, filter and total over all their rows in the local worker, not just the page shown. Verified in [CI #118](https://github.com/Adityapawar5105/rebatehq/actions/runs/42480527882) on `027a14d`; see [CHUNK_7V3_VERIFICATION.md](./CHUNK_7V3_VERIFICATION.md).

### Row notes (7V-3b)

Data Hub lists every customer and product (Customers and Item master grids, with sort, filter and totals). Each row can carry a private plain-text note of up to 1,000 characters, edited in place. Notes stay in the encrypted vault and its backups: never shared, uploaded or in ERP exports, and never shown to Sales Reps. The command palette finds rows by note for the roles that can see notes. Removing a file warns how many notes go with the rows only it used; merging duplicate SKUs combines their notes, and undo restores them. Verified in [CI #120](https://github.com/Adityapawar5105/rebatehq/actions/runs/42487588209) on `7ef16fc`.

### Vendors (7E-1)

Vendors (cost roles; Professional and Scale) has two tabs. **Price review** takes a supplier cost sheet loaded through Data Hub (loading it changes no price) and shows each line's change against the vendor's previous cost or the item cost, lines to check (SKU not in the item master, a different cost on the same date, a later cost already on file), the margin effect on recent volume, the open quotes it affects with margin before and after, and the saved rules it would trigger. **Purchase variance** shows, per SKU, receipts, suppliers, the unit cost range and average, and the variance to the item master cost, with the purchase lines behind it. Verified in [CI #126](https://github.com/Adityapawar5105/rebatehq/actions/runs/42616397012) on `2cee899`.

### Historical scenario simulator (7E-2, Scale)

The third Vendors tab, for roles that run pricing simulations on a Scale licence (checked in the worker), replays whole past months (up to 36) of sales and credit lines with up to 20 price or cost changes by all lines, category, customer or SKU. Each line goes through the same waterfall as the Margin page; a price change moves list, discount and rebate together, freight is unchanged, and quantities are as sold. It shows actual and scenario margin side by side and a breakdown by category, SKU, customer, tier or month. The replay runs month by month in the worker with progress and cancel, at most 2,000,000 lines, into a temporary table: nothing in the vault changes. Verified in [CI #128](https://github.com/Adityapawar5105/rebatehq/actions/runs/42640305379) on `b24f6c8`.

### Reports: Review Pack, digest, ROI v2 and rep scorecard (7F-1)

Reports has three tabs. **Review packs** (cost roles; Professional and Scale) builds the monthly Pricing Review Pack or the weekly digest in the worker on request and downloads it as a PDF in the user's language (English, Spanish or French): leaks, the margin bridge, price exceptions, contracts expiring within 90 days, rebates and supplier claims, ROI and, weekly, the customer health alerts. Checks run only while the app is open; the last-checked time is kept in the vault. **Recovery tracker** separates leaks identified from recovery that a person records against a real finding and an exported rule run, with an evidence reference and confirmation; a recovery can be voided exactly. **Team compliance** (quote roles, Sales Reps included) shows floor and target compliance and "margin protected" points, never cost or margin: the team view by default, a person's own view only after they opt in, and no ranking. Verified in [CI #130](https://github.com/Adityapawar5105/rebatehq/actions/runs/42674285171) on `1903986`.

### More import formats and folder re-import (7F-2)

Import Studio also reads **fixed-width print reports** (.prn, or .txt without a delimiter): it finds the columns from aligned gaps, shows them on a ruler over the first lines, and lets you move them or detect them again. **Text-based PDF tables** are read with pdf.js, bundled with the app and loaded only when a PDF is added; scanned PDFs are refused (no OCR). **Parquet files** are read by DuckDB on this device with DuckDB's own Parquet extension, shipped with the app and integrity-checked; nothing is fetched from DuckDB's servers. Repeated page headers and page footers are skipped, and recipes keep the column layout. **Folder re-import** (Chrome and Edge) remembers an import folder in this browser, asks for permission again each session, and adds the files a saved recipe recognises that are not already imported; you review and confirm the batch as usual. Verified in [CI #132](https://github.com/Adityapawar5105/rebatehq/actions/runs/42687463097) on `799c2f9`.

### Anonymous benchmarks (8D)

**Reports › Anonymous benchmarks** (Professional and Scale, roles that see cost) compares your margin, discount, rebate and freight rates with anonymous distributors of a similar size, by product family. It is off unless the workspace Owner turns it on.

**What is shared:** only whole-percent bands per family, the quarter and a size band. The Owner reviews exactly what will be sent and presses Share each quarter. Customers, items, category names, revenue and notes never leave the device.

**What is published:** peer figures appear 45 days after a quarter ends, for groups of 10 or more workspaces, as 5-point ranges with statistical noise, and only to workspaces that shared that quarter. The Owner can delete everything they shared at any time.

Verified in [CI #146](https://github.com/Adityapawar5105/rebatehq/actions/runs/43059749723) and [Restore Drill #20](https://github.com/Adityapawar5105/rebatehq/actions/runs/43070833569).

### Win/loss, audit pack, templates and offline use (8C)

**Win/loss** (Quote Desk): once a quote is sent, record whether it was won or lost, the main reason and, optionally, the competitor and a note. The note stays on this device. The Win/loss tab reports outcomes by reason, customer or rep, with values; roles that see cost also get margin. Sales Reps see their own quotes only.

**Audit pack** (Reports, roles with audit access, every tier): a ZIP with the full hash-chained audit log, its verification result and the rule to re-check it, approvals, exports and role changes, and a cover page in your language. It holds no prices, costs or notes.

**Templates:** a vendor negotiation sheet (Vendors) and a rebate agreement draft for each customer rebate program, both PDFs generated on this device.

**Offline use:** in Chrome and Edge, RebateHQ keeps a copy of the app itself (never your data) so it opens without a connection. Your data is already in the encrypted vault on this device. Settings › Offline use shows the state, and signing out removes the copy.

Verified in [CI #140](https://github.com/Adityapawar5105/rebatehq/actions/runs/42896532114) and [CI #142](https://github.com/Adityapawar5105/rebatehq/actions/runs/43028662048).

### Margin Drain agents, cost index triggers and dead stock (8B)

**Margin Drain agents** (Home, cost roles, Professional and Scale) check six things while RebateHQ is open:
- leaks over a threshold;
- book prices below their floor;
- prices expiring within 30, 60 or 90 days;
- supplier cost rises;
- the customer health alerts;
- fired cost index triggers.

The checks run on the schedule you save, and at opening when one is overdue. Nothing runs while the app is closed, and nothing is sent anywhere. Findings land in an inbox where you can mark them seen, dismiss or reopen them; findings that no longer apply are resolved by the next check.

**Cost index triggers** (Vendors › Cost index) read index series you upload in Data Hub. A trigger fires when an index rises past your threshold, or when an exchange rate you type rises past its buffer. It then shows the expected cost of every SKU in its category, rounded exactly.

**Dead stock** (Vendors › Dead stock) reads a stock-on-hand file and covers items with stock and no sale in 90 days or more. For each item it shows:
- the capital tied up;
- the carrying cost per month, from your cost of capital and storage cost;
- a clearance price that never goes below replacement cost;
- up to three selling items it could replace.

Chosen prices become a normal draft for the Pricing Owner to approve and export.

Verified in [CI #137](https://github.com/Adityapawar5105/rebatehq/actions/runs/42847127386) and [CI #138](https://github.com/Adityapawar5105/rebatehq/actions/runs/42853411139).

### Deal guidance and cross-sell (8A)

In Quote Desk each line shows a **suggested price** and why: this customer's recent prices, else what similar customers in the same tier paid, else the guardrail target, else the book price. A supplier cost increase in the last 90 days holds a lower suggestion at the target (shown as a flag, never an amount), and every suggestion stays between the floor and the start price. "Use" applies it. Below the lines, **"Customers who buy these also buy"** lists items often on the same invoices (at least 3 times, lift 1.2 or more), and "Add" puts one on the quote. Sales Reps see both, never cost or margin. 8A also added a set-up card for workspace sharing (shown where the server enables it and the device has no key) and a notice naming the pages of a partly scanned PDF. Verified in [CI #135](https://github.com/Adityapawar5105/rebatehq/actions/runs/42786807751) on `666608f`.

### Customer rebates (7D-1)

Verified in [CI #114](https://github.com/Adityapawar5105/rebatehq/actions/runs/42470690491) on `585ccf8`, 8 November 2026. 269 unit tests (78 JS + 191 TS), **50 authenticated Chromium vault checks**, **48 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice with unchanged tenant row counts. Both required browser gates ran and passed with nonzero counts. Local vault **v14 / 45 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill needed or run: no Supabase schema/inventory change.

Use Rebates & Contracts for customer terms, tier progress and source-linked accruals. Agreement CSVs require explicit calculation_mode (retroactive/incremental) and rebate_treatment (additional/replace), plus terms confirmation. Imported invoice rebates remain intact; the waterfall shows their declared adjustment. No supplier claims or Purchases import yet (7D-2). Hosted/manual recovery, customer/ERP acceptance and new large-vault performance remain unverified; see the verification record.

7D-2 supplier claims / Purchases import is CI-verified in [CI #123](https://github.com/Adityapawar5105/rebatehq/actions/runs/42606577225) on `2b1481d`, 9 November 2026. Local vault v16 / 47 tables; see CHUNK_7D_VERIFICATION.md part 2 for exact scope, commands and limitations. Supplier claim exports are local preparation files, not supplier submissions. 7E is not started.
