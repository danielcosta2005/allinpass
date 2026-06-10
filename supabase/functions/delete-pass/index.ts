import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

class HttpError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : "Falha na requisição.";
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(body: unknown, status: number, origin = "*") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function errorPayload(
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return {
    ok: false,
    error,
    message,
    ...extra,
  };
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function getCallerProfile(sbAdmin: any, req: Request) {
  const token = getBearerToken(req);
  if (!token) {
    throw new HttpError(401, {
      ...errorPayload(
        "unauthorized",
        "Sessão não encontrada. Faça login novamente.",
      ),
    });
  }

  const { data: userData, error: userError } = await sbAdmin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) {
    throw new HttpError(401, {
      ...errorPayload("unauthorized", "Sessão inválida. Faça login novamente."),
    });
  }

  const { data: profile, error: profileError } = await sbAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Erro ao buscar perfil: ${profileError.message}`);
  }

  return { user, profile };
}

async function ensureCanManageProject(sbAdmin: any, projectId: string, caller: any) {
  if (caller.profile?.role === "superadmin") return;

  if (caller.profile?.role === "admin") {
    const { data: project, error: projectError } = await sbAdmin
      .from("projects")
      .select("created_by")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) {
      throw new Error(`Erro ao validar projeto: ${projectError.message}`);
    }
    if (project?.created_by === caller.user.id) return;
  }

  const { data: membership, error: membershipError } = await sbAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", caller.user.id)
    .maybeSingle();

  if (membershipError) {
    throw new Error(`Erro ao validar membro do projeto: ${membershipError.message}`);
  }

  if (membership?.role === "owner") return;

  if (membership?.role === "staff") {
    throw new HttpError(403, {
      ...errorPayload(
        "forbidden",
        "Funcionários podem apenas visualizar passes. Peça a um gestor para excluir cartões.",
      ),
    });
  }

  throw new HttpError(403, {
    ...errorPayload(
      "forbidden",
      "Você não tem permissão para excluir passes neste projeto.",
    ),
  });
}

serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "*";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse(
        errorPayload("method_not_allowed", "Use POST."),
        405,
        origin,
      );
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return jsonResponse(
        errorPayload(
          "missing_env",
          "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.",
        ),
        500,
        origin,
      );
    }

    const body = await req.json().catch(() => ({}));
    const projectId = cleanString(body?.project_id);
    const passId = cleanString(body?.pass_id);

    if (!projectId || !passId) {
      return jsonResponse(
        errorPayload("bad_request", "project_id e pass_id são obrigatórios."),
        400,
        origin,
      );
    }

    const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const caller = await getCallerProfile(sbAdmin, req);
    await ensureCanManageProject(sbAdmin, projectId, caller);

    const { data: existingPass, error: lookupError } = await sbAdmin
      .from("passes")
      .select("id, project_id, status, deleted_at")
      .eq("id", passId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (lookupError) {
      throw new Error(`Erro ao buscar passe: ${lookupError.message}`);
    }

    if (!existingPass) {
      return jsonResponse(
        errorPayload("not_found", "Passe não encontrado para este projeto."),
        404,
        origin,
      );
    }

    if (existingPass.deleted_at) {
      return jsonResponse(
        {
          ok: true,
          pass: existingPass,
        },
        200,
        origin,
      );
    }

    const deletedAt = new Date().toISOString();
    const { data: deletedPass, error: updateError } = await sbAdmin
      .from("passes")
      .update({
        status: "excluido",
        deleted_at: deletedAt,
        deleted_by: caller.user.id,
        short_code_expires_at: deletedAt,
      })
      .eq("id", passId)
      .eq("project_id", projectId)
      .select("id, project_id, status, deleted_at")
      .single();

    if (updateError) {
      throw new Error(`Erro ao excluir passe: ${updateError.message}`);
    }

    return jsonResponse(
      {
        ok: true,
        pass: deletedPass,
      },
      200,
      origin,
    );
  } catch (error: any) {
    const isHttpError = error instanceof HttpError;
    const status = isHttpError ? error.status : 500;

    if (status >= 500) {
      console.error("[delete-pass] ERROR:", error);
    }

    return jsonResponse(
      isHttpError
        ? error.payload
        : errorPayload(
            "internal_error",
            "Não foi possível excluir o passe. Tente novamente.",
          ),
      status,
      origin,
    );
  }
});
