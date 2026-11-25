// Team sharing S4 (SHARING_DESIGN.md section 5, step 6): the Realtime doorbell. The vault worker joins one private
// channel per pack its device holds, `pack:<tenant>:<pack>`, with the person's own short-lived session token. A message
// carries only the new version number (migration 20261127120000_sharing_s4_doorbell.sql); hearing it only makes the
// worker sync sooner. The 60-second poll stays the path that guarantees delivery, so a socket that never connects (the
// lab, a proxy that blocks WebSockets) costs nothing but speed. The server decides who may join, so a device without a
// cost pack is never told that cost changed.
import { RealtimeClient, type RealtimeChannel } from "@supabase/supabase-js";

export type DoorbellToken = { url: string; apikey: string; token: string; expiresAt: string };
/** What the doorbell is doing, for the sync status and for diagnosing a socket that never joins (no content, no token). */
export type DoorbellState = { started: boolean; joined: string[]; statuses: Record<string, string>; rings: number; lastRingAt: string | null };
export type Doorbell = {
  /** Join exactly these packs' channels (leaves the others); call again after every key rotation. */
  watch(packs: readonly string[]): void;
  /** Whether at least one channel is joined right now. */
  open(): boolean;
  state(): DoorbellState;
  stop(): void;
};

/** `token` must be cheap: the client asks for it on connect and on every heartbeat (cache it until shortly before expiry). */
export function doorbell(tenant: string, token: () => Promise<DoorbellToken>, ring: (pack: string) => void): Doorbell {
  let client: RealtimeClient | null = null, starting: Promise<RealtimeClient | null> | null = null, stopped = false, rings = 0, lastRingAt: string | null = null;
  const channels = new Map<string, { channel: RealtimeChannel; joined: boolean; status: string }>();
  const start = () => starting ??= token().then(async t => {
    if (stopped) return null;
    client = new RealtimeClient(t.url.replace(/\/$/, "") + "/realtime/v1", {
      params: { apikey: t.apikey }, transport: WebSocket, accessToken: async () => (await token()).token,
      // No long-poll fallback: the only traffic is the WebSocket, and the poll covers a socket that cannot connect.
      logger: () => undefined,
    });
    // Private channels are authorised by the token the socket carries when each channel joins.
    await client.setAuth(t.token);
    return client;
  }).catch(() => { starting = null; return null; });
  const join = async (pack: string) => {
    const c = await start(); if (!c || stopped || channels.has(pack)) return;
    const channel = c.channel(`pack:${tenant}:${pack}`, { config: { private: true, broadcast: { self: false, ack: false } } });
    const entry = { channel, joined: false, status: "joining" }; channels.set(pack, entry);
    channel.on("broadcast", { event: "pack" }, () => { rings++; lastRingAt = new Date().toISOString(); ring(pack); })
      .subscribe((status, error) => { entry.joined = status === "SUBSCRIBED"; entry.status = status + (error ? ": " + String(error.message ?? error).slice(0, 120) : ""); });
  };
  const leave = (pack: string) => { const e = channels.get(pack); if (!e) return; channels.delete(pack); void client?.removeChannel(e.channel); };
  return {
    watch(packs) {
      if (stopped) return;
      for (const p of [...channels.keys()]) if (!packs.includes(p)) leave(p);
      for (const p of packs) void join(p);
    },
    open: () => [...channels.values()].some(e => e.joined),
    state: () => ({ started: !!client, joined: [...channels.entries()].filter(([, e]) => e.joined).map(([p]) => p), statuses: Object.fromEntries([...channels.entries()].map(([p, e]) => [p, e.status])), rings, lastRingAt }),
    stop() { stopped = true; for (const p of [...channels.keys()]) leave(p); void client?.disconnect(); client = null; },
  };
}
