// Blueprint section 22, item 39: near-miss rebate tiers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {accrueCents} from '../lib/rebate/engine';
import {nearMiss,nearSummary} from '../lib/rebate/nearmiss';

const tiers=[{from:'0',to:'1000000',rate:'2'},{from:'1000000',to:null,rate:'3'}]; // $0–$10,000 at 2%, then 3%
const at=(spend:number,mode:'retroactive'|'incremental'='retroactive')=>accrueCents(BigInt(spend),mode,tiers);

test('item 39: the extra rebate is what reaching the next tier adds, retroactive and incremental',()=>{
 // $8,000 spent: 2% = $160. At $10,000 retroactive: 3% of all = $300, so $140 more.
 const r=nearMiss(at(800000),'retroactive',tiers,'2026-01-01','2026-12-31','2026-07-01');
 assert.equal(r.extra,'14000');
 // Incremental: the threshold itself still earns 2% below it, so $200 at $10,000, $40 more.
 const i=nearMiss(at(800000,'incremental'),'incremental',tiers,'2026-01-01','2026-12-31','2026-07-01');
 assert.equal(i.extra,'4000');
});

test('item 39: outlook from a straight-line pace, within reach under 25%, far otherwise',()=>{
 // 10-day period, day 5 of 10: $5,000 so far projects to $10,000 = on pace.
 assert.equal(nearMiss(at(500000),'retroactive',tiers,'2026-03-01','2026-03-10','2026-03-05').outlook,'on_pace');
 // Day 9 of 10 with $8,000: projects $8,888, short; $2,000 left is 20% of $10,000 = within reach.
 const w=nearMiss(at(800000),'retroactive',tiers,'2026-03-01','2026-03-10','2026-03-09');
 assert.equal(w.outlook,'within_reach');assert.equal(w.daysLeft,'2');assert.equal(w.perDay,'100000');
 // Day 9 of 10 with $5,000: $5,000 left is 50% = far.
 assert.equal(nearMiss(at(500000),'retroactive',tiers,'2026-03-01','2026-03-10','2026-03-09').outlook,'far');
 // The last day counts: $2,000 left in 1 day needs $2,000 a day.
 assert.equal(nearMiss(at(800000),'retroactive',tiers,'2026-03-01','2026-03-10','2026-03-10').perDay,'200000');
 // Rounded up to the cent: $1 left over 3 days needs 34 cents a day.
 assert.equal(nearMiss(at(999900),'retroactive',tiers,'2026-03-01','2026-03-10','2026-03-08').perDay,'34');
});

test('item 39: ended, not started and top tier have no projection',()=>{
 const ended=nearMiss(at(800000),'retroactive',tiers,'2026-01-01','2026-03-31','2026-04-01');
 assert.deepEqual(ended,{extra:null,daysLeft:'0',perDay:null,outlook:'ended'});
 const early=nearMiss(at(0),'retroactive',tiers,'2026-05-01','2026-05-10','2026-04-20');
 assert.equal(early.outlook,'upcoming');assert.equal(early.daysLeft,'10');assert.equal(early.extra,'30000');assert.equal(early.perDay,'100000');
 const top=nearMiss(at(1200000),'retroactive',tiers,'2026-01-01','2026-12-31','2026-06-01');
 assert.equal(top.outlook,'reached');assert.equal(top.extra,null);assert.equal(top.perDay,null);
});

test('item 39: the summary counts only on-pace and within-reach rows',()=>{
 assert.deepEqual(nearSummary([{outlook:'on_pace',extra:'100'},{outlook:'within_reach',extra:'50'},{outlook:'far',extra:'999'},{outlook:'reached',extra:null}]),{count:'2',extra:'150'});
 assert.deepEqual(nearSummary([]),{count:'0',extra:'0'});
});
