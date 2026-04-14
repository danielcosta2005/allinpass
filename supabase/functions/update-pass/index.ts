// supabase/functions/update-pass/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PUSH_CONCURRENCY = 10;

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

serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "*";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse(
        {
          ok: false,
          error: "method_not_allowed",
          message: "Use POST.",
        },
        405,
        origin,
      );
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return jsonResponse(
        {
          ok: false,
          error: "missing_env",
          message: "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.",
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
          ok: false,
          error: "bad_request",
          message: "project_id e pass_id são obrigatórios.",
        },
        400,
        origin,
      );
    }

    const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: existingPass, error: passLookupError } = await sbAdmin
      .from("passes")
      .select("id, project_id, type, title, description, fields, design")
      .eq("id", passId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (passLookupError) {
      throw new Error(`Erro ao buscar passe: ${passLookupError.message}`);
    }

    if (!existingPass) {
      return jsonResponse(
        {
          ok: false,
          error: "not_found",
          message: "Passe não encontrado para este projeto.",
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
              ok: false,
              error: "invalid_location_ids",
              message: "Uma ou mais localizações não pertencem ao projeto informado.",
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
      .select("id, project_id, type, title, description, fields, design, qr_url, created_at")
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
      },
      200,
      origin,
    );
  } catch (error: any) {
    console.error("[update-pass] ERROR:", error);
    return jsonResponse(
      {
        ok: false,
        error: "internal_error",
        message: String(error?.message ?? error),
      },
      500,
      origin,
    );
  }
});
