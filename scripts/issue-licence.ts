// Operator-only pilot issuer. No browser/API route can issue or upgrade licences.
import pg from 'pg';
import { LICENCE_LIMITS } from '../lib/licence-policy';
async function main(){
const [tenant,tier,until]=process.argv.slice(2);
if(!tenant||!Object.hasOwn(LICENCE_LIMITS,tier)||!until||(!Number.isFinite(Date.parse(until))||Date.parse(until)<=Date.now()))throw Error('Usage: tsx scripts/issue-licence.ts <workspace-uuid> <starter|professional|scale> <ISO-expiry>');
if(!process.env.SEED_DATABASE_URL)throw Error('Administrative SEED_DATABASE_URL is required.');
const db=new pg.Client({connectionString:process.env.SEED_DATABASE_URL,ssl:/(localhost|127\.0\.0\.1)/i.test(process.env.SEED_DATABASE_URL)?false:{rejectUnauthorized:true}});await db.connect();
try{
 await db.query('BEGIN');
 const r=(await db.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
 if(!r?.rolsuper&&!r?.rolbypassrls)throw Error('Licence issuance requires a migration administrator.');
 await db.query("INSERT INTO workspace_licence(tenant_id,tier,valid_until) VALUES($1::uuid,$2::text,$3::timestamptz) ON CONFLICT(tenant_id) DO UPDATE SET tier=EXCLUDED.tier,status='active',valid_until=EXCLUDED.valid_until,issued_at=now()",[tenant,tier,until]);
 // Explicit first seat; refuse a downgrade that would leave more seats/locations than licensed.
 const cap=LICENCE_LIMITS[tier as keyof typeof LICENCE_LIMITS];
 const n=(await db.query('SELECT (SELECT count(*) FROM licence_seat WHERE tenant_id=$1::uuid)::int AS seats,(SELECT count(*) FROM licence_location WHERE tenant_id=$1::uuid)::int AS locations',[tenant])).rows[0];
 if(n.seats>cap.users||(cap.locations!==null&&n.locations>cap.locations))throw Error('Remove excess seats/locations before issuing this tier.');
 await db.query("INSERT INTO licence_seat(tenant_id,user_id) SELECT tenant_id,user_id FROM membership m WHERE tenant_id=$1::uuid AND role='owner' AND status='active' AND NOT EXISTS(SELECT 1 FROM licence_seat s WHERE s.tenant_id=m.tenant_id AND s.user_id=m.user_id) ORDER BY created_at LIMIT 1",[tenant]);
 await db.query('COMMIT');console.log('Pilot licence issued and audited. No payment processed.');
}catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}

}
main().catch(()=>{console.error("Licence issuance failed. Check administrator privileges, workspace, expiry and remaining seats; no secrets were logged.");process.exitCode=1;});
