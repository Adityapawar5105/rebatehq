import { deviceId, refreshLicence, REFRESH_MS } from "../licence-cache";
import type { Action, Commands, Results, Response, Scope } from "./protocol";
import { msg } from "../i18n/core";
export class VaultClient {
  private worker: Worker;
  private sequence = 0;
  private closed=false;
  private refreshTimer:ReturnType<typeof setInterval>|null=null;
  private requests = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  constructor(scope: Scope, onEvent: (event: Extract<Response, { event: string }>) => void) {
    this.worker = new Worker("/spike/vault-worker.js", { type: "module" });
    this.worker.onmessage = ({ data }: MessageEvent<Response>) => {
      if ("event" in data) { onEvent(data); return; }
      const request = this.requests.get(data.id); if (!request) return;
      this.requests.delete(data.id);
      if ("error" in data) request.reject(new Error(data.error.message)); else request.resolve(data.result);
    };
    this.worker.onerror = event => {
      event.preventDefault();
      for (const request of this.requests.values()) request.reject(new Error(msg("vault.client.theVaultWorkerStopped")));
      this.requests.clear();
    };
    const device=deviceId(scope);
    const refresh=async()=>{const result=await refreshLicence(scope,device);const status=await this.call('licenceSet',{...result,device});onEvent({event:'licence',status});return status;};
    this.ready=this.call('init',{scope}).then(refresh);
    this.refreshTimer=setInterval(()=>void refresh().catch(()=>undefined),REFRESH_MS);
  }
  ready: Promise<Results["init"]>;
  call<K extends Action>(action: K, data: Commands[K]): Promise<Results[K]> {
    if(this.closed)return Promise.reject(new Error(msg("vault.client.vaultWorkerClosed2")));
    return new Promise((resolve, reject) => {
      const id = String(++this.sequence); this.requests.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, action, data });
    });
  }
  close() { this.closed=true;if(this.refreshTimer)clearInterval(this.refreshTimer);this.worker.terminate(); for (const request of this.requests.values()) request.reject(new Error(msg("vault.client.vaultWorkerClosed"))); this.requests.clear(); }
}
