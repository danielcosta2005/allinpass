import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type SupabaseAdminClient = any;

export type CallerContext = {
  user: { id: string; email?: string | null };
  profile: { role?: string | null } | null;
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function getServiceClient() {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Variaveis de ambiente do Supabase nao configuradas.");
  }

  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

export async function getCallerProfile(
  supabaseAdmin: SupabaseAdminClient,
  req: Request,
): Promise<CallerContext> {
  const token = getBearerToken(req);
  if (!token) throw new HttpError(401, "Missing Authorization header", "missing_auth");

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw new HttpError(401, "Sessao invalida.", "invalid_session");

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;

  return {
    user: { id: user.id, email: user.email },
    profile: profile as { role?: string | null } | null,
  };
}

export function ensureSuperadmin(caller: CallerContext, message = "Acesso negado. Apenas superadmins podem executar esta acao.") {
  if (caller.profile?.role !== "superadmin") {
    throw new HttpError(403, message, "forbidden");
  }
}

export async function ensureCanManageProjectMembers(
  supabaseAdmin: SupabaseAdminClient,
  caller: CallerContext,
  projectId: string,
) {
  if (caller.profile?.role === "superadmin") return "superadmin";

  const { data: membership, error } = await supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", caller.user.id)
    .maybeSingle();

  if (error) throw error;
  if (membership?.role !== "owner") {
    throw new HttpError(403, "Acesso negado. Apenas gestores do projeto podem gerenciar membros.", "forbidden");
  }

  return "owner";
}

export async function findAuthUserByEmail(supabaseAdmin: SupabaseAdminClient, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  let page = 1;

  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;

    const users = data?.users || [];
    const found = users.find((user: any) => user.email?.toLowerCase() === normalizedEmail);
    if (found) return found;
    if (users.length < 1000) return null;
    page += 1;
  }

  return null;
}

export async function getProfileForUser(supabaseAdmin: SupabaseAdminClient, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role, created_at, email")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data as { role?: string | null; created_at?: string | null; email?: string | null } | null;
}

export async function hasAnyProjectMembership(supabaseAdmin: SupabaseAdminClient, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.project_id);
}

export function getAppBaseUrl(req: Request) {
  // Browser calls should return to the same environment that sent the invite
  // request, e.g. an ngrok preview during testing.
  const origin = req.headers.get("Origin") || req.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");

  const configured = Deno.env.get("APP_BASE_URL") || Deno.env.get("SITE_URL");
  if (configured) return configured.replace(/\/$/, "");

  return "http://localhost:3000";
}

export function getInviteRedirectTo(req: Request, invitationId: string, nonce?: string) {
  const baseUrl = getAppBaseUrl(req);
  const params = new URLSearchParams({ flow: "invite", invitationId });
  if (nonce) params.set("nonce", nonce);
  return `${baseUrl}/auth/callback?${params.toString()}`;
}

function isAlreadyRegisteredError(error: unknown) {
  const message = String((error as { message?: string } | null)?.message || "").toLowerCase();
  return message.includes("already") || message.includes("registered") || message.includes("exists");
}

export async function sendInvitationEmail(params: {
  supabaseAdmin: SupabaseAdminClient;
  req: Request;
  email: string;
  invitationId: string;
  nonce?: string;
  preferInvite?: boolean;
  requireInviteTemplate?: boolean;
  data?: Record<string, unknown>;
}) {
  const {
    supabaseAdmin,
    req,
    email,
    invitationId,
    nonce,
    preferInvite = true,
    requireInviteTemplate = true,
    data = {},
  } = params;
  const redirectTo = getInviteRedirectTo(req, invitationId, nonce);

  if (preferInvite || requireInviteTemplate) {
    const { data: invited, error: inviteError } = await (supabaseAdmin.auth.admin as any)
      .inviteUserByEmail(email, {
        redirectTo,
        data: {
          ...data,
          invitation_id: invitationId,
          invitation_nonce: nonce,
        },
      });

    if (!inviteError) {
      return { userId: invited?.user?.id ?? null, delivery: "invite" };
    }

    if (requireInviteTemplate || !isAlreadyRegisteredError(inviteError)) {
      throw inviteError;
    }
  }

  const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: redirectTo,
    },
  });

  if (otpError) throw otpError;

  const existingUser = await findAuthUserByEmail(supabaseAdmin, email);
  return { userId: existingUser?.id ?? null, delivery: "magiclink" };
}

export async function markInvitationSendFailure(
  supabaseAdmin: SupabaseAdminClient,
  invitationId: string,
  error: unknown,
) {
  await supabaseAdmin
    .from("user_invitations")
    .update({
      status: "cancelled",
      metadata: {
        send_error: error instanceof Error ? error.message : String(error),
      },
    })
    .eq("id", invitationId);
}
