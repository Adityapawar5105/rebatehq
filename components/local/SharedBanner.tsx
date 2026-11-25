"use client";
// Team sharing S3 (SHARING_DESIGN.md section 6): on a receiving seat, the sections that hold shared data say who shares
// it, which version arrived and when, and that it is read-only here (the worker refuses the write, lib/sharing/governed.ts).
// A relay copy is stale when this device has not synced for a week, not when the publisher had nothing new to send.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import { fmt, t, type MessageKey } from "@/lib/i18n";
import { Notice } from "@/components/ui/ui";
import { STALE_DAYS, daysSince } from "@/lib/sharing/stale";

type Book = { pack: string; version: string; publisher: string; receivedAt: string; via: string };
type State = { books: Book[]; receiving: boolean; lastSyncedAt: string | null };

export function SharedBanner({ client, packs, version }: { client: VaultClient; packs: readonly string[]; version: string }) {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => { let on = true; void client.call("shareState", {}).then(s => { if (on) setState(s); }).catch(() => { if (on) setState(null); }); return () => { on = false; }; }, [client, version]);
  if (!state?.receiving) return null;
  const books = state.books.filter(b => b.via === "relay" && packs.includes(b.pack));
  if (!books.length) return null;
  const names = [...new Set(books.map(b => b.publisher))].join(", "), newest = books.reduce((m, b) => b.receivedAt > m ? b.receivedAt : m, books[0].receivedAt);
  const age = daysSince(state.lastSyncedAt), stale = !!state.lastSyncedAt && age > STALE_DAYS;
  return <Notice tone={stale ? "warn" : "info"} title={t("share.banner.title", { name: names })} data-testid="shared-banner"
    actions={<a href="#settings-team">{t("share.banner.changes")}</a>}>
    <p>{books.map(b => t("share.banner.pack", { pack: t(`share.pack.${b.pack}` as MessageKey), version: b.version })).join(" · ")} · {t("share.banner.received", { date: fmt.date(newest) })}</p>
    <p>{t("share.banner.body")}</p>
    {stale && <p data-testid="shared-banner-stale">{t("share.banner.stale", { count: age })}</p>}
  </Notice>;
}
