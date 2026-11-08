# RebateHQ Blueprint v2.4

*Local-first pricing and margin software for wholesale distributors.*
*Last updated: 8 Nov 2026 (v2.1 adopted 2 Nov 2026; v2.2, v2.3 and v2.4 changes listed in section 22)*

---

## 1. Snapshot

- **What:** Browser-based pricing, margin-leakage, quoting and rebate tool. Customer pricing data is processed on the user's own machine; we never store it.
- **Beachhead:** Wholesale distributors with **50-300 employees** (electrical, plumbing, HVAC, auto parts, building materials). The Starter tier also suits firms at the 30-50 end.
- **Why they buy:** Net margins of 2-7%, tens of thousands of SKUs, matrix pricing, volatile supplier costs, Excel chaos.
- **Market gap:** One distribution analyst cites research that roughly 1 in 10 mid-market companies consistently use analytics for pricing, with 100-300 basis points of margin leaking each year. Treat as indicative (single secondary source).
- **Positioning:** Vendavo-grade essentials at a fraction of the cost, live in 60 seconds, with none of the usual rollout pain.
- **Three promises:** Zero data liability, zero integration delay, immediate margin recovery.

---

## 2. Status and locked decisions

### Where we are
- **Done:** strategy, vertical, tiers, architecture, feature map, data model, capacity targets, competitive gap analysis.
- **Built (repo phases 0-3, verified in CI #39 and Restore Drill #13, commit `2f8b06d`):** a server-side Next.js + Supabase app with sign-in, workspaces, roles, row-level security, audit log and restore drills, plus server-side cost/UoM/FX history, pricing precedence, rebate tiers, quoting, and a 10,000-row supplier-file import with undo.
- **Important:** those phases were built before this blueprint. They store customer pricing data **in Supabase**, which section 4 does not allow. Auth, workspaces and roles carry forward as the control plane; the business-data paths must be ported to the browser and then retired (see `ARCHITECTURE_TRANSITION.md`).
- **Not built yet:** every Phase 1 core deliverable in its local-first form (DuckDB-Wasm vault, Import Studio, waterfall on invoice lines, leaks, guardrails, rules, export, backup). COEP header not yet set.
- **Next:** repo Phase 4 = Blueprint Phase 1 core, starting with the section 19 prototype spike. The "pocket-margin engine with reconciliation and show-me-the-math" is built **in the browser** as part of it (chunk 4D).
- **Gap:** no prospect's ERP export tested yet, and no customer conversations. Real public exports tested so far: UCI "Online Retail" and "Online Retail II" (a UK wholesaler), Microsoft AdventureWorks reseller sales and Northwind (see `REAL_FILE_RESULTS.md` and `PILOT_FILES.md`). Synthetic files in the published export layouts of Business Central, NetSuite, QuickBooks and SAP Business One were also tested against planted leaks. The five ERP profiles remain unverified until a real export from each ERP is tested.

### Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Target size | 50-300 employees |
| 2 | Architecture | Hybrid local-first (data plane in browser, thin cloud control plane) |
| 3 | Engine | DuckDB-Wasm in a Web Worker, persisted in OPFS |
| 4 | Persistence | Persistent storage request + folder auto-backup (Chrome/Edge) + encrypted export fallback |
| 5 | Browsers | Chrome and Edge officially supported; Firefox supported from Phase 2; Safari desktop via a Phase 3 verification spike; iOS Safari for the mobile thin client only (chunk 9A) |
| 6 | CRM connectors | Salesforce/HubSpot deferred to Phase 2, only if pilots ask |
| 7 | Launch integration | CSV/XLSX in (multi-file, with built-in converter), ERP-ready file out |
| 8 | Approvals | Maximum two approval levels, preset thresholds |
| 9 | Name | RebateHQ |
| 10 | Existing server business-data code | Port reusable logic to the browser, then retire the server paths; existing tables and locked migrations stay untouched until a reviewed retirement migration |
| 11 | Privacy proof | A CI "privacy gate" browser test must pass before any "data never leaves your device" claim |
| 12 | Licences in v1 | Issued manually by an admin for pilots; payment integration after the first paid pilots |
| 13 | Phase 1 approval | Single level: the named Pricing Owner approves rule changes before export (two-level approvals arrive with Quote Desk in Phase 2) |
| 14 | Languages and themes | All user-facing text goes through message keys from chunk 7U on. Shipped first: English, Spanish, French (including Canadian). Further languages (candidates: German, Dutch, Portuguese-BR, Italian, Polish, Japanese, Chinese-Simplified, up to ten in total) are added when a pilot asks. No right-to-left languages in v1. Light, dark and high-contrast themes |
| 15 | Mobile | The field-rep PWA moves from Scale to **Professional** as an online-first thin client (floor-price snapshot, Price Check, quote capture). The offline cache stays in Scale. **Built last, as chunk 9A after Phase 3** (item 20 of section 22). Desktop stays Chrome/Edge only; iOS Safari and Android Chrome are supported for the thin client only after a verification spike at the start of 9A |
| 16 | Rep-facing numbers | Nothing shown to reps (Price Check, scorecards, mobile snapshots) may let cost be derived: show floor/target status and compliance, never margin % or cost. Snapshots exclude cost and expire |

---

## 3. Users and roles

| Role | What they do | Key screens |
|---|---|---|
| **Owner / CFO** | Watches margin health, approves big price moves | Executive dashboard, weekly digest, ROI tracker |
| **Pricing Owner** (named person, required) | Accountable for pricing; runs the monthly review | Everything, Monthly Review Pack |
| **Pricing Manager** (power user) | Imports data, builds rules, simulates, exports | Everything |
| **Sales Manager** | Approves discounted quotes, reviews rep behaviour | Approval inbox, discount report |
| **Sales Rep** | Builds quotes, checks floor prices | Quote Desk (mobile friendly) |
| **Accountant** | Rebate accruals, supplier claims, cost updates | Rebates, vendor costs |
| **Admin / IT** | Seats, backup, security | Settings, audit log |

Role-based views: reps never see cost or margin (decision 16); a person who needs margins gets the Sales Manager role. In small firms one person may hold several roles.

---

## 4. Architecture: data plane vs control plane

**Data plane (user's browser, never leaves the device)**
- Price lists, costs, invoice history, margins, rules, simulations
- DuckDB-Wasm for SQL, PapaParse streaming in Web Workers, SheetJS/ExcelJS for conversion and exports
- WebCrypto AES-GCM encryption at rest, key derived from a user passphrase
- Hash-chained local audit log of every import, change and export

**Control plane (thin cloud, metadata only)**
- Auth (magic link, Google/Microsoft SSO), licences, seat limits
- Encrypted relay for sharing, approvals and comments (server sees ciphertext only)
- Public commodity index feed and app updates
- Your existing Supabase work lives here: identity and licences, **not pricing data**

```
[Browser: DuckDB + Workers + Encrypted OPFS]  <-- ciphertext only -->  [Relay + Auth + Licences + Index feed]
```

**Why hybrid:** pure zero-backend cannot do client-side auth, email approvals, licensing or mobile sync.

---

## 5. Data engine: capacity, speed, design rules

### Capacity per tier

| Tier | SKUs | Invoice lines (12-24 months) |
|---|---|---|
| Starter | 20,000 | 200,000 |
| Professional | 100,000 | 1,000,000 |
| Scale | 200,000 | 2,000,000 |

Hard cap of 2M lines in v1; beyond that, prompt the user to filter or archive older data. Most 50-300 employee distributors will sit well below these limits.

### Performance targets (to be proven in the prototype)

| Action | Data size | Goal |
|---|---|---|
| Parse and load CSV | 1M rows | Under 10s on a mid-range laptop (stretch 5s) |
| Waterfall / drill-down | 2M lines | Under 300 ms (stretch 150 ms) |
| Price rule simulation | 100k SKUs x 12 months | Under 2s (stretch 1s) |
| App start with existing vault | Any tier | Under 3s |

Goals, not promises. Benchmark on an 8 GB office laptop. "100M rows in a tab" claims are unrealistic; browser memory caps at a few GB.

### Engine design rules
1. Everything heavy runs in a **Web Worker**; the UI thread only draws.
2. **Stream imports in chunks**; never load a whole file into JS arrays.
3. **Pre-aggregate on import** (customer x product x month margin, discounts, rebate accruals) so dashboards read small tables.
4. **Sort on load** by customer and date (columnar engine, not classic indexes).
5. Store money as **integers or decimals**, never floats, so margins reconcile with the ERP.
6. Simulations run as SQL on a **temporary copy**; nothing changes until approval.
7. **Versioned schema migrations** so old vaults always open.
8. Backups as **Parquet or encrypted file snapshots**.
9. **Memory guardrails:** estimate size before import, warn on huge files, offer import by date range.
10. **Privacy gate:** an automated browser test imports fixture data with unique marker values and fails if any marker appears in a network request, header, body or console log. It runs in CI on every change.
11. **Encryption at rest is decided by the spike:** use DuckDB's own database encryption only if encrypted OPFS read/write is proved in the chosen browser build. Otherwise keep the unlocked working database and staging **in memory**, and persist **only encrypted snapshots** in OPFS (AES-GCM, key derived from the passphrase). Encrypting backups does not encrypt a plaintext OPFS working database; deleting it at lock/tab-close is not a crash-safe security boundary.

### Hosting and headers
- DuckDB multi-threading needs **COOP/COEP headers**. Set them from day one.
- Use Cloudflare Pages, Netlify or Vercel. **Avoid GitHub Pages** (cannot set these headers).
- Self-host DuckDB WASM files with the app; provide a single-thread fallback.

---

## 6. Module and feature map

| # | Module | Purpose | Phase |
|---|---|---|---|
| M1 | Workspace & Security | Sign-in, licences, encrypted vault, backup, roles, setup checklist | 1 |
| M2 | Data Hub | Import Studio (multi-file + converter), ERP mapper, resilient parser, Fix Later, health score, item master cleanup, cost basis selector | 1 |
| M3 | Margin Intelligence | Waterfall, customer/product profitability, leak finder, Leak Report, ROI tracker, margin bridge | 1-2 |
| M4 | Price Engine | Matrix pricing, rule builder, price guardrails, change preview, versioning | 1 |
| M5 | Export Studio | ERP-specific import files, PDF reports, change logs | 1 |
| M6 | Quote Desk | Quotes with margin thermometer, start/target/floor guidance, approvals | 2 |
| M7 | Rebates & Contracts | Customer rebates, supplier rebate and ship-and-debit claims, contract expiry | 2 |
| M8 | Vendor Cost Center | Supplier sheet review, cost impact, stale-quote alerts | 2 |
| M9 | Simulator | Backtest price changes on historical orders (Scale tier) | 2 |
| M10 | Alerts & Agents | Margin Drain checks, cost index triggers, dead-stock flags | 3 |
| M11 | Deal Guidance | Explainable win-price ranges, cross-sell suggestions | 3 |
| M12 | Collaboration Relay | Encrypted sharing, approvals, comments and @mentions, mobile sync | 2 |
| M13 | Experience layer | Themes, languages, command palette, plain-language glossary popovers, inline-edit price grid, what-if sliders | 2 (foundations in 7U) |

### Phase 1 (MVP)
**Data and onboarding**
- **Playground mode:** pre-loaded fictional "Industrial Valve & Pipe Distributor" (5,000 SKUs, 50 customer tiers, planted leaks)
- **Import Studio:** multi-file import and in-browser converter (see 6A)
- **Smart ERP mapper:** dropdown profiles (NetSuite, Epicor P21, Infor, Dynamics BC, QuickBooks Enterprise) plus fuzzy header matching
- **Resilient parser:** strips symbols, handles "TBD"/"CALL", dedupes SKUs, sends bad rows to "Fix Later"
- **Item master cleanup assistant:** duplicate SKUs, unit-of-measure normalising, missing categories, one-click fixes
- **Data health score:** % of SKUs with valid cost, duplicates, outliers
- **Cost basis selector:** choose last, average or replacement cost; margins shown under each so users see the impact
- **Guided 7-day setup checklist:** import, map, fix, first report, first rule, first export, invite the team

**Analysis and pricing**
- **Margin waterfall:** list price to pocket margin (discounts, freight, off-invoice rebates), drill by product, customer, branch
- **Customer profitability (whale curve):** who makes or loses money after discounts and freight
- **Price guardrails:** start / target / floor prices per customer tier and category, with green / yellow / red status
- **Rule engine:** e.g. "if steel cost rises over 5%, raise Category X by 4.5%", with plain-language templates
- **Change preview + export:** before/after diff, approval by the Pricing Owner, then ERP-ready import file
- **Margin Leak Report:** one-click shareable PDF of top leaks (sales hook and trial converter)
- **ROI tracker (v1):** running total of leak dollars found; "recovered" is added in Phase 2 once rule runs are tracked

### Phase 2
- **"Why did margin change?" bridge:** month-over-month price / volume / mix / cost breakdown
- **Quote Desk** with margin thermometer, start/target/floor guidance and approvals (max two levels)
- **Customer rebate engine:** accruals, tier progress, reminders
- **Supplier rebate and ship-and-debit claim tracker:** money suppliers owe you
- **Vendor price review:** new supplier sheet vs current costs, flags affected quotes
- **Historical scenario simulator** (Scale tier)
- **Comments and @mentions** on price changes and quotes via the encrypted relay
- **Price list versioning with rollback**
- **Price exceptions report** (below floor or below contract price)
- **Price increase planner** (by segment, with revenue impact preview) and an increase-letter template (moved up from Phase 3)
- **Contract price expiry tracker**
- **Competitor price log** (manual entries compared with your price in the margin view)
- **ROI tracker (v2):** leaks found vs dollars recovered
- **Monthly Pricing Review Pack:** auto-generated agenda and report for the pricing owner
- **Weekly digest PDF**

**Phase 2 additions (v2.3)**
- **Experience layer (chunk 7U, before Quote Desk):** theme tokens with light, dark and high-contrast themes; message-key i18n (English, Spanish, French) with `Intl` number, date and currency formatting, pseudo-locale CI test and a translated finance glossary; command palette (`Ctrl/Cmd+K`) for navigation, SKU and customer search and commands (no free-text language parsing); plain-language glossary popovers beside "show the math"; accessibility pass
- **Price Check:** a fast SKU-plus-customer lookup showing price, start/target/floor status and a green/amber/red signal. It reads guardrails and the price book; the quote itself is still entered in the ERP. Works with a USB barcode scanner (keyboard input)
- **Customer credit signal:** green/amber/red from imported AR aging, DSO or credit utilisation, next to the customer in Quote Desk, with a soft warning on deep discounts to slow payers
- **Rebate progress:** customer and supplier attainment ("$12,400 to the next tier"), using sales history and the new Purchases role; part of the rebate engine (7D)
- **Cost-to-serve leaks:** small orders and free-delivery orders that lose money after freight, added to the leak finder using the freight already in the waterfall. No zone, weight-break or fuel-surcharge rating engine
- **Inline-edit price grid:** spreadsheet-style editing with Excel paste. Every edit writes to a draft changeset that passes guardrails, preview, approval and audit; it never edits live prices
- **What-if sliders** in the rule builder: approximate live impact while dragging, exact result on release
- **Price-change landed check:** re-import the next ERP export and diff it against the last exported price file to show which changes did not take effect
- **Purchase price variance:** the same SKU bought at different prices or from different vendors
- **Rep compliance scorecard:** floor/target compliance and "margin protected" points, never margin % or cost; team view by default, individual view opt-in, no leaderboard by default
- **Folder re-import:** re-run saved converter recipes against a remembered folder (Chrome/Edge File System Access, permission re-prompted each session)

**Phase 2 additions (v2.4)**
- **Multi-currency:** a workspace display currency (e.g. CAD, AUD, GBP) set in Settings, with a user-entered FX rate per import batch; all amounts in the app (margins, waterfall, quotes, leak totals) display in the workspace currency. No live exchange-rate fetch from the browser
- **Customer health alerts:** margin-drop cards on Home when a customer's pocket margin falls more than a configurable threshold (default 5 pp) over a rolling 90-day window, or when order frequency drops while discounting deepens; runs when the app is open and feeds the weekly digest; SQL threshold rules on `agg_cm`, not AI — called "Customer health alerts" not "AI monitoring"
- **Competitor log — suggest alternatives:** when a competitor price is logged on a SKU, the top 3 highest-margin alternatives in the same product category for that customer are shown, ranked by pocket margin; SQL query on price matrix and margin aggregates, no ML
- **Supplier claim generator:** generate a claim-ready CSV/XLSX export from the supplier rebate tracker for direct submission to the supplier (part of chunk 7D)
- **Sync status indicator:** last-synced timestamp and synced / pending / conflict status in the relay UI, so users understand that each device holds its own local copy and sync happens via approved relay events
- **"90-day cash leak" hero number on Home:** the Home dashboard prominently shows the exact cash left on the table over the last 90 days from the existing leak finder data, not just a margin percentage; no schema or calculation change, a UX framing requirement on the Home spec

### Phase 3
- Explainable deal guidance (shows the why) and cross-sell suggestions ("customers like X also buy Y")
- Margin Drain agents (local background checks)
- Cost index triggers (user-uploaded or public data first), including an import-cost currency buffer rule (rates entered by the user or taken from the control plane's public index feed, never fetched from the browser directly)
- Dead-stock clearance optimiser (idle 90+ days, floored at replacement cost) with user-entered carrying-cost parameters (cost of capital % and storage cost per unit per month), showing total capital tied up per SKU in cash terms and suggesting substitute SKUs
- Safari desktop verification spike: confirm OPFS persistence and DuckDB-Wasm multi-threaded mode in Chrome/Edge behaviour parity before claiming Safari desktop as a supported browser
- Win/loss log
- Opt-in anonymous benchmarks (aggregates only, explicit consent)
- Offline PWA mode, audit and compliance pack
- Templates: vendor negotiation sheets, rebate agreements (increase letters moved to Phase 2)

### Final phase (after Phase 3; chunk 9A)
- **Mobile field-rep PWA** (Professional tier; offline cache in Scale): online-first thin client with an encrypted, cost-free, expiring floor-price snapshot, Price Check and quote capture (decision 15). Built last, once every desktop feature is done. It starts with an iOS Safari / Android Chrome verification spike (storage eviction, memory, install behaviour) whose results decide the scope, and it reuses the relay (7A), Price Check (7B), device revocation (5B) and Phase 3 offline PWA mode (8C). Until then Quote Desk is responsive in a desktop browser but is not a supported phone product

### Deferred or dropped
- Customer self-serve portal (conflicts with zero-storage)
- Licensed live commodity feeds (cost; start with uploads)
- Salesforce/HubSpot connectors (after pilots ask)
- Freight rating engine (zones, weight breaks, fuel surcharges): actual freight per order is used instead; revisit only if pilots lack freight data
- Rep leaderboards and points that rank individuals by default (scorecards are team-level first)
- Free-text natural-language commands in the command palette
- Right-to-left languages in v1
- Live exchange-rate fetching from the browser
- Server-side ingestion (scheduled Google Sheets fetch, email-in, SFTP, stored connector credentials) built in repo chunk 3C: dropped, because the server would handle business data. Could return later only as browser-side or local-folder ingestion

### 6A. Import Studio: multiple files and in-browser converter

**Goal:** a user drops whatever files they have, from any ERP or supplier, and RebateHQ turns them into clean CSV and loads them. No hunting for 10 converter sites, and nothing is uploaded anywhere.

**Multi-file support**
- Drag and drop many files or a whole folder (Chrome/Edge)
- **Role tagging:** auto-detect or tag each file as Sales history, Item master, Customer list, Vendor cost sheet, Rebate agreement or Price list. Phase 2 adds **Purchases (PO receipts)** for supplier rebate progress and **AR aging / credit limits** for the credit signal; like rebate agreements, they load with the module that uses them
- **Combine:** merge files of the same role (e.g. 24 monthly invoice exports) with column alignment, duplicate-row detection and overlap-date warnings
- **Source tracking:** every row remembers its source file, so a bad file can be removed or re-imported
- **Batch report:** per-file rows loaded, rows rejected, issues found

**Converter: formats handled fully in the browser**

| Input | How | Phase |
|---|---|---|
| CSV, TSV, TXT (any delimiter, encoding, decimal style) | Auto-detect delimiter and encoding | 1 |
| XLSX, XLS, XLSM, XLSB, ODS | SheetJS, with sheet picker and header-row detection | 1 |
| JSON, XML | Flatten to rows | 1 |
| Fixed-width reports (.prn, .txt, ERP print-to-file) | Column-boundary detector with manual adjust | 2 |
| Parquet | DuckDB native | 2 |
| Text-based PDF tables | Table extraction (pdf.js), with preview and manual correction | 2 |
| Scanned PDFs and images | OCR (heavy, less reliable) | 3 or later |

**Conversion rules**
- Output is always **clean UTF-8 CSV**, loaded straight into the vault
- Always show a **preview with fixes**: pick sheet, header row, delimiter, date format, decimal symbol
- Handle merged cells, multi-row headers, subtotal and "Total" rows, blank rows and footers automatically
- Save **converter recipes** per ERP or supplier for one-click repeat imports
- Download converted CSVs individually or as one zip
- Everything runs locally in a Web Worker
- XLS, XLSB, ODS, JSON and XML are read whole in the browser, so they are capped at 300,000 rows (64 MiB). XLSX and XLSM sheets over 300,000 rows are read in a stream (still 64 MiB per workbook; merged cells are not filled in on those sheets). CSV/TSV/TXT stream up to 256 MiB per file
- Rebate agreement files are tagged, previewed and converted in Phase 1; loading them into the vault arrives with the customer rebate engine in Phase 2
- Columns are mapped by canonical name, common synonyms (English, German, French, Spanish and Dutch) and ERP profiles, each with a confidence score; anything inferred (synonyms, unit price × quantity, "not in file", generated line IDs, values from a header file or the item list) must be confirmed by the user before import (4C-2, 6A)
- Order-header exports (customer, date and freight per order in a separate file) are joined to their lines file by invoice number during review. Freight is spread over each order's loaded lines in proportion to list amount, exact to the cent. Header rows are not stored on their own; lines with no matching header wait in Fix Later (6A)
- When a sales file has no cost, the user may choose quantity × the item list's current cost as its cost source. The batch report counts those lines, and the leak finder then treats that cost like any invoice cost. Lines whose item has no cost stay unknown (6A)
- Pilot hardening (6A) added the export shapes found in real files: files with no header row; report section headings (such as a QuickBooks item) copied into the rows below; a line-type column that skips G/L-account, charge and comment lines; discounts given as a percent or a 0–1 share of list; and a per-file date range for sales files (engine rule 9). Amount columns with more than two decimals (for example SQL Server money) are rounded to the cent, half away from zero, with a note; unit prices keep full precision for unit × quantity
- A sales line's cost may be unknown; it is never assumed to be zero, and its pocket is left out of margin. Returns and credits (negative quantities) wait in Fix Later at import; the user loads them as signed credit lines, which net against sales in a separate "Returns and credits" waterfall step and are never leaks (4D). Credit memos with a positive quantity and a negative amount are not loaded

**Scope guardrail:** business data files only (spreadsheets, text exports, tables). Not a general image, video or document converter.

**Growth angle:** release the converter as a **free standalone page** ("Drop any ERP or Excel export, get clean CSV, 100% private") for SEO and lead generation.

---

## 7. Benchmark: Vendavo features we borrow, at low cost

Vendavo's suite covers pricing (price waterfall, margin bridge analytics), quoting and agreements with approvals, rebate management, and deal guidance with stretch, target and floor prices for reps.

| Vendavo capability | RebateHQ low-cost version | Phase |
|---|---|---|
| Price waterfall | Margin waterfall | 1 |
| Start / target / floor guidance | Price guardrails per tier and category | 1 (config), 2 (in Quote Desk) |
| Margin bridge (price-volume-mix) | "Why did margin change?" bridge | 2 |
| Rebate management | Customer rebate engine | 2 |
| Ship and debit / channel rebates | Supplier rebate and ship-and-debit claim tracker | 2 |
| Quoting and approvals | Quote Desk with max two approval levels | 2 |
| Dynamic repricing on cost change | Rule engine plus cost alerts | 1-3 |
| Cross-sell recommendations | Simple basket analysis | 3 |

---

## 8. Common problems in similar software, and how RebateHQ solves them

| Problem users hit | Why it hurts | RebateHQ answer | Phase |
|---|---|---|---|
| **Bad data stalls everything** | Data quality issues can halt implementations and delay them for months | Resilient parser, Fix Later queue, health score, converter | 1 |
| **Item master can't feed the engine** | Mid-cap distributors often buy a second tool after the first flops | Item master cleanup assistant | 1 |
| **Unclear which cost to use** | Many cost bases; need rules for which applies when | Cost basis selector with margins shown under each | 1 |
| **Reps abandon the tool** | Hard-to-use systems make teams revert to manual methods | Simple mobile Quote Desk; guardrails that explain why | 2 |
| **Rep resistance to change** | Adoption improves when reps keep autonomy | Soft warnings and "request exception", no punishing UX | 1-2 |
| **Too complex, overwhelming** | Reviewers cite complexity, difficult customization and an overwhelming start | Opinionated defaults, templates, 7-day setup checklist | 1 |
| **Heavy admin, needs specialists** | Advanced pricing design takes specialist effort | Plain-language rule builder with templates | 1 |
| **Over-engineered approvals** | A recurring pitfall in pricing projects | Max two levels, preset thresholds | 2 |
| **No owner, no cadence** | Executive sponsor and dedicated internal owner predict success | Named Pricing Owner role, Monthly Review Pack | 1-2 |
| **Set and forget** | Software needs ongoing monitoring | Alerts, agents, weekly digest | 2-3 |
| **Competitors ignored** | Competitive intelligence is a missed opportunity | Competitor price log | 2 |
| **Weak collaboration** | Some reviewers note limited team collaboration | Comments and @mentions on changes and quotes | 2 |
| **Opaque pricing and rollout cost** | Public pricing and implementation economics often not transparent | Public flat pricing, no implementation fee | 1 |
| **Slow to see value** | Customers still building adoption long after purchase | ROI tracker, time to first leak under 2 minutes | 1-2 |

---

## 9. Screen map

```
Home (Executive Dashboard + ROI tracker)
├── Data Hub: Import Studio → Map columns → Fix Later → Item cleanup → Cost basis → Health score
├── Margin: Waterfall • Customers (whale curve) • Products • Leaks • Margin bridge
├── Pricing: Matrices • Guardrails • Rules • Preview diff • Versions
├── Quotes: New quote • Price Check • Approval inbox • History
├── Rebates & Contracts: Customer rebates • Supplier claims • Accruals • Rebate progress • Expiring prices
├── Vendors: Cost sheets • Impact review
├── Simulator
├── Reports: Leak Report • Weekly digest • Monthly Review Pack • Audit pack
└── Settings: Team • Pricing owner • Backup • Security • ERP profile • Converter recipes • Theme • Language

Global: command palette (Ctrl/Cmd+K) reaches every screen, SKU and customer
```

---

## 10. Core data model (local tables)

- **products:** product_id, description, category, uom, current_cost, list_price
- **customers:** customer_id, name, tier, branch, region, payment_terms
- **price_matrix:** product/category, customer/tier, qty_break, price, valid_from, valid_to
- **price_guardrails:** scope (tier/category), start, target, floor
- **sales_lines:** invoice_id, date, customer_id, product_id, qty, unit_price, discounts, freight, rebate_flag
- **vendor_costs:** vendor, product_id, cost, effective_date, source_file
- **cost_basis_settings:** chosen basis per product group (last, average, replacement)
- **rebate_programs / rebate_accruals:** thresholds, rates, period, accrued_amount
- **supplier_claims:** supplier, program, ship-and-debit or rebate, amount claimed, status, due date
- **quotes / quote_lines:** status, margin, approver, decision_time
- **rules / rule_runs:** definition, scope, run_date, affected_rows
- **price_versions:** snapshot_id, created_by, diff summary
- **comments:** target (quote/change), author, text, mentions
- **competitor_prices:** product_id, competitor, price, date, source
- **roi_ledger:** leak identified, action taken, dollars recovered, date
- **audit_log:** hash-chained entries
- **import_issues:** the Fix Later queue
- **source_files / import_batches:** file name, role tag, rows loaded/rejected, import date
- **converter_recipes:** saved sheet, header row, delimiter, date and column settings per ERP or supplier

---

## 11. Data flow and activation

```
Files (CSV/XLSX/etc.) → Convert & map → Clean (item master, cost basis) → Local vault (DuckDB)
   → Analyse leaks → Decide (rules / simulate) → Preview diff → Approve → ERP-ready file back to ERP
```

**60-second activation flow**
1. One-click sign-in (5s)
2. Land in Playground with sample data (10s)
3. Drag and drop real files; converter and mapper confirm columns (15s)
4. Margin dashboard and Leak Report on their own data (30s)

Success metric: **time to first leak found under 2 minutes.**

---

## 12. Non-functional requirements

| Area | Target |
|---|---|
| Security | Encryption at rest, passphrase never leaves device, relay sees ciphertext only |
| Reliability | Autosave, versioned snapshots, restore wizard |
| Browsers | Chrome and Edge officially; Firefox from Phase 2; Safari desktop after a Phase 3 verification spike |
| Accessibility | Keyboard navigation, readable contrast, no colour-only signals; light, dark and high-contrast themes built on colour tokens |
| Languages | No hard-coded user-facing strings from 7U on; `Intl` formatting for numbers, dates and currency; generated text (rule explanations, show-the-math, reports) built from message keys; ERP exports and audit-log entries stay language-neutral; a pseudo-locale test in CI catches untranslated or truncated text |
| Updates | Instant web deploys, versioned data migrations |
| Auditability | Every price change and export logged and exportable |
| Simplicity | Sensible defaults everywhere; any workflow completable without documentation |

---

## 13. Risks and guardrails

| Risk | Mitigation |
|---|---|
| Browser clears data | `navigator.storage.persist()`, folder auto-backup, export reminders, restore wizard |
| Big files crash the tab | Web Workers, chunked streaming, progress UI, row limits per tier |
| Single laptop = single point of failure | Backup prompts, versioned snapshots, encrypted share to a colleague |
| "Too good to be true" scepticism | Lead with the architecture story, one-page security whitepaper, free audit on their own file |
| Lost or stolen device | Passphrase encryption, remote licence revocation |
| Unsupported claims | Don't promise "$70k saved in 60 days" or "$150k lost per $20M revenue" until pilot data exists; don't repeat the "92% of pricing software fails" stat (weak source) |
| Support burden | "95% margin" ignores support, onboarding and data costs |
| Converter scope creep | Business data formats only; PDF and scanned files are never 100% accurate, so always preview |
| Phase 1 scope growth | Phase 1 now has more items; ship Phase 1 core first (import, waterfall, rules, export), then 1b (cleanup, cost basis, checklist, ROI v1) |
| Building without customer input | Mapper, cleanup and rules may not match real exports; secure at least one real sample early |
| DuckDB-Wasm cannot encrypt its OPFS file | Use encrypted snapshots with memory-only working/staging data. A plaintext OPFS working file survives crashes; deleting it on lock/close is not encryption. Native encryption can return only after encrypted read/write is proved. |
| COEP breaks third-party resources (auth, fonts) | Spike checks Supabase sign-in and assets with COEP on; use `credentialless` or self-host if needed |
| Mobile snapshot on a lost phone | Snapshot holds floor-price status only (no costs), expires, is bound to a revocable device (5B) and is encrypted |
| iOS storage eviction and memory limits | Thin client only (no DuckDB on the phone); verify Safari/Chrome storage behaviour in a spike at the start of 9A; keep Chrome/Edge as the only desktop claim |
| Safari desktop storage eviction and threading | OPFS persistence and DuckDB-Wasm multi-threaded mode must be confirmed in the Phase 3 verification spike before claiming Safari desktop support; do not advertise it until the spike passes |
| Translation drift and finance jargon | Glossary of fixed terms, native-speaker review before a language ships, ship only languages a pilot asks for; each new feature carries its strings in every shipped language |
| Rep numbers leak cost | Decision 16: show compliance and floor status only; a test checks that no rep-role payload contains cost or margin % |
| Alerts only run while the app is open | State this in the UI and in the digest; show "last checked" rather than implying a background service |
| Verification overhead outruns product | Database-level test suites and restore drills only for control-plane changes; data-plane chunks use unit, browser e2e, privacy-gate and timing checks; stop and simplify after 3 CI-fix attempts on one chunk |

---

## 14. Pricing and tiers (annual billing)

| Tier | Price | For | Limits |
|---|---|---|---|
| **Starter** | $299/mo | Single-location distributors | **1 user, 1 location / 1 ERP profile,** 20k SKUs, 200k invoice lines |
| **Professional** (recommended) | $599/mo | Multi-branch distributors | **5 users,** multiple ERP profiles and branches, 100k SKUs, 1M invoice lines |
| **Scale** | $999/mo | Larger regionals | **Up to 15 users,** 200k SKUs, 2M invoice lines. More seats by custom agreement |

### What each tier includes

| Area | Starter | Professional | Scale |
|---|---|---|---|
| Import Studio (multi-file + converter) | Yes | Yes | Yes |
| ERP mapper | 1 profile | Pre-built templates (NetSuite, Epicor P21, Dynamics BC, more) | Templates + custom recipe mapping support |
| Item master cleanup, cost basis selector | Yes | Yes | Yes |
| Margin waterfall, health score, Leak Report | Yes (single location) | Yes (multi-branch) | Yes |
| Price guardrails (start / target / floor) | Basic, with ERP-ready export for 1 profile | Full, per tier and category | Full |
| ROI tracker | Yes | Yes | Yes |
| Customer profitability (whale curve) | - | Yes | Yes |
| "Why did margin change?" bridge | - | Yes | Yes |
| Customer rebates + supplier claim tracker | - | Yes | Yes |
| Vendor price review, price exceptions, contract expiry | - | Yes | Yes |
| Quote Desk, approvals (max 2 levels), comments, competitor log | - | Yes | Yes |
| Monthly Pricing Review Pack | - | Yes | Yes |
| **Historical scenario simulator** | - | - | **Yes** |
| Mobile field-rep PWA (built last, chunk 9A; online-first thin client: Price Check, floor prices, quote capture) | - | Yes | Yes, plus offline cache |
| Price Check, customer credit signal, rebate progress, rep compliance scorecard | - | Yes | Yes |
| Themes, languages, command palette, glossary popovers | Yes | Yes | Yes |
| Inline-edit price grid, what-if sliders, price-change landed check | Basic grid | Yes | Yes |
| Custom ERP export formats | - | - | Yes |
| Support | Email, community | Email, standard response | Priority, converter recipe mapping help |

### Rules and offers
- Public flat pricing, **no implementation fee**
- 14-day free trial on their own data, no card needed
- Replace the hard-coded refund claim with a pilot offer: free Margin Leak Audit, then a 60-day money-back guarantee tied to leaks actually found
- **Limit enforcement:** user and location caps are enforced through licences in the control plane; SKU and row caps through import checks. Upgrade prompts appear when a limit is hit.
- **Extra seats / locations:** priced as optional add-ons, to be set after pilot feedback
- Validate $299 / $599 / $999 in the first 10 conversations

### Why these limits
- **Starter capped at 1 location / 1 ERP profile:** keeps it a true single-site product and stops multi-warehouse firms from running everything on the cheapest plan.
- **Simulator in Scale only:** it is the advanced executive feature (backtesting across up to 2M lines) and gives larger firms a clear reason to upgrade. *Trade-off to test:* if pilots say Professional feels incomplete without it, bring a lighter "what-if on selected categories" version down to Professional and keep full historical backtesting in Scale.
- **Scale capped at 15 users:** limits support load; larger teams negotiate a custom plan.

### Value framing (how to talk about price)
- Position against the typical alternatives: enterprise pricing suites usually mean five- to six-figure annual contracts plus paid implementation, while RebateHQ is $3,588 to $11,988 a year with no setup fee.
- **Do not publish specific competitor prices or "90-95% cheaper" claims** until you have verified quotes or public figures; vendors don't publish pricing, so any published number is an estimate.
- Anchor ROI on the customer's own data: "Your Leak Report found $X; RebateHQ costs $7,188 a year" beats any generic savings table.

---

## 15. Go-to-market (50-300 employee distributors)

1. **Hook:** free Margin Leak Audit on their own ERP export; nothing uploaded
2. **Channels:** LinkedIn to owners, controllers and pricing managers; distributor associations; ERP resellers; content like "5 places your distributor margin leaks"
3. **Proof:** every pilot becomes a one-page case study with leak dollars found (from the ROI tracker)
4. **Motion:** founder-led first 10 customers, then self-serve trial
5. **Free tool lead magnet:** standalone private file converter page (6A)
6. **Message contrast:** "No consultants, no 6-month rollout, no hidden implementation fees"

---

## 16. Running cost estimate

| Item | Cost |
|---|---|
| DuckDB-Wasm | $0 (open source) |
| Static hosting | $0 to ~$20/mo (paid plan once you charge customers) |
| Backend (auth, licences, relay) | $0 to ~$25/mo |
| Domain | ~$10-15/year |
| Email for magic links | $0 to ~$20/mo |

Roughly **$0-50/month** early on; cost barely grows with customers.

---

## 17. Roadmap and build plan

| Phase | Repo phase | Weeks | Deliverables |
|---|---|---|---|
| Foundations | 0-3 | Done | Server backend verified in CI (#39) and Restore Drill (#13); becomes the control plane |
| Transition + spike | 4.0, 4A | ~1 | Transition map, section 19 spike, encryption and COEP decisions |
| 1 core | 4B-4E | 3-4 (realistic 4-5) | Local DB, Import Studio, mapper, parser, waterfall + pocket-margin engine, guardrails, rules, export, backup, playground, Leak Report |
| 1b + control plane | 5A, 5B | 2-3 | Item cleanup, cost basis selector, 7-day checklist, ROI v1, roles; licences/tier limits; retire server business-data paths; carried security fixes |
| Pilot hardening | 6A, 6R | 2-3 | Test on 3-5 real ERP files, backup/restore, edge cases, 8 GB laptop benchmarks; retire the first 22 legacy business tables (6R: the 21 planned plus `plan_feature`) |
| Security + whitepaper | 6B | 1-2 | Review before charging |
| **Sellable v1** | | **~10-13 from 2 Nov 2026** | First paid pilot (target window 11 Jan - 1 Feb 2027) |
| 2 | 7A, 7U, 7B-7F | +6-8 (realistic 8-10, plus roughly 1 for 7U, an estimate) | Relay, UX foundations (7U), Quote Desk, bridge, rebates (customer and supplier), vendor review, simulator, comments, approvals, versioning |
| 3 | 8A-8D, 8R | +5-6 (realistic 5-7) | Guidance, agents, indices, dead-stock engine, cross-sell; retire the remaining 12 legacy business tables (8R) |
| Final | 9A | After Phase 3 (not yet estimated) | Mobile field-rep PWA (Professional; offline cache in Scale), starting with the iOS/Android verification spike |

Estimates assume one full-time founder with an AI coding agent. The critical path is real ERP files and pilot feedback, not code. Chunk-level prompts live in `BLUEPRINT_EXECUTION_PLAN.md`.

**Verification policy:** control-plane migrations keep the pgTAP suite, migration lock and restore drill. Data-plane chunks are verified by unit tests, browser end-to-end tests, the privacy gate and recorded timings. A chunk is "verified" only with a green CI run cited by link.

**Vertical expansion:** Wholesale distribution (matrix pricing) → Industrial manufacturing (cost-plus, rebates) → B2B services/SaaS (usage-based, tiered).

### Phase 1 core, week by week

| Week | Build | Done when |
|---|---|---|
| 1 | App shell, vault, DuckDB + OPFS, drag and drop, Worker ingest, privacy gate (auth reuses the existing Supabase sign-in) | 100k-row CSV loads without freezing; privacy gate passes |
| 2 | Import Studio (multi-file, XLSX/CSV converter), ERP mapper, resilient parser, Fix Later, sample dataset | Messy files from several sources load cleanly |
| 3 | Waterfall, customer profitability, leak finder, Leak Report PDF | Report generated from a real file |
| 4 | Guardrails, rule engine, change preview, ERP-ready export, backup | Full import-to-export loop works |

---

## 18. Success metrics

**Product:** time to first leak found under 2 min; 60%+ of trial users import their own file; 7-day checklist completion rate; weekly active pricing owners; backups completed per account.
**Business:** trial-to-paid conversion; leak dollars identified and recovered per account (ROI tracker); churn and seat expansion.

---

## 19. Prototype spike checklist (2-4 days)

- [ ] DuckDB-Wasm in a Web Worker with OPFS persistence
- [ ] Synthetic data: 200k SKUs, 2M invoice lines
- [ ] Streaming CSV import with progress bar
- [ ] Margin waterfall query on the full set
- [ ] 4.5% rule simulation across all lines
- [ ] Reload after closing the browser: data still there
- [ ] Import 12 monthly CSVs plus one XLSX at once, combined with source tracking
- [ ] Convert XLSX, TSV and a messy semicolon-delimited file to clean CSV in the browser
- [ ] Test on an 8 GB laptop in Chrome and Edge
- [ ] Record timings against section 5

**Pass = targets met or close. Fail = lower tier caps before selling them.**

---

## 20. Open questions

1. Which 2-3 ERPs do you support first?
2. Who are your first 5 pilot distributors, and can you get one real (anonymised) ERP export?
3. ~~How do the existing backend phases map onto the control plane vs data plane split in section 4?~~ Answered in `ARCHITECTURE_TRANSITION.md` (v2.2).
4. Solo build, or bring in a developer for the security review?
5. Do you want opt-in benchmarks, given the privacy wording it needs?
6. Is the extra Phase 1b scope acceptable, or should some items move to Phase 2?
7. Encryption at rest: **encrypted snapshots** for the approved offline build (chunk 4A local probe: DuckDB-Wasm 1.32.0 / DuckDB 1.4.3 reports a read-only crypto module; writable native encryption needs httpfs, which is not installed). Use AES-256-GCM authenticated chunks and PBKDF2-SHA256 at 600,000 iterations, with memory-only unlocked working data. Full-size save/open measurements and remaining verification limits are in `SPIKE_RESULTS.md`; production vault implementation remains 4B.

---

## 21. What changed from the original source plans

**Added:** hybrid architecture, Import Studio and converter, Margin Leak Report, change preview, versioning, encrypted at-rest storage, local audit log, mobile PWA, customer profitability, price guardrails, margin bridge, supplier claim tracker, item master cleanup, cost basis selector, 7-day checklist, ROI tracker, Pricing Owner role, Monthly Review Pack, comments, competitor log, price exceptions, increase planner, contract expiry tracker, weekly digest, win/loss log, pilot-based guarantee, capacity tiers, performance targets, Vendavo benchmark, problem-and-fix table.

**Fixed:**
- "Client-side auth" is not possible alone, so auth lives in the control plane
- Email approvals and licensing need a server, so a ciphertext-only relay was added
- Live commodity data costs money, so it moved to Phase 3
- Customer portal deferred (conflicts with zero-storage)
- Browser support clarified (File System Access API is Chromium-only)
- "100M rows in a tab" replaced with realistic 2M-line capacity
- Size target reconciled to 50-300 employees
- Competitor price log moved from Phase 3 to Phase 2
- Approvals capped at two levels to avoid over-engineering
- Tier limits tightened: Starter is 1 location / 1 ERP profile, Scale is capped at 15 users, and the simulator moved to Scale

---

## 22. Changes in v2.2 (2 Nov 2026)

Corrections after reviewing the repository and build history against v2.1. Product scope, tiers, prices and module phases are unchanged.

1. **Section 2 status corrected.** v2.1 said "Phase 4 pocket-margin engine in progress"; it had not started. The repo phases 0-3 store business data server-side, which conflicts with section 4. The status now says so, and the pocket-margin engine is re-scoped to run in the browser (chunk 4D).
2. **Locked decisions 10-13 added:** retire (not delete) the server business-data paths after porting; CI privacy gate before any privacy claim; manual licences for pilots; single-level Pricing Owner approval in Phase 1.
3. **Engine rules 10-11 added:** privacy gate test; encryption approach chosen by the spike, with an encrypted-snapshot fallback.
4. **Phase 1 "Change preview + export"** now names the Pricing Owner approval step.
5. **Dropped:** the server-side Sheets/email/SFTP ingestion and stored connector credentials built in chunk 3C.
6. **Risks added:** OPFS encryption feasibility, COEP side effects, verification overhead.
7. **Roadmap (section 17)** maps blueprint phases to repo phases, adds the transition/spike and control-plane steps, gives realistic week ranges and a sellable-v1 window (11 Jan - 1 Feb 2027), and states the verification policy. Week 1 reuses the existing sign-in.
8. **Open questions:** Q3 answered by `ARCHITECTURE_TRANSITION.md`; Q7 (encryption approach) added.
9. **3 Nov 2026, chunk 4A — encryption fallback clarified (sections 5, 13 and 20).** The pinned offline Wasm build cannot write a natively encrypted OPFS database in the local probe. The chosen fallback is chunk-authenticated AES-256-GCM snapshots, PBKDF2-SHA256 (600k), and memory-only unlocked working/staging data. A plaintext OPFS database can survive a crash even if backups are encrypted, so "delete on lock/close" is insufficient. The spike's plaintext OPFS persistence experiment is restricted to generated synthetic data. This is a local feasibility decision, not CI evidence or a production-vault claim.
10. **3 Nov 2026, chunk 4C-1 — Import Studio limits clarified (section 6A).** Spreadsheets, JSON and XML are parsed whole in the browser, so they are capped at 300,000 rows per sheet (64 MiB); CSV/TSV/TXT stream up to 256 MiB per file. Rebate agreement files are converted but not loaded until the Phase 2 rebate engine, because the Phase 1 data model has no rebate tables. Column alignment is by canonical name until the 4C-2 ERP mapper. Scope, tiers and prices are unchanged.
11. **4 Nov 2026, chunk 4C-2 — lessons from the first real export (sections 2 and 6A).** Testing the real UCI "Online Retail" export (541,909 lines) showed that sales exports often lack line IDs, line totals and cost, use unit prices, and mix in returns. Section 6A now states that: inferred mappings need explicit confirmation; cost may be unknown (never zero); and returns/credits wait in Fix Later until 4D decides how credits enter the waterfall. Section 2's gap now records the real file tested and that the ERP profiles stay unverified. The export also exceeds the 300,000-row spreadsheet cap, so a streaming XLSX reader is recorded as a pilot-hardening (6A) item. Scope, tiers and prices are unchanged.
12. **4 Nov 2026, chunk 4D — credits, unknown cost and the Playground's L2 leak (sections 6A and 6, Playground).**
    - Section 6A now states the credit decision: returns load from Fix Later as signed credit lines, shown as their own "Returns and credits" waterfall step and never counted as leaks. Unknown-cost pocket is shown but left out of margin.
    - The Playground's planted leak L2 changed. C-0042's 25% override equalled tier T11's schedule rate exactly, so no data-only rule could tell it from L5's tier mismatch. It is now 32%, deeper than any tier. The committed manifest was regenerated: L2 is $1,233,201.76 and L4 is $108,243.79 (C-0042 also buys thin SKUs); L1, L3 and L5 are unchanged.
    - Scope, tiers and prices are unchanged.
13. **4 Nov 2026 — product renamed from MarginDesk to RebateHQ (decision 9 and throughout).** An active product already trades as MarginDesk (margindesk.ai), so the name was changed before any launch or marketing. On 4 Nov 2026 `rebatehq.com` was available and a USPTO wordmark search for "RebateHQ" returned no results; neither is legal clearance, so a trademark attorney's check and an early filing are still open. Display text, UI titles, user-visible export file names, docs and workflow names changed. **Left unchanged by this item:** applied migrations and their locked hashes, `schema.sql` (the Phase 1 mirror), and past CI/restore evidence lines, which record runs under the old name. The GitHub repo was renamed to `rebatehq` on 4 Nov 2026 (CI #57 passed on the rename commit) and the links were updated; GitHub redirects the old URLs. The database role, the stored price-list name and browser storage keys are handled in item 14. Scope, tiers and prices are unchanged.
14. **4 Nov 2026 — legacy identifiers renamed (follow-up to item 13).** Migration `20261104120000_rename_app_role_to_rebatehq.sql` renames the `margindesk_app` Postgres role to `rebatehq_app` and the stored price list `MarginDesk file imports` to `RebateHQ file imports`; applied migrations and their locked hashes are unchanged. Restore tooling, the pgTAP suite and the function-ACL registry now use `rebatehq_app`. Browser storage keys were renamed (OPFS `rebatehq-vaults`, IndexedDB `rebatehq-backup-handles`, localStorage `rebatehq-local-v1` and `rebatehq-role`, web-lock `rebatehq-vault-*`). Existing backup-folder settings and prototype data are copied forward once. Chromium cannot rename OPFS directories and copying vaults could mean gigabytes, so a vault saved before the rename is opened in place in the legacy `margindesk-vaults` folder; only new vaults use `rebatehq-vaults`. The migration passed [CI #58](https://github.com/Adityapawar5105/rebatehq/actions/runs/41830575440) and [Restore Drill #14](https://github.com/Adityapawar5105/rebatehq/actions/runs/41844375007) on `251efef` and is now locked in `migrations.lock`; it has not been applied to any hosted database and must ship together with the matching app build. Scope, tiers and prices are unchanged.
15. **5 Nov 2026 — legacy table retirement scheduled (section 17 roadmap; decision 10 unchanged).** The user approved the revised `RETIREMENT_PROPOSAL.md`. 5B switched the server business-data routes off by default but dropped no tables. The 33 legacy business tables are now dropped in two waves, each through a new reviewed migration with CI and a user-run Restore Drill:
    - **6R** (after 6A, before 6B): 21 tables whose local equivalents already exist.
    - **8R** (after 7A, 7B, 7D and 8B): 12 quote, approval, rebate, supplier-credit, alert and FX tables, which have no local equivalent yet.
    - Pure logic (margin engine, rebate tier maths, rep-safe quote projection) is kept for porting. Before each wave, a check confirms that no hosted database holds business rows; on 5 Nov 2026 the user's Supabase account had no projects.
    - Scope, tiers and prices are unchanged; 6R adds roughly 2-4 working days before 6B.
16. **5 Nov 2026, chunk 6A — real and ERP-shaped files (sections 2 and 6A).**
    - Section 2's gap now lists the public exports and the synthetic ERP-shaped files tested in 6A. The ERP profiles stay unverified.
    - Section 6A now lists the export shapes 6A handles, and one money rule: amount columns with more than two decimals are rounded to the cent (half away from zero) with a visible note, while unit prices keep full precision.
    - Engine rule 9's "import by date range" is now implemented as a per-file date range for sales files. A batch with more sales rows than the plan's line cap stops with the cap message before staging, instead of exhausting the 512 MB engine budget.
    - The local vault schema moved to v8 (a headerless file's data starts on row 1).
    - Scope, tiers and prices are unchanged. Header/line joins, item-master cost in the leak finder, streaming reads of spreadsheets over 300,000 rows, and localized header names are parked in `PARKING_LOT.md`.
17. **5 Nov 2026, chunk 6A follow-up — the four parked import gaps built (section 6A).** At the user's request ("do all the open things"), the items parked in item 16 were built and tested on the same pilot files:
    - **Spreadsheet cap.** XLSX/XLSM sheets over 300,000 rows are now read in a stream instead of being refused. The 64 MiB workbook limit stays. XLS, XLSB, ODS, JSON and XML keep the 300,000-row cap. Both Online Retail II sheets (525,461 and 541,910 rows) load from the workbook with the same totals as their CSV copies.
    - **Order headers.** A new "Order headers" file type is joined to its lines file by invoice number. Customer and date are copied; freight is spread over the lines exactly. The Northwind order lines now load and match an independent recomputation to the cent.
    - **Item-list cost.** "Quantity × the item list's current cost" is a cost source the user confirms. It is a stated choice of cost basis per file, so the leak finder can use it; it is not an invoice cost. The QuickBooks-shaped file now finds its 116 planted below-cost lines.
    - **Localized headers.** German, French, Spanish and Dutch header names are recognised. The SAP Business One file maps fully without a recipe.
    - The local vault schema is unchanged (v8). Scope, tiers and prices are unchanged.
18. **5 Nov 2026, chunk 6R — wave 1 of the table retirement (section 17 roadmap; item 15).** The 6R migration drops 22 server tables: the 21 planned and `plan_feature`. Nothing read `plan_feature` after 5B's licence tables, and the plan allowed it to go. Two consequences of the approved plan are recorded here:
    - Wave-2 quote rows keep customer and product IDs that no longer reference a server table until 8R. The foreign keys from `quote` and `quote_line` to customer, product and unit tables are dropped.
    - The legacy quote API routes are retired with wave 1 (fixed 410 responses), because they priced quotes from the dropped product, price-list and cost tables. Quote Desk comes back locally in 7B. The quote tables themselves stay fully tested until 8R.
    - Scope, tiers and prices are unchanged.
19. **5 Nov 2026 — v2.3: experience layer and Phase 2 additions (decisions 14-16; sections 6, 6A, 9, 12-14, 17).** Drafted at the user's request after reviewing an outside feature list and the user's request for about ten languages. Nothing here is built yet.
    - **New chunk 7U (UX foundations)** is inserted after 7A and before 7B, so themes, i18n and the command palette exist before Quote Desk and the later screens. Retrofitting them after every screen exists is the more expensive path. Items that belong to one module ship with it: Price Check and credit signal with 7B, the inline-edit grid, what-if sliders, cost-to-serve leaks, landed check and increase letters with 7C, rebate progress with 7D, purchase price variance with 7E, scorecards, folder re-import and mobile with 7F.
    - **Tier change:** the mobile field-rep PWA moves from Scale to Professional as an online-first thin client; the offline cache stays in Scale. This conflicts with locked decision 5 (Chrome and Edge only) for phones, so decision 15 limits it to the thin client and requires a verification spike (see item 20: now at the start of 9A, not before 7F). To be validated in the first 10 conversations with the other tier limits.
    - **Languages:** infrastructure first, English/Spanish/French shipped, others on pilot demand, no right-to-left in v1 (decision 14). Section 6A mapper synonyms already cover English, German, French, Spanish and Dutch headers.
    - **Narrowed on purpose:** no freight rating engine (actual freight is used), no default leaderboards, no free-text palette commands, no live FX fetch from the browser; rep-facing numbers never reveal cost (decision 16). The import-cost currency buffer joins the Phase 3 cost-index triggers.
    - **New import roles** for Phase 2: Purchases (PO receipts) and AR aging / credit limits.
    - Prices ($299 / $599 / $999) are unchanged; whether the Professional tier can carry mobile support cost is a question for the pilots.
20. **5 Nov 2026 — mobile PWA moved to the very end (decision 15; sections 6, 14, 17).** At the user's instruction, the mobile field-rep PWA is no longer part of 7F. It becomes chunk **9A**, built after Phase 3 and 8R, once every desktop feature is done. The Professional/Scale tier placement and the thin-client scope are unchanged, and the iOS/Android verification spike now opens 9A. Until 9A ships, the tier table row is a plan, not an available feature. Item 19's mention of mobile with 7F is superseded by this item.
21. **6 Nov 2026 — the rep cost toggle is removed in 7B (decision 16).** Chunk 5A added an Owner setting, "Let Sales Reps see cost and margin (off by default)", which contradicts decision 16. At the user's request ("do as you think it would be best"), it is removed at the start of 7B, before Price Check (the first screen built for reps). A stored "on" value in an existing vault is ignored, so no vault schema change is needed. An owner who wants one person to see margins gives that person the Sales Manager role (read-only margins, per person, audited). 7B also adds the decision 16 test: no Sales Rep payload contains cost or margin %.
22. **6 Nov 2026 — section 3 wording follows item 21.** The roles section still said reps see cost "unless the owner allows it". It now says reps never see cost or margin, and a person who needs margins gets the Sales Manager role. No feature or tier changes.
23. **6 Nov 2026 — chunk 7V (UI redesign) added after 7B.** The user judged the current UI not good enough. 7V is a UI-only pass in two parts:
    - **7V-1:** design system, components, app shell and Home. The user reviews screenshots before 7V-2.
    - **7V-2:** every remaining screen.

    It adds no feature, tier, data-model or privacy change. Every later chunk builds its screens on the 7V components. The mobile field-rep PWA (9A) still waits until the user asks for it. Codex prompts for the remaining chunks are in `CODEX_HANDOFF.md`.

24. **8 Nov 2026 — v2.4: multi-currency, Firefox, customer health alerts, competitor log enhancement, dead-stock carrying costs, sync status indicator, supplier claim generator, cash-leak hero number (decisions 5; sections 6, 12, 13).**
    - **Multi-currency (Phase 2):** a workspace display currency plus a user-entered FX rate per import batch. All amounts (margins, leaks, waterfall, quotes) display in the workspace currency. No live exchange-rate fetch from the browser (dropped rule unchanged). Added to Phase 2 feature list and chunk 7C/7D scope.
    - **Firefox officially supported (decision 5):** modern Firefox supports OPFS, SharedArrayBuffer with COOP/COEP, and DuckDB-Wasm reliably. Added to decision 5 and section 12 non-functional requirements. Chrome and Edge remain the primary desktop targets.
    - **Safari desktop verification spike (Phase 3):** OPFS persistence and DuckDB-Wasm multi-threaded mode must be confirmed in a Phase 3 spike before claiming Safari desktop as supported. Added to Phase 3 feature list and section 13 risks. Do not advertise Safari support until the spike passes.
    - **Customer health alerts — pulled to Phase 2 (sections 6, 13):** SQL threshold alerts (margin drop above a configurable threshold, default 5 pp, over a rolling 90-day window; order-frequency drop with deepening discounts) surface as cards on Home and feed the weekly digest. Runs when the app is open — the existing risk note ("alerts only run while the app is open") applies and the UI must say so. These are SQL threshold rules on `agg_cm`, not AI or ML; they are labelled "Customer health alerts" in the product, not "AI monitoring." Pulled forward from the Phase 3 Margin Drain agents; the full background-agent version stays in Phase 3.
    - **Competitor log — suggest alternatives (Phase 2):** when a competitor price is logged on a SKU, the top 3 highest-margin alternatives in the same product category for that customer are shown, ranked by pocket margin. SQL query on price matrix and margin aggregates; no ML. Full "customers like X also buy Y" cross-sell stays in Phase 3.
    - **Supplier claim generator (7D):** the supplier rebate tracker generates a claim-ready CSV/XLSX export so the user can submit directly to the supplier from the app. Added to the 7D (rebates) chunk scope.
    - **Sync status indicator (relay UX):** a last-synced timestamp and synced / pending / conflict status indicator in the relay UI. Not a new feature; a UX requirement added to the 7A relay spec so users understand the local-copy-plus-relay model.
    - **Dead-stock carrying cost inputs (Phase 3):** the dead-stock optimiser gains user-entered carrying-cost parameters (cost of capital % and storage cost per unit per month), showing total capital tied up per SKU in cash terms. Updated in the Phase 3 feature list.
    - **"90-day cash leak" hero number (Home spec):** the Home dashboard prominently shows the exact cash left on the table over the last 90 days from the existing leak finder data, not just a margin percentage. No schema or calculation change; a UX framing requirement on the already-built leak finder (4D). Added as a Home dashboard spec note.
    - Scope, tiers ($299 / $599 / $999) and prices are unchanged.
25. **8 Nov 2026 — where the v2.4 items are built (execution plan section 9).** Item 24 said multi-currency was in "chunk 7C/7D scope", but 7C was already CI-verified without it, and several items had no chunk. They are placed as follows:
    - **New chunk 7C-3**, after 7C-2 and before 7D:
      - **7C-3a:** multi-currency and Firefox support. Multi-currency lands before rebates, which also handle money.
      - **7C-3b:** customer health alerts, competitor log alternatives, the relay sync-status indicator and the 90-day cash-leak hero number.
    - **7D:** the supplier claim generator.
    - **7F:** health alerts in the weekly digest.
    - **8B:** dead-stock carrying costs and substitute SKUs.
    - **8C:** the Safari desktop verification spike.

    No feature, tier or price changes.
