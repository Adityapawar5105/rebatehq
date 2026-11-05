import { VaultError } from './protocol';
import { msg } from "../i18n/core";
export type BackupConfig = { directory: FileSystemDirectoryHandle | null; hours: number; last: string | null; error: boolean };
const defaults = (): BackupConfig => ({directory:null,hours:24,last:null,error:false});
async function db() { return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('rebatehq-backup-handles',1);r.onupgradeneeded=()=>r.result.createObjectStore('handles');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error(msg("vault.backup.backupSettingsUnavailable")));}); }
/** Settings saved before the RebateHQ rename sit in the legacy database. Opening a missing database would create it, so abort the upgrade to detect that. */
async function legacyBackupConfig(scope: string): Promise<BackupConfig | null> {
  return new Promise(resolve=>{let missing=false;const r=indexedDB.open('margindesk-backup-handles',1);
    r.onupgradeneeded=()=>{missing=true;r.transaction!.abort();};
    r.onerror=()=>resolve(null);r.onblocked=()=>resolve(null);
    r.onsuccess=()=>{if(missing){r.result.close();resolve(null);return;}const d=r.result;try{const g=d.transaction('handles').objectStore('handles').get(scope);g.onsuccess=()=>{d.close();resolve(g.result??null);};g.onerror=()=>{d.close();resolve(null);};}catch{d.close();resolve(null);}};});
}
export async function backupConfig(scope: string): Promise<BackupConfig> {
  const d=await db();let found:BackupConfig|undefined;
  try{found=await new Promise<BackupConfig|undefined>((resolve,reject)=>{const r=d.transaction('handles').objectStore('handles').get(scope);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{d.close();}
  if(found)return found;
  const legacy=await legacyBackupConfig(scope);
  if(legacy){await storeBackupConfig(scope,legacy);return legacy;}
  return defaults();
}
export async function storeBackupConfig(scope: string, value: BackupConfig) {const d=await db();try{await new Promise<void>((resolve,reject)=>{const tx=d.transaction('handles','readwrite');tx.objectStore('handles').put(value,scope);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{d.close();}}
/** Inject a directory handle in tests; the UI obtains a real handle with the user-gesture picker. */
export async function writeBackup(source: Blob, directory: FileSystemDirectoryHandle) {
  // createWritable.close atomically replaces the file. Keep an earlier backup too.
  try {const old=await (await directory.getFileHandle('rebatehq-backup.enc')).getFile();const previous=await (await directory.getFileHandle('rebatehq-backup.previous.enc',{create:true})).createWritable();await old.stream().pipeTo(previous);} catch(e){if(!(e instanceof DOMException&&e.name==='NotFoundError'))throw e;}
  const stream=await (await directory.getFileHandle('rebatehq-backup.enc',{create:true})).createWritable();
  try {await source.stream().pipeTo(stream);} catch{throw new VaultError('BACKUP',msg("vault.backup.backupCouldNotBe"));}
}
