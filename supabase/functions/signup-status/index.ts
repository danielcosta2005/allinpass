import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

const FREE_PLAN_CODE = "free_trial";
const ACTIVE_CHECKOUT_STATUSES = new Set(["pending", "created"]);
const RETRYABLE_CHECKOUT_STATUSES = new Set(["pending", "created", "failed", "canceled", "expired"]);

type CheckoutSessionRow = {
  id: string;
  plan_id: string;
  plan_code: string;
  status: string;
  checkout_url: string | null;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  establishment_name: string;
  amount_cents: number;
  currency: string;
};

class SignupStatusError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SignupStatusError";
    this.code = code;
    this.status = status;
  }
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function jsonResponse(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function normalizePlanCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function normalizeCheckoutStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function hasCheckoutExpired(session: CheckoutSessionRow | null, now: Date) {
  if (!session?.expires_at) return false;
  const expiresAtMs = Date.parse(session.expires_at);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now.getTime();
}

function deriveSignupState({
  hasProject,
  latestSession,
  metadataPlanCode,
  now,
}: {
  hasProject: boolean;
  latestSession: CheckoutSessionRow | null;
  metadataPlanCode: string;
  now: Date;
}) {
  if (hasProject) return "project_ready";

  const checkoutStatus = normalizeCheckoutStatus(latestSession?.status);
  if (checkoutStatus === "paid") {
    return "payment_confirmed_finalization_pending";
  }

  if (latestSession) {
    const expiredByTime = hasCheckoutExpired(latestSession, now);
    const hasReusableCheckoutUrl = Boolean(latestSession.checkout_url) && !expiredByTime;

    if (ACTIVE_CHECKOUT_STATUSES.has(checkoutStatus) && hasReusableCheckoutUrl) {
      return "payment_pending";
    }

    if (RETRYABLE_CHECKOUT_STATUSES.has(checkoutStatus) || expiredByTime) {
      return "payment_retry_available";
    }
  }

  if (metadataPlanCode && metadataPlanCode !== FREE_PLAN_CODE) {
    return "payment_retry_available";
  }

  return "no_project_no_signup_context";
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse(origin, { error: "Metodo nao permitido." }, 405);
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader.startsWith("Bearer ")) {
      throw new SignupStatusError(
        "SIGNUP_STATUS_MISSING_AUTH",
        "Sessao obrigatoria para consultar status de cadastro.",
        401,
      );
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      throw new SignupStatusError(
        "SIGNUP_STATUS_INVALID_SESSION",
        "Sessao invalida ou expirada.",
        401,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: memberData, error: memberError } = await supabaseAdmin
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (memberError) throw memberError;

    const projectId = String(memberData?.project_id ?? "").trim();
    const hasProject = Boolean(projectId);

    const { data: checkoutData, error: checkoutError } = await supabaseAdmin
      .from("signup_checkout_sessions")
      .select(
        "id, plan_id, plan_code, status, checkout_url, expires_at, paid_at, created_at, updated_at, establishment_name, amount_cents, currency",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (checkoutError) throw checkoutError;

    const latestSession = checkoutData as CheckoutSessionRow | null;
    const metadataPlanCode = normalizePlanCode(user.user_metadata?.plan_code);
    const sessionPlanCode = normalizePlanCode(latestSession?.plan_code);
    const planCode = sessionPlanCode || metadataPlanCode || null;
    const checkoutStatus = normalizeCheckoutStatus(latestSession?.status) || null;
    const now = new Date();
    const signupState = deriveSignupState({
      hasProject,
      latestSession,
      metadataPlanCode,
      now,
    });
    const checkoutExpired = hasCheckoutExpired(latestSession, now);
    const checkoutUrl = signupState === "payment_pending" && !checkoutExpired
      ? latestSession?.checkout_url ?? null
      : null;
    const establishmentName = String(
      latestSession?.establishment_name ?? user.user_metadata?.establishment_name ?? "",
    ).trim();

    return jsonResponse(origin, {
      success: true,
      has_project: hasProject,
      project_id: projectId || null,
      signup_state: signupState,
      plan_code: planCode,
      establishment_name: establishmentName || null,
      checkout_status: checkoutStatus,
      checkout_session_id: latestSession?.id ?? null,
      checkout_url: checkoutUrl,
      checkout_expired: checkoutExpired,
      expires_at: latestSession?.expires_at ?? null,
      paid_at: latestSession?.paid_at ?? null,
      amount_cents: latestSession?.amount_cents ?? null,
      currency: latestSession?.currency ?? null,
      updated_at: latestSession?.updated_at ?? null,
    });
  } catch (error) {
    console.error("signup-status error", error);

    if (error instanceof SignupStatusError) {
      return jsonResponse(origin, {
        error: error.message,
        code: error.code,
      }, error.status);
    }

    return jsonResponse(origin, {
      error: "Nao foi possivel consultar o status do cadastro.",
      code: "SIGNUP_STATUS_INTERNAL_ERROR",
    }, 500);
  }
});
