import { HttpError } from "@/lib/authz";
import { msg } from "./i18n/core";

export async function readTextLimited(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new HttpError(413, msg("api.request.theUploadedRequestIs2"));
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new HttpError(413, msg("api.request.theUploadedRequestIs")); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try{return new TextDecoder("utf-8", { fatal: true }).decode(bytes)}catch{throw new HttpError(400,msg("api.request.theRequestBodyMust"))}
}

export async function readJsonLimited<T = unknown>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const raw = await readTextLimited(request, maxBytes);
  try { return JSON.parse(raw) as T; } catch { throw new HttpError(400, msg("api.request.theRequestBodyIs")); }
}

export async function readBytesLimited(request: Request, maxBytes: number): Promise<Uint8Array> {
  const length=Number(request.headers.get("content-length")||0);
  if(length>maxBytes)throw new HttpError(413,msg("api.request.thisFileExceedsThe2", { maxBytes: maxBytes }));
  if(!request.body)throw new HttpError(400,msg("api.request.chooseAFileTo"));
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new HttpError(413,msg("api.request.thisFileExceedsThe", { maxBytes: maxBytes }));}chunks.push(value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(total);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return result;
}
