# Opt-in anonymous benchmarks: design (chunk 8D)

**Status: approved by the user on 11 November 2026**, with one change before build: publishing uses 5-point ranges (section 3). Blueprint v2.6 governs: Phase 3 lists "Opt-in anonymous benchmarks (aggregates only, explicit consent)", section 20 question 5 asks whether to do this "given the privacy wording it needs", and decision 11 (privacy gate before any privacy claim) applies.

## 1. What the user gets

On a new **Benchmarks** screen, an opted-in workspace sees how its margins compare with anonymous peers in the same product family and size band. Each metric is shown as the peer 25th percentile, median and 75th percentile, next to the workspace's own value.

> Example: Electrical, mid-size distributors, Q3 2026: pocket margin median 20–24%, middle half 15–29%; yours 22%.

## 2. What is computed locally

Everything below is computed in the vault worker from the vault's own data. Only the **bands** in section 3 leave the device.

**Period.** The last complete calendar quarter. Contribution is one record set per workspace per quarter.

**Product family.** RebateHQ categories are the customer's own free text, so they are not comparable across companies. The Owner maps each local category to one of **12 standard families** once, on this device:

- electrical
- plumbing
- hvac
- industrial_mro
- fasteners
- safety
- janitorial
- packaging
- building_materials
- foodservice
- medical
- other

The mapping is stored in the vault and never sent. Unmapped categories are not counted.

**Metrics per family**, using the existing 4D waterfall definitions and exact integer arithmetic:

| Metric | Definition |
| --- | --- |
| `pocket_margin` | pocket margin ÷ pocket revenue, costed sale lines only |
| `discount_rate` | discounts ÷ list amount |
| `rebate_rate` | rebates ÷ list amount |
| `freight_rate` | freight ÷ pocket revenue |

**Minimum data per family.** A family is contributed only if, in that quarter, it has:
- at least **200 sale lines**;
- at least **20 distinct customers**;
- no single customer above **25% of the family's revenue**.

Below that, the family is skipped and the screen says why. This stops a band from describing one customer's deal.

**Size band.** One per workspace, from total quarterly pocket revenue:

| Band | Quarterly revenue |
| --- | --- |
| S1 | under $1M |
| S2 | $1M–5M |
| S3 | $5M–20M |
| S4 | over $20M |

Revenue in other currencies is converted with the workspace's own stored rates. The size band is the only size signal that is sent.

## 3. Rounding and noise

**Bands, not values.**
- Each rate is rounded down to a whole percentage-point band and clipped to −20…80 (for example, 22.7% → band 22). Exact values never leave the device.
- The size band is one of four codes.
- Customer, SKU, category name, revenue, line count, workspace name, user and location are never sent.

**k-anonymity.** The server publishes a family × size band × metric cell only when at least **k = 10** distinct workspaces contributed to it that quarter. Smaller cells show "not enough peers yet". Cells are not merged automatically, so a thin market never collapses into a group of one.

**Publishing in 5-point ranges (decided 11 November 2026).** The device still sends 1-point bands. Before adding noise, the server groups them into 21 ranges of 5 points: −20 to −16, −15 to −11, … 75 to 79, and 80. It publishes each percentile as a range, for example 20–24%.

A simulation of the first design (1-point bins, k = 10, ε = 1) showed a typical median error of 3 points, and 1 cell in 10 off by 12 points or more. With 5-point ranges the typical error is 2 points and 1 cell in 10 is off by 6 or more. The user chose 5-point ranges with k = 10 over k = 25 (more accurate, but needs far more peers) and over dropping the noise.

**Noise (differential privacy).**
- The server builds each cell's histogram over the 21 ranges and adds Laplace noise with scale 1/ε to every range. ε = 1 per cell per quarter.
- Ranges are clamped at 0. The 25th, 50th and 75th percentiles are the ranges in which the noisy cumulative count first reaches 25%, 50% and 75% of the noisy total.
- If the noisy total falls under 10, the cell is suppressed.
- Each workspace adds at most 1 to one range per cell, so the per-cell sensitivity is 1.

