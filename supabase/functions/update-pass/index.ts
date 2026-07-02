// supabase/functions/update-pass/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assertProjectBillingActive,
  getProjectBillingInactivePayload,
  isProjectBillingInactiveError,
} from "../_shared/billingAccess.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const JOB_INSERT_CHUNK_SIZE = 500;
const VALID_PASS_TYPES = new Set(["loyalty", "value"]);

class HttpError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    const message = typeof payload?.message === "string"
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

function normalizePassType(input: unknown): string | null {
  const value = cleanString(input)?.toLowerCase();
  if (!value) return null;
  return VALID_PASS_TYPES.has(value) ? value : null;
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

  const { data: userData, error: userError } = await sbAdmin.auth.getUser(
    token,
  );
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

async function ensureCanManageProject(
  sbAdmin: any,
  projectId: string,
  caller: any,
) {
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
    throw new Error(
      `Erro ao validar membro do projeto: ${membershipError.message}`,
    );
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

function isPassScopedGoogleClassId(classId: string | null, passId: string) {
  if (!classId) return false;
  return classId.includes(`_pass_${passId}_`);
}

function isGoogleObjectPatchRequiredForGlobalEdit(args: {
  passType: string | null;
  incomingFields: Record<string, any>;
  expDate: string | null;
}) {
  const passType = args.passType?.toLowerCase() ?? "";
  const loyaltyLikePass = passType === "loyalty" || passType === "value";

  // Non-loyalty Google passes keep their visible title/header on the Object.
  // Loyalty-like passes can usually rely on the Class for global visual/brand edits,
  // but field/date edits still need Object patches because they render per pass.
  if (passType && !loyaltyLikePass) return true;
  if (args.expDate) return true;
  return Object.keys(args.incomingFields ?? {}).length > 0;
}

async function insertRowsInChunks(sbAdmin: any, table: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += JOB_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + JOB_INSERT_CHUNK_SIZE);
    const { error } = await sbAdmin.from(table).insert(chunk);
    if (error) throw new Error(`Erro ao inserir ${table}: ${error.message}`);
  }
}

