// Roadmap 13.3 (21 Nov 2026): the legacy business pages and their LEGACY_BUSINESS_ENABLED switch are retired. What
// stays is the fixed 410 answer of the retired API routes, kept on purpose (decision D12) so an old client gets a
// clear "use the local vault" instead of a 404.
export function retiredBusinessResponse() {
  return Response.json({ error: "This server business-data endpoint is retired. Use the local vault." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
