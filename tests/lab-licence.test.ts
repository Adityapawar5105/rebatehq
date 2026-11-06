// The lab harness licence (/lab/vault): only when VAULT_LAB_ENABLED=true, only for the synthetic lab scope.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { LAB_SCOPE, labAssertion } from "../lib/licence-server";
import { verifyLicence } from "../lib/licence-verify";
import { licenceWritable } from "../lib/licence-policy";

test("the lab licence is signed, short-lived, bound to the lab scope and device, and refused when the lab is off", async () => {
  const pair = generateKeyPairSync("ed25519");
  const signing = pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), verify = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const saved = { lab: process.env.VAULT_LAB_ENABLED, key: process.env.LICENCE_SIGNING_KEY };
  try {
    process.env.LICENCE_SIGNING_KEY = signing;
    delete process.env.VAULT_LAB_ENABLED;
    assert.throws(() => labAssertion(randomUUID()), /disabled/);
    process.env.VAULT_LAB_ENABLED = "true";
    const device = randomUUID(), envelope = labAssertion(device);
    const claims = await verifyLicence(envelope, verify, { userId: LAB_SCOPE.userId, workspaceId: LAB_SCOPE.tenantId }, device);
    assert.equal(claims.tier, "scale"); assert.ok(licenceWritable(claims)); assert.ok(claims.expires - claims.issued <= 3600);
    // It cannot be used for a real person, workspace or another device.
    await assert.rejects(verifyLicence(envelope, verify, { userId: randomUUID(), workspaceId: LAB_SCOPE.tenantId }, device));
    await assert.rejects(verifyLicence(envelope, verify, { userId: LAB_SCOPE.userId, workspaceId: randomUUID() }, device));
    await assert.rejects(verifyLicence(envelope, verify, { userId: LAB_SCOPE.userId, workspaceId: LAB_SCOPE.tenantId }, randomUUID()));
  } finally {
    if (saved.lab === undefined) delete process.env.VAULT_LAB_ENABLED; else process.env.VAULT_LAB_ENABLED = saved.lab;
    if (saved.key === undefined) delete process.env.LICENCE_SIGNING_KEY; else process.env.LICENCE_SIGNING_KEY = saved.key;
  }
});

test("the licence route issues a lab licence only with the lab on and nobody signed in; the lab page uses the same scope", () => {
  const route = readFileSync("app/api/licence/route.ts", "utf8"), page = readFileSync("app/lab/vault/page.tsx", "utf8");
  assert.match(route, /if \(!ctx && lab\) return Response\.json\(labAssertion\(device\)/);
  assert.match(route, /const lab = process\.env\.VAULT_LAB_ENABLED === 'true'/);
  assert.ok(page.includes(`userId: "${LAB_SCOPE.userId}"`) && page.includes(`tenantId: "${LAB_SCOPE.tenantId}"`));
});
