// supabase/functions/update-pass/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PUSH_CONCURRENCY = 10;

class HttpError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : "Request failed.";
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

    if (projectError) throw new Error(`Erro ao validar projeto: ${projectError.message}`);
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
        "Funcionários podem apenas visualizar passes. Peça a um gestor para editar cartões.",
      ),
    });
  }

  throw new HttpError(403, {
    ...errorPayload(
      "forbidden",
      "Você não tem permissão para editar passes neste projeto.",
    ),
  });
}

function normalizeLocationIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const unique = new Set<string>();

  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id) continue;
    unique.add(id);
  }

  return [...unique];
}

async function callPush(
  functionName: "apple-push" | "google-push",
  passToken: string,
) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pass_token: passToken }),
  });

  const payload = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function invalidatePkpassCache(
  sbAdmin: any,
  passId: string,
  passToken: string,
) {
  const pkPath = `issued_users/${passId}/${passToken}.pkpass`;
  const { error } = await sbAdmin.storage.from("pass-assets").remove([pkPath]);
  if (error) {
    throw new Error(`Falha ao invalidar cache Apple (${pkPath}): ${error.message}`);
  }
}

serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "*";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse(
        {
          ...errorPayload("method_not_allowed", "Use POST."),
        },
        405,
        origin,
      );
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return jsonResponse(
        {
          ...errorPayload(
            "missing_env",
            "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.",
          ),
        },
        500,
        origin,
      );
    }

    const body = await req.json().catch(() => ({}));
    const passData = isObject(body?.pass_data) ? body.pass_data : {};

    const projectId =
      cleanString(body?.project_id) ??
      cleanString(passData?.project_id);

    const passId =
      cleanString(body?.pass_id) ??
      cleanString(passData?.pass_id) ??
      cleanString(passData?.id);

    if (!projectId || !passId) {
      return jsonResponse(
        {
          ...errorPayload("bad_request", "project_id e pass_id são obrigatórios."),
        },
        400,
        origin,
      );
    }

    const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const caller = await getCallerProfile(sbAdmin, req);
    await ensureCanManageProject(sbAdmin, projectId, caller);

    const { data: existingPass, error: passLookupError } = await sbAdmin
      .from("passes")
      .select("id, project_id, type, title, description, fields, design, status, deleted_at")
      .eq("id", passId)
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .maybeSingle();

    if (passLookupError) {
      throw new Error(`Erro ao buscar passe: ${passLookupError.message}`);
    }

    if (!existingPass) {
      return jsonResponse(
        {
          ...errorPayload("not_found", "Passe não encontrado para este projeto."),
        },
        404,
        origin,
      );
    }

    const updatePayload: Record<string, unknown> = {};

    const type = cleanString(passData?.type) ?? cleanString(body?.type);
    const title = cleanString(passData?.title) ?? cleanString(body?.title);
    const description = cleanString(passData?.description) ?? cleanString(body?.description);

    if (type) updatePayload.type = type.toLowerCase();
    if (title) updatePayload.title = title;
    if (description) updatePayload.description = description;

    const incomingFields = isObject(passData?.fields)
      ? passData.fields
      : isObject(body?.fields)
        ? body.fields
        : {};

    const existingFields = isObject(existingPass.fields) ? existingPass.fields : {};
    const mergedFields = {
      ...existingFields,
      ...incomingFields,
    };

    const expDate = cleanString(passData?.exp_date) ?? cleanString(body?.exp_date);
    if (expDate) {
      mergedFields.exp_date = expDate;
    }

    updatePayload.fields = mergedFields;

    const incomingDesign = isObject(passData?.design)
      ? passData.design
      : isObject(body?.design)
        ? body.design
        : {};

    const existingDesign = isObject(existingPass.design) ? existingPass.design : {};
    const incomingColors = isObject(passData?.colors)
      ? passData.colors
      : isObject(incomingDesign?.colors)
        ? incomingDesign.colors
        : {};
    const incomingImages = isObject(passData?.images)
      ? passData.images
      : isObject(incomingDesign?.images)
        ? incomingDesign.images
        : {};

    const mergedDesign = {
      ...existingDesign,
      ...incomingDesign,
      colors: {
        ...(isObject(existingDesign.colors) ? existingDesign.colors : {}),
        ...incomingColors,
      },
      images: {
        ...(isObject(existingDesign.images) ? existingDesign.images : {}),
        ...incomingImages,
      },
    };

    updatePayload.design = mergedDesign;

    const hasLocationPayload =
      body?.location_ids !== undefined ||
      passData?.location_ids !== undefined;

    const requestedLocationIds = normalizeLocationIds(
      body?.location_ids ?? passData?.location_ids,
    );

    let validLocationIds: string[] = [];

    if (hasLocationPayload) {
      if (requestedLocationIds.length > 0) {
        const { data: validLocations, error: validLocationsError } = await sbAdmin
          .from("locations")
          .select("id")
          .eq("project_id", projectId)
          .in("id", requestedLocationIds);

        if (validLocationsError) {
          throw new Error(`Erro ao validar localizações: ${validLocationsError.message}`);
        }

        validLocationIds = (validLocations ?? []).map((row: any) => String(row.id));
        const validSet = new Set(validLocationIds);
        const invalidIds = requestedLocationIds.filter((id) => !validSet.has(id));

        if (invalidIds.length > 0) {
          return jsonResponse(
            {
              ...errorPayload(
                "invalid_location_ids",
                "Uma ou mais localizações não pertencem ao projeto informado.",
              ),
              invalid_ids: invalidIds,
            },
            400,
            origin,
          );
        }
      }
    }

    const { data: updatedPass, error: updateError } = await sbAdmin
      .from("passes")
      .update(updatePayload)
      .eq("id", passId)
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .select("id, project_id, type, title, description, status, fields, design, qr_url, created_at")
      .single();

    if (updateError) {
      throw new Error(`Erro ao atualizar passe: ${updateError.message}`);
    }

    if (hasLocationPayload) {

      const { error: deleteMappingsError } = await sbAdmin
        .from("pass_locations")
        .delete()
        .eq("project_id", projectId)
        .eq("pass_id", passId);

      if (deleteMappingsError) {
        throw new Error(`Erro ao limpar localizações antigas do passe: ${deleteMappingsError.message}`);
      }

      if (validLocationIds.length > 0) {
        const mappingRows = validLocationIds.map((locationId) => ({
          project_id: projectId,
          pass_id: passId,
          location_id: locationId,
        }));

        const { error: insertMappingsError } = await sbAdmin
          .from("pass_locations")
          .insert(mappingRows);

        if (insertMappingsError) {
          throw new Error(`Erro ao salvar localizações do passe: ${insertMappingsError.message}`);
        }
      }
    }

    const { data: userPassRows, error: userPassesError } = await sbAdmin
      .from("user_passes")
      .select("pass_token, install_status, install_platform")
      .eq("pass_id", passId);

    if (userPassesError) {
      throw new Error(`Erro ao buscar user_passes do passe: ${userPassesError.message}`);
    }

    const installedRows = (userPassRows ?? []).filter((row: any) => {
      const status = cleanString(row.install_status)?.toLowerCase();
      return status === "installed";
    });

    const openedAppleRows = (userPassRows ?? []).filter((row: any) => {
      const status = cleanString(row.install_status)?.toLowerCase();
      const platform = cleanString(row.install_platform)?.toLowerCase();
      // During claim flow, Apple rows may still be "opened" without install_platform.
      return status === "opened" && platform !== "google";
    });

    const openedAppleTokens = [...new Set(
      openedAppleRows
        .map((row: any) => cleanString(row.pass_token))
        .filter(Boolean) as string[],
    )];

    const appleTokens = [...new Set(
      installedRows
        .filter((row: any) => cleanString(row.install_platform)?.toLowerCase() === "apple")
        .map((row: any) => cleanString(row.pass_token))
        .filter(Boolean) as string[],
    )];

    const googleTokens = [...new Set(
      installedRows
        .filter((row: any) => cleanString(row.install_platform)?.toLowerCase() === "google")
        .map((row: any) => cleanString(row.pass_token))
        .filter(Boolean) as string[],
    )];

    let appleSuccess = 0;
    let appleFailed = 0;
    let googleSuccess = 0;
    let googleFailed = 0;

    for (let i = 0; i < appleTokens.length; i += PUSH_CONCURRENCY) {
      const chunk = appleTokens.slice(i, i + PUSH_CONCURRENCY);
      const results = await Promise.all(
        chunk.map((token) => callPush("apple-push", token)),
      );

      for (const result of results) {
        if (result.ok) appleSuccess += 1;
        else appleFailed += 1;
      }
    }

    let appleCacheInvalidated = 0;
    let appleCacheInvalidationFailed = 0;
    for (let i = 0; i < openedAppleTokens.length; i += PUSH_CONCURRENCY) {
      const chunk = openedAppleTokens.slice(i, i + PUSH_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (token) => {
          try {
            await invalidatePkpassCache(sbAdmin, passId, token);
            return { ok: true };
          } catch (error) {
            console.error("[update-pass] pkpass cache invalidation failed", {
              passId,
              tokenPrefix: token.slice(0, 8),
              message: String((error as any)?.message ?? error),
            });
            return { ok: false };
          }
        }),
      );

      for (const result of results) {
        if (result.ok) appleCacheInvalidated += 1;
        else appleCacheInvalidationFailed += 1;
      }
    }

    for (let i = 0; i < googleTokens.length; i += PUSH_CONCURRENCY) {
      const chunk = googleTokens.slice(i, i + PUSH_CONCURRENCY);
      const results = await Promise.all(
        chunk.map((token) => callPush("google-push", token)),
      );

      for (const result of results) {
        if (result.ok) googleSuccess += 1;
        else googleFailed += 1;
      }
    }

    return jsonResponse(
      {
        ok: true,
        pass: updatedPass,
        pushes: {
          total_tokens: appleTokens.length + googleTokens.length,
          apple: { success: appleSuccess, failed: appleFailed },
          google: { success: googleSuccess, failed: googleFailed },
        },
        cache_invalidation: {
          apple_opened_tokens: openedAppleTokens.length,
          apple_pkpass_invalidated: appleCacheInvalidated,
          apple_pkpass_invalidation_failed: appleCacheInvalidationFailed,
        },
      },
      200,
      origin,
    );
  } catch (error: any) {
    console.error("[update-pass] ERROR:", error);
    const isHttpError = error instanceof HttpError;
    return jsonResponse(
      isHttpError
        ? error.payload
        : {
            ...errorPayload(
              "internal_error",
              "Não foi possível atualizar o passe. Tente novamente.",
            ),
          },
      isHttpError ? error.status : 500,
      origin,
    );
  }
});