**Release once.** Each quarter's figures are computed once, when a quarter closes 45 days after quarter end, and then frozen. Repeated queries return the same noisy release, so averaging cannot strip the noise. Late contributions do not change a released quarter.

## 4. Consent: given, shown, withdrawn

- **Who:** only the workspace **Owner** role can opt in or out. It is off by default.
- **Where it applies:** Professional and Scale only (a proposal; see open decision 2).
- **Opting in:** a dialog in plain language (en, es, fr) states:
  - what is sent;
  - what is never sent;
  - k = 10, the noise, and the 45-day release;
  - that published figures cannot be recalled;
  - how to withdraw.

  The Owner ticks a box and confirms. The consent text has a version number.
- **Every send is explicit.** Each quarter the Owner presses **"Review and share Q3 2026"**. It shows the exact JSON payload that will be sent, and nothing is sent until they confirm. There is no background or automatic sending, no service-worker sync, and no request from any vault screen on its own (the 8A rule).
- **Give to get:** a workspace can view a quarter's peer figures only after sharing that quarter (a proposal; see open decision 3). Viewing is a separate click and also sends nothing about the workspace.
- **Withdrawing:**
  - "Stop sharing" stops future sends.
  - "Delete my contributions" asks the server to delete every stored contribution from this workspace.
  - Figures already released are aggregates and stay; the dialog says so before consent.
- **Recording:**
  - Locally: every consent, share and withdrawal is a hash-chained audit entry (codes only) and appears in the 8C audit pack.
  - On the server: the consent row in section 5.

## 5. What the server stores

There is one new Supabase migration. Business data stays off the server; these are aggregates the Owner chose to share.

> **As built (`20261111120000_chunk8d_benchmarks.sql`, locked; review R1, 26 Nov 2026).** The plan below differs from the migration. As built:
> - **Tables:** `public.bench_consent` keyed by `tenant_id` (not `workspace_id`), and `rebatehq_private.bench_submission`, `bench_contribution`, `bench_release` and `bench_release_log`. The names are singular.
> - **Release:** done by `bench_publish(text, numeric, integer)`, granted only to the migration owner. Reading the figures is `bench_figures`. There is no `bench_release(quarter)` function.

| Table | Columns | Who can read |
| --- | --- | --- |
| `bench_consent` | `workspace_id`, `opted_in`, `consent_version`, `decided_by` (user ID), `decided_at` | the workspace's Owner (RLS) |
| `bench_contributions` | `pseudonym`, `quarter`, `size_band`, `family`, `metric`, `band`, `received_at`; **no workspace ID** | nobody through the API (insert and delete only through RPCs) |
| `bench_releases` | `quarter`, `size_band`, `family`, `metric`, `p25`, `p50`, `p75` (each the lower edge of a 5-point range), `epsilon`, `released_at` | opted-in workspaces that contributed that quarter |

- **Pseudonym** = HMAC-SHA256(server-only key, workspace ID ‖ quarter). The database never stores which workspace sent a contribution. The key lives in the server environment, never in the database or the client, so a database leak alone cannot link a contribution to a workspace. The operator, holding the key, could re-link; this is stated in the threat model and in the consent text.
- **RPCs:**
  - `bench_submit(payload)`: checks the caller is the Owner with current consent and validates the payload strictly (section 6). It replaces any earlier submission for the same pseudonym and quarter, so there is one record set per workspace per quarter, and limits submissions to 5 a day.
  - `bench_withdraw()`: deletes rows for every quarter's pseudonym.
  - `bench_release(quarter)`: service role only; does the k check, noise and freeze.
- **Verification:** pgTAP for RLS, the RPC validation, k suppression and withdrawal, plus a Restore Drill (user-run), following MIGRATION_RULES.md. The migration was locked after CI #146 and Restore Drill #20 (it stayed pending until CI and the drill passed).
- **No raw values** are ever stored. The server sees the payload, the authenticated user and the IP address at request time, like every control-plane request. IPs are not stored by the app.

## 6. The only payload ever sent

