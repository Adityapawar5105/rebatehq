export type ImportValue = { sku:string;description:string;unit:string;cost:string|null;price:string;supplier:string;date:string;quantity?:string };
export type ImportDiff = {
 row:number; productId:string; state:"new"|"changed"|"unchanged"|"rejected";
 before:ImportValue|null; after:ImportValue|null; messages:string[];
 conflict?:{baseline:ImportValue;app:ImportValue;file:ImportValue;choice:"app"|"file"|"review"};
};
export type ImportPlan = {
 id:string;filename:string;currency:string;rows:ImportDiff[];counts:Record<ImportDiff["state"],number>;
 conflicts:number;canCommit:boolean;expiresAt:string;warnings:string[];
};
export type ImportHistory = {id:string;filename:string;status:string;who:string;when:string;accepted:number;rejected:number;unchanged:number;undoneAt:string|null;canUndo:boolean};
