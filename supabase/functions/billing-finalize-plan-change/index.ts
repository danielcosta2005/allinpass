import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

type SupabaseAdmin = any;

type PlanChangeSession = {
  id: string;
  project_id: string;
  subscription_id: string;
  status: string;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  provider_payment_id: string | null;
};

class BillingPlanFinalizeError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "BillingPlanFinalizeError";
    this.code = code;
    this.status = status;
  }
}

function jsonResponse(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function errorResponse(origin: string | null, error: BillingPlanFinalizeError) {
  return jsonResponse(origin, { error: error.message, code: error.code }, error.status);
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new BillingPlanFinalizeError(
      "BILLING_PLAN_FINALIZE_MISSING_ENV",
      `Variável ${name} ausente.`,
      500,
    );
  }
  return value;
}

async function requireOwnerMembership(
  supabaseAdmin: SupabaseAdmin,
  projectId: string,
  userId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new BillingPlanFinalizeError(
      "BILLING_PLAN_FINALIZE_PROJECT_NOT_FOUND",
      "Projeto não encontrado para este usuário.",
      404,
    );
  }

  if (data.role !== "owner") {
    throw new BillingPlanFinalizeError(
      "BILLING_PLAN_FINALIZE_OWNER_REQUIRED",
      "Apenas o proprietário do projeto pode finalizar a mudança de plano.",
      403,
    );
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return errorResponse(
      origin,
      new BillingPlanFinalizeError("BILLING_PLAN_FINALIZE_METHOD_NOT_ALLOWED", "Método não permitido.", 405),
    );
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader.startsWith("Bearer ")) {
      throw new BillingPlanFinalizeError(
        "BILLING_PLAN_FINALIZE_MISSING_AUTHORIZATION",
        "Sessão obrigatória para finalizar a mudança de plano.",
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
      throw new BillingPlanFinalizeError(
        "BILLING_PLAN_FINALIZE_INVALID_SESSION",
        "Sessão inválida ou expirada.",
        401,
      );
    }

    const payload = await req.json().catch(() => ({}));
    const planChangeSessionId = String(payload.planChangeSessionId ?? "").trim();

    if (!planChangeSessionId) {
      throw new BillingPlanFinalizeError(
        "BILLING_PLAN_FINALIZE_MISSING_SESSION",
        "Informe a sessão de mudança de plano.",
        400,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("billing_plan_change_sessions")
      .select("id, project_id, subscription_id, status, provider_subscription_id, provider_customer_id, provider_payment_id")
      .eq("id", planChangeSessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;
    const session = sessionData as PlanChangeSession | null;
    if (!session) {
      throw new BillingPlanFinalizeError(
        "BILLING_PLAN_FINALIZE_SESSION_NOT_FOUND",
        "Sessão de mudança de plano não encontrada.",
        404,
      );
    }

    await requireOwnerMembership(supabaseAdmin, session.project_id, user.id);

    if (session.status === "applied") {
      return jsonResponse(origin, {
        success: true,
        already_applied: true,
        plan_change_session_id: session.id,
      });
    }

    if (session.status !== "paid") {
      throw new BillingPlanFinalizeError(
        "BILLING_PLAN_FINALIZE_PAYMENT_NOT_CONFIRMED",
        "Pagamento da mudança de plano ainda não confirmado pelo Asaas.",
        409,
      );
    }

    if (!session.provider_subscription_id || !session.provider_customer_id) {
      throw new BillingPlanFinalizeError(
        "BILLING_PLAN_FINALIZE_PAYMENT_NOT_CONFIRMED",
        "Pagamento confirmado, aguardando vinculação da assinatura no Asaas.",
        409,
      );
    }

    const { data, error } = await supabaseAdmin.rpc("apply_billing_plan_change", {
      p_session_id: session.id,
      p_actor_user_id: user.id,
      p_provider_subscription_id: session.provider_subscription_id,
      p_provider_customer_id: session.provider_customer_id,
      p_provider_payment_id: session.provider_payment_id,
    });

    if (error) throw error;

    return jsonResponse(origin, {
      success: true,
      already_applied: false,
      plan_change_session_id: session.id,
      result: data,
    });
  } catch (error) {
    console.error("billing-finalize-plan-change error", error);

    if (error instanceof BillingPlanFinalizeError) {
      return errorResponse(origin, error);
    }

    return errorResponse(
      origin,
      new BillingPlanFinalizeError(
        "BILLING_PLAN_FINALIZE_INTERNAL_ERROR",
        "Erro interno ao finalizar a mudança de plano.",
        500,
      ),
    );
  }
});