async function createPassUpdateCampaign(args: {
  sbAdmin: any;
  projectId: string;
  passId: string;
  revision: number;
  userId: string;
  userPassRows: any[];
  passType: string | null;
  incomingFields: Record<string, any>;
  expDate: string | null;
}) {
  const {
    sbAdmin,
    projectId,
    passId,
    revision,
    userId,
    userPassRows,
    passType,
    incomingFields,
    expDate,
  } = args;

  const installedRows = (userPassRows ?? []).filter((row: any) => {
    const status = cleanString(row.install_status)?.toLowerCase();
    return status === "installed";
  });

  const appleRows = installedRows.filter((row: any) =>
    cleanString(row.install_platform)?.toLowerCase() === "apple"
  );

  const googleRows = installedRows.filter((row: any) =>
    cleanString(row.install_platform)?.toLowerCase() === "google"
  );

  const requiresGoogleObjectPatch = isGoogleObjectPatchRequiredForGlobalEdit({
    passType,
    incomingFields,
    expDate,
  });

  const passScopedClassIds = [
    ...new Set(
      googleRows
        .map((row: any) => cleanString(row.google_class_id))
        .filter((classId: string | null) =>
          isPassScopedGoogleClassId(classId, passId)
        ) as string[],
    ),
  ];

  const googleObjectRows = googleRows.filter((row: any) => {
    const classId = cleanString(row.google_class_id);
    const hasPassScopedClass = isPassScopedGoogleClassId(classId, passId);
    const hasObject = !!cleanString(row.google_object_id);

    if (!hasObject) return false;
    if (!hasPassScopedClass) return true;
    return requiresGoogleObjectPatch;
  });

  const { data: campaign, error: campaignError } = await sbAdmin
    .from("pass_update_campaigns")
    .insert({
      project_id: projectId,
      pass_id: passId,
      revision,
      status: "pending",
      created_by: userId,
      metadata: {
        source: "update-pass",
        apple_installed: appleRows.length,
        google_installed: googleRows.length,
        google_class_jobs: passScopedClassIds.length,
        google_object_jobs: googleObjectRows.length,
        google_object_patch_required: requiresGoogleObjectPatch,
      },
    })
    .select("id, status")
    .single();

  if (campaignError) {
    throw new Error(
      `Erro ao criar campanha de atualizacao: ${campaignError.message}`,
    );
  }

  const campaignId = String(campaign.id);
  const jobs: any[] = [];

  for (const row of appleRows) {
    const token = cleanString(row.pass_token);
    if (!token) continue;
    jobs.push({
      campaign_id: campaignId,
      project_id: projectId,
      pass_id: passId,
      user_pass_id: row.id,
      platform: "apple",
      job_type: "apple_push",
      target_token: token,
      priority: 100,
      idempotency_key: `${campaignId}:apple:${token}`,
      data: {
        revision,
        pass_token: token,
      },
    });
  }

  for (const classId of passScopedClassIds) {
    jobs.push({
      campaign_id: campaignId,
      project_id: projectId,
      pass_id: passId,
      platform: "google",
      job_type: "google_class_patch",
      google_class_id: classId,
      priority: 20,
      idempotency_key: `${campaignId}:google-class:${classId}`,
      data: {
        revision,
        google_class_id: classId,
      },
    });
  }

  for (const row of googleObjectRows) {
    const token = cleanString(row.pass_token);
    if (!token) continue;
    const classId = cleanString(row.google_class_id);
    const hasPassScopedClass = isPassScopedGoogleClassId(classId, passId);
    jobs.push({
      campaign_id: campaignId,
      project_id: projectId,
      pass_id: passId,
      user_pass_id: row.id,
      platform: "google",
      job_type: "google_object_patch",
      target_token: token,
      google_class_id: classId,
      priority: 100,
      idempotency_key: `${campaignId}:google-object:${token}`,
      data: {
        revision,
        pass_token: token,
        google_object_id: cleanString(row.google_object_id),
        google_class_id: classId,
        include_object_global_fields: !hasPassScopedClass,
      },
    });
  }

  if (jobs.length > 0) {
    await insertRowsInChunks(sbAdmin, "pass_update_jobs", jobs);
  }

  const nextStatus = jobs.length > 0 ? "processing" : "completed";
  const { error: updateCampaignError } = await sbAdmin
    .from("pass_update_campaigns")
    .update({
      status: nextStatus,
      total_jobs: jobs.length,
      completed_at: jobs.length > 0 ? null : new Date().toISOString(),
    })
    .eq("id", campaignId);

  if (updateCampaignError) {
    throw new Error(
      `Erro ao atualizar campanha de atualizacao: ${updateCampaignError.message}`,
    );
  }

  return {
    id: campaignId,
    status: nextStatus,
    total_jobs: jobs.length,
    apple_jobs: appleRows.length,
    google_class_jobs: passScopedClassIds.length,
    google_object_jobs: googleObjectRows.length,
    google_object_patch_required: requiresGoogleObjectPatch,
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

    const projectId = cleanString(body?.project_id) ??
      cleanString(passData?.project_id);

    const passId = cleanString(body?.pass_id) ??
      cleanString(passData?.pass_id) ??
      cleanString(passData?.id);

    if (!projectId || !passId) {
      return jsonResponse(
        {
          ...errorPayload(
            "bad_request",
            "project_id e pass_id são obrigatórios.",
          ),
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
      .select(
        "id, project_id, type, title, description, fields, design, status, deleted_at, wallet_revision",
      )
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
          ...errorPayload(
            "not_found",
            "Passe não encontrado para este projeto.",
          ),
        },
        404,
        origin,
      );
    }

    await assertProjectBillingActive(sbAdmin, projectId);

    const updatePayload: Record<string, unknown> = {};

    const type = cleanString(passData?.type) ?? cleanString(body?.type);
    const title = cleanString(passData?.title) ?? cleanString(body?.title);
    const description = cleanString(passData?.description) ??
      cleanString(body?.description);

    if (type) {
      const normalizedType = normalizePassType(type);
      if (!normalizedType) {
        return jsonResponse(
          {
            ...errorPayload(
              "bad_request",
              "Tipo de passe inválido. Use Fidelidade ou Valor.",
            ),
          },
          400,
          origin,
        );
      }

      const existingType = cleanString(existingPass.type)?.toLowerCase() ??
        "loyalty";
      if (normalizedType !== existingType) {
        const { data: issuedRows, error: issuedLookupError } = await sbAdmin
          .from("user_passes")
          .select("id")
          .eq("pass_id", passId)
          .limit(1);

        if (issuedLookupError) {
          throw new Error(
            `Erro ao validar emissões do passe: ${issuedLookupError.message}`,
          );
        }

        if ((issuedRows ?? []).length > 0) {
          return jsonResponse(
            {
              ...errorPayload(
                "pass_type_locked",
                "Não é possível alterar o tipo de um cartão que já foi emitido.",
              ),
            },
            409,
            origin,
          );
        }
      }

      updatePayload.type = normalizedType;
    }
    if (title) updatePayload.title = title;
    if (description) updatePayload.description = description;

    const incomingFields = isObject(passData?.fields)
      ? passData.fields
      : isObject(body?.fields)
      ? body.fields
      : {};

    const existingFields = isObject(existingPass.fields)
      ? existingPass.fields
      : {};
    const mergedFields = {
      ...existingFields,
      ...incomingFields,
    };

    const expDate = cleanString(passData?.exp_date) ??
      cleanString(body?.exp_date);
    if (expDate) {
      mergedFields.exp_date = expDate;
    }

    updatePayload.fields = mergedFields;

    const incomingDesign = isObject(passData?.design)
      ? passData.design
      : isObject(body?.design)
      ? body.design
      : {};

    const existingDesign = isObject(existingPass.design)
      ? existingPass.design
      : {};
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
    updatePayload.wallet_revision = (Number(existingPass.wallet_revision) > 0
      ? Number(existingPass.wallet_revision)
      : 1) + 1;
    updatePayload.wallet_updated_at = new Date().toISOString();

    const hasLocationPayload = body?.location_ids !== undefined ||
      passData?.location_ids !== undefined;

    const requestedLocationIds = normalizeLocationIds(
      body?.location_ids ?? passData?.location_ids,
    );

    let validLocationIds: string[] = [];

    if (hasLocationPayload) {
      if (requestedLocationIds.length > 0) {
        const { data: validLocations, error: validLocationsError } =
          await sbAdmin
            .from("locations")
            .select("id")
            .eq("project_id", projectId)
            .in("id", requestedLocationIds);

        if (validLocationsError) {
          throw new Error(
            `Erro ao validar localizações: ${validLocationsError.message}`,
          );
        }

        validLocationIds = (validLocations ?? []).map((row: any) =>
          String(row.id)
        );
        const validSet = new Set(validLocationIds);
        const invalidIds = requestedLocationIds.filter((id) =>
          !validSet.has(id)
        );

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
      .select(
        "id, project_id, type, title, description, status, fields, design, qr_url, created_at, wallet_revision, wallet_updated_at",
      )
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
        throw new Error(
          `Erro ao limpar localizações antigas do passe: ${deleteMappingsError.message}`,
        );
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
          throw new Error(
            `Erro ao salvar localizações do passe: ${insertMappingsError.message}`,
          );
        }
      }
    }

    const { data: userPassRows, error: userPassesError } = await sbAdmin
      .from("user_passes")
      .select(
        "id, pass_token, install_status, install_platform, google_object_id, google_class_id",
      )
      .eq("pass_id", passId);

    if (userPassesError) {
      throw new Error(
        `Erro ao buscar user_passes do passe: ${userPassesError.message}`,
      );
    }

    const campaign = await createPassUpdateCampaign({
      sbAdmin,
      projectId,
      passId,
      revision: Number((updatedPass as any).wallet_revision),
      userId: caller.user.id,
      userPassRows: userPassRows ?? [],
      passType: cleanString((updatedPass as any).type),
      incomingFields,
      expDate,
    });

    return jsonResponse(
      {
        ok: true,
        pass: updatedPass,
        sync: {
          mode: "queued",
          campaign_id: campaign.id,
          status: campaign.status,
          total_jobs: campaign.total_jobs,
          apple_jobs: campaign.apple_jobs,
          google_class_jobs: campaign.google_class_jobs,
          google_object_jobs: campaign.google_object_jobs,
          google_object_patch_required: campaign.google_object_patch_required,
        },
        pushes: {
          total_tokens: campaign.apple_jobs + campaign.google_object_jobs,
          queued: campaign.total_jobs,
          apple: { queued: campaign.apple_jobs, success: 0, failed: 0 },
          google: {
            queued: campaign.google_class_jobs + campaign.google_object_jobs,
            class_jobs: campaign.google_class_jobs,
            object_jobs: campaign.google_object_jobs,
            success: 0,
            failed: 0,
          },
        },
      },
      200,
      origin,
    );
  } catch (error: any) {
    if (isProjectBillingInactiveError(error)) {
      return jsonResponse(getProjectBillingInactivePayload(error), 402, origin);
    }

    console.error("[update-pass] ERROR:", error);
    const isHttpError = error instanceof HttpError;
    return jsonResponse(
      isHttpError ? error.payload : {
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
