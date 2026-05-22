import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

const FUNCTION_NAME = "signup-precheck";
const GENERIC_BLOCK_MESSAGE =
  "Não foi possível iniciar o cadastro agora. Se você já possui conta, faça login ou tente novamente.";

const RATE_LIMIT_WINDOW_SECONDS = 600;
const RATE_LIMIT_MAX_ATTEMPTS = 8;
const RATE_LIMIT_BLOCK_MINUTES = 20;

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

async function verifyTurnstileToken(
  token: string,
  secret: string,
  remoteIp: string,
) {
  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  if (remoteIp && remoteIp !== "unknown") {
    formData.append("remoteip", remoteIp);
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    return { success: false, errorCodes: ["verification_unavailable"] as string[] };
  }

  const payload = await response.json().catch(() => ({}));
  return {
    success: Boolean(payload?.success),
    errorCodes: Array.isArray(payload?.["error-codes"]) ? payload["error-codes"] : [],
  };
}

function jsonResponse(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

async function writeFunctionLog(
  supabaseAdmin: ReturnType<typeof createClient>,
  level: "info" | "warn" | "error",
  meta: Record<string, unknown>,
) {
  try {
    await supabaseAdmin.from("function_logs").insert({
      function_name: FUNCTION_NAME,
      level,
      meta,
    });
  } catch (logError) {
    console.error(`${FUNCTION_NAME} log error`, logError);
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse(origin, { error: "Metodo nao permitido." }, 405);
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const captchaSecret = Deno.env.get("SIGNUP_PRECHECK_CAPTCHA_SECRET") ?? "";
    const captchaRequired = (Deno.env.get("SIGNUP_PRECHECK_CAPTCHA_REQUIRED") ?? "false") === "true";
    const hashSalt = Deno.env.get("SIGNUP_PRECHECK_HASH_SALT") ?? "signup-precheck-default-salt";
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const payload = await req.json().catch(() => ({}));
    const email = String(payload.email ?? "").trim().toLowerCase();
    const establishmentName = String(payload.establishmentName ?? "").trim();
    const captchaToken = String(payload.captchaToken ?? "").trim();

    if (!email) {
      return jsonResponse(origin, { error: "Email obrigatorio." }, 400);
    }

    const clientIp = getClientIp(req);
    const emailHash = await sha256Hex(`${hashSalt}:email:${email}`);
    const ipHash = await sha256Hex(`${hashSalt}:ip:${clientIp}`);
    const rateLimitKeyHash = await sha256Hex(`${hashSalt}:key:${ipHash}:${emailHash}`);

    const { data: rateData, error: rateError } = await supabaseAdmin.rpc(
      "consume_signup_precheck_rate_limit",
      {
        p_key_hash: rateLimitKeyHash,
        p_email_hash: emailHash,
        p_ip_hash: ipHash,
        p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
        p_max_attempts: RATE_LIMIT_MAX_ATTEMPTS,
        p_block_minutes: RATE_LIMIT_BLOCK_MINUTES,
      },
    );

    if (rateError) throw rateError;

    const rateRow = Array.isArray(rateData) ? rateData[0] : null;
    const allowedByRateLimit = Boolean(rateRow?.allowed);
    const retryAfterSeconds = Number(rateRow?.retry_after_seconds ?? 0);
    const attempts = Number(rateRow?.attempts ?? 0);

    if (!allowedByRateLimit) {
      await writeFunctionLog(supabaseAdmin, "warn", {
        request_id: requestId,
        outcome: "rate_limited",
        email_hash: emailHash,
        ip_hash: ipHash,
        attempts,
        retry_after_seconds: retryAfterSeconds,
        duration_ms: Date.now() - startedAt,
      });

      return jsonResponse(
        origin,
        {
          can_proceed: false,
          code: "signup_precheck_blocked",
          message: GENERIC_BLOCK_MESSAGE,
          retry_after_seconds: retryAfterSeconds,
        },
        429,
      );
    }

    if (captchaRequired && !captchaSecret) {
      await writeFunctionLog(supabaseAdmin, "error", {
        request_id: requestId,
        outcome: "captcha_secret_missing",
        email_hash: emailHash,
        ip_hash: ipHash,
        duration_ms: Date.now() - startedAt,
      });

      return jsonResponse(
        origin,
        {
          can_proceed: false,
          code: "signup_precheck_unavailable",
          message: GENERIC_BLOCK_MESSAGE,
        },
        503,
      );
    }

    if (captchaRequired && !captchaToken) {
      await writeFunctionLog(supabaseAdmin, "warn", {
        request_id: requestId,
        outcome: "captcha_missing",
        email_hash: emailHash,
        ip_hash: ipHash,
        attempts,
        duration_ms: Date.now() - startedAt,
      });

      return jsonResponse(
        origin,
        {
          can_proceed: false,
          code: "signup_precheck_blocked",
          message: GENERIC_BLOCK_MESSAGE,
        },
        403,
      );
    }

    if (captchaSecret && captchaToken) {
      const captcha = await verifyTurnstileToken(captchaToken, captchaSecret, clientIp);

      if (!captcha.success) {
        await writeFunctionLog(supabaseAdmin, "warn", {
          request_id: requestId,
          outcome: "captcha_failed",
          email_hash: emailHash,
          ip_hash: ipHash,
          attempts,
          captcha_error_codes: captcha.errorCodes,
          duration_ms: Date.now() - startedAt,
        });

        return jsonResponse(
          origin,
          {
            can_proceed: false,
            code: "signup_precheck_blocked",
            message: GENERIC_BLOCK_MESSAGE,
          },
          403,
        );
      }
    }

    const { data: existingAccount, error: existingAccountError } = await supabaseAdmin.rpc(
      "signup_precheck_auth_email_exists",
      { p_email: email },
    );

    if (existingAccountError) throw existingAccountError;

    const hasExistingAccount = Boolean(existingAccount);
    const normalizedEstablishmentName = normalizeText(establishmentName);

    await writeFunctionLog(supabaseAdmin, hasExistingAccount ? "warn" : "info", {
      request_id: requestId,
      outcome: hasExistingAccount ? "existing_account_detected" : "allowed",
      email_hash: emailHash,
      ip_hash: ipHash,
      attempts,
      has_establishment_name: Boolean(normalizedEstablishmentName),
      duration_ms: Date.now() - startedAt,
    });

    if (hasExistingAccount) {
      return jsonResponse(origin, {
        can_proceed: false,
        code: "signup_precheck_blocked",
        message: GENERIC_BLOCK_MESSAGE,
      });
    }

    return jsonResponse(origin, {
      can_proceed: true,
      code: "ok",
      message: "ok",
    });
  } catch (error) {
    console.error(`${FUNCTION_NAME} error`, error);

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (supabaseUrl && serviceRoleKey) {
        const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        await writeFunctionLog(supabaseAdmin, "error", {
          request_id: requestId,
          outcome: "internal_error",
          error_message: error instanceof Error ? error.message : "unknown_error",
          duration_ms: Date.now() - startedAt,
        });
      }
    } catch (logError) {
      console.error(`${FUNCTION_NAME} fallback log error`, logError);
    }

    return jsonResponse(
      origin,
      {
        can_proceed: false,
        code: "signup_precheck_unavailable",
        message: GENERIC_BLOCK_MESSAGE,
      },
      500,
    );
  }
});
