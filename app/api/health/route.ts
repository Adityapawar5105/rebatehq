export const dynamic="force-dynamic";
// The deployed commit (Vercel sets VERCEL_GIT_COMMIT_SHA; the repository is public) lets the deploy smoke test wait for
// the commit it was started for. Short form only; nothing else about the environment is shown.
const sha=process.env.VERCEL_GIT_COMMIT_SHA??"", commit=/^[0-9a-f]{40}$/.test(sha)?sha.slice(0,12):null;
export async function GET(){return Response.json({status:"ok",service:"rebatehq",commit,time:new Date().toISOString()},{headers:{"cache-control":"no-store"}})}
