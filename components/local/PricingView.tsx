"use client";
import {PriceGrid,LandedCheck,WhatIfSlider,ScopeText} from './PricingTools';
import {Badge,Button,Card,Checkbox,Field,Notice} from "@/components/ui/ui";
import {PricingOperations,type OpsTab} from "./PricingOps";
import {ExportLayoutEditor,useExportLayouts} from "./ExportLayouts";

import { useEffect,useState } from 'react';
import type { VaultClient } from '@/lib/vault/client';
import type { Results } from '@/lib/vault/protocol';
import type { Cap } from '@/lib/roles/access';
import type { Preview } from '@/lib/pricing/rules';
import { PROFILE_IDS,PROFILES,type ErpProfile } from '@/lib/studio/mapper';
import { fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
import styles from './vault.module.css';
import { DataGrid } from "@/components/ui/DataGrid";
import { useSharedLock } from "./sharedLock";
import type { GridQuery } from "@/lib/grid/core";
const GUARD_TEXT=()=>({red:t("pricing.redBelowFloor"),yellow:t("pricing.yellowOwnerReview"),green:t("pricing.greenOnTarget"),unset:t("pricing.noGuardrail")});
export function download(name:string,blob:Blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const money=(v:string|null)=>v===null?t("pricing.unknown"):fmt.currency(v);
const GUARD_FIELD:Record<'tier'|'category'|'start'|'target'|'floor',MessageKey>={tier:"pricing.customerTier",category:"pricing.productCategory",start:"pricing.startPrice",target:"pricing.targetPrice",floor:"pricing.floorPrice"};
const RULE_FIELD:Record<'name'|'category'|'vendor'|'threshold'|'increase',MessageKey>={name:"pricing.ruleName",category:"pricing.ruleCategory",vendor:"pricing.costSourceSupplier",threshold:"pricing.costRiseThreshold",increase:"pricing.priceIncrease"};
const RUN_STATUS:Record<string,MessageKey>={preview:"pricing.status.preview",approved:"pricing.status.approved",exported:"pricing.status.exported"};
const runStatus=(s:string)=>s in RUN_STATUS?t(RUN_STATUS[s]):s;
function PricingRulesView({client,userId,caps,busy,operation,refresh,initialPreview,tier}:{client:VaultClient;userId:string;caps:Cap[];busy:boolean;operation:(f:()=>Promise<void>)=>Promise<void>;refresh:()=>Promise<void>;initialPreview?:Preview|null;tier?:import("@/lib/vault/protocol").Tier}){
 const lock=useSharedLock(),guardLock=lock("guardSet"),approveLock=lock("ruleApprove");
 const [state,setState]=useState<Results['pricingState']|null>(null),[owner,setOwner]=useState(''),[g,setG]=useState({tier:'T01',category:'Valves',start:'15000',target:'10000',floor:'5000',protectedFloor:false});
 const [rule,setRule]=useState({name:t("pricing.passThroughSupplierCost") as string,category:'Valves',vendor:'SteelWorks',threshold:'5',increase:'4.5'}),[needsSave,setNeedsSave]=useState(false),[ruleId,setRuleId]=useState(''),[p,setP]=useState<Preview|null>(initialPreview??null),[pq,setPq]=useState<GridQuery>({}),[profile,setProfile]=useState<string>('generic'),[format,setFormat]=useState<'csv'|'xlsx'>('csv'),[note,setNote]=useState('');
 useEffect(()=>{setPq({});},[p?.id]);
 // Roadmap 15.6: the workspace's own layouts sit beside the six built-in ones as "custom:<id>".
 const [layoutList,setLayoutList]=useExportLayouts(client,caps.includes('export'));
 const custom=profile.startsWith('custom:')?profile.slice(7):null;
 const load=async()=>setState(await client.call('pricingState',{}));
 useEffect(()=>{void load().catch(()=>setNote(msg("pricing.couldNotLoadPricing")));},[client]);
 const run=(work:()=>Promise<void>)=>void operation(async()=>{await work();await load();await refresh();});
 return <><p role="status">{say(note)}</p><Card title={t("pricing.pricingOwner")}><p>{state?.owner?t("pricing.isAccountableForApproving", { name: state.owner.name }):t("pricing.nameAPricingOwner")}</p>
 {caps.includes('roles')&&<><Field label={t("pricing.pricingOwnerName")}><input value={owner} onChange={e=>setOwner(e.target.value)} maxLength={160}/></Field><Button disabled={busy||!owner} onClick={()=>run(async()=>{await client.call('pricingOwner',{name:owner,userId,backupDays:7});setNote(msg("pricing.pricingOwnerSaved"));})}>{t("pricing.nameMeAsPricing")}</Button></>}</Card>
 <Card title={caps.includes('pricing')?t("pricing.priceGuardrails"):t("pricing.priceFloors")} description={t("pricing.unitPricesInCents")}>
 {caps.includes('pricing')&&<div className={styles.grid}>{(['tier','category','start','target','floor'] as const).map(k=><Field key={k} label={t(GUARD_FIELD[k])}><input value={g[k]} onChange={e=>setG({...g,[k]:e.target.value})}/></Field>)}</div>}
 {caps.includes('pricing')&&<Checkbox label={t("pricing.protectedFloor")} hint={t("pricing.protectedFloorHint")} checked={g.protectedFloor} onChange={e=>setG({...g,protectedFloor:e.target.checked})} data-testid="guard-protected-floor"/>}
 {caps.includes('pricing')&&<Button disabled={busy||!!guardLock} title={guardLock??undefined} data-testid="guard-save" onClick={()=>run(async()=>{await client.call('guardSet',{input:g});setNote(msg("pricing.guardrailsSaved"));})}>{t("pricing.saveGuardrails")}</Button>}
 {!!state?.guards.length&&<ul className={styles.guardList}>{state.guards.map(x=><li key={x.tier+'|'+x.category}>{t("pricing.guardLine", { tier: x.tier, category: x.category, start: money(x.start), target: money(x.target), floor: money(x.floor) })}{caps.includes('cost')&&x.protectedFloor?' '+t("pricing.protectedMark"):''}</li>)}</ul>}</Card>
 {caps.includes('pricing')&&<Card title={t("pricing.costRisePriceChange")} description={t("pricing.ifASupplierS")}>
 <div className={styles.grid}>{(['name','category','vendor','threshold','increase'] as const).map(k=><Field key={k} label={t(RULE_FIELD[k])}><input value={rule[k]} onChange={e=>{setNeedsSave(true);setRule({...rule,[k]:e.target.value});}}/></Field>)}</div>
 <Button disabled={busy} onClick={()=>run(async()=>{const saved=await client.call('ruleSave',{input:{...rule,...(ruleId?{id:ruleId}:{})}});setRuleId(saved.id);setNeedsSave(false);setP(null);setNote(msg("pricing.ruleVersionSaved"));})}>{t("pricing.saveRuleVersion")}</Button>
 <Field label={t("pricing.savedRule")}><select aria-label={t("pricing.savedRule")} value={ruleId} onChange={e=>{setRuleId(e.target.value);setNeedsSave(false);setP(null);const r=state?.rules.find(r=>r.id===e.target.value);if(r){const d=JSON.parse(r.definition);setRule({name:r.name,category:d.category,vendor:d.vendor,threshold:String(Number(d.threshold)/100),increase:String(Number(d.increase)/100)});}}}><option value="">{t("pricing.chooseARule")}</option>{state?.rules.map(r=><option key={r.id} value={r.id}>{t("pricing.version", { name: r.name, version: Number(r.version) })}</option>)}</select></Field>
 <Button variant={!p?'primary':'secondary'} disabled={busy||!ruleId||needsSave} onClick={()=>run(async()=>{const result=await client.call('ruleSimulate',{id:ruleId});setP(result);setNote(msg("pricing.simulationReadyReviewChanges"));})}>{t("pricing.simulatePriceChange")}</Button></Card>}
 {caps.includes('pricing')&&tier!=='starter'&&<WhatIfSlider client={client} id={ruleId} increase={rule.increase} onChange={v=>{setNeedsSave(true);setRule(r=>({...r,increase:v}));}}/>}
 {caps.includes('pricing')&&p&&<Card title={t("pricing.changePreview")}><p>{say(p.explanation)}</p><p>{t("pricing.skuTierPairsEstimated", { count: Number(p.count), impact: money(p.impact) })}</p>
 <p>{p.status==='preview'?t("pricing.livePricesAreUnchanged"):t("pricing.runIs", { status: runStatus(p.status) })}</p><DataGrid label={t("pricing.changePreview")} testId="preview-table" rows={p.rows} rowKey={r=>r.rowKey??r.product+'|'+r.tier} remote={{query:pq,onQuery:q=>{setPq(q);run(async()=>setP(await client.call('rulePreview',{id:p.id,offset:0,grid:q})));},meta:p.grid,fetch:q=>client.call('rulePreview',{id:p.id,offset:0,grid:q}).then(v=>v.grid!)}} columns={[
  {id:'product',name:t("pricing.skuTier"),value:r=>r.product,cell:r=><span translate="no">{r.product} / {r.tier}{r.scope&&<small><ScopeText value={r.scope}/></small>}</span>},
  {id:'tier',name:t("pricing.customerTier"),value:r=>r.tier,cell:r=><span translate="no">{r.tier}</span>},
  {id:'before',name:t("pricing.before"),type:'money',value:r=>r.before},
  {id:'after',name:t("pricing.after"),type:'money',value:r=>r.after},
  {id:'cost',name:t("pricing.cost"),type:'money',value:r=>r.cost},
  {id:'after_margin',name:t("pricing.unitMarginBeforeAfter"),type:'money',value:r=>r.afterMargin,cell:r=><>{money(r.beforeMargin)} / {money(r.afterMargin)}</>},
  {id:'guard',name:t("pricing.guardrail"),value:r=>r.guard,label:v=>GUARD_TEXT()[v as keyof ReturnType<typeof GUARD_TEXT>]??v,cell:r=>{const tone=r.guard==='red'?'bad':r.guard==='yellow'?'warn':r.guard==='green'?'ok':null,text=GUARD_TEXT()[r.guard as keyof ReturnType<typeof GUARD_TEXT>];return tone?<Badge tone={tone}>{text}</Badge>:<span>{text}</span>;}},
 ]}/>
 <div className={styles.row}><Button disabled={busy||p.offset===0} onClick={()=>run(async()=>setP(await client.call('rulePreview',{id:p.id,offset:p.offset-50,grid:pq})))}>{t("pricing.previous50")}</Button><Button disabled={busy||p.offset+50>=Number(p.grid?.matched??p.count)} onClick={()=>run(async()=>setP(await client.call('rulePreview',{id:p.id,offset:p.offset+50,grid:pq})))}>{t("pricing.next50")}</Button></div>
 {p.status==='preview'&&<Button variant="primary" disabled={busy||state?.owner?.id!==userId||p.red!=='0'||!!approveLock} title={approveLock??undefined} onClick={()=>run(async()=>{const r=await client.call('ruleApprove',{id:p.id});setP(r.preview);setNote(msg(r.backup.error?"pricing.approvedAndSavedBackup":"pricing.approvedVersionedAndSaved"));})}>{t("pricing.approveAsPricingOwner")}</Button>}
 {p.status!=='preview'&&<><h3>{t("pricing.exportStudio")}</h3><Field label={t("pricing.erpExportLayout")}><select value={profile} onChange={e=>setProfile(e.target.value)} data-testid="export-profile">{PROFILE_IDS.map(id=><option key={id} value={id}>{say(PROFILES[id].label)}</option>)}{layoutList.map(l=><option key={l.id} value={'custom:'+l.id} translate="no">{l.name}</option>)}</select></Field><Notice tone="warn">{t("pricing.everyLayoutIsUnverified")}</Notice><Field label={t("pricing.exportFormat")}><select value={format} onChange={e=>setFormat(e.target.value as 'csv'|'xlsx')}><option>csv</option><option>xlsx</option></select></Field><Button variant="primary" disabled={busy} onClick={()=>run(async()=>{const r=await client.call('priceExport',{id:p.id,profile:custom?'generic':profile as ErpProfile,format,...(custom?{layout:custom}:{})});download(r.name,r.blob);download(r.logName,r.log);setNote(r.warning);setP(await client.call('rulePreview',{id:p.id}));})}>{t("pricing.exportPricesAndChange")}</Button></>}
 </Card>}
 {caps.includes('export')&&<ExportLayoutEditor client={client} busy={busy} run={run} list={layoutList} setList={l=>{setLayoutList(l);if(custom&&!l.some(x=>x.id===custom))setProfile('generic');}}/>}
 {caps.includes('pricing')&&<Card title={t("pricing.runHistory")}>{!state?.runs.length?<p>{t("pricing.noSimulationsYet")}</p>:state.runs.map(r=><p key={r.id}>{fmt.date(r.run_date.slice(0,10))}{" "}{t("pricing.pairs", { count: Number(r.affected), status: runStatus(r.status) })}{" "}<Button size="sm" disabled={busy} onClick={()=>run(async()=>setP(await client.call('rulePreview',{id:r.id})))}>{t("pricing.reviewRun")}</Button></p>)}</Card>}</>;
}

export function PricingView(props:Parameters<typeof PricingRulesView>[0]){
 const [tab,setTab]=useState<'rules'|'grid'|'landed'|OpsTab>('rules'),[draft,setDraft]=useState<Preview|null>(null);
 const canOps=props.caps.includes('pricing')&&(props.tier==='professional'||props.tier==='scale'),shown=tab==='grid'&&props.caps.includes('pricing')?'grid':canOps?tab:'rules';
 useEffect(()=>{const read=()=>{const id=location.hash.replace('#pricing-','');setTab(['grid','landed','planner','versions','exceptions','expiry'].includes(id)?id as typeof tab:'rules');};read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read);},[]);
 return <>{shown==='grid'?<PriceGrid client={props.client} onReview={p=>{setDraft(p);setTab('rules');location.hash='pricing-rules';}}/>:shown==='landed'?<LandedCheck client={props.client}/>:shown==='rules'?<PricingRulesView {...props} initialPreview={draft}/>:<PricingOperations client={props.client} tab={shown} busy={props.busy} operation={props.operation} refresh={props.refresh} onReview={p=>{setDraft(p);setTab('rules');location.hash='pricing-rules';}}/>}</>;
}
