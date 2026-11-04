import type { Engine } from "../vault/engine";
import { VaultError } from "../vault/protocol";
import { sqlText as Q } from "../spike/exact";
import { centsText, dec, rha, rescale } from "../margin/decimal";
import { rhaSql } from "../margin/sql";
import { lineFromCents } from "../margin/engine";
import { PROFILES, type ErpProfile } from "../studio/mapper";
import { csvSafeCell } from "../csv";
import * as XLSX from "xlsx";

export type RuleInput = { id?: string; name: string; category: string; vendor: string; threshold: string; increase: string };
export type GuardInput = { tier: string; category: string; start: string; target: string; floor: string };
export type PriceRow = { product: string; tier: string; before: string; after: string; cost: string | null; quantity: string; impact: string; guard: string; beforeMargin: string | null; afterMargin: string | null };
export type Preview = { id: string; count: string; impact: string; red: string; rows: PriceRow[]; offset: number; explanation: string; status: string; ms: number };
export const MAX_PREVIEW_PAIRS = 250_000;
const today = () => "DATE "+Q(new Date().toISOString().slice(0,10));
const bad = (text: string): never => { throw new VaultError("PRICING", text); };
export function rate(text: string) { if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return bad("Use a percentage from 0 to 100 with at most two decimals."); const bp = rescale(dec(text), 2).v; if (bp > BigInt(10000)) return bad("A percentage cannot exceed 100%."); return bp; }
export function label(value: string) { if (typeof value !== "string" || !value.trim() || value.length > 160 || /[\x00-\x1f]/.test(value)) return bad("Use a name of 1–160 characters without control characters."); return value.trim(); }
export function guardStatus(price: bigint, target: bigint, floor: bigint) { return price < floor ? "red" : price < target ? "yellow" : "green"; }
export function raised(cents: bigint, bp: bigint) { return rha(cents * (BigInt(10000) + bp), BigInt(10000)); }
export const rows = async (e: Engine, sql: string): Promise<Record<string, any>[]> => (await e.conn.query(sql)).toArray().map(r => Object.fromEntries(Object.entries(r)));
export async function pricingState(e: Engine) {
  const settings = (await rows(e, "SELECT * FROM pricing_settings WHERE id=1"))[0];
  return { owner: settings ? { id: String(settings.owner_id), name: String(settings.owner_name), backupDays: Number(settings.backup_days) } : null,
    guards: (await rows(e, 'SELECT tier,category,start::VARCHAR AS start,target::VARCHAR AS target,floor::VARCHAR AS floor FROM price_guardrails WHERE tier IS NOT NULL ORDER BY tier,category')).map(r => r as GuardInput),
    rules: await rows(e, "SELECT r.id,r.name,r.definition,max(v.version)::INTEGER AS version FROM rules r JOIN rule_revisions v ON v.rule_id=r.id GROUP BY r.id,r.name,r.definition ORDER BY r.name"),
    runs: await rows(e, "SELECT id,rule_id,status,affected_rows::VARCHAR AS affected,run_date FROM rule_runs ORDER BY run_date DESC LIMIT 50") };
}
export async function owner(e: Engine, actor: string) { const s = (await rows(e,"SELECT owner_id FROM pricing_settings WHERE id=1"))[0]; if (!s || s.owner_id !== actor) bad("Only the named Pricing Owner can approve or change the owner setting."); }
export function guardSql(g: GuardInput) {
  const tier = label(g.tier), category = label(g.category);
  if (![g.start,g.target,g.floor].every(v => /^(0|[1-9]\d{0,12})$/.test(v))) return bad("Guardrail amounts must be non-negative integer cents.");
  if (BigInt(g.floor) > BigInt(g.target) || BigInt(g.target) > BigInt(g.start)) return bad("Floor must be at or below target, and target at or below start.");
  return `DELETE FROM price_guardrails WHERE tier=${Q(tier)} AND category=${Q(category)}; INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category) VALUES(${Q(crypto.randomUUID())},'unit_price',${g.start},${g.target},${g.floor},${Q(tier)},${Q(category)}); UPDATE vault_meta SET pricing_revision=pricing_revision+1 WHERE id=1;`;
}
export async function ruleSql(e: Engine, input: RuleInput) {
  const r = { name: label(input.name), category: label(input.category), vendor: label(input.vendor), threshold: String(rate(input.threshold)), increase: String(rate(input.increase)) };
  const id = input.id ?? crypto.randomUUID();
  if (input.id && !(await rows(e,`SELECT id FROM rules WHERE id=${Q(id)}`)).length) bad("That rule no longer exists.");
  const version = Number((await rows(e,`SELECT coalesce(max(version),0)+1 AS n FROM rule_revisions WHERE rule_id=${Q(id)}`))[0].n);
  const definition = JSON.stringify(r), explanation = `If the latest ${r.vendor} cost for ${r.category} rises more than ${input.threshold}%, raise ${r.category} prices by ${input.increase}%. Compare the latest two dated costs per product; equal dates use the cost row ID. Only known current prices are changed.`;
  return { id, version, sql: `${input.id ? `UPDATE rules SET name=${Q(r.name)},definition=${Q(definition)},scope=${Q(r.category)} WHERE id=${Q(id)};` : `INSERT INTO rules VALUES(${Q(id)},${Q(r.name)},${Q(definition)},${Q(r.category)},${Q(new Date().toISOString())});`} INSERT INTO rule_revisions VALUES(${Q(id)},${version},${Q(definition)},${Q(explanation)},${Q(new Date().toISOString())});` };
}
/** A bounded temporary price copy. It groups existing invoice aggregates; never copies raw invoice history. */
export async function simulate(e: Engine, id: string) {
  const r = (await rows(e,`SELECT * FROM rule_revisions WHERE rule_id=${Q(id)} ORDER BY version DESC LIMIT 1`))[0]; if (!r) return bad("Save a rule before simulating.");
  const d = JSON.parse(r.definition);
  if (!/^\d{1,5}$/.test(d.increase) || !/^\d{1,5}$/.test(d.threshold)) bad("The saved rule has invalid rates.");
  const run = crypto.randomUUID(), started = performance.now();
  await e.conn.query(`DROP TABLE IF EXISTS temp.md_price_copy;
CREATE TEMP TABLE md_price_copy AS WITH v AS (SELECT product_id,cost,lag(cost) OVER(PARTITION BY product_id ORDER BY effective_date,id) AS previous,row_number() OVER(PARTITION BY product_id ORDER BY effective_date DESC,id DESC) AS rk FROM vendor_costs WHERE vendor=${Q(d.vendor)}),
hist AS (SELECT a.product_id,c.tier,sum(a.quantity)::DECIMAL(18,4) AS qty FROM agg_cpm a JOIN customers c USING(customer_id) WHERE a.line_kind='sale' GROUP BY a.product_id,c.tier),
base AS (SELECT p.product_id,coalesce(h.tier,'') AS tier,p.category,p.current_cost,coalesce((SELECT m.price FROM price_matrix m WHERE m.product_id=p.product_id AND m.customer_id IS NULL AND coalesce(m.tier,'')=coalesce(h.tier,'') AND m.qty_break=0 AND m.valid_from<=${today()} AND (m.valid_to IS NULL OR m.valid_to>${today()}) ORDER BY m.valid_from DESC,m.id LIMIT 1),p.list_price) AS before_cents,coalesce(h.qty,0)::DECIMAL(18,4) AS qty
FROM products p JOIN v USING(product_id) LEFT JOIN hist h USING(product_id) WHERE p.category=${Q(d.category)} AND v.rk=1 AND v.previous>0 AND CAST(v.cost-v.previous AS HUGEINT)*10000>CAST(v.previous AS HUGEINT)*${d.threshold})
SELECT product_id,tier,category,current_cost,before_cents,CAST(${rhaSql(`CAST(before_cents AS HUGEINT)*(10000+${d.increase})`,"10000")} AS BIGINT) AS after_cents,qty FROM base WHERE before_cents IS NOT NULL LIMIT ${MAX_PREVIEW_PAIRS+1}`);
  const count = Number((await rows(e,"SELECT count(*) AS n FROM md_price_copy"))[0].n);
  if (count > MAX_PREVIEW_PAIRS) { await e.conn.query("DROP TABLE md_price_copy"); return bad("This preview exceeds 250,000 SKU/tier pairs. Narrow the rule category before trying again."); }
  return { id: run, count, ms: Math.round(performance.now()-started), sql: `INSERT INTO rule_runs(id,rule_id,run_date,affected_rows,status,rule_version,base_revision) SELECT ${Q(run)},${Q(id)},${Q(new Date().toISOString())},${count},'preview',${Number(r.version)},pricing_revision FROM vault_meta WHERE id=1;
INSERT INTO rule_changes SELECT ${Q(run)},p.product_id,p.tier,p.before_cents,p.after_cents,p.current_cost,p.qty,CAST(${rhaSql("CAST(p.after_cents-p.before_cents AS HUGEINT)*CAST(p.qty*10000 AS HUGEINT)","10000")} AS BIGINT),CASE WHEN g.id IS NULL THEN 'unset' WHEN p.after_cents<g.floor THEN 'red' WHEN p.after_cents<g.target THEN 'yellow' ELSE 'green' END FROM md_price_copy p LEFT JOIN price_guardrails g ON g.tier=p.tier AND g.category=p.category;` };
}
export async function preview(e: Engine, id: string, offset = 0): Promise<Preview> {
  offset = Math.max(0,Math.floor(offset));
  const r = (await rows(e,`SELECT r.status,v.explanation FROM rule_runs r JOIN rule_revisions v ON v.rule_id=r.rule_id AND v.version=r.rule_version WHERE r.id=${Q(id)}`))[0]; if (!r) return bad("The preview no longer exists.");
  const c = (await rows(e,`SELECT count(*)::VARCHAR AS n,coalesce(sum(impact_cents),0)::VARCHAR AS impact,count(*) FILTER(WHERE guard_status='red')::VARCHAR AS red FROM rule_changes WHERE run_id=${Q(id)}`))[0];
  const page = await rows(e,`SELECT product_id,tier,before_cents::VARCHAR AS b,after_cents::VARCHAR AS a,cost_cents::VARCHAR AS c,quantity::VARCHAR AS q,impact_cents::VARCHAR AS i,guard_status AS g FROM rule_changes WHERE run_id=${Q(id)} ORDER BY product_id,tier LIMIT 50 OFFSET ${offset}`);
  const margin = (p: string,c: string|null) => lineFromCents({list:BigInt(p),cost:c===null?null:BigInt(c),discount:BigInt(0),rebate:BigInt(0),freight:BigInt(0)}).margin;
  return { id,status:r.status,explanation:r.explanation,count:c.n,impact:c.impact,red:c.red,offset,ms:0,rows:page.map(p=>({ product:p.product_id,tier:p.tier,before:p.b,after:p.a,cost:p.c,quantity:p.q,impact:p.i,guard:p.g,beforeMargin:p.c===null?null:String(margin(p.b,p.c)),afterMargin:p.c===null?null:String(margin(p.a,p.c)) })) };
}
export async function approveSql(e: Engine, id: string, actor: string) {
  await owner(e,actor);
  const r = (await rows(e,`SELECT r.*,m.pricing_revision AS revision,(SELECT max(version) FROM rule_revisions WHERE rule_id=r.rule_id) AS latest FROM rule_runs r CROSS JOIN vault_meta m WHERE r.id=${Q(id)}`))[0];
  if (!r || r.status!=='preview') return bad("Only an unapproved preview can be approved.");
  if (String(r.revision)!==String(r.base_revision) || Number(r.latest)!==Number(r.rule_version)) return bad("Conflict: data, guardrails or the rule changed since simulation. Review a new simulation; nothing was overwritten.");
  if (String(r.run_date).slice(0,10)!==new Date().toISOString().slice(0,10)) return bad('The preview date changed. Simulate again before approval.');
  const p = await preview(e,id); if (p.count==='0') return bad("No prices changed. Adjust the rule before approval."); if (p.red!=='0') return bad("Red: a proposed price is below its floor. Revise the rule or guardrail before approval.");
  return `INSERT INTO price_versions VALUES(${Q(crypto.randomUUID())},${Q(id)},${Q(actor)},${Q(JSON.stringify({rows:p.count,impact:p.impact,rule:r.rule_id,version:Number(r.rule_version)}))},${Q(new Date().toISOString())});
UPDATE price_matrix SET valid_to=${today()} WHERE customer_id IS NULL AND qty_break=0 AND valid_from<${today()} AND (valid_to IS NULL OR valid_to>${today()}) AND (product_id,coalesce(tier,'')) IN (SELECT product_id,tier FROM rule_changes WHERE run_id=${Q(id)});
DELETE FROM price_matrix WHERE customer_id IS NULL AND qty_break=0 AND valid_from=${today()} AND (product_id,coalesce(tier,'')) IN (SELECT product_id,tier FROM rule_changes WHERE run_id=${Q(id)});
INSERT INTO price_matrix(id,product_id,tier,price,valid_from,valid_to) SELECT ${Q(id)}||':'||row_number() OVER(ORDER BY product_id,tier),product_id,tier,after_cents,${today()},NULL FROM rule_changes WHERE run_id=${Q(id)};
UPDATE rule_runs SET status='approved',approved_by=${Q(actor)} WHERE id=${Q(id)}; UPDATE vault_meta SET pricing_revision=pricing_revision+1 WHERE id=1;`;
}
export const EXPORT_LAYOUTS: Record<ErpProfile,string[]> = { generic:['product_id','tier','price','effective_from'],netsuite:['Item','Price Level','Unit Price','Effective Date'],p21:['Item ID','Pricing Library','Price','Effective Date'],infor:['Item','Price Type','Sales Price','Effective Date'],bc:['Product No.','Source No.','Unit Price','Starting Date'],quickbooks:['Item','Price Level','Custom Price','Effective Date'] };
export async function exportPrices(e: Engine, id: string, profile: ErpProfile, format: 'csv'|'xlsx') {
  if (!EXPORT_LAYOUTS[profile] || !['csv','xlsx'].includes(format)) return bad("Choose a supported ERP profile and CSV or XLSX.");
  const run = (await rows(e,`SELECT status,run_date,approved_by FROM rule_runs WHERE id=${Q(id)}`))[0]; if (!run || !['approved','exported'].includes(run.status)) return bad("The Pricing Owner must approve this run before export.");
  const data = await rows(e,`SELECT product_id,tier,before_cents::VARCHAR AS b,after_cents::VARCHAR AS a,guard_status FROM rule_changes WHERE run_id=${Q(id)} ORDER BY product_id,tier`);
  const clean = (v: unknown) => csvSafeCell(String(v));
  const table = [EXPORT_LAYOUTS[profile],...data.map(r=>[r.product_id,r.tier,centsText(BigInt(r.a)),run.run_date.slice(0,10)].map(clean))];
  const csv = (t:string[][])=>t.map(r=>r.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\r\n');
  let blob: Blob;
  if(format==='xlsx'){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(table),'Prices');blob=new Blob([XLSX.write(wb,{type:'array',bookType:'xlsx'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});}
  else blob=new Blob(['\ufeff'+csv(table)],{type:'text/csv;charset=utf-8'});
  const log=[['SKU','Tier','Before','After','Guardrail','Pricing Owner','Run'],...data.map(r=>[r.product_id,r.tier,centsText(BigInt(r.b)),centsText(BigInt(r.a)),r.guard_status,run.approved_by,id].map(clean))];
  return {name:`margindesk-${profile}-prices.${format}`,blob,logName:'margindesk-change-log.csv',log:new Blob(['\ufeff'+csv(log)],{type:'text/csv;charset=utf-8'}),warning:`${PROFILES[profile].label}: unverified until tested on a real import.`};
}
