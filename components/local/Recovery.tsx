"use client";
// Recovery (audit B-3, 20 Nov 2026): "Start again on this device" for a forgotten passphrase, on the unlock card, and
// "Change passphrase" in Settings. Passphrases go straight to the vault worker and are cleared from the page after use.
import { useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { VaultStatus } from "@/lib/vault/protocol";
import { msg, t } from "@/lib/i18n";
import { Button, Card, Field, Notice } from "@/components/ui/ui";
import styles from "./vault.module.css";

type Op = (work: () => Promise<void>) => Promise<void>;

/** Shown on the unlock card only. Deletes this device's copy of the vault after the workspace name is typed. */
export function StartAgain({ client, workspace, busy, operation, onStatus, setMessage }: { client: VaultClient; workspace: string; busy: boolean; operation: Op; onStatus: (s: VaultStatus) => void; setMessage: (m: string) => void }) {
  const [open, setOpen] = useState(false), [typed, setTyped] = useState("");
  if (!open) return <p><button type="button" className={styles.linkish} data-testid="start-again-open" onClick={() => setOpen(true)}>{t("shell.reset.link")}</button></p>;
  return <Notice tone="warn" title={t("shell.reset.title")} data-testid="start-again">
    <p>{t("shell.reset.body")}</p>
    <Field label={t("shell.reset.confirmLabel", { workspace })}><input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" data-testid="start-again-confirm"/></Field>
    <div className={styles.row}>
      <Button variant="danger" disabled={busy || typed !== workspace} data-testid="start-again-button" onClick={() => void operation(async () => { onStatus(await client.call("vaultReset", {})); setOpen(false); setTyped(""); setMessage(msg("shell.reset.done")); })}>{t("shell.reset.button")}</Button>
      <Button variant="ghost" onClick={() => { setOpen(false); setTyped(""); }}>{t("notes.cancel")}</Button>
    </div>
  </Notice>;
}

/** Settings: re-encrypt the vault under a new passphrase. */
export function PassphraseCard({ client, busy, operation, onStatus, setMessage }: { client: VaultClient; busy: boolean; operation: Op; onStatus: (s: VaultStatus) => void; setMessage: (m: string) => void }) {
  const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [again, setAgain] = useState(""), [error, setError] = useState("");
  const submit = () => {
    setError("");
    if (next !== again) { setError(msg("passphrase.mismatch")); return; }
    const secrets = { current, next }; setCurrent(""); setNext(""); setAgain("");
    void operation(async () => { onStatus(await client.call("passphraseChange", secrets)); setMessage(msg("passphrase.done")); });
  };
  return <Card headingId="passphrase-heading" title={t("passphrase.heading")} description={t("passphrase.body")} data-testid="passphrase-card">
    <form onSubmit={e => { e.preventDefault(); submit(); }}>
      <Field label={t("passphrase.current")}><input type="password" autoComplete="current-password" minLength={12} maxLength={256} required value={current} onChange={e => setCurrent(e.target.value)} data-testid="passphrase-current"/></Field>
      <Field label={t("passphrase.next")}><input type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={next} onChange={e => setNext(e.target.value)} data-testid="passphrase-next"/></Field>
      <Field label={t("passphrase.again")}><input type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={again} onChange={e => setAgain(e.target.value)} data-testid="passphrase-again"/></Field>
      {error && <Notice tone="bad" role="alert">{error}</Notice>}
      <Button type="submit" variant="primary" icon="key" disabled={busy || !current || !next || !again} data-testid="passphrase-submit">{t("passphrase.button")}</Button>
    </form>
  </Card>;
}
