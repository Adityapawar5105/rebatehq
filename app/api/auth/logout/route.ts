import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const runtime="nodejs";
export async function POST(request:Request){const supabase=await createSupabaseServerClient();await supabase.auth.signOut({scope:"global"}).catch(()=>undefined);const cookieStore=await cookies();cookieStore.delete("md-tenant");cookieStore.delete("md-dev-impersonation");return NextResponse.redirect(new URL("/login",request.url),303)}
