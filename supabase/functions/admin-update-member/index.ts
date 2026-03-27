import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

async function isSuperAdmin(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  return profile?.role === 'superadmin';
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerSupabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },

    });

    if (!await isSuperAdmin(callerSupabase)) {

      throw new Error("Acesso negado. Apenas superadmins podem atualizar usuários.");

    }

    const body = await req.json();
    const memberId = body.memberId;
    const password = body.password;
    const projectId = body.projectId;
    const role = body.role;

    if (!memberId) {
      throw new Error("O campo userId é obrigatório.");

    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: {
        persistSession: false, 
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });

    if (password) {
      const { error: passErr } = await supabaseAdmin.auth.admin.updateUserById(memberId, { password });
      if (passErr) throw passErr;

    }

    if (role && projectId) {
      const { error: memberErr } = await supabaseAdmin.from("project_members").upsert(
        { project_id: projectId, user_id: memberId, role: role },
        { onConflict: "project_id,user_id" }
      );
      if (memberErr) throw memberErr;

    }

    const profileRole = role === 'superadmin' ? 'superadmin' : 'establishment';
    const { error: profileErr } = await supabaseAdmin.from("profiles").upsert({ id: memberId, role: profileRole }, { onConflict: "id" });
    if (profileErr) throw profileErr;
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },

    });

  } catch (e) {

    return new Response(JSON.stringify({ error: e?.message || "Erro desconhecido na edge function" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },

    });

  }

});