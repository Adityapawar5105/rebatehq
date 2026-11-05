import { VaultLicence, capacitySql } from "./licence";
import type { Action } from "./protocol";
import * as pricing from '../pricing/rules';
import { backupConfig, storeBackupConfig, writeBackup } from './backup';
import { openMemory, snapshotBytes, closeMemory, makeWritable, startWarmup, type Engine } from "./engine";
import { VaultStorage } from "./storage";
import { decrypt, deriveKey, type Key } from "./crypto";
import { appendAudit, verifyAudit, GENESIS } from "./audit";
import { V1_SQL, SCHEMA_VERSION, upgradeSql } from "./schema";
import { sqlText } from "../spike/exact";
import { Studio, listSources, loadRecipes, recipeSql, removeSource, type Progress } from "../studio/studio";
import type { Role, Settings } from "../studio/formats";
import type { ErpProfile, FieldSource } from "../studio/mapper";
import { dismissSql, fixGroups, fixRows, fixSetSql, recheck } from "../studio/fixlater";
import { health } from "../studio/health";
import { PLAYGROUND_PREFIX, generatePlayground } from "../studio/playground";
import { AUTO_LOCK_MS, LEASE_WAIT_MS, VaultError, type LeaksView, type Scope, type Tier, type VaultStatus } from "./protocol";
import { REBUILD_SQL, findDifferences, reconSummary, recordSql } from "../margin/aggregate";
import { drill, math, waterfall, whale, type Dim, type Filters, type Metric } from "../margin/views";
import { findLeaks, leakRows, type LeakResult } from "../margin/leaks";
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
import {RelaySession,emptyRelay,type RelayState} from '../relay/session';
import {relayHttp} from '../relay/http';
import {RelayError} from '../relay/protocol';
import {minorUnits} from '../spike/exact';
import { msg } from "../i18n/core";
export class VaultService {
  async relay(request:Extract<import('./protocol').Request,{action:`relay${string}`}>,signal:AbortSignal){
    this.licence.assert();if(this.licence.tier==='starter')throw new VaultError('LICENCE',msg("vault.workspaceSharingRequiresProfessional"));
    const deviceId=this.licence.claims?.device??'';
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(deviceId))throw new VaultError('LICENCE',msg("vault.reconnectToVerifyThis"));
    const rows=(await this.requireEngine().conn.query('SELECT payload FROM relay_state WHERE id=1')).toArray();
    const state:RelayState=rows.length?JSON.parse(String(rows[0].payload)):emptyRelay();
    const session=new RelaySession({...this.identity,deviceId},state,relayHttp(deviceId,signal),async(value,stage)=>{
      await this.write('relay.'+stage,{actor:this.identity.userId},async e=>{await e.conn.query(`INSERT INTO relay_state VALUES(1,${sqlText(JSON.stringify(value))}) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`);});
    },signal);
    switch(request.action){
      case 'relayView':return session.view();case 'relayRegister':return session.register();case 'relayJoin':return session.join(request.data.fingerprint);
      case 'relayRotate':return session.rotate(request.data.confirmations);case 'relaySync':return session.sync();
      case 'relayShare':{const {amount,...input}=request.data.input;let amountMinor:string;try{amountMinor=minorUnits(amount).toString();}catch{throw new RelayError('CONTENT',msg("vault.enterANonNegative"));}return session.share({...input,amountMinor});}
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
  licenceGuard(action:Action) { this.licence.guard(action); }
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
  readonly studio = new Studio();
  // autoWarm: start the copy-on-write in the background right after unlock.
  constructor(private onIdle: () => void, private idleMs = AUTO_LOCK_MS, private leaseWaitMs = LEASE_WAIT_MS, private autoWarm = true) {}
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
  touch() {
    if (this.timer) clearTimeout(this.timer);
    if (this.engine) this.timer = setTimeout(this.onIdle, this.idleMs);
    return { ok: true };
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
      this.engine = await openMemory(decoded.bytes); // one engine; registered RAM buffer only
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
    if (!engine.writable) { progress?.(engine.warming ? msg("vault.finishingPreparingTheVault") : msg("vault.preparingTheVaultFor"), "0", "1"); await makeWritable(engine); }
    return engine;
  }
  private async recipes() { return loadRecipes(this.requireEngine()); }
  async studioState() { return this.studio.state(await this.recipes()); }
  async studioAdd(files: File[], replaces: string | null = null) { this.requireEngine(); await this.studio.add(files, await this.recipes(), replaces); return this.studioState(); }
  async studioUpdate(id: string, settings: Partial<Settings> = {}, role?: Role | null, extra: { erp?: ErpProfile; field?: { name: string; source: FieldSource }; confirmed?: boolean; range?: { from: string | null; to: string | null } } = {}) {
    this.requireEngine(); await this.studio.update(id, { ...settings, ...(role !== undefined ? { role } : {}), ...extra }); return this.studioState();
  }
  async studioDrop(id: string) { this.requireEngine(); this.studio.drop(id); return this.studioState(); }
  async studioClear() { this.requireEngine(); this.studio.clear(); return this.studioState(); }
  async studioPlan(signal: AbortSignal, progress: Progress) { await this.studio.plan(this.requireEngine(), this.tier, signal, progress); return this.studioState(); }
  async studioCommit(acknowledge: boolean, progress: Progress) {
    const engine = await this.writable(progress);
    progress(msg("vault.loadingRowsIntoThe"), "0", "1");
    const result = await this.studio.commit(engine, acknowledge);
    this.dirty = true; progress(msg("vault.updatingMarginTotals2"), "0", "1"); await this.derived(engine);
    progress(msg("vault.savingEncryptedSnapshot"), "0", "1"); await this.save();
    progress(msg("vault.saved"), "1", "1"); this.touch();
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
    this.dirty = true; await this.derived(engine); await this.save(); this.touch();
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
    this.dirty = true; progress(msg("vault.updatingMarginTotals"), "0", "1"); await this.derived(engine); await this.save(); this.touch();
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
  private leakCache: { version: number; result: LeakResult } | null = null;
  /** After any change to sales lines: rebuild the pre-aggregate and reconcile it with the lines (same transaction). */
  private async derived(engine: Engine) {
    await engine.conn.query("BEGIN");
    try {
      await engine.conn.query(REBUILD_SQL);
      await engine.conn.query("UPDATE vault_meta SET pricing_revision=pricing_revision+1 WHERE id=1");
      const d = await findDifferences(engine);
      await engine.conn.query(await recordSql(d.found, new Date().toISOString()));
      await engine.conn.query("COMMIT");
    } catch (error) { await engine.conn.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { this.dataVersion++; this.leakCache = null; this.dirty = true; }
  }
  async creditsLoad(sourceId: string) {
    const engine = await this.writable(), out = await loadCredits(engine, sourceId, this.tier);
    if (out.loaded !== "0") { this.dirty = true; await this.derived(engine); await this.save(); }
    this.touch(); return { status: await this.status(), groups: await fixGroups(engine), ...out };
  }
  async marginWaterfall(filters?: Filters) { return waterfall(this.requireEngine(), filters); }
  async marginDrill(dim: Dim, filters?: Filters, sort?: "margin" | "pocket" | "rate") { return drill(this.requireEngine(), dim, filters, sort); }
  async marginWhale(filters?: Filters) { return whale(this.requireEngine(), this.tier, filters); }
  async marginMath(metric: Metric, filters?: Filters, offset = 0) { return math(this.requireEngine(), metric, filters, offset); }
  private async isSample(engine: Engine) { const s = await listSources(engine); return s.length > 0 && s.every(x => x.name.startsWith(PLAYGROUND_PREFIX)); }
  private async leakResult() {
    const engine = this.requireEngine();
    if (!this.leakCache || this.leakCache.version !== this.dataVersion) this.leakCache = { version: this.dataVersion, result: await findLeaks(engine) };
    return this.leakCache.result;
  }
  /** Run the leak finder and record new or changed findings in the ROI ledger (audited, saved). */
  async leaks(): Promise<LeaksView> {
    const result = await this.leakResult(), engine = this.requireEngine(), sample = await this.isSample(engine);
    const { sql, changed } = await ledgerSql(engine, result.findings, sample, new Date().toISOString());
    if (changed) {
      const w = await this.writable();
      await w.conn.query("BEGIN");
      try { await w.conn.query(sql); await appendAudit(w, "leaks.recorded", { findings: String(result.findings.length), changed: String(changed), sample: String(sample) }); await w.conn.query("COMMIT"); }
      catch (error) { await w.conn.query("ROLLBACK").catch(() => undefined); throw error; }
      this.dirty = true; await this.save();
    }
    this.touch(); return { result, roi: await roiSummary(engine), sample, recorded: changed };
  }
  async leakRows(id: string, offset = 0) { await this.leakResult(); return leakRows(this.requireEngine(), id, offset); }
  async roi() { return roiSummary(this.requireEngine()); }
  // ---------------------------------------------------------------- Quote Desk and Price Check (7B)
  private quoteTier() { if (this.licence.tier === "starter") throw new VaultError("LICENCE", msg("quote.needsProfessional")); }
  private async quoteView(id: string) { const a = await this.access(); return quotes.view(this.requireEngine(), id, this.identity.userId, a.caps.includes("cost")); }
  private async ownQuote(id: string) { const v = await this.quoteView(id); const a = await this.access(); if (!v.mine && !a.caps.includes("quoteApprove") && !a.caps.includes("cost")) throw new VaultError("FORBIDDEN", msg("vault.cannotDoThisAsk", { roleLabel: a.roleLabel })); return v; }
  /** Price Check: book price, start/target/floor and the zone for one SKU and customer. Never cost (decision 16). */
  async priceCheck(productId: string, customerId: string | null, quantity: string) { this.quoteTier(); return quotes.pricePoint(this.requireEngine(), productId, customerId, quantity || "1"); }
  async quoteCreate(customerId: string) {
    this.quoteTier(); const at = new Date().toISOString(), plan = await quotes.createSql(this.requireEngine(), customerId, this.identity.userId, at);
    await this.write("quote.created", { quote_id: plan.id, actor: this.identity.userId }, async w => { await w.conn.query(plan.sql); });
    return this.quoteView(plan.id);
  }
  async quoteLines(id: string, lines: quotes.LineInput[]) {
    this.quoteTier(); const sql = await quotes.linesSql(this.requireEngine(), id, lines, this.identity.userId, new Date().toISOString());
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
  async quoteGet(id: string) { this.quoteTier(); return this.ownQuote(id); }
  async quoteList(pendingOnly: boolean) {
    this.quoteTier(); const a = await this.access();
    return quotes.list(this.requireEngine(), { pendingOnly, userId: this.identity.userId, mineOnly: !a.caps.includes("quoteApprove") && !a.caps.includes("cost") });
  }
  /** Share an exception through the encrypted 7A inbox: the reference is the quote number and its price total, never cost. */
  async quoteShare(id: string, preset: "standard" | "conservative", signal: AbortSignal) {
    this.quoteTier(); await this.guard("collaborate"); const v = await this.ownQuote(id);
    if (v.status !== "pending") throw new VaultError("QUOTE", msg("quote.notPending"));
    const cents = BigInt(v.totalCents), amount = `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
    const shared = await this.relay({ id: "quote", action: "relayShare", data: { input: { objectKind: "quote", title: plainText(msg("quote.shareTitle", { number: v.number })), reference: v.number, amount, currency: "USD", preset: preset === "conservative" ? "conservative" : "standard" } } } as never, signal) as { objects?: { id: string; author: string; subject: { reference: string } }[] };
    // Quote numbers are per vault, so match this author's newest object with the number.
    const object = shared.objects?.filter(o => o.subject.reference === v.number && o.author === this.identity.userId).pop();
    if (!object) throw new VaultError("QUOTE", msg("quote.shareFailed"));
    const sql = await quotes.linkSql(this.requireEngine(), id, object.id, new Date().toISOString());
    await this.write("quote.linked", { quote_id: id }, async w => { await w.conn.query(sql); });
    return this.quoteView(id);
  }
  /** Apply a signed 7A decision (verified by the relay session) to the local quote. */
  async quoteRelaySync(id: string, signal: AbortSignal) {
    this.quoteTier(); await this.guard("collaborate"); const v = await this.ownQuote(id);
    if (!v.relayObject || v.status !== "pending") return v;
    const view = await this.relay({ id: "quote", action: "relaySync", data: {} } as never, signal) as { objects?: { id: string; approval?: { status: string } }[] };
    const status = view.objects?.find(o => o.id === v.relayObject)?.approval?.status;
    if (status !== "approved" && status !== "rejected") return v;
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
    const products = (await e.conn.query(`SELECT product_id AS id, description AS label, category AS detail FROM products WHERE product_id ILIKE ${like} ESCAPE '!' OR description ILIKE ${like} ESCAPE '!' ORDER BY product_id LIMIT 8`)).toArray();
    const customers = (await e.conn.query(`SELECT customer_id AS id, name AS label, tier AS detail FROM customers WHERE customer_id ILIKE ${like} ESCAPE '!' OR name ILIKE ${like} ESCAPE '!' ORDER BY customer_id LIMIT 8`)).toArray();
    const hit = (kind: SearchHit["kind"]) => (r: Record<string, unknown>): SearchHit => ({ kind, id: String(r.id), label: String(r.label ?? ""), detail: String(r.detail ?? "") });
    return [...products.map(hit("product")), ...customers.map(hit("customer"))];
  }
  /** Build the Margin Leak Report PDF in this worker (no upload), in the user's language; the export is audited. */
  async leakReport(locale?: string) {
    const view = await this.leaks(), engine = this.requireEngine(), result = view.result;
    const evidence: Record<string, Awaited<ReturnType<typeof leakRows>>["rows"]> = {};
    for (const f of result.findings.slice(0, 6)) evidence[f.id] = (await leakRows(engine, f.id, 0)).rows.slice(0, 5);
    const meta = (await engine.conn.query("SELECT count(*)::VARCHAR AS n, strftime(min(sale_date), '%Y-%m-%d') AS a, strftime(max(sale_date), '%Y-%m-%d') AS b FROM sales_lines")).toArray()[0];
    const sources = (await listSources(engine)).filter(s => s.role === "sales_history").map(s => s.name);
    const generatedAt = new Date().toISOString();
    const bytes = leakReport({ locale: isLocale(locale) ? locale : "en", generatedAt, sample: view.sample, lines: String(meta.n), from: meta.a === null ? null : String(meta.a), to: meta.b === null ? null : String(meta.b), sources, waterfall: await waterfall(engine), leaks: result, roi: view.roi, evidence });
    const w = await this.writable();
    await w.conn.query("BEGIN");
    try { await appendAudit(w, "report.leak_pdf", { findings: String(result.findings.length), bytes: String(bytes.byteLength), sample: String(view.sample) }); await w.conn.query("COMMIT"); }
    catch (error) { await w.conn.query("ROLLBACK").catch(() => undefined); throw error; }
    this.dirty = true; await this.save(); this.touch();
    return { name: `rebatehq-leak-report-${generatedAt.slice(0, 10)}.pdf`, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), bytes: String(bytes.byteLength), status: await this.status() };
  }
  /** Re-run reconciliation; open differences are replaced, accepted ones keep their status. */
  async reconcile() {
    const engine = this.requireEngine(), d = await findDifferences(engine), at = new Date().toISOString();
    const open = Number((await engine.conn.query("SELECT count(*) AS n FROM recon_issues WHERE status='open'")).toArray()[0].n);
    if (d.found.length || open) {
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
  async access(): Promise<Access> { const e = this.requireEngine(); return this.accessCache ??= await roles.accessFor(e, this.identity.userId, this.viewAs); }
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
    const owner = (await pricing.pricingState(e)).owner, id = this.identity.userId;
    await this.write("roles.seeded", { actor: id }, async w => { await w.conn.query(roles.seedSql(id, owner && owner.id === id ? owner.name : "Vault owner", new Date().toISOString())); });
    this.accessCache = null;
  }
  async home(): Promise<HomeData> {
    const e = this.requireEngine(), access = await this.access(), has = (c: Cap) => access.caps.includes(c), state = await pricing.pricingState(e);
    const out: HomeData = { access, checklist: await this.checklist(), pricingOwner: state.owner?.name ?? null, guardrails: String(state.guards.length) };
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
    if (this.licence.writable && newly.length && !this.dirty && (e.writable || e.warmReady)) {
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
    return { people: canManage ? all : all.filter(p => p.you), you, pricingOwner: (await pricing.pricingState(e)).owner?.name ?? null, canManage };
  }
  async roleSet(userId: string, name: string, role: RoleId) {
    await this.seedRoles();
    const e = this.requireEngine(), plan = await roles.setSql(e, await this.actor(), { userId, name, role }, new Date().toISOString());
    await this.write("roles.assigned", { actor: this.identity.userId, user: plan.userId, role }, async w => { await w.conn.query(plan.sql); });
    this.accessCache = null; return this.roleList();
  }
  async roleRemove(userId: string) {
    const sql = await roles.removeSql(this.requireEngine(), { userId: this.identity.userId }, userId);
    await this.write("roles.removed", { actor: this.identity.userId, user: userId }, async w => { await w.conn.query(sql); });
    this.accessCache = null; return this.roleList();
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
  async pricingState(){const state=await pricing.pricingState(this.requireEngine());if((await this.access()).caps.includes('pricing'))return state;return {...state,rules:[],runs:[]};}
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
  async rulePreview(id:string,offset=0){return pricing.preview(this.requireEngine(),id,offset);}
  async ruleApprove(id:string){await this.pricingWrite('pricing.approved',async e=>{await e.conn.query(await pricing.approveSql(e,id,this.identity.userId));});await this.derived(this.requireEngine());await this.save();const config=await backupConfig(this.storage.scope);if(config.directory)await this.backupNow().catch(()=>undefined);return {preview:await this.rulePreview(id),backup:await this.backupStatus()};}
  async priceExport(id:string,profile:ErpProfile,format:'csv'|'xlsx'){
    const file=await pricing.exportPrices(this.requireEngine(),id,profile,format);
    await this.pricingWrite('pricing.exported',async e=>{await e.conn.query(`UPDATE rule_runs SET status='exported' WHERE id=${sqlText(id)}`);});return file;
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
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    const engine = this.engine; this.engine = null; this.key = null; this.studio.clear(); this.leakCache = null; this.accessCache = null; this.viewAs = null;
    if (engine) await closeMemory(engine).catch(() => undefined);
    this.releaseLease?.(); this.releaseLease = null; this.dirty = false;
  }
  async status(): Promise<VaultStatus> {
    const base: VaultStatus = { licence:this.licence.view(), state: this.engine ? "unlocked" : "locked", exists: await this.storage.exists(), dirty: this.dirty,
      writable: !!this.engine?.writable || !!this.engine?.warmReady, preparing: !!this.engine && !this.engine.writable && !!this.engine.warming && !this.engine.warmDone, recovered: this.recovered, lines: "0", products: "0", customers: "0", auditEntries: "0", schemaVersion: "0", generation: this.generation, tier: this.tier, lastSaved: this.lastSaved };
    if (!this.engine) return base;
    const data = (await this.engine.conn.query(`SELECT (SELECT count(*) FROM sales_lines)::VARCHAR AS lines,(SELECT count(*) FROM products)::VARCHAR AS products,(SELECT count(*) FROM customers)::VARCHAR AS customers,audit_count::VARCHAR AS entries,schema_version::VARCHAR AS version FROM vault_meta WHERE id=1`)).toArray()[0];
    // A role without cost access never has cost or margin selected: the query itself leaves them out.
    const access = await this.access(), cost = access.caps.includes("cost");
    const totals = (await this.engine.conn.query(`SELECT coalesce(sum(list_cents),0)::VARCHAR AS list,coalesce(sum(discount_cents),0)::VARCHAR AS discounts,coalesce(sum(freight_cents),0)::VARCHAR AS freight,coalesce(sum(rebate_cents),0)::VARCHAR AS rebates,coalesce(sum(list_cents-discount_cents-freight_cents-rebate_cents),0)::VARCHAR AS pocket${cost ? `,coalesce(sum(cost_cents),0)::VARCHAR AS cost,coalesce(sum(list_cents-discount_cents-freight_cents-rebate_cents-cost_cents),0)::VARCHAR AS margin` : ""} FROM sales_lines`)).toArray()[0];
    return { ...base, lines: String(data.lines), products: String(data.products), customers: String(data.customers), auditEntries: String(data.entries), schemaVersion: String(data.version), totals: { cost: null, margin: null, ...totals } as VaultStatus["totals"], access };
  }
}
