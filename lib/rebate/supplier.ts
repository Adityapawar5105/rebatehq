// Local supplier claims. Explicit terms and lifecycle; no accounting posting or remote submission.
import type {Engine} from '../vault/engine';
import {sqlText as Q,minorUnits,validDate} from '../spike/exact';
import {rows} from '../pricing/rules';
import {centsText} from '../margin/decimal';
import {workspaceCurrency} from '../vault/currency';
import {digest} from '../vault/crypto';
import {VaultError} from '../vault/protocol';
import {msg} from '../i18n/core';
import {accrueCents,type Agreement} from './engine';
import {nearMiss,nearSummary,type NearMiss} from './nearmiss';
import {businessToday} from '../vault/today';
import {skuList} from './store';
import {gridPage,gridQuery,memoryPage} from '../grid/sql';
import type {GridSpec,ClientColumn} from '../grid/core';
export {hasSupplier} from './input';
export const MAX_CLAIM_EXPORT_ROWS=100000;
export const CLAIM_GRID:GridSpec={reference:'text',supplier:'text',program:'text',claim_type:'text',status:'text',due_date:'date',amount_claimed:'money',paid:'money',outstanding:'money'};
export const PURCHASE_GRID:GridSpec={supplier:'text',receipt_ref:'text',product_id:'text',receipt_date:'date',quantity:'decimal',amount_cents:'money',entry_kind:'text',uom:'text',source_file:'text',source_row:'int'};
export const SUPPLIER_PROGRESS_GRID:GridSpec={reference:'text',supplier:'text',program:'text',spend:'money',earned:'money',remaining:'money',extra:'money',daysLeft:'int',outlook:'text',claimed:'money',status:'text'};
export type ClaimType='rebate'|'ship_and_debit';
export type ClaimStatus='draft'|'prepared'|'submitted'|'approved'|'rejected'|'paid'|'cancelled';
export type ClaimInput={id?:string;reference:string;supplier:string;program:string;type:ClaimType;from:string;to:string;due:string;mode:Agreement['calculation_mode'];eligible:string;excluded:string;requested:string;authorization:string;tiers:{from:string;to:string;rate:string}[];confirmed:boolean};
export type Claim={id:string;reference:string;supplier:string;program:string;type:ClaimType;from:string;to:string;due:string;mode:Agreement['calculation_mode'];eligible:string[];excluded:string[];requested:string|null;authorization:string;tiers:{from:string;to:string|null;rate:string}[];status:ClaimStatus;claimed:string|null;snapshot:string|null;updated:string};
export function bad():never{throw new VaultError('SUPPLIER',msg('supplier.invalid'));}
function code(v:string,max=100){if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f\x7f]/.test(v))bad();return v.trim();}
const SELECT_CLAIM=`SELECT id,reference,supplier,program,claim_type,period_start::VARCHAR lo,period_end::VARCHAR hi,due_date::VARCHAR due,mode,tiers_json,eligible_skus,excluded_skus,requested_cents::VARCHAR requested,authorization_ref,status,amount_claimed::VARCHAR claimed,snapshot_json,updated_at FROM supplier_claims`;
const asClaim=(r:Record<string,any>):Claim=>({id:r.id,reference:r.reference,supplier:r.supplier,program:r.program,type:r.claim_type,from:r.lo,to:r.hi,due:r.due,mode:r.mode,eligible:skuList(r.eligible_skus),excluded:skuList(r.excluded_skus),requested:r.requested,authorization:r.authorization_ref,tiers:JSON.parse(r.tiers_json),status:r.status,claimed:r.claimed,snapshot:r.snapshot_json,updated:r.updated_at});
export async function get(e:Engine,id:string){const r=(await rows(e,`${SELECT_CLAIM} WHERE id=${Q(code(id))}`))[0];if(!r)bad();return asClaim(r);}
export const eligibleWhere=(c:Claim,alias='p')=>`${alias}.supplier=${Q(c.supplier)} AND ${alias}.receipt_date BETWEEN DATE ${Q(c.from)} AND DATE ${Q(c.to)} ${c.eligible.length?`AND ${alias}.product_id IN(${c.eligible.map(Q).join(',')})`:''} ${c.excluded.length?`AND ${alias}.product_id NOT IN(${c.excluded.map(Q).join(',')})`:''}`;
export async function live(e:Engine,c:Claim){
 const a=(await rows(e,`SELECT count(*)::VARCHAR n,coalesce(sum(CAST(p.amount_cents AS HUGEINT)),0)::VARCHAR spend FROM purchases p WHERE ${eligibleWhere(c)}`))[0];
 const value=c.type==='rebate'?accrueCents(BigInt(a.spend),c.mode,c.tiers):{spend:a.spend,earned:null,remaining:null,nextRate:null};
 return {count:a.n,...value};
}
export async function preview(e:Engine,id:string){const claim=await get(e,id),v=await live(e,claim),currency=await workspaceCurrency(e),revision=(await rows(e,'SELECT pricing_revision::VARCHAR n FROM vault_meta WHERE id=1'))[0].n;return {claim,live:v,currency,fingerprint:await digest(JSON.stringify([claim,revision,v,currency]))};}
export async function saveSql(e:Engine,i:ClaimInput,actor:string){
 let c:Claim;try{if(i.confirmed!==true)bad();validDate(i.from);validDate(i.to);validDate(i.due);if(i.from>i.to||!['rebate','ship_and_debit'].includes(i.type)||!['retroactive','incremental'].includes(i.mode))bad();
 const tiers=i.tiers.map(t=>({from:String(minorUnits(t.from)),to:t.to?String(minorUnits(t.to)):null,rate:t.rate}));if(i.type==='rebate'){if(!tiers.length||tiers.length>100)bad();accrueCents(BigInt(0),i.mode,tiers);}
 if(typeof i.authorization!=='string'||i.authorization.length>200||/[\x00-\x1f\x7f]/.test(i.authorization))bad();
 c={id:i.id?code(i.id):crypto.randomUUID(),reference:code(i.reference),supplier:code(i.supplier,64),program:code(i.program),type:i.type,from:i.from,to:i.to,due:i.due,mode:i.mode,tiers:i.type==='rebate'?tiers:[],eligible:skuList(i.eligible),excluded:skuList(i.excluded),requested:i.requested?String(minorUnits(i.requested)):null,authorization:i.authorization.trim(),status:'draft',claimed:null,snapshot:null,updated:new Date().toISOString()};
 }catch{return bad();}
 if(i.id){const old=await get(e,c.id);if(old.status!=='draft')throw new VaultError('SUPPLIER',msg('supplier.frozen'));}
 const overlap=await rows(e,`SELECT id FROM supplier_claims WHERE id<>${Q(c.id)} AND (reference=${Q(c.reference)} OR (status<>'cancelled' AND supplier=${Q(c.supplier)} AND program=${Q(c.program)} AND claim_type=${Q(c.type)} AND period_start<=DATE ${Q(c.to)} AND period_end>=DATE ${Q(c.from)})) LIMIT 1`);if(overlap.length)throw new VaultError('SUPPLIER',msg('supplier.overlap'));
 // UPDATE instead of delete/reinsert preserves original creation metadata.
 const set=`reference=${Q(c.reference)},supplier=${Q(c.supplier)},program=${Q(c.program)},claim_type=${Q(c.type)},period_start=DATE ${Q(c.from)},period_end=DATE ${Q(c.to)},due_date=DATE ${Q(c.due)},mode=${Q(c.mode)},tiers_json=${Q(JSON.stringify(c.tiers))},eligible_skus=${Q(c.eligible.join('|'))},excluded_skus=${Q(c.excluded.join('|'))},requested_cents=${c.requested??'NULL'},authorization_ref=${Q(c.authorization)},updated_at=${Q(c.updated)}`;
 const sql=i.id?`UPDATE supplier_claims SET ${set} WHERE id=${Q(c.id)}`:`INSERT INTO supplier_claims(id,reference,supplier,program,claim_type,period_start,period_end,due_date,mode,tiers_json,eligible_skus,excluded_skus,requested_cents,authorization_ref,status,created_by,created_at,updated_at) VALUES(${[c.id,c.reference,c.supplier,c.program,c.type,c.from,c.to,c.due,c.mode,JSON.stringify(c.tiers),c.eligible.join('|'),c.excluded.join('|')].map(Q).join(',')},${c.requested??'NULL'},${Q(c.authorization)},'draft',${Q(actor)},${Q(c.updated)},${Q(c.updated)})`;
 return {id:c.id,sql};
}
const TRANSITIONS:Record<ClaimStatus,ClaimStatus[]>={draft:['cancelled'],prepared:['draft','submitted','cancelled'],submitted:['approved','rejected'],approved:['paid'],rejected:['draft','cancelled'],paid:[],cancelled:[]};
export async function statusSql(e:Engine,id:string,status:ClaimStatus){const c=await get(e,id);if(!TRANSITIONS[c.status]?.includes(status))throw new VaultError('SUPPLIER',msg('supplier.badStatus'));if(status==='submitted'&&!c.snapshot)bad();return `UPDATE supplier_claims SET status=${Q(status)},updated_at=${Q(new Date().toISOString())}${status==='draft'?',amount_claimed=NULL,snapshot_json=NULL':''} WHERE id=${Q(id)}`;}
export async function claims(e:Engine,offset=0,grid?:unknown){const page=await gridPage(e,`SELECT id,reference,supplier,program,claim_type,status,due_date::VARCHAR due_date,period_start::VARCHAR period_start,period_end::VARCHAR period_end,amount_claimed::VARCHAR amount_claimed,coalesce(y.paid,0)::VARCHAR paid,(CASE WHEN status IN('submitted','approved') THEN greatest(coalesce(amount_claimed,0)-coalesce(y.paid,0),0) ELSE 0 END)::VARCHAR outstanding FROM supplier_claims c LEFT JOIN (SELECT claim_id,sum(amount_cents) paid FROM claim_payments WHERE voided_at IS NULL GROUP BY claim_id) y ON y.claim_id=c.id`,CLAIM_GRID,gridQuery(CLAIM_GRID,grid),{fallback:'g.due_date,g.id',limit:50,offset});return {...page,offset,currency:await workspaceCurrency(e)};}
export async function purchases(e:Engine,offset=0,grid?:unknown,claimId?:string){const c=claimId?await get(e,claimId):null;const page=await gridPage(e,`SELECT p.source_id,p.line_id::VARCHAR line_id,p.receipt_ref,p.supplier,p.product_id,p.receipt_date::VARCHAR receipt_date,p.quantity::VARCHAR quantity,p.amount_cents::VARCHAR amount_cents,p.entry_kind,p.uom,f.name AS source_file,p.source_row::VARCHAR source_row FROM purchases p JOIN source_files f ON f.id=p.source_id ${c?'WHERE '+eligibleWhere(c):''}`,PURCHASE_GRID,gridQuery(PURCHASE_GRID,grid),{fallback:'g.supplier,g.receipt_date,g.source_id,g.line_id',limit:50,offset});return {...page,offset,currency:await workspaceCurrency(e)};}
export type SupplierProgress={id:string;reference:string;supplier:string;program:string;status:ClaimStatus;spend:string;earned:string|null;remaining:string|null;nextRate:string|null;claimed:string|null}&NearMiss;
/** Only a draft claim has an outlook: a prepared, submitted, approved or paid claim has a frozen amount. */
export async function progressRows(e:Engine,today=businessToday()){const all=(await rows(e,`${SELECT_CLAIM} WHERE status<>'cancelled' ORDER BY supplier,program,period_start,id`)).map(asClaim),data:SupplierProgress[]=[];for(const c of all){const v=await live(e,c);data.push({id:c.id,reference:c.reference,supplier:c.supplier,program:c.program,status:c.status,spend:v.spend,earned:v.earned,remaining:v.remaining,nextRate:v.nextRate,claimed:c.claimed,...(v.earned===null?{extra:null,daysLeft:null,perDay:null,outlook:'not_tiered' as const}:c.status!=='draft'?{extra:null,daysLeft:null,perDay:null,outlook:'ended' as const}:nearMiss({spend:v.spend,earned:v.earned,remaining:v.remaining},c.mode,c.tiers,c.from,c.to,today))});}return data;}
export async function progress(e:Engine,offset=0,grid?:unknown){const data=await progressRows(e);const cols=Object.entries(SUPPLIER_PROGRESS_GRID).map(([id,type])=>({id,type,value:(r:SupplierProgress)=>r[id as keyof SupplierProgress]??null})) as ClientColumn<SupplierProgress>[];const page=await memoryPage(e,data,cols,SUPPLIER_PROGRESS_GRID,gridQuery(SUPPLIER_PROGRESS_GRID,grid),{limit:50,offset});return {...page,offset,currency:await workspaceCurrency(e),near:nearSummary(data)};}
export type ClaimSnapshot={claimId:string;currency:string;amount:string;spend:string;earned:string|null;count:string;evidenceHash:string;exportedAt:string};
/** Only the export path materializes evidence, after the count guard. */
export async function exportPlan(e:Engine,id:string,expected:string){const v=await preview(e,id),c=v.claim;if(expected!==v.fingerprint)throw new VaultError('SUPPLIER',msg('supplier.previewChanged'));if(['cancelled','rejected'].includes(c.status))throw new VaultError('SUPPLIER',msg('supplier.badStatus'));if(BigInt(v.live.count)>BigInt(MAX_CLAIM_EXPORT_ROWS))throw new VaultError('SUPPLIER',msg('supplier.exportCap',{count:MAX_CLAIM_EXPORT_ROWS}));
 const data=await rows(e,`SELECT p.source_id,p.line_id::VARCHAR line_id,p.receipt_ref,p.product_id,p.receipt_date::VARCHAR receipt_date,p.quantity::VARCHAR quantity,p.amount_cents::VARCHAR amount_cents,p.entry_kind,p.uom,f.name AS source_file,p.source_row::VARCHAR source_row FROM purchases p JOIN source_files f ON f.id=p.source_id WHERE ${eligibleWhere(c)} ORDER BY p.source_id,p.line_id`);
 if(String(data.length)!==v.live.count)bad();const hash=await digest(JSON.stringify(data));let snapshot:ClaimSnapshot;
 if(c.snapshot){snapshot=JSON.parse(c.snapshot);if(snapshot.evidenceHash!==hash||snapshot.currency!==v.currency)throw new VaultError('SUPPLIER',msg('supplier.evidenceChanged'));}
 else {const amount=c.requested??v.live.earned;if(amount===null||BigInt(amount)<=BigInt(0)||BigInt(v.live.spend)<=BigInt(0)||v.live.count==='0')throw new VaultError('SUPPLIER',msg('supplier.noAmount'));if(c.type==='rebate'&&BigInt(amount)>BigInt(v.live.earned!))throw new VaultError('SUPPLIER',msg('supplier.overclaim'));if(c.type==='ship_and_debit'&&!c.authorization)throw new VaultError('SUPPLIER',msg('supplier.authorizationRequired'));snapshot={claimId:id,currency:v.currency,amount,spend:v.live.spend,earned:v.live.earned,count:v.live.count,evidenceHash:hash,exportedAt:new Date().toISOString()};}
 return {claim:c,snapshot,rows:data,sql:c.snapshot?'':`UPDATE supplier_claims SET amount_claimed=${snapshot.amount},snapshot_json=${Q(JSON.stringify(snapshot))},status='prepared',updated_at=${Q(snapshot.exportedAt)} WHERE id=${Q(id)}`};
}
