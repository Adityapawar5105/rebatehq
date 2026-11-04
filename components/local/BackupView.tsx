"use client";
import { useEffect,useState } from 'react';
import type { VaultClient } from '@/lib/vault/client';
import type { Results,VaultStatus } from '@/lib/vault/protocol';
import { download } from './PricingView';
import styles from './vault.module.css';
export function BackupView({client,busy,operation,unlocked,onStatus}:{client:VaultClient;busy:boolean;operation:(f:()=>Promise<void>)=>Promise<void>;unlocked:boolean;onStatus:(s:VaultStatus)=>void}){
 const [s,setS]=useState<Results['backupStatus']|null>(null),[hours,setHours]=useState('24'),[secret,setSecret]=useState(''),[file,setFile]=useState<File|null>(null),[message,setMessage]=useState('');
 const load=async()=>setS(await client.call('backupStatus',{}));useEffect(()=>{void load().catch(()=>setMessage('Backup settings could not be read.'));},[client]);
 const run=(f:()=>Promise<void>)=>void operation(async()=>{await f();await load();});
 return <section className={styles.card}><h2>Encrypted backup and restore</h2><p role="status">{message}</p>{s?.reminder&&<p className={styles.error}>⚠ No recent folder backup recorded. Export an encrypted backup and keep its passphrase safe.</p>}{s?.error&&<p className={styles.error}>⚠ The last folder backup failed. Re-select the folder and retry.</p>}
 {unlocked?<><p>Scheduled copies run while this vault is open and unlocked; a closed or locked browser cannot run them. After each approved change, a configured folder receives an encrypted snapshot.</p><p>Folder: {s?.configured?'selected':'not selected'}. Last folder backup: {s?.last??'none'}.</p><label>Backup interval (hours)<input type="number" min="1" max="168" value={hours} onChange={e=>setHours(e.target.value)}/></label><button disabled={busy} onClick={()=>{
 const picker=(window as unknown as {showDirectoryPicker?:(o:{mode:string})=>Promise<FileSystemDirectoryHandle>}).showDirectoryPicker;
 if(!picker){setMessage('Folder backup needs Chrome or Edge. Use encrypted file export instead.');return;}
 // Invoke the picker immediately in the trusted click, before asynchronous worker calls.
 void picker({mode:'readwrite'}).then(directory=>run(async()=>{await client.call('backupConfigure',{directory,hours:Number(hours)});await client.call('backupNow',{});setMessage('Encrypted folder backup written.');})).catch(()=>setMessage('Folder selection cancelled or denied. No vault data was changed.'));
 }}>Choose backup folder</button><button disabled={busy||!s?.configured} onClick={()=>run(async()=>{await client.call('backupNow',{});setMessage('Encrypted folder backup written.');})}>Back up now</button><button disabled={busy} onClick={()=>run(async()=>{const r=await client.call('backupExport',{});download(r.name,r.blob);setMessage('Encrypted export downloaded. Check that the file is saved; downloads cannot be confirmed by this app.');})}>Download encrypted backup</button></>:<><p>Restore into an empty vault, in the same signed-in workspace. An existing vault is never overwritten. The original passphrase is required.</p><label>Encrypted backup file<input type="file" accept=".enc" onChange={e=>setFile(e.target.files?.[0]??null)}/></label><label>Backup passphrase<input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)}/></label><button disabled={busy||!file||!secret} onClick={()=>{const passphrase=secret;setSecret('');run(async()=>{onStatus(await client.call('backupRestore',{file:file!,passphrase}));setMessage('Backup restored and audit chain verified.');});}}>Restore encrypted backup</button></>}
 </section>;
}
