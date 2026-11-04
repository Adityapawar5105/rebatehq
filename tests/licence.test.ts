import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { LICENCE_LIMITS, fitsLicenceCapacity, licenceWritable, lowerTier, type LicenceClaims } from '../lib/licence-policy';
import { verifyLicence } from '../lib/licence-verify';
import { VaultLicence, capacitySql } from '../lib/vault/licence';
const pair=generateKeyPairSync('ed25519'),key=pair.publicKey.export({format:'der',type:'spki'}).toString('base64');
const issued=Math.floor(Date.now()/1000),claims:LicenceClaims={v:1,sub:'u',workspace:'w',device:'d',tier:'professional',state:'active',issued,expires:issued+3600,offlineUntil:issued+86400,reason:''};
const envelope=(c:LicenceClaims)=>{const payload=JSON.stringify(c);return {payload,signature:sign(null,Buffer.from(payload),pair.privateKey).toString('base64')};};
test('licence signatures bind user, workspace, device and dates; invalid/tampered signatures fail closed',async()=>{
 assert.deepEqual(await verifyLicence(envelope(claims),key,{userId:'u',workspaceId:'w'},'d'),claims);
 for(const c of [{...claims,sub:'other'},{...claims,workspace:'other'},{...claims,device:'other'},{...claims,expires:issued+3601},{...claims,offlineUntil:issued+86401}])await assert.rejects(verifyLicence(envelope(c),key,{userId:'u',workspaceId:'w'},'d'));
 const bad=envelope(claims);bad.payload=bad.payload.replace('professional','scale');await assert.rejects(verifyLicence(bad,key,{userId:'u',workspaceId:'w'},'d'));
});
test('one-hour online assertion, bounded 24h offline grace, expiry and revocation are read-only without deleting data',async()=>{
 assert.equal(licenceWritable(claims,(issued+3599)*1000),true);assert.equal(licenceWritable(claims,(issued+3600)*1000),false);
 assert.equal(licenceWritable(claims,(issued+86399)*1000,true),true);assert.equal(licenceWritable(claims,(issued+86400)*1000,true),false);
 assert.equal(licenceWritable({...claims,state:'readonly'},issued*1000,true),false);assert.equal(licenceWritable(null),false);
 const licence=new VaultLicence(key);assert.throws(()=>licence.guard('studioCommit'),/read-only/);
 await licence.set(envelope(claims),{userId:'u',tenantId:'w'},'d',false);licence.guard('studioCommit');assert.equal(licence.effective('scale'),'professional');
 await licence.set(envelope({...claims,state:'readonly',reason:'Revoked device'}),{userId:'u',tenantId:'w'},'d',false);assert.throws(()=>licence.guard('studioCommit'),/Revoked/);
 for(const action of ['unlock','marginWaterfall','verify','backupExport','lock'] as const)licence.guard(action);
 await assert.rejects(licence.set({...envelope(claims),signature:'bad'}, {userId:'u',tenantId:'w'},'d',false));assert.equal(licence.writable,false);
});
test('every tier boundary is exact and Scale retains the measured 1M provisional cap',()=>{
 assert.deepEqual(LICENCE_LIMITS,{starter:{users:1,locations:1,products:20000,lines:200000},professional:{users:5,locations:null,products:100000,lines:1000000},scale:{users:15,locations:null,products:200000,lines:1000000}});
 for(const tier of ['starter','professional','scale'] as const){const cap=LICENCE_LIMITS[tier];assert.equal(fitsLicenceCapacity(tier,BigInt(cap.products),BigInt(cap.lines)),true);assert.equal(fitsLicenceCapacity(tier,BigInt(cap.products)+BigInt(1),BigInt(cap.lines)),false);assert.equal(fitsLicenceCapacity(tier,BigInt(cap.products),BigInt(cap.lines)+BigInt(1)),false);}
 assert.equal(lowerTier('starter','scale'),'starter');assert.equal(lowerTier('scale','starter'),'starter');
});

test('applying an upgraded licence changes only local capacity metadata, never accepts an arbitrary tier',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite();try{await db.exec("CREATE TABLE vault_meta(id integer PRIMARY KEY,tier text);INSERT INTO vault_meta VALUES(1,'starter');");
 for(const tier of ['professional','scale'] as const){await db.exec(capacitySql(tier));assert.equal((await db.query<{tier:string}>('SELECT tier FROM vault_meta WHERE id=1')).rows[0].tier,tier);}
 assert.throws(()=>capacitySql('forged' as any),/Unsupported/);
 }finally{await db.close();}
});
