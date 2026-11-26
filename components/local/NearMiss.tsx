"use client";
// Near-miss rebate tiers (blueprint section 22, item 39): three grid columns and the "close to the next
// tier" line shared by customer and supplier rebate progress. Values come from lib/rebate/nearmiss.ts.
import type {GridColumn} from '@/components/ui/DataGrid';
import type {GridQuery} from '@/lib/grid/core';
import {NEAR,type NearMiss,type Outlook} from '@/lib/rebate/nearmiss';
import {fmt,t} from '@/lib/i18n';
import {Button,Notice} from '@/components/ui/ui';

const outlookKeys={on_pace:'near.onPace',within_reach:'near.withinReach',far:'near.far',reached:'near.reached',upcoming:'near.upcoming',ended:'near.ended',not_tiered:'near.notTiered'} as const satisfies Record<Outlook,string>;
export const outlookLabel=(v:string)=>t(outlookKeys[v as Outlook]??'near.ended');
/** The grid query behind "Show them": near rows only, largest extra rebate first. */
export const NEAR_QUERY:GridQuery={filters:[{col:'outlook',values:[...NEAR]}],sort:{col:'extra',dir:'desc'}};
export const isNearQuery=(q:GridQuery)=>q.filters?.length===1&&q.filters[0].col==='outlook'&&q.filters[0].values.length===NEAR.length&&NEAR.every(v=>q.filters![0].values.includes(v));

export function nearColumns<R extends NearMiss>():GridColumn<R>[]{
 return [
  {id:'extra',name:t('near.extra'),type:'money',value:r=>r.extra,cell:r=>r.extra===null?t('common.notApplicable'):<span data-testid="near-extra">{fmt.currency(r.extra)}</span>},
  {id:'daysLeft',name:t('near.daysLeft'),type:'int',value:r=>r.daysLeft,cell:r=>r.daysLeft===null?t('common.notApplicable'):fmt.int(r.daysLeft)},
  {id:'outlook',name:t('near.outlook'),value:r=>r.outlook,label:outlookLabel,cell:r=><><span data-testid="near-outlook" data-outlook={r.outlook}>{outlookLabel(r.outlook)}</span>{r.perDay!==null&&['on_pace','within_reach','far','upcoming'].includes(r.outlook)&&<p>{t('near.perDay',{amount:fmt.currency(r.perDay)})}</p>}</>},
 ];
}

/** One line above a progress grid: how many programmes are close to their next tier, and a filter to them. */
export function NearBanner({near,query,onQuery,disabled}:{near:{count:string;extra:string}|undefined;query:GridQuery;onQuery:(q:GridQuery)=>void;disabled?:boolean}){
 if(!near||near.count==='0')return null;
 const on=isNearQuery(query);
 return <Notice data-testid="near-banner" actions={<Button size="sm" data-testid="near-show" disabled={disabled} onClick={()=>onQuery(on?{}:NEAR_QUERY)}>{t(on?'near.showAll':'near.show')}</Button>}>
  <p>{t('near.summary',{count:fmt.int(near.count),amount:fmt.currency(near.extra)})}</p><p>{t('near.help')}</p></Notice>;
}
