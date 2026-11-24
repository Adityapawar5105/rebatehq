"use client";
// Cash leak and customer health (7C-3b). Home shows the two headline numbers; the full customer health
// list lives in its own Margin tab (#margin-health) as a grid-standard table. Every number comes from the
// worker's cost-gated `homeMonitor` command; this file only draws.
import {useEffect,useState} from 'react';
import type {VaultClient} from '@/lib/vault/client';
import type {Results} from '@/lib/vault/protocol';
import type {CustomerAlert} from '@/lib/margin/monitor';
import {minorUnits} from '@/lib/spike/exact';
import {basisPointsDecimal} from '@/lib/margin/decimal';
import {fmt,say,t} from '@/lib/i18n';
import {Badge,Button,ButtonLink,Card,DataTable,Dialog,EmptyState,Field,Grid,Notice,Skeleton,StatTile,uiStyles as ui} from '@/components/ui/ui';
import {DataGrid} from '@/components/ui/DataGrid';
import type {SampleState} from '@/lib/studio/playground';
type View=Results['homeMonitor'];
type MathTarget='leak'|CustomerAlert|null;
const money=(v:string)=>fmt.currency(v);
const bpPercent=(v:string|null)=>v===null?t('common.unknown'):fmt.percent(basisPointsDecimal(BigInt(v)));
const bpValue=(v:string|null)=>v===null?null:basisPointsDecimal(BigInt(v));
const SIGNAL={margin:'monitor.signal.margin',orders:'monitor.signal.orders',both:'monitor.signal.both'} as const;
const signalOf=(a:CustomerAlert):keyof typeof SIGNAL=>a.marginDrop&&a.frequencyDrop?'both':a.marginDrop?'margin':'orders';
function useMonitor(client:VaultClient,version:string,thresholdBp:string,tick:number){
 const [view,setView]=useState<View|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 useEffect(()=>{let active=true;setBusy(true);setError('');void client.call('homeMonitor',{thresholdBp}).then(v=>{if(active)setView(v);}).catch(e=>{if(!active)return;// Team sharing S2b: a role that just lost cost (a joined rep) is refused; the card hides instead of reporting a failure.
if((e as {code?:string})?.code==='FORBIDDEN'){setView(null);return;}setError(t('monitor.failed'));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[client,version,thresholdBp,tick]);
 return {view,error,busy,setError};
}
/** Home: the 90-day cash leak and how many customers need attention, with links to the detail. */
export function HomeMonitor({client,version,sample}:{client:VaultClient;version:string;sample?:SampleState}){
 const {view,error,busy}=useMonitor(client,version,'500',0),[math,setMath]=useState<MathTarget>(null);
 const flagged=view?view.health.count:'0',sampled=sample==='only'||sample==='mixed';
 // Checks run only while the app is open: each Home figure says when it was last checked (20 Nov 2026).
 const checked=(id:string)=>view&&<p className={ui.cardDesc} data-testid={id}>{t('monitor.homeChecked',{date:fmt.dateTime(view.checkedAt)})}</p>;
 return <>
 <Grid min={300} className={ui.cardRow}>
 <Card title={t('monitor.cashLeak')} description={t('monitor.windowHelp')} data-testid="cash-leak" aria-busy={busy} actions={sampled?<Badge tone="info" data-testid="cash-leak-sample">{t('monitor.sampleBadge')}</Badge>:undefined}>
  {error&&<Notice tone="warn" role="alert">{error}</Notice>}
  {!view?!error&&<Skeleton/>:<><StatTile wide icon="coins" tone="warn" label={t('monitor.window',{from:fmt.date(view.health.window.from),to:fmt.date(view.health.window.to)})} value={money(view.leaks.dedupedCents)} valueProps={{'data-testid':'cash-leak-value'}}/>{checked('cash-leak-checked')}
  <div className={ui.actionRow}><Button disabled={busy} onClick={()=>setMath('leak')}>{t('monitor.showMath')}</Button><ButtonLink variant="ghost" href="#margin" icon="chart">{t('home.openMargin')}</ButtonLink></div></>}
 </Card>
 <Card title={t('monitor.health')} description={t('monitor.homeHealthHelp')} data-testid="home-health" aria-busy={busy}>
  {error&&<Notice tone="warn" role="alert" data-testid="home-health-error">{error}</Notice>}
  {!view?!error&&<Skeleton/>:view&&<><StatTile wide icon="users" tone={flagged==='0'?'ok':'warn'} label={t('monitor.summaryAlerted')} value={fmt.int(flagged)} valueProps={{'data-testid':'home-health-count'}} hint={flagged==='0'?t('monitor.noAlerts'):t('monitor.homeHealthHint')}/>{checked('home-health-checked')}
  <div className={ui.actionRow}><ButtonLink variant="primary" href="#margin-health" icon="users">{t('monitor.openHealth')}</ButtonLink></div></>}
 </Card>
 </Grid>
 <MathDialog view={view} math={math} onClose={()=>setMath(null)}/>
 </>;
}
/** Margin > Customer health: threshold, headline counts and one row per flagged customer. */
export function CustomerHealthView({client,version}:{client:VaultClient;version:string}){
 const [points,setPoints]=useState('5'),[request,setRequest]=useState({thresholdBp:'500',tick:0}),[math,setMath]=useState<MathTarget>(null);
 const {view,error,busy,setError}=useMonitor(client,version,request.thresholdBp,request.tick);
 const alerts=view?.health.alerts??[],marginCount=alerts.filter(a=>a.marginDrop).length,orderCount=alerts.filter(a=>a.frequencyDrop).length;
 return <>
 <Card headingId="health-heading" title={t('monitor.health')} description={t('monitor.openOnly')} data-testid="customer-health" aria-busy={busy}>
 <form className={ui.toolbar} onSubmit={e=>{e.preventDefault();try{const thresholdBp=String(minorUnits(points));if(!/^\d+$/.test(thresholdBp)||BigInt(thresholdBp)>BigInt(10000))throw Error();setRequest(v=>({thresholdBp,tick:v.tick+1}));}catch{setError(t('monitor.badThreshold'));}}}>
 <Field label={t('monitor.threshold')} hint={t('monitor.thresholdHelp')}><input data-testid="health-threshold" inputMode="decimal" value={points} onChange={e=>setPoints(e.target.value)} maxLength={8} required/></Field>
 <Button variant="primary" type="submit" icon="search" disabled={busy}>{t('monitor.checkNow')}</Button>
 {view&&<span className={ui.toolbarNote} data-testid="health-last-checked">{t('monitor.lastChecked',{date:fmt.dateTime(view.checkedAt)})}</span>}
 </form>
 {error&&<Notice tone="warn" role="alert">{error}</Notice>}
 {!view?!error&&<Skeleton lines={4}/>:view&&<>
 <Grid min={200} className={ui.kpis}>
  <StatTile icon="users" tone={view.health.count==='0'?'ok':'warn'} label={t('monitor.summaryAlerted')} value={fmt.int(view.health.count)} valueProps={{'data-testid':'health-count'}}/>
  <StatTile icon="trend" tone={marginCount?'bad':'ok'} label={t('monitor.summaryMargin')} value={fmt.int(String(marginCount))}/>
  <StatTile icon="inbox" tone={orderCount?'warn':'ok'} label={t('monitor.summaryOrders')} value={fmt.int(String(orderCount))}/>
 </Grid>
 {view.health.missingInvoiceIds!=='0'&&<Notice tone="warn">{t('monitor.missingIds',{count:fmt.int(view.health.missingInvoiceIds)})}</Notice>}
 {!alerts.length?<EmptyState icon="checkCircle" title={t('monitor.noAlerts')}/>:<>
 {Number(view.health.count)>alerts.length&&<p className={ui.cardDesc}>{t('monitor.alertCount',{shown:fmt.int(String(alerts.length)),total:fmt.int(view.health.count)})}</p>}
 <DataGrid label={t('monitor.health')} testId="health-alerts" tall rows={alerts} rowKey={a=>a.customer} rowProps={()=>({'data-testid':'health-alert'})} columns={[
  {id:'customer',name:t('monitor.col.customer'),value:a=>a.customer,cell:a=><span translate="no"><strong>{a.customer}</strong>{a.name&&a.name!==a.customer?<span className={ui.subText}>{a.name}</span>:null}</span>},
  {id:'signal',name:t('monitor.col.signal'),value:a=>signalOf(a),label:v=>t(SIGNAL[v as keyof typeof SIGNAL]),cell:a=>{const s=signalOf(a);return <Badge tone={s==='orders'?'warn':'bad'}>{t(SIGNAL[s])}</Badge>;}},
  {id:'rate_before',name:t('monitor.col.rateBefore'),type:'percent',num:true,value:a=>bpValue(a.before.rate)},
  {id:'rate_after',name:t('monitor.col.rateAfter'),type:'percent',num:true,value:a=>bpValue(a.after.rate)},
  {id:'rate_change',name:t('monitor.col.rateChange'),type:'decimal',num:true,value:a=>a.before.rate===null||a.after.rate===null?null:basisPointsDecimal(BigInt(a.after.rate)-BigInt(a.before.rate)),cell:a=>a.before.rate===null||a.after.rate===null?t('common.unknown'):<span className={BigInt(a.after.rate)<BigInt(a.before.rate)?ui.down:undefined}>{fmt.decimal(basisPointsDecimal(BigInt(a.after.rate)-BigInt(a.before.rate)))}</span>},
  {id:'orders_before',name:t('monitor.col.ordersBefore'),type:'int',num:true,value:a=>a.before.orders},
  {id:'orders_after',name:t('monitor.col.ordersAfter'),type:'int',num:true,value:a=>a.after.orders},
  {id:'discount_before',name:t('monitor.col.discountBefore'),type:'percent',num:true,value:a=>bpValue(a.before.discountBp)},
  {id:'discount_after',name:t('monitor.col.discountAfter'),type:'percent',num:true,value:a=>bpValue(a.after.discountBp)},
  {id:'math',name:t('monitor.showMath'),cell:a=><Button size="sm" variant="ghost" onClick={()=>setMath(a)} aria-label={t('monitor.mathFor',{customer:a.customer})}>{t('monitor.showMath')}</Button>},
 ]}/></>}
 <p className={ui.cardDesc}>{t('monitor.healthMethod')}</p>
 </>}
 </Card>
 <MathDialog view={view} math={math} onClose={()=>setMath(null)}/>
 </>;
}
function MathDialog({view,math,onClose}:{view:View|null;math:MathTarget;onClose:()=>void}){
 return <Dialog open={math!==null} onClose={onClose} labelledBy="monitor-math-title"><h2 id="monitor-math-title">{t('monitor.showMath')}</h2>
 {view&&math==='leak'&&<><p>{t('monitor.leakMath')}</p><DataTable label={t('monitor.cashLeak')}><thead><tr><th scope="col">{t('monitor.finding')}</th><th scope="col">{t('monitor.amount')}</th></tr></thead><tbody>{view.leaks.findings.map(f=><tr key={f.id}><td>{say(f.title)}<p>{say(f.formula)}</p></td><td>{money(f.cents)}</td></tr>)}</tbody></DataTable><p>{t('monitor.leakTotals',{total:money(view.leaks.totalCents),overlap:money(view.leaks.overlapCents),net:money(view.leaks.dedupedCents)})}</p><p>{t('monitor.checkedLines',{count:fmt.int(view.leaks.checked.saleLines),missing:fmt.int(view.leaks.checked.uncostedLines)})}</p></>}
 {view&&math&&math!=='leak'&&<><p translate="no">{math.name||math.customer} · {math.customer}</p><p>{t('monitor.periods',{prior:fmt.date(view.health.window.priorFrom),from:fmt.date(view.health.window.from),to:fmt.date(view.health.window.to)})}</p><p>{t('monitor.healthFormula',{threshold:fmt.decimal(basisPointsDecimal(BigInt(view.health.thresholdBp)))})}</p>
 <DataTable label={t('monitor.health')}><thead><tr><th scope="col">{t('monitor.metric')}</th><th scope="col">{t('monitor.before')}</th><th scope="col">{t('monitor.after')}</th></tr></thead><tbody>
 {(['pocket','cost','list','discount'] as const).map(k=><tr key={k}><th scope="row">{t(({pocket:'home.netPocket',cost:'margin.cost',list:'margin.list',discount:'margin.discount'} as const)[k])}</th><td>{(k==='cost'||k==='pocket')&&math.before.costed!==math.before.lines?t('common.unknown'):money(math.before[k])}</td><td>{(k==='cost'||k==='pocket')&&math.after.costed!==math.after.lines?t('common.unknown'):money(math.after[k])}</td></tr>)}
 <tr><th scope="row">{t('monitor.orders')}</th><td>{fmt.int(math.before.orders)}</td><td>{fmt.int(math.after.orders)}</td></tr><tr><th scope="row">{t('monitor.marginRate')}</th><td>{bpPercent(math.before.rate)}</td><td>{bpPercent(math.after.rate)}</td></tr><tr><th scope="row">{t('monitor.discountRate')}</th><td>{bpPercent(math.before.discountBp)}</td><td>{bpPercent(math.after.discountBp)}</td></tr>
 </tbody></DataTable></>}
 <Button onClick={onClose}>{t('common.close')}</Button></Dialog>;
}
