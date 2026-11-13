-- Chunk 8R: legacy business-table retirement, wave 2 (RETIREMENT_PROPOSAL.md,
-- approved 5 Nov 2026; blueprint section 22, item 15).
--
-- Their local replacements are CI-verified: quotes, quote lines and approvals in
-- the vault (7B) with ciphertext-only approvals on the relay (7A); approval rules
-- as versioned local guardrails (4E); rebate agreements, tiers, accruals,
-- progress and supplier credits in the vault (7D-1, 7D-2); alerts as the local
-- Margin Drain agents (8B); and exchange rates as the local per-workspace rate
-- table (7C-3a), so fx_rate is no longer needed on the server. Since 5B no
-- reachable route writes these tables (legacy business routes are default-off);
-- 8R retires the last legacy page and helper that read them.
--
-- Precondition checked 13 Nov 2026: the user's Supabase account has no projects,
-- so no hosted database holds rows in them.
--
-- Every foreign key into these tables comes from another table in this list, so
-- one DROP TABLE removes them together. No CASCADE is used: if anything outside
-- this list still depended on them, the statement would fail instead of silently
-- removing it. Their indexes, policies and audit triggers go with them; no
-- function, type or view serves only these tables, so nothing else is dropped.
-- Rows already copied into audit_log stay: the hash chain is never rewritten.

DROP TABLE
  public.quote_share_link,
  public.approval,
  public.quote_line,
  public.quote,
  public.approval_rule,
  public.rebate_entry,
  public.rebate_tier,
  public.rebate_progress,
  public.rebate_agreement,
  public.supplier_credit,
  public.alert,
  public.fx_rate;
