/** Server-only decision. Nothing sets this flag from a request or browser storage. */
export function legacyBusinessEnabled() { return process.env.LEGACY_BUSINESS_ENABLED === "true"; }
export function retiredBusinessResponse() {
  return Response.json({ error: "This server business-data endpoint is retired. Use the local vault." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
