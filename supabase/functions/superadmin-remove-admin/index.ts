import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function getCallerProfile(supabaseAdmin: any, req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new HttpError(401, "Missing Authorization header");

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw new HttpError(401, "Sessão inválida.");

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  return { user, profile };
}

function ensureSuperadmin(caller: { profile?: { role?: string } | null }) {
  if (caller.profile?.role !== "superadmin") {
    throw new HttpError(403, "Acesso negado. Apenas superadmins podem gerenciar admins.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error("Variáveis de ambiente do Supabase não configuradas.");
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const caller = await getCallerProfile(supabaseAdmin, req);
    ensureSuperadmin(caller);

    const { adminId } = await req.json().catch(() => ({}));
    const targetAdminId = String(adminId || "").trim();

    if (!targetAdminId) throw new HttpError(400, "adminId é obrigatório.");
    if (targetAdminId === caller.user.id) {
      throw new HttpError(400, "Você não pode remover seu próprio acesso.");
    }

    const { data: targetProfile, error: lookupError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", targetAdminId)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (targetProfile?.role !== "admin") {
      throw new HttpError(404, "Admin não encontrado.");
    }

    const { error: deleteError } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", targetAdminId)
      .eq("role", "admin");

    if (deleteError) throw deleteError;

    return jsonResponse({ success: true });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("erro na função superadmin-remove-admin:", error);
    return jsonResponse({ error: error?.message || "erro desconhecido na edge function" }, status);
  }
});
