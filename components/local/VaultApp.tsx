"use client";
import { useEffect, useRef, useState } from "react";
import { VaultClient } from "@/lib/vault/client";
import type { Scope, StorageStatus, Tier, VaultStatus } from "@/lib/vault/protocol";
import { moneyText } from "@/lib/spike/exact";
import { ImportStudio } from "./ImportStudio";
import styles from "./vault.module.css";
const sections = ["Home", "Data Hub", "Margin", "Pricing", "Reports", "Settings"] as const;
type Section = typeof sections[number];
export function VaultApp({ scope, email, workspace, lab = false }: { scope: Scope; email: string; workspace: string; lab?: boolean }) {
  const client = useRef<VaultClient | null>(null);
  const [status, setStatus] = useState<VaultStatus | null>(null), [section, setSection] = useState<Section>("Home");
  const [error, setError] = useState(""), [message, setMessage] = useState("Opening local storage…"), [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState(""), [tier, setTier] = useState<Tier>("starter");
  const [storage, setStorage] = useState<StorageStatus | null>(null), [progress, setProgress] = useState<{ stage: string; done: string; total: string } | null>(null);
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    let active = true;
    const c = new VaultClient(scope, event => {
      if (!active) return;
      if (event.event === "progress") { setProgress(event); window.dispatchEvent(new CustomEvent("vault-progress", { detail: { stage: event.stage } })); }
      else if (event.event === "writable") { void c.call("status", {}).then(s => { if (active) setStatus(s); }).catch(() => undefined); }
      else { setPassphrase(""); setMessage(event.reason); void c.call("status", {}).then(s => { if (active) setStatus(s); }); }
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
  const unlocked = status?.state === "unlocked";
  return <div className={styles.shell}>
    <a className={styles.skip} href="#local-content">Skip to content</a>
    <header className={styles.header}><a href="/home" className={styles.brand}>M <span>MarginDesk</span></a><span>{workspace}</span><span className={styles.identity}>{email}</span>{!lab && <form method="post" action="/api/auth/logout"><button>Sign out</button></form>}</header>
    {lab && <aside className={styles.notice}>LOCAL TEST HARNESS · synthetic identity only. The signed-in application is /home. This route does not prove authentication.</aside>}
    <div className={styles.layout}>
      <nav aria-label="Main navigation" className={styles.nav}>{sections.map(item => <a key={item} href={`#${item.toLowerCase().replace(" ", "-")}`} aria-current={section === item ? "page" : undefined} onClick={() => setSection(item)}>{item}</a>)}<a href="/legacy/dashboard">Legacy · server-backed</a></nav>
      <main id="local-content" className={styles.content}>
        <div className={styles.title}><div><span className={styles.eyebrow}>LOCAL WORKSPACE</span><h1>{section}</h1></div>{unlocked && <button disabled={busy} onClick={() => void operation(async () => { setStatus(await client.current!.call("lock", {})); setPassphrase(""); setMessage("Vault locked. The key and working database were released."); })}>Lock vault</button>}</div>
        {!supported && <p className={styles.notice}>For local vault support, use the latest Chrome or Edge. Other browsers have not been validated.</p>}
        <p role="status" aria-live="polite">{message}</p>
        {error && <p role="alert" className={styles.error}>⚠ {error}</p>}
        {status?.preparing && <p className={styles.muted} data-testid="preparing">Preparing for edits… You can browse now; an import started meanwhile waits for this step.</p>}
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
          {section === "Home" && <section className={styles.card}><h2>Your data stays in the local vault</h2><p>Drop your ERP and supplier files in Data Hub to begin. Working and staging data live in worker memory. OPFS holds encrypted snapshots only.</p><a className={styles.primary} href="#data-hub">Open Data Hub</a><p className={styles.muted}>Column mapping for other ERP header names, the Fix Later queue and leak reports arrive in the next chunks.</p></section>}
          {section === "Data Hub" && client.current && <>
            <ImportStudio client={client.current} status={status} busy={busy} operation={operation} onStatus={setStatus} setMessage={setMessage}/>
            <details className={styles.card}><summary>Columns each file type needs</summary>
              <p className={styles.small}><strong>Sales history:</strong> line_id, product_id, customer_id, sale_date, quantity, list_amount, discount_amount, freight_amount, rebate_amount, cost_amount (amounts are line totals).</p>
              <p className={styles.small}><strong>Item master:</strong> product_id, and any of description, category, uom, current_cost, list_price. <strong>Customer list:</strong> customer_id, and any of name, tier, branch, region, payment_terms.</p>
              <p className={styles.small}><strong>Vendor cost sheet:</strong> vendor, product_id, cost, effective_date. <strong>Price list:</strong> price, valid_from, product_id or category, and optionally customer_id, tier, qty_break, valid_to.</p>
              <p className={styles.muted}>Header names are matched ignoring case, spaces and punctuation, in any column order. Mapping other ERP header names arrives in the next chunk. Amounts use up to two decimals with no currency symbols or grouping.</p>
            </details>
          </>}
          {section === "Margin" && <section className={styles.card}><h2>Imported line totals</h2><p>Exact cents from your CSV. Cost-basis lookup, reconciliation and the full analytical engine arrive in 4D.</p><dl className={styles.totals}>{Object.entries(status.totals || {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{moneyText(value)}</dd></div>)}</dl></section>}
          {section === "Pricing" && <section className={styles.card}><h2>Pricing foundation</h2><p>Local matrix, guardrail, rule and version tables are ready. The rule editor and approval/export workflow arrive in later chunks.</p></section>}
          {section === "Reports" && <section className={styles.card}><h2>Verify local audit history</h2><p>{status.auditEntries} hash-chained entries. Schema version {status.schemaVersion}.</p><button className={styles.primary} disabled={busy} onClick={() => void operation(async () => { const result = await client.current!.call("verify", {}); if (!result.valid) throw new Error("Audit verification failed. Keep your encrypted backup."); setMessage(`Audit chain verified: ${result.entries} entries.`); })}>Verify audit chain</button><p className={styles.muted}>A local hash chain detects changed, missing or reordered records against its encrypted tip. It cannot prove that a device owner did not rewrite the whole vault or restore an older snapshot.</p></section>}
          {section === "Settings" && <section className={styles.card}><h2>Storage and security</h2><p>Auto-lock: 10 minutes. Working database: memory only. Last encrypted save: {status.lastSaved || "none"}.</p><p>Browser persistence: {storage ? storage.persistent ? "granted" : "not granted" : "unknown"}. Used estimate: {storage?.usage || "unknown"}; quota: {storage?.quota || "unknown"}; named OPFS files: {storage?.namedOpfsBytes || "unknown"} bytes.</p><button className={styles.primary} onClick={() => void operation(async () => { await navigator.storage.persist(); setStorage(await client.current!.call("storage", {})); setMessage("Storage status refreshed. A persistence grant is not a backup."); })}>Request persistent storage</button><p className={styles.muted}>The browser's quota estimate can differ from file sizes. Closing a tab cannot guarantee an asynchronous save; each completed import is saved before success is shown.</p>{!lab && <p><a href="/account/users">Team and invitations</a> · <a href="/account/workspace">Identity workspace settings</a></p>}</section>}
        </>}
      </main>
    </div>
  </div>;
}
