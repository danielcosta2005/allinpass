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
 * Resolve base pública do app (onde existe /claim/:c).
 * Prioridade:
 * - body.app_base_url (explícito)
 * - header Origin (quem chamou)
 * - env PUBLIC_APP_URL
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
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders(req.headers.get("Origin") || "*"),
    });
  }

  try {
    const origin = req.headers.get("Origin") || "*";
    const body = await req.json().catch(() => ({}));

    const projectId = body.project_id;
    if (!projectId) throw new Error("project_id is required");

    const templateDefaults = await getProjectTemplateDefaults(projectId);

    const type = (body.type ?? templateDefaults.type ?? "loyalty")
      .toString()
      .toLowerCase();
    const title = body.title ?? templateDefaults.title ?? "Cartão Fidelidade";
    const description =
      body.description ??
      templateDefaults.description ??
      "Ganhe prêmios acumulando pontos!";

    const fields = body.fields ?? templateDefaults.fields ?? {};
    const design = {
      colors: { ...(templateDefaults.colors ?? {}), ...(body.colors ?? {}) },
      images: { ...(templateDefaults.images ?? {}), ...(body.images ?? {}) },
    };
    const locationIds = normalizeLocationIds(body.location_ids);

    const id = crypto.randomUUID();
    const serialNumber = id;
    const short_code = await reserveShortCode();

    // ✅ universal-link é derivado (não precisa persistir)
    const universal_url = `${SUPABASE_URL}/functions/v1/universal-link?c=${encodeURIComponent(
      short_code
    )}`;

    // ✅ link compartilhável ESSENCIAL (persistido em qr_url)
    const appBaseUrl = resolveAppBaseUrl(req, body);
    const qr_url = `${appBaseUrl}/claim/${encodeURIComponent(short_code)}`;

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

      // ✅ ESSENCIAL: um único link público
      qr_url,

      status: "ativo",
    });

    if (insertError) throw new Error(`Erro ao inserir passe: ${insertError.message}`);

    if (locationIds.length > 0) {
      const { data: validLocations, error: validLocationsError } = await sbAdmin
        .from("locations")
        .select("id")
        .eq("project_id", projectId)
        .in("id", locationIds);

      if (validLocationsError) {
        throw new Error(`Erro ao validar localizações: ${validLocationsError.message}`);
      }

      const validIds = (validLocations ?? []).map((row: any) => String(row.id));
      if (validIds.length > 0) {
        const passLocationRows = validIds.map((locationId) => ({
          pass_id: id,
          location_id: locationId,
          project_id: projectId,
        }));

        const { error: passLocationError } = await sbAdmin
          .from("pass_locations")
          .insert(passLocationRows);

        if (passLocationError) {
          throw new Error(`Erro ao associar localizações ao passe: ${passLocationError.message}`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        id,
        project_id: projectId,
        short_code,

        // ✅ Único link compartilhável (público)
        qr_url,

        // ✅ retornamos por conveniência/debug (não persistimos)
        universal_url,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      }
    );
  } catch (err: any) {
    console.error("[create-pass] ERROR:", err?.message ?? err);
    return new Response(JSON.stringify({ error: err?.message ?? "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders("*") },
    });
  }
});
