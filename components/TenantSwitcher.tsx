"use client";
import { useState } from "react";
import { t, useLocale } from "@/lib/i18n";
type Tenant = { tenant_id: string; name: string };
export function TenantSwitcher({ tenants, selected }: { tenants: Tenant[]; selected: string }) {useLocale();
  const [busy, setBusy] = useState(false);
  if (tenants.length < 2) return null;
  return <label className="small">{t("switcher.workspace")}<select className="input" value={selected} disabled={busy} onChange={async e => { setBusy(true); try { const response = await fetch("/api/tenant/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: e.target.value }) }); if (!response.ok) throw new Error(); location.assign("/dashboard"); } catch { setBusy(false); e.target.value = selected; } }}><option value={selected}>{tenants.find(t => t.tenant_id === selected)?.name}</option>{tenants.filter(t => t.tenant_id !== selected).map(t => <option key={t.tenant_id} value={t.tenant_id}>{t.name}</option>)}</select></label>;
}
