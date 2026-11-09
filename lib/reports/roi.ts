// Operator-attested recovery. Exported/projected uplift is never treated as cash recovery.
import type {Engine} from '../vault/engine';
import {roiSummary} from '../margin/roi';
import {rows} from '../pricing/rules';
import {sqlText as Q,minorUnits,validDate} from '../spike/exact';
import {gridPage,gridQuery} from '../grid/sql';
import type {GridSpec} from '../grid/core';
import {VaultError} from '../vault/protocol';
import {msg} from '../i18n/core';
export type RecoveryInput={ledger:string;run:string;amount:string;reference:string;from:string;to:string;confirmed:boolean};
const bad=():never=>{throw new VaultError('ROI',msg('cadence.recoveryInvalid'));};
export async function summary(e:Engine){
 const found=await roiSummary(e),r=(await rows(e,`SELECT coalesce(sum(recovered_cents),0)::VARCHAR recovered FROM roi_ledger WHERE NOT coalesce(sample,false)`))[0];
 const linked=(await rows(e,`SELECT coalesce(sum(CAST(r.amount_cents AS HUGEINT)),0)::VARCHAR amount,count(*)::VARCHAR n FROM roi_recoveries r JOIN roi_ledger l ON l.id=r.ledger_id WHERE r.voided_at IS NULL AND NOT coalesce(l.sample,false)`))[0];
 const runs=(await rows(e,`SELECT count(*)::VARCHAR total,count(*) FILTER(WHERE status='preview')::VARCHAR preview,count(*) FILTER(WHERE status='approved')::VARCHAR approved,count(*) FILTER(WHERE status='exported')::VARCHAR exported FROM rule_runs`))[0];
 const unlinked=String(BigInt(r.recovered)-BigInt(linked.amount));
 return {...found,recoveredCents:r.recovered,linkedCents:linked.amount,unlinkedCents:unlinked,consistent:BigInt(unlinked)>=BigInt(0),recoveries:linked.n,runs:{total:runs.total,preview:runs.preview,approved:runs.approved,exported:runs.exported}};
}
export const SPECS:Record<'findings'|'runs'|'recoveries',GridSpec>={
 findings:{id:'text',leak_id:'text',identified_cents:'money',recovered_cents:'money',updated_at:'date'},
 runs:{id:'text',status:'text',run_date:'date',affected_rows:'int'},
 recoveries:{id:'text',evidence_ref:'text',ledger_id:'text',run_id:'text',amount_cents:'money',period_start:'date',period_end:'date',recorded_at:'date',voided_at:'date'}
};
export type RoiKind=keyof typeof SPECS;
export async function page(e:Engine,kind:RoiKind,offset=0,grid?:unknown){
 if(!Object.hasOwn(SPECS,kind))bad();const spec=SPECS[kind];
 const base=kind==='findings'?`SELECT id,leak_id,identified_cents::VARCHAR identified_cents,recovered_cents::VARCHAR recovered_cents,coalesce(updated_at,recorded_at) updated_at FROM roi_ledger WHERE NOT coalesce(sample,false)`:
 kind==='runs'?`SELECT id,status,run_date,affected_rows::VARCHAR affected_rows FROM rule_runs`:
 `SELECT r.id,r.evidence_ref,r.ledger_id,r.run_id,r.amount_cents::VARCHAR amount_cents,r.period_start::VARCHAR period_start,r.period_end::VARCHAR period_end,r.recorded_at,r.voided_at FROM roi_recoveries r JOIN roi_ledger l ON l.id=r.ledger_id WHERE NOT coalesce(l.sample,false)`;
 return {...await gridPage(e,base,spec,gridQuery(spec,grid),{offset,limit:50,fallback:'g.id'}),offset,kind};
}
const id=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=200&&!/[\x00-\x1f\x7f]/.test(v)?v:bad();
export async function recordSql(e:Engine,i:RecoveryInput,actor:string){
 let amount:string;try{if(i.confirmed!==true)bad();validDate(i.from);validDate(i.to);if(i.from>i.to)bad();amount=String(minorUnits(i.amount));if(BigInt(amount)<=BigInt(0))bad();}catch{return bad();}
 const ledger=id(i.ledger),run=id(i.run),ref=id(i.reference).trim();if(!ref||ref.length>100)bad();
 if(!(await rows(e,`SELECT id FROM roi_ledger WHERE id=${Q(ledger)} AND NOT coalesce(sample,false)`)).length||!(await rows(e,`SELECT id FROM rule_runs WHERE id=${Q(run)} AND status='exported'`)).length||(await rows(e,`SELECT id FROM roi_recoveries WHERE evidence_ref=${Q(ref)}`)).length)bad();
 const key=crypto.randomUUID(),at=new Date().toISOString();
 return {id:key,sql:`INSERT INTO roi_recoveries(id,ledger_id,run_id,amount_cents,evidence_ref,period_start,period_end,recorded_by,recorded_at) VALUES(${Q(key)},${Q(ledger)},${Q(run)},${amount},${Q(ref)},DATE ${Q(i.from)},DATE ${Q(i.to)},${Q(actor)},${Q(at)});UPDATE roi_ledger SET recovered_cents=recovered_cents+${amount} WHERE id=${Q(ledger)};`};
}
export async function voidSql(e:Engine,key:string,actor:string){
 const r=(await rows(e,`SELECT r.ledger_id,r.amount_cents::VARCHAR amount,l.recovered_cents::VARCHAR recovered FROM roi_recoveries r JOIN roi_ledger l ON l.id=r.ledger_id WHERE r.id=${Q(id(key))} AND r.voided_at IS NULL AND NOT coalesce(l.sample,false)`))[0];if(!r||BigInt(r.recovered)<BigInt(r.amount))bad();
 return `UPDATE roi_ledger SET recovered_cents=recovered_cents-${r.amount} WHERE id=${Q(r.ledger_id)};UPDATE roi_recoveries SET voided_by=${Q(actor)},voided_at=${Q(new Date().toISOString())} WHERE id=${Q(key)};`;
}
