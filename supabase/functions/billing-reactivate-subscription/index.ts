import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

type SupabaseAdmin = any;

type BillingSubscription = {
  id: string;
  project_id: string;
  billing_account_id: string;
  plan_id: string;
  status: string;
  gateway_provider: string | null;
  gateway_subscription_id: string | null;
  billing_accounts?:
    | { gateway_customer_id?: string | null }
    | Array<{ gateway_customer_id?: string | null }>
    | null;
};

class BillingSubscriptionReactivationError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "BillingSubscriptionReactivationError";
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

function errorResponse(
  origin: string | null,
  error: BillingSubscriptionReactivationError,
) {
  return jsonResponse(
    origin,
    { error: error.message, code: error.code },
    error.status,
  );
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new BillingSubscriptionReactivationError(
      "BILLING_SUBSCRIPTION_REACTIVATION_MISSING_ENV",
      `Variável ${name} ausente.`,
      500,
    );
  }
  return value;
}

function getAsaasApiBaseUrl() {
  const explicit = String(Deno.env.get("ASAAS_API_BASE_URL") ?? "").trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const env = String(Deno.env.get("ASAAS_ENV") ?? "sandbox").trim()
    .toLowerCase();
  return env === "production"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
}

function isAsaasSubscriptionId(value: unknown) {
  return /^sub_[a-z0-9]+$/i.test(String(value ?? "").trim());
}

function formatAsaasDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function readProviderId(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id?: unknown }).id ?? "").trim() || null;
  }
  return null;
}

function readEmbeddedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function getAsaasErrorMessage(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const errors =
    (body as { errors?: Array<{ description?: unknown; message?: unknown }> })
      .errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return String(errors[0]?.description || errors[0]?.message || "").trim();
  }
  return String((body as { message?: unknown }).message || "").trim();
}

async function asaasFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${getAsaasApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "access_token": apiKey,
      "User-Agent": "AllinPass/1.0",
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = getAsaasErrorMessage(body) ||
      "Não foi possível consultar a assinatura no Asaas.";
    throw new BillingSubscriptionReactivationError(
      "BILLING_SUBSCRIPTION_REACTIVATION_ASAAS_ERROR",
      message,
      response.status === 404 ? 409 : 502,
    );
  }

  return body as Record<string, unknown>;
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
    throw new BillingSubscriptionReactivationError(
      "BILLING_SUBSCRIPTION_REACTIVATION_PROJECT_NOT_FOUND",
      "Projeto não encontrado para este usuário.",
      404,
    );
  }

  if (data.role !== "owner") {
    throw new BillingSubscriptionReactivationError(
      "BILLING_SUBSCRIPTION_REACTIVATION_OWNER_REQUIRED",
      "Apenas o proprietário do projeto pode reativar a assinatura.",
      403,
    );
  }
}

async function getCanceledSubscription(
  supabaseAdmin: SupabaseAdmin,
  projectId: string,
): Promise<BillingSubscription> {
  const { data, error } = await supabaseAdmin
    .from("billing_subscriptions")
    .select(
      [
        "id",
        "project_id",
        "billing_account_id",
        "plan_id",
        "status",
        "gateway_provider",
        "gateway_subscription_id",
        "billing_accounts(gateway_customer_id)",
      ].join(", "),
    )
    .eq("project_id", projectId)
    .eq("status", "canceled")
    .order("ended_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new BillingSubscriptionReactivationError(
      "BILLING_SUBSCRIPTION_REACTIVATION_SUBSCRIPTION_NOT_FOUND",
      "Assinatura cancelada não encontrada para este projeto.",
      404,
    );
  }

  return data as BillingSubscription;
}

function requireAsaasSubscription(subscription: BillingSubscription) {
  const providerSubscriptionId = String(
    subscription.gateway_subscription_id ?? "",
  ).trim();

  if (
    subscription.gateway_provider !== "asaas" ||
    !isAsaasSubscriptionId(providerSubscriptionId)
  ) {
    throw new BillingSubscriptionReactivationError(
      "BILLING_SUBSCRIPTION_REACTIVATION_ASAAS_SUBSCRIPTION_NOT_FOUND",
      "Não encontramos uma assinatura do Asaas para reativar.",
      409,
    );
  }

  return providerSubscriptionId;
}

function getBillingAccountCustomerId(subscription: BillingSubscription) {
  const account = readEmbeddedOne(subscription.billing_accounts);
  return String(account?.gateway_customer_id ?? "").trim() || null;
}

