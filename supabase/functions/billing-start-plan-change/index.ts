import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

type SupabaseAdmin = any;

const FREE_PLAN_CODE = "free_trial";
const DEFAULT_CHECKOUT_EXPIRATION_MINUTES = 60;
const ACTIVE_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "paused"];

type BillingPlan = {
  id: string;
  code: string;
  name: string;
  base_price_cents: number;
  billing_interval: string;
  included_pass_installs: number;
  included_notification_sends: number;
  overage_pass_install_cents: number;
  overage_notification_sent_cents: number;
};

type BillingSubscription = {
  id: string;
  project_id: string;
  billing_account_id: string;
  plan_id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  gateway_provider: string | null;
  gateway_subscription_id: string | null;
  billing_accounts?: { gateway_customer_id?: string | null } | Array<{ gateway_customer_id?: string | null }> | null;
  base_price_cents: number;
  included_pass_installs: number;
  included_notification_sends: number;
  overage_pass_install_cents: number;
  overage_notification_sent_cents: number;
  billing_plans?: Pick<BillingPlan, "code" | "name" | "base_price_cents"> | null;
};

type PlanChangeSession = {
  id: string;
  checkout_url: string | null;
  expires_at: string | null;
  status: string;
  provider_checkout_id: string | null;
};

class BillingPlanChangeError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "BillingPlanChangeError";
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

function errorResponse(origin: string | null, error: BillingPlanChangeError) {
  return jsonResponse(origin, { error: error.message, code: error.code }, error.status);
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new BillingPlanChangeError(
      "BILLING_PLAN_CHANGE_MISSING_ENV",
      `Variavel ${name} ausente.`,
      500,
    );
  }
  return value;
}

function normalizePlanCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatAsaasDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getAsaasApiBaseUrl() {
  const explicit = String(Deno.env.get("ASAAS_API_BASE_URL") ?? "").trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const env = String(Deno.env.get("ASAAS_ENV") ?? "sandbox").trim().toLowerCase();
  return env === "production"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
}

function getAsaasCheckoutBaseUrl() {
  const explicit = String(Deno.env.get("ASAAS_CHECKOUT_BASE_URL") ?? "").trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const env = String(Deno.env.get("ASAAS_ENV") ?? "sandbox").trim().toLowerCase();
  return env === "production"
    ? "https://asaas.com/checkoutSession/show"
    : "https://sandbox.asaas.com/checkoutSession/show";
}

function buildCheckoutUrl(providerCheckoutId: string) {
  return `${getAsaasCheckoutBaseUrl()}/${encodeURIComponent(providerCheckoutId)}`;
}

function getAppBaseUrl(origin: string | null) {
  return String(
    Deno.env.get("ASAAS_CALLBACK_BASE_URL")
      ?? Deno.env.get("APP_BASE_URL")
      ?? origin
      ?? "",
  ).trim().replace(/\/$/, "");
}

