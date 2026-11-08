/** Presentation derived from the existing signed session, not a new relay protocol. */
export function syncStatus(v:{head:{sequence:string;hash:string};remote:{sequence:string;hash:string};pending:{sequence:string;previousHash:string}|null;pendingEpoch:boolean;rejected:number;lastSyncedAt?:string}){
 const conflict=v.rejected>0||(v.head.sequence===v.remote.sequence&&v.head.hash!==v.remote.hash)||!!v.pending&&(BigInt(v.pending.sequence)<=BigInt(v.head.sequence)||v.pending.previousHash!==v.head.hash);
 return {status:conflict?'conflict' as const:v.pending||v.pendingEpoch||v.head.sequence!==v.remote.sequence||v.head.hash!==v.remote.hash||!v.lastSyncedAt?'pending' as const:'synced' as const,lastSyncedAt:v.lastSyncedAt??null};
}
