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

function normalizeOrigin(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    return new URL(raw).origin;
  } catch (_) {
    return "";
  }
}

function getInviteRedirectTo(req: Request) {
  const configuredBaseUrl =
    Deno.env.get("APP_BASE_URL") ||
    Deno.env.get("SITE_URL") ||
    Deno.env.get("PUBLIC_SITE_URL") ||
    Deno.env.get("FRONTEND_URL");

  const origin = normalizeOrigin(configuredBaseUrl) || normalizeOrigin(req.headers.get("Origin"));
  return origin ? `${origin}/reset-password?flow=invite` : undefined;
}

function getInviteOptions(req: Request) {
  const redirectTo = getInviteRedirectTo(req);
  return redirectTo ? { redirectTo } : {};
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

    ensureSuperadmin(await getCallerProfile(supabaseAdmin, req));

    const { email } = await req.json().catch(() => ({}));
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail) throw new HttpError(400, "Email é obrigatório.");
    const { data: usersPage, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw listError;

    const existingUser = (usersPage?.users || []).find(
      (user: any) => user.email?.toLowerCase() === normalizedEmail,
    );

    let userId = existingUser?.id || null;
    let inviteSent = false;

    if (!userId) {
      const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        normalizedEmail,
        getInviteOptions(req),
      );
      if (inviteError) throw inviteError;
      userId = invited.user?.id || null;
      inviteSent = true;
    }

    if (!userId) throw new Error("Não foi possível determinar o userId.");

    const { data: currentProfile, error: profileLookupError } = await supabaseAdmin
      .from("profiles")
      .select("role, created_at")
      .eq("id", userId)
      .maybeSingle();

    if (profileLookupError) throw profileLookupError;
    if (currentProfile?.role === "superadmin") {
      throw new HttpError(409, "Este usuário já é superadmin.");
    }

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        id: userId,
        email: normalizedEmail,
        role: "admin",
        created_at: currentProfile?.created_at || new Date().toISOString(),
      }, { onConflict: "id" });

    if (profileError) throw profileError;

    return jsonResponse({ success: true, userId, inviteSent });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("Erro na função superadmin-create-admin:", error);
    return jsonResponse({ error: error?.message || "Erro desconhecido na edge function" }, status);
  }
});
