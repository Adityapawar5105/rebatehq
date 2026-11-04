import { legacyBusinessEnabled, retiredBusinessResponse } from "@/lib/legacy-gate";
import { databaseContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getAppContext } from "@/lib/context";
import { assertPermission, errorResponse, HttpError } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
import { encryptSecret } from "@/lib/secrets";
import { rateLimit } from "@/lib/rate-limit";
import { readJsonLimited } from "@/lib/request";

export const runtime = "nodejs";
const Connector = z.object({ provider: z.enum(["netsuite", "quickbooks", "business_central", "hubspot", "salesforce"]), credential: z.string().min(1).max(20_000) });
export async function GET(request: Request) {if (!legacyBusinessEnabled()) return retiredBusinessResponse();
  try {
    const context = await getAppContext(request.headers); assertPermission(context, "tenant.export");
    const data = await withDatabase(databaseContext(context,request.headers), async db =>
      (await db.query("SELECT provider,rotated_at FROM connector_secret WHERE tenant_id=$1 ORDER BY provider", [context.tenantId])).rows);
    return NextResponse.json({ data });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {if (!legacyBusinessEnabled()) return retiredBusinessResponse();
  try {
    const context = await getAppContext(request.headers); assertPermission(context, "tenant.export");
    const rate = await rateLimit(request, "connector-secret", 10, 60 * 60_000); if (!rate.ok) throw new HttpError(429, "Too many credential updates. Try again later.");
    const body = Connector.safeParse(await readJsonLimited(request, 24_000)); if (!body.success) throw new HttpError(400, "Select a connector and provide a credential no longer than 20,000 characters.");
    const encrypted = encryptSecret(body.data.credential);
    await withDatabase(databaseContext(context,request.headers), async db => {
      await db.query(`INSERT INTO connector_secret(tenant_id,id,provider,ciphertext,nonce,auth_tag,key_version,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,provider) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,nonce=EXCLUDED.nonce,auth_tag=EXCLUDED.auth_tag,key_version=EXCLUDED.key_version,created_by=EXCLUDED.created_by,rotated_at=now()`,
        [context.tenantId, randomUUID(), body.data.provider, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, encrypted.keyVersion, context.userId]);
    });
    return NextResponse.json({ ok: true, provider: body.data.provider }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
