"use client";
// Chunk 8C-2: offline use of the desktop app. Registers the service worker (public/sw.js) in production builds and shows,
// in Settings, whether this browser holds an offline copy of the app shell. The copy holds the page, the app's code
// and the engine, never business data, which stays in the encrypted vault. "Remove offline copy" unregisters the worker
// and deletes the copy; signing out does the same.
import { useEffect, useState } from "react";
import { fmt, t } from "@/lib/i18n";
import { Button, Card, Notice } from "@/components/ui/ui";
import styles from "./vault.module.css";

export const OFFLINE_CACHE = "rebatehq-shell-v1";
type State = "unsupported" | "off" | "installing" | "ready";

/** Register once per page load; production only (development builds change on every edit). */
export function useOfflineWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
}
/** Forget the offline copy: delete the stored shell and unregister the worker. Errors are ignored (nothing to remove). */
export async function clearOfflineCopy() {
  try { if ("caches" in self) await caches.delete(OFFLINE_CACHE); } catch { /* nothing stored */ }
  try { for (const r of await navigator.serviceWorker?.getRegistrations?.() ?? []) await r.unregister(); } catch { /* no worker */ }
}
async function probe(): Promise<{ state: State; files: number }> {
  if (!("serviceWorker" in navigator) || !("caches" in self)) return { state: "unsupported", files: 0 };
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return { state: "off", files: 0 };
  const keys = await (await caches.open(OFFLINE_CACHE)).keys(), shell = keys.some(k => /\/(home|lab\/vault)$/.test(new URL(k.url).pathname));
  return { state: reg.active && navigator.serviceWorker.controller && shell ? "ready" : "installing", files: keys.length };
}

export function OfflineCard({ licenceUntil }: { licenceUntil: string | null }) {
  const [s, setS] = useState<{ state: State; files: number } | null>(null), [busy, setBusy] = useState(false);
  const refresh = () => void probe().then(setS).catch(() => setS({ state: "unsupported", files: 0 }));
  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, []);
  return <Card headingId="offline-heading" title={t("offline.heading")} description={t("offline.body")} data-testid="offline-card" data-state={s?.state ?? ""}>
    {!s ? null : s.state === "unsupported" ? <Notice tone="warn">{t("offline.unsupported")}</Notice> : <>
      <p data-testid="offline-state">{t(s.state === "ready" ? "offline.ready" : s.state === "installing" ? "offline.installing" : "offline.off", { files: fmt.int(s.files) })}</p>
      {licenceUntil && <p className={styles.small}>{t("offline.grace", { date: fmt.dateTime(licenceUntil) })}</p>}
      <p className={styles.small}>{t("offline.noData")}</p>
      {s.state !== "off" && <Button size="sm" variant="ghost" disabled={busy} data-testid="offline-remove" onClick={() => { setBusy(true); void clearOfflineCopy().then(refresh).finally(() => setBusy(false)); }}>{t("offline.remove")}</Button>}
    </>}
  </Card>;
}
