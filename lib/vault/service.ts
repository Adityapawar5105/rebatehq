import { openMemory, snapshotBytes, closeMemory, makeWritable, type Engine } from "./engine";
import { VaultStorage } from "./storage";
import { decrypt, deriveKey, type Key } from "./crypto";
import { appendAudit, verifyAudit, GENESIS } from "./audit";
import { V1_SQL, SCHEMA_VERSION, upgradeSql } from "./schema";
import { ingest, estimateImport, type Progress } from "./ingest";
import { sqlText } from "../spike/exact";
import { AUTO_LOCK_MS, LEASE_WAIT_MS, VaultError, type Scope, type Tier, type VaultStatus } from "./protocol";
export class VaultService {
  engine: Engine | null = null;
  storage!: VaultStorage;
  private key: Key | null = null;
  private generation = "0";
  private lastSaved: string | null = null;
  private dirty = false;
  private recovered = false;
  private tier: Tier = "starter";
  private releaseLease: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private onIdle: () => void, private idleMs = AUTO_LOCK_MS, private leaseWaitMs = LEASE_WAIT_MS) {}
  async init(scope: Scope) {
    if (this.storage) throw new VaultError("STATE", "Workspace is already selected. Reload to switch workspace.");
    if (!navigator.storage?.getDirectory || !navigator.locks) throw new VaultError("BROWSER", "Use a current Chrome or Edge browser with local storage and Web Locks enabled.");
    this.storage = await VaultStorage.open(scope); return this.status();
  }
  private async lease() {
    if (this.releaseLease) return;
    // Wait briefly instead of failing at once: right after a tab is closed or
    // crashes, the browser may not yet have released that tab's lease.
    const signal = AbortSignal.timeout(this.leaseWaitMs);
    await new Promise<void>((resolve, reject) => {
      navigator.locks.request(`margindesk-vault-${this.storage.scope}`, { signal }, async () => {
        await new Promise<void>(release => { this.releaseLease = release; resolve(); });
      }).catch(error => reject(signal.aborted ? new VaultError("OTHER_TAB", "This vault is open in another tab. Lock or close that tab first.") : error));
    });
  }
  touch() {
    if (this.timer) clearTimeout(this.timer);
    if (this.engine) this.timer = setTimeout(this.onIdle, this.idleMs);
    return { ok: true };
  }
  async create(passphrase: string, tier: Tier) {
    if (this.engine || await this.storage.exists()) throw new VaultError("EXISTS", "A vault already exists. Unlock it instead of replacing it.");
    if (!["starter", "professional", "scale"].includes(tier)) throw new VaultError("TIER", "Choose a supported plan.");
    await this.lease();
    try {
      this.key = await deriveKey(passphrase); passphrase = "";
      this.engine = await openMemory(); this.tier = tier;
      await this.engine.conn.query(`BEGIN; ${V1_SQL} INSERT INTO vault_meta VALUES(1,1,${sqlText(tier)},${sqlText(this.storage.scope)},${sqlText(GENESIS)},0)`);
      await appendAudit(this.engine, "vault.created", { schema_version: "1" });
      await this.engine.conn.query("COMMIT");
      await this.migrate(); this.dirty = true; await this.save(); this.touch(); return this.status();
    } catch (error) { await this.dispose(); if (error instanceof VaultError && error.code === "SAVE") throw new VaultError("SAVE", "Initial vault setup could not be saved. Free storage and retry; no existing vault was replaced."); throw error; }
  }
  private async migrate() {
    const engine = this.requireEngine();
    const version = Number((await engine.conn.query("SELECT schema_version FROM vault_meta WHERE id=1")).toArray()[0]?.schema_version);
    const sql = upgradeSql(version);
    if (!sql) return;
    await makeWritable(engine);
    await engine.conn.query(`BEGIN; ${sql} UPDATE vault_meta SET schema_version=${SCHEMA_VERSION} WHERE id=1`);
    try { await appendAudit(engine, "vault.schema_upgraded", { from: String(version), to: String(SCHEMA_VERSION) }); await engine.conn.query("COMMIT"); this.dirty = true; }
    catch (error) { await engine.conn.query("ROLLBACK"); throw error; }
  }
  async unlock(passphrase: string) {
    if (this.engine) throw new VaultError("STATE", "The vault is already unlocked.");
    await this.lease();
    try {
      const candidates = await this.storage.candidates();
      if (!candidates.length) throw new VaultError("RECOVERY", "No valid vault pointer was found. Keep the existing files and recover from your encrypted backup.");
      let decoded: Awaited<ReturnType<typeof decrypt>> | null = null, chosen = candidates[0];
      for (const candidate of candidates) {
        try {
          const value = await decrypt(await this.storage.file(candidate.name), passphrase, this.storage.scope);
          if (candidate.sequence !== null && candidate.sequence !== value.sequence) { value.bytes.fill(0); continue; }
          decoded = value; chosen = candidate; break;
        } catch { /* Try only retained, committed pointers; never orphan files. */ }
      }
      passphrase = "";
      if (!decoded) throw new VaultError("UNLOCK_FAILED", "Wrong passphrase or damaged vault. No data was opened.");
      this.key = decoded.key; this.generation = decoded.sequence;
      this.engine = await openMemory(decoded.bytes); // one engine; registered RAM buffer only
      this.storage.activeHead = { format: 1, current: chosen.name, previous: null, sequence: decoded.sequence, savedAt: chosen.savedAt || "" };
      const rows = (await this.engine.conn.query("SELECT scope,tier FROM vault_meta WHERE id=1")).toArray();
      if (rows.length !== 1 || rows[0].scope !== this.storage.scope || !["starter", "professional", "scale"].includes(String(rows[0].tier))) throw new Error("metadata");
      this.tier = rows[0].tier as Tier;
      const audit = await verifyAudit(this.engine); if (!audit.valid) throw new VaultError("AUDIT", "The vault audit chain failed verification. No changes were saved.");
      this.recovered = chosen.recovered; this.lastSaved = chosen.savedAt;
      await this.migrate(); if (this.dirty) await this.save();
      this.touch(); return this.status();
    } catch (error) { await this.dispose(); if (error instanceof VaultError && error.code === "SAVE") throw new VaultError("SAVE", "The schema upgrade could not be saved. Your original encrypted vault is retained. Free storage and unlock again."); throw error instanceof VaultError ? error : new VaultError("UNLOCK_FAILED", "Wrong passphrase, damaged vault or unsupported schema. No data was opened."); }
  }
  private requireEngine() { if (!this.engine) throw new VaultError("LOCKED", "Unlock your vault first."); return this.engine; }
  async save() {
    const engine = this.requireEngine();
    if (!this.dirty) return this.status();
    const bytes = await snapshotBytes(engine);
    try {
      const sequence = (BigInt(this.generation) + BigInt(1)).toString();
      const head = await this.storage.publish(bytes, this.key!, sequence);
      this.generation = sequence; this.lastSaved = head.savedAt; this.dirty = false;
    } catch { throw new VaultError("SAVE", "The change is in memory but could not be saved. Free disk space and retry Save. Do not close this tab. Your previous encrypted snapshot is safe."); }
    finally { if (bytes.byteLength) bytes.fill(0); }
    return this.status();
  }
  async import(file: File, confirmed: boolean, signal: AbortSignal, progress: Progress) {
    const engine = this.requireEngine();
    if (!confirmed) throw new VaultError("CONFIRM", "Review the size and memory warning before importing.");
    if (this.dirty) throw new VaultError("SAVE", "Save the pending change before importing another file.");
    if (!engine.writable) {
      progress("Preparing the first change in worker memory", "0", "1");
      await makeWritable(engine);
      if (signal.aborted) throw new VaultError("CANCELLED", "Import cancelled. No rows were committed.");
    }
    await ingest(engine, file, this.tier, signal, progress);
    this.dirty = true; progress("Saving encrypted snapshot", "0", "1"); await this.save();
    progress("Saved", "1", "1"); this.touch(); return this.status();
  }
  estimate(file: File) { this.requireEngine(); return estimateImport(file, this.tier); }
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
    const engine = this.engine; this.engine = null; this.key = null;
    if (engine) await closeMemory(engine).catch(() => undefined);
    this.releaseLease?.(); this.releaseLease = null; this.dirty = false;
  }
  async status(): Promise<VaultStatus> {
    const base: VaultStatus = { state: this.engine ? "unlocked" : "locked", exists: await this.storage.exists(), dirty: this.dirty, recovered: this.recovered, lines: "0", products: "0", customers: "0", auditEntries: "0", schemaVersion: "0", generation: this.generation, tier: this.tier, lastSaved: this.lastSaved };
    if (!this.engine) return base;
    const data = (await this.engine.conn.query(`SELECT (SELECT count(*) FROM sales_lines)::VARCHAR AS lines,(SELECT count(*) FROM products)::VARCHAR AS products,(SELECT count(*) FROM customers)::VARCHAR AS customers,audit_count::VARCHAR AS entries,schema_version::VARCHAR AS version FROM vault_meta WHERE id=1`)).toArray()[0];
    const totals = (await this.engine.conn.query(`SELECT coalesce(sum(list_cents),0)::VARCHAR AS list,coalesce(sum(discount_cents),0)::VARCHAR AS discounts,coalesce(sum(freight_cents),0)::VARCHAR AS freight,coalesce(sum(rebate_cents),0)::VARCHAR AS rebates,coalesce(sum(list_cents-discount_cents-freight_cents-rebate_cents),0)::VARCHAR AS pocket,coalesce(sum(cost_cents),0)::VARCHAR AS cost,coalesce(sum(list_cents-discount_cents-freight_cents-rebate_cents-cost_cents),0)::VARCHAR AS margin FROM sales_lines`)).toArray()[0];
    return { ...base, lines: String(data.lines), products: String(data.products), customers: String(data.customers), auditEntries: String(data.entries), schemaVersion: String(data.version), totals: { ...totals } as VaultStatus["totals"] };
  }
}
