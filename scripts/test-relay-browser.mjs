import assert from 'node:assert/strict';
import {createPrivateKey,sign,randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import pg from 'pg';
import {signInLocal,localUrl,localDatabaseUrl} from './vault-test-auth.mjs';
import {assertNoRelayPlaintext,scanRelayDatabase} from './relay-privacy-scan.mjs';
const auth=process.argv.includes('--auth'),channel=process.argv.find(v=>v.startsWith('--browser='))?.split('=')[1]??'chrome';
const base=process.env.VAULT_TEST_URL??'http://localhost:3100',route=auth?'/home':'/lab/vault';
localUrl(base,'Relay browser app');
const marker='RELAY-PRIVATE-'+randomUUID(),amount='9876543210.98',secret='relay-device-passphrase-'+randomUUID();
const markers=[marker,marker+'-reference',marker+'-comment',amount,'987654321098','9,876,543,210.98','5000.00','500000',secret];
const checks={},failures=[],inspections=[],contexts=[],pages=[],actors=[];let active=false,local=null,db=null;
const browser=await chromium.launch({...(channel==='chromium'?{}:{channel}),headless:true});
const result={date:new Date().toISOString(),auth,channel,browser:browser.version(),checks};
async function settled(page){await page.locator('dialog[aria-labelledby="relay-title"][aria-busy="false"]').waitFor({state:'attached',timeout:60000});await page.getByRole('status').filter({hasText:'Working in the encrypted vault…'}).waitFor({state:'hidden',timeout:60000});const alerts=await page.getByRole('alert').filter({hasText:/\S/}).allInnerTexts();assert.equal(alerts.length,0,'Relay UI reported an error (content suppressed)');}
async function click(page,name){await page.getByRole('button',{name,exact:true}).click();await settled(page);}
async function open(page){await page.getByRole('button',{name:'Open shared inbox',exact:true}).click();await page.getByRole('dialog',{name:'Shared inbox',exact:true}).waitFor();await settled(page);}
async function close(page){await page.getByRole('button',{name:'Close shared inbox',exact:true}).click();}
async function syncAndSelect(page,title){await click(page,'Sync inbox');await page.getByRole('button',{name:title,exact:true}).click();}
try{
 await mkdir('test-results',{recursive:true});
 if(auth){assert.equal(process.env.RELAY_ENABLED,'true','Authenticated CI relay gate must be explicitly enabled');localDatabaseUrl(process.env.SEED_DATABASE_URL,'Relay test database');db=new pg.Client({connectionString:process.env.SEED_DATABASE_URL});await db.connect();}
 else{const compiled=await build({entryPoints:['scripts/relay-browser-db.ts'],bundle:true,platform:'node',format:'esm',packages:'external',write:false});await writeFile('test-results/relay-browser-db.mjs',compiled.outputFiles[0].contents);local=await (await import('../test-results/relay-browser-db.mjs')).localRelayDatabase();db=local;}
 for(let i=0;i<3;i++){
  const context=await browser.newContext({viewport:{width:1365,height:900}});contexts.push(context);
  context.on('request',r=>{inspections.push(r.allHeaders().then(headers=>{assertNoRelayPlaintext([r.url(),headers,r.postDataBuffer()??''],markers,'request');const u=new URL(r.url());if(active){assert.equal(u.origin,new URL(base).origin,'Unexpected external request');if(u.pathname.startsWith('/api/'))assert.ok(u.pathname==='/api/licence'&&r.method()==='GET'||u.pathname==='/api/relay'&&['GET','POST'].includes(r.method()),'Unexpected API in relay flow');}}).catch(()=>failures.push('Private content or unapproved request reached the network')));});
  context.on('console',m=>{inspections.push(Promise.all(m.args().map(a=>a.jsonValue())).then(args=>assertNoRelayPlaintext([m.text(),args],markers,'console')).catch(()=>failures.push('Private fixture content appeared in console output')));});
  const page=await context.newPage();pages.push(page);page.setDefaultTimeout(45000);page.on('pageerror',()=>failures.push('Unhandled relay page error'));
  if(auth)actors.push(await signInLocal(context,page,base,{...(i?{tenantId:actors[0].tenantId,role:i===1?'manager':'rep'}:{}),deviceId:randomUUID()}));
  else{
   const actor=local.actors[i];actors.push(actor);
   await context.addInitScript(a=>localStorage.setItem('rebatehq-device-v1:'+a.tenantId+':'+a.userId,a.deviceId),actor);
   // Only the lab response is replaced in this test; no production auth bypass.
   await context.route('**/lab/vault',async r=>{const response=await r.fetch();const text=(await response.text()).replaceAll('synthetic-lab-user',actor.userId).replaceAll('synthetic-lab-workspace',actor.tenantId);await r.fulfill({response,body:text});});
   await context.route('**/api/licence?device=*',async r=>{const issued=Math.floor(Date.now()/1000),payload=JSON.stringify({v:1,sub:actor.userId,workspace:actor.tenantId,device:actor.deviceId,tier:'professional',state:'active',issued,expires:issued+3600,offlineUntil:issued+86400,reason:''});const key=createPrivateKey({key:Buffer.from(process.env.LICENCE_SIGNING_KEY,'base64'),format:'der',type:'pkcs8'});await r.fulfill({json:{payload,signature:sign(null,Buffer.from(payload),key).toString('base64')}});});
   await context.route('**/api/relay**',async r=>{try{const value=await local.handle(actor,r.request().method(),r.request().url(),r.request().method()==='POST'?r.request().postDataJSON():null);await r.fulfill({status:200,json:value});}catch(e){await r.fulfill({status:400,json:{code:e.code??'NETWORK',error:'Local relay harness rejected the operation'}});}});
  }
 }
 active=true;
 for(const page of pages){await page.goto(base+route);await page.getByLabel('Vault passphrase').fill(secret);await page.getByLabel('Pricing Owner (name)').fill('Synthetic local owner');await page.getByRole('button',{name:'Create encrypted vault',exact:true}).click();await page.getByRole('button',{name:'Lock vault',exact:true}).waitFor();await open(page);await click(page,'Set up this sharing device');}
 checks.threeWorkerDeviceKeys=true;
 const [owner,manager,rep]=pages;
 // Reopen after all registrations so the creator verifies the complete roster.
 await close(owner);await open(owner);const pin=await owner.getByTestId('relay-own-fingerprint').innerText();
 const deviceChecks=owner.getByRole('group',{name:'Verified device fingerprints'}).getByRole('checkbox');assert.equal(await deviceChecks.count(),3);
 for(const box of await deviceChecks.all())await box.check();await click(owner,'Start workspace sharing');
 for(const page of [manager,rep]){await close(page);await open(page);await page.getByLabel('Verified administrator fingerprint').fill(pin);await click(page,'Verify and join sharing');}
 checks.verifiedFingerprintJoin=true;
 await rep.getByRole('button',{name:'Share a reference',exact:true}).click();await rep.getByLabel('Reference type').selectOption('quote');await rep.getByLabel('Shared title').fill(marker);await rep.getByLabel('Local reference').fill(marker+'-reference');await rep.getByLabel('Amount',{exact:true}).fill(amount);await click(rep,'Share encrypted reference');
 await rep.getByRole('button',{name:marker,exact:true}).click();await rep.getByLabel('Pricing Owner approver').selectOption(actors[0].userId);await rep.getByLabel('Second-level manager').selectOption(actors[1].userId);await click(rep,'Request approval');
 assert.equal(await rep.getByRole('button',{name:'Approve level 1',exact:true}).count(),0);checks.noSelfApproval=true;
 await syncAndSelect(manager,marker);assert.equal(await manager.getByRole('button',{name:'Approve level 2',exact:true}).count(),0);checks.orderedLevels=true;
 await syncAndSelect(owner,marker);await click(owner,'Approve level 1');await syncAndSelect(manager,marker);await click(manager,'Approve level 2');
 await manager.getByRole('status').filter({hasText:'Approval: approved.'}).waitFor();checks.twoLevelApproval=true;
 await rep.getByLabel('Comment',{exact:true}).fill(marker+'-comment');await rep.getByRole('group',{name:'Mention people'}).getByRole('checkbox',{name:'@'+actors[0].email,exact:true}).check();await click(rep,'Send encrypted comment');
 await syncAndSelect(owner,marker);await owner.getByText('Mentions you',{exact:true}).waitFor();assert.ok((await owner.getByTestId('relay-object').innerText()).includes(marker+'-comment'));checks.commentMentionInbox=true;
 // One-level threshold boundary, using the same encrypted reference interface.
 await manager.getByRole('button',{name:'Share a reference',exact:true}).click();await manager.getByLabel('Shared title').fill(marker+'-small');await manager.getByLabel('Local reference').fill(marker+'-small-ref');await manager.getByLabel('Amount',{exact:true}).fill('5000.00');await click(manager,'Share encrypted reference');await manager.getByRole('button',{name:marker+'-small',exact:true}).click();assert.equal(await manager.getByLabel('Second-level manager').count(),0);await manager.getByLabel('Pricing Owner approver').selectOption(actors[0].userId);await click(manager,'Request approval');await syncAndSelect(owner,marker+'-small');await click(owner,'Approve level 1');await owner.getByRole('status').filter({hasText:'Approval: approved.'}).waitFor();checks.oneLevelBoundary=true;
 // Reload must recover keys, history and verification heads from encrypted OPFS.
 await close(owner);await owner.reload();await owner.getByLabel('Vault passphrase').fill(secret);await owner.getByRole('button',{name:'Unlock vault',exact:true}).click();await owner.getByRole('button',{name:'Lock vault',exact:true}).waitFor();await open(owner);await syncAndSelect(owner,marker);assert.ok((await owner.getByTestId('relay-object').innerText()).includes(marker+'-comment'));checks.reloadEncryptedKeys=true;
 result.serverRows=await scanRelayDatabase(db,actors[0].tenantId,markers);checks.everyRelayColumnScanned=true;
 // An injected leak must trip the same scanner, including binary and base64.
 for(const value of [{ciphertext:Buffer.from(marker)}, {content:Buffer.from(marker).toString('base64')}])assert.throws(()=>assertNoRelayPlaintext(value,markers),/Private fixture content/);checks.scannerNegativeControls=true;
 for(let i=0;i<inspections.length;i++)await inspections[i];assert.deepEqual(failures,[]);checks.requestsHeadersBodiesConsole=true;
 assert.equal(Object.keys(checks).length,11,'Relay privacy check count changed; update the gate record');
 console.log('Relay browser/privacy gate: '+Object.keys(checks).length+' checks passed ('+channel+', '+(auth?'real authenticated local Supabase':'local PGlite transport; auth unverified')+').');
 await writeFile('test-results/vault-relay-'+channel+(auth?'-auth':'')+'.json',JSON.stringify(result,null,2)+'\n');
}catch(e){
 for(let i=0;i<pages.length;i++)try{await pages[i].screenshot({path:'test-results/vault-relay-'+channel+'-'+i+'-failure.png',fullPage:true});const alerts=await pages[i].getByRole('alert').filter({hasText:/\S/}).allInnerTexts();console.error('Relay page '+i+' alerts: '+markers.reduce((v,m)=>v.replaceAll(m,'[private]'),JSON.stringify(alerts)));const panel=await pages[i].evaluate(()=>{const d=document.querySelector('dialog[aria-labelledby="relay-title"]');return d?{open:d.open,busy:d.getAttribute('aria-busy'),fingerprints:d.querySelectorAll('fieldset input[type=checkbox]').length,objects:d.querySelectorAll('[data-testid="relay-object"]').length,buttons:[...d.querySelectorAll('button')].map(b=>b.textContent?.trim()).slice(0,20)}:{open:false};});console.error('Relay page '+i+' panel: '+markers.reduce((v,m)=>v.replaceAll(m,'[private]'),JSON.stringify(panel)));}catch{}
 throw e;
}finally{for(const c of contexts)await c.close();await browser.close();if(local)await local.close();else await db?.end();}
