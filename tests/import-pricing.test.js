const test=require("node:test"),assert=require("node:assert/strict"),engine=require("../margin-engine.js");
test("file-import list prices use half-open dates beneath contract/customer/group/tier precedence",()=>{
 const p={id:"p",listPrice:20,currency:"EUR",tiers:{VIP:19},listHistory:[{id:"r1",unit_price:"25.0000",currency:"EUR",effective_from:"2026-11-01",effective_to:"2027-01-01"},{id:"r2",unit_price:"30.0000",currency:"EUR",effective_from:"2027-01-01",effective_to:null}]};
 assert.equal(engine.resolvePrice(p,{}, {date:"2026-10-31"}).price,20);
 assert.equal(engine.resolvePrice(p,{}, {date:"2026-11-01"}).price,25);
 assert.equal(engine.resolvePrice(p,{}, {date:"2027-01-01"}).price,30);
 assert.equal(engine.resolvePrice(p,{tier:"VIP"}, {date:"2026-11-01"}).price,19);
 assert.equal(engine.resolvePrice(p,{id:"c"}, {date:"2026-11-01",rules:[{id:"c1",product_id:"p",customer_id:"c",rule_kind:"contract",price:17,effective_from:"2026-01-01",min_quantity:0}]}).price,17);
 assert.equal(engine.resolvePrice(p,{},{}).valid,false);
 assert.equal(engine.resolvePrice({...p,listHistory:[...p.listHistory,p.listHistory[0]]},{},{date:"2026-11-01"}).valid,false);
});
