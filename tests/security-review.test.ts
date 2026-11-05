import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyAsset } from "../lib/vault/asset-integrity";
import { logSecurityEvent } from "../lib/secure-logger";

test("engine integrity rejects modified, truncated, and unpinned assets before execution", async () => {
  const bytes = new TextEncoder().encode("synthetic asset bytes").buffer;
  const pin = { integrity: "sha256-" + createHash("sha256").update(new Uint8Array(bytes)).digest("base64"), bytes: bytes.byteLength };
  await verifyAsset(bytes, pin);
  const modified = bytes.slice(0); new Uint8Array(modified)[0] ^= 1;
  await assert.rejects(verifyAsset(modified, pin), /integrity/);
  await assert.rejects(verifyAsset(bytes.slice(1), pin), /integrity/);
  await assert.rejects(verifyAsset(bytes, { ...pin, integrity: "" }), /integrity/);
  const loader = readFileSync("lib/vault/asset-integrity.ts", "utf8");
  assert.match(loader, /integrity: pin.integrity/); assert.match(loader, /redirect: "error"/);
  assert.doesNotMatch(loader, /fetch\([^\n]*assets\.json/);
});

test("security logs reject nested payloads, unknown fields, event overrides and arbitrary reason text", () => {
  const records: string[] = [], original = console.info;
  console.info = value => records.push(String(value));
  try {
    const marker = "PRIVATE_CUSTOMER_PRICE_98765";
    logSecurityEvent("auth.login_failed", { email: " User@example.test ", ip_hash: "a".repeat(24), reason: marker, payload: { password: marker, cost: marker }, event: marker, at: marker, customer: marker });
    logSecurityEvent(marker, { reason: "AuthApiError", ip_hash: marker });
    assert.ok(records.every(r => !r.includes(marker) && !r.includes("User@example.test")));
    assert.deepEqual(Object.keys(JSON.parse(records[0])).sort(), ["at", "email_hash", "event", "ip_hash", "reason"]);
    assert.equal(JSON.parse(records[0]).reason, "OtherError");
    assert.equal(JSON.parse(records[1]).event, "auth.unknown_event");
    assert.equal(JSON.parse(records[1]).reason, "AuthApiError");
  } finally { console.info = original; }
});
