import {hasRebates} from '../rebate/input';
// Local-only cent-denominated currencies and exact, manually supplied batch FX.
import type { Engine } from './engine';
import { sqlText as Q } from '../spike/exact';
import { rha } from '../margin/decimal';
import { rhaSql } from '../margin/sql';
import { msg } from '../i18n/core';
import { VaultError } from './protocol';

// This engine reconciles cents. Zero/three-minor-unit ISO currencies need a future
// scale migration; accepting them today would silently misstate stored amounts.
export const CURRENCIES = Intl.supportedValuesOf('currency').filter(code =>
  new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits === 2);
export function currencyCode(code: string) {
  if (!CURRENCIES.includes(code)) throw new VaultError('CURRENCY', msg('fx.invalidCurrency'));
  return code;
}
export function rateParts(rate: string) {
  if (typeof rate !== 'string' || !/^(0|[1-9]\d{0,5})(\.\d{1,12})?$/.test(rate)) throw new VaultError('CURRENCY', msg('fx.invalidRate'));
  const [whole, fraction = ''] = rate.split('.'), numerator = BigInt(whole + fraction), denominator = BigInt(10) ** BigInt(fraction.length);
  if (numerator <= BigInt(0)) throw new VaultError('CURRENCY', msg('fx.invalidRate'));
  return { numerator, denominator, rate: whole + (fraction.replace(/0+$/, '') ? '.' + fraction.replace(/0+$/, '') : '') };
}
export function batchFx(source: string, workspace: string, rate: string) {
  currencyCode(source); currencyCode(workspace);
  const parts = rateParts(rate);
  if (source === workspace && parts.numerator !== parts.denominator) throw new VaultError('CURRENCY', msg('fx.sameRate'));
  return { sourceCurrency: source, workspaceCurrency: workspace, fxRate: parts.rate };
}
export const convertCents = (cents: bigint, rate: string) => { const p = rateParts(rate); return rha(cents * p.numerator, p.denominator); };
export const convertCentsSql = (cents: string, rate: string) => { const p = rateParts(rate); return `CAST(${rhaSql(`CAST(${cents} AS HUGEINT)*${p.numerator}`, `CAST(${p.denominator} AS HUGEINT)`)} AS BIGINT)`; };
/** Decimal source amount (up to six places) -> workspace cents, one final rounding. */
export const convertAmountSql = (amount: string, rate: string) => { const p = rateParts(rate); return `TRY_CAST(${rhaSql(`CAST(try_cast(${amount} AS DECIMAL(20,6))*1000000 AS HUGEINT)*${p.numerator}`, `CAST(${p.denominator * BigInt(10000)} AS HUGEINT)`)} AS BIGINT)`; };
export async function workspaceCurrency(e: Engine): Promise<string> {
  return String((await e.conn.query('SELECT currency FROM vault_meta WHERE id=1')).toArray()[0]?.currency ?? 'USD');
}
export async function sourceFx(e: Engine, source: string) {
  const r = (await e.conn.query(`SELECT source_currency,workspace_currency,fx_rate FROM import_batches WHERE source_id=${Q(source)} ORDER BY imported_at LIMIT 1`)).toArray()[0];
  return batchFx(String(r?.source_currency ?? 'USD'), String(r?.workspace_currency ?? 'USD'), String(r?.fx_rate ?? '1'));
}
// Even non-monetary imported data blocks a change. Deleting one file cannot relabel
// quotes, guardrails, receipts or relay objects that were derived from that data.
export async function currencyChangeSql(e: Engine, code: string) {
  currencyCode(code);
  if (code === await workspaceCurrency(e)) return '';
  const tables = ['source_files','import_batches','products','customers','sales_lines','vendor_costs','price_matrix','price_guardrails','rules','rule_runs','price_versions','roi_ledger','quotes','quote_lines','competitor_prices','price_export_receipts','relay_state'];
  if(await hasRebates(e))tables.push('rebate_programs','rebate_tiers','rebate_accruals');
  const r = (await e.conn.query(`SELECT (${tables.map(t => `(SELECT count(*) FROM ${t})`).join('+')})::VARCHAR AS n`)).toArray()[0];
  if (BigInt(r.n) > BigInt(0)) throw new VaultError('CURRENCY', msg('fx.changeBlocked'));
  return `UPDATE vault_meta SET currency=${Q(code)} WHERE id=1`;
}
