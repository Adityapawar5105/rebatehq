import { deviceId, refreshLicence, REFRESH_MS } from "../licence-cache";
import type { Action, Commands, Results, Response, Scope } from "./protocol";
import { msg } from "../i18n/core";
/** A refused or failed command, with the worker's error code (audit X-4). */
export class VaultClientError extends Error { constructor(public code: string, message: string) { super(message); } }
export class VaultClient {
  /** True once the worker has died: every later call is refused at once and the page offers a reload. */
  failed = false;
  private worker: Worker;
  private sequence = 0;
  private closed=false;
  private refreshTimer:ReturnType<typeof setInterval>|null=null;
  private requests = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  constructor(scope: Scope, onEvent: (event: Extract<Response, { event: string }>) => void, onFailed?: () => void) {
    this.worker = new Worker("/spike/vault-worker.js", { type: "module" });
    this.worker.onmessage = ({ data }: MessageEvent<Response>) => {
      if ("event" in data) { onEvent(data); return; }
      const request = this.requests.get(data.id); if (!request) return;
      this.requests.delete(data.id);
      if ("error" in data) request.reject(new VaultClientError(data.error.code, data.error.message)); else request.resolve(data.result);
    };
    this.worker.onerror = event => {
      event.preventDefault(); this.failed = true;
      for (const request of this.requests.values()) request.reject(new VaultClientError("WORKER", msg("vault.client.theVaultWorkerStopped")));
      this.requests.clear(); onFailed?.();
    };
    const device=deviceId(scope);
    const refresh=async()=>{const result=await refreshLicence(scope,device);const status=await this.call('licenceSet',{...result,device});onEvent({event:'licence',status});return status;};
    this.ready=this.call('init',{scope}).then(refresh);
    this.refreshTimer=setInterval(()=>void refresh().catch(()=>undefined),REFRESH_MS);
  }
  ready: Promise<Results["init"]>;
  call<K extends Action>(action: K, data: Commands[K]): Promise<Results[K]> {
    if(this.closed)return Promise.reject(new VaultClientError("CLOSED",msg("vault.client.vaultWorkerClosed2")));
    if(this.failed)return Promise.reject(new VaultClientError("WORKER",msg("vault.client.theVaultWorkerStopped")));
    return new Promise((resolve, reject) => {
      const id = String(++this.sequence); this.requests.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, action, data });
    });
  }
  close() { this.closed=true;if(this.refreshTimer)clearInterval(this.refreshTimer);this.worker.terminate(); for (const request of this.requests.values()) request.reject(new Error(msg("vault.client.vaultWorkerClosed"))); this.requests.clear(); }
}
