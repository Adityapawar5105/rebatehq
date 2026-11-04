export const dynamic="force-dynamic";
export async function GET(){return Response.json({status:"ok",service:"rebatehq",time:new Date().toISOString()},{headers:{"cache-control":"no-store"}})}
