import type { Action, Commands, Results, Response, Scope } from "./protocol";
export class VaultClient {
  private worker: Worker;
  private sequence = 0;
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
      for (const request of this.requests.values()) request.reject(new Error("The vault worker stopped. Reload to unlock the last encrypted save."));
      this.requests.clear();
    };
    this.ready = this.call("init", { scope });
  }
  ready: Promise<Results["init"]>;
  call<K extends Action>(action: K, data: Commands[K]): Promise<Results[K]> {
    return new Promise((resolve, reject) => {
      const id = String(++this.sequence); this.requests.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, action, data });
    });
  }
  close() { this.worker.terminate(); for (const request of this.requests.values()) request.reject(new Error("Vault worker closed.")); this.requests.clear(); }
}
