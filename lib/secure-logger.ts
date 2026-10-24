import { createHash } from "node:crypto";
export function logSecurityEvent(event:string,fields:Record<string,unknown>={}){
 const safe:Record<string,unknown>={event,at:new Date().toISOString(),...fields};
 if(typeof safe.email==="string"){safe.email_hash=createHash("sha256").update(String(safe.email).trim().toLowerCase()).digest("hex");delete safe.email;}
 for(const key of Object.keys(safe))if(/password|token|secret|authorization|cookie|credential|api[-_]?key/i.test(key))delete safe[key];
 console.info(JSON.stringify(safe));
}
