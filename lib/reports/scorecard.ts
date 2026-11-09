// Rep-safe by construction: only quote counts and comparisons against stored guidance. No cost input.
import type {Engine} from '../vault/engine';
import {sqlText as Q,validDate} from '../spike/exact';
import {rha,basisPointsDecimal} from '../margin/decimal';
import {bpPercentSql} from '../margin/views';
import {rhaSql} from '../margin/sql';
import {rows} from '../pricing/rules';
import {gridPage,gridQuery} from '../grid/sql';
import type {GridSpec} from '../grid/core';
import {VaultError} from '../vault/protocol';
import {msg} from '../i18n/core';
export const SCORE_GRID:GridSpec={month:'date',lines:'int',floorKnown:'int',floorMet:'int',targetKnown:'int',targetMet:'int',floorRate:'percent',targetRate:'percent',protectedPoints:'int',possiblePoints:'int'};
export type ScoreInput={view?:'team'|'mine';from?:string;to?:string;offset?:number;grid?:unknown};
const bad=():never=>{throw new VaultError('SCORECARD',msg('cadence.scoreInvalid'));};
export async function optedIn(e:Engine,user:string){return (await rows(e,`SELECT opted_in FROM scorecard_consent WHERE user_id=${Q(user)}`))[0]?.opted_in===true;}
export function consentSql(user:string,optIn:unknown){if(typeof optIn!=='boolean')bad();return `INSERT INTO scorecard_consent(user_id,opted_in,updated_at) VALUES(${Q(user)},${optIn},${Q(new Date().toISOString())}) ON CONFLICT(user_id) DO UPDATE SET opted_in=excluded.opted_in,updated_at=excluded.updated_at;`;}
export async function scorecard(e:Engine,user:string,input:ScoreInput={}){
 const now=new Date(),to=input.to??now.toISOString().slice(0,10),from=input.from??new Date(now.getTime()-89*86400000).toISOString().slice(0,10),view=input.view??'team',optIn=await optedIn(e,user);
 try{validDate(from);validDate(to);if(from>to||Date.parse(to)-Date.parse(from)>1096*86400000||!['team','mine'].includes(view))bad();}catch{return bad();}if(view==='mine'&&!optIn)throw new VaultError('SCORECARD',msg('cadence.optInFirst'));
 const date=`try_cast(substr(q.created_at,1,10) AS DATE)`,scope=`q.status<>'draft' AND ${date} BETWEEN DATE ${Q(from)} AND DATE ${Q(to)} ${view==='mine'?`AND q.created_by=${Q(user)}`:''}`;
 const body=`SELECT strftime(${date},'%Y-%m-01') AS month,count(*)::VARCHAR lines,count(l.floor_cents)::VARCHAR "floorKnown",count(*) FILTER(WHERE l.unit_price_cents>=l.floor_cents)::VARCHAR "floorMet",count(l.target_cents)::VARCHAR "targetKnown",count(*) FILTER(WHERE l.unit_price_cents>=l.target_cents)::VARCHAR "targetMet",
 ${rhaSql("CAST(count(*) FILTER(WHERE l.unit_price_cents>=l.floor_cents) AS HUGEINT)*10000","nullif(count(l.floor_cents),0)")}::VARCHAR "floorBp",${rhaSql("CAST(count(*) FILTER(WHERE l.unit_price_cents>=l.target_cents) AS HUGEINT)*10000","nullif(count(l.target_cents),0)")}::VARCHAR "targetBp",
 (count(*) FILTER(WHERE l.unit_price_cents>=l.floor_cents)+count(*) FILTER(WHERE l.unit_price_cents>=l.target_cents))::VARCHAR "protectedPoints",(count(l.floor_cents)+count(l.target_cents))::VARCHAR "possiblePoints" FROM quote_lines l JOIN quotes q ON q.id=l.quote_id WHERE ${scope} GROUP BY 1`;
 const base=`SELECT * EXCLUDE("floorBp","targetBp"),${bpPercentSql('CAST("floorBp" AS BIGINT)')} "floorRate",${bpPercentSql('CAST("targetBp" AS BIGINT)')} "targetRate" FROM(${body}) b`;
 const page=await gridPage(e,base,SCORE_GRID,gridQuery(SCORE_GRID,input.grid),{limit:50,offset:input.offset??0,fallback:'g.month'});
 const total=(await rows(e,`SELECT coalesce(sum(lines::BIGINT),0)::VARCHAR lines,coalesce(sum("floorKnown"::BIGINT),0)::VARCHAR "floorKnown",coalesce(sum("floorMet"::BIGINT),0)::VARCHAR "floorMet",coalesce(sum("targetKnown"::BIGINT),0)::VARCHAR "targetKnown",coalesce(sum("targetMet"::BIGINT),0)::VARCHAR "targetMet",coalesce(sum("protectedPoints"::BIGINT),0)::VARCHAR "protectedPoints",coalesce(sum("possiblePoints"::BIGINT),0)::VARCHAR "possiblePoints" FROM(${base}) s`))[0];
 const invalid=(await rows(e,`SELECT count(*)::VARCHAR n FROM quote_lines l JOIN quotes q ON q.id=l.quote_id WHERE q.status<>'draft' AND ${date} IS NULL ${view==='mine'?`AND q.created_by=${Q(user)}`:''}`))[0].n;
 const rate=(n:string,d:string)=>d==='0'?null:basisPointsDecimal(rha(BigInt(n)*BigInt(10000),BigInt(d)));
 return {...page,total:{lines:String(total.lines),floorKnown:String(total.floorKnown),floorMet:String(total.floorMet),targetKnown:String(total.targetKnown),targetMet:String(total.targetMet),protectedPoints:String(total.protectedPoints),possiblePoints:String(total.possiblePoints),floorRate:rate(total.floorMet,total.floorKnown),targetRate:rate(total.targetMet,total.targetKnown)},from,to,view,optIn,undatedLines:invalid,offset:input.offset??0};
}
