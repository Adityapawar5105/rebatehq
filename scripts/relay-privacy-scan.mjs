import assert from 'node:assert/strict';
export const RELAY_TABLES=Object.freeze(['relay_device_key','relay_epoch','relay_key_wrap','relay_event']);
// Fail with a location, never echo the fixture or database content into logs.
export function assertNoRelayPlaintext(value,markers,location='relay'){
 const visit=(item,at)=>{
  if(item instanceof Uint8Array){check(Buffer.from(item).toString('utf8'),at);return;}
  if(typeof item==='string'){check(item,at);return;}
  if(Array.isArray(item)){item.forEach((v,i)=>visit(v,at+'['+i+']'));return;}
  if(item&&typeof item==='object')for(const [key,v] of Object.entries(item)){check(key,at+'.column');visit(v,at+'.'+key);}
 };
 const check=(text,at)=>{
  const forms=[text];try{forms.push(decodeURIComponent(text));}catch{}
  // Base64/hex encoding is not encryption. Catch those simple encodings too.
  if(/^[A-Za-z0-9+/=]+$/.test(text)&&text.length>=16)forms.push(Buffer.from(text,'base64').toString('utf8'));
  if(/^(?:\\x)?[a-f0-9]+$/i.test(text))forms.push(Buffer.from(text.replace(/^\\x/,''),'hex').toString('utf8'));
  assert.ok(!forms.some(v=>markers.some(m=>v.includes(m))),'Private fixture content reached '+at);
 };
 visit(value,location);
}
export async function scanRelayDatabase(db,tenantId,markers){
 const inventory=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'relay_%' ORDER BY tablename")).rows.map(r=>r.tablename);
 assert.deepEqual(inventory,[...RELAY_TABLES].sort(),'Every relay table must participate in the privacy scan');
 const counts={};
 for(const table of RELAY_TABLES){const rows=(await db.query('SELECT * FROM public.'+table+' WHERE tenant_id=$1::uuid',[tenantId])).rows;assert.ok(rows.length>0,'Privacy scan would be vacuous for '+table);counts[table]=rows.length;assertNoRelayPlaintext(rows,markers,'database.'+table);}
 const audit=(await db.query("SELECT * FROM public.audit_log WHERE tenant_id=$1::uuid AND entity_type LIKE 'relay_%'",[tenantId])).rows;
 assert.ok(audit.length>0,'Relay audit coverage cannot be empty');assertNoRelayPlaintext(audit,markers,'database.audit_log');return counts;
}
