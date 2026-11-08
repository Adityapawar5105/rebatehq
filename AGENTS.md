# RebateHQ project direction

## Governing blueprint

Read `BLUEPRINT.md` before planning or implementing RebateHQ work. The user-approved **Blueprint v2.4** governs. Section 22 records its approved changes. v2.3 UX/quoting/pricing and v2.4 multi-currency/Firefox work have been implemented only as the verified chunks below state; other roadmap items remain future work. Later explicit user instructions take precedence. Any blueprint edit must add a section 22 entry and be reported to the user.

`BLUEPRINT_EXECUTION_PLAN.md` sequences the work into repo chunks (4.0, 4A-4E,
5A-5B, 6A, 6R, 6B, 7A, 7U, 7B, 7V, 7C (7C-1, 7C-2, 7C-3), 7D-7F, 8A-8D, 8R, 9A) with a standard preamble and "Done when" criteria.
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
verification evidence or assume planned features already exist. Current code
still has server-side business-data paths, so do not describe it as having
achieved the blueprint's local-only privacy boundary before that is implemented
and tested.

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
4E (guardrails, versioned rules, preview, owner approval, ERP export, encrypted backup/restore; vault v6) is done and CI-verified in [CI #55](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704), commit `7fe3db8` (163 unit tests, 25 named authenticated privacy checks). Local timings and real ERP/picker limits are in `CHUNK_4E_VERIFICATION.md`. 5A (item master cleanup with undo, cost basis comparison, 7-day setup checklist, ROI v1 on Home, seven local roles with worker-enforced cost hiding, named Pricing Owner at setup; vault v7) is CI-verified: **5A CI-verified** in [RebateHQ CI #59](https://github.com/Adityapawar5105/rebatehq/actions/runs/41854329390) on `632b24f`, [CI #60](https://github.com/Adityapawar5105/rebatehq/actions/runs/41855953059) on `7ec683e` (real-export evidence), and [CI #61](https://github.com/Adityapawar5105/rebatehq/actions/runs/41858525178) on `2fbb283` (merge-all and batch undo), 4 November 2026. Local-only measurements and unverified limits are in `CHUNK_5A_VERIFICATION.md`. 5B (signed licences and tier caps, device revocation, legacy server business-data routes default-off, signed actor context, failed-login limits, private issuer key) is CI-verified in [RebateHQ CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee` with [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905) (local target), 4 November 2026; its migration `20261104160022_chunk5b_control_plane.sql` is locked. See `CHUNK_5B_VERIFICATION.md`. `RETIREMENT_PROPOSAL.md` was approved with revisions on 5 November 2026 (blueprint section 22, item 15): wave 1 (21 tables) is chunk 6R after 6A, and wave 2 (12 tables) is chunk 8R after 8B. Drop tables only inside those chunks. 6A (pilot hardening with real files, 5 Nov 2026) is **CI-verified** in [CI #68](https://github.com/Adityapawar5105/rebatehq/actions/runs/41905416129) on `50263a5`; its follow-up (order-header joins, item-list cost, streamed XLSX sheets, localized headers, near-quota check; blueprint section 22, item 17) passed [CI #69](https://github.com/Adityapawar5105/rebatehq/actions/runs/41960988113) on `549b7fa`, and the 8 GB rerun's 1M memory fix passed [CI #70](https://github.com/Adityapawar5105/rebatehq/actions/runs/41965284570) on `ce9ada6`. 6A is complete; benchmark timings are local only. Details are in `PILOT_FILES.md` and `CHUNK_6A_VERIFICATION.md`; the local vault schema is v8 and no Supabase migration was added. Pilot files stay in git-ignored `test-results/real/`. 6R (wave 1: 22 server tables dropped; 20 remain) is **CI-verified** in [CI #73](https://github.com/Adityapawar5105/rebatehq/actions/runs/41977200715) and [Restore Drill #18](https://github.com/Adityapawar5105/rebatehq/actions/runs/41979671868) on `8a34e06`; its migration `20261105120000_chunk6r_retire_wave1.sql` is locked in `migrations.lock`. See `CHUNK_6R_VERIFICATION.md`. 6B (security review and whitepaper: STRIDE review, SECURITY_WHITEPAPER.md, SECURITY_REVIEW.md risk register, EXTERNAL_SECURITY_REVIEW.md, engine asset integrity pins, allow-listed auth logging, high/critical dependency audit gate in CI) is **CI-verified** in [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464) on `ade310e` and [CI #77](https://github.com/Adityapawar5105/rebatehq/actions/runs/41992372460) on `0aae4aa`; no migration or blueprint change. See `CHUNK_6B_VERIFICATION.md`. This completes the plan's sellable-v1 milestone. 7A (ciphertext-only collaboration relay: device keys, wrapped workspace keys, signed events, one- or two-level approvals, comments and @mentions; four relay tables; local vault v9; behind `RELAY_ENABLED`, default off) is **CI-verified** in [CI #82](https://github.com/Adityapawar5105/rebatehq/actions/runs/42034048481) on `a65c395` and [Restore Drill #19](https://github.com/Adityapawar5105/rebatehq/actions/runs/42043079490) on `7652013`; its migration `20261105130000_chunk7a_ciphertext_relay.sql` is locked (11 applied). See `CHUNK_7A_VERIFICATION.md` and `RELAY_DESIGN.md`. 7U (UX foundations: message-key i18n with en/es/fr/fr-CA catalogs in `lib/i18n`, theme tokens in `app/theme.css`, command palette, finance glossary, accessibility pass; no migration, no vault schema change) is **CI-verified** in [CI #86](https://github.com/Adityapawar5105/rebatehq/actions/runs/42061581577) on `b2d273a` (authenticated privacy gate with the i18n checks, and the real-Supabase relay gate). See `CHUNK_7U_VERIFICATION.md`. From 7U on, every user-facing string is a message key in every shipped language (`tests/i18n.test.ts`) and colours come only from theme tokens (`tests/theme.test.ts`). 7B (Quote Desk, Price Check, AR aging credit signal, rep cost toggle removed, decision 16 payload test, `quote`/`quoteApprove` capabilities; local vault v10; no migration) is **CI-verified** in [CI #89](https://github.com/Adityapawar5105/rebatehq/actions/runs/42101094326) on `f344009` (authenticated privacy gate with `quotesUi`, relay gate 11 checks); follow-ups with security-review fixes for relay decisions and CI time limits (CI #87 hung 6 h in apt) passed [CI #90](https://github.com/Adityapawar5105/rebatehq/actions/runs/42250541945) on `c56ac52` and [CI #91](https://github.com/Adityapawar5105/rebatehq/actions/runs/42251110870) on `f9494e4`. See `CHUNK_7B_VERIFICATION.md`. Blueprint section 22 items 21-22 cover the toggle removal. 7V-1 (UI redesign part 1: design scale, `components/ui`, new app shell, unlock screen and Home; no feature, schema or migration change) is **CI-verified** in [CI #95](https://github.com/Adityapawar5105/rebatehq/actions/runs/42264359487) on `108d427` and was approved by the user. 7V-2 (Margin charts and tiles, Data Hub and Settings jump bars, Pricing and Quotes layout, legacy classes restyled to the tokens, account pages aligned) is **CI-verified** in [CI #96](https://github.com/Adityapawar5105/rebatehq/actions/runs/42269867429) on `9063e73`. 7V is complete; see `CHUNK_7V_VERIFICATION.md` (blueprint section 22, item 23). **7C-1 is CI-verified; 7C-2 is CI-verified in [CI #104](https://github.com/Adityapawar5105/rebatehq/actions/runs/42406059786) on `05ff468`. Do not start 7D.** Ready-to-paste prompts for 7V and every later chunk except 9A, with the shared context and known pitfalls, are in `CODEX_HANDOFF.md`. Real-export files stay
in git-ignored `test-results/real/` and are never committed.


7C-1 (pricing-operation items 1–5: margin bridge, reversal drafts, exceptions,
segment planner and localized letter, contract expiry) is CI-verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) on `aecfa32`; its customer-contract export-scope fix passed [CI #102](https://github.com/Adityapawar5105/rebatehq/actions/runs/42397030001) on `155f149` (7 November 2026;
239 unit tests, 41 authenticated vault checks and 11 authenticated relay checks). Local vault v11 has 37 tables, with no Supabase migration or locked hash
change. See CHUNK_7C_VERIFICATION.md. 7C-2 evidence is recorded in CHUNK_7C2_VERIFICATION.md. Do not start 7D.

