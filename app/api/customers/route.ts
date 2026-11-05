// Retired in chunk 6R: the server tables behind this endpoint were dropped (wave 1).
// It stays as a fixed 410 so the HTTP boundary and the privacy gate keep checking it.
import { retiredBusinessResponse } from "@/lib/legacy-gate";

export const runtime = "nodejs";
export async function GET() { return retiredBusinessResponse(); }
