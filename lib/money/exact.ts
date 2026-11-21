export class SpikeError extends Error {}
export function minorUnits(value:string,decimal:"dot"|"comma"="dot"):bigint{
 const pattern=decimal==="dot"?/^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/:/^(0|[1-9]\d{0,11})(?:,(\d{1,2}))?$/;
 const m=pattern.exec(value);
 if(!m)throw new SpikeError("Use a non-negative amount with at most two decimal places and no grouping symbols.");
 return BigInt(m[1])*BigInt(100)+BigInt((m[2]||"").padEnd(2,"0"));
}
export function moneyText(cents:string|bigint){
 let n=BigInt(cents),sign="";if(n<BigInt(0)){sign="-";n=-n;}
 return sign+new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(n/BigInt(100))+"."+(n%BigInt(100)).toString().padStart(2,"0");
}
export function decimalText(cents:bigint){const sign=cents<BigInt(0)?"-":"";const n=cents<BigInt(0)?-cents:cents;return sign+(n/BigInt(100)).toString()+"."+(n%BigInt(100)).toString().padStart(2,"0");}
export function sqlText(text:string){return "'"+text.replaceAll("'","''")+"'";}
export function boundedInteger(value:string,max:number){
 if(!/^(0|[1-9]\d*)$/.test(value)||BigInt(value)>BigInt(max))throw new SpikeError("Use a whole number within the supported range.");
 return Number(value);
}
export const CSV_FIELDS=["line_id","product_id","customer_id","sale_date","quantity","list_amount","discount_amount","freight_amount","rebate_amount","cost_amount"] as const;
export const MAX_LINES=2_000_000,MAX_PRODUCTS=200_000;
export function validDate(text:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(text+"T00:00:00Z"))||new Date(text+"T00:00:00Z").toISOString().slice(0,10)!==text)throw new SpikeError("Use a real date in YYYY-MM-DD format.");
 return text;
}