async function reactivateProviderSubscription(
  apiKey: string,
  providerSubscriptionId: string,
  reactivationDate: Date,
) {
  const currentProviderSubscription = await asaasFetch(
    apiKey,
    `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
    { method: "GET" },
  );

  if (currentProviderSubscription.deleted === true) {
    throw new BillingSubscriptionReactivationError(
      "BILLING_SUBSCRIPTION_REACTIVATION_DELETED_PROVIDER_SUBSCRIPTION",
      "A assinatura antiga foi removida no Asaas. Crie uma nova assinatura para este projeto.",
      409,
    );
  }

  const currentStatus = String(currentProviderSubscription.status ?? "").trim()
    .toUpperCase();
  if (currentStatus === "EXPIRED") {
    throw new BillingSubscriptionReactivationError(
      "BILLING_SUBSCRIPTION_REACTIVATION_EXPIRED_PROVIDER_SUBSCRIPTION",
      "A assinatura antiga expirou no Asaas. Crie uma nova assinatura para este projeto.",
      409,
    );
  }

  if (currentStatus === "ACTIVE") {
    return currentProviderSubscription;
  }

  if (currentStatus !== "INACTIVE") {
    throw new BillingSubscriptionReactivationError(
      "BILLING_SUBSCRIPTION_REACTIVATION_UNSUPPORTED_PROVIDER_STATUS",
      "A assinatura no Asaas não está em um estado que possa ser reativado automaticamente.",
      409,
    );
  }

  return await asaasFetch(
    apiKey,
    `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        status: "ACTIVE",
        nextDueDate: formatAsaasDate(addDays(reactivationDate, 1)),
        updatePendingPayments: false,
      }),
    },
  );
}

async function applyLocalReactivation(
  supabaseAdmin: SupabaseAdmin,
  subscription: BillingSubscription,
  userId: string,
  providerSubscriptionId: string,
  providerCustomerId: string | null,
  reactivationDate: Date,
) {
  const { data, error } = await supabaseAdmin.rpc(
    "reactivate_billing_subscription",
    {
      p_subscription_id: subscription.id,
      p_actor_user_id: userId,
      p_provider_subscription_id: providerSubscriptionId,
      p_provider_customer_id: providerCustomerId,
      p_effective_at: reactivationDate.toISOString(),
    },
  );

  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return errorResponse(
      origin,
      new BillingSubscriptionReactivationError(
        "BILLING_SUBSCRIPTION_REACTIVATION_METHOD_NOT_ALLOWED",
        "Método não permitido.",
        405,
      ),
    );
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const asaasApiKey = requiredEnv("ASAAS_API_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader.startsWith("Bearer ")) {
      throw new BillingSubscriptionReactivationError(
        "BILLING_SUBSCRIPTION_REACTIVATION_MISSING_AUTHORIZATION",
        "Sessão obrigatória para reativar a assinatura.",
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
      throw new BillingSubscriptionReactivationError(
        "BILLING_SUBSCRIPTION_REACTIVATION_INVALID_SESSION",
        "Sessão inválida ou expirada.",
        401,
      );
    }

    const payload = await req.json().catch(() => ({}));
    const projectId = String(payload.projectId ?? "").trim();

    if (!projectId) {
      throw new BillingSubscriptionReactivationError(
        "BILLING_SUBSCRIPTION_REACTIVATION_MISSING_PROJECT",
        "Informe o projeto para reativar a assinatura.",
        400,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await requireOwnerMembership(supabaseAdmin, projectId, user.id);
    const subscription = await getCanceledSubscription(
      supabaseAdmin,
      projectId,
    );
    const providerSubscriptionId = requireAsaasSubscription(subscription);
    const reactivationDate = new Date();
    const asaasSubscription = await reactivateProviderSubscription(
      asaasApiKey,
      providerSubscriptionId,
      reactivationDate,
    );
    const providerCustomerId = readProviderId(asaasSubscription.customer) ||
      getBillingAccountCustomerId(subscription);
    const result = await applyLocalReactivation(
      supabaseAdmin,
      subscription,
      user.id,
      providerSubscriptionId,
      providerCustomerId,
      reactivationDate,
    );

    return jsonResponse(origin, {
      success: true,
      provider_subscription_id: providerSubscriptionId,
      provider_status:
        String(asaasSubscription.status ?? "").trim().toUpperCase() || null,
      result,
    });
  } catch (error) {
    console.error("billing-reactivate-subscription error", error);

    if (error instanceof BillingSubscriptionReactivationError) {
      return errorResponse(origin, error);
    }

    return errorResponse(
      origin,
      new BillingSubscriptionReactivationError(
        "BILLING_SUBSCRIPTION_REACTIVATION_INTERNAL_ERROR",
        "Erro interno ao reativar a assinatura.",
        500,
      ),
    );
  }
});
