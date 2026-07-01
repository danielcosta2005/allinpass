import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

type SupabaseAdminClient = any;

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

async function getCallerProfile(supabaseAdmin: SupabaseAdminClient, req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new HttpError(401, "Missing Authorization header");

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw new HttpError(401, "Sessao invalida.");

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  return { user, profile };
}

async function assertCanManageProjectMembers(
  supabaseAdmin: SupabaseAdminClient,
  caller: { user: { id: string }; profile?: { role?: string } | null },
  projectId: string,
) {
  if (!projectId) throw new HttpError(400, "projectId e obrigatorio.");

  const callerRole = caller.profile?.role;
  if (callerRole === "superadmin") return;

  if (callerRole === "admin") {
    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("created_by", caller.user.id)
      .maybeSingle();

    if (error) throw error;
    if (project?.id) return;
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", caller.user.id)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (membership?.role === "owner") return;

  throw new HttpError(403, "Acesso negado. Apenas gestores podem atualizar membros.");
}

function assertValidMemberRole(role: string) {
  if (!["owner", "staff"].includes(role)) {
    throw new HttpError(400, "Papel invalido para membro do projeto.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error("Variaveis de ambiente do Supabase nao configuradas.");
    }

    const body = await req.json().catch(() => ({}));
    const memberId = String(body.memberId || "").trim();
    const projectId = String(body.projectId || "").trim();
    const role = String(body.role || "").trim();
    const password = typeof body.password === "string" ? body.password.trim() : "";

    if (!memberId) throw new HttpError(400, "memberId e obrigatorio.");
    if (!projectId) throw new HttpError(400, "projectId e obrigatorio.");
    if (role) assertValidMemberRole(role);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const caller = await getCallerProfile(supabaseAdmin, req);
    await assertCanManageProjectMembers(supabaseAdmin, caller, projectId);

    if (memberId === caller.user.id && caller.profile?.role !== "superadmin") {
      throw new HttpError(400, "Voce nao pode alterar seu proprio papel no projeto.");
    }

    if (password && caller.profile?.role !== "superadmin") {
      throw new HttpError(403, "Apenas superadmins podem definir senha diretamente.");
    }

    if (password && password.length < 6) {
      throw new HttpError(400, "A senha deve ter no minimo 6 caracteres.");
    }

    const { data: existingMember, error: existingMemberError } = await supabaseAdmin
      .from("project_members")
      .select("user_id, role")
      .eq("project_id", projectId)
      .eq("user_id", memberId)
      .maybeSingle();

    if (existingMemberError) throw existingMemberError;
    if (!existingMember?.user_id) throw new HttpError(404, "Membro nao encontrado neste projeto.");

    if (password) {
      const { error: passErr } = await supabaseAdmin.auth.admin.updateUserById(memberId, { password });
      if (passErr) throw passErr;
    }

    if (role) {
      const { error: memberErr } = await supabaseAdmin
        .from("project_members")
        .update({ role })
        .eq("project_id", projectId)
        .eq("user_id", memberId);

      if (memberErr) throw memberErr;
    }

    const { error: profileErr } = await supabaseAdmin
      .from("profiles")
      .upsert({ id: memberId, role: "establishment" }, { onConflict: "id" });
    if (profileErr) throw profileErr;

    return jsonResponse({ success: true });
  } catch (error: any) {
    console.error("Erro na edge function admin-update-member:", error);
    return jsonResponse(
      { error: error?.message || "Erro desconhecido na edge function" },
      error instanceof HttpError ? error.status : 500,
    );
  }
});
