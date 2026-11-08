"use client";
import {useEffect,useState} from 'react';
import type {VaultClient} from '@/lib/vault/client';
import type {Results} from '@/lib/vault/protocol';
import type {CustomerAlert} from '@/lib/margin/monitor';
import {minorUnits} from '@/lib/spike/exact';
import {basisPointsDecimal} from '@/lib/margin/decimal';
import {fmt,say,t} from '@/lib/i18n';
import {Button,Card,DataTable,Dialog,EmptyState,Field,Grid,Notice,Skeleton,StatTile} from '@/components/ui/ui';
export function HomeMonitor({client,version}:{client:VaultClient;version:string}){
 const [view,setView]=useState<Results['homeMonitor']|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[points,setPoints]=useState('5'),[request,setRequest]=useState({thresholdBp:'500',tick:0}),[math,setMath]=useState<'leak'|CustomerAlert|null>(null);
 useEffect(()=>{let active=true;setBusy(true);setError('');void client.call('homeMonitor',{thresholdBp:request.thresholdBp}).then(v=>{if(active)setView(v);}).catch(()=>{if(active)setError(t('monitor.failed'));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[client,version,request]);
 const money=(v:string)=>fmt.currency(v),percent=(v:string|null)=>v===null?t('common.unknown'):fmt.percent(basisPointsDecimal(BigInt(v)));
 return <>
 <Card title={t('monitor.cashLeak')} description={t('monitor.windowHelp')} data-testid="cash-leak" aria-busy={busy}>
  {error&&<Notice tone="warn" role="alert">{error}</Notice>}
  {!view?!error&&<Skeleton/>:<><StatTile wide icon="coins" tone="warn" label={t('monitor.cashLeak')} value={money(view.leaks.dedupedCents)} valueProps={{'data-testid':'cash-leak-value'}} hint={t('monitor.window',{from:fmt.date(view.health.window.from),to:fmt.date(view.health.window.to)})}/><Button disabled={busy} onClick={()=>setMath('leak')}>{t('monitor.showMath')}</Button></>}
 </Card>
 <Card title={t('monitor.health')} description={t('monitor.openOnly')} data-testid="customer-health" aria-busy={busy}>
 <form onSubmit={e=>{e.preventDefault();try{const thresholdBp=String(minorUnits(points));if(!/^\d+$/.test(thresholdBp)||BigInt(thresholdBp)>BigInt(10000))throw Error();setRequest(v=>({thresholdBp,tick:v.tick+1}));}catch{setError(t('monitor.badThreshold'));}}}>
 <Field label={t('monitor.threshold')} hint={t('monitor.thresholdHelp')}><input data-testid="health-threshold" inputMode="decimal" value={points} onChange={e=>setPoints(e.target.value)} maxLength={8} required/></Field><Button variant="primary" type="submit" disabled={busy}>{t('monitor.checkNow')}</Button></form>
 {view&&<><p data-testid="health-last-checked">{t('monitor.lastChecked',{date:fmt.dateTime(view.checkedAt)})}</p><p>{t('monitor.healthMethod')}</p>
 {view.health.missingInvoiceIds!=='0'&&<Notice tone="warn">{t('monitor.missingIds',{count:fmt.int(view.health.missingInvoiceIds)})}</Notice>}
 {!view.health.alerts.length?<EmptyState title={t('monitor.noAlerts')}/>:<><p>{t('monitor.alertCount',{shown:fmt.int(String(view.health.alerts.length)),total:fmt.int(view.health.count)})}</p><Grid>{view.health.alerts.map(a=><Notice key={a.customer} tone="warn">
 <h3 translate="no">{a.name&&a.name!==a.customer?a.name+' · '+a.customer:a.customer}</h3>
 {a.marginDrop&&<p>{t('monitor.marginChange',{before:percent(a.before.rate),after:percent(a.after.rate)})}</p>}
 {a.frequencyDrop&&<p>{t('monitor.orderChange',{before:fmt.int(a.before.orders),after:fmt.int(a.after.orders),discountBefore:percent(a.before.discountBp),discountAfter:percent(a.after.discountBp)})}</p>}
 <Button onClick={()=>setMath(a)}>{t('monitor.showMath')}</Button></Notice>)}</Grid></>}
 </>}
 </Card>
 <Dialog open={math!==null} onClose={()=>setMath(null)} labelledBy="monitor-math-title"><h2 id="monitor-math-title">{t('monitor.showMath')}</h2>
 {view&&math==='leak'&&<><p>{t('monitor.leakMath')}</p><DataTable label={t('monitor.cashLeak')}><thead><tr><th scope="col">{t('monitor.finding')}</th><th scope="col">{t('monitor.amount')}</th></tr></thead><tbody>{view.leaks.findings.map(f=><tr key={f.id}><td>{say(f.title)}<p>{say(f.formula)}</p></td><td>{money(f.cents)}</td></tr>)}</tbody></DataTable><p>{t('monitor.leakTotals',{total:money(view.leaks.totalCents),overlap:money(view.leaks.overlapCents),net:money(view.leaks.dedupedCents)})}</p><p>{t('monitor.checkedLines',{count:fmt.int(view.leaks.checked.saleLines),missing:fmt.int(view.leaks.checked.uncostedLines)})}</p></>}
 {view&&math&&math!=='leak'&&<><p translate="no">{math.name||math.customer} · {math.customer}</p><p>{t('monitor.periods',{prior:fmt.date(view.health.window.priorFrom),from:fmt.date(view.health.window.from),to:fmt.date(view.health.window.to)})}</p><p>{t('monitor.healthFormula',{threshold:fmt.decimal(basisPointsDecimal(BigInt(view.health.thresholdBp)))})}</p>
 <DataTable label={t('monitor.health')}><thead><tr><th scope="col">{t('monitor.metric')}</th><th scope="col">{t('monitor.before')}</th><th scope="col">{t('monitor.after')}</th></tr></thead><tbody>
 {(['pocket','cost','list','discount'] as const).map(k=><tr key={k}><th scope="row">{t(({pocket:'home.netPocket',cost:'margin.cost',list:'margin.list',discount:'margin.discount'} as const)[k])}</th><td>{(k==='cost'||k==='pocket')&&math.before.costed!==math.before.lines?t('common.unknown'):money(math.before[k])}</td><td>{(k==='cost'||k==='pocket')&&math.after.costed!==math.after.lines?t('common.unknown'):money(math.after[k])}</td></tr>)}
 <tr><th scope="row">{t('monitor.orders')}</th><td>{fmt.int(math.before.orders)}</td><td>{fmt.int(math.after.orders)}</td></tr><tr><th scope="row">{t('monitor.marginRate')}</th><td>{percent(math.before.rate)}</td><td>{percent(math.after.rate)}</td></tr><tr><th scope="row">{t('monitor.discountRate')}</th><td>{percent(math.before.discountBp)}</td><td>{percent(math.after.discountBp)}</td></tr>
 </tbody></DataTable></>}
 <Button onClick={()=>setMath(null)}>{t('common.close')}</Button></Dialog>
 </>;
}
