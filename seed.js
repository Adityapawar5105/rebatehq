window.SEED_DATA={
  company:{id:'co-demo',name:'Northwind Industrial Supply',currency:'USD'},
  users:[{id:'u-owner',name:'Morgan Lee',role:'owner'},{id:'u-analyst',name:'Sam Patel',role:'analyst'},{id:'u-rep',name:'Jordan Reyes',role:'rep'}],
  customers:[
    {id:'c-acme',name:'Acme Corp',accountNo:'AC-104',region:'West',tier:'Strategic',phone:'+1 415 555 0144',email:'purchasing@acme.example'},
    {id:'c-blue',name:'Blue Ridge Mechanical',accountNo:'BR-220',region:'South',tier:'Growth',phone:'+1 615 555 0108',email:'buying@blueridge.example'},
    {id:'c-valley',name:'Valley Industrial',accountNo:'VI-041',region:'Midwest',tier:'Standard',phone:'+1 414 555 0125',email:'orders@valley.example'},
    {id:'c-rapid',name:'Rapid HVAC Partners',accountNo:'RH-518',region:'West',tier:'Growth',phone:'+1 206 555 0173',email:'ops@rapidhvac.example'}
  ],
  products:[
    {id:'p-v100',sku:'SV-100',name:'Steel Gate Valve · 2 in',category:'Steel Valves',supplier:'NorthStar Metals',uom:'EA',cost:74,freight:4.2,termsCost:1.1,listPrice:126,tiers:{Strategic:119,Growth:122,Standard:126}},
    {id:'p-v200',sku:'SV-200',name:'Steel Ball Valve · 3 in',category:'Steel Valves',supplier:'NorthStar Metals',uom:'EA',cost:118,freight:7.5,termsCost:1.8,listPrice:194,tiers:{Strategic:181,Growth:188,Standard:194}},
    {id:'p-a110',sku:'AL-110',name:'Aluminum Bracket · 8 in',category:'Aluminum Parts',supplier:'AlumaWorks',uom:'EA',cost:18.5,freight:1.2,termsCost:.25,listPrice:36,tiers:{Strategic:34,Growth:35,Standard:36}},
    {id:'p-h300',sku:'HV-300',name:'HVAC Condenser Fan Motor',category:'HVAC Supplies',supplier:'AirCore',uom:'EA',cost:142,freight:8.8,termsCost:2.4,listPrice:229,tiers:{Strategic:216,Growth:222,Standard:229}},
    {id:'p-e405',sku:'EL-405',name:'Electrical Breaker · 40A',category:'Electrical Supplies',supplier:'BrightLine',uom:'EA',cost:21,freight:1.4,termsCost:.35,listPrice:42,tiers:{Strategic:40,Growth:41,Standard:42}},
    {id:'p-v305',sku:'SV-305',name:'Steel Check Valve · 4 in',category:'Steel Valves',supplier:'NorthStar Metals',uom:'EA',cost:238,freight:19,termsCost:5.5,listPrice:359,tiers:{Strategic:338,Growth:349,Standard:359}},
    {id:'p-h410',sku:'HV-410',name:'Copper Refrigerant Line Set',category:'HVAC Supplies',supplier:'AirCore',uom:'SET',cost:82,freight:4.8,termsCost:1.25,listPrice:139,tiers:{Strategic:132,Growth:135,Standard:139}},
    {id:'p-a240',sku:'AL-240',name:'Aluminum Mounting Plate',category:'Aluminum Parts',supplier:'AlumaWorks',uom:'EA',cost:33,freight:2.1,termsCost:.5,listPrice:58,tiers:{Strategic:55,Growth:56.5,Standard:58}}
  ],
  orders:[
    {id:'SO-8101',customerId:'c-acme',productId:'p-v100',qty:80,discountPct:5,offInvoiceRebatePct:1,freightPerUnit:6.2,termsPerUnit:1.1,month:'2026-10'},
    {id:'SO-8102',customerId:'c-rapid',productId:'p-v305',qty:28,discountPct:14,discountApproved:false,offInvoiceRebatePct:2,freightPerUnit:68,termsPerUnit:5.5,month:'2026-10'},
    {id:'SO-8103',customerId:'c-blue',productId:'p-h300',qty:42,discountPct:6,offInvoiceRebatePct:1.5,freightPerUnit:12,termsPerUnit:2.4,month:'2026-10'},
    {id:'SO-8104',customerId:'c-valley',productId:'p-e405',qty:120,discountPct:3,offInvoiceRebatePct:0,freightPerUnit:1.8,termsPerUnit:.35,month:'2026-10'},
    {id:'SO-7998',customerId:'c-acme',productId:'p-v200',qty:24,discountPct:3,offInvoiceRebatePct:1,freightPerUnit:8,termsPerUnit:1.8,month:'2026-09'},
    {id:'SO-7991',customerId:'c-rapid',productId:'p-h300',qty:16,discountPct:4,offInvoiceRebatePct:1,freightPerUnit:9,termsPerUnit:2.4,month:'2026-09'},
    {id:'SO-7984',customerId:'c-blue',productId:'p-a110',qty:90,discountPct:5,offInvoiceRebatePct:1,freightPerUnit:1.5,termsPerUnit:.25,month:'2026-09'},
    {id:'SO-7972',customerId:'c-valley',productId:'p-v100',qty:45,discountPct:4,offInvoiceRebatePct:0,freightPerUnit:4.4,termsPerUnit:1.1,month:'2026-09'}
  ],
  quotes:[
    {id:'QT-221',customerId:'c-acme',productId:'p-v100',qty:25,discountPct:8,accessory:0,status:'Open',createdAt:'2026-10-23'},
    {id:'QT-222',customerId:'c-blue',productId:'p-h300',qty:10,discountPct:12,accessory:60,status:'Open',createdAt:'2026-10-23'},
    {id:'QT-223',customerId:'c-valley',productId:'p-e405',qty:50,discountPct:4,accessory:0,status:'Open',createdAt:'2026-10-23'},
    {id:'QT-224',customerId:'c-rapid',productId:'p-v305',qty:4,discountPct:18,accessory:0,status:'Open',createdAt:'2026-10-23'}
  ],
  approvals:[],
  marginPolicy:{target:30,floor:25,walkAway:18,overrides:{category:{'Steel Valves':{target:28,floor:22,walkAway:16}},tier:{Strategic:{target:28,floor:23,walkAway:16}}}},
  rebates:[
    {id:'RA-301',kind:'Vendor',name:'NorthStar Metals — quarterly growth rebate',partyId:'NorthStar Metals',rate:2,threshold:20000,periodStart:'2026-07-01',periodEnd:'2026-09-30',eligibleSkus:['SV-100','SV-200','SV-305'],eligibleSpend:29500,credits:350,nextTier:40000,nextRate:3},
    {id:'RA-302',kind:'Customer',name:'Acme annual buying incentive',partyId:'c-acme',rate:3,threshold:180000,periodStart:'2026-01-01',periodEnd:'2026-12-31',eligibleSkus:['SV-100','SV-200','AL-110','EL-405'],eligibleSpend:175000,credits:0,nextTier:180000,nextRate:4},
    {id:'RA-303',kind:'Customer',name:'Blue Ridge seasonal growth rebate',partyId:'c-blue',rate:2.5,threshold:90000,periodStart:'2026-01-01',periodEnd:'2026-12-31',eligibleSkus:['HV-300','HV-410','EL-405'],eligibleSpend:85200,credits:0,nextTier:90000,nextRate:3}
  ],
  priceVersions:[{id:'PV-1',createdAt:'2026-10-01T09:00:00Z',label:'Initial price list',count:8,action:'Seeded'}],
  alerts:[{id:'AL-2',level:'review',message:'Acme Corp is $5,000 away from its next annual buying rebate tier.',customerId:'c-acme'},{id:'AL-3',level:'review',message:'Four supplier price rows need a buyer review before publishing.',action:'pricing'}],
  invoices:[
    {id:'INV-1001',customerId:'c-acme',productId:'p-v100',qty:80,netSales:9520,date:'2026-07-18'},
    {id:'INV-1002',customerId:'c-acme',productId:'p-v200',qty:24,netSales:4344,date:'2026-08-12'},
    {id:'INV-1003',customerId:'c-blue',productId:'p-h300',qty:42,netSales:9324,date:'2026-08-03'},
    {id:'INV-1004',customerId:'c-blue',productId:'p-h410',qty:75,netSales:10125,date:'2026-09-22'},
    {id:'INV-1005',customerId:'c-valley',productId:'p-e405',qty:120,netSales:4920,date:'2026-09-03'},
    {id:'INV-1006',customerId:'c-acme',productId:'p-a110',qty:90,netSales:3060,date:'2026-09-20'}
  ],
  supplierCredits:[{id:'CM-7001',vendor:'NorthStar Metals',date:'2026-08-31',amount:200,reference:'Remit 08-31'},{id:'CM-7215',vendor:'NorthStar Metals',date:'2026-09-30',amount:150,reference:'Remit 09-30'}],
  costComponents:[{orderId:'SO-8101',freight:496,terms:88},{orderId:'SO-8102',freight:784,terms:154},{orderId:'SO-8103',freight:504,terms:101}]
};
window.SEED_DATA.marginSnapshots = window.MarginEngine.buildMonthlySnapshots(window.SEED_DATA.orders, window.SEED_DATA.customers, window.SEED_DATA.products, window.SEED_DATA.company.id);
