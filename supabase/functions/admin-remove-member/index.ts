import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

async function isSuperAdmin(supabase: any) {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return false;

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profErr) return false;
  return profile?.role === "superadmin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
      throw new Error("Variáveis de ambiente do Supabase não configuradas.");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client do caller (com ANON + Authorization do usuário logado)
    const callerSupabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const allowed = await isSuperAdmin(callerSupabase);
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Acesso negado. Apenas superadmins podem remover membros." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const memberId = body.memberId;   // ✅ padronizado
    const projectId = body.projectId;

    if (!memberId || !projectId) {
      return new Response(JSON.stringify({ error: "Os campos memberId e projectId são obrigatórios." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client admin
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: deleteErr } = await supabaseAdmin
      .from("project_members")
      .delete()
      .match({ project_id: projectId, user_id: memberId });

    if (deleteErr) {
      console.error("Erro ao deletar project_members:", deleteErr);
      return new Response(JSON.stringify({ error: deleteErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("Erro na edge function admin-remove-member:", e);
    return new Response(JSON.stringify({ error: e?.message || "Erro desconhecido na edge function" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
