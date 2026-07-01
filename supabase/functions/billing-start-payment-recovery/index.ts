import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

type SupabaseAdmin = any;

type BillingSubscription = {
  id: string;
  project_id: string;
  status: string;
  gateway_provider: string | null;
  gateway_subscription_id: string | null;
  delinquency_gateway_charge_id: string | null;
};

const PAID_PAYMENT_STATUSES = new Set([
  "CONFIRMED",
  "RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
]);

class BillingPaymentRecoveryError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "BillingPaymentRecoveryError";
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
  error: BillingPaymentRecoveryError,
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
    throw new BillingPaymentRecoveryError(
      "BILLING_PAYMENT_RECOVERY_MISSING_ENV",
      `Variavel ${name} ausente.`,
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
      "Nao foi possivel consultar a cobranca pendente no Asaas.";
    throw new BillingPaymentRecoveryError(
      response.status === 404
        ? "BILLING_PAYMENT_RECOVERY_CHARGE_NOT_FOUND"
        : "BILLING_PAYMENT_RECOVERY_ASAAS_ERROR",
      message,
      response.status === 404 ? 404 : 502,
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
    throw new BillingPaymentRecoveryError(
      "BILLING_PAYMENT_RECOVERY_PROJECT_NOT_FOUND",
      "Projeto nao encontrado para este usuario.",
      404,
    );
  }

  if (data.role !== "owner") {
    throw new BillingPaymentRecoveryError(
      "BILLING_PAYMENT_RECOVERY_OWNER_REQUIRED",
      "Apenas o proprietario do projeto pode regularizar a cobranca.",
      403,
    );
  }
}

async function getRecoverableSubscription(
  supabaseAdmin: SupabaseAdmin,
  projectId: string,
): Promise<BillingSubscription> {
  const { data, error } = await supabaseAdmin
    .from("billing_subscriptions")
    .select(
      [
        "id",
        "project_id",
        "status",
        "gateway_provider",
        "gateway_subscription_id",
        "delinquency_gateway_charge_id",
      ].join(", "),
    )
    .eq("project_id", projectId)
    .in("status", ["past_due", "suspended"])
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new BillingPaymentRecoveryError(
      "BILLING_PAYMENT_RECOVERY_SUBSCRIPTION_NOT_FOUND",
      "Assinatura com cobranca pendente nao encontrada para este projeto.",
      404,
    );
  }

  return data as BillingSubscription;
}

function requireAsaasPayment(subscription: BillingSubscription) {
  if (subscription.gateway_provider !== "asaas") {
    throw new BillingPaymentRecoveryError(
      "BILLING_PAYMENT_RECOVERY_UNSUPPORTED_PROVIDER",
      "A regularizacao automatica esta disponivel apenas para cobrancas do Asaas.",
      409,
    );
  }

  const providerPaymentId = String(
    subscription.delinquency_gateway_charge_id ?? "",
  ).trim();
  if (!providerPaymentId) {
    throw new BillingPaymentRecoveryError(
      "BILLING_PAYMENT_RECOVERY_CHARGE_NOT_FOUND",
      "Nao foi possivel localizar a cobranca pendente desta assinatura.",
      409,
    );
  }

  return providerPaymentId;
}

function readString(value: unknown) {
  return String(value ?? "").trim() || null;
}

function readPaymentStatus(payment: Record<string, unknown>) {
  return String(payment.status ?? "").trim().toUpperCase() || null;
}

function getPaymentRecoveryPayload(
  providerPaymentId: string,
  payment: Record<string, unknown>,
) {
  const paymentStatus = readPaymentStatus(payment);
  const invoiceUrl = readString(payment.invoiceUrl);
  const bankSlipUrl = readString(payment.bankSlipUrl);
  const alreadyPaid = paymentStatus ? PAID_PAYMENT_STATUSES.has(paymentStatus) : false;
  const paymentValue = Number(payment.value);

  if (!alreadyPaid && !invoiceUrl) {
    throw new BillingPaymentRecoveryError(
      "BILLING_PAYMENT_RECOVERY_INVOICE_URL_NOT_FOUND",
      "A cobranca pendente nao possui link de pagamento disponivel. Fale com o suporte.",
      409,
    );
  }

  return {
    success: true,
    provider_payment_id: providerPaymentId,
    payment_status: paymentStatus,
    invoice_url: invoiceUrl,
    bank_slip_url: bankSlipUrl,
    due_date: readString(payment.dueDate),
    value: Number.isFinite(paymentValue) ? paymentValue : null,
    already_paid: alreadyPaid,
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
      new BillingPaymentRecoveryError(
        "BILLING_PAYMENT_RECOVERY_METHOD_NOT_ALLOWED",
        "Metodo nao permitido.",
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
      throw new BillingPaymentRecoveryError(
        "BILLING_PAYMENT_RECOVERY_MISSING_AUTHORIZATION",
        "Sessao obrigatoria para regularizar a cobranca.",
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
      throw new BillingPaymentRecoveryError(
        "BILLING_PAYMENT_RECOVERY_INVALID_SESSION",
        "Sessao invalida ou expirada.",
        401,
      );
    }

    const payload = await req.json().catch(() => ({}));
    const projectId = String(payload.projectId ?? "").trim();

    if (!projectId) {
      throw new BillingPaymentRecoveryError(
        "BILLING_PAYMENT_RECOVERY_MISSING_PROJECT",
        "Informe o projeto para regularizar a cobranca.",
        400,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await requireOwnerMembership(supabaseAdmin, projectId, user.id);
    const subscription = await getRecoverableSubscription(
      supabaseAdmin,
      projectId,
    );
    const providerPaymentId = requireAsaasPayment(subscription);
    const payment = await asaasFetch(
      asaasApiKey,
      `/payments/${encodeURIComponent(providerPaymentId)}`,
      { method: "GET" },
    );

    return jsonResponse(
      origin,
      getPaymentRecoveryPayload(providerPaymentId, payment),
    );
  } catch (error) {
    console.error("billing-start-payment-recovery error", error);

    if (error instanceof BillingPaymentRecoveryError) {
      return errorResponse(origin, error);
    }

    return errorResponse(
      origin,
      new BillingPaymentRecoveryError(
        "BILLING_PAYMENT_RECOVERY_INTERNAL_ERROR",
        "Erro interno ao iniciar a regularizacao do pagamento.",
        500,
      ),
    );
  }
});
