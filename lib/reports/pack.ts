import type {Engine} from '../vault/engine';
import type {Progress} from '../studio/studio';
import {rows} from '../pricing/rules';
import {sqlText as Q} from '../spike/exact';
import {findLeaks} from '../margin/leaks';
import {bridge} from '../margin/bridge';
import {customerHealth} from '../margin/monitor';
import {exceptions,expiry} from '../pricing/ops';
import {reconciliation} from '../rebate/store';
import {workspaceCurrency} from '../vault/currency';
import {summary as roi} from './roi';
import {VaultError} from '../vault/protocol';
import {msg} from '../i18n/core';
export type PackKind='monthly'|'weekly';
export const cancelled=()=>new VaultError('CANCELLED',msg('cadence.cancelled'));
export function windowFor(kind:PackKind,month?:string,today=new Date().toISOString().slice(0,10)){
 if(!['monthly','weekly'].includes(kind)||!/^\d{4}-\d\d-\d\d$/.test(today))throw new VaultError('REPORT',msg('cadence.invalid'));
 if(kind==='weekly'){const d=Date.parse(today+'T00:00:00Z');return {from:new Date(d-6*86400000).toISOString().slice(0,10),to:new Date(d+86400000).toISOString().slice(0,10),month:today.slice(0,7)};}
 month??=today.slice(0,7);if(!/^(19|20)\d\d-(0[1-9]|1[0-2])$/.test(month))throw new VaultError('REPORT',msg('cadence.invalid'));
 return {from:month+'-01',to:new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10),month};
}
export async function state(e:Engine){return {currency:await workspaceCurrency(e),checks:await rows(e,'SELECT kind,checked_at,period_start::VARCHAR period_start,period_end::VARCHAR period_end FROM report_checks ORDER BY kind'),months:(await rows(e,"SELECT DISTINCT strftime(sale_date,'%Y-%m') AS month FROM sales_lines ORDER BY month DESC LIMIT 60")).map(r=>r.month)};}
/** No persistent writes here: completion/cancel is decided by the service before stamping a check. */
export async function check(e:Engine,kind:PackKind,month:string|undefined,signal:AbortSignal,progress:Progress,today=new Date().toISOString().slice(0,10)){
 const window=windowFor(kind,month,today),id=crypto.randomUUID();let done=0;
 const step=(part:Parameters<typeof msg>[0])=>{if(signal.aborted)throw cancelled();progress(msg('cadence.progress',{part:msg(part)}),String(done++),'7');};
 step('cadence.leaks');const size=(await rows(e,'SELECT count(*)::VARCHAR n FROM sales_lines'))[0].n;if(BigInt(size)>BigInt(2000000))throw new VaultError('REPORT',msg('cadence.tooLarge'));
 const leaks=await findLeaks(e,true,window);
 step('cadence.bridge');const change=kind==='monthly'?await bridge(e,{month:window.month}):null;
 step('cadence.exceptions');const exception=await exceptions(e,{from:window.from,to:window.to});
 step('cadence.contracts');const contracts=await expiry(e,90,today);
 step('cadence.rebates');const rebates=await reconciliation(e),claims=(await rows(e,`SELECT count(*) FILTER(WHERE status<>'cancelled')::VARCHAR cases,coalesce(sum(CAST(amount_claimed AS HUGEINT)) FILTER(WHERE status IN ('prepared','submitted','approved')),0)::VARCHAR unpaid,coalesce(sum(CAST(amount_claimed AS HUGEINT)) FILTER(WHERE status='paid'),0)::VARCHAR paid FROM supplier_claims`))[0];
 step('cadence.health');const health=kind==='weekly'?await customerHealth(e,'500',today):null;
 step('cadence.roi');const recovery=await roi(e),currency=await workspaceCurrency(e),meta=(await rows(e,`SELECT count(*)::VARCHAR lines FROM sales_lines WHERE sale_date>=DATE ${Q(window.from)} AND sale_date<DATE ${Q(window.to)}`))[0];
 if(signal.aborted)throw cancelled();const checkedAt=new Date().toISOString(),revision=(await rows(e,'SELECT pricing_revision::VARCHAR n FROM vault_meta WHERE id=1'))[0].n;
 return {id,kind,window,currency,checkedAt,asOf:today,lines:meta.lines,leaks:{...leaks,findings:leaks.findings.slice(0,10),findingCount:String(leaks.findings.length)},bridge:change?.totals??null,exceptions:{count:String(exception.total.count),gap:String(exception.total.gap),rows:exception.rows.slice(0,10)},contracts:{count:contracts.count,rows:contracts.rows.slice(0,10)},rebates,claims,health:health?{...health,alerts:health.alerts.slice(0,10)}:null,roi:recovery,stamp:`INSERT INTO report_checks(kind,checked_at,period_start,period_end,revision) VALUES(${Q(kind)},${Q(checkedAt)},DATE ${Q(window.from)},DATE ${Q(window.to)},${revision}) ON CONFLICT(kind) DO UPDATE SET checked_at=excluded.checked_at,period_start=excluded.period_start,period_end=excluded.period_end,revision=excluded.revision;`};
}
export type Pack=Omit<Awaited<ReturnType<typeof check>>,'stamp'>;
