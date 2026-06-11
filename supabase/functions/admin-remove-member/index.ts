import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function getCaller(supabaseAdmin: any, req: Request) {
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

async function ensureCanManageStaffMembers(supabaseAdmin: any, caller: any, projectId: string) {
  if (caller.profile?.role === "superadmin") return;

  const { data: membership, error } = await supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", caller.user.id)
    .maybeSingle();

  if (error) throw error;
  if (membership?.role !== "owner") {
    throw new HttpError(403, "Acesso negado. Apenas gestores do projeto ou superadmins podem remover membros da equipe.");
  }
}

async function ensureTargetIsStaff(supabaseAdmin: any, projectId: string, memberId: string) {
  const { data: member, error } = await supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", memberId)
    .maybeSingle();

  if (error) throw error;
  if (!member) throw new HttpError(404, "Membro não encontrado neste projeto.");
  if (member.role !== "staff") {
    throw new HttpError(403, "Apenas membros staff podem ser gerenciados por este fluxo.");
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

    const body = await req.json();
    const memberId = body.memberId;
    const projectId = body.projectId;

    if (!memberId || !projectId) {
      throw new HttpError(400, "Os campos memberId e projectId são obrigatórios.");
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const caller = await getCaller(supabaseAdmin, req);
    await ensureCanManageStaffMembers(supabaseAdmin, caller, projectId);
    await ensureTargetIsStaff(supabaseAdmin, projectId, memberId);

    const { error: deleteErr } = await supabaseAdmin
      .from("project_members")
      .delete()
      .match({ project_id: projectId, user_id: memberId });

    if (deleteErr) throw deleteErr;

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Erro na edge function admin-remove-member:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro desconhecido na edge function" },
      error instanceof HttpError ? error.status : 500,
    );
  }
});
