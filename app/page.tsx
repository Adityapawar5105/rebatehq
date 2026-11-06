import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/context";
export const dynamic="force-dynamic";
// A local lab server (VAULT_LAB_ENABLED=true) without Supabase has no sign-in: open the lab vault instead of failing.
const labOnly=()=>process.env.VAULT_LAB_ENABLED==="true"&&!(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
export default async function Home(){if(labOnly())redirect("/lab/vault");const state=await getAuthState();if(!state)redirect("/login");if(!state.memberships.length)redirect("/setup");redirect("/home")}
