// Playground: a deterministic, fictional "Industrial Valve & Pipe Distributor" with
// planted margin leaks. Pure generator (seeded PRNG, integer cents); the manifest's
// dollar values are exact sums over the generated rows, for the 4D leak finder.
export const PLAYGROUND_PREFIX = "Playground - ";
/**
 * Which files the vault holds (20 Nov 2026, first-run activation): "empty" (no imported file), "only" (only the
 * Playground's sample files), "mixed" (sample files next to real ones) or "none" (real files only). The screens use
 * it for the Home start card, the sample-data banner and the "Sample data" badge. It carries no business data.
 */
export type SampleState = "empty" | "none" | "only" | "mixed";
export const sampleState = (sample: number, real: number): SampleState => sample && real ? "mixed" : sample ? "only" : real ? "none" : "empty";
export const SAMPLE_COUNTS_SQL = `SELECT count(*) FILTER (WHERE starts_with(name, '${PLAYGROUND_PREFIX}'))::VARCHAR AS sample, count(*) FILTER (WHERE NOT starts_with(name, '${PLAYGROUND_PREFIX}'))::VARCHAR AS real FROM source_files`;
export type PlantedLeak = { id: string; type: "below_floor" | "discount_outlier" | "unrecovered_freight" | "negative_margin" | "below_lower_tier"; description: string; lines: number; cents: string; dollars: string };
export type PlaygroundManifest = { seed: number; skus: number; customers: number; tiers: number; lines: number; months: string; leaks: PlantedLeak[] };
const SEED = 20261104, SKUS = 5000, CUSTOMERS = 400, TIERS = 50, LINES = 120_000;
const CATEGORIES: Array<[string, string, number, number]> = [["Valves", "EA", 8000, 60000], ["Fittings", "EA", 300, 3000], ["Pipe", "FT", 200, 1500], ["Flanges", "EA", 2000, 15000], ["Gaskets", "EA", 100, 1500], ["Fasteners", "BX", 500, 4000], ["Pumps", "EA", 50000, 400000], ["Instrumentation", "EA", 10000, 90000]];
const BRANCHES: Array<[string, string]> = [["North", "Great Lakes"], ["South", "Gulf Coast"], ["West", "Pacific"]];
function prng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const money = (c: number) => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`;
const pad = (n: number, w: number) => String(n).padStart(w, "0");
/** Tier discount in basis points: T01 = 30.00% off list ... T50 = 5.50%. */
export const tierDiscountBp = (tier: number) => 3000 - (tier - 1) * 50;
const pct = (cents: number, bp: number) => Math.round(cents * bp / 10000);
export function generatePlayground() {
  const r = prng(SEED), sku = (i: number) => `P-${pad(i, 5)}`, cust = (i: number) => `C-${pad(i, 4)}`;
  const products = Array.from({ length: SKUS }, (_, k) => {
    const i = k + 1, [category, uom, lo, hi] = CATEGORIES[k % CATEGORIES.length], list = Math.round(lo + r() * (hi - lo));
    return { id: sku(i), category, uom, list, cost: Math.round(list * (0.58 + r() * 0.14)), description: `${category.replace(/s$/, "")} ${uom === "FT" ? "run" : "unit"} ${pad(i, 5)}` };
  });
  // L4: twenty Valves SKUs priced on thin margin whose supplier cost rises 12% on 2025-11-01.
  const thin = new Set(products.filter((p, k) => p.category === "Valves" && k >= 1000).slice(0, 20).map(p => p.id));
  for (const p of products) if (thin.has(p.id)) p.cost = Math.round(p.list * (1 - tierDiscountBp(25) / 10000) * 0.92);
  const customers = Array.from({ length: CUSTOMERS }, (_, k) => { const i = k + 1, [branch, region] = BRANCHES[k % 3]; return { id: cust(i), tier: ((i * 7) % TIERS) + 1, branch, region, terms: i % 4 === 0 ? "Net 45" : "Net 30" }; });
  const byId = new Map(customers.map(c => [c.id, c]));
  byId.get("C-0123")!.tier = 40; // L5: assigned T40 but billed at T05
  const leak = { below_floor: [0, 0], discount_outlier: [0, 0], unrecovered_freight: [0, 0], negative_margin: [0, 0], below_lower_tier: [0, 0] } as Record<PlantedLeak["type"], [number, number]>;
  const months: string[] = []; for (let m = 0; m < 24; m++) { const y = 2024 + Math.floor((10 + m) / 12), mo = ((10 + m) % 12) + 1; months.push(`${y}-${pad(mo, 2)}`); }
  const sales = ["line_id,invoice_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount"];
  let invoice = 100000, left = 0, invCustomer = customers[0], invDate = "";
  for (let line = 1; line <= LINES; line++) {
    if (left === 0) { invoice++; left = 1 + Math.floor(r() * 7); invCustomer = customers[Math.floor(r() * r() * CUSTOMERS)]; const month = months[Math.floor(line / LINES * 24)]; invDate = `${month}-${pad(1 + Math.floor(r() * 28), 2)}`; }
    left--;
    const p = products[Math.floor(r() * SKUS)], c = invCustomer;
    const qty = p.uom === "FT" ? 10 + Math.floor(r() * 390) : 1 + Math.floor(r() * 40);
    const list = p.list * qty, tierBp = tierDiscountBp(c.tier);
    let discount = pct(list, tierBp);
    if (c.id === "C-0007" && p.category === "Valves") { const extra = pct(list, 1800); discount += extra; leak.below_floor[0]++; leak.below_floor[1] += extra; }
    // L2 (revised in 4D): 32% sits off the tier schedule (T01 = 30% is the deepest), so it is an outlier,
    // not a better tier's rate. At 25% it equalled T11's rate exactly and could not be told apart from L5.
    if (c.id === "C-0042") { const want = pct(list, 3200); if (want > discount) { leak.discount_outlier[0]++; leak.discount_outlier[1] += want - discount; discount = want; } }
    if (c.id === "C-0123") { const billed = pct(list, tierDiscountBp(5)); leak.below_lower_tier[0]++; leak.below_lower_tier[1] += billed - discount; discount = billed; }
    let freight = pct(list, 200);
    if (list < 10000) { freight = 1500; leak.unrecovered_freight[0]++; leak.unrecovered_freight[1] += freight; }
    const rebate = c.tier <= 10 ? pct(list, 100) : 0;
    const raised = thin.has(p.id) && invDate >= "2025-11-01", unitCost = raised ? Math.round(p.cost * 1.12) : p.cost, cost = unitCost * qty;
    if (raised) { const loss = cost - (list - discount - freight - rebate); if (loss > 0) { leak.negative_margin[0]++; leak.negative_margin[1] += loss; } }
    sales.push(`${line},INV-${invoice},${p.id},${c.id},${invDate},${qty},${money(list)},${money(discount)},${money(freight)},${money(rebate)},${money(cost)}`);
  }
  const items = ["product_id,description,category,uom,current_cost,list_price", ...products.map(p => `${p.id},${p.description},${p.category},${p.uom},${money(p.cost)},${money(p.list)}`)];
  const custs = ["customer_id,name,tier,branch,region,payment_terms", ...customers.map(c => `${c.id},Customer ${c.id.slice(2)} Supply,T${pad(c.tier, 2)},${c.branch},${c.region},${c.terms}`)];
  const vendors = ["vendor,product_id,cost,effective_date", ...products.map(p => `${p.category} Mills,${p.id},${money(p.cost)},2024-11-01`), ...products.filter(p => thin.has(p.id)).map(p => `${p.category} Mills,${p.id},${money(Math.round(p.cost * 1.12))},2025-11-01`)];
  const prices = ["product_id,customer_id,tier,price,valid_from,valid_to", ...products.slice(0, 200).map((p, k) => `${p.id},${cust(k + 1)},,${money(p.list - pct(p.list, tierDiscountBp(byId.get(cust(k + 1))!.tier) + 200))},2025-01-01,2026-12-31`)];
  const describe: Record<PlantedLeak["type"], string> = {
    below_floor: "C-0007 gets an extra 18 points of discount on every Valves line, below its tier floor.",
    discount_outlier: "C-0042 is discounted 32% on everything: far above its tier's peers and deeper than any tier's schedule.",
    unrecovered_freight: "Lines under $100 list carry a flat $15.00 freight that is never billed back.",
    negative_margin: "Twenty thin-margin Valves SKUs keep their price after a 12% supplier cost rise on 2025-11-01.",
    below_lower_tier: "C-0123 is assigned tier T40 but billed at the T05 discount.",
  };
  const manifest: PlaygroundManifest = { seed: SEED, skus: SKUS, customers: CUSTOMERS, tiers: TIERS, lines: LINES, months: `${months[0]} to ${months[23]}`,
    leaks: (Object.keys(leak) as PlantedLeak["type"][]).map((type, k) => ({ id: `L${k + 1}`, type, description: describe[type], lines: leak[type][0], cents: String(leak[type][1]), dollars: money(leak[type][1]) })) };
  const files = [
    { name: `${PLAYGROUND_PREFIX}item master.csv`, text: items.join("\n") + "\n" },
    { name: `${PLAYGROUND_PREFIX}customers.csv`, text: custs.join("\n") + "\n" },
    { name: `${PLAYGROUND_PREFIX}vendor costs.csv`, text: vendors.join("\n") + "\n" },
    { name: `${PLAYGROUND_PREFIX}price list.csv`, text: prices.join("\n") + "\n" },
    { name: `${PLAYGROUND_PREFIX}sales history ${months[0]} to ${months[23]}.csv`, text: sales.join("\n") + "\n" },
  ];
  return { files, manifest };
}
