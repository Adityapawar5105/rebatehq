"use client";
import { useEffect, useRef, useState } from "react";
import { VaultClient } from "@/lib/vault/client";
import type { ImportEstimate, Scope, StorageStatus, Tier, VaultStatus } from "@/lib/vault/protocol";
import { moneyText } from "@/lib/spike/exact";
import styles from "./vault.module.css";
const sections = ["Home", "Data Hub", "Margin", "Pricing", "Reports", "Settings"] as const;
type Section = typeof sections[number];
export function VaultApp({ scope, email, workspace, lab = false }: { scope: Scope; email: string; workspace: string; lab?: boolean }) {
  const client = useRef<VaultClient | null>(null);
  const [status, setStatus] = useState<VaultStatus | null>(null), [section, setSection] = useState<Section>("Home");
  const [error, setError] = useState(""), [message, setMessage] = useState("Opening local storage…"), [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState(""), [tier, setTier] = useState<Tier>("starter");
  const [file, setFile] = useState<File | null>(null), [estimate, setEstimate] = useState<ImportEstimate | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null), [progress, setProgress] = useState<{ stage: string; done: string; total: string } | null>(null);
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    let active = true;
    const c = new VaultClient(scope, event => {
      if (!active) return;
      if (event.event === "progress") { setProgress(event); window.dispatchEvent(new CustomEvent("vault-progress", { detail: { stage: event.stage } })); }
      else { setPassphrase(""); setFile(null); setEstimate(null); setMessage(event.reason); void c.call("status", {}).then(s => { if (active) setStatus(s); }); }
    });
    client.current = c;
    c.ready.then(s => { if (active) { setStatus(s); setMessage(s.exists ? "Unlock your encrypted vault." : "Create an encrypted vault on this device."); } }).catch(e => { if (active) setError(e.message); });
    void c.call("storage", {}).then(s => { if (active) setStorage(s); }).catch(() => undefined);
    setSupported(/Chrome|Edg\//.test(navigator.userAgent));
    let lastActivity = 0;
    const touch = () => { if (Date.now() - lastActivity > 5000) { lastActivity = Date.now(); void c.call("touch", {}).catch(() => undefined); } };
    const leaving = () => { void c.call("lock", {}).catch(() => undefined); };
    window.addEventListener("pointerdown", touch); window.addEventListener("keydown", touch); window.addEventListener("pagehide", leaving);
    const hash = () => { const value = location.hash.slice(1); const match = sections.find(s => s.toLowerCase().replace(" ", "-") === value); if (match) setSection(match); };
    hash(); window.addEventListener("hashchange", hash);
    return () => { active = false; window.removeEventListener("pointerdown", touch); window.removeEventListener("keydown", touch); window.removeEventListener("pagehide", leaving); window.removeEventListener("hashchange", hash); c.close(); client.current = null; };
  }, [scope.userId, scope.tenantId]);
  async function operation(work: () => Promise<void>) {
    setBusy(true); setError(""); setProgress(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "The local operation failed."); try { setStatus(await client.current!.call("status", {})); } catch {} }
    finally { setBusy(false); setProgress(null); }
  }
  async function chooseFile(value: File | undefined) {
    if (!value) return;
    setError(""); setFile(null); setEstimate(null);
    try { const preview = await client.current!.call("estimate", { file: value }); setFile(value); setEstimate(preview); }
    catch (e) { setError((e as Error).message); }
  }
  const unlocked = status?.state === "unlocked";
  return <div className={styles.shell}>
    <a className={styles.skip} href="#local-content">Skip to content</a>
    <header className={styles.header}><a href="/home" className={styles.brand}>M <span>MarginDesk</span></a><span>{workspace}</span><span className={styles.identity}>{email}</span>{!lab && <form method="post" action="/api/auth/logout"><button>Sign out</button></form>}</header>
    {lab && <aside className={styles.notice}>LOCAL TEST HARNESS · synthetic identity only. The signed-in application is /home. This route does not prove authentication.</aside>}
    <div className={styles.layout}>
      <nav aria-label="Main navigation" className={styles.nav}>{sections.map(item => <a key={item} href={`#${item.toLowerCase().replace(" ", "-")}`} aria-current={section === item ? "page" : undefined} onClick={() => setSection(item)}>{item}</a>)}<a href="/legacy/dashboard">Legacy · server-backed</a></nav>
      <main id="local-content" className={styles.content}>
        <div className={styles.title}><div><span className={styles.eyebrow}>LOCAL WORKSPACE</span><h1>{section}</h1></div>{unlocked && <button disabled={busy} onClick={() => void operation(async () => { setStatus(await client.current!.call("lock", {})); setPassphrase(""); setFile(null); setEstimate(null); setMessage("Vault locked. The key and working database were released."); })}>Lock vault</button>}</div>
        {!supported && <p className={styles.notice}>For local vault support, use the latest Chrome or Edge. Other browsers have not been validated.</p>}
        <p role="status" aria-live="polite">{message}</p>
        {error && <p role="alert" className={styles.error}>⚠ {error}</p>}
        {status?.recovered && <p className={styles.error}>⚠ Opened the retained previous generation because the current save was damaged. Review the last import before continuing.</p>}
        {progress && <div className={styles.progress}><label htmlFor="vault-progress">{progress.stage}</label><progress id="vault-progress" value={Number(progress.done)} max={Math.max(1, Number(progress.total))}/>{!progress.stage.startsWith("Saving") && progress.stage !== "Saved" && <button onClick={() => void client.current!.call("cancel", {})}>Cancel import</button>}</div>}
        {!status ? <section className={styles.card} aria-busy="true">Starting the local worker…</section> : !unlocked ? <section className={styles.card}>
          <h2>{status.exists ? "Unlock this device's vault" : "Create your local vault"}</h2>
          <p>Your passphrase stays on this device. There is no server-side passphrase recovery. Keep a safe copy of your passphrase.</p>
          <form onSubmit={event => { event.preventDefault(); const secret = passphrase; setPassphrase(""); void operation(async () => { const start = performance.now(); const result = status.exists ? await client.current!.call("unlock", { passphrase: secret }) : await client.current!.call("create", { passphrase: secret, tier }); setStatus(result); setMessage(`Vault ready. ${Math.round(performance.now() - start)} ms from submitting the passphrase. Changes are saved as encrypted snapshots.`); window.dispatchEvent(new CustomEvent("vault-ready")); }); }}>
            <label>Vault passphrase<input type="password" minLength={12} maxLength={256} required autoComplete={status.exists ? "current-password" : "new-password"} value={passphrase} onChange={event => setPassphrase(event.target.value)} disabled={busy}/></label>
            {!status.exists && <label>Local capacity profile<select value={tier} onChange={event => setTier(event.target.value as Tier)} disabled={busy}><option value="starter">Starter · 20k products / 200k lines</option><option value="professional">Professional · 100k products / 1M lines</option><option value="scale">Scale pilot · 200k products / 1M lines</option></select></label>}
            <button className={styles.primary} disabled={busy}>{busy ? "Opening…" : status.exists ? "Unlock vault" : "Create encrypted vault"}</button>
          </form>
          <p className={styles.muted}>Auto-lock after 10 minutes of inactivity. Local capacity profiles are provisional guardrails; licence enforcement belongs to the control plane.</p>
        </section> : <>
          {status.dirty && <section className={styles.error}>⚠ A change is not yet saved. Keep this tab open. <button onClick={() => void operation(async () => { setStatus(await client.current!.call("save", {})); setMessage("Encrypted save completed."); })}>Retry Save</button></section>}
          <div className={styles.stats}><div><span>Invoice lines</span><strong data-testid="line-count">{status.lines}</strong></div><div><span>Products</span><strong>{status.products}</strong></div><div><span>Customers</span><strong>{status.customers}</strong></div><div><span>Encrypted generation</span><strong>{status.generation}</strong></div></div>
          {section === "Home" && <section className={styles.card}><h2>Your data stays in the local vault</h2><p>Import a sales CSV in Data Hub to begin. Working and staging data live in worker memory. OPFS holds encrypted snapshots only.</p><a className={styles.primary} href="#data-hub">Open Data Hub</a><p className={styles.muted}>First insights in minutes from files. This foundation does not yet include the complete Import Studio or leak reports.</p></section>}
          {section === "Data Hub" && <section className={styles.card} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (event.dataTransfer.files.length !== 1) { setError("Choose one CSV file for this import. Multi-file mapping arrives in the next chunk."); return; } if (!busy) void chooseFile(event.dataTransfer.files[0]); }}>
            <h2>Import sales history</h2><p>Drop one CSV here or choose a file. Native DuckDB reads it in the worker; the file is never uploaded.</p>
            <label>Choose CSV<input data-testid="csv-file" type="file" accept=".csv" disabled={busy} onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ""; }}/></label>
            <details><summary>Required columns for this chunk</summary><p>line_id, product_id, customer_id, sale_date, quantity, list_amount, discount_amount, freight_amount, rebate_amount, cost_amount</p><p>Positive whole IDs and quantities, ISO dates and non-negative amounts with up to two decimals. Amounts are line totals. Mapping and additional formats arrive in 4C.</p></details>
            {file && estimate && <div className={styles.warning}><strong>⚠ Review before import: {file.name}</strong><p>{estimate.bytes} bytes; approximately {estimate.estimatedMemoryBytes} additional memory bytes. Profile maximum: {estimate.maxLines} lines / {estimate.maxProducts} products.</p><p>{estimate.warning}</p><button className={styles.primary} disabled={busy || status.dirty} onClick={() => void operation(async () => { setStatus(await client.current!.call("import", { file, confirmed: true })); setFile(null); setEstimate(null); setMessage("Import committed, audited and saved as an encrypted snapshot."); })}>Confirm and import locally</button></div>}
          </section>}
          {section === "Margin" && <section className={styles.card}><h2>Imported line totals</h2><p>Exact cents from your CSV. Cost-basis lookup, reconciliation and the full analytical engine arrive in 4D.</p><dl className={styles.totals}>{Object.entries(status.totals || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{moneyText(value)}</dd></div>)}</dl></section>}
          {section === "Pricing" && <section className={styles.card}><h2>Pricing foundation</h2><p>Local matrix, guardrail, rule and version tables are ready. The rule editor and approval/export workflow arrive in later chunks.</p></section>}
          {section === "Reports" && <section className={styles.card}><h2>Verify local audit history</h2><p>{status.auditEntries} hash-chained entries. Schema version {status.schemaVersion}.</p><button className={styles.primary} disabled={busy} onClick={() => void operation(async () => { const result = await client.current!.call("verify", {}); if (!result.valid) throw new Error("Audit verification failed. Keep your encrypted backup."); setMessage(`Audit chain verified: ${result.entries} entries.`); })}>Verify audit chain</button><p className={styles.muted}>A local hash chain detects changed, missing or reordered records against its encrypted tip. It cannot prove that a device owner did not rewrite the whole vault or restore an older snapshot.</p></section>}
          {section === "Settings" && <section className={styles.card}><h2>Storage and security</h2><p>Auto-lock: 10 minutes. Working database: memory only. Last encrypted save: {status.lastSaved || "none"}.</p><p>Browser persistence: {storage ? storage.persistent ? "granted" : "not granted" : "unknown"}. Used estimate: {storage?.usage || "unknown"}; quota: {storage?.quota || "unknown"}; named OPFS files: {storage?.namedOpfsBytes || "unknown"} bytes.</p><button className={styles.primary} onClick={() => void operation(async () => { await navigator.storage.persist(); setStorage(await client.current!.call("storage", {})); setMessage("Storage status refreshed. A persistence grant is not a backup."); })}>Request persistent storage</button><p className={styles.muted}>The browser's quota estimate can differ from file sizes. Closing a tab cannot guarantee an asynchronous save; each completed import is saved before success is shown.</p>{!lab && <p><a href="/account/users">Team and invitations</a> · <a href="/account/workspace">Identity workspace settings</a></p>}</section>}
        </>}
      </main>
    </div>
  </div>;
}
