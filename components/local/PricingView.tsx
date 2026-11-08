"use client";
import {PriceGrid,LandedCheck,WhatIfSlider,ScopeText} from './PricingTools';
import {SectionTabs} from "@/components/ui/ui";
import {PricingOperations,type OpsTab} from "./PricingOps";

import { useEffect,useState } from 'react';
import type { VaultClient } from '@/lib/vault/client';
import type { Results } from '@/lib/vault/protocol';
import type { Cap } from '@/lib/roles/access';
import type { Preview } from '@/lib/pricing/rules';
import { PROFILE_IDS,PROFILES,type ErpProfile } from '@/lib/studio/mapper';
import { fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
import styles from './vault.module.css';
import { DataGrid } from "@/components/ui/DataGrid";
import type { GridQuery } from "@/lib/grid/core";
const GUARD_TEXT=()=>({red:t("pricing.redBelowFloor"),yellow:t("pricing.yellowOwnerReview"),green:t("pricing.greenOnTarget"),unset:t("pricing.noGuardrail")});
export function download(name:string,blob:Blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const money=(v:string|null)=>v===null?t("pricing.unknown"):fmt.currency(v);
const GUARD_FIELD:Record<'tier'|'category'|'start'|'target'|'floor',MessageKey>={tier:"pricing.customerTier",category:"pricing.productCategory",start:"pricing.startPrice",target:"pricing.targetPrice",floor:"pricing.floorPrice"};
const RULE_FIELD:Record<'name'|'category'|'vendor'|'threshold'|'increase',MessageKey>={name:"pricing.ruleName",category:"pricing.ruleCategory",vendor:"pricing.costSourceSupplier",threshold:"pricing.costRiseThreshold",increase:"pricing.priceIncrease"};
const RUN_STATUS:Record<string,MessageKey>={preview:"pricing.status.preview",approved:"pricing.status.approved",exported:"pricing.status.exported"};
const runStatus=(s:string)=>s in RUN_STATUS?t(RUN_STATUS[s]):s;
function PricingRulesView({client,userId,caps,busy,operation,refresh,initialPreview,tier}:{client:VaultClient;userId:string;caps:Cap[];busy:boolean;operation:(f:()=>Promise<void>)=>Promise<void>;refresh:()=>Promise<void>;initialPreview?:Preview|null;tier?:import("@/lib/vault/protocol").Tier}){
 const [state,setState]=useState<Results['pricingState']|null>(null),[owner,setOwner]=useState(''),[g,setG]=useState({tier:'T01',category:'Valves',start:'15000',target:'10000',floor:'5000'});
 const [rule,setRule]=useState({name:t("pricing.passThroughSupplierCost") as string,category:'Valves',vendor:'SteelWorks',threshold:'5',increase:'4.5'}),[needsSave,setNeedsSave]=useState(false),[ruleId,setRuleId]=useState(''),[p,setP]=useState<Preview|null>(initialPreview??null),[pq,setPq]=useState<GridQuery>({}),[profile,setProfile]=useState<ErpProfile>('generic'),[format,setFormat]=useState<'csv'|'xlsx'>('csv'),[note,setNote]=useState('');
 useEffect(()=>{setPq({});},[p?.id]);
 const load=async()=>setState(await client.call('pricingState',{}));
 useEffect(()=>{void load().catch(()=>setNote(msg("pricing.couldNotLoadPricing")));},[client]);
 const run=(work:()=>Promise<void>)=>void operation(async()=>{await work();await load();await refresh();});
 return <><p role="status">{say(note)}</p><section className={styles.card}><h2>{t("pricing.pricingOwner")}</h2><p>{state?.owner?t("pricing.isAccountableForApproving", { name: state.owner.name }):t("pricing.nameAPricingOwner")}</p>
 {caps.includes('roles')&&<><label>{t("pricing.pricingOwnerName")}<input value={owner} onChange={e=>setOwner(e.target.value)} maxLength={160}/></label><button disabled={busy||!owner} onClick={()=>run(async()=>{await client.call('pricingOwner',{name:owner,userId,backupDays:7});setNote(msg("pricing.pricingOwnerSaved"));})}>{t("pricing.nameMeAsPricing")}</button></>}</section>
 <section className={styles.card}><h2>{caps.includes('pricing')?t("pricing.priceGuardrails"):t("pricing.priceFloors")}</h2><p>{t("pricing.unitPricesInCents")}</p>
 {caps.includes('pricing')&&<div className={styles.grid}>{(['tier','category','start','target','floor'] as const).map(k=><label key={k}>{t(GUARD_FIELD[k])}<input value={g[k]} onChange={e=>setG({...g,[k]:e.target.value})}/></label>)}</div>}
 {caps.includes('pricing')&&<button disabled={busy} onClick={()=>run(async()=>{await client.call('guardSet',{input:g});setNote(msg("pricing.guardrailsSaved"));})}>{t("pricing.saveGuardrails")}</button>}
 {!!state?.guards.length&&<ul className={styles.guardList}>{state.guards.map(x=><li key={x.tier+'|'+x.category}>{t("pricing.guardLine", { tier: x.tier, category: x.category, start: money(x.start), target: money(x.target), floor: money(x.floor) })}</li>)}</ul>}</section>
 {caps.includes('pricing')&&<section className={styles.card}><h2>{t("pricing.costRisePriceChange")}</h2><p>{t("pricing.ifASupplierS")}</p>
 <div className={styles.grid}>{(['name','category','vendor','threshold','increase'] as const).map(k=><label key={k}>{t(RULE_FIELD[k])}<input value={rule[k]} onChange={e=>{setNeedsSave(true);setRule({...rule,[k]:e.target.value});}}/></label>)}</div>
 <button disabled={busy} onClick={()=>run(async()=>{const saved=await client.call('ruleSave',{input:{...rule,...(ruleId?{id:ruleId}:{})}});setRuleId(saved.id);setNeedsSave(false);setP(null);setNote(msg("pricing.ruleVersionSaved"));})}>{t("pricing.saveRuleVersion")}</button>
 <label>{t("pricing.savedRule")}<select aria-label={t("pricing.savedRule")} value={ruleId} onChange={e=>{setRuleId(e.target.value);setNeedsSave(false);setP(null);const r=state?.rules.find(r=>r.id===e.target.value);if(r){const d=JSON.parse(r.definition);setRule({name:r.name,category:d.category,vendor:d.vendor,threshold:String(Number(d.threshold)/100),increase:String(Number(d.increase)/100)});}}}><option value="">{t("pricing.chooseARule")}</option>{state?.rules.map(r=><option key={r.id} value={r.id}>{t("pricing.version", { name: r.name, version: Number(r.version) })}</option>)}</select></label>
 <button className={!p?styles.primary:undefined} disabled={busy||!ruleId||needsSave} onClick={()=>run(async()=>{const result=await client.call('ruleSimulate',{id:ruleId});setP(result);setNote(msg("pricing.simulationReadyReviewChanges"));})}>{t("pricing.simulatePriceChange")}</button></section>}
 {caps.includes('pricing')&&tier!=='starter'&&<WhatIfSlider client={client} id={ruleId} increase={rule.increase} onChange={v=>{setNeedsSave(true);setRule(r=>({...r,increase:v}));}}/>}
 {caps.includes('pricing')&&p&&<section className={styles.card}><h2>{t("pricing.changePreview")}</h2><p>{say(p.explanation)}</p><p>{t("pricing.skuTierPairsEstimated", { count: Number(p.count), impact: money(p.impact) })}</p>
 <p>{p.status==='preview'?t("pricing.livePricesAreUnchanged"):t("pricing.runIs", { status: runStatus(p.status) })}</p><DataGrid label={t("pricing.changePreview")} testId="preview-table" rows={p.rows} rowKey={r=>r.rowKey??r.product+'|'+r.tier} remote={{query:pq,onQuery:q=>{setPq(q);run(async()=>setP(await client.call('rulePreview',{id:p.id,offset:0,grid:q})));},meta:p.grid,fetch:q=>client.call('rulePreview',{id:p.id,offset:0,grid:q}).then(v=>v.grid!)}} columns={[
  {id:'product',name:t("pricing.skuTier"),value:r=>r.product,cell:r=><span translate="no">{r.product} / {r.tier}{r.scope&&<small><ScopeText value={r.scope}/></small>}</span>},
  {id:'tier',name:t("pricing.customerTier"),value:r=>r.tier,cell:r=><span translate="no">{r.tier}</span>},
  {id:'before',name:t("pricing.before"),type:'money',value:r=>r.before},
  {id:'after',name:t("pricing.after"),type:'money',value:r=>r.after},
  {id:'cost',name:t("pricing.cost"),type:'money',value:r=>r.cost},
  {id:'after_margin',name:t("pricing.unitMarginBeforeAfter"),type:'money',value:r=>r.afterMargin,cell:r=><>{money(r.beforeMargin)} / {money(r.afterMargin)}</>},
  {id:'guard',name:t("pricing.guardrail"),value:r=>r.guard,label:v=>GUARD_TEXT()[v as keyof ReturnType<typeof GUARD_TEXT>]??v,cell:r=><span style={{color:r.guard==='red'?'var(--bad-text)':r.guard==='yellow'?'var(--warn-text)':r.guard==='green'?'var(--ok-text)':undefined}}>{GUARD_TEXT()[r.guard as keyof ReturnType<typeof GUARD_TEXT>]}</span>},
 ]}/>
 <button disabled={busy||p.offset===0} onClick={()=>run(async()=>setP(await client.call('rulePreview',{id:p.id,offset:p.offset-50,grid:pq})))}>{t("pricing.previous50")}</button><button disabled={busy||p.offset+50>=Number(p.grid?.matched??p.count)} onClick={()=>run(async()=>setP(await client.call('rulePreview',{id:p.id,offset:p.offset+50,grid:pq})))}>{t("pricing.next50")}</button>
 {p.status==='preview'&&<button className={styles.primary} disabled={busy||state?.owner?.id!==userId||p.red!=='0'} onClick={()=>run(async()=>{const r=await client.call('ruleApprove',{id:p.id});setP(r.preview);setNote(msg(r.backup.error?"pricing.approvedAndSavedBackup":"pricing.approvedVersionedAndSaved"));})}>{t("pricing.approveAsPricingOwner")}</button>}
 {p.status!=='preview'&&<><h3>{t("pricing.exportStudio")}</h3><label>{t("pricing.erpExportLayout")}<select value={profile} onChange={e=>setProfile(e.target.value as ErpProfile)}>{PROFILE_IDS.map(id=><option key={id} value={id}>{say(PROFILES[id].label)}</option>)}</select></label><p>{t("pricing.everyLayoutIsUnverified")}</p><label>{t("pricing.exportFormat")}<select value={format} onChange={e=>setFormat(e.target.value as 'csv'|'xlsx')}><option>csv</option><option>xlsx</option></select></label><button className={styles.primary} disabled={busy} onClick={()=>run(async()=>{const r=await client.call('priceExport',{id:p.id,profile,format});download(r.name,r.blob);download(r.logName,r.log);setNote(r.warning);setP(await client.call('rulePreview',{id:p.id}));})}>{t("pricing.exportPricesAndChange")}</button></>}
 </section>}
 {caps.includes('pricing')&&<section className={styles.card}><h2>{t("pricing.runHistory")}</h2>{!state?.runs.length?<p>{t("pricing.noSimulationsYet")}</p>:state.runs.map(r=><p key={r.id}>{fmt.date(r.run_date.slice(0,10))}{" "}{t("pricing.pairs", { count: Number(r.affected), status: runStatus(r.status) })}{" "}<button disabled={busy} onClick={()=>run(async()=>setP(await client.call('rulePreview',{id:r.id})))}>{t("pricing.reviewRun")}</button></p>)}</section>}</>;
}
export function PricingView(props:Parameters<typeof PricingRulesView>[0]){
 const [tab,setTab]=useState<'rules'|'grid'|'landed'|OpsTab>('rules'),[draft,setDraft]=useState<Preview|null>(null);
 const canOps=props.caps.includes('pricing')&&(props.tier==='professional'||props.tier==='scale'),shown=tab==='grid'&&props.caps.includes('pricing')?'grid':canOps?tab:'rules';
 const tabs=[{id:'rules',label:t('ops.rules'),href:'#pricing'},...(props.caps.includes('pricing')?[{id:'grid',label:t('pc2.grid'),href:'#pricing'}]:[]),...(canOps?([{id:'landed',label:t('pc2.landed'),href:'#pricing'},{id:'planner',label:t('ops.planner'),href:'#pricing'},{id:'versions',label:t('ops.versions'),href:'#pricing'},{id:'exceptions',label:t('ops.exceptions'),href:'#pricing'},{id:'expiry',label:t('ops.expiry'),href:'#pricing'}]):[])];
 useEffect(()=>{const read=()=>{const id=location.hash.replace('#pricing-','');setTab(['grid','landed','planner','versions','exceptions','expiry'].includes(id)?id as typeof tab:'rules');};read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read);},[]);
 return <><SectionTabs items={tabs.map(v=>({...v,href:'#pricing-'+v.id,testId:'ops-tab-'+v.id}))} current={shown} label={t('ops.rules')} onSelect={id=>setTab(id as typeof tab)}/>{shown==='grid'?<PriceGrid client={props.client} onReview={p=>{setDraft(p);setTab('rules');location.hash='pricing-rules';}}/>:shown==='landed'?<LandedCheck client={props.client}/>:shown==='rules'?<PricingRulesView {...props} initialPreview={draft}/>:<PricingOperations client={props.client} tab={shown} busy={props.busy} operation={props.operation} refresh={props.refresh} onReview={p=>{setDraft(p);setTab('rules');location.hash='pricing-rules';}}/>}</>;
}
