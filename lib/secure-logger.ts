import { createHash } from "node:crypto";
const EVENTS = new Set(["auth.callback_failed", "auth.callback_membership_error", "auth.login_failed", "auth.magic_link_requested"]);
const REASONS = new Set(["AuthApiError", "AuthUnknownError", "AuthRetryableFetchError", "AuthSessionMissingError", "Error", "unknown"]);
export function logSecurityEvent(event:string,fields:Record<string,unknown>={}){
 // Allow fields, rather than trying to redact arbitrary nested user payloads.
 const safe:Record<string,unknown>={event:EVENTS.has(event)?event:"auth.unknown_event",at:new Date().toISOString()};
 if(typeof fields.email==="string")safe.email_hash=createHash("sha256").update(fields.email.trim().toLowerCase()).digest("hex");
 if(typeof fields.ip_hash==="string"&&/^[0-9a-f]{24,64}$/.test(fields.ip_hash))safe.ip_hash=fields.ip_hash;
 if(typeof fields.reason==="string")safe.reason=REASONS.has(fields.reason)?fields.reason:"OtherError";
 console.info(JSON.stringify(safe));
}
