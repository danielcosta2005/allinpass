import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

type SupabaseAdmin = any;

const ELIGIBLE_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "paused"];
const ACTIVE_PLAN_CHANGE_STATUSES = ["pending", "created", "paid"];

type BillingSubscription = {
  id: string;
  project_id: string;
  billing_account_id: string;
  plan_id: string;
  status: string;
  current_period_end: string | null;
  gateway_provider: string | null;
  gateway_subscription_id: string | null;
};

class BillingPlanCancellationError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "BillingPlanCancellationError";
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

function errorResponse(origin: string | null, error: BillingPlanCancellationError) {
  return jsonResponse(origin, { error: error.message, code: error.code }, error.status);
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new BillingPlanCancellationError(
      "BILLING_PLAN_CANCELLATION_MISSING_ENV",
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
    throw new BillingPlanCancellationError(
      "BILLING_PLAN_CANCELLATION_PROJECT_NOT_FOUND",
      "Projeto não encontrado para este usuário.",
      404,
    );
  }

  if (data.role !== "owner") {
    throw new BillingPlanCancellationError(
      "BILLING_PLAN_CANCELLATION_OWNER_REQUIRED",
      "Apenas o proprietário do projeto pode cancelar o plano.",
      403,
    );
  }
}

async function getCurrentSubscription(
  supabaseAdmin: SupabaseAdmin,
  projectId: string,
): Promise<BillingSubscription> {
  const { data, error } = await supabaseAdmin
    .from("billing_subscriptions")
    .select([
      "id",
      "project_id",
      "billing_account_id",
      "plan_id",
      "status",
      "current_period_end",
      "gateway_provider",
      "gateway_subscription_id",
    ].join(", "))
    .eq("project_id", projectId)
    .in("status", ELIGIBLE_SUBSCRIPTION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const subscription = data as BillingSubscription | null;
  if (!subscription) {
    throw new BillingPlanCancellationError(
      "BILLING_PLAN_CANCELLATION_SUBSCRIPTION_NOT_FOUND",
      "Assinatura ativa não encontrada para este projeto.",
      404,
    );
  }

  return subscription;
}

async function supersedePendingNextCyclePlanChanges(
  supabaseAdmin: SupabaseAdmin,
  subscriptionId: string,
  supersededBySessionId: string | null,
  reason: string,
) {
  const { error } = await supabaseAdmin.rpc("supersede_pending_next_cycle_plan_changes", {
    p_subscription_id: subscriptionId,
    p_superseded_by_session_id: supersededBySessionId,
    p_reason: reason,
  });

  if (error) throw error;
}

async function findPendingCancellation(
  supabaseAdmin: SupabaseAdmin,
  projectId: string,
  subscriptionId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .select("id, status, created_at")
    .eq("project_id", projectId)
    .eq("subscription_id", subscriptionId)
    .eq("change_type", "cancellation")
    .eq("effective_mode", "next_cycle")
    .in("status", ACTIVE_PLAN_CHANGE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as { id: string; status: string; created_at: string } | null;
}

async function schedulePlanCancellation(
  supabaseAdmin: SupabaseAdmin,
  subscription: BillingSubscription,
  userId: string,
) {
  const reusableCancellation = await findPendingCancellation(
    supabaseAdmin,
    subscription.project_id,
    subscription.id,
  );

  if (reusableCancellation?.id) {
    return {
      success: true,
      action: "schedule",
      already_scheduled: true,
      plan_change_session_id: reusableCancellation.id,
      scheduled: true,
      effective_mode: "next_cycle",
      current_period_end: subscription.current_period_end,
    };
  }

  const sessionId = crypto.randomUUID();

  await supersedePendingNextCyclePlanChanges(
    supabaseAdmin,
    subscription.id,
    sessionId,
    "replaced_by_plan_cancellation",
  );

  const { data, error } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .insert({
      id: sessionId,
      project_id: subscription.project_id,
      subscription_id: subscription.id,
      previous_plan_id: subscription.plan_id,
      new_plan_id: subscription.plan_id,
      requested_by: userId,
      change_type: "cancellation",
      effective_mode: "next_cycle",
      provider: "asaas",
      provider_subscription_id: subscription.gateway_subscription_id,
      external_reference: crypto.randomUUID(),
      status: "paid",
      amount_cents: 0,
      currency: "BRL",
      paid_at: new Date().toISOString(),
      metadata: {
        origin: "billing_manage_plan_cancellation",
        action: "schedule",
        gateway_provider: subscription.gateway_provider,
      },
    })
    .select("id")
    .single();

  if (error) throw error;

  return {
    success: true,
    action: "schedule",
    already_scheduled: false,
    plan_change_session_id: data.id,
    scheduled: true,
    effective_mode: "next_cycle",
    current_period_end: subscription.current_period_end,
  };
}

async function undoPlanCancellation(
  supabaseAdmin: SupabaseAdmin,
  subscription: BillingSubscription,
  userId: string,
) {
  const pendingCancellation = await findPendingCancellation(
    supabaseAdmin,
    subscription.project_id,
    subscription.id,
  );

  if (!pendingCancellation?.id) {
    return {
      success: true,
      action: "undo",
      already_canceled: true,
      canceled: false,
      scheduled: false,
    };
  }

  const { error } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .update({
      status: "canceled",
      metadata: {
        origin: "billing_manage_plan_cancellation",
        action: "undo",
        canceled_by_user_id: userId,
        canceled_at: new Date().toISOString(),
      },
    })
    .eq("id", pendingCancellation.id)
    .eq("status", pendingCancellation.status);

  if (error) throw error;

  return {
    success: true,
    action: "undo",
    already_canceled: false,
    canceled: true,
    scheduled: false,
    plan_change_session_id: pendingCancellation.id,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return errorResponse(
      origin,
      new BillingPlanCancellationError("BILLING_PLAN_CANCELLATION_METHOD_NOT_ALLOWED", "Método não permitido.", 405),
    );
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader.startsWith("Bearer ")) {
      throw new BillingPlanCancellationError(
        "BILLING_PLAN_CANCELLATION_MISSING_AUTHORIZATION",
        "Sessão obrigatória para cancelar o plano.",
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
      throw new BillingPlanCancellationError(
        "BILLING_PLAN_CANCELLATION_INVALID_SESSION",
        "Sessão inválida ou expirada.",
        401,
      );
    }

    const payload = await req.json().catch(() => ({}));
    const projectId = String(payload.projectId ?? "").trim();
    const action = String(payload.action ?? "").trim().toLowerCase();

    if (!projectId) {
      throw new BillingPlanCancellationError(
        "BILLING_PLAN_CANCELLATION_MISSING_PROJECT",
        "Informe o projeto para cancelar o plano.",
        400,
      );
    }

    if (action !== "schedule" && action !== "undo") {
      throw new BillingPlanCancellationError(
        "BILLING_PLAN_CANCELLATION_UNSUPPORTED_ACTION",
        "Ação de cancelamento inválida.",
        400,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await requireOwnerMembership(supabaseAdmin, projectId, user.id);
    const subscription = await getCurrentSubscription(supabaseAdmin, projectId);

    const result = action === "schedule"
      ? await schedulePlanCancellation(supabaseAdmin, subscription, user.id)
      : await undoPlanCancellation(supabaseAdmin, subscription, user.id);

    return jsonResponse(origin, result);
  } catch (error) {
    console.error("billing-manage-plan-cancellation error", error);

    if (error instanceof BillingPlanCancellationError) {
      return errorResponse(origin, error);
    }

    return errorResponse(
      origin,
      new BillingPlanCancellationError(
        "BILLING_PLAN_CANCELLATION_INTERNAL_ERROR",
        "Erro interno ao gerenciar cancelamento do plano.",
        500,
      ),
    );
  }
});
