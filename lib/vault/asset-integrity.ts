// Pins are embedded in the owning worker at build time, never fetched from a
// mutable manifest beside the asset. This protects asset-only tampering, not a
// compromised application deployment that replaces both code and pins.
export type AssetPin = { integrity: string; bytes: number };
declare const __DUCKDB_ASSET_PINS__: Record<string, AssetPin>;
const pins = typeof __DUCKDB_ASSET_PINS__ === "undefined" ? {} : __DUCKDB_ASSET_PINS__;
export async function verifyAsset(bytes: ArrayBuffer, pin: AssetPin) {
  if (!pin || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(pin.integrity) || bytes.byteLength !== pin.bytes) throw new Error("Local engine asset integrity check failed");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  if ("sha256-" + btoa(String.fromCharCode(...hash)) !== pin.integrity) throw new Error("Local engine asset integrity check failed");
}
export async function verifiedAssetUrl(name: string): Promise<string> {
  const pin = pins[name];
  if (!pin || !/^[a-z0-9.-]+\.(?:wasm|js)$/.test(name)) throw new Error("Missing local engine asset pin");
  const response = await fetch(new URL("/spike/" + name, self.location.origin), {
    integrity: pin.integrity, credentials: "omit", redirect: "error",
    referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Local engine asset unavailable");
  const bytes = await response.arrayBuffer();
  await verifyAsset(bytes, pin); // Also checks size; tests exercise this without native Fetch SRI.
  return URL.createObjectURL(new Blob([bytes], { type: name.endsWith(".wasm") ? "application/wasm" : "text/javascript" }));
}
