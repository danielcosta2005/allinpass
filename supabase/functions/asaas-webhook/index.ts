import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

function jsonResponse(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function normalizeEvent(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeCheckoutStatus(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function getLocalStatus(event: string, checkoutStatus: string) {
  if (event === "CHECKOUT_PAID" || checkoutStatus === "PAID") return "paid";
  if (event === "CHECKOUT_CANCELED" || checkoutStatus === "CANCELED") return "canceled";
  if (event === "CHECKOUT_EXPIRED" || checkoutStatus === "EXPIRED") return "expired";
  if (event === "CHECKOUT_CREATED" || checkoutStatus === "ACTIVE") return "created";
  return "";
}

function getDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return new Date().toISOString();
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function readString(value: unknown) {
  return String(value ?? "").trim();
}

function readProviderId(value: unknown) {
  if (typeof value === "string") return readString(value) || null;
  if (value && typeof value === "object" && "id" in value) {
    return readString((value as { id?: unknown }).id) || null;
  }
  return null;
}

type SupabaseAdmin = ReturnType<typeof createClient>;

async function handleSignupCheckoutWebhook(
  supabaseAdmin: SupabaseAdmin,
  providerCheckoutId: string,
  localStatus: string,
  payload: unknown,
  checkout: Record<string, unknown>,
) {
  const { data: sessionData, error: sessionError } = await supabaseAdmin
    .from("signup_checkout_sessions")
    .select("id, metadata")
    .eq("provider", "asaas")
    .eq("provider_checkout_id", providerCheckoutId)
    .neq("status", "finalized")
    .maybeSingle();

  if (sessionError) throw sessionError;
  if (!sessionData) return false;

  const currentMetadata =
    sessionData.metadata && typeof sessionData.metadata === "object" && !Array.isArray(sessionData.metadata)
      ? sessionData.metadata as Record<string, unknown>
      : {};

  const updatePayload: Record<string, unknown> = {
    status: localStatus,
    metadata: {
      ...currentMetadata,
      last_asaas_webhook: payload,
    },
  };

  if (localStatus === "paid") {
    updatePayload.paid_at = getDate((payload as { dateCreated?: unknown }).dateCreated);
    updatePayload.provider_customer_id = readProviderId(checkout.customer);
    updatePayload.provider_subscription_id = readProviderId(checkout.subscription);
    updatePayload.provider_payment_id = readProviderId(checkout.payment);
  }

  const { error } = await supabaseAdmin
    .from("signup_checkout_sessions")
    .update(updatePayload)
    .eq("id", sessionData.id);

  if (error) throw error;
  return true;
}

async function handlePlanChangeCheckoutWebhook(
  supabaseAdmin: SupabaseAdmin,
  providerCheckoutId: string,
  localStatus: string,
  payload: unknown,
  checkout: Record<string, unknown>,
) {
  const { data: sessionData, error: sessionError } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .select("id, requested_by, metadata")
    .eq("provider", "asaas")
    .eq("provider_checkout_id", providerCheckoutId)
    .neq("status", "applied")
    .maybeSingle();

  if (sessionError) throw sessionError;
  if (!sessionData) return false;

  const currentMetadata =
    sessionData.metadata && typeof sessionData.metadata === "object" && !Array.isArray(sessionData.metadata)
      ? sessionData.metadata as Record<string, unknown>
      : {};

  const providerCustomerId = readProviderId(checkout.customer);
  const providerSubscriptionId = readProviderId(checkout.subscription);
  const providerPaymentId = readProviderId(checkout.payment);

  const updatePayload: Record<string, unknown> = {
    status: localStatus,
    metadata: {
      ...currentMetadata,
      last_asaas_webhook: payload,
    },
  };

  if (localStatus === "paid") {
    updatePayload.paid_at = getDate((payload as { dateCreated?: unknown }).dateCreated);
    updatePayload.provider_customer_id = providerCustomerId;
    updatePayload.provider_subscription_id = providerSubscriptionId;
    updatePayload.provider_payment_id = providerPaymentId;
  }

  const { error } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .update(updatePayload)
    .eq("id", sessionData.id);

  if (error) throw error;

  if (localStatus === "paid") {
    const { error: applyError } = await supabaseAdmin.rpc("apply_billing_plan_change", {
      p_session_id: sessionData.id,
      p_actor_user_id: sessionData.requested_by ?? null,
      p_provider_subscription_id: providerSubscriptionId,
      p_provider_customer_id: providerCustomerId,
      p_provider_payment_id: providerPaymentId,
    });

    if (applyError) throw applyError;
  }

  return true;
}

async function handleSubscriptionWebhook(
  supabaseAdmin: SupabaseAdmin,
  event: string,
  payload: unknown,
) {
  if (event === "SUBSCRIPTION_UPDATED") {
    // Keep handling below; the explicit branch documents the Asaas upgrade sync event.
  }
  if (!event.startsWith("SUBSCRIPTION_")) return false;

  const subscription = (payload as { subscription?: Record<string, unknown> }).subscription ?? {};
  const providerSubscriptionId = readProviderId(subscription);
  if (!providerSubscriptionId) return false;

  const { data: subscriptionData, error: subscriptionError } = await supabaseAdmin
    .from("billing_subscriptions")
    .select("id, metadata")
    .eq("gateway_provider", "asaas")
    .eq("gateway_subscription_id", providerSubscriptionId)
    .maybeSingle();

  if (subscriptionError) throw subscriptionError;
  if (!subscriptionData) return false;

  const currentMetadata =
    subscriptionData.metadata && typeof subscriptionData.metadata === "object" && !Array.isArray(subscriptionData.metadata)
      ? subscriptionData.metadata as Record<string, unknown>
      : {};

  const statusPatch: Record<string, unknown> = {};
  if (event === "SUBSCRIPTION_INACTIVATED" || event === "SUBSCRIPTION_DELETED") {
    statusPatch.status = "canceled";
    statusPatch.canceled_at = new Date().toISOString();
    statusPatch.ended_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from("billing_subscriptions")
    .update({
      ...statusPatch,
      metadata: {
        ...currentMetadata,
        last_asaas_subscription_webhook: payload,
      },
    })
    .eq("id", subscriptionData.id);

  if (error) throw error;
  return true;
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
    const webhookToken = String(Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "").trim();
    if (webhookToken) {
      const receivedToken = String(req.headers.get("asaas-access-token") ?? "").trim();
      if (receivedToken !== webhookToken) {
        return jsonResponse(origin, { error: "Webhook nao autorizado." }, 401);
      }
    }

    const supabaseAdmin = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const payload = await req.json().catch(() => ({}));
    const event = normalizeEvent((payload as { event?: unknown }).event);
    const checkout = (payload as { checkout?: Record<string, unknown> }).checkout ?? {};
    const providerCheckoutId = String(checkout.id ?? "").trim();
    const checkoutStatus = normalizeCheckoutStatus(checkout.status);
    const localStatus = getLocalStatus(event, checkoutStatus);

    if (await handleSubscriptionWebhook(supabaseAdmin, event, payload)) {
      return jsonResponse(origin, { received: true });
    }

    if (!providerCheckoutId || !localStatus) {
      return jsonResponse(origin, { received: true, ignored: true });
    }

    if (await handleSignupCheckoutWebhook(supabaseAdmin, providerCheckoutId, localStatus, payload, checkout)) {
      return jsonResponse(origin, { received: true });
    }

    if (await handlePlanChangeCheckoutWebhook(supabaseAdmin, providerCheckoutId, localStatus, payload, checkout)) {
      return jsonResponse(origin, { received: true });
    }

    return jsonResponse(origin, { received: true, ignored: true });
  } catch (error) {
    console.error("asaas-webhook error", error);
    return jsonResponse(origin, { error: "Erro interno no webhook." }, 500);
  }
});
