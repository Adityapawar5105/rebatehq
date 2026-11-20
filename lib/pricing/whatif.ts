import type {Engine} from '../vault/engine';
import {rows,rate,simulate} from './rules';
import {rhaSql} from '../margin/sql';
import {rha} from '../margin/decimal';
import {businessToday} from '../vault/today';
const cached=new WeakMap<Engine,{key:string;weighted:string;count:string}>();
export async function whatIf(e:Engine,id:string,increase:string,exact:boolean,version:number){
 const bp=rate(increase),r=(await rows(e,`SELECT pricing_revision::VARCHAR n FROM vault_meta WHERE id=1`))[0];
 const key=JSON.stringify([id,version,r.n,businessToday()]);let c=cached.get(e);
 if(!c||c.key!==key){
  // simulate only constructs the bounded temporary base; its returned write SQL is never executed here.
  await simulate(e,id);await e.conn.query('DROP TABLE IF EXISTS temp.md_whatif;CREATE TEMP TABLE md_whatif AS SELECT * FROM md_price_copy');
  const a=(await rows(e,'SELECT coalesce(sum(CAST(before_cents AS HUGEINT)*CAST(qty*10000 AS HUGEINT)),0)::VARCHAR w,count(*)::VARCHAR n FROM md_whatif'))[0];c={key,weighted:a.w,count:a.n};cached.set(e,c);
 }
 if(!exact)return {exact:false,count:c.count,impact:String(rha(BigInt(c.weighted)*bp,BigInt(100000000))),red:null as string|null};
 const a=(await rows(e,`WITH p AS(SELECT *,CAST(${rhaSql(`CAST(before_cents AS HUGEINT)*(10000+${bp})`,'10000')} AS BIGINT) proposed FROM md_whatif)
 SELECT coalesce(sum(${rhaSql('CAST(p.proposed-p.before_cents AS HUGEINT)*CAST(p.qty*10000 AS HUGEINT)','10000')}),0)::VARCHAR impact,count(*) FILTER(WHERE p.proposed<g.floor)::VARCHAR red FROM p LEFT JOIN price_guardrails g ON g.tier=p.tier AND g.category=p.category`))[0];
 return {exact:true,count:c.count,impact:a.impact,red:a.red as string|null};
}