7C-2 (items 6–10: competitor log, guarded Basic/full grid, worker sliders,
cost-to-serve loss findings and immutable export-receipt landed checks) is
**CI-verified** in [CI #104](https://github.com/Adityapawar5105/rebatehq/actions/runs/42406059786)
on `05ff468`, 8 November 2026 (Asia/Kolkata): 249 unit tests, 43 authenticated
vault checks and 11 real-authenticated local-Supabase relay checks. Local v12,
42 tables; no Supabase, dependency or locked-hash change. Blueprint unchanged.
See CHUNK_7C2_VERIFICATION.md. Do not start 7D without a new user task. **Next chunk: 7D**, only on explicit instruction (7C-3a and 7C-3b are verified below). Prompts are in `CODEX_HANDOFF.md`.

Scope note: 7C-2 verification covers the original v2.3 items 6–10. The separate
blueprint v2.4 commit 51001c0 was preserved after the code was committed; its requirements are not covered by 7C-2 alone. 7C-3a covers currencies and Firefox; 7C-3b now covers health alerts, competitor alternatives, relay sync status and the cash-leak hero. See ASSUMPTIONS.md for the boundary.
Do not automatically expand 7C or start 7D from this documentation close-out.

**7C-3a is CI-verified** in [CI #108](https://github.com/Adityapawar5105/rebatehq/actions/runs/42444422694) on `155188f`, 8 November 2026: 256 unit tests (78 JS + 178 TS), **46 authenticated Chromium vault checks**, **44 Firefox lab checks**, and **11 real-authenticated local-Supabase relay checks**. Both required browser steps ran and passed, with nonzero check counts. The fresh 152-check pgTAP suite ran twice with unchanged tenant row counts. Local vault **v13 / 42 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill was required or run because no Supabase migration/inventory changed.
See CHUNK_7C3_VERIFICATION.md for every command and remaining unverified limits. Next prompt: 7C-3b. Do not start it or 7D automatically. Blueprint unchanged.


**7C-3b is CI-verified** in [CI #111](https://github.com/Adityapawar5105/rebatehq/actions/runs/42449524974) on `fa93eab`, 8 November 2026: 260 unit tests (78 JS + 182 TS), **48 authenticated Chromium vault checks**, **46 Firefox lab checks**, and **12 real-authenticated local-Supabase relay checks**. Both required browser steps ran and passed with nonzero check counts. The fresh 152-check pgTAP suite ran twice with unchanged tenant row counts. Local vault **v13 / 42 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill was needed or run: no Supabase migration or inventory changed.
See CHUNK_7C3_VERIFICATION.md part b. Cost-derived monitoring is worker-gated; no new rep command. Hosted auth/restore, headed/manual and physical recovery, native-language review and new large-vault monitoring performance remain unverified. Blueprint unchanged. **Next prompt: 7D**, only on explicit instruction.
