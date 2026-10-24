import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function currentUser(){const supabase=await createSupabaseServerClient();const {data,error}=await supabase.auth.getUser();if(error||!data.user?.email)return null;return{id:data.user.id,email:data.user.email}}