function assertPublicHttpsAppBaseUrl(appBaseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(appBaseUrl);
  } catch {
    throw new BillingPlanChangeError(
      "BILLING_PLAN_CHANGE_INVALID_APP_BASE_URL",
      "URL publica de callback invalida.",
      500,
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocal =
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname.startsWith("10.")
    || hostname.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

  if (parsed.protocol !== "https:" || isLocal) {
    throw new BillingPlanChangeError(
      "BILLING_PLAN_CHANGE_INVALID_APP_BASE_URL",
      "Callbacks do Asaas exigem uma URL publica HTTPS.",
      500,
    );
  }
}

function buildOrgRedirectUrl(appBaseUrl: string, params: Record<string, string>) {
  const url = new URL("/org", `${appBaseUrl}/`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function getAsaasErrorMessage(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const errors = (body as { errors?: Array<{ description?: unknown; message?: unknown }> }).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return String(errors[0]?.description || errors[0]?.message || "").trim();
  }
  return String((body as { message?: unknown }).message || "").trim();
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

function isAsaasSubscriptionId(value: unknown) {
  return /^sub_[a-z0-9]+$/i.test(String(value ?? "").trim());
}

function getAsaasCustomerId(subscription: BillingSubscription) {
  const billingAccount = readEmbeddedOne(subscription.billing_accounts);
  return String(billingAccount?.gateway_customer_id ?? "").trim() || null;
}

function getAsaasListData(body: unknown) {
  const data = body && typeof body === "object"
    ? (body as { data?: unknown }).data
    : null;
  return Array.isArray(data) ? data.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>> : [];
}

function toCents(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function pickBestAsaasSubscription(
  candidates: Array<Record<string, unknown>>,
  subscription: BillingSubscription,
) {
  const currentPriceCents = Number(subscription.base_price_cents || subscription.billing_plans?.base_price_cents || 0);
  const usable = candidates
    .map((candidate) => ({
      candidate,
      id: readProviderId(candidate),
      status: String(candidate.status ?? "").trim().toUpperCase(),
      deleted: Boolean(candidate.deleted),
      valueCents: toCents(candidate.value),
      dateCreated: String(candidate.dateCreated ?? "").trim(),
    }))
    .filter((entry) => entry.id && isAsaasSubscriptionId(entry.id) && !entry.deleted);

  if (usable.length === 0) return null;

  const active = usable.filter((entry) => entry.status === "ACTIVE");
  const preferredStatus = active.length > 0 ? active : usable;
  const sameValue = preferredStatus.filter((entry) => entry.valueCents === currentPriceCents);
  const preferredValue = sameValue.length > 0 ? sameValue : preferredStatus;

  preferredValue.sort((a, b) => {
    const aDate = Date.parse(a.dateCreated);
    const bDate = Date.parse(b.dateCreated);
    if (Number.isFinite(aDate) && Number.isFinite(bDate)) return bDate - aDate;
    return 0;
  });

  return preferredValue[0]?.id ?? null;
}

async function resolveAsaasSubscriptionId({
  asaasApiKey,
  subscription,
}: {
  asaasApiKey: string;
  subscription: BillingSubscription;
}) {
  const storedId = String(subscription.gateway_subscription_id ?? "").trim();
  if (isAsaasSubscriptionId(storedId)) return storedId;

  const customerId = getAsaasCustomerId(subscription);
  if (!customerId) {
    throw new BillingPlanChangeError(
      "BILLING_PLAN_CHANGE_ASAAS_SUBSCRIPTION_NOT_FOUND",
      "Nao encontramos o cliente da assinatura no Asaas para atualizar o plano.",
      409,
    );
  }

  const url = new URL(`${getAsaasApiBaseUrl()}/subscriptions`);
  url.searchParams.set("customer", customerId);
  url.searchParams.set("limit", "20");
  url.searchParams.set("offset", "0");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "accept": "application/json",
      "access_token": asaasApiKey,
      "User-Agent": "AllinPass/1.0",
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = getAsaasErrorMessage(body) || "Nao foi possivel localizar a assinatura no Asaas.";
    throw new BillingPlanChangeError("BILLING_PLAN_CHANGE_ASAAS_ERROR", message, 502);
  }

  const providerSubscriptionId = pickBestAsaasSubscription(getAsaasListData(body), subscription);
  if (!providerSubscriptionId) {
    throw new BillingPlanChangeError(
      "BILLING_PLAN_CHANGE_ASAAS_SUBSCRIPTION_NOT_FOUND",
      "Nao encontramos uma assinatura ativa no Asaas para atualizar este plano.",
      409,
    );
  }

  return providerSubscriptionId;
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
    throw new BillingPlanChangeError(
      "BILLING_PLAN_CHANGE_PROJECT_NOT_FOUND",
      "Projeto nao encontrado para este usuario.",
      404,
    );
  }

  if (data.role !== "owner") {
    throw new BillingPlanChangeError(
      "BILLING_PLAN_CHANGE_OWNER_REQUIRED",
      "Apenas o proprietario do projeto pode alterar o plano.",
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
    .select(
      [
        "id",
        "project_id",
        "billing_account_id",
        "plan_id",
        "status",
        "current_period_start",
        "current_period_end",
        "gateway_provider",
        "gateway_subscription_id",
        "billing_accounts(gateway_customer_id)",
        "base_price_cents",
        "included_pass_installs",
        "included_notification_sends",
        "overage_pass_install_cents",
        "overage_notification_sent_cents",
        "billing_plans(code, name, base_price_cents)",
      ].join(", "),
    )
    .eq("project_id", projectId)
    .in("status", ACTIVE_SUBSCRIPTION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new BillingPlanChangeError(
      "BILLING_PLAN_CHANGE_SUBSCRIPTION_NOT_FOUND",
      "Assinatura ativa nao encontrada para este projeto.",
      404,
    );
  }

  return data as BillingSubscription;
}

async function getTargetPlan(
  supabaseAdmin: SupabaseAdmin,
  planCode: string,
): Promise<BillingPlan> {
  const { data, error } = await supabaseAdmin
    .from("billing_plans")
    .select(
      [
        "id",
        "code",
        "name",
        "base_price_cents",
        "billing_interval",
        "included_pass_installs",
        "included_notification_sends",
        "overage_pass_install_cents",
        "overage_notification_sent_cents",
      ].join(", "),
    )
    .eq("code", planCode)
    .eq("is_active", true)
    .eq("billing_interval", "monthly")
    .maybeSingle();

  if (error) throw error;
  const plan = data as BillingPlan | null;
  if (!plan) {
    throw new BillingPlanChangeError(
      "BILLING_PLAN_CHANGE_TARGET_PLAN_NOT_FOUND",
      "Plano ativo nao encontrado.",
      404,
    );
  }

  return plan;
}

async function applyBillingPlanChange(
  supabaseAdmin: SupabaseAdmin,
  sessionId: string,
  actorUserId: string,
  providerIds: {
    providerSubscriptionId?: string | null;
    providerCustomerId?: string | null;
    providerPaymentId?: string | null;
  } = {},
) {
  // The RPC writes billing_subscription_changes and updates billing_subscriptions in one transaction.
  const { data, error } = await supabaseAdmin.rpc("apply_billing_plan_change", {
    p_session_id: sessionId,
    p_actor_user_id: actorUserId,
    p_provider_subscription_id: providerIds.providerSubscriptionId ?? null,
    p_provider_customer_id: providerIds.providerCustomerId ?? null,
    p_provider_payment_id: providerIds.providerPaymentId ?? null,
  });

  if (error) throw error;
  return data;
}

async function findReusableSession(
  supabaseAdmin: SupabaseAdmin,
  subscription: BillingSubscription,
  targetPlan: BillingPlan,
) {
  const { data, error } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .select("id, checkout_url, expires_at, status, provider_checkout_id")
    .eq("project_id", subscription.project_id)
    .eq("subscription_id", subscription.id)
    .eq("new_plan_id", targetPlan.id)
    .in("status", ["pending", "created", "paid"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as PlanChangeSession | null;
}

function getPlanChangeType(
  subscription: BillingSubscription,
  targetPlan: BillingPlan,
) {
  const currentPlanCode = String(subscription.billing_plans?.code || "").trim().toLowerCase();
  const currentPriceCents = Number(subscription.base_price_cents || subscription.billing_plans?.base_price_cents || 0);
  const targetPriceCents = Number(targetPlan.base_price_cents || 0);

  if (currentPlanCode === FREE_PLAN_CODE || currentPriceCents <= 0) return "trial_conversion";
  if (targetPriceCents < currentPriceCents) return "downgrade";
  if (targetPriceCents > currentPriceCents) return "upgrade";
  return "plan_change";
}

function getPlanChangeEffectiveMode(changeType: string) {
  return changeType === "downgrade" ? "next_cycle" : "immediate";
}

async function createPlanChangeCheckout({
  supabaseAdmin,
  asaasApiKey,
  origin,
  userId,
  email,
  subscription,
  targetPlan,
  changeType,
}: {
  supabaseAdmin: SupabaseAdmin;
  asaasApiKey: string;
  origin: string | null;
  userId: string;
  email: string;
  subscription: BillingSubscription;
  targetPlan: BillingPlan;
  changeType: string;
}) {
  const appBaseUrl = getAppBaseUrl(origin);
  if (!appBaseUrl) {
    throw new BillingPlanChangeError(
      "BILLING_PLAN_CHANGE_MISSING_APP_BASE_URL",
      "ASAAS_CALLBACK_BASE_URL ou APP_BASE_URL ausente.",
      500,
    );
  }
  assertPublicHttpsAppBaseUrl(appBaseUrl);

  const expiresAt = addMinutes(new Date(), DEFAULT_CHECKOUT_EXPIRATION_MINUTES);
  const externalReference = crypto.randomUUID();
  const effectiveMode = getPlanChangeEffectiveMode(changeType);
  const { data: sessionData, error: sessionError } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .insert({
      project_id: subscription.project_id,
      subscription_id: subscription.id,
      previous_plan_id: subscription.plan_id,
      new_plan_id: targetPlan.id,
      requested_by: userId,
      change_type: changeType,
      effective_mode: effectiveMode,
      provider: "asaas",
      external_reference: externalReference,
      status: "pending",
      amount_cents: targetPlan.base_price_cents,
      currency: "BRL",
      expires_at: expiresAt.toISOString(),
      metadata: {
        origin: "billing_start_plan_change",
        mode: "checkout",
        target_plan_code: targetPlan.code,
      },
    })
    .select("id, external_reference, expires_at")
    .single();

  if (sessionError) throw sessionError;
  const session = sessionData as { id: string; external_reference: string; expires_at: string };

  const callbackUrls = {
    success_url: buildOrgRedirectUrl(appBaseUrl, {
      planChange: "success",
      planChangeSessionId: session.id,
    }),
    cancel_url: buildOrgRedirectUrl(appBaseUrl, {
      planChange: "cancel",
      planChangeSessionId: session.id,
    }),
    expired_url: buildOrgRedirectUrl(appBaseUrl, {
      planChange: "expired",
      planChangeSessionId: session.id,
    }),
  };

  const { error: callbackError } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .update(callbackUrls)
    .eq("id", session.id);

  if (callbackError) throw callbackError;

  const asaasPayload = {
    billingTypes: ["CREDIT_CARD"],
    chargeTypes: ["RECURRENT"],
    minutesToExpire: DEFAULT_CHECKOUT_EXPIRATION_MINUTES,
    externalReference: session.external_reference,
    callback: {
      successUrl: callbackUrls.success_url,
      cancelUrl: callbackUrls.cancel_url,
      expiredUrl: callbackUrls.expired_url,
    },
    items: [
      {
        name: targetPlan.name,
        description: `Assinatura mensal AllinPass - ${targetPlan.name}`,
        quantity: 1,
        value: targetPlan.base_price_cents / 100,
      },
    ],
    subscription: {
      cycle: "MONTHLY",
      nextDueDate: formatAsaasDate(new Date()),
    },
  };

  const asaasResponse = await fetch(`${getAsaasApiBaseUrl()}/checkouts`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "access_token": asaasApiKey,
      "User-Agent": "AllinPass/1.0",
    },
    body: JSON.stringify(asaasPayload),
  });

  const asaasBody = await asaasResponse.json().catch(() => ({}));
  if (!asaasResponse.ok) {
    const message = getAsaasErrorMessage(asaasBody) || "Nao foi possivel criar o checkout de mudanca de plano.";
    await supabaseAdmin
      .from("billing_plan_change_sessions")
      .update({
        status: "failed",
        metadata: {
          origin: "billing_start_plan_change",
          mode: "checkout",
          asaas_request: asaasPayload,
          asaas_response: asaasBody,
        },
      })
      .eq("id", session.id);

    throw new BillingPlanChangeError("BILLING_PLAN_CHANGE_ASAAS_ERROR", message, 502);
  }

  const providerCheckoutId = String((asaasBody as { id?: unknown }).id ?? "").trim();
  if (!providerCheckoutId) {
    throw new BillingPlanChangeError(
      "BILLING_PLAN_CHANGE_ASAAS_MISSING_ID",
      "Asaas nao retornou o ID do checkout.",
      502,
    );
  }

  const checkoutUrl = String((asaasBody as { link?: unknown }).link ?? "").trim()
    || buildCheckoutUrl(providerCheckoutId);

  const { error: updateError } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .update({
      provider_checkout_id: providerCheckoutId,
      checkout_url: checkoutUrl,
      status: "created",
      metadata: {
        origin: "billing_start_plan_change",
        mode: "checkout",
        email,
        asaas_request: asaasPayload,
        asaas_response: asaasBody,
        callback_urls: callbackUrls,
      },
    })
    .eq("id", session.id);

  if (updateError) throw updateError;

  return {
    success: true,
    mode: "checkout",
    plan_change_session_id: session.id,
    provider: "asaas",
    provider_checkout_id: providerCheckoutId,
    checkout_url: checkoutUrl,
    expires_at: session.expires_at,
    applied: false,
    scheduled: effectiveMode === "next_cycle",
    effective_mode: effectiveMode,
  };
}

async function updateAsaasSubscription({
  supabaseAdmin,
  asaasApiKey,
  userId,
  subscription,
  targetPlan,
  changeType,
}: {
  supabaseAdmin: SupabaseAdmin;
  asaasApiKey: string;
  userId: string;
  subscription: BillingSubscription;
  targetPlan: BillingPlan;
  changeType: string;
}) {
  const externalReference = crypto.randomUUID();
  const isNoChargePlan = Number(targetPlan.base_price_cents || 0) <= 0;
  const effectiveMode = getPlanChangeEffectiveMode(changeType);
  const currentProviderSubscriptionId = await resolveAsaasSubscriptionId({
    asaasApiKey,
    subscription,
  });
  const asaasPayload = isNoChargePlan
    ? {
      status: "INACTIVE",
      description: `Assinatura mensal AllinPass - ${targetPlan.name}`,
      updatePendingPayments: effectiveMode === "immediate",
    }
    : {
      value: targetPlan.base_price_cents / 100,
      cycle: "MONTHLY",
      description: `Assinatura mensal AllinPass - ${targetPlan.name}`,
      updatePendingPayments: effectiveMode === "immediate",
    };

  const asaasResponse = await fetch(
    `${getAsaasApiBaseUrl()}/subscriptions/${encodeURIComponent(currentProviderSubscriptionId)}`,
    {
      method: "PUT",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "access_token": asaasApiKey,
        "User-Agent": "AllinPass/1.0",
      },
      body: JSON.stringify(asaasPayload),
    },
  );

  const asaasBody = await asaasResponse.json().catch(() => ({}));
  if (!asaasResponse.ok) {
    const message = getAsaasErrorMessage(asaasBody) || "Nao foi possivel atualizar a assinatura no Asaas.";
    throw new BillingPlanChangeError("BILLING_PLAN_CHANGE_ASAAS_ERROR", message, 502);
  }

  const providerSubscriptionId = readProviderId(asaasBody) ?? currentProviderSubscriptionId;
  const providerCustomerId = readProviderId((asaasBody as { customer?: unknown }).customer);

  const { data: sessionData, error: sessionError } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .insert({
      project_id: subscription.project_id,
      subscription_id: subscription.id,
      previous_plan_id: subscription.plan_id,
      new_plan_id: targetPlan.id,
      requested_by: userId,
      change_type: changeType,
      effective_mode: effectiveMode,
      provider: "asaas",
      provider_subscription_id: providerSubscriptionId,
      provider_customer_id: providerCustomerId,
      external_reference: externalReference,
      status: "paid",
      amount_cents: 0,
      currency: "BRL",
      paid_at: new Date().toISOString(),
      metadata: {
        origin: "billing_start_plan_change",
        mode: isNoChargePlan ? "subscription_deactivation" : "subscription_update",
        target_plan_code: targetPlan.code,
        asaas_request: asaasPayload,
        asaas_response: asaasBody,
      },
    })
    .select("id")
    .single();

  if (sessionError) throw sessionError;
  const session = sessionData as { id: string };

  if (effectiveMode === "next_cycle") {
    return {
      success: true,
      mode: isNoChargePlan ? "subscription_deactivation" : "subscription_update",
      plan_change_session_id: session.id,
      applied: false,
      scheduled: effectiveMode === "next_cycle",
      effective_mode: effectiveMode,
    };
  }

  const applied = await applyBillingPlanChange(supabaseAdmin, session.id, userId, {
    providerSubscriptionId,
    providerCustomerId,
  });

  return {
    success: true,
    mode: isNoChargePlan ? "subscription_deactivation" : "subscription_update",
    plan_change_session_id: session.id,
    applied: true,
    scheduled: false,
    effective_mode: effectiveMode,
    result: applied,
  };
}

async function applyNoChargePlanChange({
  supabaseAdmin,
  userId,
  subscription,
  targetPlan,
  changeType,
}: {
  supabaseAdmin: SupabaseAdmin;
  userId: string;
  subscription: BillingSubscription;
  targetPlan: BillingPlan;
  changeType: string;
}) {
  const effectiveMode = getPlanChangeEffectiveMode(changeType);
  const { data: sessionData, error: sessionError } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .insert({
      project_id: subscription.project_id,
      subscription_id: subscription.id,
      previous_plan_id: subscription.plan_id,
      new_plan_id: targetPlan.id,
      requested_by: userId,
      change_type: changeType,
      effective_mode: effectiveMode,
      provider: "asaas",
      external_reference: crypto.randomUUID(),
      status: "paid",
      amount_cents: 0,
      currency: "BRL",
      paid_at: new Date().toISOString(),
      metadata: {
        origin: "billing_start_plan_change",
        mode: "no_charge_plan_change",
        target_plan_code: targetPlan.code,
      },
    })
    .select("id")
    .single();

  if (sessionError) throw sessionError;
  const session = sessionData as { id: string };

  if (effectiveMode === "next_cycle") {
    return {
      success: true,
      mode: "no_charge_plan_change",
      plan_change_session_id: session.id,
      applied: false,
      scheduled: effectiveMode === "next_cycle",
      effective_mode: effectiveMode,
    };
  }

  const applied = await applyBillingPlanChange(supabaseAdmin, session.id, userId);

  return {
    success: true,
    mode: "no_charge_plan_change",
    plan_change_session_id: session.id,
    applied: true,
    scheduled: false,
    effective_mode: effectiveMode,
    result: applied,
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
      new BillingPlanChangeError("BILLING_PLAN_CHANGE_METHOD_NOT_ALLOWED", "Metodo nao permitido.", 405),
    );
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const supabaseAnonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader.startsWith("Bearer ")) {
      throw new BillingPlanChangeError(
        "BILLING_PLAN_CHANGE_MISSING_AUTHORIZATION",
        "Sessao obrigatoria para alterar o plano.",
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
      throw new BillingPlanChangeError(
        "BILLING_PLAN_CHANGE_INVALID_SESSION",
        "Sessao invalida ou expirada.",
        401,
      );
    }

    const payload = await req.json().catch(() => ({}));
    const projectId = String(payload.projectId ?? "").trim();
    const planCode = normalizePlanCode(payload.planCode);

    if (!projectId) {
      throw new BillingPlanChangeError(
        "BILLING_PLAN_CHANGE_MISSING_PROJECT",
        "Informe o projeto para alterar o plano.",
        400,
      );
    }

    if (!planCode) {
      throw new BillingPlanChangeError(
        "BILLING_PLAN_CHANGE_UNSUPPORTED_PLAN",
        "Selecione um plano para alterar.",
        400,
      );
    }

    if (planCode === FREE_PLAN_CODE) {
      throw new BillingPlanChangeError(
        "BILLING_PLAN_CHANGE_UNSUPPORTED_PLAN",
        "Free trial nao pode ser destino de mudanca de plano.",
        400,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await requireOwnerMembership(supabaseAdmin, projectId, user.id);

    const [subscription, targetPlan] = await Promise.all([
      getCurrentSubscription(supabaseAdmin, projectId),
      getTargetPlan(supabaseAdmin, planCode),
    ]);

    if (subscription.plan_id === targetPlan.id) {
      throw new BillingPlanChangeError(
        "BILLING_PLAN_CHANGE_ALREADY_ON_PLAN",
        "Este projeto ja esta neste plano.",
        409,
      );
    }

    const currentPriceCents = Number(subscription.base_price_cents || subscription.billing_plans?.base_price_cents || 0);
    const targetPriceCents = Number(targetPlan.base_price_cents || 0);
    const changeType = getPlanChangeType(subscription, targetPlan);

    const reusableSession = await findReusableSession(supabaseAdmin, subscription, targetPlan);
    if (reusableSession?.status === "paid") {
      const applied = await applyBillingPlanChange(supabaseAdmin, reusableSession.id, user.id);
      const scheduled = Boolean((applied as { scheduled?: unknown } | null)?.scheduled);
      return jsonResponse(origin, {
        success: true,
        mode: "reused_paid_session",
        plan_change_session_id: reusableSession.id,
        applied: !scheduled,
        scheduled,
        result: applied,
      });
    }

    if (reusableSession?.checkout_url) {
      const expiresAtMs = reusableSession.expires_at ? Date.parse(reusableSession.expires_at) : 0;
      if (!Number.isFinite(expiresAtMs) || expiresAtMs > Date.now()) {
        return jsonResponse(origin, {
          success: true,
          mode: "checkout",
          plan_change_session_id: reusableSession.id,
          provider: "asaas",
          provider_checkout_id: reusableSession.provider_checkout_id,
          checkout_url: reusableSession.checkout_url,
          expires_at: reusableSession.expires_at,
          reused: true,
          applied: false,
        });
      }
    }

    const email = String(user.email ?? "").trim().toLowerCase();
    const hasExistingAsaasSubscription =
      subscription.gateway_provider === "asaas"
      && currentPriceCents > 0;
    const asaasApiKey = hasExistingAsaasSubscription || targetPriceCents > 0
      ? requiredEnv("ASAAS_API_KEY")
      : "";

    const result = hasExistingAsaasSubscription
      ? await updateAsaasSubscription({
        supabaseAdmin,
        asaasApiKey,
        userId: user.id,
        subscription,
        targetPlan,
        changeType,
      })
      : targetPriceCents <= 0
        ? await applyNoChargePlanChange({
          supabaseAdmin,
          userId: user.id,
          subscription,
          targetPlan,
          changeType,
        })
        : await createPlanChangeCheckout({
          supabaseAdmin,
          asaasApiKey,
          origin,
          userId: user.id,
          email,
          subscription,
          targetPlan,
          changeType,
        });

    return jsonResponse(origin, result);
  } catch (error) {
    console.error("billing-start-plan-change error", error);

    if (error instanceof BillingPlanChangeError) {
      return errorResponse(origin, error);
    }

    return errorResponse(
      origin,
      new BillingPlanChangeError(
        "BILLING_PLAN_CHANGE_INTERNAL_ERROR",
        "Erro interno ao alterar plano.",
        500,
      ),
    );
  }
});
