import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FUNCTION_NAME = "claim-preview";
const DEFAULT_CLAIM_TITLE = "Resgate seu Cartão de Benefícios";
const SHORT_CODE_REGEX = /^[0-9A-Za-z]{6,32}$/;
const RATE_LIMIT_WINDOW_SECONDS = 600;
const RATE_LIMIT_MAX_ATTEMPTS = 300;
const RATE_LIMIT_BLOCK_MINUTES = 20;

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(
  origin: string | null,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      ...extraHeaders,
      "Content-Type": "application/json",
    },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function getClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const candidate = forwarded.split(",")[0]?.trim();
    if (candidate) return candidate;
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();

  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  if (cfConnectingIp?.trim()) return cfConnectingIp.trim();

  return "unknown";
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeStatus(value: unknown) {
  return cleanString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isUnavailableStatus(status: unknown) {
  const normalized = normalizeStatus(status);
  return new Set(["excluido", "deleted", "inactive", "inativo", "revoked"]).has(normalized);
}

function unavailableResponse(origin: string | null) {
  return jsonResponse(
    origin,
    {
      ok: false,
      error: "pass_unavailable",
      message: "Este link de carteira não está mais disponível.",
    },
    410,
  );
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "GET") {
    return jsonResponse(
      origin,
      { ok: false, error: "method_not_allowed", message: "Método não permitido." },
      405,
    );
  }

  try {
    const url = new URL(req.url);
    const shortCode = cleanString(url.searchParams.get("c"));

    if (!shortCode || !SHORT_CODE_REGEX.test(shortCode)) {
      return jsonResponse(
        origin,
        { ok: false, error: "invalid_short_code", message: "Link inválido." },
        400,
      );
    }

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const hashSalt = Deno.env.get("CLAIM_PREVIEW_HASH_SALT") ?? "claim-preview-default-salt";
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const clientIp = getClientIp(req);
    const ipHash = await sha256Hex(`${hashSalt}:ip:${clientIp}`);
    const keyHash = await sha256Hex(`${hashSalt}:key:${ipHash}`);

    const { data: rateData, error: rateError } = await supabaseAdmin.rpc(
      "consume_claim_preview_rate_limit",
      {
        p_key_hash: keyHash,
        p_ip_hash: ipHash,
        p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
        p_max_attempts: RATE_LIMIT_MAX_ATTEMPTS,
        p_block_minutes: RATE_LIMIT_BLOCK_MINUTES,
      },
    );

    if (rateError) throw rateError;

    const rateRow = Array.isArray(rateData) ? rateData[0] : null;
    const allowedByRateLimit = Boolean(rateRow?.allowed);
    const retryAfterSeconds = Math.max(0, Number(rateRow?.retry_after_seconds ?? 0));

    if (!allowedByRateLimit) {
      return jsonResponse(
        origin,
        {
          ok: false,
          error: "rate_limited",
          message: "Muitas tentativas. Tente novamente em instantes.",
          retry_after_seconds: retryAfterSeconds,
        },
        429,
        { "Retry-After": String(Math.max(1, retryAfterSeconds)) },
      );
    }

    const { data: pass, error: passError } = await supabaseAdmin
      .from("passes")
      .select("project_id, status, deleted_at, short_code_expires_at")
      .eq("short_code", shortCode)
      .maybeSingle();

    if (passError) throw passError;

    if (!pass) {
      return jsonResponse(
        origin,
        { ok: false, error: "not_found", message: "Nenhum passe foi encontrado para este link." },
        404,
      );
    }

    if (pass.deleted_at || isUnavailableStatus(pass.status)) {
      return unavailableResponse(origin);
    }

    if (pass.short_code_expires_at) {
      const expiresAt = new Date(pass.short_code_expires_at).getTime();
      if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
        return unavailableResponse(origin);
      }
    }

    const { data: project, error: projectError } = await supabaseAdmin
      .from("projects")
      .select("name")
      .eq("id", pass.project_id)
      .maybeSingle();

    if (projectError) throw projectError;

    const projectName = cleanString(project?.name);
    const claimTitle = projectName
      ? `${DEFAULT_CLAIM_TITLE} ${projectName}`
      : DEFAULT_CLAIM_TITLE;

    return jsonResponse(
      origin,
      {
        ok: true,
        project_name: projectName,
        claim_title: claimTitle,
      },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] ERROR`, error);
    return jsonResponse(
      origin,
      {
        ok: false,
        error: "internal_error",
        message: "Não foi possível carregar este link.",
      },
      500,
    );
  }
});
