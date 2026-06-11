import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
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
    throw new HttpError(403, "Acesso negado. Apenas gestores do projeto ou superadmins podem convidar membros da equipe.");
  }
}

function ensureStaffRole(role: unknown) {
  if (role !== "staff") {
    throw new HttpError(400, "Apenas membros com papel staff podem ser adicionados por este fluxo.");
  }
}

async function ensureConfirmedUser(supabaseAdmin: any, userId: string) {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    email_confirm: true,
  });

  if (error) throw error;
}

async function ensureTargetCanBeStaffMember(supabaseAdmin: any, projectId: string, userId: string) {
  const { data: member, error } = await supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (member && member.role !== "staff") {
    throw new HttpError(403, "Apenas membros staff podem ser gerenciados por este fluxo.");
  }
}

async function ensureEstablishmentProfile(supabaseAdmin: any, userId: string, email: string) {
  const { data: profile, error: profileReadError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profileReadError) throw profileReadError;
  if (profile?.role === "superadmin" || profile?.role === "admin") return;

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert({
      id: userId,
      email,
      role: "establishment",
      created_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (profileError) throw profileError;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, password, projectId, role } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail) throw new HttpError(400, "Email é obrigatório.");
    if (!projectId) throw new HttpError(400, "projectId é obrigatório.");
    ensureStaffRole(role);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error("Variáveis de ambiente do Supabase não configuradas.");
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const caller = await getCaller(supabaseAdmin, req);
    await ensureCanManageStaffMembers(supabaseAdmin, caller, projectId);

    let userId: string | null = null;
    let inviteSent = false;

    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw listError;

    const existingUser = users.find((u: any) => u.email?.toLowerCase() === normalizedEmail);

    if (existingUser) {
      userId = existingUser.id;
      await ensureConfirmedUser(supabaseAdmin, userId);
    } else if (password && password.trim().length > 0) {
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password: password.trim(),
        email_confirm: true,
      });
      if (createError) throw createError;
      userId = newUser.user.id;
    } else {
      const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail);
      if (inviteError) throw inviteError;
      userId = invited.user?.id ?? null;
      inviteSent = true;
    }

    if (!userId) throw new Error("Não foi possível determinar o userId.");
    await ensureTargetCanBeStaffMember(supabaseAdmin, projectId, userId);

    await ensureEstablishmentProfile(supabaseAdmin, userId, normalizedEmail);

    const { error: linkError } = await supabaseAdmin
      .from("project_members")
      .upsert({
        project_id: projectId,
        user_id: userId,
        role: "staff",
      }, { onConflict: "project_id,user_id" });

    if (linkError) throw linkError;

    return jsonResponse({ success: true, userId, inviteSent });
  } catch (error) {
    console.error("Erro na função admin-create-member:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro desconhecido." },
      error instanceof HttpError ? error.status : 400,
    );
  }
});
