# RebateHQ project direction

## Governing blueprint

Read `BLUEPRINT.md` before planning or implementing RebateHQ work. The user-approved **Blueprint v2.6** governs (v2.6, 10 Nov 2026: B2B buyer gap registry, section 22 item 28; two pre-8A fixes; item 29 records the 8R retirement; item 30 the 14 Nov 2026 user feedback pass: checklist off Home, Scale 2M lines, Leak Report redesign; item 31 the operator subscriptions view, migration locked after CI #160 and Restore Drill #22; item 32 the 15 Nov 2026 Home greeting and work tabs and the trimmed command palette; item 33 the 16 Nov 2026 interface polish: checkbox size, spacing, lock screen, sub-tab search, page-scoped errors; item 34 the 21 Nov 2026 Quote Desk completion, vault v22; item 35 the 22 Nov 2026 Phase 15 pull-forward, vault v23; item 36 the 23 Nov 2026 sidebar and shell redesign; item 38 the 24 Nov 2026 team sharing decisions and design, `SHARING_DESIGN.md`; item 39 the 26 Nov 2026 near-miss rebate tiers; item 37 is reserved for the new list prices in PR #23). Section 22 records its approved changes. v2.3 UX/quoting/pricing, v2.4 multi-currency/Firefox, and v2.5 selection aggregates/row notes/grid filter-sort work have been implemented only as the verified chunks below state; other roadmap items remain future work. Later explicit user instructions take precedence. Any blueprint edit must add a section 22 entry and be reported to the user.

`BLUEPRINT_EXECUTION_PLAN.md` sequences the work into repo chunks (4.0, 4A-4E,
5A-5B, 6A, 6R, 6B, 7A, 7U, 7B, 7V (7V-1, 7V-2, 7V-3), 7C (7C-1, 7C-2, 7C-3), 7D (7D-1, 7D-2), 7E-7F, 8A-8D, 8R, 9A) with a standard preamble and "Done when" criteria.
`ARCHITECTURE_TRANSITION.md` classifies every existing route, module and table
as control plane, logic to port to the browser, server path to retire, or legacy.

Key decisions:

- Target wholesale distributors with 50–300 employees.
- Use a hybrid local-first architecture: pricing, costs, invoices, rules,
  simulations and margin data stay on the user's device. The target engine is
  DuckDB-Wasm in a Web Worker, with encrypted OPFS persistence.
- Keep the cloud control plane limited to identity, licences/seats, public index
  data, app updates and a ciphertext-only collaboration relay. Supabase is not
  the target store for customer pricing data.
- Support Chrome and Edge as primary targets and Firefox (CI #108), persistent-storage requests, folder auto-backups where the native picker exists and
  an encrypted export fallback. Use decimal/integer money, streaming imports,
  versioned vault migrations and the blueprint's capacity/memory guardrails.
- Launch with local multi-file conversion/import and ERP-ready file exports.
  CRM connectors are deferred until pilots request them. Preview corrections and
  preserve issue/source tracking; never evaluate workbook formulas or macros.
- Require a named Pricing Owner and cap approvals at two levels (single-level
  Pricing Owner approval in Phase 1).
- No "data never leaves your device" claim until the CI privacy gate passes.
- Follow the exact tier limits, feature placement, roadmap and evidence rules in
  the full blueprint. Capacity/performance numbers and marketing promises are
  targets, not verified product capabilities.

## Product name

The product was renamed from MarginDesk to **RebateHQ** on 4 Nov 2026 (blueprint
section 22, items 13-14) because margindesk.ai already trades under that name.
The old name intentionally remains only in applied migrations (which still create
`margindesk_app`; migration `20261104120000_rename_app_role_to_rebatehq.sql`
renames it to `rebatehq_app`; locked in `migrations.lock` after CI #58 and Restore
Drill #14 passed on `251efef`), `schema.sql`, and past CI/restore
evidence lines. The GitHub repo is now `rebatehq`. Browser storage keys were renamed
with a carry-forward from the legacy keys; vaults saved before the rename stay in
the legacy OPFS folder `margindesk-vaults` (Chromium cannot rename OPFS directories)
and are opened in place. Do not edit applied migrations. `tests/brand-name.test.js`
fails if the old name appears outside those legacy bridges and past-evidence
records; add a file to its `LEGACY_FILES` only for a deliberate bridge.

## Existing implementation and task scope

The completed repository Phases 0–3 are the earlier backend foundation. The
blueprint's product-roadmap phases are a separate sequence; do not rename past
verification evidence or assume planned features already exist. The server's
business tables were dropped in 6R and 8R and the retired business routes answer
410, but team sharing stores encrypted copies of shared data in Supabase Storage
and the privacy gates do not yet read WebSocket frames: do not describe the
product as having achieved a "data never leaves your device" boundary (the
owner's decision D11).

### Current state (26 November 2026)

This section supersedes the dated orders in the chunk history below, such as "Do not start 7D", "Next chunk: …" and "Only 9A remains". Those orders are history.
- **Merged on `main`:** every chunk through 8R; roadmap phases 1 to 16 apart from the owner's items; team sharing S1 to S5b; near-miss tiers (blueprint item 39). The sidebar redesign (PR #24) merged on 23 Nov 2026.
- **Numbers:** local vault v25 / 69 tables. Supabase has 18 locked migrations, 1 pending (`20261129120000_review_r2_relay_quotas.sql`, review R2 rest, waiting for CI and the user's Restore Drill), and 15 control-plane tables. pgTAP plans 160 fresh and 163 restore checks. Staging `rebatehq-staging` has all 18 (the review R2 migration applied on 27 Nov 2026 with `supabase db push`), with `RELAY_ENABLED` false.
- **Excluded by the owner:** payments (Phase 12) and the mobile app (9A / 15.5).
- **The open work list:** the 26 Nov full project review, kept in the owner's private notes and not in this public repo. R1 fixes are in progress.
- Work follows the owner's explicit instruction for each step.

Keep all applied migrations and their locked hashes unchanged. Follow
`MIGRATION_RULES.md`, preserve validated margin-engine golden cases and security
gates, and distinguish local checks from passing CI/restore evidence.

Do only the chunk the user's current prompt names; never start the next chunk on
your own. Chunks 4.0, 4A, 4B and 4C-1 are done and CI-verified (4C-1: CI #48,
`ea4e5b6`). 4C-2 (ERP mapper, resilient parser, Fix Later, health score,
Playground) is done and CI-verified (CI #51, `a9ca8f7`). 4D (decimal
pocket-margin engine, reconciliation, show-the-math, leak finder, Leak Report,
ROI v1, credits; vault schema v5) is done and CI-verified (CI #53, `6d21cf0`);
its leak finder reproduces `tests/fixtures/playground-manifest.json` exactly.
4E (guardrails, versioned rules, preview, owner approval, ERP export, encrypted backup/restore; vault v6) is done and CI-verified in [CI #55](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704), commit `7fe3db8` (163 unit tests, 25 named authenticated privacy checks). Local timings and real ERP/picker limits are in `docs/evidence/CHUNK_4E_VERIFICATION.md`. 5A (item master cleanup with undo, cost basis comparison, 7-day setup checklist, ROI v1 on Home, seven local roles with worker-enforced cost hiding, named Pricing Owner at setup; vault v7) is CI-verified: **5A CI-verified** in [RebateHQ CI #59](https://github.com/Adityapawar5105/rebatehq/actions/runs/41854329390) on `632b24f`, [CI #60](https://github.com/Adityapawar5105/rebatehq/actions/runs/41855953059) on `7ec683e` (real-export evidence), and [CI #61](https://github.com/Adityapawar5105/rebatehq/actions/runs/41858525178) on `2fbb283` (merge-all and batch undo), 4 November 2026. Local-only measurements and unverified limits are in `docs/evidence/CHUNK_5A_VERIFICATION.md`. 5B (signed licences and tier caps, device revocation, legacy server business-data routes default-off, signed actor context, failed-login limits, private issuer key) is CI-verified in [RebateHQ CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee` with [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905) (local target), 4 November 2026; its migration `20261104160022_chunk5b_control_plane.sql` is locked. See `docs/evidence/CHUNK_5B_VERIFICATION.md`. `RETIREMENT_PROPOSAL.md` was approved with revisions on 5 November 2026 (blueprint section 22, item 15): wave 1 (21 tables) is chunk 6R after 6A, and wave 2 (12 tables) is chunk 8R after 8B. Drop tables only inside those chunks. 6A (pilot hardening with real files, 5 Nov 2026) is **CI-verified** in [CI #68](https://github.com/Adityapawar5105/rebatehq/actions/runs/41905416129) on `50263a5`; its follow-up (order-header joins, item-list cost, streamed XLSX sheets, localized headers, near-quota check; blueprint section 22, item 17) passed [CI #69](https://github.com/Adityapawar5105/rebatehq/actions/runs/41960988113) on `549b7fa`, and the 8 GB rerun's 1M memory fix passed [CI #70](https://github.com/Adityapawar5105/rebatehq/actions/runs/41965284570) on `ce9ada6`. 6A is complete; benchmark timings are local only. Details are in `PILOT_FILES.md` and `docs/evidence/CHUNK_6A_VERIFICATION.md`; the local vault schema is v8 and no Supabase migration was added. Pilot files stay in git-ignored `test-results/real/`. 6R (wave 1: 22 server tables dropped; 20 remain) is **CI-verified** in [CI #73](https://github.com/Adityapawar5105/rebatehq/actions/runs/41977200715) and [Restore Drill #18](https://github.com/Adityapawar5105/rebatehq/actions/runs/41979671868) on `8a34e06`; its migration `20261105120000_chunk6r_retire_wave1.sql` is locked in `migrations.lock`. See `docs/evidence/CHUNK_6R_VERIFICATION.md`. 6B (security review and whitepaper: STRIDE review, SECURITY_WHITEPAPER.md, SECURITY_REVIEW.md risk register, EXTERNAL_SECURITY_REVIEW.md, engine asset integrity pins, allow-listed auth logging, high/critical dependency audit gate in CI) is **CI-verified** in [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464) on `ade310e` and [CI #77](https://github.com/Adityapawar5105/rebatehq/actions/runs/41992372460) on `0aae4aa`; no migration or blueprint change. See `docs/evidence/CHUNK_6B_VERIFICATION.md`. This completes the plan's sellable-v1 milestone. 7A (ciphertext-only collaboration relay: device keys, wrapped workspace keys, signed events, one- or two-level approvals, comments and @mentions; four relay tables; local vault v9; behind `RELAY_ENABLED`, default off) is **CI-verified** in [CI #82](https://github.com/Adityapawar5105/rebatehq/actions/runs/42034048481) on `a65c395` and [Restore Drill #19](https://github.com/Adityapawar5105/rebatehq/actions/runs/42043079490) on `7652013`; its migration `20261105130000_chunk7a_ciphertext_relay.sql` is locked (11 applied). See `docs/evidence/CHUNK_7A_VERIFICATION.md` and `RELAY_DESIGN.md`. 7U (UX foundations: message-key i18n with en/es/fr/fr-CA catalogs in `lib/i18n`, theme tokens in `app/theme.css`, command palette, finance glossary, accessibility pass; no migration, no vault schema change) is **CI-verified** in [CI #86](https://github.com/Adityapawar5105/rebatehq/actions/runs/42061581577) on `b2d273a` (authenticated privacy gate with the i18n checks, and the real-Supabase relay gate). See `docs/evidence/CHUNK_7U_VERIFICATION.md`. From 7U on, every user-facing string is a message key in every shipped language (`tests/i18n.test.ts`) and colours come only from theme tokens (`tests/theme.test.ts`). 7B (Quote Desk, Price Check, AR aging credit signal, rep cost toggle removed, decision 16 payload test, `quote`/`quoteApprove` capabilities; local vault v10; no migration) is **CI-verified** in [CI #89](https://github.com/Adityapawar5105/rebatehq/actions/runs/42101094326) on `f344009` (authenticated privacy gate with `quotesUi`, relay gate 11 checks); follow-ups with security-review fixes for relay decisions and CI time limits (CI #87 hung 6 h in apt) passed [CI #90](https://github.com/Adityapawar5105/rebatehq/actions/runs/42250541945) on `c56ac52` and [CI #91](https://github.com/Adityapawar5105/rebatehq/actions/runs/42251110870) on `f9494e4`. See `docs/evidence/CHUNK_7B_VERIFICATION.md`. Blueprint section 22 items 21-22 cover the toggle removal. 7V-1 (UI redesign part 1: design scale, `components/ui`, new app shell, unlock screen and Home; no feature, schema or migration change) is **CI-verified** in [CI #95](https://github.com/Adityapawar5105/rebatehq/actions/runs/42264359487) on `108d427` and was approved by the user. 7V-2 (Margin charts and tiles, Data Hub and Settings jump bars, Pricing and Quotes layout, legacy classes restyled to the tokens, account pages aligned) is **CI-verified** in [CI #96](https://github.com/Adityapawar5105/rebatehq/actions/runs/42269867429) on `9063e73`. 7V is complete; see `docs/evidence/CHUNK_7V_VERIFICATION.md` (blueprint section 22, item 23). **7C-1 is CI-verified; 7C-2 is CI-verified in [CI #104](https://github.com/Adityapawar5105/rebatehq/actions/runs/42406059786) on `05ff468`. Do not start 7D.** Ready-to-paste prompts for 7V and every later chunk except 9A, with the shared context and known pitfalls, are in `CODEX_HANDOFF.md`. Real-export files stay
in git-ignored `test-results/real/` and are never committed.


7C-1 (pricing-operation items 1–5: margin bridge, reversal drafts, exceptions,
segment planner and localized letter, contract expiry) is CI-verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) on `aecfa32`; its customer-contract export-scope fix passed [CI #102](https://github.com/Adityapawar5105/rebatehq/actions/runs/42397030001) on `155f149` (7 November 2026;
239 unit tests, 41 authenticated vault checks and 11 authenticated relay checks). Local vault v11 has 37 tables, with no Supabase migration or locked hash
change. See docs/evidence/CHUNK_7C_VERIFICATION.md. 7C-2 evidence is recorded in docs/evidence/CHUNK_7C2_VERIFICATION.md. Do not start 7D.

7C-2 (items 6–10: competitor log, guarded Basic/full grid, worker sliders,
cost-to-serve loss findings and immutable export-receipt landed checks) is
**CI-verified** in [CI #104](https://github.com/Adityapawar5105/rebatehq/actions/runs/42406059786)
on `05ff468`, 8 November 2026 (Asia/Kolkata): 249 unit tests, 43 authenticated
vault checks and 11 real-authenticated local-Supabase relay checks. Local v12,
42 tables; no Supabase, dependency or locked-hash change. Blueprint unchanged.
See docs/evidence/CHUNK_7C2_VERIFICATION.md. Do not start 7D without a new user task. **Next chunk: 7D**, only on explicit instruction (7C-3a and 7C-3b are verified below). Prompts are in `CODEX_HANDOFF.md`.

Scope note: 7C-2 verification covers the original v2.3 items 6–10. The separate
blueprint v2.4 commit 51001c0 was preserved after the code was committed; its requirements are not covered by 7C-2 alone. 7C-3a covers currencies and Firefox; 7C-3b now covers health alerts, competitor alternatives, relay sync status and the cash-leak hero. See ASSUMPTIONS.md for the boundary.
Do not automatically expand 7C or start 7D from this documentation close-out.

**7C-3a is CI-verified** in [CI #108](https://github.com/Adityapawar5105/rebatehq/actions/runs/42444422694) on `155188f`, 8 November 2026: 256 unit tests (78 JS + 178 TS), **46 authenticated Chromium vault checks**, **44 Firefox lab checks**, and **11 real-authenticated local-Supabase relay checks**. Both required browser steps ran and passed, with nonzero check counts. The fresh 152-check pgTAP suite ran twice with unchanged tenant row counts. Local vault **v13 / 42 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill was required or run because no Supabase migration/inventory changed.
See docs/evidence/CHUNK_7C3_VERIFICATION.md for every command and remaining unverified limits. Next prompt: 7C-3b. Do not start it or 7D automatically. Blueprint unchanged.


**7C-3b is CI-verified** in [CI #111](https://github.com/Adityapawar5105/rebatehq/actions/runs/42449524974) on `fa93eab`, 8 November 2026: 260 unit tests (78 JS + 182 TS), **48 authenticated Chromium vault checks**, **46 Firefox lab checks**, and **12 real-authenticated local-Supabase relay checks**. Both required browser steps ran and passed with nonzero check counts. The fresh 152-check pgTAP suite ran twice with unchanged tenant row counts. Local vault **v13 / 42 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill was needed or run: no Supabase migration or inventory changed.
See docs/evidence/CHUNK_7C3_VERIFICATION.md part b. Cost-derived monitoring is worker-gated; no new rep command. Hosted auth/restore, headed/manual and physical recovery, native-language review and new large-vault monitoring performance remain unverified. Blueprint unchanged. **Next prompt: 7D**, only on explicit instruction.


**7D-1 is CI-verified** in [CI #114](https://github.com/Adityapawar5105/rebatehq/actions/runs/42470690491) on `585ccf8`, 8 November 2026: 269 unit tests (78 JS + 191 TS), **50 authenticated Chromium vault checks**, **48 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice with unchanged tenant row counts. Both required browser gates ran and passed with nonzero counts. Local vault **v14 / 45 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill needed or run: no Supabase schema/inventory change.
See docs/evidence/CHUNK_7D_VERIFICATION.md part 1. Customer agreement loading, exact tier accruals, progress/reminders and source-linked waterfall reconciliation are local-only. rebateProgress is the only new rep projection and is exhaustively classified/scanned; full evidence and writes are worker-gated. **7D-2 remains unstarted.** The v2.5 additions were not covered by this v2.4-scoped task; blueprint section 22 item 27 places them in chunk 7V-3, before 7D-2. Blueprint unchanged by this chunk.

7V-3a (grid standard: sort and multi-value filter on every column header, "N of M rows", selection totals computed in the worker; shared `components/ui/DataGrid.tsx` and `lib/grid`; 29 data grids; new read-only `gridTotals` command) was built by Claude Code. **7V-3a is CI-verified** in [CI #118](https://github.com/Adityapawar5105/rebatehq/actions/runs/42480527882) on `027a14d`, 8 November 2026: 278 unit tests (78 JS + 200 TS), **51 authenticated Chromium vault checks** (including `gridsUi`), **49 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault v14 / 45 tables, 11 locked migrations, zero pending; no restore drill needed (no Supabase change). See docs/evidence/CHUNK_7V3_VERIFICATION.md part a. From now on every new data grid must meet the grid standard. Blueprint unchanged by this part.

7V-3b (freeform row notes on customers and products, schema v15; Data Hub Customers and Item master worker grids with inline notes; notes kept through re-import, removal warning and merge/undo; `data`-only visibility and palette search) was built by Claude Code. **7V-3b is CI-verified** in [CI #120](https://github.com/Adityapawar5105/rebatehq/actions/runs/42487588209) on `7ef16fc`, 8 November 2026: 286 unit tests (78 JS + 208 TS), **52 authenticated Chromium vault checks** (including `notesUi` and `gridsUi`), **50 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault **v15 / 45 tables**; 11 locked migrations, zero pending; no restore drill needed (no Supabase change). See docs/evidence/CHUNK_7V3_VERIFICATION.md part b. 7V-3 is complete. **Next prompt: 7D-2** (supplier claims, Purchases import, rebate progress, claim generator; its new grids meet the grid standard and its schema bump is v16), only on explicit instruction. Blueprint unchanged.

**7D-2 is CI-verified** in [CI #123](https://github.com/Adityapawar5105/rebatehq/actions/runs/42606577225) on `2b1481d`, 9 November 2026: 296 unit tests (78 JS + 218 TS), 54 authenticated Chromium vault checks, 52 required Firefox lab checks, 12 real-authenticated local-Supabase relay checks, and the fresh 152-check pgTAP suite twice with unchanged tenant row counts. Both required browser gates ran with nonzero counts and include suppliers/suppliersUi. Local vault **v16 / 47 tables**, 24 public tenant tables; 11 locked migrations, zero pending, unchanged. No restore drill needed or run. Purchases import/Fix Later/source tracking, exact supplier tiers, frozen claim lifecycle and formula-safe local CSV/XLSX are implemented; all supplier reads require cost and writes require rebateManage. No new rep projection. See docs/evidence/CHUNK_7D_VERIFICATION.md part 2 for the one CI download fix and remaining limits. Blueprint unchanged. 7E is next (see below).

7E-1 (vendor price review of a supplier cost sheet and purchase price variance; new Vendors section for `cost` roles, Professional and Scale checked in the worker; five read-only worker-grid commands; no schema change) was built by Claude Code. **7E-1 is CI-verified** in [CI #126](https://github.com/Adityapawar5105/rebatehq/actions/runs/42616397012) on `2cee899`, 9 November 2026: 301 unit tests (78 JS + 223 TS), **55 authenticated Chromium vault checks** (including `vendorsUi`), **53 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault v16 / 47 tables (unchanged); 11 locked migrations, zero pending; no restore drill needed (no Supabase change). See docs/evidence/CHUNK_7E_VERIFICATION.md part 1. 7E-2 is next (see below). Blueprint unchanged.

7E-2 (Scale-only historical scenario simulator: whole months of sales and credit lines replayed with price and cost changes through the line waterfall, month by month in the worker with progress and cancel, into a temporary table only; third Vendors tab for `pricing` roles; Scale licence checked in the worker; three read-only commands; no schema change) was built by Claude Code. **7E-2 is CI-verified** in [CI #128](https://github.com/Adityapawar5105/rebatehq/actions/runs/42640305379) on `b24f6c8`, 9 November 2026: 306 unit tests (78 JS + 228 TS), **56 authenticated Chromium vault checks** (including `simUi`), **54 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault v16 / 47 tables (unchanged); 11 locked migrations, zero pending; no restore drill needed (no Supabase change). See docs/evidence/CHUNK_7E_VERIFICATION.md part 2. **7E is complete.** 7F-1 followed (see below). Blueprint unchanged.

7F-1 (monthly Pricing Review Pack and weekly digest PDFs in the user's language, built in the worker, with "checks only run while the app is open" and a persisted last-checked time; ROI v2 with operator-attested recovery linked to a real finding and an exported rule run, exact void; rep compliance scorecard with floor/target compliance and points only, team view by default and self view by opt-in, decision 16 classified and scanned; local vault v17 adds `roi_recoveries`, `scorecard_consent`, `report_checks`) was built by Codex and finished by Claude Code (Recovery tracker tab-switch crash, scorecard opt-in, report-check cancel label, self-contained browser checks). **7F-1 is CI-verified** in [CI #130](https://github.com/Adityapawar5105/rebatehq/actions/runs/42674285171) on `1903986`, 10 November 2026 (Asia/Kolkata): 314 unit tests (78 JS + 236 TS), **59 authenticated Chromium vault checks** (including `reports`, `reportsUi` and `roiUi`), **57 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault **v17 / 50 tables**; 11 locked migrations, zero pending; no restore drill needed (no Supabase change). See docs/evidence/CHUNK_7F_VERIFICATION.md part 1. 7F-2 followed (see below). Blueprint unchanged.

7F-2 (folder re-import of saved converter recipes from a remembered folder, permission asked each session; Phase 2 converters in Import Studio: fixed-width print reports with a column-boundary detector, ruler and manual adjustment, text-based PDF tables through pdf.js 6.4.299 bundled as an on-demand vault-worker chunk with no OCR, and Parquet through DuckDB with its signed Parquet extension vendored, pinned and served from this origin; repeated page headers and split footers skipped for every format; no schema change) was built by Claude Code. **7F-2 is CI-verified** in [CI #132](https://github.com/Adityapawar5105/rebatehq/actions/runs/42687463097) on `799c2f9`, 10 November 2026 (Asia/Kolkata): 320 unit tests (78 JS + 242 TS), **61 authenticated Chromium vault checks** (including `converters` and `convertersUi`), **59 Firefox lab checks** (including both), **12 real-authenticated local-Supabase relay checks**, the high/critical dependency audit, and the fresh 152-check pgTAP suite twice. Local vault v17 / 50 tables (unchanged); 11 locked migrations, zero pending; no restore drill needed (no Supabase change). See docs/evidence/CHUNK_7F_VERIFICATION.md part 2. **7F is complete; blueprint Phase 2 is complete except mobile (9A, on hold).** 8A followed (see below). Blueprint unchanged.

8A (blueprint Phase 3, opened by the v2.6 pre-8A fixes: a partly scanned PDF names the pages left out and a scanned one names the alternatives; a relay set-up card shown where the server enables the relay and this device has no key, decided locally by the new read-only `relayLocal`; explainable deal guidance per quote line from customer history, similar customers, the guardrail target or the book price, held at target after a recent supplier cost rise (flag only) and kept between floor and start; cross-sell by basket co-occurrence, confidence and lift; `quoteGuidance` and `quoteCrossSell` rep-safe and in the decision 16 scan; no schema change) was built by Claude Code. **8A is CI-verified** in [CI #135](https://github.com/Adityapawar5105/rebatehq/actions/runs/42786807751) on `666608f`, 10 November 2026 (Asia/Kolkata): 327 unit tests (78 JS + 249 TS), **62 authenticated Chromium vault checks** (including `guidanceUi`), **60 Firefox lab checks** (including `guidanceUi`), **12 real-authenticated local-Supabase relay checks**, the high/critical dependency audit, and the fresh 152-check pgTAP suite twice. Local vault v17 / 50 tables (unchanged); 11 locked migrations, zero pending; no restore drill needed (no Supabase change). See docs/evidence/CHUNK_8A_VERIFICATION.md. 8B followed (see below). Blueprint unchanged by this chunk.

8B (blueprint Phase 3, closing blueprint v2.6 gap 1; built by Claude Code in two parts) adds **Margin Drain agents**: six local rules (leaks over a threshold, book prices below the floor, expiring contracts, supplier cost rises, the 7C-3b customer health alerts, fired cost index triggers) checked by the vault worker on a saved schedule only while the app is open, with an inbox, run log and Home card. It also adds **cost index triggers**: user-uploaded index files, the import-cost currency buffer with typed rates, and expected cost per SKU. Part 2 is the **dead-stock clearance optimiser**: stock-on-hand import; capital tied up and carrying cost from the user's cost of capital and storage; a clearance price floored at replacement cost and kept at the guardrail floor; substitute SKUs; drafts through the normal changeset, Pricing Owner approval and export. All of it is Professional/Scale, cost to read and pricing to change, with no Sales Rep projection. The optional public index feed was not built, so there is no Supabase migration. **8B is CI-verified:** 8B-1 in [CI #137](https://github.com/Adityapawar5105/rebatehq/actions/runs/42847127386) on `509a0f8` (local vault v18 / 55 tables) and 8B-2 in [CI #138](https://github.com/Adityapawar5105/rebatehq/actions/runs/42853411139) on `e23f5f7`, 10 November 2026 (Asia/Kolkata): 340 unit tests (78 JS + 262 TS), **64 authenticated Chromium vault checks** (including `agentsUi` and `deadStockUi`), **62 Firefox lab checks** (including both), **12 real-authenticated local-Supabase relay checks**, the high/critical dependency audit, and the fresh 152-check pgTAP suite twice. Local vault **v19 / 57 tables**; 11 locked migrations, zero pending; no restore drill needed (no Supabase change). See docs/evidence/CHUNK_8B_VERIFICATION.md. 8C followed (see below). Blueprint unchanged by this chunk.

8C (blueprint Phase 3; built by Claude Code in two parts) adds a **win/loss log** on quotes. An outcome, reason code, competitor and local-only note is recorded on a sent quote; a report groups outcomes by reason, customer or rep, with margin only for cost roles. Reps see only their own quotes, and both commands are in the decision 16 scan. Local vault **v20** adds `quote_outcomes`.

It also adds an **audit and compliance pack** for every tier with the `audit` capability. It is a ZIP holding the hash-chained log re-verified at export, `verification.json`, approvals, exports, receipts and role changes (codes and IDs only), with a cover PDF in the user's language.

Two **local templates** are generated as PDFs: a vendor negotiation sheet and a rebate agreement.

**Offline mode** for the desktop app comes from a service worker in `public/sw.js`, which stores only the app shell and never `/api/` or business data. It is network-first for the page and engine files. Settings shows its state and has "Remove offline copy", and signing out deletes the copy. The browser gate cuts the network for real and scans the cache.

The Safari desktop spike stays in 8D, where blueprint v2.6 gap 5 puts it.

**8C is CI-verified:** 8C-1 in [CI #140](https://github.com/Adityapawar5105/rebatehq/actions/runs/42896532114) on `efe4291` and 8C-2 in [CI #142](https://github.com/Adityapawar5105/rebatehq/actions/runs/43028662048) on `16622a9`, 11 November 2026 (Asia/Kolkata): 349 unit tests (78 JS + 271 TS), **66 authenticated Chromium vault checks** (including `winLossUi` and `offlineUi`), **63 Firefox lab checks** (including `winLossUi`; `offlineUi` runs in Chrome and Edge only), **12 real-authenticated local-Supabase relay checks**, the high/critical dependency audit, and the fresh 152-check pgTAP suite twice. Local vault **v20 / 58 tables**; 11 locked migrations, zero pending; no restore drill needed (no Supabase change). See docs/evidence/CHUNK_8C_VERIFICATION.md.

The "data never leaves your device" claim (v2.6 gap 3) has new evidence from the offline gate, but using it remains the product owner's decision. **Next prompt: 8D** (opt-in anonymous benchmarks with a consent design first; the Safari desktop spike), only on explicit instruction. Blueprint unchanged by this chunk.

8D (blueprint Phase 3; built by Claude Code on BENCHMARKS_DESIGN.md, which the user approved on 11 November 2026, with 5-point publishing ranges) adds **opt-in anonymous benchmarks**:
- an Owner-only consent;
- whole-point bands per standard family, computed on the device, with family minimums;
- an exact payload, sent only on explicit Owner clicks;
- pseudonymous server storage in reviewed `rebatehq_private` tables;
- an operator-only k = 10 noisy release;
- give to get, and withdrawal.

It adds local vault **v21** (61 tables) and server migration `20261111120000_chunk8d_benchmarks.sql`. **8D passed CI** in [CI #146](https://github.com/Adityapawar5105/rebatehq/actions/runs/43059749723) on `63ba49c`: 357 unit tests, the 169-check pgTAP suite twice, 67 authenticated Chromium checks (`benchUi` against the real API), 64 Firefox and 12 relay checks. Because the package mirror stalled in [CI #145](https://github.com/Adityapawar5105/rebatehq/actions/runs/43045581322), browser installs now go through `scripts/ci-install-browser.sh`. The user-run [Restore Drill #20](https://github.com/Adityapawar5105/rebatehq/actions/runs/43070833569) (local target) on `e7cb5fc` passed, including the 8D benchmark-row comparison. **8D is complete**, and the migration is locked: 12 applied, 0 pending.

The Safari desktop spike ran only as a WebKit pre-check, which was inconclusive (SAFARI_SPIKE.md). Safari stays unclaimed. See docs/evidence/CHUNK_8D_VERIFICATION.md.

**Next prompt: 8R** (wave-2 legacy table retirement), only on explicit instruction. Blueprint unchanged by this chunk.

8R (wave 2 of the legacy table retirement; built by Claude Code, 13 November 2026) drops the last 12 server business tables (quote, quote_line, quote_share_link, approval, approval_rule, rebate_agreement, rebate_progress, rebate_tier, rebate_entry, supplier_credit, alert, fx_rate) in `20261113120000_chunk8r_retire_wave2.sql`, with no CASCADE. `fx_rate` goes because the vault has kept exchange rates since 7C-3a. `lib/rebates.ts` is removed and `/legacy/rebates` is a fixed not-found. The server keeps 13 control-plane tables. pgTAP plans **136** fresh and **139** restore checks, the tenant-table minimum is **13**, and the restore sentinel is a licence location. Blueprint section 22, item 29 records it. **8R passed CI** in [CI #150](https://github.com/Adityapawar5105/rebatehq/actions/runs/43453893489) on `436459c` (361 unit tests, 136-check pgTAP twice, 67 Chromium, 64 Firefox, 12 relay checks). The user-run [Restore Drill #21](https://github.com/Adityapawar5105/rebatehq/actions/runs/43467938552) (local target) on `7683d7b` passed (139 restore-mode checks, licence/relay/benchmark hashes, 13 tenant tables). **8R is complete**, and the migration is locked: 13 applied, 0 pending; the locked state passed [CI #152](https://github.com/Adityapawar5105/rebatehq/actions/runs/43469014775) on `db03d4d`. See docs/evidence/CHUNK_8R_VERIFICATION.md. **Only 9A (mobile field-rep PWA) remains, and it waits for the user's explicit prompt.**

**Staging (14 November 2026):** https://rebatehq.netlify.app on Netlify (the site was renamed from `rebatehq-aditya`; the old address returns 404) (production deploys from `main`; previews behind Netlify team login) with Supabase project `rebatehq-staging` (`cgwbedmswfvbslvuihqy`, us-east-1; 14 locked migrations then, 17 since 25 Nov 2026). The hosted pgTAP suite passed 136/136 twice, and a real sign-in, workspace, Scale pilot licence and encrypted vault worked end to end. Operator secrets live only in the git-ignored `.env.staging.local`; the app login is `rebatehq_netlify_login`. See NETLIFY_DEPLOYMENT.md. Staging is not production: a customer launch needs separate production services (OPERATIONS.md).

**Quote flow fix (20 November 2026, after the 16–17 November product review; built by Claude Code).** A below-floor quote could get stuck in `pending` (no edit, no withdraw, no approver while sharing is off), and a price typed into a quote line was dropped if Submit was pressed before "Update prices". Now:
- quote status moves live in one table (`TRANSITIONS`, `assertMove` in `lib/quotes/quotes.ts`);
- the new `quoteWithdraw` command (author only) takes a pending quote back to draft and drops any relay link;
- `QuoteView.allowedNext` drives the buttons, and Submit saves typed lines first;
- `won` needs a submitted or approved quote;
- Price Check, New quote and Add line use the type-ahead; Home lists the author's pending quote; a rep's palette pick opens Price Check filled in.

**It passed CI** in [CI #172](https://github.com/Adityapawar5105/rebatehq/actions/runs/44783777109) on `39ef75c`: 377 unit tests (78 JS + 299 TS), the 139-check pgTAP plan twice, **68 authenticated Chromium vault checks** and **65 Firefox lab checks** (both including `quoteFlowUi`), and 12 relay checks. Vault v21 / 61 tables and 14 locked migrations are unchanged; no blueprint change. See QUOTE_FLOW_VERIFICATION.md. Work after this follows the user's explicit instruction for each step.

**First-run activation (20 November 2026; built by Claude Code).** `VaultStatus.sample` (`empty`, `only`, `mixed`, `none`, counted from file names) drives:
- a Home start card on an empty vault, where "Try the Playground" fills the 90-day cash leak in one click;
- a sample-data banner on every section;
- a "Sample data" badge on the cash-leak card.

Home lists only rows the role can open, and they land on the exact heading. Both Home figures carry the "checked when you open the app" line. Import Studio shows how many required columns matched, and after an import leads to the cash leak.

**It passed CI** in [CI #175](https://github.com/Adityapawar5105/rebatehq/actions/runs/44793874491) on `c1a2744`: 379 unit tests (78 JS + 301 TS), the 139-check pgTAP plan twice, **69 authenticated Chromium vault checks** and **66 Firefox lab checks** (both including `activationUi`), and 12 relay checks. Vault v21 / 61 tables and 14 locked migrations are unchanged; no blueprint change. See ACTIVATION_VERIFICATION.md.

**Licence and vault resilience (20 November 2026; built by Claude Code).**
- A server error, rate limit or timeout on the licence route keeps the saved licence inside its offline allowance; only a refusal or a bad signature clears it.
- Read-only commands no longer write while the licence is read-only.
- An engine failure on unlock has its own message, and a dead worker shows a Reload card.
- Auto-lock counts scrolling, warns a minute ahead and never cancels a running request.
- The used invite cookie is deleted.
- The sign-in rate-limit header (audit B-9) is unchanged pending a safe check.

**It passed CI** in [CI #178](https://github.com/Adityapawar5105/rebatehq/actions/runs/44801085014) on `ec651af`: 387 unit tests (78 JS + 309 TS), the 139-check pgTAP plan twice, **70 authenticated Chromium vault checks** and **67 Firefox lab checks** (both including `licenceOutageUi`), and 12 relay checks. No schema, migration or blueprint change. See RESILIENCE_VERIFICATION.md.

**Roadmap phases 4, 5, 7, 8a and 9a (20–21 November 2026; built by Claude Code).**
- **Dates in local time (PR #9).** Decision D4 is the device time zone; price runs use the local business date.
- **Recovery and onboarding.**
  - "Forgot your passphrase?" starts again on this device.
  - "Change passphrase" removes older snapshots.
  - The device list is readable, and the Owner gets a "devices waiting" badge.
  - "Disable workspace" moved to Account › Workspace.
- **Grid and Leak Report trust.** Steady table, compact totals, selection kept on sort, live report scope.
- **Consistency fixes.**
- **Progress kinds.** The Cancel button no longer reads English text.
- **Import plan re-check.** Import refuses a plan reviewed before another change to the vault.

Phases 5 to 9a merged as PR #10. Both privacy gates allow one more request: `GET /api/licence/devices`, with no query and no body.

**They passed CI:** [CI #180](https://github.com/Adityapawar5105/rebatehq/actions/runs/44813741319) on `6c45c9b` (390 unit tests, 70 Chromium and 67 Firefox checks), and [CI #185](https://github.com/Adityapawar5105/rebatehq/actions/runs/44825994318) on `bdf14b8` (397 unit tests, 72 Chromium and 69 Firefox checks including `passphraseUi` and `gridTrustUi`, 12 relay checks, the 139-check pgTAP plan twice). No schema, migration or blueprint change. See ROADMAP_PHASES_VERIFICATION.md.

**Roadmap phases 8 and 9 (rest) and 10.1 (21 November 2026; built by Claude Code).**
- **Phase 8 (PR #13):**
  - a shared `Tabs` component;
  - Quote Desk, Pricing, Cleanup, the relay panel and Import Studio moved to the shared components;
  - relay status in the card header;
  - the set-up card under the Home tabs;
  - a scanned PDF reported beside the drop zone;
  - the rep Quote Desk answer, thermometer and credit chip;
  - shorter es/fr labels and account pages in the vault frame;
  - the Home health error, scorecard opt-in, storage tiles and sticky grid headers.
- **Phase 9 (PR #14):**
  - `VaultStatus.phase`;
  - read or write marked beside each command's capability (`ACTIONS` in `lib/roles/access.ts`);
  - `Engine.warm`;
  - `useVaultQuery`;
  - benchmark withdrawal reconciled on load.
- **10.1 (PR #15):** `SHARING_DESIGN.md`, a design only.

**They passed CI:** [CI #191](https://github.com/Adityapawar5105/rebatehq/actions/runs/44884770133) on `8baa2e8`, [CI #195](https://github.com/Adityapawar5105/rebatehq/actions/runs/44886940643) on `0fc0de8` and [CI #193](https://github.com/Adityapawar5105/rebatehq/actions/runs/44886079314) on `5c59a90`. No schema, migration or blueprint change. See PHASES_8_9_VERIFICATION.md.

The pushes to main after those merges failed for causes outside the app code, fixed in PR #16:
- Node 24.22.3 crashed at test exit;
- runner Docker networking failed;
- the gate hung after its deliberate tab crash.

PR #16 passed [CI #198](https://github.com/Adityapawar5105/rebatehq/actions/runs/44906135199), and `main` after it passed [CI #200](https://github.com/Adityapawar5105/rebatehq/actions/runs/44931126427).

**Roadmap phases 11, 13 and 14 (21 November 2026; built by Claude Code).**
- **Phase 11 (PR #17):** Quote Desk completion: copy and revise, validity date, branded customer PDF, price list and mailing list, barcode lookup. Local vault **v22 / 62 tables**; blueprint section 22, item 34. Its first run (CI #199) failed because the Account device table overflowed a phone screen; the table now scrolls in its own box.
- **Phase 13 (PR #18):**
  - removed the prototype, the legacy business pages and the spike lab (D15, D12, D13);
  - rewrote `OPERATIONS.md`;
  - added dated notes on stale statements;
  - moved the chunk evidence files to `docs/evidence/`;
  - added formatter settings (D14);
  - the rate limiter now keys on the platform's client address (audit B-9);
  - CI now runs as three parallel jobs, and `verify` passes only when all three pass.
- **13.10:** Actions on their first Node 24 majors.
- **Phase 14:** Home reuses saved leak results per window, rebates are rebuilt once per import, the user is looked up once per page, the offline copy prunes old build files, and Reconciliation writes only on change. 14.6 is a measured study with no code change.

PR #18 passed [CI #202](https://github.com/Adityapawar5105/rebatehq/actions/runs/44931718412), the first run of the parallel jobs. Local 1M-line measurements, the 14.6 study and the other CI runs are in `docs/evidence/ROADMAP_PHASES_11_13_14_VERIFICATION.md`.

Phase 12 (payments) and the mobile app (15.5) are excluded by the user's instruction.

**Roadmap Phase 15 pull-forward (22 November 2026; built by Claude Code after the user confirmed "Yes, build them"; blueprint section 22, item 35).**
- **15.1:** scheduled pickup from the remembered import folder. It runs only while the app is open, with permission granted in the session; a clean batch can be imported automatically, and everything else waits for review.
- **15.3:** claim payment tracking, and the rebate accrual export for finance.
- **15.6:** custom ERP export layouts, with a column editor.
- **15.7:** saved simulator runs, compared side by side.

Local vault **v23 / 65 tables** (`claim_payments`, `export_layouts`, `sim_runs`); no Supabase migration. See `docs/evidence/ROADMAP_PHASE_15_VERIFICATION.md`. Not built: 15.2 and 15.8 need a design first, and 15.4 needs the operator's OAuth credentials.

**Roadmap Phase 16: the second audit pass (22 November 2026; built by Claude Code).**
- **Areas read:** the areas the first audit left out (leak rules, cleanup and undo, vendor review and the simulator, the PDF and report builders, converters, relay crypto, screen states, catalogs, scripts).
- **Fixed, each with a test:**
  - an item merge lost duplicates' barcodes, and undo could not restore them;
  - removing an item file left its barcodes;
  - the simulator's actual figures left out customer rebate programmes;
  - a workbook could declare smaller sizes in its central directory than in its local headers;
  - the cost-index SKU grid had no error handling.
- **Corrected:** the documentation that called the suspended tenant purge active. The purge itself was not switched back on.

See `docs/evidence/SECOND_AUDIT_PASS.md`. The independent security review (R02, D16) is still owed before card payments.

**Sidebar and shell redesign (23 Nov 2026; built by Claude Code from the user's choices on a published proposal; blueprint section 22, item 36).**
- **N1:** each section's sub-pages are links under it in the sidebar (`components/local/SideNav.tsx`), read from the palette's registry `components/local/subtabs.ts`; the views no longer draw tab rows. Hashes and the `ops-tab-*`, `vendor-tab-*`, `supplier-tab-*` test ids are kept; Quotes gained `quotes-tab-*`.
- **D1, D2, A1:** Data Hub is four pages and Settings three; the account pages sit under Settings in one sidebar, from the server role (`lib/account-nav.ts`).
- **V1–V4, V6–V9:** breadcrumb header, line count and licence line in the top bar, sentence-case labels, Net pocket names its lines, 34/30 px rows, one notice group, weights 400/500/600, short transitions.
- Not built (the user's "maybe"): N2, N3, R1, V5. No schema, migration or worker change.
- **It passed CI** in [CI #219](https://github.com/Adityapawar5105/rebatehq/actions/runs/45226298972) on `588abb6` (PR #24): unit tests, audit and build, the authenticated Chromium privacy and relay gates, the Firefox lab gate and `verify`. The first run, CI #218, failed because the gate still looked for the removed "Account" navigation on the account pages. It merged on 23 Nov 2026 (merge `7dbd22c`) after the owner's review. See docs/evidence/SIDEBAR_REDESIGN_VERIFICATION.md.


**Team sharing S1: the encrypted hand-off file (24 Nov 2026; built by Claude Code; blueprint section 22, item 38).**
- Owners and Pricing Owners export a pack selection for a colleague in a chosen role. The packs are items, customers, book prices, contract prices, guardrails, cost and floors based on cost.
- The file is encrypted with a one-time code of six groups. Cost packs are locked for roles without `cost` (D18).
- Anyone on Professional or Scale imports it into the governed tables, tagged `shared:<pack>`. Same-key rows are replaced and local notes are kept.
- Guardrails gain `floor_from_cost`: such a floor travels only in the cost pack.
- Local vault **v24 / 67 tables**; no Supabase migration. See docs/evidence/SHARING_S1_VERIFICATION.md.
- S1 merged as PR #26 after CI on `7462849`.

**Team sharing S2a: pack keys, the signed grid and the sharing migration (24 Nov 2026; built by Claude Code).**
- Epoch format 2 carries the Owner-signed grid (one role table plus pack ticks) and one wrapped key per data pack. Verifiers refuse cost for a role without cost, wraps that do not match the grid, non-publisher signers, grid edits by non-Owners, roles that do not match membership, and downgrades.
- Pack versions are a signed chain per pack. Only a person whose device holds the pack can select its rows.
- Migration `20261125120000_sharing_s2_packs.sql` is **pending** until CI and a **user-run Restore Drill** pass. pgTAP plans 149 checks fresh and 152 in restore mode.
- Not reachable from the app until S2b. See docs/evidence/SHARING_S2A_VERIFICATION.md.

**Team sharing S2b: the worker signs and reads the grid (25 Nov 2026; built by Claude Code).**
- Starting or rotating sharing signs a format 2 epoch built from Team and roles (unassigned people are Sales Reps; Recommended ticks).
- Each device stores only its pack keys.
- A receiving vault mirrors the signed role table, so a rep who created their own vault loses cost once they join.
- Owners with one device see a recovery-kit prompt.
- The relay gate proves that the rep device holds no cost pack key.
- No migration. See docs/evidence/SHARING_S2B_VERIFICATION.md.

**Team sharing S3a: the signed grid as the source, and the Sharing grid screen (25 Nov 2026; built by Claude Code).**
- Rotations sign the last signed grid plus this device's Owner draft (new people join as Sales Reps), so a second Owner device no longer demotes everyone.
- With no draft pending, every vault, an Owner's included, mirrors the signed role table.
- Settings › Team and roles › Who receives what: pack-by-role ticks with cost locks, presets, per-person extras, Preview as, and what changes.
- No migration. See docs/evidence/SHARING_S3A_VERIFICATION.md.

**The team sharing S2 migration is locked (25 Nov 2026).** It passed CI #229 and the user-run Restore Drills #23 and #24 (152 restore-mode checks). 15 migrations are applied and 0 are pending.

**Team sharing S3b: packs published and received through Supabase Storage (25 Nov 2026; built by Claude Code).**
- A publisher's device publishes every pack it holds after each rotation, or on **Publish now**: gzipped chunks, sealed per chunk with AES-GCM, in the private `relay-packs` bucket, listed in the signed, encrypted manifest of the pack version.
- Receiving seats apply newer packs on sync and join. A pack that fails its checks is skipped, and the rest apply.
- The worker calls Storage directly with the person's own session token (`/api/relay?mode=token`).
- The Storage rule `rebatehq_storage.relay_storage_allowed` lets a holder of the pack read and the signer write. A rep device can never fetch a cost chunk.
- Migration `20261126120000_sharing_s3_storage.sql` is **locked** (25 Nov 2026) after CI #241 and #242 and the user-run Restore Drill #25 (155 restore-mode checks); 16 migrations are applied and 0 are pending. The drill re-applies the bucket and policies with `scripts/restore-storage-objects.sql`. pgTAP plans 152 fresh and 155 restore checks.
- Relay gate: 15 checks. See docs/evidence/SHARING_S3_VERIFICATION.md.

**Settings › Team and roles › People (25 Nov 2026; built by Claude Code from a reference design the user supplied).**
- One list of people joins the vault roles, the workspace members and invitations, and what each person receives under the sharing grid.
  - Members and invitations are passed as props from `app/home/page.tsx` (`lib/team.ts`), so the vault page makes no new request.
- Edit/Assign role opens a dialog; a toast with Undo confirms changes. Role pairs the S2 grid verifier refuses are caught at edit time (`roleConflict`).
- With sharing on, a grid Owner's edits are labelled drafts and others cannot edit.
- Workspace access, invitations and suspension stay on `/account/users`, restyled to match; its role select now uses the role id.
- No schema, migration or privacy-gate change. See docs/evidence/TEAM_PEOPLE_VERIFICATION.md.

**Team sharing S3c: read-only receiving seats (25 Nov 2026; built by Claude Code).**
- On a device that receives relay packs and is not a publisher, the worker refuses writes to shared tables (`sharedGuard` in dispatch; every write command is classified in `lib/sharing/governed.ts`, enforced by a test).
- Pricing, Data Hub and Rebates & Contracts show "Shared by {name}" with versions, received date and a What changed link.
- Staleness for relay copies is measured from the last sync. Roll back is the audited price roll back plus Publish now.
- No schema or migration change. Relay gate: 16 checks. See docs/evidence/SHARING_S3C_VERIFICATION.md.

**Team sharing S4a: live updates (25 Nov 2026; built by Claude Code).**
- A joined device syncs on the worker's 60-second tick while the app is open and unlocked: this is the path that guarantees delivery, quiet, in the worker's one queue.
- The Realtime doorbell makes it sync at once: one private channel per held pack, version number only, the person's own token.
- A chunk still uploading counts as not ready for 15 minutes.
- Migration `20261127120000_sharing_s4_doorbell.sql` is **locked** (25 Nov 2026) after CI #257 and #258, a rolled-back hosted dry run and the user-run Restore Drill #27 (158 restore-mode checks). 17 migrations are applied and 0 are pending.
- Relay gate: 17 checks (liveUpdate). See docs/evidence/SHARING_S4A_VERIFICATION.md.

**Staging up to date (25 Nov 2026).** `rebatehq-staging` now has all 17 migrations (team sharing S2, S3 and S4 applied with `supabase db push`); `RELAY_ENABLED` stays false there. See NETLIFY_DEPLOYMENT.md.

**Team sharing S4b: small deltas (25 Nov 2026; built by Claude Code).**
- After the first publish only packs that changed are sent: whole rows changed plus keys removed, with the digest of the full pack after it. A cost-only change reaches no device without cost.
- Each publish records its epoch; a version from an earlier epoch is never a delta base. Row identities are the pack key plus an ordinal, because pack keys can repeat.
- A snapshot goes after a rotation, with no earlier publish, after 7 days or 50 deltas, above 25% changed, or when another publisher went in between. Publish now with nothing changed sends a fresh full copy (recovery).
- The receiver rebuilds the pack from its relay copy, checks the digest and applies it like a snapshot; a missing or mismatched base starts again from the newest snapshot (`packReset`).
- Local vault **v25 / 69 tables** (`shared_pack_rows`, `shared_published`); no Supabase migration. Compaction is not built.
- **It passed** [CI #261](https://github.com/Adityapawar5105/rebatehq/actions/runs/45683555982) on `61f2390` and merged as PR #39. See docs/evidence/SHARING_S4B_VERIFICATION.md.

**Team sharing S5a: threads, tasks, inbox and activity in the worker (26 Nov 2026; built by Claude Code).**
- Thread and task events ride the 7A relay with no server change. The body is sealed under the pack key of its object (`TARGET_PACK` in `lib/sharing/threads.ts`), so a rep device cannot read a cost thread.
- Fold rules: the sender, mentions and assignees must hold the pack. Worker reads (`threadList`, `inboxState`, `activityFeed`) are local; writes are `relayThread*` and `inboxSeen`, all classified for decision 16 and not governed.
- No migration and no vault schema change. Email notices and "who's viewing" are not built.
- **It passed** [CI #263](https://github.com/Adityapawar5105/rebatehq/actions/runs/45687045923) on `3f0cbe2` and merged as PR #40. See docs/evidence/SHARING_S5A_VERIFICATION.md.

**Team sharing S5b: threads and tasks on screen (26 Nov 2026; built by Claude Code).**
- **Discuss** (`components/local/Threads.tsx`) is on Data Hub customers and items, quotes, leak findings and supplier claims; mentions and assignees are limited to people who receive the pack.
- The shared inbox has a **Threads and tasks** tab: for you, open tasks and activity, as shared grids, with an unread badge. Relay gate: 18 checks (`threadsUi`).
- **Relay head fix (PR #41):** `relayHead` and `packHead` sorted a text alias, so "9" came after "10" and syncs failed past nine events. Fixed, with `tests/relay-head-order.test.ts`. It passed [CI #264](https://github.com/Adityapawar5105/rebatehq/actions/runs/45689910186) on `1ecafdf` and merged.
- No migration and no schema change.
- **It passed** [CI #267](https://github.com/Adityapawar5105/rebatehq/actions/runs/45693771972) on `d53d3e2` and merged as PR #42. See docs/evidence/SHARING_S5B_VERIFICATION.md.

**Cloudflare Workers trial (26 Nov 2026; a desk study by Claude Code).** `CLOUDFLARE_TRIAL.md`.
- Nothing was installed or deployed: there is no package manager here, and an account and deployment need the owner.
- Blockers: OpenNext does not run the Node.js `proxy.ts`; the `pg` pool on `globalThis` needs per-request clients or Hyperdrive; the CA file cannot be read at run time; the `/spike/*` headers would need to move.
- Recommendation: stay on Netlify for now. If a move is wanted, try vinext on a throwaway branch first, then OpenNext with `middleware.ts`; Vercel runs `proxy.ts` natively.

**Next.js 16.4.3 to 16.4.6 (26 Nov 2026; built by Claude Code on the owner's yes).**
- Seven moderate advisories, all fixed in 16.4.6. They cover `'use cache'` leaks and poisoning, an SVG bypass in image optimisation, HttpOnly cookies on Edge routes, and responses injected across clients.
- It is a same-major patch with identical dependencies. With no pnpm on the authoring machine, `package.json` and `pnpm-lock.yaml` were edited by hand with the registry's integrity hashes, and CI's `pnpm install --frozen-lockfile` checks them.
- `experimental.agentUpgrade` was not set.
- **It passed** [CI #271](https://github.com/Adityapawar5105/rebatehq/actions/runs/45740078152) on `911a0e0` and merged as PR #44.

**Near-miss rebate tiers (26 Nov 2026; built by Claude Code; blueprint section 22, item 39).**
- `lib/rebate/nearmiss.ts` adds three columns to customer and supplier rebate progress:
  - the extra rebate if the next tier is reached;
  - the days left in the period;
  - an outlook (on pace, within reach, far, top tier reached, not started, closed, not tiered) and the amount still needed per day.
- A line above each grid gives the count and value of the near rows, with "Show them".
- The monthly and weekly report PDFs list the ten nearest programmes.
- Spend and tiers only: `rebateProgress` stays in the decision 16 payload scan, and supplier progress still needs `cost`.
- No new command, schema change or migration.
- **It passed** [CI #273](https://github.com/Adityapawar5105/rebatehq/actions/runs/45746538213) on `dbac074` and merged as PR #45. See docs/evidence/NEAR_MISS_VERIFICATION.md.

**Review R1 (26 Nov 2026; built by Claude Code).**
- **Fixed:**
  - the `/dashboard` dead links, with a test;
  - the read-only seat gaps in folder pickup and Fix Later recheck;
  - removing a sharing participant's seat now answers 409;
  - vault creation: licensed capacity by default, and a repeat-passphrase field;
  - screen copy;
  - the vault gate's required sections;
  - Node pinned for Netlify and the Restore Drill;
  - the tenant-table floor raised to 15;
  - a docs pass.
- **It passed** [CI #277](https://github.com/Adityapawar5105/rebatehq/actions/runs/45830750129) on `ae41d86` and merged as PR #47.

**Review R2: team sharing made safe to turn on (26 Nov 2026; built by Claude Code).**
- **Relay log checkpoint:** the 10,000-event ceiling is gone (`RELAY_TAIL`, `FoldBase`).
- **Joining:** a device can join after a Pricing Owner rotation.
- **Rotation:** a new device must be confirmed by its own code.
- **Saves and caps:** quiet syncs stop saving every minute; shared items count against capacity.
- **Rate limits:** on relay and licence.
- **Privacy gates:** they scan WebSocket frames.
- **Screens and records:** plain-language sharing screens, and register entries R18 to R27.
- Migration `20261128120000_review_r2_deleted_workspaces.sql` is **locked** (26 Nov 2026) after CI #279 on `56f4fac`, CI #280 on `main` at `aed1b13`, and the user-run Restore Drill #28 (159 restore-mode checks, twice). 18 migrations are applied and 0 are pending. pgTAP plans 156 fresh and 159 restore checks.
- **It passed** [CI #279](https://github.com/Adityapawar5105/rebatehq/actions/runs/45844379547) and merged as PR #48.
- See docs/evidence/REVIEW_R2_VERIFICATION.md.

**Review R2, the rest (27 Nov 2026; built by Claude Code).**
- **Event quota:** a device whose person does not publish under the signed grid may send 20 relay events a minute and 2,000 a day (publishers keep 60 a minute). A refused send answers 429 `LIMIT`, not a rotation request.
- **R25:** keys of revoked devices no longer count toward the 1,000 device-key limit; the sharing panel warns from 50 of the 60 devices.
- **R24:** Supabase session cookies are HttpOnly, Secure in production and live 30 days (`lib/supabase/cookies.ts`).
- **R26 (mitigated):** chunk uploads are retried, a failed publish is retried by the background tick (not yet covered by a test), and the not-ready window uses the server's receive time.
- **R27:** a CI pass with `RELAY_ENABLED` off (`--relay-off-only`).
- **R23:** accepted and documented; no change.
- Migration `20261129120000_review_r2_relay_quotas.sql` is **pending** until CI and a user-run Restore Drill (163 restore-mode checks). pgTAP plans 160 fresh and 163 restore checks. Not applied to staging.
- The independent security review (B5) is still the owner's to commission. See docs/evidence/REVIEW_R2_VERIFICATION.md.
