import type {Engine} from '../vault/engine';
/** Old golden fixtures can still use their historical schema. Never cache this:
 * unlock upgrades and copy-on-write change the active catalog in one engine. */
export async function hasRebates(e:Engine){return (await e.conn.query("SELECT count(*)::VARCHAR AS n FROM information_schema.tables WHERE table_catalog=current_database() AND table_schema='main' AND table_name='rebate_programs'")).toArray()[0].n==='1';}
export async function salesInput(e:Engine){return await hasRebates(e)?'rebate_sales':'sales_lines';}

export async function hasSupplier(e:Engine){return (await e.conn.query("SELECT count(*)::VARCHAR n FROM information_schema.tables WHERE table_catalog=current_database() AND table_schema='main' AND table_name='purchases'")).toArray()[0].n==='1';}
