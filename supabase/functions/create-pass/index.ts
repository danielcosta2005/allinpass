// supabase/functions/create-pass/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_APP_URL = Deno.env.get("PUBLIC_APP_URL") || ""; // ex: https://app.suaempresa.com

const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function base62Random(len = 8): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function reserveShortCode(tries = 10) {
  for (let i = 0; i < tries; i++) {
    const code = base62Random(8);
    const { data } = await sbAdmin
      .from("passes")
      .select("id")
      .eq("short_code", code)
      .maybeSingle();
    if (!data) return code;
  }
  return base62Random(12);
}

function isObj(v: any) {
  return v && typeof v === "object" && !Array.isArray(v);
}

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

function normalizeLocationIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const unique = new Set<string>();

  for (const raw of input) {
    const rawId =
      typeof raw === "string" || typeof raw === "number"
        ? raw
        : isObj(raw)
          ? raw.id ?? raw.location_id
          : null;

    const id = String(rawId ?? "").trim();
    if (!id) continue;
    unique.add(id);
  }

  return [...unique];
}

function resolveLocationIdsFromBody(body: any): unknown {
  if (body?.location_ids !== undefined) return body.location_ids;
  if (body?.pass_data?.location_ids !== undefined) return body.pass_data.location_ids;
  if (body?.locationIds !== undefined) return body.locationIds;
  if (body?.passData?.location_ids !== undefined) return body.passData.location_ids;
  if (body?.passData?.locationIds !== undefined) return body.passData.locationIds;
  return [];
}

function normalizeDefaults(input: any): any {
  if (!input) return {};
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return isObj(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isObj(input) ? input : {};
}

function toCleanText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim();
}

async function getProjectTemplateDefaults(projectId: string) {
  const { data, error } = await sbAdmin
    .from("wallet_templates")
    .select("defaults")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(`Erro ao buscar wallet_templates: ${error.message}`);
  return normalizeDefaults(data?.defaults);
}

/**
 * Resolve app public base (where /claim/:c exists).
 * Priority:
 * - body.app_base_url
 * - Origin header
 * - PUBLIC_APP_URL env
 */
function resolveAppBaseUrl(req: Request, body: any) {
  const fromBody =
    typeof body?.app_base_url === "string" ? body.app_base_url.trim() : "";
  const fromOrigin = (req.headers.get("Origin") || "").trim();
  const base = fromBody || fromOrigin || PUBLIC_APP_URL;

  if (!base) {
    throw new Error(
      "Missing app base url (send body.app_base_url or set PUBLIC_APP_URL)."
    );
  }
  return base.replace(/\/$/, "");
}

serve(async (req) => {
  const origin = req.headers.get("Origin") || "*";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    const body = await req.json().catch(() => ({}));

    const projectId =
      typeof body.project_id === "string" ? body.project_id.trim() : body.project_id;
    if (!projectId) {
      throw new HttpError(400, {
        ok: false,
        error: "bad_request",
        message: "project_id is required",
      });
    }

    const templateDefaults = await getProjectTemplateDefaults(projectId);

    const type = (body.type ?? templateDefaults.type ?? "loyalty")
      .toString()
      .toLowerCase();
    const title =
      toCleanText(body.title) ||
      toCleanText(templateDefaults.title) ||
      "Cartao Fidelidade";
    const description =
      toCleanText(body.description) ||
      toCleanText(templateDefaults.description) ||
      "Ganhe premios acumulando pontos!";

    const fields = body.fields ?? templateDefaults.fields ?? {};
    const design = {
      colors: { ...(templateDefaults.colors ?? {}), ...(body.colors ?? {}) },
      images: { ...(templateDefaults.images ?? {}), ...(body.images ?? {}) },
    };

    const requestedLocationIds = normalizeLocationIds(resolveLocationIdsFromBody(body));
    let validLocationIds: string[] = [];

    if (requestedLocationIds.length > 0) {
      const { data: validLocations, error: validLocationsError } = await sbAdmin
        .from("locations")
        .select("id")
        .eq("project_id", projectId)
        .in("id", requestedLocationIds);

      if (validLocationsError) {
        throw new Error(`Erro ao validar localizacoes: ${validLocationsError.message}`);
      }

      validLocationIds = (validLocations ?? []).map((row: any) => String(row.id));
      const validSet = new Set(validLocationIds);
      const invalidIds = requestedLocationIds.filter((id) => !validSet.has(id));

      if (invalidIds.length > 0) {
        throw new HttpError(400, {
          ok: false,
          error: "invalid_location_ids",
          message: "Uma ou mais localizacoes nao pertencem ao projeto informado.",
          invalid_ids: invalidIds,
        });
      }
    }

    const id = crypto.randomUUID();
    const serialNumber = id;
    const short_code = await reserveShortCode();

    // universal link is derived and not persisted
    const universal_url = `${SUPABASE_URL}/functions/v1/universal-link?c=${encodeURIComponent(
      short_code
    )}`;

    // single shareable link persisted in qr_url
    const appBaseUrl = resolveAppBaseUrl(req, body);
    const qrDescriptionParam = description
      ? `?description=${encodeURIComponent(description)}`
      : "";
    const qr_url = `${appBaseUrl}/claim/${encodeURIComponent(short_code)}${qrDescriptionParam}`;

    const { error: insertError } = await sbAdmin.from("passes").insert({
      id,
      project_id: projectId,
      serial_number: serialNumber,
      type,
      title,
      description,
      fields,
      design,
      short_code,
      qr_url,
      status: "ativo",
    });

    if (insertError) throw new Error(`Erro ao inserir passe: ${insertError.message}`);

    if (validLocationIds.length > 0) {
      const passLocationRows = validLocationIds.map((locationId) => ({
        pass_id: id,
        location_id: locationId,
        project_id: projectId,
      }));

      const { error: passLocationError } = await sbAdmin
        .from("pass_locations")
        .insert(passLocationRows);

      if (passLocationError) {
        await sbAdmin
          .from("passes")
          .delete()
          .eq("id", id)
          .eq("project_id", projectId);
        throw new Error(`Erro ao associar localizacoes ao passe: ${passLocationError.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        id,
        project_id: projectId,
        short_code,
        location_ids: validLocationIds,
        qr_url,
        universal_url,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      }
    );
  } catch (err: any) {
    const isHttpError = err instanceof HttpError;
    const status = isHttpError ? err.status : 500;
    const message = err?.message ?? "Internal error";
    const payload = isHttpError
      ? err.payload
      : {
          ok: false,
          error: "internal_error",
          message,
        };

    if (status >= 500) {
      console.error("[create-pass] ERROR:", message);
    }

    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }
});
