"use client";
// Roadmap 11.3: the workspace's company name, address, quote terms and JPEG logo, printed on the customer quote PDF.
// Kept in the encrypted vault (quote_branding); the logo never leaves the device except inside a PDF the user downloads.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Branding } from "@/lib/quotes/documents";
import { fmt, msg, say, t } from "@/lib/i18n";
import { Button, Card, Field, Notice } from "@/components/ui/ui";
import styles from "./vault.module.css";

const MAX = 200_000;
async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function QuoteBranding({ client, busy, operation, canEdit }: { client: VaultClient; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; canEdit: boolean }) {
  const [saved, setSaved] = useState<Branding | null | undefined>(undefined), [form, setForm] = useState({ company: "", address: "", terms: "" });
  const [logo, setLogo] = useState<string | null | undefined>(undefined), [note, setNote] = useState(""), [error, setError] = useState("");
  const fill = (b: Branding | null) => { setSaved(b); setForm({ company: b?.company ?? "", address: b?.address ?? "", terms: b?.terms ?? "" }); setLogo(undefined); };
  useEffect(() => { let on = true; void client.call("brandingGet", {}).then(b => { if (on) fill(b); }).catch(() => { if (on) setSaved(null); }); return () => { on = false; }; }, [client]);
  const shown = logo === undefined ? saved?.logo ?? null : logo;
  // The fields wait for the saved branding, so nothing typed is overwritten when it arrives.
  const editable = canEdit && saved !== undefined;
  return <Card headingId="branding-heading" title={t("qdoc.brandingTitle")} description={t("qdoc.brandingHelp")} data-testid="quote-branding" data-loaded={saved === undefined ? "no" : "yes"}>
    <p role="status">{say(note)}</p>
    {error && <Notice tone="bad" role="alert">{error}</Notice>}
    <form onSubmit={e => { e.preventDefault(); if (!canEdit) return; void operation(async () => { fill(await client.call("brandingSet", { input: { ...form, ...(logo === undefined ? {} : { logo }) } })); setNote(msg("qdoc.brandingSaved")); }); }}>
      <Field label={t("qdoc.company")}><input translate="no" value={form.company} maxLength={120} required disabled={!editable} onChange={e => setForm({ ...form, company: e.target.value })} data-testid="branding-company"/></Field>
      <Field label={t("qdoc.address")}><textarea translate="no" className={styles.textarea} value={form.address} maxLength={400} rows={3} disabled={!editable} onChange={e => setForm({ ...form, address: e.target.value })}/></Field>
      <Field label={t("qdoc.terms")} hint={t("qdoc.termsHint")}><textarea translate="no" className={styles.textarea} value={form.terms} maxLength={2000} rows={4} disabled={!editable} onChange={e => setForm({ ...form, terms: e.target.value })} data-testid="branding-terms"/></Field>
      <Field label={t("qdoc.logo")} hint={t("qdoc.logoHint", { size: fmt.bytes(MAX) })}>
        <input type="file" accept="image/jpeg,.jpg,.jpeg" disabled={!editable || busy} data-testid="branding-logo" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; setError(""); if (!file) return;
          if (file.size > MAX) { setError(t("qdoc.logoTooLarge", { max: fmt.int(MAX / 1000) })); return; }
          void fileBase64(file).then(setLogo); }}/>
      </Field>
      {shown && <p className={styles.row}><img src={`data:image/jpeg;base64,${shown}`} alt={t("qdoc.logoPreview")} style={{ maxHeight: 56, maxWidth: 140 }} data-testid="branding-logo-preview"/>
        {canEdit && <Button size="sm" variant="ghost" onClick={() => setLogo(null)}>{t("qdoc.logoRemove")}</Button>}</p>}
      {canEdit ? <Button variant="primary" type="submit" disabled={busy || !editable || !form.company.trim()} data-testid="branding-save">{t("qdoc.brandingSave")}</Button> : <p className={styles.muted}>{t("qdoc.brandingOwnerOnly")}</p>}
    </form>
  </Card>;
}
