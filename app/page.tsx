import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/context";
export const dynamic="force-dynamic";
export default async function Home(){const state=await getAuthState();if(!state)redirect("/login");if(!state.memberships.length)redirect("/setup");redirect("/home")}
