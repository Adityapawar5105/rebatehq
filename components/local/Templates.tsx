"use client";
// Chunk 8C-1: buttons for the documents the vault worker builds locally: the audit and compliance pack (Reports, the
// "audit" capability), the vendor negotiation sheet (Vendors, cost roles) and the rebate agreement (customer rebates,
// rebate managers). Each is generated on this device in the current language and saved as a file.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import { getLocale } from "@/lib/i18n";
import { fmt, msg, t } from "@/lib/i18n";
import { Button, Card, Field } from "@/components/ui/ui";
import { download } from "./PricingView";
import styles from "./vault.module.css";

type Op = (f: () => Promise<void>) => Promise<void>;

export function AuditPackButton({ client, busy, operation, setMessage }: { client: VaultClient; busy: boolean; operation: Op; setMessage: (m: string) => void }) {
  return <Button icon="download" disabled={busy} data-testid="audit-pack" onClick={() => void operation(async () => {
    const f = await client.call("auditPack", { locale: getLocale() }); download(f.name, f.blob);
    setMessage(msg(f.verification.chain_valid ? "auditpack.saved" : "auditpack.savedInvalid", { entries: Number(f.verification.entries) }));
  })}>{t("auditpack.button")}</Button>;
}

export function NegotiationSheet({ client, busy, operation }: { client: VaultClient; busy: boolean; operation: Op }) {
  const [vendors, setVendors] = useState<string[] | null>(null), [vendor, setVendor] = useState("");
  useEffect(() => { let on = true; void client.call("templateVendors", {}).then(v => { if (on) { setVendors(v); setVendor(v[0] ?? ""); } }).catch(() => { if (on) setVendors([]); }); return () => { on = false; }; }, [client]);
  if (!vendors?.length) return null;
  return <Card title={t("templates.sheetHeading")} description={t("templates.sheetHelp", { count: fmt.int(vendors.length) })} data-testid="negotiation-sheet">
    <div className={styles.row}>
      <Field label={t("templates.vendor")}><select value={vendor} onChange={e => setVendor(e.target.value)} data-testid="negotiation-vendor">{vendors.map(v => <option key={v} value={v}>{v}</option>)}</select></Field>
      <Button variant="primary" icon="download" disabled={busy || !vendor} data-testid="negotiation-download" onClick={() => void operation(async () => { const f = await client.call("negotiationSheet", { vendor, locale: getLocale() }); download(f.name, f.blob); })}>{t("templates.sheetButton")}</Button>
    </div>
  </Card>;
}

export function AgreementButton({ client, id, busy, operation }: { client: VaultClient; id: string; busy: boolean; operation: Op }) {
  return <Button size="sm" icon="download" disabled={busy} data-testid="rebate-agreement" onClick={() => void operation(async () => { const f = await client.call("rebateAgreement", { id, locale: getLocale() }); download(f.name, f.blob); })}>{t("templates.agreementButton")}</Button>;
}
