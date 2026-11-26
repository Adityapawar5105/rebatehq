// Near-miss rebate tiers (blueprint section 22, item 39): how far a programme is from its next tier,
// what reaching it would add, and whether the pace so far gets there before the period ends.
// Pure and exact: integer cents and whole days, no cost or margin input (decision 16 safe).
import {accrueCents,type Agreement} from './engine';

export type Outlook='on_pace'|'within_reach'|'far'|'reached'|'upcoming'|'ended'|'not_tiered';
/** "Within reach": less than this share of the next threshold is still to go (1/4 = 25%). */
export const WITHIN_REACH_DIVISOR=BigInt(4);
/** The outlooks the "Show them" filter keeps, ranked by extra rebate. */
export const NEAR:Outlook[]=['on_pace','within_reach'];

export type NearMiss={extra:string|null;daysLeft:string|null;perDay:string|null;outlook:Outlook};
const dayNumber=(iso:string)=>Math.round(Date.parse(iso+'T00:00:00Z')/86400000);

/** `spend` and `earned` are what accrueCents returned for the same tiers; dates are inclusive ISO days. */
export function nearMiss(v:{spend:string;earned:string;remaining:string|null},mode:Agreement['calculation_mode'],tiers:{from:string;to:string|null;rate:string}[],from:string,to:string,today:string):NearMiss{
 if(today>to)return {extra:null,daysLeft:'0',perDay:null,outlook:'ended'};
 const start=today<from?from:today,left=dayNumber(to)-dayNumber(start)+1;
 if(v.remaining===null)return {extra:null,daysLeft:String(left),perDay:null,outlook:'reached'};
 const spend=BigInt(v.spend),remaining=BigInt(v.remaining),target=spend+remaining;
 const extra=String(BigInt(accrueCents(target,mode,tiers).earned)-BigInt(v.earned));
 const perDay=String((remaining+BigInt(left)-BigInt(1))/BigInt(left));
 if(today<from)return {extra,daysLeft:String(left),perDay,outlook:'upcoming'};
 // Straight-line pace: spend per day so far, carried over the days after today.
 const elapsed=BigInt(dayNumber(today)-dayNumber(from)+1),after=BigInt(left-1);
 const projected=spend+spend*after/elapsed;
 const outlook:Outlook=projected>=target?'on_pace':remaining*WITHIN_REACH_DIVISOR<=target?'within_reach':'far';
 return {extra,daysLeft:String(left),perDay,outlook};
}

/** Count and total extra rebate of the rows a "Show them" filter would keep. */
export function nearSummary(rows:{outlook:Outlook;extra:string|null}[]){
 let count=0,extra=BigInt(0);
 for(const r of rows)if(NEAR.includes(r.outlook)&&r.extra!==null){count++;extra+=BigInt(r.extra);}
 return {count:String(count),extra:String(extra)};
}
