import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/context";
import { forwardAuthParams } from "@/lib/auth-forward";
export const dynamic="force-dynamic";
// A local lab server (VAULT_LAB_ENABLED=true) without Supabase has no sign-in: open the lab vault instead of failing.
const labOnly=()=>process.env.VAULT_LAB_ENABLED==="true"&&!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const forward=forwardAuthParams(await searchParams);if(forward)redirect(forward);if(labOnly())redirect("/lab/vault");const state=await getAuthState();if(!state)redirect("/login");if(!state.memberships.length)redirect("/setup");redirect("/home")}
