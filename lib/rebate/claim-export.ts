import * as XLSX from 'xlsx';
import {csvRow,csvSafeCell} from '../csv';
import {centsText} from '../margin/decimal';
import type {exportPlan} from './supplier';
export const CLAIM_HEADERS=['record_type','claim_id','reference','supplier','program','claim_type','period_start','period_end','due_date','currency','qualifying_purchase_total','amount_claimed','calculation_mode','rate_percent','tier_from','tier_to_exclusive','authorization_reference','receipt_reference','source_file','source_row','sku','receipt_date','entry_kind','quantity_abs','purchase_amount_abs','unit','evidence_sha256','exported_at'];
const abs=(v:string)=>v.startsWith('-')?v.slice(1):v;
/** Exact decimal text; only one summary row carries the claimed total. No note column is ever read. */
export function claimExport(plan:Awaited<ReturnType<typeof exportPlan>>,format:'csv'|'xlsx'){
 const {claim:c,snapshot:s,rows}=plan;
 const row=(kind:string,values:Record<string,string>)=>CLAIM_HEADERS.map(k=>({record_type:kind,claim_id:c.id,reference:c.reference,supplier:c.supplier,program:c.program,claim_type:c.type,period_start:c.from,period_end:c.to,due_date:c.due,currency:s.currency,...values} as Record<string,string>)[k]??'');
 const table=[CLAIM_HEADERS,row('claim',{qualifying_purchase_total:centsText(BigInt(s.spend)),amount_claimed:centsText(BigInt(s.amount)),calculation_mode:c.type==='rebate'?c.mode:'manual_authorized',authorization_reference:c.authorization,evidence_sha256:s.evidenceHash,exported_at:s.exportedAt}),...c.tiers.map(t=>row('tier',{rate_percent:t.rate,tier_from:centsText(BigInt(t.from)),tier_to_exclusive:t.to===null?'':centsText(BigInt(t.to))})),...rows.map(r=>row('receipt',{receipt_reference:r.receipt_ref,source_file:r.source_file,source_row:r.source_row,sku:r.product_id,receipt_date:r.receipt_date,entry_kind:r.entry_kind,quantity_abs:abs(r.quantity),purchase_amount_abs:centsText(BigInt(abs(r.amount_cents))),unit:r.uom}))];
 let blob:Blob;
 if(format==='xlsx'){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(table.map(r=>r.map(csvSafeCell))),'Claim');blob=new Blob([XLSX.write(wb,{type:'array',bookType:'xlsx'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});}
 else{const chunks:string[]=['\ufeff'];for(let i=0;i<table.length;i+=2000)chunks.push(table.slice(i,i+2000).map(csvRow).join('\r\n')+'\r\n');blob=new Blob(chunks,{type:'text/csv;charset=utf-8'});}
 return {name:`rebatehq-claim-${c.id}.${format}`,blob};
}