```json
{ "v": 1, "quarter": "2026-Q3", "sizeBand": "S2",
  "rows": [ { "family": "electrical", "metric": "pocket_margin", "band": 22 },
            { "family": "electrical", "metric": "discount_rate", "band": 11 } ] }
```

- **Allowed keys:** exactly these. `family` and `metric` come from the fixed lists, `band` is an integer from −20 to 80, and there are at most 48 rows (12 families × 4 metrics).
- **Validation:** both the client and the server check the payload against this schema. Anything else is refused.

## 7. Privacy gate extension (tests)

**Browser gate (Chromium and Firefox):**
1. With consent off, a full session including the Benchmarks screen makes **no** request to `/api/bench*`.
2. After opt-in, nothing is sent until "Review and share" is confirmed. Then exactly one request is sent, and its body matches the section 6 schema exactly. The marker sensor confirms no fixture marker (customer, SKU or category name) appears in any request.
3. Viewing figures sends no workspace data.
4. Withdrawal removes the server rows (pgTAP and the relay-style local transport).

**Unit tests:**
- band rounding and clipping;
- the family minimums;
- the size band;
- payload schema property tests: random vault data never produces a key or value outside the schema;
- the noise and k suppression (deterministic seed);
- decision 16: a Sales Rep can reach no benchmark command; the Benchmarks screen is Owner and cost roles only.

## 8. Threat model

| Threat | Mitigation | What remains |
| --- | --- | --- |
| Curious operator or a database leak | Bands only; pseudonymous rows; HMAC key outside the database | The operator with the key can learn a workspace's bands. This is stated in the consent text. |
| Another tenant tries to learn a competitor's margin | k = 10, Laplace noise, release once, give to get, family minimums | In a thin market the cell is simply never published |
| Re-identification from the size band plus family (a famous large distributor) | Only 4 size bands; k = 10 per cell; suppression | Workspaces that are unique in their market get no published cell |
| Poisoning (fake extreme values) | One submission per workspace per quarter; bands clipped; percentiles rather than means; licence-checked Owners only | A coordinated set of real paying workspaces could shift a cell slightly |
| Accidental leak of other data in the payload | Strict schema on client and server; privacy gate on the exact body; marker sensor | none known |
| Consent drift (sending without a fresh decision) | Explicit per-quarter send; consent version; audit entries | none known |
| Traffic analysis (whether a workspace shares at all) | none | The operator knows who opted in (the consent row). This is stated. |

## 9. Product wording

- **Never, while benchmarks are on:** "Your data never leaves your device".
- **Instead:** "Your pricing data stays on your device. If your Owner turns on benchmarks, only rounded margin bands are shared, anonymously, and only when they press Share."
- **Gap 3, the privacy claim:** remains your decision.

## 10. Out of scope for 8D

- Benchmarks by region, customer tier or SKU.
- Automatic sharing.
- Sharing with third parties.
- Monetising the data.
- A public benchmark report.

Each of these would need a new design and approval.

## 11. Safari desktop spike (also 8D, per blueprint v2.6 gap 5)

**What the spike checks in real Safari desktop:**
- OPFS persistence: create, lock, quit and reopen a vault;
- DuckDB-Wasm threading under COOP/COEP;
- a 100k-line import;
- the offline copy (8C-2).

**How it would run:**
- I add a spike checklist and script.
- This Windows machine has no Safari. Playwright's WebKit build is not Safari and may lack OPFS features, so it can only be a pre-check.
- The real results must come from a Mac (see open decision 4).

**Until then:** nothing is claimed or advertised.

## 12. Open decisions for you

1. **Approve this design.** Approved 11 November 2026, with 5-point publishing ranges (section 3). In particular:
   - k = 10;
   - ε = 1 per cell per quarter;
   - 1-point bands;
   - the 12 families;
   - 4 size bands;
   - the family minimums (200 lines, 20 customers, at most 25% from one customer).
2. **Tier:** Professional and Scale only. Decided.
3. **Give to get:** yes; only contributors see a quarter's figures. Decided.
4. **Safari spike:** no Mac is available for now, so 8D records WebKit pre-check results only, and Safari stays unclaimed. Decided.
