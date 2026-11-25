import * as recovery from '../reports/roi';
import * as cadence from '../reports/pack';
import * as compliance from '../reports/scorecard';
import {reportPdf} from '../reports/pdf';
import * as suppliers from '../rebate/supplier';
import * as finance from "../rebate/finance";
import * as layouts from "../pricing/layouts";
import * as simRuns from "../vendor/sim-runs";
import {claimExport} from '../rebate/claim-export';
import * as rebates from '../rebate/store';
import {salesInput} from '../rebate/input';
import { currencyChangeSql, workspaceCurrency } from './currency';
import {customerHealth} from '../margin/monitor';
import {valuesTotals} from '../grid/sql';
import * as notes from '../notes/notes';
import * as vendor from '../vendor/review';
import * as sim from '../vendor/simulate';
import { quoteGuidance } from '../quotes/guidance';
import * as agents from '../agents/agents';
import * as costindex from '../agents/costindex';
import * as deadstock from '../inventory/deadstock';
import * as bench from '../bench/local';
import { lastCompleteQuarter } from '../bench/payload';
import * as winloss from '../quotes/winloss';
import { auditPack } from '../reports/auditpack';
import * as templates from '../reports/templates';
import { crossSell } from '../quotes/crosssell';
import { parquetReader } from './parquet-engine';
import { kindOf } from '../studio/formats';
import { fileFingerprint } from '../studio/studio';
import { importFolder, storeImportFolder, pickupConfig, storePickupConfig, checkPickupSettings, pickupDue, cleanForAuto, readPermission, folderFiles, type PickupResult } from "./folder";
import * as grid from '../pricing/grid';
import * as market from '../pricing/market';
import {whatIf} from '../pricing/whatif';
import * as serviceCost from '../margin/service-cost';
import * as ops from "../pricing/ops";
import {bridge,type BridgeInput} from "../margin/bridge";
import { VaultLicence, capacitySql } from "./licence";
import type { Action } from "./protocol";
import * as pricing from '../pricing/rules';
import { backupConfig, storeBackupConfig, writeBackup } from './backup';
import { openMemory, snapshotBytes, closeMemory, makeWritable, readyToWrite, startWarmup, type Engine } from "./engine";
import { VaultStorage } from "./storage";
import { decrypt, deriveKey, type Key } from "./crypto";
import { appendAudit, verifyAudit, GENESIS } from "./audit";
import { V1_SQL, SCHEMA_VERSION, upgradeSql } from "./schema";
import { sqlText } from "../spike/exact";
import { Studio, listSources, loadRecipes, recipeSql, removeSource, type Progress } from "../studio/studio";
import type { Role, Settings, SettingsPatch } from "../studio/formats";
import type { ErpProfile, FieldSource } from "../studio/mapper";
import { dismissSql, fixGroups, fixRows, fixSetSql, recheck } from "../studio/fixlater";
import { health } from "../studio/health";
import { PLAYGROUND_PREFIX, SAMPLE_COUNTS_SQL, generatePlayground, sampleState } from "../studio/playground";
import { AUTO_LOCK_MS, LOCK_WARNING_MS, LEASE_WAIT_MS, VaultError, vaultPhase, type LeaksView, type Scope, type Tier, type VaultStatus } from "./protocol";
import { REBUILD_SQL, differencesChanged, effectiveRebuildSql, findDifferences, reconSummary, recordSql } from "../margin/aggregate";
import { drill, math, waterfall, whale, type Dim, type Filters, type Metric } from "../margin/views";
import { findLeaks, leakRows, scopeTotals, type LeakResult } from "../margin/leaks";
import { REMOVE_SAMPLE_SQL, ledgerSql, roiSummary } from "../margin/roi";
import { leakReport } from "../margin/report";
import { loadCredits } from "../margin/credits";
import * as cleanup from "../cleanup/item-master";
import { basisSql, costBasis, type BasisId } from "../cost/basis";
import * as setup from "../setup/checklist";
import * as roles from "../roles/store";
import { isRole, type Cap, type RoleId } from "../roles/access";
import type { Access, CleanupApplied, CleanupMergedAll, CleanupUndone, HomeData, RoleList, SearchHit } from "./protocol";
import { isLocale, plainText } from "../i18n/core";
import * as quotes from "../quotes/quotes";
import * as documents from "../quotes/documents";
import {RelaySession,emptyRelay,type RelayState,type RelayView} from '../relay/session';
import { doorbell, type Doorbell, type DoorbellToken } from '../relay/doorbell';
import {relayHttp} from '../relay/http';
import {RelayError} from '../relay/protocol';
import {minorUnits} from '../spike/exact';
import { msg } from "../i18n/core";
import { businessToday } from "./today";
import * as sharing from "../sharing/packs";
import * as delta from "../sharing/delta";
import { newCode, openHandoff, packHash, sealHandoff, type Payload } from "../sharing/handoff";
import { ROLE_IDS } from "./schema";
import { capsFor } from "../roles/access";
import { RECOMMENDED, packsFor, type AnyPack } from "../sharing/catalog";
import { GOVERNED, lockedPacks } from "../sharing/governed";
import { GridSchema, type Grid } from "../relay/protocol";
import { checkGrid, gridBody, gridPublisher } from "../relay/crypto";
export class VaultService {
  /** v2.6 gap 2: whether this device already has a relay identity, read from the vault only (no network request).
   *  Roadmap 8.4: also whether a send is waiting and when the inbox last synced, so the sharing card can show its status
   *  without opening the inbox. A conflict needs the server's head, so only the opened inbox can report one. */
  // ---- Team sharing S1: the encrypted hand-off file (SHARING_DESIGN.md; blueprint section 22, item 38) ----------
  private shareTier(){if(this.licence.tier==='starter')throw new VaultError('LICENCE',msg('share.err.tier'));}
  /** What this device has received, the price changes its last copy made, and what this person may do. */
  async shareState(){
    const e=this.requireEngine(),a=await this.access(),cost=a.caps.includes('cost');
    const known=(p:string):p is sharing.PackId=>(sharing.PACK_IDS as readonly string[]).includes(p);
    const books=(await e.conn.query('SELECT pack,version,publisher_name,published_at,received_at,via,rows::VARCHAR AS rows FROM shared_books ORDER BY pack')).toArray()
      .map(r=>({pack:String(r.pack),version:String(r.version),publisher:String(r.publisher_name),publishedAt:String(r.published_at),receivedAt:String(r.received_at),via:String(r.via),rows:String(r.rows)}))
      .filter(b=>known(b.pack)&&(cost||!sharing.PACKS[b.pack].cost));
    const changes=(await e.conn.query('SELECT pack,key,before_value,after_value FROM shared_changes ORDER BY pack,seq LIMIT 200')).toArray()
      .map(r=>({pack:String(r.pack),key:String(r.key),before:r.before_value===null?null:String(r.before_value),after:r.after_value===null?null:String(r.after_value)}))
      .filter(c=>known(c.pack)&&!sharing.PACKS[c.pack].cost);
    // S3: a receiving seat (relay copies, not a publisher) shows shared sections as read-only; a relay copy is stale only when
    // this device has not synced for a week, not when the publisher simply had nothing new to send.
    const receiving=!!(await this.receivingPacks()),lastSyncedAt=(await this.relayStateRead()).lastSyncedAt??null;
    return {books,changes,receiving,lastSyncedAt,tier:this.licence.tier,canExport:a.caps.includes('share')&&this.licence.tier!=='starter',
      roles:ROLE_IDS.map(role=>({role,locked:!capsFor(role,false).includes('cost')}))};
  }
  /** Rows in each pack on this (publishing) device, for the export screen. */
  async shareCounts(){
    this.shareTier();const e=this.requireEngine(),out:{pack:sharing.PackId;locked:boolean;rows:string}[]=[];
    for(const p of sharing.PACK_IDS){let n=0;for(const part of sharing.PACKS[p].parts)n+=Number((await e.conn.query(`SELECT count(*) AS n FROM ${part.table} WHERE ${part.where}`)).toArray()[0].n);out.push({pack:p,locked:sharing.PACKS[p].cost,rows:String(n)});}
    return out;
  }
  /** Export a pack selection for a colleague in the given role. The one-time code is returned once and never stored. */
  async shareExport(packs:string[],role:RoleId,name:string){
    this.shareTier();const chosen=sharing.selection(packs);
    if(!isRole(role))throw new VaultError('SHARE',msg('share.err.role'));
    const recipient=typeof name==='string'?name.trim().slice(0,160):'';
    const locked=chosen.filter(p=>!sharing.packAllowed(p,role));
    if(locked.length)throw new VaultError('SHARE',msg('share.err.locked',{pack:msg(sharing.PACK_LABEL[locked[0]])}));
    const a=await this.access();if(chosen.some(p=>sharing.PACKS[p].cost)&&!a.caps.includes('cost'))throw new VaultError('FORBIDDEN',msg('share.err.locked',{pack:msg('share.pack.cost')}));
    const e=this.requireEngine(),data:Payload['packs']={},hashes:Payload['hashes']={};
    for(const p of chosen){const d=await sharing.readPack(e,p);data[p]=d;hashes[p]=await packHash(d);}
    const me=(await e.conn.query(`SELECT display_name FROM role_assignments WHERE user_id=${sqlText(this.identity.userId)}`)).toArray()[0];
    const owner=(await pricing.pricingState(e)).owner;
    const publisher=me?String(me.display_name):owner?.id===this.identity.userId?owner.name:this.identity.userId;
    const payload:Payload={v:1,tenant:this.identity.tenantId,currency:await workspaceCurrency(e),id:crypto.randomUUID(),exportedAt:new Date().toISOString(),exportedBy:{userId:this.identity.userId,name:publisher.slice(0,160)},recipient:{role,name:recipient},packs:data,hashes};
    const code=newCode(),blob=await sealHandoff(payload,code);
    await this.write('share.exported',{actor:this.identity.userId,id:payload.id,packs:chosen.join(','),role},async()=>{});
    return {name:`rebatehq-share-${payload.exportedAt.slice(0,10)}.rhqshare`,blob,code,id:payload.id,packs:chosen.map(p=>({pack:p,rows:String(data[p]!.reduce((n,d)=>n+d.rows.length,0))}))};
  }
  /** Open a hand-off file and check it against this vault before anything changes. */
  private async openShare(file:Blob,code:string){
    this.shareTier();const e=this.requireEngine();
    if(!(file instanceof Blob))throw new VaultError('SHARE',msg('share.err.notHandoff'));
    const payload=await openHandoff(file,code,this.identity.tenantId),packs=sharing.PACK_IDS.filter(p=>payload.packs[p]);
    if(!packs.length)throw new VaultError('SHARE',msg('share.err.damaged'));
    sharing.selection(packs);
    if(payload.currency!==await workspaceCurrency(e))throw new VaultError('CURRENCY',msg('share.err.currency',{code:payload.currency}));
    const a=await this.access();
    if(packs.some(p=>!sharing.packAllowed(p,payload.recipient.role)))throw new VaultError('SHARE',msg('share.err.damaged'));
    if(packs.some(p=>sharing.PACKS[p].cost)&&!a.caps.includes('cost'))throw new VaultError('FORBIDDEN',msg('share.err.costNotForYou'));
    const held=new Map((await e.conn.query('SELECT pack,published_at FROM shared_books')).toArray().map(r=>[String(r.pack),String(r.published_at)]));
    const older=packs.filter(p=>held.has(p)&&held.get(p)!>payload.exportedAt);
    return {payload,packs,older};
  }
  async shareImportPreview(file:Blob,code:string){
    const {payload,packs,older}=await this.openShare(file,code);
    return {id:payload.id,publisher:payload.exportedBy.name,exportedAt:payload.exportedAt,recipientRole:payload.recipient.role,recipientName:payload.recipient.name,
      packs:packs.map(p=>({pack:p,rows:String(payload.packs[p]!.reduce((n,d)=>n+d.rows.length,0)),older:older.includes(p)}))};
  }
  /** Apply every pack in the file in one audited transaction. A copy older than the one already held is refused. */
  async shareImport(file:Blob,code:string){
    const {payload,packs,older}=await this.openShare(file,code);
    if(older.length)throw new VaultError('SHARE',msg('share.err.older'));
    const changed=await this.applyShared('share.imported',{actor:this.identity.userId,id:payload.id,packs:packs.join(','),from:payload.exportedBy.userId},
      packs.map(p=>({pack:p,data:payload.packs[p]!,version:payload.id,publisherId:payload.exportedBy.userId,publisherName:payload.exportedBy.name,publishedAt:payload.exportedAt,hash:payload.hashes[p]!})),'file',payload.recipient.role);
    this.accessCache=null;
    return {packs:packs.map(p=>({pack:p,rows:String(payload.packs[p]!.reduce((n,d)=>n+d.rows.length,0))})),changed:String(changed),publisher:payload.exportedBy.name,exportedAt:payload.exportedAt,state:await this.shareState()};
  }
  /** Apply shared packs in one audited write: governed tables, shared_books (where each came from) and shared_changes. */
  private async applyShared(action:string,details:Record<string,string>,entries:{pack:sharing.PackId;data:sharing.PackData;version:string;publisherId:string;publisherName:string;publishedAt:string;hash:string;rows?:delta.PackRows}[],via:'file'|'relay',role:string|null){
    const at=new Date().toISOString();let changed=0;
    await this.write(action,details,async e=>{
      for(const x of entries){const p=x.pack;
        const r=await sharing.applyPack(e,p,x.data);changed+=r.changes.length;
        await e.conn.query(`DELETE FROM shared_books WHERE pack=${sqlText(p)};INSERT INTO shared_books VALUES(${[p,x.version,x.publisherId,x.publisherName.slice(0,160),x.publishedAt,at,via].map(v=>sqlText(v)).join(',')},${r.rows},${sqlText(x.hash)},${role===null?'NULL':sqlText(role)});DELETE FROM shared_changes WHERE pack=${sqlText(p)};`);
        for(let i=0;i<r.changes.length;i+=500)await e.conn.query(`INSERT INTO shared_changes VALUES ${r.changes.slice(i,i+500).map((c,j)=>`(${sqlText(p)},${i+j+1},${sqlText(c.key)},${c.before===null?'NULL':sqlText(c.before)},${c.after===null?'NULL':sqlText(c.after)})`).join(',')}`);
        if(x.rows)await this.savePackRows(e,p,x.rows);
      }
      const packs=entries.map(x=>x.pack),lines=Number((await e.conn.query('SELECT count(*) AS n FROM (SELECT 1 FROM sales_lines LIMIT 1)')).toArray()[0].n);
      if(lines&&(packs.includes('items')||packs.includes('customers')))await this.financialBody(e);
      else await e.conn.query('UPDATE vault_meta SET pricing_revision=pricing_revision+1 WHERE id=1');
    });
    return changed;
  }
  // Team sharing S4: while the app is open and unlocked, the worker's 60-second tick syncs a joined device (the path that
  // guarantees delivery), and the Realtime doorbell makes it sync at once when a held pack gets a new version. Both run in
  // the worker's one queue, so they never race a rotate or a publish; they never count as the person being active.
  private bell: { epoch: string; door: Doorbell } | null = null;
  private bellToken: { value: DoorbellToken; until: number } | null = null;
  private lastBackground = 0;
  private ringHook: (() => void) | null = null;
  /** The worker passes how to queue an immediate sync when the doorbell rings. */
  onRelayRing(hook: () => void) { this.ringHook = hook; }
  private stopBell() { this.bell?.door.stop(); this.bell = null; this.bellToken = null; }
  /** Returns true when the sync applied newer shared data or changed what the inbox shows, so the page refreshes. */
  async relayBackground(ring = false): Promise<boolean> {
    if (!this.engine || !this.licence.claims || !this.licence.writable || this.licence.tier === "starter") { this.stopBell(); return false; }
    const state = await this.relayStateRead();
    if (!state.epochs.length || !state.identity) { this.stopBell(); return false; }
    // With the doorbell joined, a slow safety poll is enough; without it, every minute.
    if (!ring && Date.now() - this.lastBackground < (this.bell?.door.open() ? 595_000 : 55_000)) return false;
    this.lastBackground = Date.now();
    const seen = async () => JSON.stringify((await this.requireEngine().conn.query("SELECT pack,version FROM shared_books ORDER BY pack")).toArray().map(r => [String(r.pack), String(r.version)]));
    const before = await seen(), head = state.head?.sequence ?? "0";
    this.quiet = true;
    try {
      const session = await this.relaySession(new AbortController().signal), view = await session.sync();
      await this.mirrorGrid(session, view);
      if (!session.isPublisher()) await this.receiveAll(session, view, true);
      this.relayListen(session);
      return before !== await seen() || ((await this.relayStateRead()).head?.sequence ?? "0") !== head;
    } catch { return false; }
    finally { this.quiet = false; }
  }
  /** Join the channels of the packs this device holds; a new epoch rejoins, because the server checks the key at join. */
  private watchBell(session: RelaySession, epoch: string) {
    if (this.bell && this.bell.epoch !== epoch) this.stopBell();
    const deviceId = this.licence.claims?.device ?? "";
    if (!this.bell) {
      const token = async () => {
        if (!this.bellToken || this.bellToken.until < Date.now() + 120_000) {
          const t = await relayHttp(deviceId, new AbortController().signal).token!();
          this.bellToken = { value: t, until: Date.parse(t.expiresAt) || Date.now() + 300_000 };
        }
        return this.bellToken.value;
      };
      this.bell = { epoch, door: doorbell(this.identity.tenantId, token, () => this.ringHook?.()) };
    }
    this.bell.door.watch(session.heldPacks());
  }
  async relayLocal(){
    const deviceId=this.licence.claims?.device??'',rows=(await this.requireEngine().conn.query('SELECT payload FROM relay_state WHERE id=1')).toArray();
    let identity=false,pending=false,lastSyncedAt:string|null=null;
    try{const state=rows.length?JSON.parse(String(rows[0].payload)) as RelayState:null;identity=!!state?.identity&&state.identity.device.deviceId===deviceId;
      if(identity){pending=!!state!.pending||!!state!.pendingEpoch;lastSyncedAt=typeof state!.lastSyncedAt==='string'?state!.lastSyncedAt:null;}}catch{identity=false;}
    // S4: the doorbell's state (joined channels, rings), for the sync status and for diagnosing a socket that never joins.
    return {identity,pending,lastSyncedAt,live:this.bell?.door.state()??null};
  }
  async relay(request:Extract<import('./protocol').Request,{action:`relay${string}`}>,signal:AbortSignal){
    const session=await this.relaySession(signal);
    const result=await this.relayAction(session,request);
    await this.mirrorGrid(session,result as RelayView);
    // Team sharing S3: a key rotation by a publisher re-publishes every pack under the new keys (so nobody removed can
    // read what follows, and new holders can read it); a sync or join on a receiving seat applies newer packs.
    if(request.action==='relayRotate'&&session.isPublisher())await this.publishAll(session,true);
    if((request.action==='relaySync'||request.action==='relayJoin')&&!session.isPublisher())await this.receiveAll(session,result as RelayView);
    // S4: a device that has just opened, joined, synced or rotated listens at once. Waiting for the first background
    // poll left up to two minutes in which a publish could only arrive by polling (CI runs 238 to 247 of PR #37).
    this.relayListen(session);
    return result;
  }
  /** Join the doorbell for this session's packs when the device has joined sharing and may write; never throws. */
  private relayListen(session: RelaySession) {
    try {
      if (!this.engine || !this.licence.writable || this.licence.tier === "starter" || !session.heldPacks().length) return;
      void this.relayStateRead().then(state => { if (state.epochs.length && state.identity) this.watchBell(session, state.epochs.at(-1)?.epoch.id ?? ""); }).catch(() => undefined);
    } catch { /* the poll still delivers */ }
  }
  private async relaySession(signal:AbortSignal){
    this.licence.assert();if(this.licence.tier==='starter')throw new VaultError('LICENCE',msg("vault.workspaceSharingRequiresProfessional"));
    const deviceId=this.licence.claims?.device??'';
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(deviceId))throw new VaultError('LICENCE',msg("vault.reconnectToVerifyThis"));
    const rows=(await this.requireEngine().conn.query('SELECT payload FROM relay_state WHERE id=1')).toArray();
    const state:RelayState=rows.length?JSON.parse(String(rows[0].payload)):emptyRelay();
    const session=new RelaySession({...this.identity,deviceId},state,relayHttp(deviceId,signal),async(value,stage)=>{
      await this.write('relay.'+stage,{actor:this.identity.userId},async e=>{await e.conn.query(`INSERT INTO relay_state VALUES(1,${sqlText(JSON.stringify(value))}) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`);});
    },signal);
    return session;
  }
  /** S4b: the rows this vault last published or applied for a pack, key → row per part (see schema V25_SQL). */
  private async packRows(e:Engine,p:sharing.PackId):Promise<delta.PackRows>{
    const rows=sharing.PACKS[p].parts.map(()=>new Map<string,string>());
    for(const r of (await e.conn.query(`SELECT part,row_key,row_json FROM shared_pack_rows WHERE pack=${sqlText(p)}`)).toArray())rows[Number(r.part)]?.set(String(r.row_key),String(r.row_json));
    return rows;
  }
  private async savePackRows(e:Engine,p:sharing.PackId,rows:delta.PackRows){
    await e.conn.query(`DELETE FROM shared_pack_rows WHERE pack=${sqlText(p)}`);
    const all=rows.flatMap((m,i)=>[...m].map(([k,v])=>`(${sqlText(p)},${i},${sqlText(k)},${sqlText(v)})`));
    for(let i=0;i<all.length;i+=500)await e.conn.query(`INSERT INTO shared_pack_rows VALUES ${all.slice(i,i+500).join(',')}`);
  }
  /**
   * Publish the packs this device holds (a publisher only). Team sharing S4b (SHARING_DESIGN.md section 5):
   * - after a key rotation every pack goes out as a full snapshot, under the new keys;
   * - otherwise only packs that changed are sent, so a change to cost alone reaches no device without cost;
   * - a changed pack goes out as a delta (rows changed, keys removed) unless a snapshot is due: no earlier publish here,
   *   a week or 50 deltas since the last snapshot, more than a quarter of the pack changed, or another publisher went in
   *   between (the relay session checks the server's head);
   * - when nothing changed at all, Publish now sends a fresh full copy of every pack, which is how a seat whose copy
   *   failed recovers.
   * The publisher's record is written only once the version and all its chunks are on the server.
   */
  private async publishAll(session:RelaySession,rotated:boolean){
    const e=this.requireEngine(),out:{pack:string;version:string;rows:string;kind:'snapshot'|'delta'}[]=[];
    const plans=[];
    for(const p of sharing.PACK_IDS){
      if(!session.heldPacks().includes(p))continue;
      const full=await sharing.readPack(e,p),next=delta.toRows(p,full);
      const row=(await e.conn.query(`SELECT version,hash,snapshot_version,snapshot_at,deltas_since FROM shared_published WHERE pack=${sqlText(p)}`)).toArray()[0];
      const last=row?{version:String(row.version),hash:String(row.hash),snapshotVersion:String(row.snapshot_version),snapshotAt:String(row.snapshot_at),deltas:Number(row.deltas_since)}:null;
      plans.push({p,full,next,last,d:last?await delta.diffPack(p,await this.packRows(e,p),next,last.version):null});
    }
    const fresh=!rotated&&plans.every(x=>x.d&&x.d.size===0);
    for(const {p,full,next,last,d} of plans){
      if(!rotated&&!fresh&&d&&d.size===0)continue;
      const snapshot=rotated||fresh||!last||!d||delta.needsSnapshot({rotated,last,size:d.size,total:d.total});
      const r=await session.packPublish(p,full,snapshot?undefined:{data:{kind:'delta',base:d!.base,result:d!.result,parts:d!.parts},baseHash:last!.hash});
      const snap=r.kind==='snapshot',at=new Date().toISOString();
      await this.write('share.published',{actor:this.identity.userId,pack:p,version:r.version,kind:r.kind},async w=>{
        await this.savePackRows(w,p,next);
        await w.conn.query(`DELETE FROM shared_published WHERE pack=${sqlText(p)};INSERT INTO shared_published VALUES(${[p,r.version,r.hash,snap?r.version:last!.snapshotVersion,snap?at:last!.snapshotAt].map(v=>sqlText(v)).join(',')},${snap?0:last!.deltas+1})`);
      });
      out.push({pack:p,version:r.version,rows:r.rows,kind:r.kind});
    }
    return {published:out,fresh};
  }
  /**
   * S4b: what one pack's chain gives this vault, rebuilt into full rows. A chain that starts with a delta applies to the
   * relay copy this vault holds; when that copy is not the delta's base (an upgrade from v24, a file import in between,
   * a role change) or the rebuilt rows do not match the publisher's digest, the walk starts again from the newest
   * snapshot, once.
   */
  private async receivePack(session:RelaySession,p:sharing.PackId){
    const e=this.requireEngine();
    for(let attempt=0;;attempt++){
      const got=await session.packReceive(p);if(!got)return null;
      try{
        let rows:delta.PackRows|null=null;
        for(const step of got.steps){
          if(step.kind==='snapshot'){rows=delta.toRows(p,step.data);continue;}
          if(!rows){
            const book=(await e.conn.query(`SELECT version,via FROM shared_books WHERE pack=${sqlText(p)}`)).toArray()[0];
            if(!book||String(book.via)!=='relay'||String(book.version)!==step.data.base)throw new RelayError('CONTENT',msg('share.err.damaged'));
            rows=await this.packRows(e,p);
          }
          rows=await delta.applyDelta(p,rows,step.data);
        }
        if(!rows)return null;
        return {got,rows};
      }catch(error){
        if(attempt||!(error instanceof RelayError&&error.code==='CONTENT'))throw error;
        session.packReset(p);
      }
    }
  }
  /** On a receiving seat, bring each pack this device holds up to its newest version, verified end to end. */
  private async receiveAll(session:RelaySession,view:RelayView|undefined,quiet=false){
    const labels=new Map((view?.devices??[]).map((d:{userId:string;label:string})=>[d.userId,d.label]));
    // One pack that fails its checks (a chunk missing after a restore or a half-finished publish, or changed bytes) is
    // skipped without touching the vault; the others still apply, and the person is told to ask for a fresh publish.
    let failed=0;const cost=(await this.access()).caps.includes('cost');
    for(const p of sharing.PACK_IDS){
      if(sharing.PACKS[p].cost&&!cost){
        // S4b: a seat that lost cost (the signed grid changed its role, so it no longer holds the key either) keeps no
        // cost rows as a delta base.
        if(Number((await this.requireEngine().conn.query(`SELECT count(*) AS n FROM shared_pack_rows WHERE pack=${sqlText(p)}`)).toArray()[0].n))
          await this.write('share.base_cleared',{actor:this.identity.userId,pack:p},async w=>{await w.conn.query(`DELETE FROM shared_pack_rows WHERE pack=${sqlText(p)}`);});
        continue;
      }
      if(!session.heldPacks().includes(p))continue;
      let got:Awaited<ReturnType<VaultService['receivePack']>>;
      // S4: a version whose chunks are still uploading (the doorbell can ring first) is not ready yet, not a failure.
      try{got=await this.receivePack(session,p);}catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;if(!(error instanceof RelayError&&error.code==='NOT_READY'))failed++;continue;}
      if(!got)continue;
      const full=delta.toData(p,got.rows),g=got.got;
      await this.applyShared('share.received',{actor:this.identity.userId,pack:p,version:g.version,from:g.sender},[{pack:p,data:full,version:g.version,publisherId:g.sender,publisherName:labels.get(g.sender)??g.sender,publishedAt:g.createdAt,hash:await packHash(full),rows:got.rows}],'relay',null);
      await session.packMarkApplied(p,g.version,g.head);
    }
    this.accessCache=null;
    if(failed&&!quiet)throw new VaultError('SHARE',msg('share.receiveFailed',{count:failed}));
  }
  /** Settings › Who receives what › Publish now: send every pack this publisher's device holds to the team. */
  async sharePublish(signal:AbortSignal){
    const session=await this.relaySession(signal);await session.sync();
    if(!session.isPublisher())throw new VaultError('FORBIDDEN',msg('share.grid.ownerOnly'));
    return await this.publishAll(session,false);
  }
  /** Team sharing S2b: the grid an Owner or Pricing Owner signs, built from this vault's Team and roles. Anyone without a
   *  role here is a Sales Rep (least privilege, as in accessFor); the ticks are the "Recommended" preset until the
   *  Settings › Sharing grid (S3). Only an Owner changes the grid, so anyone else rotates with the previous grid unchanged. */
  private async gridBuilder(){
    const e=this.requireEngine(),me=this.identity.userId,state=await this.relayStateRead(),draft=state.gridDraft??null,draftBase=state.gridDraftBase??null;
    const roles=new Map((await e.conn.query('SELECT user_id,role FROM role_assignments')).toArray().map(r=>[String(r.user_id),String(r.role)]));
    const named=(await e.conn.query('SELECT owner_id FROM pricing_settings WHERE id=1')).toArray()[0]?.owner_id;
    return (users:string[],previous:Grid|null):Grid=>{
      if(previous&&previous.people.find(p=>p.userId===me)?.role!=='owner')return previous;
      // S3a (advisor review of S2b): once a grid is signed, it is the base. An Owner on a second device, or a second Owner,
      // signs the same grid plus this device's draft edits; people new to the roster are Sales Reps until an Owner says
      // otherwise; people who left the roster drop out. Local Team and roles only seed the very first grid.
      // A draft edited from an older signed grid could undo another Owner's newer change: refuse it until reviewed again.
      if(draft&&previous&&draftBase!==this.signedHash(previous))throw new VaultError('SHARE',msg('share.grid.stale'));
      const base=draft??previous;
      if(base)return {v:'1',namedOwner:base.namedOwner&&users.includes(base.namedOwner)?base.namedOwner:null,
        people:users.map(u=>base.people.find(p=>p.userId===u)??{userId:u,role:'sales_rep' as const,extras:[]}),ticks:base.ticks};
      const role=(u:string)=>{const r=roles.get(u)??(roles.size===0&&u===me?'owner':'sales_rep');return isRole(r)?r:'sales_rep';};
      return {v:'1',namedOwner:typeof named==='string'&&users.includes(named)?named:null,people:users.map(u=>({userId:u,role:role(u),extras:[]})),ticks:ROLE_IDS.map(r=>[r,[...RECOMMENDED[r]]]) as Grid['ticks']};
    };
  }
  /**
   * Team sharing S2b: on a device whose person is not a grid Owner, the signed role table becomes this vault's Team and
   * roles, and the grid's named Pricing Owner its Pricing Owner. A rep's own vault therefore stops treating them as its
   * Owner once they join, and loses cost (decision 16). An Owner's vault is the grid's source and is never overwritten.
   */
  private async mirrorGrid(session:RelaySession,view:RelayView|undefined){
    const grid=session.grid();if(!grid||!view)return;
    const pending=await this.relayStateRead(),me=grid.people.find(p=>p.userId===this.identity.userId);if(!me||(pending.gridDraft&&!this.draftStale(pending)))return;
    const e=this.requireEngine(),labels=new Map<string,string>((view.devices??[]).map((d:{userId:string;label:string})=>[d.userId,d.label]));
    const current=(await e.conn.query('SELECT user_id,display_name,role FROM role_assignments ORDER BY user_id')).toArray().map(r=>[String(r.user_id),String(r.role)].join('|')).join(',');
    const wanted=[...grid.people].sort((a,b)=>a.userId<b.userId?-1:1).map(p=>[p.userId,p.role].join('|')).join(',');
    const owner=(await e.conn.query('SELECT owner_id FROM pricing_settings WHERE id=1')).toArray()[0]?.owner_id??null;
    if(current===wanted&&(owner??'')===(grid.namedOwner??''))return;
    const names=new Map((await e.conn.query('SELECT user_id,display_name FROM role_assignments')).toArray().map(r=>[String(r.user_id),String(r.display_name)]));
    const at=new Date().toISOString(),name=(u:string)=>(names.get(u)??labels.get(u)??u).slice(0,160)||u;
    await this.write('roles.mirrored_from_grid',{actor:this.identity.userId,people:String(grid.people.length)},async w=>{
      await w.conn.query(`DELETE FROM role_assignments;INSERT INTO role_assignments VALUES ${grid.people.map(p=>`(${sqlText(p.userId)},${sqlText(name(p.userId))},${sqlText(p.role)},'relay',${sqlText(at)})`).join(',')};`);
      await w.conn.query(grid.namedOwner?`INSERT INTO pricing_settings VALUES(1,${sqlText(grid.namedOwner)},${sqlText(name(grid.namedOwner))},7) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,owner_name=excluded.owner_name`:`UPDATE pricing_settings SET owner_id='',owner_name='' WHERE id=1`);
    });
    this.accessCache=null;
  }
  // ---- Team sharing S3a: the signed grid, the Owner's draft, and the Settings › Sharing grid ----
  private async relayStateRead():Promise<RelayState>{const rows=(await this.requireEngine().conn.query('SELECT payload FROM relay_state WHERE id=1')).toArray();return rows.length?JSON.parse(String(rows[0].payload)):emptyRelay();}
  private signedGrid(state:RelayState):Grid|null{const e=state.epochs.at(-1)?.epoch;return e?.v==='2'?e.grid:null;}
  /** A stable fingerprint of a signed grid, to tie a draft to the grid it was edited from. */
  private signedHash(grid:Grid){return JSON.stringify(gridBody(grid));}
  private draftStale(state:RelayState){const signed=this.signedGrid(state);return !!state.gridDraft&&!!signed&&state.gridDraftBase!==this.signedHash(signed);}
  private async gridDraftSet(draft:Grid|null,action:string){
    const state=await this.relayStateRead();if(!draft&&!state.gridDraft)return;
    if(draft){const signed=this.signedGrid(state);state.gridDraft=draft;if(signed)state.gridDraftBase=this.signedHash(signed);}
    else{delete state.gridDraft;delete state.gridDraftBase;}
    await this.write(action,{actor:this.identity.userId},async w=>{await w.conn.query(`INSERT INTO relay_state VALUES(1,${sqlText(JSON.stringify(state))}) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`);});
  }
  /** A Team and roles change on a vault that has a signed grid becomes part of the draft signed at the next rotation. */
  private async gridDraftPerson(userId:string,role:RoleId){
    const state=await this.relayStateRead(),signed=this.signedGrid(state),base=(this.draftStale(state)?null:state.gridDraft)??signed;
    // Only a grid Owner drafts: anyone else's local edit is overwritten by the next signed grid they receive.
    if(!base||!signed?.people.some(p=>p.userId===this.identity.userId&&p.role==="owner"))return;
    const people=[...base.people.filter(p=>p.userId!==userId),{userId,role,extras:base.people.find(p=>p.userId===userId)?.extras??[]}].sort((a,b)=>a.userId<b.userId?-1:a.userId>b.userId?1:0);
    await this.gridDraftSet({...base,people},'sharing.grid_drafted');
  }
  async shareGrid(){
    const state=await this.relayStateRead(),signed=this.signedGrid(state),draft=state.gridDraft??null,e=this.requireEngine();
    const names=new Map((await e.conn.query('SELECT user_id,display_name FROM role_assignments')).toArray().map(r=>[String(r.user_id),String(r.display_name)]));
    const grid=draft??signed;
    return {signed,draft,stale:this.draftStale(state),joined:state.epochs.length>0,canSign:!!signed&&signed.people.some(p=>p.userId===this.identity.userId&&p.role==='owner'),
      canPublish:!!signed&&gridPublisher(signed,this.identity.userId),
      people:(grid?.people??[]).map(p=>({userId:p.userId,name:names.get(p.userId)??p.userId,you:p.userId===this.identity.userId}))};
  }
  async shareGridSave(grid:unknown){
    const state=await this.relayStateRead(),signed=this.signedGrid(state);
    if(!signed)throw new VaultError('SHARE',msg('share.grid.notStarted'));
    if(!signed.people.some(p=>p.userId===this.identity.userId&&p.role==='owner'))throw new VaultError('FORBIDDEN',msg('share.grid.ownerOnly'));
    const parsed=GridSchema.safeParse(grid);if(!parsed.success)throw new VaultError('SHARE',msg('share.grid.invalid'));
    try{checkGrid(parsed.data,[]);}catch{throw new VaultError('SHARE',msg('share.grid.invalid'));}
    if(JSON.stringify(parsed.data.people.map(p=>p.userId))!==JSON.stringify(signed.people.map(p=>p.userId)))throw new VaultError('SHARE',msg('share.grid.invalid'));
    await this.gridDraftSet(parsed.data,'sharing.grid_drafted');return this.shareGrid();
  }
  async shareGridDiscard(){await this.gridDraftSet(null,'sharing.grid_discarded');return this.shareGrid();}
  private async relayAction(session:RelaySession,request:Extract<import('./protocol').Request,{action:`relay${string}`}>){
    switch(request.action){
      case 'relayView':return session.view();case 'relayRegister':return session.register();case 'relayJoin':return session.join(request.data.fingerprint);
      case 'relayRotate':{const view=await session.rotate(request.data.confirmations,await this.gridBuilder());await this.gridDraftSet(null,'sharing.grid_signed');return view;}case 'relaySync':return session.sync();
      case 'relayShare':{const {amount,...input}=request.data.input;const currency=await workspaceCurrency(this.requireEngine());if(input.currency!==currency)throw new VaultError('CURRENCY',msg('fx.current',{code:currency}));let amountMinor:string;try{amountMinor=minorUnits(amount).toString();}catch{throw new RelayError('CONTENT',msg("vault.enterANonNegative"));}return session.share({...input,amountMinor});}
      case 'relayRequest':return session.request(request.data.id,request.data.approvers);case 'relayDecide':return session.decide(request.data.id,request.data.decision);
      case 'relayComment':return session.comment(request.data.id,request.data.text,request.data.mentions);case 'relayRetry':return session.retry();case 'relayDiscard':return session.discard();
    }
  }
  engine: Engine | null = null;
  async capacityUpgrade(){
    this.licence.assert();const tier=this.licence.tier;
    await this.write('licence.capacity_applied',{tier},async e=>{await e.conn.query(capacitySql(tier));});
    this.tier=tier;return this.status();
  }
  readonly licence = new VaultLicence(process.env.NEXT_PUBLIC_LICENCE_VERIFY_KEY || "");
  // Starting again on this device deletes only local files: it never needs a licence (audit B-3).
  /** 9.3: the licence rule comes from ACTIONS (vaultReset is marked "always": a forgotten passphrase needs no licence). */
  licenceGuard(action:Action) { this.licence.guard(action); }
  /** Team sharing S3: on a receiving seat, refuse a write to data the publisher shares through the relay. The publisher is
   *  authoritative, so a local edit would be replaced at the next publish (lib/sharing/governed.ts classifies every write). */
  async sharedGuard(action:Action) {
    if (!GOVERNED[action] || !this.engine) return;
    const held = (await this.access()).shared ?? null; if (!held) return;
    const hit = lockedPacks(action, held, GOVERNED[action] === "import" ? (await this.studioState()).files.map(f => f.role) : [])[0]; if (!hit) return;
    throw new VaultError("SHARE", msg("share.readOnly", { name: held.packs[hit], pack: msg(`share.pack.${hit}` as import("../i18n/core").MessageKey) }));
  }
  /** The packs this device received through the relay while it is not a publisher under the signed grid, with each
   *  publisher's name; null on a publisher, without sharing, or with nothing received. */
  private async receivingPacks(): Promise<Map<string, string> | null> {
    const state = await this.relayStateRead(), signed = this.signedGrid(state);
    if (!state.epochs.length || !signed || gridPublisher(signed, this.identity.userId)) return null;
    const rows = (await this.requireEngine().conn.query("SELECT pack,publisher_name FROM shared_books WHERE via='relay'")).toArray();
    return rows.length ? new Map(rows.map(r => [String(r.pack), String(r.publisher_name)])) : null;
  }
  async licenceSet(envelope:import("../licence-policy").LicenceEnvelope|null,device:string,offline:boolean){try{await this.licence.set(envelope,this.identity,device,offline);}catch{/* Invalid assertions clear authority but never prevent read-only unlock/recovery. */}this.tier=this.licence.effective(this.tier);return this.status();}
  private identity!: Scope;
  storage!: VaultStorage;
  private key: Key | null = null;
  private generation = "0";
  private lastSaved: string | null = null;
  private dirty = false;
  private recovered = false;
  private tier: Tier = "starter";
  private accessCache: Access | null = null;
  private viewAs: RoleId | null = null;
  private releaseLease: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private warnTimer: ReturnType<typeof setTimeout> | null = null;
  readonly studio = new Studio();
  // autoWarm: start the copy-on-write in the background right after unlock.
  constructor(private onIdle: () => void, private idleMs = AUTO_LOCK_MS, private leaseWaitMs = LEASE_WAIT_MS, private autoWarm = true, private onWarn?: () => void) {}
  async init(scope: Scope) {
    if (this.storage) throw new VaultError("STATE", msg("vault.workspaceIsAlreadySelected"));
    if (!navigator.storage?.getDirectory || !navigator.locks) throw new VaultError("BROWSER", msg("vault.useACurrentChrome"));
    this.identity = { ...scope }; this.storage = await VaultStorage.open(scope); return this.status();
  }
  private async lease() {
    if (this.releaseLease) return;
    // Wait briefly instead of failing at once: right after a tab is closed or
    // crashes, the browser may not yet have released that tab's lease.
    const signal = AbortSignal.timeout(this.leaseWaitMs);
    await new Promise<void>((resolve, reject) => {
      navigator.locks.request(`rebatehq-vault-${this.storage.scope}`, { signal }, async () => {
        await new Promise<void>(release => { this.releaseLease = release; resolve(); });
      }).catch(error => reject(signal.aborted ? new VaultError("OTHER_TAB", msg("vault.thisVaultIsOpen")) : error));
    });
  }
  /** Background work (the folder pickup) must not count as the person being active. */
  private quiet = false;
  touch() {
    if (this.quiet) return;
    if (this.timer) clearTimeout(this.timer);
    if (this.warnTimer) clearTimeout(this.warnTimer);
    this.warnTimer = null;
    if (this.engine) {
      this.timer = setTimeout(this.onIdle, this.idleMs);
      // A minute's warning before the idle lock, so nobody loses unsaved mapping by surprise (audit B-8).
      if (this.onWarn && this.idleMs > LOCK_WARNING_MS) this.warnTimer = setTimeout(this.onWarn, this.idleMs - LOCK_WARNING_MS);
    }
    return { ok: true };
  }
  /** The idle time ran out while a job was running: warn now and lock a minute later unless the person comes back. */
  graceLock() {
    if (!this.engine) return;
    if (this.timer) clearTimeout(this.timer);
    if (this.warnTimer) clearTimeout(this.warnTimer);
    this.warnTimer = null; this.timer = setTimeout(this.onIdle, Math.min(LOCK_WARNING_MS, this.idleMs));
    this.onWarn?.();
  }
  /** `ownerName` names the Pricing Owner at setup (the worker requires it; direct harness calls may omit it). */
  async create(passphrase: string, tier: Tier, ownerName?: string) {
    this.licence.assert(); tier=this.licence.effective(tier);
    if (this.engine || await this.storage.exists()) throw new VaultError("EXISTS", msg("vault.aVaultAlreadyExists"));
    if (!["starter", "professional", "scale"].includes(tier)) throw new VaultError("TIER", msg("vault.chooseASupportedPlan"));
    const owner = ownerName === undefined ? undefined : pricing.label(ownerName);
    await this.lease();
    try {
      this.key = await deriveKey(passphrase); passphrase = "";
      this.engine = await openMemory(); this.tier = tier;
      await this.engine.conn.query(`BEGIN; ${V1_SQL} INSERT INTO vault_meta VALUES(1,1,${sqlText(tier)},${sqlText(this.storage.scope)},${sqlText(GENESIS)},0)`);
      await appendAudit(this.engine, "vault.created", { schema_version: "1" });
      await this.engine.conn.query("COMMIT");
      await this.migrate(); this.dirty = true; await this.save();
      if (owner !== undefined) await this.setupOwner(owner);
      this.touch(); return this.status();
    } catch (error) { await this.dispose(); if (error instanceof VaultError && error.code === "SAVE") throw new VaultError("SAVE", msg("vault.initialVaultSetupCould")); throw error; }
  }
  /** The person creating the vault is its first Owner and names themselves Pricing Owner (required at setup). */
  private async setupOwner(name: string) {
    const id = this.identity.userId, at = new Date().toISOString();
    await this.write("pricing.owner_set", { actor: id, setup: "true" }, async e => { await e.conn.query(`INSERT INTO pricing_settings VALUES(1,${sqlText(id)},${sqlText(name)},7); ${roles.seedSql(id, name, at)} UPDATE vault_meta SET pricing_revision=pricing_revision+1 WHERE id=1`); });
    this.accessCache = null;
  }
  private async migrate() {
    const engine = this.requireEngine();
    const version = Number((await engine.conn.query("SELECT schema_version FROM vault_meta WHERE id=1")).toArray()[0]?.schema_version);
    const sql = upgradeSql(version);
    if (!sql) return;
    await makeWritable(engine);
    // v5 adds the margin pre-aggregate; build it from the lines already in the vault.
    await engine.conn.query(`BEGIN; ${sql} ${version < 5 ? REBUILD_SQL : ""} UPDATE vault_meta SET schema_version=${SCHEMA_VERSION} WHERE id=1`);
    try { await appendAudit(engine, "vault.schema_upgraded", { from: String(version), to: String(SCHEMA_VERSION) }); await engine.conn.query("COMMIT"); this.dirty = true; }
    catch (error) { await engine.conn.query("ROLLBACK"); throw error; }
  }
  async unlock(passphrase: string) {
    if (this.engine) throw new VaultError("STATE", msg("vault.theVaultIsAlready"));
    await this.lease();
    try {
      const candidates = await this.storage.candidates();
      if (!candidates.length) throw new VaultError("RECOVERY", msg("vault.noValidVaultPointer"));
      let decoded: Awaited<ReturnType<typeof decrypt>> | null = null, chosen = candidates[0];
      for (const candidate of candidates) {
        try {
          const value = await decrypt(await this.storage.file(candidate.name), passphrase, this.storage.scope);
          if (candidate.sequence !== null && candidate.sequence !== value.sequence) { value.bytes.fill(0); continue; }
          decoded = value; chosen = candidate; break;
        } catch { /* Try only retained, committed pointers; never orphan files. */ }
      }
      passphrase = "";
      if (!decoded) throw new VaultError("UNLOCK_FAILED", msg("vault.wrongPassphraseOrDamaged"));
      this.key = decoded.key; this.generation = decoded.sequence;
      // The passphrase was right once decrypt succeeded: an engine that fails to start is not a "wrong passphrase" (audit B-11).
      try { this.engine = await openMemory(decoded.bytes); } // one engine; registered RAM buffer only
      catch { throw new VaultError("ENGINE", msg("vault.engineFailed")); }
      this.storage.activeHead = { format: 1, current: chosen.name, previous: null, sequence: decoded.sequence, savedAt: chosen.savedAt || "" };
      const rows = (await this.engine.conn.query("SELECT scope,tier FROM vault_meta WHERE id=1")).toArray();
      if (rows.length !== 1 || rows[0].scope !== this.storage.scope || !["starter", "professional", "scale"].includes(String(rows[0].tier))) throw new Error("metadata");
      this.tier = this.licence.effective(rows[0].tier as Tier);
      const audit = await verifyAudit(this.engine); if (!audit.valid) throw new VaultError("AUDIT", msg("vault.theVaultAuditChain"));
      this.recovered = chosen.recovered; this.lastSaved = chosen.savedAt;
      await this.migrate(); if (this.dirty) await this.save();
      if (this.autoWarm) startWarmup(this.engine);
      this.touch(); return this.status();
    } catch (error) { await this.dispose(); if (error instanceof VaultError && error.code === "SAVE") throw new VaultError("SAVE", msg("vault.theSchemaUpgradeCould")); throw error instanceof VaultError ? error : new VaultError("UNLOCK_FAILED", msg("vault.wrongPassphraseDamagedVault")); }
  }
  /**
   * Audit B-3: "Start again on this device" for a forgotten passphrase. Deletes this vault's files on this device only,
   * while it is locked and not open in another tab (the vault lease). An encrypted backup and its passphrase bring the
   * data back; the restore card shows once no vault exists.
   */
  async vaultReset() {
    if (this.engine) throw new VaultError("STATE", msg("vault.reset.lockFirst"));
    await this.lease();
    try { await this.storage.clear(); this.recovered = false; this.lastSaved = null; this.generation = "0"; }
    finally { this.releaseLease?.(); this.releaseLease = null; }
    return this.status();
  }
  /**
   * Audit B-3: change the passphrase. The current one is checked against the saved snapshot, the vault is saved again
   * under a key from the new one, and every older snapshot on this device is removed, so the old passphrase opens nothing
   * here. Backups already downloaded keep the passphrase they were made with.
   */
  async passphraseChange(current: string, next: string) {
    this.requireEngine();
    if (typeof current !== "string" || typeof next !== "string" || next === current) throw new VaultError("PASSPHRASE", msg("vault.passphrase.same"));
    const head = this.storage.activeHead;
    if (!head) throw new VaultError("STATE", msg("vault.unlockYourVaultFirst"));
    try { const check = await decrypt(await this.storage.file(head.current), current, this.storage.scope); check.bytes.fill(0); }
    catch { throw new VaultError("PASSPHRASE", msg("vault.passphrase.currentWrong")); }
    current = "";
    const key = await deriveKey(next); next = "";
    const old = this.key; this.key = key;
    try { await this.write("vault.passphrase_changed", {}, async () => undefined); }
    catch (error) { this.key = old; throw error; }
    try { await this.storage.dropOlder(); } catch { throw new VaultError("SAVE", msg("vault.passphrase.cleanupFailed")); }
    return this.status();
  }
  private requireEngine() { if (!this.engine) throw new VaultError("LOCKED", msg("vault.unlockYourVaultFirst")); return this.engine; }
  async save() {
    const engine = this.requireEngine();
    if (!this.dirty) return this.status();
    const bytes = await snapshotBytes(engine);
    try {
      const sequence = (BigInt(this.generation) + BigInt(1)).toString();
      const head = await this.storage.publish(bytes, this.key!, sequence);
      this.generation = sequence; this.lastSaved = head.savedAt; this.dirty = false;
    } catch { throw new VaultError("SAVE", msg("vault.theChangeIsIn")); }
    finally { if (bytes.byteLength) bytes.fill(0); }
    return this.status();
  }
  /** Resolves when the background copy finishes (true) or failed (false); null when not running. */
  warmup() { return this.engine?.warming ?? null; }
  /** Wait for the background copy (or do it now) before the first change. */
  private async writable(progress?: Progress) {
    this.licence.assert();
    const engine = this.requireEngine();
    if (this.dirty) throw new VaultError("SAVE", msg("vault.saveThePendingChange"));
    if (engine.warm !== "writable") { progress?.(engine.warm === "copying" || engine.warm === "copied" ? msg("vault.finishingPreparingTheVault") : msg("vault.preparingTheVaultFor"), "0", "1"); await makeWritable(engine); }
    return engine;
  }
  private async recipes() { return loadRecipes(this.requireEngine()); }
  async studioState() { return this.studio.state(await this.recipes()); }
  async studioAdd(files: File[], replaces: string | null = null) { const e = this.requireEngine(); await this.studio.add(files, await this.recipes(), replaces, await workspaceCurrency(e), { parquet: parquetReader(e) }); return this.studioState(); }
  // 7F-2 folder re-import: the remembered folder handle, and adding the folder's files that match a saved recipe.
  async folderGet() { const d = await importFolder(this.storage.scope); return { directory: d, name: d?.name ?? null }; }
  async folderSet(directory: FileSystemDirectoryHandle | null) { await storeImportFolder(this.storage.scope, directory ?? null); return this.folderGet(); }
  // Roadmap 15.1: scheduled pickup from the remembered folder, only while the app is open and unlocked, and only with
  // the read permission already granted in this session (the worker cannot show a prompt). New files a saved recipe
  // recognises are added to Import Studio; with "import automatically" on, a batch with nothing to decide is imported
  // under the signed-in person's role and audited as usual; anything else waits for review. A batch someone is
  // preparing is never touched, and the check does not keep the vault from locking.
  async folderPickup() { const scope = this.storage.scope, c = await pickupConfig(scope), d = await importFolder(scope); return { ...c, name: d?.name ?? null, permission: d ? await readPermission(d) : null }; }
  async folderPickupSet(every: unknown, auto: unknown) { const scope = this.storage.scope, v = checkPickupSettings(every, auto); await storePickupConfig(scope, { ...await pickupConfig(scope), ...v }); return this.folderPickup(); }
  async folderPickupDue(): Promise<PickupResult | null> {
    if (!this.engine || this.dirty) return null;
    const scope = this.storage.scope, c = await pickupConfig(scope);
    if (!pickupDue(c, Date.now())) return null;
    const d = await importFolder(scope);
    if (!d || await readPermission(d) !== "granted") return null; // retried on the next tick once permission is granted
    if (!(await this.access()).caps.includes("data") || (await this.studioState()).files.length) return null;
    const at = new Date().toISOString(); let result: PickupResult;
    this.quiet = true;
    try {
      const files = await folderFiles(d, name => !!kindOf(name));
      const st = files.length ? await this.studioFolder(files) : null, added = st?.folder.added.length ?? 0, skipped = st?.folder.skipped.length ?? 0;
      let imported = false;
      if (added && c.auto && this.licence.writable) {
        const planned = await this.studioPlan(new AbortController().signal, () => undefined);
        if (cleanForAuto(planned.report, planned.files.map(f => f.role))) { await this.studioCommit(false, () => undefined); imported = true; }
      }
      result = { at, added, skipped, imported, review: added > 0 && !imported, error: false };
    } catch { result = { at, added: 0, skipped: 0, imported: false, review: (await this.studioState()).files.length > 0, error: true }; }
    finally { this.quiet = false; }
    await storePickupConfig(scope, { ...c, last: at, result });
    return result;
  }
  async studioFolder(files: File[]) {
    const e = this.requireEngine();
    if (!Array.isArray(files) || files.length > 500 || !files.every(f => f instanceof File)) throw new VaultError("FOLDER", msg("folder.invalid"));
    const known = new Set((await e.conn.query("SELECT fingerprint FROM import_batches WHERE fingerprint IS NOT NULL")).toArray().map(r => String(r.fingerprint)));
    const fresh: File[] = [], skipped: { name: string; reason: string }[] = [];
    for (const f of files) {
      if (!kindOf(f.name)) { skipped.push({ name: f.name, reason: msg("folder.skipKind") }); continue; }
      if (f.size > 0 && known.has(await fileFingerprint(f))) { skipped.push({ name: f.name, reason: msg("folder.skipImported") }); continue; }
      fresh.push(f);
    }
    const r = await this.studio.addMatching(fresh, await this.recipes(), await workspaceCurrency(e), { parquet: parquetReader(e) });
    this.touch();
    return { ...(await this.studioState()), folder: { added: r.added, skipped: [...skipped, ...r.skipped] } };
  }
  async studioUpdate(id: string, settings: SettingsPatch = {}, role?: Role | null, extra: { erp?: ErpProfile; field?: { name: string; source: FieldSource }; confirmed?: boolean; range?: { from: string | null; to: string | null } } = {}) {
    this.requireEngine(); await this.studio.update(id, { ...settings, ...(role !== undefined ? { role } : {}), ...extra }); return this.studioState();
  }
  async studioDrop(id: string) { this.requireEngine(); this.studio.drop(id); return this.studioState(); }
  async studioClear() { this.requireEngine(); this.studio.clear(); return this.studioState(); }
  private rebateTier(){if(this.licence.tier==='starter')throw new VaultError('LICENCE',msg('rebate.proRequired'));}
  private async rebateImportGuard(source?:string){
    const roles=source?[(await this.requireEngine().conn.query(`SELECT coalesce(k.kind,s.role) AS role FROM source_files s LEFT JOIN source_kinds k ON k.source_id=s.id WHERE s.id=${sqlText(source)}`)).toArray()[0]?.role]:(await this.studioState()).files.map(f=>f.role);
    if(roles.some(role=>role==='rebate_agreement'||role==='purchases')){this.rebateTier();await this.guard('rebateManage');}
  }
  /** The vault data version the reviewed plan was made against (audit 1.3): Import refuses a plan made before another change. */
  private planVersion: number | null = null;
  async studioPlan(signal: AbortSignal, progress: Progress) { await this.rebateImportGuard();await this.studio.plan(this.requireEngine(), this.tier, signal, progress); this.planVersion = this.dataVersion; return this.studioState(); }
  async studioCommit(acknowledge: boolean, progress: Progress) {
    await this.rebateImportGuard();
    if (this.planVersion !== this.dataVersion) throw new VaultError("STUDIO", msg("studio.planStale"));
    const engine = await this.writable(progress);
    progress(msg("vault.loadingRowsIntoThe"), "0", "1");
    const result = await this.studio.commit(engine, acknowledge);
    this.dirty = true; progress(msg("vault.updatingMarginTotals2"), "0", "1"); await this.derived(engine, false);
    progress(msg("vault.savingEncryptedSnapshot"), "0", "1", "save"); await this.save();
    progress(msg("vault.saved"), "1", "1", "save"); this.touch();
    return { status: await this.status(), studio: await this.studioState(), result };
  }
  async studioDownload(id: string, signal: AbortSignal) { this.requireEngine(); return this.studio.download(id, signal); }
  async studioZip(signal: AbortSignal) { this.requireEngine(); return this.studio.zip(signal); }
  async recipeSave(id: string, name: string) {
    const recipe = this.studio.recipeFor(id, name), engine = await this.writable();
    await engine.conn.query("BEGIN");
    try { await engine.conn.query(recipeSql(recipe)); await appendAudit(engine, "recipe.saved", { name: recipe.name, profile: recipe.profile }); await engine.conn.query("COMMIT"); }
    catch (error) { await engine.conn.query("ROLLBACK"); throw error; }
    this.dirty = true; await this.save(); return this.studioState();
  }
  async recipeApply(id: string, recipeId: string) {
    const recipe = (await this.recipes()).find(r => r.id === recipeId);
    if (!recipe) throw new VaultError("RECIPE", msg("vault.thatRecipeNoLonger"));
    this.studio.apply(id, recipe); return this.studioState();
  }
  async sources() { return listSources(this.requireEngine()); }
  async sourceRemove(id: string) {
    const engine = await this.writable();
    const cleanup = await removeSource(engine, id);
    this.dirty = true; await this.derived(engine, false); await this.save(); this.touch();
    return { status: await this.status(), cleanup };
  }
  async fixGroups() { return fixGroups(this.requireEngine()); }
  async fixRows(sourceId: string, code: string, offset = 0) { return fixRows(this.requireEngine(), sourceId, code, offset); }
  /** Bulk or row-level correction; audited and saved like any other change. */
  async fixSet(sourceId: string, code: string, field: string, value: string, rows: number[] | null = null) {
    const engine = await this.writable(), { sql } = await fixSetSql(engine, sourceId, code, field, value, rows);
    await engine.conn.query("BEGIN");
    try { await engine.conn.query(sql); await appendAudit(engine, "fixlater.corrected", { source_id: sourceId, code, field, rows: rows ? String(rows.length) : "group" }); await engine.conn.query("COMMIT"); }
    catch (error) { await engine.conn.query("ROLLBACK"); throw error; }
    this.dirty = true; await this.save(); this.touch(); return fixGroups(engine);
  }
  async fixDismiss(sourceId: string, code: string, rows: number[] | null = null) {
    const engine = await this.writable();
    await engine.conn.query("BEGIN");
    try { await engine.conn.query(dismissSql(sourceId, code, rows)); await appendAudit(engine, "fixlater.dismissed", { source_id: sourceId, code, rows: rows ? String(rows.length) : "group" }); await engine.conn.query("COMMIT"); }
    catch (error) { await engine.conn.query("ROLLBACK"); throw error; }
    this.dirty = true; await this.save(); this.touch(); return { status: await this.status(), groups: await fixGroups(engine) };
  }
  async fixRecheck(sourceId: string, code: string) {
    await this.rebateImportGuard(sourceId);
    const engine = await this.writable(), out = await recheck(engine, sourceId, code, this.tier);
    if (out.loaded !== "0") { this.dirty = true; await this.derived(engine); await this.save(); }
    this.touch(); return { status: await this.status(), groups: await fixGroups(engine), ...out };
  }
  async health() { return health(this.requireEngine()); }
  /** Load the fictional Playground through the normal import path, into a vault with no other data. */
  async playgroundLoad(progress: Progress) {
    const engine = await this.writable(progress), existing = await listSources(engine);
    if (existing.some(s => !s.name.startsWith(PLAYGROUND_PREFIX))) throw new VaultError("PLAYGROUND", msg("vault.thePlaygroundLoadsOnly"));
    if (existing.length) throw new VaultError("PLAYGROUND", msg("vault.thePlaygroundIsAlready"));
    const { files, manifest } = generatePlayground();
    this.studio.clear();
    await this.studio.add(files.map(f => new File([f.text], f.name, { type: "text/csv" })), []);
    await this.studio.plan(engine, this.tier, new AbortController().signal, progress);
    progress(msg("vault.loadingPlaygroundRows"), "0", "1");
    await this.studio.commit(engine, true);
    this.dirty = true; progress(msg("vault.updatingMarginTotals"), "0", "1"); await this.derived(engine, false); await this.save(); this.touch();
    return { status: await this.status(), manifest };
  }
  async playgroundRemove() {
    const engine = await this.writable(), sources = (await listSources(engine)).filter(s => s.name.startsWith(PLAYGROUND_PREFIX));
    for (const s of sources) await removeSource(engine, s.id);
    if (sources.length) { this.dirty = true; await engine.conn.query(REMOVE_SAMPLE_SQL); await this.derived(engine); await this.save(); }
    return { status: await this.status(), removed: String(sources.length) };
  }
  // ---- Margin intelligence (chunk 4D) -------------------------------------------------
  private dataVersion = 0;
  // Roadmap 14.1 (audit B-7): leak results are kept per date window for the current data version, so Home (90 days)
  // and Margin (full history) each run the finder once and no longer throw each other's result away. The finder's
  // temporary tables hold only the last window it ran; `tables` names that window, for the evidence rows and totals.
  private leakCache: { engine: Engine; version: number; results: Map<string, LeakResult>; tables: string | null } | null = null;
  /** After any change to sales lines: rebuild the pre-aggregate and reconcile it with the lines (same transaction).
   * Roadmap 14.2 (audit B-14): an import or a file removal already rebuilt the rebate accruals inside its own
   * transaction (where an overlapping agreement rolls the import back), so those callers pass `accruals: false`. */
  private async derived(engine: Engine, accruals = true) {
    await engine.conn.query("BEGIN");
    try {
      await this.financialBody(engine, accruals);
      await engine.conn.query("COMMIT");
    } catch (error) { await engine.conn.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { this.dataVersion++; this.leakCache = null; this.dirty = true; }
  }
  private async financialBody(engine:Engine,accruals=true){
    if(accruals)await rebates.rebuildAccruals(engine);await engine.conn.query(await effectiveRebuildSql(engine));
    await engine.conn.query('UPDATE vault_meta SET pricing_revision=pricing_revision+1 WHERE id=1');
    const d=await findDifferences(engine);await engine.conn.query(await recordSql(d.found,new Date().toISOString()));
  }
  async supplierClaims(offset=0,grid?:unknown){this.rebateTier();return suppliers.claims(this.requireEngine(),offset,grid);}
  async supplierPurchases(offset=0,grid?:unknown,claimId?:string){this.rebateTier();return suppliers.purchases(this.requireEngine(),offset,grid,claimId);}
  async supplierProgress(offset=0,grid?:unknown){this.rebateTier();return suppliers.progress(this.requireEngine(),offset,grid);}
  async supplierClaimPreview(id:string){this.rebateTier();return suppliers.preview(this.requireEngine(),id);}
  async supplierClaimSave(input:suppliers.ClaimInput){this.rebateTier();const p=await suppliers.saveSql(this.requireEngine(),input,this.identity.userId);await this.write('supplier.claim_saved',{id:p.id,actor:this.identity.userId},e=>e.conn.query(p.sql).then(()=>undefined));return suppliers.preview(this.requireEngine(),p.id);}
  async supplierClaimStatus(id:string,status:suppliers.ClaimStatus){this.rebateTier();const sql=await suppliers.statusSql(this.requireEngine(),id,status);await this.write('supplier.claim_status',{id,status,actor:this.identity.userId},e=>e.conn.query(sql).then(()=>undefined));return suppliers.preview(this.requireEngine(),id);}
  async supplierClaimExport(id:string,format:'csv'|'xlsx',fingerprint:string){this.rebateTier();if(!['csv','xlsx'].includes(format))suppliers.bad();const p=await suppliers.exportPlan(this.requireEngine(),id,fingerprint),file=claimExport(p,format);await this.write('supplier.claim_exported',{id,format,actor:this.identity.userId},async e=>{if(p.sql)await e.conn.query(p.sql);});return file;}
  // Roadmap 15.3: payments received against supplier claims, and the accrual export for finance.
  async supplierClaimBalance(id:string){this.rebateTier();return finance.balance(this.requireEngine(),id,businessToday());}
  async supplierPaymentRecord(input:finance.PaymentInput){this.rebateTier();const p=await finance.paymentSql(this.requireEngine(),input,this.identity.userId,new Date().toISOString(),businessToday());await this.write('supplier.payment_recorded',{id:p.id,claim:String(input.claim),method:String(input.method),full:String(p.full),actor:this.identity.userId},e=>e.conn.query(p.sql).then(()=>undefined));return this.supplierClaimBalance(String(input.claim));}
  async supplierPaymentVoid(id:string){this.rebateTier();const p=await finance.voidSql(this.requireEngine(),id,this.identity.userId,new Date().toISOString(),businessToday());await this.write('supplier.payment_voided',{id,claim:p.claim,actor:this.identity.userId},e=>e.conn.query(p.sql).then(()=>undefined));return this.supplierClaimBalance(p.claim);}
  async rebateFinanceExport(format:'csv'|'xlsx'){this.rebateTier();if(!['csv','xlsx'].includes(format))throw new VaultError('SUPPLIER',msg('payment.invalid'));const today=businessToday(),data=await finance.financeRows(this.requireEngine(),today,new Date().toISOString()),file=finance.financeFile(data,format,today);await this.write('rebate.finance_exported',{format,rows:file.rows,actor:this.identity.userId},async()=>undefined);return file;}
  async rebateProgress(offset=0,grid?:unknown){this.rebateTier();return rebates.progress(this.requireEngine(),offset,grid);}
  async rebateState(){this.rebateTier();return rebates.state(this.requireEngine());}
  async rebateRows(id:string,offset=0,grid?:unknown){this.rebateTier();return rebates.evidence(this.requireEngine(),id,offset,grid);}
  async rebateSave(input:rebates.ProgramInput){
    this.rebateTier();const plan=await rebates.saveSql(this.requireEngine(),input,this.identity.userId);
    await this.write('rebate.program_saved',{id:plan.id,actor:this.identity.userId},async e=>{await e.conn.query(plan.sql);await this.financialBody(e);});return this.rebateState();
  }
  async rebateDelete(id:string){this.rebateTier();const sql=await rebates.removeSql(this.requireEngine(),id);await this.write('rebate.program_removed',{id,actor:this.identity.userId},async e=>{await e.conn.query(sql);await this.financialBody(e);});return this.rebateState();}
  async rebateRecalculate(){this.rebateTier();await this.write('rebate.recalculated',{actor:this.identity.userId},e=>this.financialBody(e));return this.rebateState();}
  async creditsLoad(sourceId: string) {
    const engine = await this.writable(), out = await loadCredits(engine, sourceId, this.tier);
    if (out.loaded !== "0") { this.dirty = true; await this.derived(engine); await this.save(); }
    this.touch(); return { status: await this.status(), groups: await fixGroups(engine), ...out };
  }
  async marginWaterfall(filters?: Filters) { return waterfall(this.requireEngine(), filters); }
  async marginDrill(dim: Dim, filters?: Filters, sort?: "margin" | "pocket" | "rate", grid?: unknown) { return drill(this.requireEngine(), dim, filters, sort, 100, grid); }
  async marginWhale(filters?: Filters) { return whale(this.requireEngine(), this.tier, filters); }
  async marginMath(metric: Metric, filters?: Filters, offset = 0, grid?: unknown) { return math(this.requireEngine(), metric, filters, offset, grid); }
  private async isSample(engine: Engine) { const s = await listSources(engine); return s.length > 0 && s.every(x => x.name.startsWith(PLAYGROUND_PREFIX)); }
  private async leakFor(window?: { from: string; to: string }, tables = false) {
    const engine = this.requireEngine(), costToServe = this.licence.tier !== 'starter', key = [costToServe, window?.from ?? '', window?.to ?? ''].join('|');
    if (!this.leakCache || this.leakCache.engine !== engine || this.leakCache.version !== this.dataVersion) this.leakCache = { engine, version: this.dataVersion, results: new Map(), tables: null };
    const cache = this.leakCache;
    let result = cache.results.get(key);
    // The temporary tables name no window while the finder runs, so a run that fails part-way is never read as complete.
    if (!result || (tables && cache.tables !== key)) { cache.tables = null; result = await findLeaks(engine, costToServe, window); cache.results.set(key, result); cache.tables = key; }
    return result;
  }
  private leakResult() { return this.leakFor(); }
  /** Run the leak finder and record new or changed findings in the ROI ledger (audited, saved). */
  async leaks(): Promise<LeaksView> {
    const result = await this.leakResult(), engine = this.requireEngine(), sample = await this.isSample(engine);
    const { sql, changed } = await ledgerSql(engine, result.findings, sample, new Date().toISOString());
    // A read-only command (audit B-6): the ROI ledger is updated only while the licence allows writes; the findings show either way.
    if (changed && this.licence.writable) {
      const w = await this.writable();
      await w.conn.query("BEGIN");
      try { await w.conn.query(sql); await appendAudit(w, "leaks.recorded", { findings: String(result.findings.length), changed: String(changed), sample: String(sample) }); await w.conn.query("COMMIT"); }
      catch (error) { await w.conn.query("ROLLBACK").catch(() => undefined); throw error; }
      this.dirty = true; await this.save();
    }
    this.touch(); return { result, roi: await roiSummary(engine), sample, recorded: changed };
  }
  async leakRows(id: string, offset = 0, grid?: unknown) { await this.leakFor(undefined, true); return leakRows(this.requireEngine(), id, offset, 25, grid); }
  async roi() { return roiSummary(this.requireEngine()); }
  /** Read-only, cost-gated by dispatch. Does not renew the inactivity timer or
   * write the ROI ledger. Home only requests this while the screen is mounted. */
  /** Selection totals for a grid held in the browser (7V-3a): DuckDB sums only the values the caller already
   * shows, so it reveals nothing the role cannot see. Read-only; no audit row. */
  // ---- 7V-3b: row notes and the customer list / item master grids (capability `data`) ----
  async customerList(offset=0,grid?:unknown){return notes.customerList(this.requireEngine(),offset,grid);}
  async productList(offset=0,grid?:unknown){return notes.productList(this.requireEngine(),(await this.access()).caps.includes("cost"),offset,grid);}
  /** Saves one note. The audit records the kind and row ID, never the note text. */
  async noteSet(kind:unknown,id:unknown,text:unknown){let saved:string|null=null;await this.write("data.note_saved",{kind:String(kind),id:String(id)},async e=>{await e.conn.query(await notes.noteSql(e,kind,id,text));saved=notes.checkNote(text);});return {kind,id,notes:saved};}
  async sourceRemovePreview(id:string){return notes.removalNotes(this.requireEngine(),id);}
  // ---- 7E-1: vendor price review and purchase price variance (Professional and Scale; capability `cost`) ----
  // 7E-2 historical simulator: Scale licence only, checked here in the worker. The run lives in a temporary table of
  // this engine and is valid only while the data it replayed is unchanged.
  private simLast:{engine:Engine;version:number;result:Awaited<ReturnType<typeof sim.simulate>>}|null=null;
  private scaleTier(){if(this.licence.tier!=='scale')throw new VaultError('LICENCE',msg('sim.needScale'));}
  private simCurrent(){const e=this.requireEngine(),l=this.simLast;return l&&l.engine===e&&l.version===this.dataVersion?l:null;}
  async simOptions(){this.scaleTier();const e=this.requireEngine();return {...await sim.simOptions(e),last:this.simCurrent()?.result??null};}
  async simRun(scenario:unknown,signal:AbortSignal,progress:Progress){this.scaleTier();const e=this.requireEngine();this.simLast=null;const result=await sim.simulate(e,scenario,signal,progress);this.simLast={engine:e,version:this.dataVersion,result};this.touch();return result;}
  // Roadmap 15.7: saved runs to compare. Saving keeps the last run's totals and a stamp of the data it replayed.
  async simSaved(){this.scaleTier();return simRuns.saved(this.requireEngine());}
  async simSave(name:unknown){this.scaleTier();const l=this.simCurrent();if(!l)throw new VaultError('SIM',msg('sim.runFirst'));const p=await simRuns.saveSql(l.engine,name,l.result,this.identity.userId,new Date().toISOString());const kept=l.engine.warm==='writable';await this.write('sim.run_saved',{id:p.id,actor:this.identity.userId},e=>e.conn.query(p.sql).then(()=>undefined));this.keepSim(l,kept);return this.simSaved();}
  async simSavedDelete(id:unknown){this.scaleTier();const sql=await simRuns.deleteSql(this.requireEngine(),id);const l=this.simCurrent(),kept=l?.engine.warm==='writable';await this.write('sim.run_deleted',{id:String(id),actor:this.identity.userId},e=>e.conn.query(sql).then(()=>undefined));this.keepSim(l,kept);return this.simSaved();}
  /** Saving or deleting a run changes no replayed data: the run in the temporary table stays current, as long as the
   * engine was already writable (the first write after unlock can swap the engine and drop temporary tables). */
  private keepSim(l:typeof this.simLast,kept:boolean){if(l&&kept&&this.simLast===l&&this.engine===l.engine)this.simLast={...l,version:this.dataVersion};}
  async simRows(dim:unknown,offset=0,grid?:unknown){this.scaleTier();const l=this.simCurrent();if(!l)throw new VaultError('SIM',msg('sim.runFirst'));return sim.simRows(l.engine,dim,offset,grid);}

  private packLast:{engine:Engine;version:number;data:cadence.Pack}|null=null;
  private currentPack(){const p=this.packLast;return p&&p.engine===this.engine&&p.version===this.dataVersion?p.data:null;}
  async reportState(){this.opsTier();return {...await cadence.state(this.requireEngine()),ready:this.currentPack()};}
  async reportCheck(kind:cadence.PackKind,month:string|undefined,signal:AbortSignal,progress:Progress){
    this.opsTier();const e=await this.writable(progress);this.packLast=null;
    try{const {stamp,...data}=await cadence.check(e,kind,month,signal,progress);if(signal.aborted)throw cadence.cancelled();progress(msg('vault.savingEncryptedSnapshot'),'0','1','save');await this.write('report.checked',{id:data.id,kind},engine=>engine.conn.query(stamp).then(()=>undefined));this.packLast={engine:e,version:this.dataVersion,data};return data;}
    catch(error){if(signal.aborted)throw cadence.cancelled();if(error instanceof VaultError)throw error;throw new VaultError('REPORT',msg('cadence.failed'));}finally{if(this.leakCache)this.leakCache.tables=null;}
  }
  async reportExport(id:string,locale?:string){this.opsTier();const p=this.currentPack();if(!p||p.id!==id)throw new VaultError('REPORT',msg('cadence.stale'));if(!isLocale(locale))throw new VaultError('REPORT',msg('cadence.invalid'));const bytes=reportPdf(p,locale);await this.write('report.cadence_pdf',{id:p.id,kind:p.kind,locale},async()=>undefined);this.packLast={engine:this.requireEngine(),version:this.dataVersion,data:p};return {name:'rebatehq-'+p.kind+'-'+p.window.from+'.pdf',blob:new Blob([bytes as Uint8Array<ArrayBuffer>],{type:'application/pdf'})};}
  async roiV2(){return recovery.summary(this.requireEngine());}
  async roiRows(kind:recovery.RoiKind,offset=0,grid?:unknown){return recovery.page(this.requireEngine(),kind,offset,grid);}
  async roiRecord(input:recovery.RecoveryInput){await this.guard('cost');const p=await recovery.recordSql(this.requireEngine(),input,this.identity.userId);await this.write('roi.recovery_recorded',{id:p.id,ledger:input.ledger,run:input.run},e=>e.conn.query(p.sql).then(()=>undefined));return this.roiV2();}
  async roiVoid(id:string){await this.guard('cost');const sql=await recovery.voidSql(this.requireEngine(),id,this.identity.userId);await this.write('roi.recovery_voided',{id},e=>e.conn.query(sql).then(()=>undefined));return this.roiV2();}
  async scorecard(input:compliance.ScoreInput={}){this.quoteTier();return compliance.scorecard(this.requireEngine(),this.identity.userId,input);}
  async scorecardOptIn(optIn:boolean){this.quoteTier();const sql=compliance.consentSql(this.identity.userId,optIn);await this.write('scorecard.consent',{actor:this.identity.userId},e=>e.conn.query(sql).then(()=>undefined));return {optIn};}

  async vendorSheets(){this.opsTier();return vendor.vendorSheets(this.requireEngine());}
  async vendorReview(sheet:unknown,window?:unknown,offset=0,grid?:unknown){this.opsTier();return vendor.vendorReview(this.requireEngine(),sheet,window,offset,grid);}
  async vendorReviewQuotes(sheet:unknown,offset=0,grid?:unknown){this.opsTier();return vendor.vendorReviewQuotes(this.requireEngine(),sheet,offset,grid);}
  async vendorPpv(range:{from?:unknown;to?:unknown}={},offset=0,grid?:unknown){this.opsTier();return vendor.ppv(this.requireEngine(),range,offset,grid);}
  async vendorPpvLines(product:unknown,range:{from?:unknown;to?:unknown}={},offset=0,grid?:unknown){this.opsTier();return vendor.ppvLines(this.requireEngine(),product,range,offset,grid);}
  async gridTotals(types:unknown,values:unknown){return valuesTotals(this.requireEngine(),types,values);}
  async homeMonitor(thresholdBp='500'){
    const e=this.requireEngine();
    try{
      const health=await customerHealth(e,thresholdBp,undefined,500),leaks=await this.leakFor(health.window);
      return {health,leaks,currency:await workspaceCurrency(e),checkedAt:new Date().toISOString()};
    }catch(error){if(error instanceof VaultError)throw error;throw new VaultError('QUERY',msg('monitor.failed'));}
  }
  // ---------------------------------------------------------------- Quote Desk and Price Check (7B)
  private quoteTier() { if (this.licence.tier === "starter") throw new VaultError("LICENCE", msg("quote.needsProfessional")); }
  private async quoteView(id: string) { const a = await this.access(); return quotes.view(this.requireEngine(), id, this.identity.userId, a.caps.includes("cost"), a.caps.includes("quoteApprove")); }
  private async ownQuote(id: string) { const v = await this.quoteView(id); const a = await this.access(); if (!v.mine && !a.caps.includes("quoteApprove") && !a.caps.includes("cost")) throw new VaultError("FORBIDDEN", msg("vault.cannotDoThisAsk", { roleLabel: a.roleLabel })); return v; }
  /** Price Check: book price, start/target/floor and the zone for one SKU and customer. Never cost (decision 16). */
  /** Team sharing: a floor flagged as based on cost reaches only roles with cost; others get the target in its place. */
  private async costFloors() { return (await this.access()).caps.includes("cost"); }
  async priceCheck(productId: string, customerId: string | null, quantity: string) { this.quoteTier(); return quotes.pricePoint(this.requireEngine(), productId, customerId, quantity || "1", undefined, await this.costFloors()); }
  async quoteCreate(customerId: string) {
    this.quoteTier(); const at = new Date().toISOString(), plan = await quotes.createSql(this.requireEngine(), customerId, this.identity.userId, at);
    await this.write("quote.created", { quote_id: plan.id, actor: this.identity.userId }, async w => { await w.conn.query(plan.sql); });
    return this.quoteView(plan.id);
  }
  async quoteLines(id: string, lines: quotes.LineInput[]) {
    this.quoteTier(); const sql = await quotes.linesSql(this.requireEngine(), id, lines, this.identity.userId, new Date().toISOString(), await this.costFloors());
    await this.write("quote.lines", { quote_id: id, lines: String(lines.length) }, async w => { await w.conn.query(sql); });
    return this.quoteView(id);
  }
  async quoteSubmit(id: string, reason: string | null) {
    this.quoteTier(); const plan = await quotes.submitSql(this.requireEngine(), id, reason, this.identity.userId, new Date().toISOString());
    await this.write("quote.submitted", { quote_id: id, status: plan.status }, async w => { await w.conn.query(plan.sql); });
    return this.quoteView(id);
  }
  async quoteDecide(id: string, decision: "approve" | "reject", note: string | null) {
    this.quoteTier(); const sql = await quotes.decideSql(this.requireEngine(), id, decision, note, this.identity.userId, new Date().toISOString());
    await this.write("quote.decided", { quote_id: id, decision }, async w => { await w.conn.query(sql); });
    return this.quoteView(id);
  }
  /** The author takes a pending quote back to a draft (Phase 1): the fix for an exception nobody can approve. */
  async quoteWithdraw(id: string) {
    this.quoteTier(); const sql = await quotes.withdrawSql(this.requireEngine(), id, this.identity.userId, new Date().toISOString());
    await this.write("quote.withdrawn", { quote_id: id, actor: this.identity.userId }, async w => { await w.conn.query(sql); });
    return this.quoteView(id);
  }
  async quoteGet(id: string) { this.quoteTier(); return this.ownQuote(id); }
  // ---- Roadmap Phase 11: copy and revise, validity date, customer PDF, branding, price list and mailing list -------
  /** 11.1: a new draft of the caller's own from any quote they can open. */
  async quoteCopy(id: string) {
    this.quoteTier(); await this.ownQuote(id); const plan = await quotes.copySql(this.requireEngine(), id, this.identity.userId, new Date().toISOString(), await this.costFloors());
    await this.write("quote.copied", { quote_id: plan.id, from: id, actor: this.identity.userId }, async w => { await w.conn.query(plan.sql); });
    return this.quoteView(plan.id);
  }
  /** 11.1: a sent quote changed as a new version; the approval is never carried over. */
  async quoteRevise(id: string) {
    this.quoteTier(); await this.ownQuote(id); const a = await this.access();
    const plan = await quotes.reviseSql(this.requireEngine(), id, this.identity.userId, a.caps.includes("quoteApprove"), new Date().toISOString(), a.caps.includes("cost"));
    await this.write("quote.revised", { quote_id: plan.id, from: id, actor: this.identity.userId }, async w => { await w.conn.query(plan.sql); });
    return this.quoteView(plan.id);
  }
  /** 11.2: the date the quoted prices hold until. */
  async quoteValidity(id: string, validUntil: string | null) {
    this.quoteTier(); const sql = await quotes.validitySql(this.requireEngine(), id, validUntil, this.identity.userId, new Date().toISOString());
    await this.write("quote.validity", { quote_id: id }, async w => { await w.conn.query(sql); });
    return this.quoteView(id);
  }
  /** 11.3: the customer quote PDF, always drawn from a view WITHOUT cost, whoever asks (decision 16). */
  async quotePdf(id: string, locale: import("../i18n/core").Locale) {
    this.quoteTier(); if (!isLocale(locale)) throw new VaultError("QUOTE", msg("qdoc.localeInvalid"));
    await this.ownQuote(id); const e = this.requireEngine(), a = await this.access();
    const v = await quotes.view(e, id, this.identity.userId, false, a.caps.includes("quoteApprove"));
    return documents.quotePdf(v, await documents.branding(e), locale, await workspaceCurrency(e), businessToday());
  }
  async brandingGet() { this.quoteTier(); return documents.branding(this.requireEngine()); }
  async brandingSet(input: unknown) {
    this.quoteTier(); const sql = await documents.brandingSql(this.requireEngine(), input, this.identity.userId, new Date().toISOString());
    await this.write("quote.branding_saved", { actor: this.identity.userId }, async w => { await w.conn.query(sql); });
    return documents.branding(this.requireEngine());
  }
  /** 11.4: one customer's book prices at quantity 1, as a file (prices only). */
  async priceList(customerId: string, format: "csv" | "xlsx") {
    this.quoteTier(); const out = await documents.priceList(this.requireEngine(), customerId, format, businessToday());
    await this.write("quote.price_list_exported", { customer_id: customerId, rows: String(out.rows), format }, async () => undefined);
    return out;
  }
  /** 11.4: who a planned price increase reaches, for the letter's mail-out. */
  async priceMailing(runId: string) {
    this.opsTier(); const out = await documents.mailingList(this.requireEngine(), runId, businessToday());
    await this.write("pricing.mailing_exported", { run_id: runId, rows: String(out.rows) }, async () => undefined);
    return out;
  }
  // ---- 8B-1: Margin Drain agents and cost index triggers (Professional and Scale; worker checks) ----------------
  /** The first scheduled check after an unlock is recorded as the "open" check. */
  private agentsOpened = false;
  /** Agent bookkeeping: audited and saved, but it neither resets the idle lock timer nor counts as a data change. */
  private async agentWrite(details: Record<string, string>, work: (e: Engine) => Promise<void>) {
    const e = await this.writable(); await e.conn.query('BEGIN');
    try { await work(e); await appendAudit(e, 'agents.checked', details); await e.conn.query('COMMIT'); }
    catch (error) { await e.conn.query('ROLLBACK').catch(() => undefined); throw error; }
    this.dirty = true; await this.save();
  }
  private async agentPass(reason: 'schedule' | 'open' | 'manual', signal?: AbortSignal, progress?: (n: number) => void) {
    const e = this.requireEngine(), s = await agents.settings(e), startedAt = new Date().toISOString();
    const found = await agents.collect(e, s, () => this.leakResult(), businessToday(), signal, progress);
    const r = await agents.reconcileSql(e, found, reason, startedAt, new Date().toISOString());
    await this.agentWrite({ reason, findings: r.stats.findings, fresh: r.stats.fresh, resolved: r.stats.resolved }, x => x.conn.query(r.sql).then(() => undefined));
    return r.stats;
  }
  async agentState() {
    this.opsTier(); const e = this.requireEngine(), s = await agents.settings(e), last = await agents.lastRun(e);
    return { settings: s, last, due: agents.due(s, last, Date.now()), nextAt: last && s.enabled ? new Date(Date.parse(last.finishedAt) + s.intervalMinutes * 60_000).toISOString() : null, counts: await agents.counts(e) };
  }
  async agentRows(offset = 0, grid?: unknown) { this.opsTier(); return agents.inbox(this.requireEngine(), offset, grid); }
  async agentRun(signal: AbortSignal, progress: Progress) { this.opsTier(); await this.agentPass('manual', signal, n => progress(msg('agents.progress', { step: n + 1 }), String(n), '7')); this.touch(); return this.agentState(); }
  async agentMark(key: unknown, status: unknown) { this.opsTier(); const sql = agents.markSql(key, status); await this.write('agents.marked', { status: String(status) }, e => e.conn.query(sql).then(() => undefined)); return this.agentState(); }
  async agentSettingsSave(input: unknown) { this.opsTier(); const sql = agents.settingsSql(input, new Date().toISOString()); await this.write('agents.settings_saved', {}, e => e.conn.query(sql).then(() => undefined)); return this.agentState(); }
  /** Called by the worker every minute and right after unlock: runs a due check for a cost role, silently. Returns whether it ran. */
  async agentsDue() {
    if (!this.engine || !this.licence.writable || this.licence.tier === 'starter') return false;
    try {
      const a = await this.access(); if (!a.caps.includes('cost')) return false;
      const e = this.engine, s = await agents.settings(e);
      if (!agents.due(s, await agents.lastRun(e), Date.now())) return false;
      await this.agentPass(this.agentsOpened ? 'schedule' : 'open'); return true;
    } catch { return false; } finally { this.agentsOpened = true; }
  }
  async indexState() { this.opsTier(); const e = this.requireEngine(); return { series: await costindex.series(e), triggers: await costindex.triggers(e) }; }
  async indexSkus(id: unknown, offset = 0, grid?: unknown) { this.opsTier(); return costindex.triggerSkus(this.requireEngine(), id, offset, grid); }
  async indexTriggerSave(input: costindex.TriggerInput) { this.opsTier(); const p = await costindex.triggerSql(this.requireEngine(), input, this.identity.userId, new Date().toISOString()); await this.write('index.trigger_saved', { id: p.id }, e => e.conn.query(p.sql).then(() => undefined)); return this.indexState(); }
  async indexTriggerDelete(id: unknown) { this.opsTier(); const sql = costindex.deleteSql(id); await this.write('index.trigger_deleted', { id: String(id) }, e => e.conn.query(sql).then(() => undefined)); return this.indexState(); }
  // 8D: opt-in anonymous benchmarks (BENCHMARKS_DESIGN.md). Professional/Scale. Cost roles read the bands and the
  // fetched figures; only the local Owner maps categories and records shares, figures and withdrawal. The network call
  // itself is the Owner's explicit click on the Benchmarks screen; the worker never sends anything.
  private async benchOwner() { this.opsTier(); if ((await this.access()).role !== 'owner') throw new VaultError('FORBIDDEN', msg('bench.ownerOnly')); }
  async benchState() { this.opsTier(); const a = await this.access(); return { ...await bench.state(this.requireEngine()), quarter: lastCompleteQuarter(), owner: a.role === 'owner' }; }
  async benchPreview(quarter: unknown) { this.opsTier(); return bench.preview(this.requireEngine(), quarter); }
  async benchMapSave(mapping: unknown) { await this.benchOwner(); const sql = bench.mappingSql(mapping, new Date().toISOString()); await this.write('bench.mapping_saved', { categories: String(Object.keys(mapping as object).length) }, e => e.conn.query(sql).then(() => undefined)); return this.benchState(); }
  async benchShared(payload: unknown, stored: unknown) { await this.benchOwner(); const p = bench.shareSql(payload, stored, this.identity.userId, new Date().toISOString()); await this.write('bench.shared', { quarter: p.quarter, rows: String(p.rows) }, e => e.conn.query(p.sql).then(() => undefined)); return this.benchState(); }
  async benchFiguresSave(quarter: unknown, cells: unknown) { await this.benchOwner(); const sql = bench.figuresSql(quarter, cells, new Date().toISOString()); await this.write('bench.figures_saved', { quarter: String(quarter), cells: String((cells as unknown[]).length) }, e => e.conn.query(sql).then(() => undefined)); return this.benchState(); }
  async benchWithdrawn() { await this.benchOwner(); await this.write('bench.withdrawn', {}, e => e.conn.query(bench.withdrawnSql(new Date().toISOString())).then(() => undefined)); return this.benchState(); }
  // 8B-2: the dead-stock clearance optimiser (Professional/Scale). Reads need cost; settings and drafts need pricing, and a
  // draft goes through the normal changeset, Pricing Owner approval and export.
  async deadState() { this.opsTier(); const e = this.requireEngine(), s = await deadstock.settings(e), today = businessToday(); return { settings: s, summary: await deadstock.summary(e, s, today), page: await deadstock.page(e, s, today) }; }
  async deadRows(offset = 0, grid?: unknown) { this.opsTier(); const e = this.requireEngine(); return deadstock.page(e, await deadstock.settings(e), businessToday(), offset, grid); }
  async deadSettingsSave(input: unknown) { this.opsTier(); const sql = deadstock.settingsSql(input, new Date().toISOString()); await this.write('dead.settings_saved', {}, e => e.conn.query(sql).then(() => undefined)); return this.deadState(); }
  async deadDraft(ids: unknown) {
    this.opsTier(); await this.requireOwnerNamed(); const e = this.requireEngine();
    const picks = await deadstock.picks(e, await deadstock.settings(e), businessToday(), ids);
    if (!picks.length) throw new VaultError('DEADSTOCK', msg('dead.noneToDraft'));
    let run = ''; const details = { actor: this.identity.userId, run_id: '', items: String(picks.length) };
    await this.write('dead.draft_created', details, async w => { run = await ops.clearanceDraft(w, picks, this.identity.userId); details.run_id = run; });
    return this.rulePreview(run);
  }
  // 8C-1: the win/loss log. The quote's author, or a role that may approve or see cost, records the outcome; reports
  // follow the quote list rule (a Sales Rep sees only their own quotes) and carry margin only for "cost".
  async quoteOutcome(id: string, input: unknown) {
    this.quoteTier(); await this.ownQuote(id); const sql = await winloss.outcomeSql(this.requireEngine(), id, input, this.identity.userId, new Date().toISOString());
    const o = input as winloss.OutcomeInput; await this.write('quote.outcome', { quote_id: id, outcome: String(o.outcome), reason: String(o.reason) }, e => e.conn.query(sql).then(() => undefined)); return this.ownQuote(id);
  }
  async winLoss(input: winloss.ReportInput = {}) { this.quoteTier(); const a = await this.access(); const cost = a.caps.includes('cost'); return winloss.report(this.requireEngine(), input, { userId: this.identity.userId, mineOnly: !a.caps.includes('quoteApprove') && !cost, withCost: cost }); }
  // 8C-1: the audit and compliance pack (every tier) and two local document templates (Professional/Scale).
  private async exported(action: string, details: Record<string, string>) { if (this.licence.writable) await this.write(action, details, async () => undefined); }
  async auditPack(locale: unknown) {
    if (!isLocale(locale)) throw new VaultError('AUDIT', msg('cadence.invalid'));
    const p = await auditPack(this.requireEngine(), locale); await this.exported('audit.pack_exported', { entries: p.verification.entries, valid: String(p.verification.chain_valid) });
    return { name: p.name, blob: new Blob([p.bytes as BlobPart], { type: 'application/zip' }), verification: p.verification };
  }
  async templateVendors() { this.opsTier(); return (await this.requireEngine().conn.query("SELECT DISTINCT vendor FROM vendor_costs ORDER BY vendor LIMIT 1000")).toArray().map(r => String(r.vendor)); }
  async negotiationSheet(vendor: unknown, locale: unknown) {
    this.opsTier(); if (!isLocale(locale)) throw new VaultError('TEMPLATE', msg('templates.invalid'));
    const e = this.requireEngine(), f = await templates.negotiationSheet(e, vendor, locale, await workspaceCurrency(e)); await this.exported('template.negotiation_sheet', { vendor: String(vendor), items: String(f.facts.items) });
    return { name: f.name, blob: new Blob([f.bytes as BlobPart], { type: 'application/pdf' }) };
  }
  async rebateAgreement(id: unknown, locale: unknown) {
    this.rebateTier(); if (!isLocale(locale)) throw new VaultError('TEMPLATE', msg('templates.invalid'));
    const e = this.requireEngine(), f = await templates.rebateAgreement(e, id, locale, await workspaceCurrency(e)); await this.exported('template.rebate_agreement', { program_id: String(id) });
    return { name: f.name, blob: new Blob([f.bytes as BlobPart], { type: 'application/pdf' }) };
  }
  // 8A: explainable deal guidance and cross-sell for a quote the caller may open. Both are rep-safe (decision 16).
  async quoteGuidance(id: string) { this.quoteTier(); await this.ownQuote(id); return quoteGuidance(this.requireEngine(), id); }
  async quoteCrossSell(id: string) { this.quoteTier(); const v = await this.ownQuote(id); return { quoteId: id, suggestions: await crossSell(this.requireEngine(), v.customerId, v.lines.map(l => l.productId)) }; }
  async quoteList(pendingOnly: boolean) {
    this.quoteTier(); const a = await this.access();
    return quotes.list(this.requireEngine(), { pendingOnly, userId: this.identity.userId, mineOnly: !a.caps.includes("quoteApprove") && !a.caps.includes("cost") });
  }
  /** Share an exception through the encrypted 7A inbox: the reference is the quote number and its price total, never cost. */
  async quoteShare(id: string, preset: "standard" | "conservative", signal: AbortSignal) {
    this.quoteTier(); await this.guard("collaborate"); const v = await this.ownQuote(id);
    if (v.status !== "pending") throw new VaultError("QUOTE", msg("quote.notPending"));
    const cents = BigInt(v.totalCents), amount = `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
    const shared = await this.relay({ id: "quote", action: "relayShare", data: { input: { objectKind: "quote", title: plainText(msg("quote.shareTitle", { number: v.number })), reference: v.number, amount, currency: await workspaceCurrency(this.requireEngine()), preset: preset === "conservative" ? "conservative" : "standard" } } } as never, signal) as { objects?: { id: string; author: string; subject: { reference: string } }[] };
    // Quote numbers are per vault, so match this author's newest object with the number.
    const object = shared.objects?.filter(o => o.subject.reference === v.number && o.author === this.identity.userId).pop();
    if (!object) throw new VaultError("QUOTE", msg("quote.shareFailed"));
    const sql = await quotes.linkSql(this.requireEngine(), id, object.id, new Date().toISOString());
    await this.write("quote.linked", { quote_id: id }, async w => { await w.conn.query(sql); });
    return this.quoteView(id);
  }
  /**
   * Apply a signed 7A decision (verified by the relay session) to the local quote. The shared subject must still
   * match the quote (number and price total), and an approval counts only when every approver holds quoteApprove
   * in this vault and is not the quote's author. A rejection is always applied (it only makes the quote stricter).
   */
  async quoteRelaySync(id: string, signal: AbortSignal) {
    this.quoteTier(); await this.guard("collaborate"); const v = await this.ownQuote(id);
    if (!v.relayObject || v.status !== "pending" || !v.mine) return v;
    const view = await this.relay({ id: "quote", action: "relaySync", data: {} } as never, signal) as { objects?: { id: string; author: string; subject: { reference: string; amountMinor: string; currency: string }; approval?: { status: string; decisions: { userId: string; decision: string }[] } | null }[] };
    const object = view.objects?.find(o => o.id === v.relayObject);
    const status = object?.approval?.status;
    if (!object || (status !== "approved" && status !== "rejected")) return v;
    if (object.author !== this.identity.userId || object.subject.reference !== v.number || String(object.subject.amountMinor) !== v.totalCents || object.subject.currency !== await workspaceCurrency(this.requireEngine())) throw new VaultError("QUOTE", msg("quote.relayMismatch"));
    if (status === "approved") {
      const approvers = object.approval!.decisions.filter(d => d.decision === "approve").map(d => d.userId);
      if (!approvers.length) throw new VaultError("QUOTE", msg("quote.relayNotApprover"));
      for (const userId of approvers) {
        if (userId === v.createdBy || !(await roles.assignedCaps(this.requireEngine(), userId)).includes("quoteApprove")) throw new VaultError("QUOTE", msg("quote.relayNotApprover"));
      }
    }
    const sql = await quotes.decideSql(this.requireEngine(), id, status === "approved" ? "approve" : "reject", null, this.identity.userId, new Date().toISOString(), "relay:" + v.relayObject);
    await this.write("quote.decided", { quote_id: id, decision: status, via: "relay" }, async w => { await w.conn.query(sql); });
    return this.quoteView(id);
  }
  /** Command palette search over product and customer IDs and names. No cost or price column is read. */
  async search(query: string): Promise<SearchHit[]> {
    const e = this.requireEngine();
    if (typeof query !== "string" || query.length > 80 || /[\x00-\x1f]/.test(query)) throw new VaultError("SEARCH", msg("vault.searchInvalid"));
    const q = query.trim(); if (q.length < 2) return [];
    // ILIKE with an explicit escape character, so % and _ typed by the user match literally.
    const like = sqlText("%" + q.replace(/[!%_]/g, c => "!" + c) + "%");
    // Notes are searched and returned only for a role with `data` (7V-3b); a Sales Rep's search never reads them.
    const withNotes = (await this.access()).caps.includes("data"), note = (col: string) => withNotes ? `, CASE WHEN ${col} ILIKE ${like} ESCAPE '!' THEN left(${col}, 120) END AS note` : "", inNote = (col: string) => withNotes ? ` OR ${col} ILIKE ${like} ESCAPE '!'` : "";
    const products = (await e.conn.query(`SELECT product_id AS id, description AS label, category AS detail${note("notes")} FROM products WHERE product_id ILIKE ${like} ESCAPE '!' OR description ILIKE ${like} ESCAPE '!' OR barcode = ${sqlText(q)}${inNote("notes")} ORDER BY (barcode = ${sqlText(q)}) DESC NULLS LAST, product_id LIMIT 8`)).toArray();
    const customers = (await e.conn.query(`SELECT customer_id AS id, name AS label, tier AS detail${note("notes")} FROM customers WHERE customer_id ILIKE ${like} ESCAPE '!' OR name ILIKE ${like} ESCAPE '!'${inNote("notes")} ORDER BY customer_id LIMIT 8`)).toArray();
    const hit = (kind: SearchHit["kind"]) => (r: Record<string, unknown>): SearchHit => ({ kind, id: String(r.id), label: String(r.label ?? ""), detail: String(r.detail ?? ""), ...(withNotes && r.note !== null && r.note !== undefined ? { note: String(r.note) } : {}) });
    return [...products.map(hit("product")), ...customers.map(hit("customer"))];
  }
  /** Build the Margin Leak Report PDF in this worker (no upload), in the user's language; the export is audited.
   * `ids` limits the report to the findings selected on screen; without it every finding is in the report. */
  async leakReport(locale?: string, ids?: unknown) {
    const view = await this.leaks(), engine = this.requireEngine(), all = view.result;
    let chosen = all.findings;
    if (ids !== undefined && ids !== null) {
      if (!Array.isArray(ids) || !ids.length || ids.length > all.findings.length || ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) throw new VaultError("INPUT", msg("report.badSelection"));
      const known = new Set(all.findings.map(f => f.id)); if (ids.some(id => !known.has(id as string))) throw new VaultError("INPUT", msg("report.badSelection"));
      const pick = new Set(ids as string[]); chosen = all.findings.filter(f => pick.has(f.id));
    }
    await this.leakFor(undefined, true);
    const totals = await scopeTotals(engine, chosen.map(f => f.id));
    const result = { ...all, findings: chosen, totalCents: totals.totalCents, overlapCents: totals.overlapCents, overlapLines: totals.overlapLines, dedupedCents: totals.dedupedCents };
    const evidence: Record<string, Awaited<ReturnType<typeof leakRows>>["rows"]> = {};
    for (const f of result.findings.slice(0, 6)) evidence[f.id] = (await leakRows(engine, f.id, 0)).rows.slice(0, 5);
    const meta = (await engine.conn.query("SELECT count(*)::VARCHAR AS n, strftime(min(sale_date), '%Y-%m-%d') AS a, strftime(max(sale_date), '%Y-%m-%d') AS b FROM sales_lines")).toArray()[0];
    const sources = (await listSources(engine)).filter(s => s.role === "sales_history").map(s => s.name);
    const generatedAt = new Date().toISOString();
    const bytes = leakReport({ currency: await workspaceCurrency(engine), locale: isLocale(locale) ? locale : "en", generatedAt, sample: view.sample, lines: String(meta.n), from: meta.a === null ? null : String(meta.a), to: meta.b === null ? null : String(meta.b), sources, waterfall: await waterfall(engine), leaks: result, roi: view.roi, evidence, scope: { chosen: chosen.length, of: all.findings.length, affectedLines: totals.affectedLines } });
    const w = await this.writable();
    await w.conn.query("BEGIN");
    try { await appendAudit(w, "report.leak_pdf", { findings: String(result.findings.length), of: String(all.findings.length), bytes: String(bytes.byteLength), sample: String(view.sample) }); await w.conn.query("COMMIT"); }
    catch (error) { await w.conn.query("ROLLBACK").catch(() => undefined); throw error; }
    this.dirty = true; await this.save(); this.touch();
    return { name: `rebatehq-leak-report-${generatedAt.slice(0, 10)}.pdf`, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), bytes: String(bytes.byteLength), status: await this.status() };
  }
  /** Re-run reconciliation; open differences are replaced, accepted ones keep their status. */
  async reconcile() {
    const engine = this.requireEngine(), d = await findDifferences(engine), at = new Date().toISOString();
    // A read-only command (audit B-6): open differences are recorded only while the licence allows writes. Roadmap 14.5
    // (audit L-1): and only when they changed; before, every visit with an open difference rewrote and saved the vault.
    if (this.licence.writable && await differencesChanged(engine, d.found)) {
      const w = await this.writable();
      await w.conn.query("BEGIN");
      try { await w.conn.query(await recordSql(d.found, at)); await w.conn.query("COMMIT"); } catch (error) { await w.conn.query("ROLLBACK").catch(() => undefined); throw error; }
      this.dirty = true; await this.save();
    }
    return reconSummary(engine, d, at);
  }
  async reconAccept(id: string | null) {
    const engine = await this.writable();
    await engine.conn.query("BEGIN");
    try {
      await engine.conn.query(`UPDATE recon_issues SET status='accepted' WHERE status='open'${id === null ? "" : ` AND id=${sqlText(id)}`}`);
      await appendAudit(engine, "reconcile.accepted", { issue: id ?? "all open" }); await engine.conn.query("COMMIT");
    } catch (error) { await engine.conn.query("ROLLBACK").catch(() => undefined); throw error; }
    this.dirty = true; await this.save();
    const d = await findDifferences(engine);
    return { status: await this.status(), recon: await reconSummary(engine, d, new Date().toISOString()) };
  }
  /** Rebuild the pre-aggregate from the imported lines (never edits the lines), then reconcile. */
  async reconRebuild() {
    const engine = await this.writable();
    await this.derived(engine);
    await engine.conn.query("BEGIN");
    try { await appendAudit(engine, "reconcile.rebuilt", {}); await engine.conn.query("COMMIT"); } catch (error) { await engine.conn.query("ROLLBACK").catch(() => undefined); throw error; }
    await this.save();
    const d = await findDifferences(engine);
    return { status: await this.status(), recon: await reconSummary(engine, d, new Date().toISOString()) };
  }

  private async pricingWrite(action: string, work: (e: Engine) => Promise<void>) { await this.write(action, { actor: this.identity.userId }, work); }
  /** One audited, atomic change that is saved before it returns. */
  private async write(action: string, details: Record<string, string>, work: (e: Engine) => Promise<void>) {
    const e=await this.writable(); await e.conn.query('BEGIN');
    try {await work(e);await appendAudit(e,action,details);await e.conn.query('COMMIT');}
    catch(error){await e.conn.query('ROLLBACK').catch(()=>undefined);throw error;}
    this.dirty=true;this.dataVersion++;this.leakCache=null;await this.save();this.touch();
  }
  // ---- 5A: access, home, checklist, item cleanup, cost basis -----------------------------
  /** What the signed-in person may do here (cached until a role, the owner or the preview changes). */
  async access(): Promise<Access> {
    const e = this.requireEngine();
    // S3c: what this seat holds read-only travels with the role, so screens can disable those writes before they are tried.
    if (!this.accessCache) { const a = await roles.accessFor(e, this.identity.userId, this.viewAs);
      // Vaults since v9 always have relay_state; a hand-built test vault without it simply shares nothing.
      const held = await this.receivingPacks().catch(error => { if (/relay_state/.test(String(error))) return null; throw error; }); this.accessCache = { ...a, shared: held ? { packs: Object.fromEntries(held) } : null }; }
    return this.accessCache;
  }
  /** Called by the command dispatcher before every command: a role that may not do something never reaches its query. */
  async guard(cap: Cap | null) {
    if (!cap || !this.engine) return;
    const a = await this.access();
    if (!a.caps.includes(cap)) throw new VaultError("FORBIDDEN", msg("vault.cannotDoThisAsk", { roleLabel: a.roleLabel }));
  }
  /** A vault from before roles existed has none; whoever unlocks it becomes its Owner, once. */
  private async seedRoles() {
    const e = this.requireEngine();
    if (Number((await e.conn.query("SELECT count(*) AS n FROM role_assignments")).toArray()[0].n) > 0) return;
    if (!this.licence.writable) return; // seeding is a write; a read-only vault keeps the default owner access until it can save (audit B-6)
    const owner = (await pricing.pricingState(e)).owner, id = this.identity.userId;
    await this.write("roles.seeded", { actor: id }, async w => { await w.conn.query(roles.seedSql(id, owner && owner.id === id ? owner.name : "Vault owner", new Date().toISOString())); });
    this.accessCache = null;
  }
  async home(): Promise<HomeData> {
    const e = this.requireEngine(), access = await this.access(), has = (c: Cap) => access.caps.includes(c), state = await pricing.pricingState(e);
    // The greeting uses the caller's own name only: their role assignment, else the Pricing Owner name when that is them.
    const named = (await e.conn.query(`SELECT display_name FROM role_assignments WHERE user_id=${sqlText(this.identity.userId)} AND display_name<>'Vault owner'`)).toArray()[0];
    const displayName = named ? String(named.display_name) : state.owner?.id === this.identity.userId ? state.owner.name : null;
    const out: HomeData = { access, checklist: await this.checklist(), pricingOwner: state.owner?.name ?? null, guardrails: String(state.guards.length), displayName };
    const count = async (sql: string) => String((await e.conn.query(sql)).toArray()[0].n);
    if (has("cost")) { const w = await waterfall(e); out.margin = { netPocket: w.netPocket, margin: w.margin, rate: w.rate, uncostedLines: w.uncostedLines, lines: w.lines }; out.roi = await roiSummary(e); }
    if (has("data")) out.openFixLater = await count("SELECT count(*) AS n FROM rejected_rows WHERE status='open'");
    if (has("reconcile")) out.openRecon = await count("SELECT count(*) AS n FROM recon_issues WHERE status='open'");
    if (has("pricing")) { out.previews = await count("SELECT count(*) AS n FROM rule_runs WHERE status='preview'"); out.rules = await count("SELECT count(*) AS n FROM rules"); }
    return out;
  }
  async checklist() {
    const e = this.requireEngine(), { view, newly } = await setup.read(e);
    // Persist newly reached steps only when that costs nothing extra (no unsaved change, vault already writable).
    if (this.licence.writable && newly.length && !this.dirty && readyToWrite(e)) {
      await this.write("setup.steps", { steps: newly.join(",") }, async w => { await w.conn.query(setup.saveSql(newly, "auto", new Date().toISOString())); });
      return (await setup.read(this.requireEngine())).view;
    }
    return view;
  }
  async checklistMark(step: setup.Step) {
    if (!setup.STEP_INFO[step]?.manual) throw new VaultError("SETUP", msg("vault.onlyTheTeamStep"));
    await this.write("setup.marked", { step }, async w => { await w.conn.query(setup.saveSql([step], "manual", new Date().toISOString())); });
    return this.checklist();
  }
  private async actor() { const a = await roles.accessFor(this.requireEngine(), this.identity.userId, null); const owner = (await pricing.pricingState(this.requireEngine())).owner; return { userId: this.identity.userId, role: a.role, namedOwner: owner?.id === this.identity.userId }; }
  async roleList(): Promise<RoleList> {
    await this.seedRoles();
    const e = this.requireEngine(), you = await this.access(), canManage = you.caps.includes("roles"), all = await roles.people(e, this.identity.userId);
    return { people: canManage ? all : all.filter(p => p.you), you, pricingOwner: (await pricing.pricingState(e)).owner?.name ?? null, canManage, sharing: await this.roleSharing(canManage) };
  }
  /** What Team and roles shows about sharing: the draft or signed grid decides who receives which built packs. */
  private async roleSharing(canManage: boolean): Promise<import("./protocol").RoleSharing> {
    const state = await this.relayStateRead(), signed = this.signedGrid(state), draft = this.draftStale(state) ? null : state.gridDraft ?? null, grid = draft ?? signed;
    const canSign = !!signed && signed.people.some(p => p.userId === this.identity.userId && p.role === "owner"), built = new Set<string>(sharing.PACK_IDS);
    const receives = grid && canManage ? Object.fromEntries(grid.people.map(p => [p.userId,
      packsFor(p.role, grid.namedOwner === p.userId, Object.fromEntries(grid.ticks) as Partial<Record<typeof p.role, readonly AnyPack[]>>, p.extras).filter(x => built.has(x))])) : null;
    return { joined: state.epochs.length > 0, canSign, draft: !!draft, receives };
  }
  async roleSet(userId: string, name: string, role: RoleId) {
    await this.seedRoles();
    const e = this.requireEngine(), plan = await roles.setSql(e, await this.actor(), { userId, name, role }, new Date().toISOString());
    await this.write("roles.assigned", { actor: this.identity.userId, user: plan.userId, role }, async w => { await w.conn.query(plan.sql); });
    this.accessCache = null; await this.gridDraftPerson(plan.userId, role); return this.roleList();
  }
  async roleRemove(userId: string) {
    const sql = await roles.removeSql(this.requireEngine(), { userId: this.identity.userId }, userId);
    await this.write("roles.removed", { actor: this.identity.userId, user: userId }, async w => { await w.conn.query(sql); });
    this.accessCache = null; await this.gridDraftPerson(userId, "sales_rep"); return this.roleList();
  }
  /** Preview another role's view. It only ever removes capabilities from your own, and resets on lock. */
  async rolePreview(role: RoleId | null) {
    if (role !== null && !isRole(role)) throw new VaultError("ROLES", msg("vault.chooseOneOfThe"));
    this.requireEngine(); this.viewAs = role; this.accessCache = null; return this.roleList();
  }
  async costBasis() { return costBasis(this.requireEngine()); }
  async costBasisSet(group: string, basis: BasisId | null) {
    const sql = basisSql(group, basis);
    await this.write("costbasis.set", { actor: this.identity.userId, group: group.slice(0, 160), basis: basis ?? "invoice" }, async w => { await w.conn.query(sql); });
    return costBasis(this.requireEngine());
  }
  async cleanupScan() { return cleanup.scan(this.requireEngine()); }
  async cleanupHistory() { return cleanup.history(this.requireEngine()); }
  /** One fix inside its own transaction (the caller rebuilds the margin totals and saves). Returns whether a merge's second step finished. */
  private async applyFix(e: Engine, kind: cleanup.FixKind, key: string, target: string | null) {
    const p = await cleanup.plan(e, kind, key, target, this.identity.userId, new Date().toISOString());
    await e.conn.query("BEGIN");
    try { await e.conn.query(p.sql); await appendAudit(e, "cleanup.applied", { fix_id: p.fixId, kind, cells: String(p.cells) }); await e.conn.query("COMMIT"); }
    catch (error) { await e.conn.query("ROLLBACK").catch(() => undefined); throw error; }
    let finished = true;
    if (p.finishSql) { try { await e.conn.query(`BEGIN; ${p.finishSql} COMMIT`); } catch { await e.conn.query("ROLLBACK").catch(() => undefined); finished = false; } }
    return { id: p.fixId, summary: p.summary, finished };
  }
  private async undoFix(e: Engine, id: string) {
    const p = await cleanup.undoPlan(e, id, this.identity.userId, new Date().toISOString());
    await e.conn.query("BEGIN");
    try { await e.conn.query(p.sql); await appendAudit(e, "cleanup.undone", { fix_id: id, kind: p.kind, restored: String(p.restored), skipped: String(p.skipped) }); await e.conn.query("COMMIT"); }
    catch (error) { await e.conn.query("ROLLBACK").catch(() => undefined); throw error; }
    return p;
  }
  /** After fixes: merges changed product IDs on lines, so rebuild the margin totals once; then save. */
  private async afterFixes(e: Engine, merged: boolean) {
    this.dirty = true; if (merged) await this.derived(e); else { this.dataVersion++; this.leakCache = null; }
    await this.save(); this.touch();
  }
  async cleanupApply(kind: cleanup.FixKind, key: string, target: string | null = null): Promise<CleanupApplied> {
    const e = await this.writable(), fix = await this.applyFix(e, kind, key, target);
    await this.afterFixes(e, kind === "merge_duplicates");
    return { fix: fix.summary, finished: fix.finished, status: await this.status(), scan: await cleanup.scan(e), history: await cleanup.history(e) };
  }
  async cleanupUndo(id: string): Promise<CleanupUndone> {
    const e = await this.writable(), p = await this.undoFix(e, id);
    await this.afterFixes(e, p.kind === "merge_duplicates");
    return { summary: p.summary, restored: String(p.restored), skipped: String(p.skipped), status: await this.status(), scan: await cleanup.scan(e), history: await cleanup.history(e) };
  }
  /** Merge every "certain" duplicate group (case or spacing only) as one batch: each group is its own undoable fix, but the margin totals are rebuilt and saved once. */
  async cleanupMergeAll(progress?: Progress): Promise<CleanupMergedAll> {
    const e = await this.writable(progress), ids: string[] = [], tried = new Set<string>(); let unfinished = 0, skipped = 0, merged = false;
    try {
      for (let pass = 0; pass < 200; pass++) {
        const groups = (await cleanup.scan(e)).duplicates.filter(g => g.confidence === "certain" && !tried.has(g.key));
        if (!groups.length) break;
        for (const g of groups) {
          tried.add(g.key); progress?.(msg("vault.mergingDuplicateSkus"), String(ids.length + skipped), String(ids.length + skipped + groups.length));
          try { const fix = await this.applyFix(e, "merge_duplicates", g.key, null); ids.push(fix.id); merged = true; if (!fix.finished) unfinished++; }
          catch (error) { if (error instanceof VaultError) skipped++; else throw error; } // for example a group over the line limit: leave it for a manual merge
        }
      }
    } finally { if (merged) await this.afterFixes(e, true); }
    return { merged: String(ids.length), skipped: String(skipped), unfinished: String(unfinished), ids, status: await this.status(), scan: await cleanup.scan(e), history: await cleanup.history(e) };
  }
  /** Undo several fixes (newest first) with one rebuild and one save. */
  async cleanupUndoMany(ids: string[]): Promise<CleanupUndone> {
    if (!Array.isArray(ids) || ids.length > 5000 || ids.some(i => typeof i !== "string" || i.length > 64)) throw new VaultError("CLEANUP", msg("vault.chooseTheFixesTo"));
    const e = await this.writable(); let restored = 0, skipped = 0, merged = false, count = 0;
    try { for (const id of [...ids].reverse()) { const p = await this.undoFix(e, id); restored += p.restored; skipped += p.skipped; count++; merged ||= p.kind === "merge_duplicates"; } }
    finally { if (count) await this.afterFixes(e, merged); }
    return { summary: msg("vault.fixCount", { count }), restored: String(restored), skipped: String(skipped), status: await this.status(), scan: await cleanup.scan(e), history: await cleanup.history(e) };
  }  /** Guardrails and price floors are visible to every role; rules, simulations and their costs only to roles that edit pricing. */
  async competitorList(product:string,customer:string|null=null){this.opsTier();return market.competitors(this.requireEngine(),product,customer);}
  async competitorAdd(input:market.CompetitorInput){this.opsTier();await this.pricingWrite('pricing.competitor_recorded',async e=>{await e.conn.query(await market.competitorSql(e,input,this.identity.userId));});return this.competitorList(input.product);}
  async priceGrid(offset=0,search='',query?:unknown){return grid.gridRows(this.requireEngine(),this.licence.tier!=='starter',offset,search,query);}
  async priceGridPaste(text:string,keys:string[],start:number){return grid.pastedPrices(text,keys,start);}
  async priceGridDraft(edits:grid.GridEdit[],revision:string){await this.requireOwnerNamed();let id='';await this.pricingWrite('pricing.grid_drafted',async e=>{id=await grid.gridDraft(e,edits,revision,this.identity.userId,this.licence.tier);});return this.rulePreview(id);}
  async ruleWhatIf(id:string,increase:string,exact:boolean){this.opsTier();if(typeof exact!=='boolean')grid.fail();return whatIf(this.requireEngine(),id,increase,exact,this.dataVersion);}
  async serviceOrders(offset=0,query?:unknown){this.opsTier();return serviceCost.serviceOrders(this.requireEngine(),offset,query);}
  async serviceFlag(key:string,free:boolean){this.opsTier();await this.pricingWrite('pricing.delivery_confirmed',async e=>{await e.conn.query(await serviceCost.serviceFlagSql(e,key,free,this.identity.userId));});return this.serviceOrders();}
  async priceLandedState(id?:string,offset=0,query?:unknown){this.opsTier();return market.landedState(this.requireEngine(),id,offset,query);}
  async priceLandedCheck(receipt:string,file:File,signal?:AbortSignal){this.opsTier();const e=this.requireEngine(),r=(await pricing.rows(e,`SELECT rows_json FROM price_export_receipts WHERE id=${sqlText(receipt)}`))[0];if(!r)grid.fail();const result=await market.landedFile(file,JSON.parse(r.rows_json),signal),id=crypto.randomUUID();await this.pricingWrite('pricing.landed_checked',async db=>{await db.conn.query(`INSERT INTO price_landed_checks VALUES(${sqlText(id)},${sqlText(receipt)},${sqlText(file.name.slice(0,160))},${sqlText(new Date().toISOString())},${sqlText(JSON.stringify(result))})`);});return this.priceLandedState(id);}
  private opsTier(){if(this.licence.tier==='starter')throw new VaultError('LICENCE',msg('ops.needPro'));}
  async marginBridge(input?:BridgeInput){this.opsTier();return bridge(this.requireEngine(),input);}
  async priceOpsState(){this.opsTier();return ops.opsState(this.requireEngine());}
  async priceExceptions(input?:ops.ExceptionInput){this.opsTier();return ops.exceptions(this.requireEngine(),input);}
  async priceExpiry(days:number,asOf?:string,offset?:number,query?:unknown){this.opsTier();return ops.expiry(this.requireEngine(),days,asOf,offset,query);}
  async pricePlan(input:ops.PlanInput){this.opsTier();await this.requireOwnerNamed();let run='';const details={actor:this.identity.userId,run_id:''};await this.write('pricing.plan_drafted',details,async e=>{run=await ops.planDraft(e,input,this.identity.userId);details.run_id=run;});return this.rulePreview(run);}
  async priceRollback(version:string){this.opsTier();await this.requireOwnerNamed();let run='';const details={actor:this.identity.userId,run_id:'',version_id:version};await this.write('pricing.rollback_drafted',details,async e=>{run=await grid.gridRollback(e,version,this.identity.userId,this.licence.tier)??await ops.rollbackDraft(e,version,this.identity.userId);details.run_id=run;});return this.rulePreview(run);}
  async priceLetter(id:string,locale:import('../i18n/core').Locale){this.opsTier();const file=await ops.increaseLetter(this.requireEngine(),id,locale);await this.pricingWrite('pricing.letter_exported',async()=>{});return file;}
  async pricingState(){const state=await pricing.pricingState(this.requireEngine()),caps=(await this.access()).caps;
    // Team sharing: a floor based on cost is shown only to a role that can see cost (the same rule as the shared guardrails pack).
    const guards=caps.includes('cost')?state.guards:state.guards.map(g=>({tier:g.tier,category:g.category,start:g.start,target:g.target,floor:g.protectedFloor?g.target:g.floor,protectedFloor:false}));
    if(caps.includes('pricing'))return {...state,guards};return {...state,guards,rules:[],runs:[]};}
  /** Pricing changes need a named Pricing Owner (required at setup). */
  private async requireOwnerNamed(){if(!(await pricing.pricingState(this.requireEngine())).owner)throw new VaultError('OWNER',msg("vault.nameAPricingOwner"));}
  async pricingOwner(name:string, userId:string, backupDays=7){
    name=pricing.label(name);userId=pricing.label(userId);
    if(!Number.isInteger(backupDays)||backupDays<1||backupDays>90)throw new VaultError('PRICING',msg("vault.chooseABackupReminder"));
    await this.seedRoles();
    await this.pricingWrite('pricing.owner_set',async e=>{if((await pricing.pricingState(e)).owner)await pricing.owner(e,this.identity.userId);else if(userId!==this.identity.userId)throw new VaultError('PRICING',msg("vault.firstNameYourselfAs"));await e.conn.query(`DELETE FROM pricing_settings WHERE id=1;INSERT INTO pricing_settings VALUES(1,${sqlText(userId)},${sqlText(name)},${backupDays});UPDATE vault_meta SET pricing_revision=pricing_revision+1 WHERE id=1`);});
    this.accessCache=null;
    return this.pricingState();
  }
  async guardSet(input: pricing.GuardInput){await this.requireOwnerNamed();await this.pricingWrite('pricing.guardrail',async e=>{await e.conn.query(pricing.guardSql(input));});return this.pricingState();}
  async ruleSave(input: pricing.RuleInput){await this.requireOwnerNamed();let id='';await this.pricingWrite('pricing.rule_version',async e=>{const r=await pricing.ruleSql(e,input);id=r.id;await e.conn.query(r.sql);});return {id,state:await this.pricingState()};}
  async ruleSimulate(id:string){await this.requireOwnerNamed();let result:{id:string;count:number;ms:number}|undefined;
    await this.pricingWrite('pricing.simulated',async e=>{const r=await pricing.simulate(e,id);await e.conn.query(r.sql);result=r;});
    return {...await pricing.preview(this.requireEngine(),result!.id),ms:result!.ms};
  }
  async rulePreview(id:string,offset=0,query?:unknown){if(id.startsWith("ops-"))this.opsTier();return id.startsWith("grid-")?grid.gridPreview(this.requireEngine(),id,this.licence.tier,offset,query):pricing.preview(this.requireEngine(),id,offset,query);}
  async ruleApprove(id:string){if(id.startsWith("ops-"))this.opsTier();await this.pricingWrite('pricing.approved',async e=>{const isGrid=id.startsWith('grid-');await e.conn.query(await pricing.approveSql(e,id,this.identity.userId,isGrid?await grid.gridApproval(e,id,this.licence.tier):await ops.approvalMatrixSql(e,id),isGrid?await grid.gridPreview(e,id,this.licence.tier):undefined));});await this.derived(this.requireEngine());await this.save();const config=await backupConfig(this.storage.scope);if(config.directory)await this.backupNow().catch(()=>undefined);return {preview:await this.rulePreview(id),backup:await this.backupStatus()};}
  // Roadmap 15.6: a workspace's own export layouts. Listing them needs export rights, as does changing them.
  async exportLayouts(){return layouts.layouts(this.requireEngine());}
  async exportLayoutSave(input:unknown,id?:unknown){const p=await layouts.saveSql(this.requireEngine(),input,id,this.identity.userId,new Date().toISOString());await this.write('pricing.layout_saved',{id:p.id,actor:this.identity.userId},e=>e.conn.query(p.sql).then(()=>undefined));return this.exportLayouts();}
  async exportLayoutDelete(id:unknown){const sql=await layouts.deleteSql(this.requireEngine(),id);await this.write('pricing.layout_deleted',{id:String(id),actor:this.identity.userId},e=>e.conn.query(sql).then(()=>undefined));return this.exportLayouts();}
  async priceExport(id:string,profile:ErpProfile,format:'csv'|'xlsx',layout?:string){
    if(id.startsWith('ops-'))this.opsTier();
    if(layout!==undefined&&layout!==null)return this.priceExportCustom(id,layout,format);
    const e=this.requireEngine();const file=id.startsWith('grid-')?await market.gridExport(e,id,profile,format,this.licence.tier,await this.rulePreview(id)):await pricing.exportPrices(e,id,profile,format,await ops.exportCustomer(e,id));
    const receipt=await market.exportReceipt(e,id,profile,this.licence.tier),receiptSql=await market.receiptSql(id,profile,file.blob,receipt);
    await this.pricingWrite('pricing.exported',async e=>{await e.conn.query(`UPDATE rule_runs SET status='exported' WHERE id=${sqlText(id)};${receiptSql}`);});return file;
  }
  /** The approved rows of the run, reshaped by a custom layout. The receipt is the generic one: the same prices. */
  private async priceExportCustom(id:string,layoutId:string,format:'csv'|'xlsx'){
    if(!['csv','xlsx'].includes(format))throw new VaultError('PRICING',msg('layout.invalid'));
    const e=this.requireEngine(),l=await layouts.layout(e,layoutId),status=(await this.rulePreview(id)).status;
    if(!['approved','exported'].includes(status))throw new VaultError('PRICING',msg('rules.thePricingOwnerMust'));
    const receipt=await market.exportReceipt(e,id,'generic',this.licence.tier),file=layouts.layoutFile(l,receipt,format),receiptSql=await market.receiptSql(id,'generic',file.blob,receipt);
    await this.pricingWrite('pricing.exported',async e=>{await e.conn.query(`UPDATE rule_runs SET status='exported' WHERE id=${sqlText(id)};${receiptSql}`);});
    return {...file,logName:'rebatehq-change-log.csv',log:market.csvBlob(market.receiptTable(receipt)),warning:msg('layout.unverified',{name:l.name})};
  }
  async backupStatus(){const c=await backupConfig(this.storage.scope);const settings=this.engine?(await this.pricingState()).owner:null;return {configured:!!c.directory,hours:c.hours,last:c.last,error:c.error,reminder:!c.last||Date.now()-Date.parse(c.last)>(settings?.backupDays??7)*86400000};}
  async backupConfigure(directory:FileSystemDirectoryHandle|null,hours:number){this.requireEngine();if(!Number.isInteger(hours)||hours<1||hours>168)throw new VaultError('BACKUP',msg("vault.chooseABackupInterval"));const old=await backupConfig(this.storage.scope);await storeBackupConfig(this.storage.scope,{...old,directory,hours});return this.backupStatus();}
  async backupNow(){
    const c=await backupConfig(this.storage.scope);if(!c.directory)throw new VaultError('BACKUP',msg("vault.chooseABackupFolder"));
    try {if(this.licence.writable)await this.pricingWrite('backup.folder_export',async()=>{});const h=await this.storage.readHead();await writeBackup(await this.storage.file(h!.current),c.directory);await storeBackupConfig(this.storage.scope,{...c,last:new Date().toISOString(),error:false});}
    catch(error){await storeBackupConfig(this.storage.scope,{...c,error:true});throw error;}
    return this.backupStatus();
  }
  async backupDue(){if(!this.engine||this.dirty)return;const c=await backupConfig(this.storage.scope);if(c.directory&&(!c.last||Date.now()-Date.parse(c.last)>=c.hours*3600000))await this.backupNow();}
  async backupExport(){if(this.licence.writable)await this.pricingWrite('backup.file_export',async()=>{});const h=await this.storage.readHead();return {name:'rebatehq-vault.enc',blob:await this.storage.file(h!.current)};}
  async backupRestore(file:Blob,passphrase:string){
    if(this.engine||await this.storage.exists())throw new VaultError('BACKUP',msg("vault.restoreIntoAnEmpty"));
    if(file.size>600*1024*1024)throw new VaultError('BACKUP',msg("vault.thisBackupExceedsThe"));
    await this.lease();let bytes:Uint8Array|undefined;
    try {const value=await decrypt(file,passphrase,this.storage.scope);passphrase='';bytes=value.bytes;this.engine=await openMemory(bytes);this.key=value.key;
      const meta=(await this.engine.conn.query('SELECT scope,tier FROM vault_meta WHERE id=1')).toArray()[0];if(meta.scope!==this.storage.scope||!['starter','professional','scale'].includes(meta.tier))throw new Error('metadata');
      if(!(await verifyAudit(this.engine)).valid)throw new Error('audit');this.tier=this.licence.effective(meta.tier as Tier);await this.migrate();await makeWritable(this.engine);
      await this.engine.conn.query('BEGIN');await appendAudit(this.engine,'backup.restored',{});await this.engine.conn.query('COMMIT');this.dirty=true;this.generation=value.sequence;await this.save();this.touch();return this.status();
    }catch(error){await this.dispose();throw error instanceof VaultError?error:new VaultError('BACKUP',msg("vault.wrongPassphraseWorkspaceOr"));}
  }

  async verify() { return verifyAudit(this.requireEngine()); }
  async lock() {
    if (this.engine && this.dirty) await this.save();
    await this.dispose(); return this.status();
  }
  async autoLock() {
    let saved = true;
    try { if (this.engine && this.dirty) await this.save(); } catch { saved = false; }
    finally { await this.dispose(); }
    return saved;
  }
  private async dispose() {
    if (this.timer) clearTimeout(this.timer); this.timer = null; this.stopBell(); this.lastBackground = 0;
    const engine = this.engine; this.engine = null; this.key = null; this.packLast=null; this.agentsOpened = false; this.studio.clear(); this.leakCache = null; this.accessCache = null; this.viewAs = null;
    if (engine) await closeMemory(engine).catch(() => undefined);
    this.releaseLease?.(); this.releaseLease = null; this.dirty = false;
  }
  async currencySet(currency: string) {
    await this.write('workspace.currency_set', {}, async e => { const sql = await currencyChangeSql(e, currency); if (sql) await e.conn.query(sql); });
    this.studio.clear();
    return this.status();
  }
  async status(): Promise<VaultStatus> {
    const base: VaultStatus = { phase: "none", licence:this.licence.view(), state: this.engine ? "unlocked" : "locked", exists: await this.storage.exists(), dirty: this.dirty,
      writable: !!this.engine && readyToWrite(this.engine), preparing: this.engine?.warm === "copying", recovered: this.recovered, lines: "0", products: "0", customers: "0", auditEntries: "0", currency: "USD", schemaVersion: "0", generation: this.generation, tier: this.tier, lastSaved: this.lastSaved };
    base.phase = vaultPhase(base); // 9.2: one value beside the flags, from the same facts
    if (!this.engine) return base;
    const data = (await this.engine.conn.query(`SELECT (SELECT count(*) FROM sales_lines)::VARCHAR AS lines,(SELECT count(*) FROM products)::VARCHAR AS products,(SELECT count(*) FROM customers)::VARCHAR AS customers,audit_count::VARCHAR AS entries,schema_version::VARCHAR AS version FROM vault_meta WHERE id=1`)).toArray()[0];
    // A role without cost access never has cost or margin selected: the query itself leaves them out.
    const access = await this.access(), cost = access.caps.includes("cost");
    const files = (await this.engine.conn.query(SAMPLE_COUNTS_SQL)).toArray()[0], sample = sampleState(Number(files.sample), Number(files.real));
    const totals = (await this.engine.conn.query(`SELECT coalesce(sum(list_cents),0)::VARCHAR AS list,coalesce(sum(discount_cents),0)::VARCHAR AS discounts,coalesce(sum(freight_cents),0)::VARCHAR AS freight,coalesce(sum(rebate_cents),0)::VARCHAR AS rebates,coalesce(sum(list_cents-discount_cents-freight_cents-rebate_cents),0)::VARCHAR AS pocket${cost ? `,coalesce(sum(cost_cents),0)::VARCHAR AS cost,coalesce(sum(list_cents-discount_cents-freight_cents-rebate_cents-cost_cents),0)::VARCHAR AS margin` : ""} FROM ${await salesInput(this.engine)}`)).toArray()[0];
    return { ...base, currency: await workspaceCurrency(this.requireEngine()), lines: String(data.lines), products: String(data.products), customers: String(data.customers), auditEntries: String(data.entries), schemaVersion: String(data.version), sample, totals: { cost: null, margin: null, ...totals } as VaultStatus["totals"], access };
  }
}
