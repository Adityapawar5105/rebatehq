"use client";
// Chunk 7F-2: folder re-import. The user picks an import folder once (File System Access, Chrome and Edge); the vault
// worker remembers only the folder handle in this browser. Each re-import asks the browser for read permission again in
// the click, reads the folder's top-level files here, and the worker adds those a saved converter recipe recognises
// (files already imported unchanged are left out). The batch is then reviewed and confirmed as usual.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { StudioState } from "@/lib/studio/studio";
import { kindOf } from "@/lib/studio/formats";
import { fmt, msg, say, t } from "@/lib/i18n";
import { Checkbox } from "@/components/ui/ui";
import { PICKUP_EVERY, type PickupConfig } from "@/lib/vault/folder";
import styles from "./vault.module.css";

type Handle = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: "read" }) => Promise<PermissionState>; requestPermission?: (o: { mode: "read" }) => Promise<PermissionState>;
  values?: () => AsyncIterable<FileSystemHandle>;
};
type Picker = (o: { mode: "read"; id?: string }) => Promise<FileSystemDirectoryHandle>;
/** At most this many supported files are read from the folder at a time (the batch limit). */
const MAX_FOLDER_FILES = 64;
const EVERY_LABEL = { 0: "pickup.every.0", 15: "pickup.every.15", 60: "pickup.every.60", 240: "pickup.every.240", 1440: "pickup.every.1440" } as const;

export function FolderReimport({ client, busy, operation, setMessage, onAdded }: { client: VaultClient; busy: boolean; operation: (work: () => Promise<void>) => Promise<void>; setMessage: (m: string) => void; onAdded: (s: StudioState) => void }) {
  const [folder, setFolder] = useState<{ directory: FileSystemDirectoryHandle | null; name: string | null } | null>(null);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [pickup, setPickup] = useState<(PickupConfig & { permission: PermissionState | null }) | null>(null);
  const picker = typeof window === "undefined" ? undefined : (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;
  useEffect(() => { let on = true; void client.call("folderGet", {}).then(v => { if (on) setFolder(v); }).catch(() => { if (on) setFolder({ directory: null, name: null }); }); return () => { on = false; }; }, [client]);
  // Roadmap 15.1: the scheduled pickup settings and the last check, re-read after each pickup.
  useEffect(() => { let on = true; const load = () => void client.call("folderPickup", {}).then(v => { if (on) setPickup(v); }).catch(() => undefined); load(); window.addEventListener("vault-pickup", load); return () => { on = false; window.removeEventListener("vault-pickup", load); }; }, [client, folder?.name]);
  if (!picker) return <p className={styles.small} data-testid="folder-unsupported">{t("folder.needsChrome")}</p>;
  const choose = () => {
    // The picker opens in the trusted click, before any worker call.
    void picker({ mode: "read", id: "rebatehq-import" }).then(directory => operation(async () => { setFolder(await client.call("folderSet", { directory })); setSkipped([]); setMessage(msg("folder.chosen", { name: directory.name })); }))
      .catch(() => setMessage(msg("folder.cancelled")));
  };
  const reimport = () => {
    const directory = folder?.directory as Handle | null;
    if (!directory) return;
    // Permission is asked again each session, in this click; nothing is read without it.
    const ask = async () => (await directory.queryPermission?.({ mode: "read" })) === "granted" ? "granted" : (await directory.requestPermission?.({ mode: "read" })) ?? "granted";
    void ask().then(state => {
      if (state !== "granted") { setMessage(msg("folder.denied")); return; }
      return operation(async () => {
        const files: File[] = [];
        for await (const entry of directory.values?.() ?? []) {
          if (entry.kind !== "file" || !kindOf(entry.name)) continue;
          files.push(await (entry as FileSystemFileHandle).getFile());
          if (files.length >= MAX_FOLDER_FILES) break;
        }
        if (!files.length) { setSkipped([]); setMessage(msg("folder.empty", { name: directory.name })); return; }
        const next = await client.call("studioFolder", { files });
        onAdded(next); setSkipped(next.folder.skipped);
        setMessage(msg("folder.result", { count: next.folder.added.length, skipped: next.folder.skipped.length }));
      });
    }).catch(() => setMessage(msg("folder.denied")));
  };
  const savePickup = (every: number, auto: boolean) => void operation(async () => { setPickup(await client.call("folderPickupSet", { every, auto })); setMessage(msg("pickup.saved")); });
  // Read permission for the scheduled checks is granted here, in the click; the worker cannot ask for it.
  const allow = () => { const directory = folder?.directory as Handle | null; if (!directory) return; void (directory.requestPermission?.({ mode: "read" }) ?? Promise.resolve("granted" as PermissionState)).then(() => client.call("folderPickup", {}).then(setPickup)).catch(() => setMessage(msg("folder.denied"))); };
  const last = pickup?.result, when = last ? fmt.dateTime(last.at) : "";
  const lastLine = !last ? t("pickup.never") : last.error ? t("pickup.lastError", { date: when }) : last.imported ? t("pickup.lastImported", { count: last.added, date: when }) : last.review ? t("pickup.lastReview", { count: last.added, date: when }) : t("pickup.lastNone", { date: when });
  return <>
  <div className={styles.row} data-testid="folder-reimport" style={{ flexWrap: "wrap" }}>
    <p className={styles.small}>{folder?.name ? t("folder.remembered", { name: folder.name }) : t("folder.none")} {t("folder.help")}</p>
    <button type="button" disabled={busy || !folder} onClick={choose} data-testid="folder-choose">{t(folder?.name ? "folder.change" : "folder.choose")}</button>
    <button type="button" disabled={busy || !folder?.directory} onClick={reimport} data-testid="folder-reimport-run">{t("folder.reimport")}</button>
    {folder?.directory && <button type="button" disabled={busy} onClick={() => void operation(async () => { setFolder(await client.call("folderSet", { directory: null })); setSkipped([]); setMessage(msg("folder.forgotten")); })} data-testid="folder-forget">{t("folder.forget")}</button>}
    {skipped.length > 0 && <details data-testid="folder-skipped"><summary>{t("folder.skippedList", { count: skipped.length })}</summary><ul className={styles.small}>{skipped.map(s => <li key={s.name}><span translate="no">{s.name}</span>{t("common.listSeparator")}{say(s.reason)}</li>)}</ul></details>}
  </div>
  {folder?.directory && pickup && <fieldset className={styles.row} data-testid="folder-pickup" style={{ flexWrap: "wrap", border: 0, padding: 0, margin: 0 }}>
    <legend className={styles.small}><strong>{t("pickup.title")}</strong></legend>
    <select aria-label={t("pickup.title")} value={pickup.every} disabled={busy} onChange={e => savePickup(Number(e.target.value), pickup.auto)} data-testid="pickup-every">{PICKUP_EVERY.map(m => <option key={m} value={m}>{t(EVERY_LABEL[m])}</option>)}</select>
    <Checkbox label={t("pickup.auto")} checked={pickup.auto} disabled={busy || pickup.every === 0} onChange={e => savePickup(pickup.every, e.target.checked)} data-testid="pickup-auto"/>
    {pickup.every > 0 && (pickup.permission === "granted" ? <span className={styles.small} data-testid="pickup-allowed">{t("pickup.allowed")}</span> : <><span className={styles.small}>{t("pickup.needsAllow")}</span><button type="button" disabled={busy} onClick={allow} data-testid="pickup-allow">{t("pickup.allow")}</button></>)}
    <p className={styles.small} data-testid="pickup-last">{lastLine} {t("pickup.help")}</p>
  </fieldset>}
  </>;
}
