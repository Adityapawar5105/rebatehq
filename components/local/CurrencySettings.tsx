"use client";
import { useEffect, useState } from 'react';
import { CURRENCIES } from '@/lib/vault/currency';
import { t } from '@/lib/i18n';
import type { VaultClient } from '@/lib/vault/client';
import type { VaultStatus } from '@/lib/vault/protocol';
import { Button, Card, Field } from '@/components/ui/ui';
export function CurrencySettings({ client, status, busy, operation, onStatus }: { client: VaultClient; status: VaultStatus; busy: boolean; operation: (work: () => Promise<void>) => Promise<void>; onStatus: (status: VaultStatus) => void }) {
  const [code, setCode] = useState(status.currency);
  useEffect(() => setCode(status.currency), [status.currency]);
  return <Card headingId="currency-heading" title={t('fx.workspace')} description={t('fx.workspaceHelp')}>
    <p>{t('fx.current', { code: status.currency })}</p>
    {status.access?.caps.includes('roles') && <form onSubmit={e => { e.preventDefault(); void operation(async () => onStatus(await client.call('currencySet', { currency: code }))); }}>
      <Field label={t('fx.workspace')}><select value={code} onChange={e => setCode(e.target.value)} disabled={busy}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
      <Button type="submit" disabled={busy || code === status.currency}>{t('fx.save')}</Button>
    </form>}
  </Card>;
}
