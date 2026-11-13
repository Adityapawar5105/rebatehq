# RebateHQ — Blueprint v2.5 execution plan

*Status review and prompt pack, written 2 Nov 2026; updated for blueprint v2.2 the same day. Governs nothing on its own: `BLUEPRINT.md` v2.5 is the source of truth; this file sequences the work.*

**Progress:** Phase 3 features done: 8A in [CI #135](https://github.com/Adityapawar5105/rebatehq/actions/runs/42786807751), 8B in [CI #137](https://github.com/Adityapawar5105/rebatehq/actions/runs/42847127386) and [CI #138](https://github.com/Adityapawar5105/rebatehq/actions/runs/42853411139), 8C in [CI #140](https://github.com/Adityapawar5105/rebatehq/actions/runs/42896532114) and [CI #142](https://github.com/Adityapawar5105/rebatehq/actions/runs/43028662048), and 8D (opt-in anonymous benchmarks; WebKit pre-check only, so Safari is unclaimed) in [CI #146](https://github.com/Adityapawar5105/rebatehq/actions/runs/43059749723) with [Restore Drill #20](https://github.com/Adityapawar5105/rebatehq/actions/runs/43070833569), migration locked, 11 November 2026. Local v21 / 61 tables; 25 public tenant tables; 12 locked migrations. **8R** (wave-2 retirement) built 13 November 2026; its migration is pending CI and the user-run Restore Drill.

**Historical milestones:** chunk 4.0 is committed (`7387f11`); 4A remains CI-verified in [CI #42](https://github.com/Adityapawar5105/rebatehq/actions/runs/41613748478), commit `395154d`; **4B done and CI-verified** in [MarginDesk CI #44](https://github.com/Adityapawar5105/rebatehq/actions/runs/41660146540), 3 November 2026, commit `c382f7d`, including the authenticated local-vault privacy gate (14 named checks). **4C-1 done and CI-verified** in [MarginDesk CI #48](https://github.com/Adityapawar5105/rebatehq/actions/runs/41690570143), commit `ea4e5b6` (built in Claude Code), see `CHUNK_4C1_VERIFICATION.md`. **4C-2 done and CI-verified** in [CI #51](https://github.com/Adityapawar5105/rebatehq/actions/runs/41783684531), commit `a9ca8f7` (built in Claude Code; tested on the real UCI Online Retail export), see `CHUNK_4C2_VERIFICATION.md` and `REAL_FILE_RESULTS.md`. **4D done and CI-verified** in [CI #53](https://github.com/Adityapawar5105/rebatehq/actions/runs/41797151106), commit `6d21cf0` (built in Claude Code; all five Playground leaks reproduced exactly; the Playground L2 leak was revised, see blueprint section 22 entry 12), see `CHUNK_4D_VERIFICATION.md`. **4E done and CI-verified** in [CI #55](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704), commit `7fe3db8` (guardrails, versioned rules, preview/owner approval, ERP exports, encrypted backup/restore; 163 unit tests and the 25-check authenticated privacy gate). See `CHUNK_4E_VERIFICATION.md` and `PHASE_4_VERIFICATION.md`. **5A CI-verified** in [RebateHQ CI #59](https://github.com/Adityapawar5105/rebatehq/actions/runs/41854329390) on `632b24f`, [CI #60](https://github.com/Adityapawar5105/rebatehq/actions/runs/41855953059) on `7ec683e` (real-export evidence), and [CI #61](https://github.com/Adityapawar5105/rebatehq/actions/runs/41858525178) on `2fbb283` (merge-all and batch undo), 4 November 2026. **5B CI-verified** in [RebateHQ CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee` (CI #63/#64 also passed) and [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905), local target, 4 November 2026; migration `20261104160022_chunk5b_control_plane.sql` locked. See `CHUNK_5B_VERIFICATION.md`. Retirement plan approved 5 Nov 2026 (wave 1 = chunk 6R after 6A, wave 2 = chunk 8R). **6A CI-verified** in [CI #68](https://github.com/Adityapawar5105/rebatehq/actions/runs/41905416129) on `50263a5`; the 6A follow-up passed [CI #69](https://github.com/Adityapawar5105/rebatehq/actions/runs/41960988113) and [CI #70](https://github.com/Adityapawar5105/rebatehq/actions/runs/41965284570); **6A complete** (see `PILOT_FILES.md`, `CHUNK_6A_VERIFICATION.md`). **6R CI-verified** in [CI #73](https://github.com/Adityapawar5105/rebatehq/actions/runs/41977200715) and [Restore Drill #18](https://github.com/Adityapawar5105/rebatehq/actions/runs/41979671868) on `8a34e06` (22 tables dropped, 20 remain; migration locked); see `CHUNK_6R_VERIFICATION.md`. **6B CI-verified** in [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464) on `ade310e` and [CI #77](https://github.com/Adityapawar5105/rebatehq/actions/runs/41992372460) on `0aae4aa`, 5 November 2026 (security review, whitepaper, integrity/logging fixes; see CHUNK_6B_VERIFICATION.md). The next prompt at that milestone was 7A. Performance and remaining unverified items are recorded in `VAULT_RESULTS.md`.

**7C-1 done and CI-verified** in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) on `aecfa32`: 239 unit tests, 41 authenticated vault checks and 11 authenticated relay checks. **7C-2 done and CI-verified** in [CI #104](https://github.com/Adityapawar5105/rebatehq/actions/runs/42406059786) on `05ff468` (items 6–10; see CHUNK_7C2_VERIFICATION.md). Local vault v12 (42 tables); no Supabase migration. 7C-2 closed without starting later chunks; see the current Progress line above. See `CHUNK_7C_VERIFICATION.md`.


---

## 1. Where we are (evidence-based)

**Git:** `main` = `origin/main` = `c943956` "Lock chunk 3C; Phase 3 verified (CI #39, Restore Drill #13)", pushed 30 Oct 2026 01:11 IST.
**Uncommitted (at the time of the review):** `BLUEPRINT.md`, `AGENTS.md` (created 2 Nov by the Codex session that adopted the blueprint), and this file. Chunk 4.0 adds `ARCHITECTURE_TRANSITION.md` and the v2.2 edits.

### What the repo actually contains (repo Phases 0–3, server-side)

| Area | Built | Blueprint fit |
|---|---|---|
| `margin-engine.js` single source of margin math + golden tests | Yes | Logic reusable; **uses JS floats** (blueprint rule 5 wants integer/decimal) |
| Next.js + Supabase Auth magic links, tenants, roles, invites | Yes | **Keep** — this is the control plane |
| Postgres RLS, append-only audit, 162 fresh / 165 restore-mode pgTAP checks, restore drill | Yes | Keep for control-plane tables only; overkill for business data that must leave the server |
| 38 tenant tables holding products, costs, prices, quotes, rebates, imports | Yes | **Conflicts with §4** — customer pricing data must not live in Supabase |
| Cost history, UoM, FX (2A); pricing precedence, rebate tiers (2B) | Yes (SQL + TS) | Logic reusable in the browser; storage location wrong |
| Supplier-file parser (CSV/TSV/XLSX), mapping wizard, templates (3A) | Yes, server-side, 10k-row cap | Port to a Web Worker; blueprint wants 200k–2M lines, XLS/XLSM/XLSB/ODS/JSON/XML, multi-file |
| Dry run / commit / undo / conflict / Excel round trip (3B) | Yes | Concepts reusable (change preview, versioning) |
| Readiness score, Sheets schedules, email/SFTP stubs (3C) | Yes | Readiness → health score; Sheets/SFTP/email ingestion are **not in the blueprint** |
| Quotes with approvals, rebates page | Yes (Phase 1/2B) | Blueprint puts these in **Phase 2** |
| DuckDB-Wasm, Web Worker, OPFS, encryption, folder backup | **No** | Blueprint Phase 1 core, week 1 |
| Import Studio, ERP mapper profiles, Fix Later, Playground | **No** | Blueprint Phase 1 core, week 2 |
| Waterfall on invoice lines, whale curve, leak finder, Leak Report, ROI v1 | **No** (prototype waterfall only) | Week 3 |
| Guardrails, rule engine, change preview, ERP-ready export, backup | **No** | Week 4 |
| COOP/COEP headers | COOP yes, **COEP missing** | Needed for multi-threaded DuckDB |

**Bottom line:** the backend foundation is solid and well-tested, but **0 of the blueprint's Phase 1 core deliverables exist in the required local-first form.** Measured against the blueprint, the product is at "Foundations done, Phase 1 core not started." Next step is the §19 prototype spike.

---

## 2. Where we went wrong / diverted

1. **The build started before the architecture was decided.** Phases 1–3 put all customer pricing data in multi-tenant Postgres. Blueprint v2.1 (adopted 2 Nov) moves that data into the browser. Most of the RLS/restore-drill effort for business tables is now sunk cost; only the auth/licence part carries forward.
2. **Verification overhead outran product.** About 24 of 64 prompts in the chat were CI / pgTAP / restore-drill fix loops (function ACLs, role grants, restore equivalence). That rigor is right for a control plane, but it consumed most of the week while no user-facing margin feature shipped.
3. **No customer validation, still.** The chat shows the same blocker repeatedly from the start: "No prospect has been contacted." Blueprint §2 and §13 still list "no real ERP file, no customer conversations." The mapper, parser and cleanup work depends on real files.
4. **Idea drift before the build.** The idea moved from Muse/HVAC intake to a supplier price-list normalizer, then a Vendavo clone ("add all the following things"), then RebateHQ. Each pivot widened the scope instead of narrowing it.
5. **Phase order differs from the blueprint.** Quoting/approvals and rebates were built first; the blueprint makes them Phase 2. Waterfall, leaks, guardrails, rules and export are the blueprint's Phase 1, and none of them is built on real invoice lines yet.
6. **Scale mismatch.** The server import is capped at 10,000 rows (11.6 s commit on CI Postgres). The blueprint targets 1M rows parsed in under 10 s in the browser, and 2M-line waterfalls in under 300 ms.
7. **Money as floats** in `margin-engine.js` (DB uses `numeric`, the JS engine uses `Number`).
8. **Target drift.** The original build prompt said 50–100 employees / $10M–$100M; the blueprint says 50–300.
9. **Blueprint text is slightly ahead of reality.** §2 and §17 say "Phase 4 pocket-margin engine in progress"; it has not started. Under local-first, that engine must run in the browser, not on the server.
10. **Hygiene.** Blueprint/AGENTS are uncommitted, `tsconfig.tsbuildinfo` is tracked, and the old static prototype (`app.js`, `index.html`, `seed.js`, `schema.sql`) is still at the root.

---

## 3. New phase numbering (keeps old evidence untouched)

| Repo phase | = Blueprint | Chunks |
|---|---|---|
| 0–3 | Foundations | **Done, verified** (CI #39, Restore Drill #13) |
| **4** | Phase 1 core | 4.0 housekeeping · 4A spike · 4B shell + vault · 4C-1 Import Studio converter · 4C-2 mapper/parser/Fix Later/Playground · 4D margin intelligence (pocket-margin engine, reconciliation, show-me-the-math) · 4E pricing, export, backup |
| **5** | Phase 1b + control plane | 5A cleanup, cost basis, checklist, ROI v1, roles · 5B licences/tiers, retire server business-data paths, carried security items |
| **6** | Pilot hardening + security | 6A real files, 8 GB laptop benchmarks · 6R legacy table retirement, wave 1 · 6B security review + whitepaper → **sellable v1** |
| **7** | Phase 2 | 7A relay · **7U UX foundations (v2.3)** · 7B Quote Desk · **7V UI redesign (7V-1, 7V-2)** · 7C (7C-1, 7C-2) · **7C-3 v2.4 catch-up** · 7D-1 rebates · **7V-3 v2.5 grid standard + row notes** · 7D-2 supplier claims · 7E vendor review + simulator · 7F packs/digest/converters |
| **8** | Phase 3 | guidance, agents, indices, dead stock, cross-sell, offline, templates · 8R legacy table retirement, wave 2 |
| **9** | Final | 9A mobile field-rep PWA, built last |

6R and 8R were added on 5 Nov 2026, when the user approved the revised `RETIREMENT_PROPOSAL.md` (blueprint section 22, item 15). 6R adds roughly 2–4 working days before 6B; the sellable-v1 window is unchanged but has less slack.

---

## 4. Time estimate

The figures below assume one founder working full time with an AI coding agent, at the velocity seen in Phases 0–3: about 1 chunk per 1–2 days, plus CI fix loops.

| Milestone | Blueprint says | Realistic | Calendar (from Mon 2 Nov 2026) |
|---|---|---|---|
| Spike + Phase 1 core (repo 4) | 3–4 wk | 5–6 wk | mid-Dec 2026 |
| 1b + control plane (repo 5) | 1–2 wk | 2–3 wk | early Jan 2027 |
| Pilot hardening + security (repo 6) | 3–5 wk | 3–4 wk | **Sellable v1: 11 Jan – 1 Feb 2027** |
| Phase 2 (repo 7) | +6–8 wk | +8–10 wk | Mar – mid-Apr 2027 |
| Phase 3 (repo 8) | +5–6 wk | +5–7 wk | **Full blueprint: mid-Apr – end May 2027** |

That is ~10–13 weeks to the first paid pilot and ~23–30 weeks to the full blueprint. The biggest schedule risk is not code. It is getting **real ERP exports and pilot feedback** in time for 6A. If no real file exists by mid-December, sellable v1 slips by however long that takes.

---

## 5. Rules to stay on track

1. **Paste the standard preamble (below) at the top of every coding prompt.**
2. One chunk per prompt, with "Done when" criteria. After CI is green, run the close-out prompt (§8). Never let a prompt start the next chunk.
3. **Privacy gate first.** From 4B on, a browser test fails the build if any business value from a fixture appears in a network request. No privacy claim is made until that gate passes in CI.
4. **Scale the verification to the risk.** pgTAP and the restore drill run only when control-plane migrations change. Data-plane chunks use unit tests, browser e2e tests, the privacy gate and recorded timings.
5. **Time-box CI loops.** If one chunk needs more than 3 CI-fix prompts, stop and simplify instead of hardening further.
6. **No scope additions** outside the current blueprint phase. Park ideas in a `PARKING_LOT.md`.
7. **Run the customer track in parallel** (§9). Get one real file before closing 4C-2.

### Standard preamble (paste first in every prompt)

```
Read AGENTS.md, BLUEPRINT.md, BLUEPRINT_EXECUTION_PLAN.md and ARCHITECTURE_TRANSITION.md before doing anything. BLUEPRINT.md v2.3 governs. If this chunk shows the blueprint is wrong, you may correct it, but add an entry to BLUEPRINT.md section 22 and list the change in your final summary.
Hard rules:
- Customer prices, costs, invoices, rules, simulations and margins stay in the browser (DuckDB-Wasm in a Web Worker, OPFS). Never send them to any server, API route, log or analytics. Supabase is only for identity, licences/seats, public index data, app updates and a ciphertext-only relay.
- Keep every locked migration and migrations.lock unchanged; add new migrations only. Follow MIGRATION_RULES.md.
- Keep the margin-engine golden cases passing (e.g. SO-8102 negative margin).
- Money is integer minor units or fixed decimals, never JS floats in stored or reconciled values.
- Never evaluate workbook formulas or run macros.
- From chunk 7U on: no hard-coded user-facing strings (use message keys and `Intl` formatting), colours only through theme tokens, and anything shown to a rep must not reveal cost or margin % (blueprint decisions 14 and 16).
- Heavy work runs in a Web Worker; the UI thread only draws. Stream imports in chunks.
- Record assumptions in ASSUMPTIONS.md. Local checks are not CI evidence; performance numbers are "measured on <machine/browser>" or "target".
- Do only this chunk. Do not start the next one.
Finish with: files changed, every command run with its result, and what remains unverified.
```

---

## 6. Prompts: repo Phase 4 (Blueprint Phase 1 core)

### Prompt 4.0 — Housekeeping and transition map (no product code) — DONE 2 Nov 2026, kept for record

*Done: blueprint v2.2 (changes in its §22), `ARCHITECTURE_TRANSITION.md`, README roadmap, `tsconfig.tsbuildinfo` untracked. Legacy prototype files were left at the root because tests and the service-role scan import them; they move in 4C-2/4D.*

```
[PREAMBLE]

CONTEXT
Repo Phases 0–3 (server-side Next.js + Supabase) are verified at c943956 (CI #39, Restore Drill #13). On 2 Nov 2026 Blueprint v2.1 was adopted. BLUEPRINT.md, AGENTS.md and BLUEPRINT_EXECUTION_PLAN.md are in the working tree but uncommitted. Current code stores business data server-side, which conflicts with blueprint §4.

TASKS
1. Commit BLUEPRINT.md, AGENTS.md and BLUEPRINT_EXECUTION_PLAN.md unchanged.
2. Create ARCHITECTURE_TRANSITION.md. Inventory every app/api route, page, lib module, script and the 38 tenant tables. Classify each as:
   (a) control plane — keep (auth, tenants/workspaces, users, invites, audit of auth events, licences);
   (b) data-plane logic to port to the browser worker (pure logic such as margin-engine.js, upload-parser.ts, upload-archive.ts, import diff/conflict logic, pricing precedence, rebate tier math, readiness formula, csv formula-neutralising). List node-only dependencies to replace (node:crypto, node:path, pg, HttpError);
   (c) server business-data path to retire after its local equivalent exists;
   (d) legacy static prototype (app.js, index.html, seed.js, schema.sql) to move into legacy/.
   This answers blueprint open question 3.
3. Add a "Roadmap" section to README.md with the repo phase numbering from BLUEPRINT_EXECUTION_PLAN.md §3. Do not edit any existing verification text. Do not edit BLUEPRINT.md. Record in ARCHITECTURE_TRANSITION.md that blueprint §2/§17 say "Phase 4 in progress" while it has not started.
4. Move the legacy prototype files into legacy/ (git mv) only if nothing in tests, scripts or build imports them; otherwise list the importers and leave them.
5. Stop tracking tsconfig.tsbuildinfo and add it to .gitignore.

DONE WHEN
pnpm test, pnpm typecheck and pnpm build pass; no migration or migrations.lock change; no runtime behaviour change; ARCHITECTURE_TRANSITION.md lists every file in app/api and lib.
```

### Prompt 4A — Local-first prototype spike (blueprint §19)

**Done — CI-verified in [MarginDesk CI #42](https://github.com/Adityapawar5105/rebatehq/actions/runs/41613748478), 3 November 2026, commit `395154d`.** Scope and remaining unverified checks are recorded in `SPIKE_RESULTS.md`; the original prompt below is retained as history.

```
[PREAMBLE]

CONTEXT
Chunk 4.0 is committed (blueprint v2.2, ARCHITECTURE_TRANSITION.md). We now prove the local data plane before building features. Answer blueprint open question 7 (encryption approach). This is a spike: throwaway UI is fine, but measurements must be honest.

TASKS
1. Add @duckdb/duckdb-wasm at an exact pinned version. Self-host its wasm and worker bundles from the app (no CDN). Run it in a dedicated Web Worker with OPFS persistence. Provide a single-thread fallback when crossOriginIsolated is false.
2. Add Cross-Origin-Embedder-Policy (require-corp, or credentialless if needed) next to the existing COOP header. Verify that Supabase magic-link sign-in, Next.js assets and fonts still load. Document any resource that breaks.
3. Build a client-only route /lab/spike (no API calls) with:
   - deterministic synthetic generator in the worker: 200k SKUs, 2M invoice lines over 24 months, written in chunks;
   - streaming CSV import with progress and cancel. Compare PapaParse-in-worker → DuckDB appender against DuckDB read_csv on an OPFS file, and keep the faster one;
   - margin waterfall query on the full set (list → discounts → freight → off-invoice rebates → pocket → cost → margin) with a product/customer drill-down;
   - 4.5% price-rule simulation on a temporary copy across all lines;
   - reload after closing the browser: data still there;
   - 12 monthly CSVs plus one XLSX imported at once and combined with a source_file column;
   - XLSX, TSV and a messy semicolon/comma-decimal file converted to clean UTF-8 CSV in the browser;
   - navigator.storage.persist() and navigator.storage.estimate() shown on screen.
4. Encryption feasibility, which must be answered: test whether DuckDB-Wasm can open an encrypted database file on OPFS. If not, prototype an encrypted snapshot (Parquet or DB export → AES-GCM via WebCrypto, key from PBKDF2-SHA256 with ≥600k iterations or Argon2id) and measure save/open time for the 2M-line set.
5. Write SPIKE_RESULTS.md: a table of every §5 target vs measured value, with CPU, RAM, OS, browser and version. Add peak memory, the chosen import method and the chosen encryption approach. Add a manual checklist I will run on an 8 GB laptop in Chrome AND Edge, with rows marked "pending manual run". End with a pass/fail recommendation and proposed tier caps if any target fails.

DONE WHEN
/lab/spike runs locally in Chrome. SPIKE_RESULTS.md has measured numbers for every row this machine can run. No server code, API route or migration changed except the header config. pnpm-lock.yaml is updated for every new dependency, so the existing CI install step still works. pnpm test, pnpm typecheck and pnpm build pass. Commit the chunk; do not start 4B.
```

*After 4A: you run the 8 GB laptop checklist in Chrome and Edge and paste the numbers back with "Record these manual results in SPIKE_RESULTS.md; change nothing else."*

### Prompt 4B — App shell, encrypted local vault, worker ingest (Week 1)

```
[PREAMBLE]

CONTEXT
Spike 4A passed (see SPIKE_RESULTS.md: chosen import method <X>, encryption approach <Y>). Build the real foundation the spike proved.

TASKS
1. Vault service in a dedicated worker: create/open/lock/unlock with a passphrase that never leaves the device, using the encryption approach chosen in SPIKE_RESULTS.md. Auto-lock after inactivity. A wrong passphrase must fail cleanly.
2. Versioned local schema migrations: vault_meta.schema_version, forward-only migrations, and a test that opens a committed v1 fixture vault with the latest code.
3. Local tables needed for Phase 1, per blueprint §10: products, customers, price_matrix, price_guardrails, sales_lines, vendor_costs, cost_basis_settings, rules, rule_runs, price_versions, roi_ledger, audit_log, import_issues, source_files, import_batches, converter_recipes. Money is DECIMAL(18,4) or BIGINT minor units. The worker↔UI boundary passes strings/bigint, never floats.
4. Hash-chained audit_log (SHA-256 of previous hash + canonical entry), with a verify function and a test that detects tampering.
5. A typed message protocol between UI and worker. The UI thread never runs queries.
6. App shell using the blueprint §9 screen map. Show only Phase 1 sections (Home, Data Hub, Margin, Pricing, Reports, Settings) and hide the rest. The existing Supabase magic-link sign-in stays as identity. Move the existing server-backed pages under a clearly labelled "legacy" area; do not delete them yet.
7. Drag-and-drop a CSV → streaming worker ingest into sales_lines, with progress, cancel and a pre-import size estimate with a warning (memory guardrail).
8. Persistent-storage request with visible status; Chrome/Edge check with a friendly message for other browsers.
9. PRIVACY GATE: a Playwright test that signs in (local Supabase), imports a fixture with unique marker values, browses the app, and fails if any marker appears in any request URL, header or body, or in console output. Add it to CI as a required step.

DONE WHEN
A 100k-row CSV loads with no main-thread long task over 200 ms during import (measured with PerformanceObserver and recorded). The vault survives reload. A wrong passphrase fails. The audit chain verifies and tamper is detected. The privacy gate passes locally. pnpm test, pnpm typecheck and pnpm build pass. Locked migrations are unchanged.
```

### Prompt 4C-1 — Import Studio: multi-file and converter (Week 2a)

```
[PREAMBLE]

CONTEXT
4B is verified (local vault, worker ingest, privacy gate in CI). Build blueprint §6A Import Studio, Phase 1 formats only.

TASKS
1. Multi-file drag and drop, plus whole-folder pick in Chrome/Edge.
2. Role tagging: auto-detect from headers with a confidence score, plus manual override. Roles: Sales history, Item master, Customer list, Vendor cost sheet, Rebate agreement, Price list.
3. Converter in a worker. Output is always clean UTF-8 CSV.
   - CSV/TSV/TXT: detect the delimiter (comma, semicolon, tab, pipe), the encoding (UTF-8, UTF-8 BOM, UTF-16LE/BE, Windows-1252) and the decimal style.
   - XLSX/XLS/XLSM/XLSB/ODS via SheetJS, installed from SheetJS's official distribution at an exact pinned version (record why). Provide a sheet picker and header-row detection. Handle merged cells, multi-row headers, subtotal/"Total" rows, blank rows and footers. Never evaluate formulas or run macros. XLSM macros are ignored with a visible notice. Cells holding formulas are flagged in the preview.
   - JSON and XML flattened to rows.
   Port the reusable logic and safety limits from lib/upload-parser.ts and lib/upload-archive.ts (zip-bomb, XML entity, external-link and path protections) to browser-safe code (WebCrypto instead of node:crypto). Scale the limits to the tier caps in blueprint §5.
4. Preview with fixes: sheet, header row, delimiter, date format and decimal symbol, all adjustable before load.
5. Combine files of the same role: column alignment, duplicate-row detection and overlap-date warnings.
6. Source tracking: every loaded row keeps source_file_id and source_row. A file can be removed or re-imported and its rows go with it.
7. Batch report: per file, rows loaded, rows rejected and issues found.
8. Converter recipes saved in the vault per ERP/supplier and applied in one click to matching files.
9. Download converted CSVs individually or as one zip, with formula-injection-safe output.
10. Enforce tier row/SKU caps at import with a clear upgrade message (limits from blueprint §14; tier comes from a local setting for now).

DONE WHEN
Automated tests cover a fixture for every Phase 1 format, the "12 monthly CSVs + 1 XLSX combined with source tracking" case, and the "XLSX + TSV + messy semicolon file → clean CSV" case. The privacy gate still passes. Removing a source file removes exactly its rows.
```

### Prompt 4C-2 — ERP mapper, resilient parser, Fix Later, health score, Playground (Week 2b)

```
[PREAMBLE]

CONTEXT
4C-1 is verified. Real file status: <say whether you have an anonymised real ERP export; if yes, it is in tests/fixtures/real/ and must never be committed if it contains identifiable data>.

TASKS
1. ERP mapper profiles: NetSuite, Epicor Prophet 21, Infor (SX.e/CSD), Dynamics 365 Business Central and QuickBooks Enterprise. Each profile lists the expected column names with their source (public docs or assumption) and is marked "unverified until tested on a real export". Add fuzzy header matching with a confidence score; the user confirms the mapping.
2. Resilient parser: strip currency symbols and thousands separators; treat parentheses as negatives; turn TBD/CALL/N/A/blank into null plus an issue; trim/normalise SKUs; dedupe SKUs with a rule the user can see.
3. Fix Later queue (import_issues): every bad row goes there with its original value, source file and row, and the reason. Allow inline correction, bulk correction and re-validation. Never discard or silently rewrite a value.
4. Data health score: % SKUs with valid cost, duplicate SKUs, outliers. Show the formula and the improvement steps (reuse the 3C readiness formula idea).
5. Playground: a deterministic generator for the fictional "Industrial Valve & Pipe Distributor" (5,000 SKUs, 50 customer tiers, 3 branches, 24 months of invoices) with PLANTED LEAKS and a committed manifest listing each planted leak and its expected dollar value. One click after sign-in loads it (target: under 10 s).
6. Converter recipes from 4C-1 can be saved together with a mapper profile.

DONE WHEN
Messy fixtures imitating at least 3 ERPs load with every problem routed to Fix Later and none silently dropped. Corrections re-validate. The health score matches expected values for the fixtures. The playground loads and its manifest exists. If a real file was provided, its mapping result is recorded in ASSUMPTIONS.md without its contents.
```

### Prompt 4D — Pocket-margin engine and Margin Intelligence (Week 3)

```
[PREAMBLE]

CONTEXT
4C is verified. This chunk is the blueprint's "pocket-margin engine with reconciliation and show-me-the-math", built in the browser.

TASKS
1. Margin engine v2 (decimal): port margin-engine.js to a decimal implementation used by the worker and mirrored as DuckDB SQL. All existing golden cases must give identical results to the cent. Add cases proving that JS and SQL agree on the same rows.
2. Reconciliation: for each invoice, customer and month, the waterfall components must sum to the imported invoice totals to the cent. Differences become Fix Later issues, never silent adjustments.
3. Show-me-the-math: any number on screen opens a panel with its formula, inputs and the source rows (file + row) behind it.
4. Pre-aggregate on import into customer × product × month tables. Sort on load by customer and date.
5. Margin waterfall from list price to pocket margin, with drill-down by product, customer and branch.
6. Customer profitability (whale curve), gated by the tier setting (Professional+).
7. Leak finder: below floor, discount outliers vs peers in the same tier, unrecovered freight, negative-margin lines, price below cost, customers paying below a lower tier. Each leak shows a dollar amount and its evidence rows.
8. Margin Leak Report PDF generated fully client-side, with no upload.
9. ROI tracker v1: roi_ledger keeps a running total of leak dollars found.
10. Record timings for the waterfall/drill-down on the 2M-line synthetic set against the §5 target.

DONE WHEN
Every planted leak in the Playground manifest is detected with the expected dollar value (±$0.01). Reconciliation tests pass. Golden cases pass. A Leak Report PDF is produced from the Playground, and from the real file if one exists (otherwise mark "pending real file"). The privacy gate passes.
```

### Prompt 4E — Guardrails, rules, change preview, ERP export, backup (Week 4)

```
[PREAMBLE]

CONTEXT
4D is verified. Close the Phase 1 core loop.

TASKS
1. Price guardrails: start/target/floor per customer tier and category, with green/yellow/red status shown as colour + icon + text (no colour-only signal).
2. Rule engine with plain-language templates, e.g. "If <cost source> for <category> rises more than 5%, raise <category> prices by 4.5%". Rules are stored, versioned and explained in words.
3. Simulation runs as SQL on a temporary copy; nothing changes until approval.
4. Change preview: before/after diff per SKU/tier with margin impact and guardrail status. Reuse the dry-run/conflict ideas from Chunk 3B.
5. Approval in Phase 1 is single-level by the named Pricing Owner (add a Pricing Owner setting now if 5A has not run).
6. price_versions snapshot on approval, recorded in the audit chain.
7. Export Studio: ERP-ready price import file per mapper profile (CSV/XLSX), plus a change log. Output is formula-injection safe. Every export is audited.
8. Backup: File System Access API folder auto-backup (Chrome/Edge) of the encrypted snapshot after each approved change and on a schedule. Encrypted export file as a fallback. Restore wizard. Export reminders when no backup exists in N days.

DONE WHEN
An automated end-to-end test passes: Playground → leak found → rule → simulate → preview → approve → ERP file exported → backup written → browser storage wiped → restore from backup → identical numbers and an intact audit chain. The privacy gate passes. Write PHASE_4_VERIFICATION.md (local evidence only).
```

---

## 7. Prompts: repo Phases 5–6 (to sellable v1)

### Prompt 5A — Phase 1b features

```
[PREAMBLE]

CONTEXT
Repo Phase 4 is verified in CI. Build blueprint Phase 1b.

TASKS
1. Item master cleanup assistant: duplicate SKUs, unit-of-measure normalising (port the Chunk 2A UoM conversion rules), missing categories, and one-click fixes that each have undo and an audit entry.
2. Cost basis selector: last, average or replacement cost per product group. Margins are shown under each basis side by side.
3. Guided 7-day setup checklist: import, map, fix, first report, first rule, first export, invite the team. Progress is stored locally.
4. ROI tracker v1: complete it and show it on Home.
5. Roles: a named Pricing Owner is required at setup. Role-based views for Owner/CFO, Pricing Owner, Pricing Manager, Sales Manager, Sales Rep, Accountant and Admin. Reps never see cost unless the owner allows it, and this is enforced in the worker's queries, not only hidden in the UI. (The owner switch was removed in 7B, decision 16: reps never see cost or margin.)

DONE WHEN
Tests cover each cleanup fix and its undo, cost-basis margins against hand-calculated fixtures, rep cost hiding at the query layer, and the checklist flow. The privacy gate passes.
```

### Prompt 5B — Control plane slim-down, licences and carried security items

```
[PREAMBLE]

CONTEXT
5A is verified. Make the server match blueprint §4 and enforce tiers.

TASKS
1. In NEW migration(s) only: licences, seats, workspace tier (Starter/Professional/Scale with the exact limits in blueprint §14) and device licence revocation. Licences are issued manually by an admin for pilots; there is no payment integration yet. The licence becomes authoritative; plan_feature stays non-authoritative.
2. Enforce user and location caps through the licence, and SKU/row caps through local import checks, with upgrade prompts.
3. Using ARCHITECTURE_TRANSITION.md, disable every server business-data route in class (c) behind a server flag that defaults off, then remove the UI paths to them. Do NOT drop or edit tables or locked migrations. Write a short proposal for retiring the tables in a future migration and wait for my approval.
4. Fix the carried Phase 1 security items: audit actor trust (replace the caller-settable GUC with a reviewed SECURITY DEFINER append boundary or a server-signed actor assertion), bounded inputs for record_failed_login, and a DB-side failed-login rate limit.
5. Keep the pgTAP/RLS suite and restore drill for the remaining control-plane tables. Update counts honestly.
6. Update SECURITY_CHECK.md with the privacy-boundary statement, worded strictly as "verified by the privacy gate in CI run <link>".

DONE WHEN
CI is green, including pgTAP, the restore drill and the privacy gate. No business-data table is written by any reachable route. Licence limits are tested at each tier boundary.
```

### Prompt 6A — Pilot hardening with real files

```
[PREAMBLE]

CONTEXT
Phase 5 is verified. I have <N> anonymised real ERP exports in <local path, not committed>.

TASKS
1. Run every real file through Import Studio. For each one, record: ERP, format, rows, mapping confidence, issues by type, time, and anything that failed. Store this in PILOT_FILES.md without any data values.
2. Fix mapper profiles, parser rules and recipes for each failure. Add a synthetic fixture that reproduces each failure shape, never the real data.
3. Edge cases: 2M-line cap behaviour, date-range import, browser storage near quota, interrupted import, two tabs open, restore of an older vault version.
4. I will run the 8 GB laptop checklist in Chrome and Edge again and paste the numbers. Update SPIKE_RESULTS.md and propose final tier caps if any target is missed.

DONE WHEN
Every real file imports to a Leak Report without manual code edits. Each failure has a regression fixture. The capacity table is updated with measured numbers.
```

### Prompt 6R — Legacy table retirement, wave 1

```
[PREAMBLE]

CONTEXT
6A is done. The user approved RETIREMENT_PROPOSAL.md (5 Nov 2026). Do wave 1 only.

TASKS
1. Precondition: confirm no hosted Supabase project holds business rows. If one does, stop and report; do not drop anything.
2. In ONE NEW migration (never edit a locked one), drop the 21 wave-1 tables listed in RETIREMENT_PROPOSAL.md with their policies, triggers and functions, after reviewing FK dependencies. Drop plan_feature too only if nothing reads it.
3. Remove the database-bound code that only served those tables: legacy class C/X routes and pages, prototype-import, ingestion and connector-secret modules, and their tests. Keep pure logic and its golden cases (margin engine, rebate-engine.js, rebate tier maths, rep-safe quote projection).
4. Rework the pgTAP suite, fixture graph, restore seed/sentinel, restore inventory minimum and the CI import benchmark for the smaller schema. Update counts honestly; never weaken a remaining check. Wave-2 tables stay fully tested.
5. Update ARCHITECTURE_TRANSITION.md, SECURITY_CHECK.md and the README with what the server still stores.

DONE WHEN
CI is green (pgTAP, privacy gate), the user-run Restore Drill passes, the new migration is locked, and no wave-1 table or its code path remains.
```

### Prompt 6B — Security review and whitepaper

```
[PREAMBLE]

CONTEXT
6A and 6R are done. Prepare to charge money.

TASKS
1. Threat model (STRIDE) for the data plane, vault, backups, control plane and the future relay.
2. Review CSP, COOP/COEP, SRI for self-hosted wasm, dependency audit, key-derivation parameters, auto-lock, backup encryption, licence revocation, and the logging/analytics exclusions.
3. Fix high/critical findings. List the rest with an owner and a date.
4. Write SECURITY_WHITEPAPER.md: one page, plain language, with claims limited to what CI evidence proves. Each claim links to its test or run.
5. List what an external reviewer should check (blueprint open question 4).

DONE WHEN
No open high/critical findings. Every whitepaper claim has evidence. CI is green.
```

---

## 8. Close-out prompt (use after every chunk's CI is green)

```
[PREAMBLE]

Chunk <ID> is proven in GitHub Actions: RebateHQ CI #<n> green on commit <sha> (<run URL>)<, and Restore Drill #<m> green if control-plane migrations changed>. Do NOT start the next chunk.
1. If a new migration was added, promote it from pending to locked in migrations.lock (record its hash, no content change). Do not touch any other locked migration.
2. In README.md, ASSUMPTIONS.md, SECURITY_CHECK.md and the chunk's verification record, mark Chunk <ID> as verified, citing the run and commit. Keep "unverified" for everything the run did not exercise (list them).
3. Run pnpm test, typecheck, build and the migrations-lock check. Finish with a short summary of the files changed.
```

### CI failure prompt (time-boxed)

```
[PREAMBLE]

CI step "<step name>" fails on commit <sha> with: <paste the error and ~30 lines of log>. Fix only this failure. Do not weaken or remove any check. If this is the 3rd fix attempt for this chunk, stop and propose a simpler design instead of another patch.
```

---

## 9. Prompts: repo Phase 7 (Blueprint Phase 2), outline

Run each with the preamble and the same "Done when / close-out" pattern. The order matters because Quote Desk approvals depend on the relay.

- **7A Collaboration relay:** end-to-end encrypted workspace key sharing, a ciphertext-only server store (new migration), sharing and approvals (max two levels, preset thresholds), comments and @mentions. Test: the server DB contains no plaintext business values.
- **7U UX foundations (added in v2.3, after 7A, before 7B):** theme tokens with light, dark and high-contrast themes; message-key i18n extracted from all existing screens, English/Spanish/French shipped, `Intl` formatting, pseudo-locale CI test, finance glossary; command palette (navigation, SKU and customer search, commands; no free text); glossary popovers; accessibility pass. Done when no hard-coded UI strings remain (checked by a test), every theme passes contrast checks, the privacy gate still passes, and a language switch changes every screen and generated text. Estimated ~1 week; a plan estimate, not a measurement.
- **7B Quote Desk:** margin thermometer, start/target/floor guidance, "request exception" soft warnings, approvals via 7A, mobile-friendly. Port reusable logic from the legacy server quote code. Adds **Price Check** (SKU plus customer lookup with a green/amber/red floor signal) and the **customer credit signal** (new AR aging import role). Reps never see cost or margin %. First step: remove the 5A "Let Sales Reps see cost and margin" toggle (a stored "on" value is ignored; trusted individuals get the Sales Manager role instead), then add the decision 16 test that no Sales Rep payload contains cost or margin % (blueprint section 22, item 21).
- **7V UI redesign (added 6 Nov 2026 at the user's request, blueprint section 22, item 23; after 7B, before 7C):** the product works, but its screens look unfinished: plain stacked cards, one generic font, no icons or charts, long scrolling pages and a weak hierarchy. This chunk is UI only, with no new features, no worker or engine changes, no vault schema change and no migration.
  - **7V-1:** design-system tokens (type scale, spacing, radius, elevation, motion) in `app/theme.css`; shared components in `components/ui` (button, field, card, stat tile, data table, badge, tabs, dialog, toast, empty state, skeleton, in-house SVG icons and charts); a new app shell (sidebar with icons, page header, section tabs); and the unlock/create screen and Home rebuilt on it. The user reviews screenshots before 7V-2 starts.
  - **7V-2:** every other screen (Data Hub, Margin, Pricing, Quotes, Reports, Settings, account pages) moves to the same components, with in-house SVG charts for the waterfall and whale curve, each with an accessible table alternative.
  - **Done when:** all tests and gates still pass, screenshots of every screen in light and dark at 1366x768 and 375x812 are attached to the verification record, there is no horizontal overflow and no clipped text in the pseudo-locale, and the user has approved the look.
  - Codex prompts for 7V and every later chunk (except 9A) are in `CODEX_HANDOFF.md`.
- **7C Pricing ops:** "Why did margin change?" price/volume/mix/cost bridge, price list versioning with rollback, price exceptions report, price increase planner with the increase-letter template, contract expiry tracker, competitor price log. Adds the **inline-edit price grid** (Excel paste; edits go to a draft changeset, never live prices), **what-if sliders**, **cost-to-serve leaks** (small and free-delivery orders) and the **price-change landed check**.
- **7C-3 v2.4 catch-up (added 8 Nov 2026, blueprint section 22, item 25; after 7C-2, before 7D):** the v2.4 Phase 2 items that had no chunk. **7C-3a:** multi-currency (workspace display currency in Settings, a user-entered FX rate per import batch, exact conversion, no browser FX fetch; existing vaults stay USD and unchanged) and official Firefox support (the browser gate passes in Firefox, with a bounded CI step). **7C-3b:** customer health alerts on Home (SQL threshold rules on `agg_cm`, default 5 pp over a rolling 90 days, plus order-frequency drop with deepening discounts; "runs while the app is open" and a last-checked time), competitor log alternatives (top 3 highest-pocket-margin same-category SKUs for that customer), the relay sync-status indicator (last synced; synced / pending / conflict) and the "90-day cash leak" hero number on Home. Cost-derived numbers stay hidden from Sales Reps (decision 16).
- **7V-3 v2.5 grid standard and row notes (added 8 Nov 2026, blueprint section 22, items 26-27; after 7D-1, before 7D-2):** sort and a multi-value filter on every column header and a selection aggregate status bar (SUM, AVG, COUNT, MIN, MAX of the selected rows, computed in the worker), both built once into the shared `components/ui` table and applied to every existing grid; then freeform row notes (`notes VARCHAR(1000)`) on customers and products with a vault schema bump, never relayed and never visible to Sales Reps, searchable in the command palette. Unlike 7V-1 and 7V-2 this part changes the worker and the schema. From 7V-3 on, the grid standard is a "Done when" criterion for every new grid.
- **7D Rebates:** customer rebate engine (accruals, tier progress, reminders; port the Chunk 2B tier math and rebate-engine.js) and a supplier rebate / ship-and-debit claim tracker. Adds **rebate progress** for customers and suppliers (new Purchases import role). v2.4 adds the **supplier claim generator** (claim-ready CSV/XLSX export from the supplier tracker); rebate amounts use the workspace currency from 7C-3a.
- **7E Vendor and simulator:** vendor price review (new supplier sheet vs current costs, affected quotes; reuse the 3B diff/conflict ideas), purchase price variance, and the historical scenario simulator (Scale tier only).
- **7F Reporting and reach:** Monthly Pricing Review Pack, weekly digest PDF, ROI v2 (found vs recovered from rule_runs), rep compliance scorecard, folder re-import, and Phase 2 converters (fixed-width, Parquet, text-PDF tables with preview). The mobile PWA is no longer here: it moved to 9A (blueprint section 22, item 20). v2.4: the weekly digest includes the customer health alerts from 7C-3b.

## 10. Prompts: repo Phase 8 (Blueprint Phase 3), outline

- **8A:** explainable deal guidance and cross-sell basket analysis.
- **8B:** Margin Drain agents (local background checks), cost index triggers (uploads first), dead-stock optimiser (idle 90+ days, floored at replacement cost). v2.4: the dead-stock optimiser takes user-entered carrying costs (cost of capital %, storage cost per unit per month), shows capital tied up per SKU in cash and suggests substitute SKUs; Margin Drain agents build on the 7C-3b health alerts.
- **8C:** win/loss log, offline PWA mode, audit and compliance pack, and templates (vendor negotiation sheets, rebate agreements; increase letters moved to 7C). v2.4: a Safari desktop verification spike (OPFS persistence, DuckDB-Wasm threading); Safari is not advertised until it passes.
- **8D (only with explicit consent design):** opt-in anonymous benchmarks.
- **8R Legacy table retirement, wave 2:** after 7A, 7B, 7D and 8B, drop the 12 wave-2 tables in `RETIREMENT_PROPOSAL.md` (quotes, approvals, rebates, supplier credits, alerts, FX) the same way as 6R: precondition check, one new migration, CI and a user-run Restore Drill.

## 10A. Final chunk (after Phase 3)

- **9A Mobile field-rep PWA (moved here on 5 Nov 2026, blueprint section 22, item 20):** start with an iOS Safari / Android Chrome verification spike (storage eviction, memory, install behaviour) whose results decide scope. Then build the online-first thin client: encrypted, cost-free, expiring floor-price snapshot bound to a revocable device (5B), Price Check from 7B, quote capture through the relay (7A). Professional gets the thin client; Scale adds the offline cache (builds on 8C). Reps never see cost or margin % (decision 16). Run only on an explicit user prompt, after 8R.

---

## 11. Customer track (run in parallel; this is the real critical path)

| By | Do | Why |
|---|---|---|
| Week of 9 Nov | Decide the first 2–3 ERPs (blueprint open Q1). Best guess for 50–300 employee distributors: Epicor P21, Infor SX.e/CSD, NetSuite | Narrows mapper work in 4C-2 |
| By 4C-2 (~end Nov) | Get **one** anonymised real sales-history + item-master export | Blueprint §2 gap; mapper and cleanup depend on it |
| Dec | 10 conversations; test $299/$599/$999 (blueprint §14) | Validates pricing before charging |
| By 6A (early Jan) | 3–5 real files and 1–2 pilot candidates for the free Margin Leak Audit | 6A cannot finish without them |
| Before 7A | Ask pilots whether Quote Desk or rebates matters more | Re-orders Phase 2 by evidence |

Open blueprint questions still unanswered: 1 (ERPs), 2 (pilots and a real file), 4 (security reviewer), 5 (benchmarks), 6 (1b scope). Question 3 is answered by Prompt 4.0.

**Concurrent v2.4 scope note (8 November 2026):** 7C-2 completed the original
v2.3 items 6–10. Commit 51001c0 subsequently added roadmap requirements to the
blueprint, without changing code. Those additions remain unimplemented and need
an explicitly scoped reconciliation; the progress line does not claim them done.
No 7D or v2.4 extension work is authorized by the 7C-2 close-out.
