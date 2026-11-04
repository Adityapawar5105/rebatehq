import { VaultError } from './protocol';
export type BackupConfig = { directory: FileSystemDirectoryHandle | null; hours: number; last: string | null; error: boolean };
const defaults = (): BackupConfig => ({directory:null,hours:24,last:null,error:false});
async function db() { return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('margindesk-backup-handles',1);r.onupgradeneeded=()=>r.result.createObjectStore('handles');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Backup settings unavailable.'));}); }
export async function backupConfig(scope: string): Promise<BackupConfig> {const d=await db();try{return await new Promise((resolve,reject)=>{const r=d.transaction('handles').objectStore('handles').get(scope);r.onsuccess=()=>resolve(r.result||defaults());r.onerror=()=>reject(r.error);});}finally{d.close();}}
export async function storeBackupConfig(scope: string, value: BackupConfig) {const d=await db();try{await new Promise<void>((resolve,reject)=>{const tx=d.transaction('handles','readwrite');tx.objectStore('handles').put(value,scope);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{d.close();}}
/** Inject a directory handle in tests; the UI obtains a real handle with the user-gesture picker. */
export async function writeBackup(source: Blob, directory: FileSystemDirectoryHandle) {
  // createWritable.close atomically replaces the file. Keep an earlier backup too.
  try {const old=await (await directory.getFileHandle('margindesk-backup.enc')).getFile();const previous=await (await directory.getFileHandle('margindesk-backup.previous.enc',{create:true})).createWritable();await old.stream().pipeTo(previous);} catch(e){if(!(e instanceof DOMException&&e.name==='NotFoundError'))throw e;}
  const stream=await (await directory.getFileHandle('margindesk-backup.enc',{create:true})).createWritable();
  try {await source.stream().pipeTo(stream);} catch{throw new VaultError('BACKUP','Backup could not be written. Re-select the folder and retry; the vault and previous backup are retained.');}
}
