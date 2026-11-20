"use client";
import { Notice } from "@/components/ui/ui";
import { useEffect,useState } from 'react';
import type { VaultClient } from '@/lib/vault/client';
import type { Results,VaultStatus } from '@/lib/vault/protocol';
import { download } from './PricingView';
import { fmt, msg, say, t } from "@/lib/i18n";
import styles from './vault.module.css';
export function BackupView({client,busy,operation,unlocked,onStatus}:{client:VaultClient;busy:boolean;operation:(f:()=>Promise<void>)=>Promise<void>;unlocked:boolean;onStatus:(s:VaultStatus)=>void}){
 const [s,setS]=useState<Results['backupStatus']|null>(null),[hours,setHours]=useState('24'),[secret,setSecret]=useState(''),[file,setFile]=useState<File|null>(null),[message,setMessage]=useState('');
 const load=async()=>setS(await client.call('backupStatus',{}));useEffect(()=>{void load().catch(()=>setMessage(msg("backup.backupSettingsCouldNot")));},[client]);
 const run=(f:()=>Promise<void>)=>void operation(async()=>{await f();await load();});
 return <section className={styles.card} aria-labelledby="backup-heading"><h2 id="backup-heading">{t("backup.encryptedBackupAndRestore")}</h2><p role="status">{say(message)}</p>{s?.reminder&&<Notice tone="warn">{t("backup.noRecentFolderBackup")}</Notice>}{s?.error&&<Notice tone="bad">{t("backup.theLastFolderBackup")}</Notice>}
 {unlocked?<><p>{t("backup.scheduledCopiesRunWhile")}</p><p>{t("backup.folderStatus", { state: t(s?.configured ? "backup.selected" : "backup.notSelected"), last: s?.last ? fmt.dateTime(s.last) : t("common.none") })}</p><label>{t("backup.backupIntervalHours")}<input type="number" min="1" max="168" value={hours} onChange={e=>setHours(e.target.value)}/></label><button disabled={busy} onClick={()=>{
 const picker=(window as unknown as {showDirectoryPicker?:(o:{mode:string})=>Promise<FileSystemDirectoryHandle>}).showDirectoryPicker;
 if(!picker){setMessage(msg("backup.folderBackupNeedsChrome"));return;}
 // Invoke the picker immediately in the trusted click, before asynchronous worker calls.
 void picker({mode:'readwrite'}).then(directory=>run(async()=>{await client.call('backupConfigure',{directory,hours:Number(hours)});await client.call('backupNow',{});setMessage(msg("backup.encryptedFolderBackupWritten2"));})).catch(()=>setMessage(msg("backup.folderSelectionCancelledOr")));
 }}>{t("backup.chooseBackupFolder")}</button><button disabled={busy||!s?.configured} onClick={()=>run(async()=>{await client.call('backupNow',{});setMessage(msg("backup.encryptedFolderBackupWritten"));})}>{t("backup.backUpNow")}</button><button disabled={busy} onClick={()=>run(async()=>{const r=await client.call('backupExport',{});download(r.name,r.blob);setMessage(msg("backup.encryptedExportDownloadedCheck"));})}>{t("backup.downloadEncryptedBackup")}</button></>:<><p>{t("backup.restoreIntoAnEmpty")}</p><label>{t("backup.encryptedBackupFile")}<input type="file" accept=".enc" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><label>{t("backup.backupPassphrase")}<input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)}/></label><button disabled={busy||!file||!secret} onClick={()=>{const passphrase=secret;setSecret('');run(async()=>{onStatus(await client.call('backupRestore',{file:file!,passphrase}));setMessage(msg("backup.backupRestoredAndAudit"));});}}>{t("backup.restoreEncryptedBackup")}</button></>}
 </section>;
}
