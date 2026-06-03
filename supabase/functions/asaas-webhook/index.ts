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

function normalizeAsaasStatus(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function getCheckoutLocalStatus(event: string, checkoutStatus: string) {
  if (event === "CHECKOUT_PAID" || checkoutStatus === "PAID") return "paid";
  if (event === "CHECKOUT_CANCELED" || checkoutStatus === "CANCELED") return "canceled";
  if (event === "CHECKOUT_EXPIRED" || checkoutStatus === "EXPIRED") return "expired";
  if (event === "CHECKOUT_CREATED" || checkoutStatus === "ACTIVE") return "created";
  return "";
}

function isPaidPaymentEvent(event: string, paymentStatus: string) {
  return event === "PAYMENT_CONFIRMED" ||
    event === "PAYMENT_RECEIVED" ||
    paymentStatus === "CONFIRMED" ||
    paymentStatus === "RECEIVED" ||
    paymentStatus === "PAID";
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readProviderId(value: unknown) {
  if (typeof value === "string") return readString(value) || null;
  if (value && typeof value === "object" && "id" in value) {
    return readString((value as { id?: unknown }).id) || null;
  }
  return null;
}

function readFirstProviderId(...values: unknown[]) {
  for (const value of values) {
    const id = readProviderId(value);
    if (id) return id;
  }
  return null;
}

function readFirstString(...values: unknown[]) {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return null;
}

function isAsaasSubscriptionId(value: unknown) {
  return /^sub_[a-z0-9]+$/i.test(readString(value));
}

type SupabaseAdmin = any;

type SessionMatch = {
  id: string;
  status: string;
  requested_by?: string | null;
  provider_subscription_id?: string | null;
  provider_customer_id?: string | null;
  provider_payment_id?: string | null;
  metadata: Record<string, unknown> | null;
};

type BillingSubscriptionWebhookMatch = {
  id: string;
  project_id: string;
  billing_account_id: string;
  metadata: Record<string, unknown> | null;
  gateway_subscription_id?: string | null;
};

function getMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function buildProviderPatch({
  providerCustomerId,
  providerSubscriptionId,
  providerPaymentId,
}: {
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  providerPaymentId?: string | null;
}) {
  const patch: Record<string, unknown> = {};
  if (providerCustomerId) patch.provider_customer_id = providerCustomerId;
  if (providerSubscriptionId) patch.provider_subscription_id = providerSubscriptionId;
  if (providerPaymentId) patch.provider_payment_id = providerPaymentId;
  return patch;
}

async function findSessionByProviderData(
  supabaseAdmin: SupabaseAdmin,
  table: string,
  selectColumns: string,
  identifiers: {
    providerCheckoutId?: string | null;
    externalReference?: string | null;
    providerPaymentId?: string | null;
    providerSubscriptionId?: string | null;
  },
): Promise<SessionMatch | null> {
  const lookups = [
    ["provider_payment_id", identifiers.providerPaymentId],
    ["provider_checkout_id", identifiers.providerCheckoutId],
    ["provider_subscription_id", identifiers.providerSubscriptionId],
    ["external_reference", identifiers.externalReference],
  ] as const;

  for (const [column, value] of lookups) {
    if (!value) continue;
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(selectColumns)
      .eq("provider", "asaas")
      .eq(column, value)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data as SessionMatch;
  }

  return null;
}

async function syncFinalizedSignupBillingFromSession(
  supabaseAdmin: SupabaseAdmin,
  checkoutSessionId: string,
  providerIds: {
    providerCustomerId?: string | null;
    providerSubscriptionId?: string | null;
  },
  payload: unknown,
) {
  if (!providerIds.providerCustomerId && !providerIds.providerSubscriptionId) return false;

  const { data: subscriptionData, error: subscriptionError } = await supabaseAdmin
    .from("billing_subscriptions")
    .select("id, project_id, billing_account_id, metadata, gateway_subscription_id")
    .eq("metadata->>checkout_session_id", checkoutSessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError) throw subscriptionError;
  const localSubscription = subscriptionData as BillingSubscriptionWebhookMatch | null;
  if (!localSubscription) return false;

  const subscriptionPatch: Record<string, unknown> = {
    gateway_provider: "asaas",
    metadata: {
      ...getMetadata(localSubscription.metadata),
      last_asaas_payment_webhook: payload,
    },
  };

  if (providerIds.providerSubscriptionId && !isAsaasSubscriptionId(localSubscription.gateway_subscription_id)) {
    subscriptionPatch.gateway_subscription_id = providerIds.providerSubscriptionId;
  }

  const { error: updateSubscriptionError } = await supabaseAdmin
    .from("billing_subscriptions")
    .update(subscriptionPatch)
    .eq("id", localSubscription.id);

  if (updateSubscriptionError) throw updateSubscriptionError;

  if (providerIds.providerCustomerId) {
    const { error: accountError } = await supabaseAdmin
      .from("billing_accounts")
      .update({
        gateway_provider: "asaas",
        gateway_customer_id: providerIds.providerCustomerId,
      })
      .eq("id", localSubscription.billing_account_id)
      .eq("project_id", localSubscription.project_id);

    if (accountError) throw accountError;
  }

  return true;
}

async function applyPlanChangeIfReady(
  supabaseAdmin: SupabaseAdmin,
  session: SessionMatch,
  providerIds: {
    providerCustomerId?: string | null;
    providerSubscriptionId?: string | null;
    providerPaymentId?: string | null;
  } = {},
) {
  if (session.status === "applied") return true;

  const providerSubscriptionId = providerIds.providerSubscriptionId || session.provider_subscription_id || null;
  const providerCustomerId = providerIds.providerCustomerId || session.provider_customer_id || null;
  const providerPaymentId = providerIds.providerPaymentId || session.provider_payment_id || null;

  if (!providerSubscriptionId || !providerCustomerId) return false;

  const { error: applyError } = await supabaseAdmin.rpc("apply_billing_plan_change", {
    p_session_id: session.id,
    p_actor_user_id: session.requested_by ?? null,
    p_provider_subscription_id: providerSubscriptionId,
    p_provider_customer_id: providerCustomerId,
    p_provider_payment_id: providerPaymentId,
  });

  if (applyError) throw applyError;
  return true;
}

async function updateSignupSessionFromProvider(
  supabaseAdmin: SupabaseAdmin,
  session: SessionMatch,
  options: {
    nextStatus?: string;
    paidAt?: string | null;
    providerCustomerId?: string | null;
    providerSubscriptionId?: string | null;
    providerPaymentId?: string | null;
    metadataKey: string;
    payload: unknown;
  },
) {
  const updatePayload: Record<string, unknown> = {
    ...buildProviderPatch(options),
    metadata: {
      ...getMetadata(session.metadata),
      [options.metadataKey]: options.payload,
    },
  };

  if (options.nextStatus && session.status !== "finalized") updatePayload.status = options.nextStatus;
  if (options.paidAt) updatePayload.paid_at = options.paidAt;

  const { error } = await supabaseAdmin
    .from("signup_checkout_sessions")
    .update(updatePayload)
    .eq("id", session.id);

  if (error) throw error;

  if (session.status === "finalized") {
    await syncFinalizedSignupBillingFromSession(
      supabaseAdmin,
      session.id,
      {
        providerCustomerId: options.providerCustomerId || session.provider_customer_id || null,
        providerSubscriptionId: options.providerSubscriptionId || session.provider_subscription_id || null,
      },
      options.payload,
    );
  }
}

async function updatePlanChangeSessionFromProvider(
  supabaseAdmin: SupabaseAdmin,
  session: SessionMatch,
  options: {
    nextStatus?: string;
    paidAt?: string | null;
    providerCustomerId?: string | null;
    providerSubscriptionId?: string | null;
    providerPaymentId?: string | null;
    metadataKey: string;
    payload: unknown;
    applyWhenReady?: boolean;
  },
) {
  const updatePayload: Record<string, unknown> = {
    ...buildProviderPatch(options),
    metadata: {
      ...getMetadata(session.metadata),
      [options.metadataKey]: options.payload,
    },
  };

  if (options.nextStatus && session.status !== "applied") updatePayload.status = options.nextStatus;
  if (options.paidAt) updatePayload.paid_at = options.paidAt;

  const { error } = await supabaseAdmin
    .from("billing_plan_change_sessions")
    .update(updatePayload)
    .eq("id", session.id);

  if (error) throw error;

  const shouldApply = options.applyWhenReady ||
    session.status === "paid" ||
    options.nextStatus === "paid";

  if (shouldApply) {
    await applyPlanChangeIfReady(supabaseAdmin, session, {
      providerCustomerId: options.providerCustomerId || session.provider_customer_id || null,
      providerSubscriptionId: options.providerSubscriptionId || session.provider_subscription_id || null,
      providerPaymentId: options.providerPaymentId || session.provider_payment_id || null,
    });
  }
}

async function handleSignupCheckoutWebhook(
  supabaseAdmin: SupabaseAdmin,
  providerCheckoutId: string,
  localStatus: string,
  payload: unknown,
  checkout: Record<string, unknown>,
) {
  const session = await findSessionByProviderData(
    supabaseAdmin,
    "signup_checkout_sessions",
    "id, status, metadata, provider_subscription_id, provider_customer_id, provider_payment_id, created_at",
    { providerCheckoutId },
  );

  if (!session || session.status === "finalized") return false;

  const providerCustomerId = readProviderId(checkout.customer);
  const providerSubscriptionId = readProviderId(checkout.subscription);
  const providerPaymentId = readProviderId(checkout.payment);
  const paidAt = localStatus === "paid" ? getDate((payload as { dateCreated?: unknown }).dateCreated) : null;

  await updateSignupSessionFromProvider(supabaseAdmin, session, {
    nextStatus: localStatus,
    paidAt,
    providerCustomerId,
    providerSubscriptionId,
    providerPaymentId,
    metadataKey: "last_asaas_webhook",
    payload,
  });

  return true;
}

async function handlePlanChangeCheckoutWebhook(
  supabaseAdmin: SupabaseAdmin,
  providerCheckoutId: string,
  localStatus: string,
  payload: unknown,
  checkout: Record<string, unknown>,
) {
  const session = await findSessionByProviderData(
    supabaseAdmin,
    "billing_plan_change_sessions",
    [
      "id",
      "status",
      "requested_by",
      "metadata",
      "provider_subscription_id",
      "provider_customer_id",
      "provider_payment_id",
      "created_at",
    ].join(", "),
    { providerCheckoutId },
  );

  if (!session || session.status === "applied") return false;

  const providerCustomerId = readProviderId(checkout.customer);
  const providerSubscriptionId = readProviderId(checkout.subscription);
  const providerPaymentId = readProviderId(checkout.payment);
  const paidAt = localStatus === "paid" ? getDate((payload as { dateCreated?: unknown }).dateCreated) : null;

  await updatePlanChangeSessionFromProvider(supabaseAdmin, session, {
    nextStatus: localStatus,
    paidAt,
    providerCustomerId,
    providerSubscriptionId,
    providerPaymentId,
    metadataKey: "last_asaas_webhook",
    payload,
    applyWhenReady: localStatus === "paid",
  });

  return true;
}

async function updateSessionsFromSubscriptionWebhook(
  supabaseAdmin: SupabaseAdmin,
  payload: unknown,
  subscription: Record<string, unknown>,
  providerSubscriptionId: string,
  providerCustomerId: string | null,
) {
  let handled = false;
  const externalReference = readFirstString(
    subscription.externalReference,
    subscription.external_reference,
    (payload as { externalReference?: unknown }).externalReference,
  );

  const identifiers = { providerSubscriptionId, externalReference };

  const signupSession = await findSessionByProviderData(
    supabaseAdmin,
    "signup_checkout_sessions",
    "id, status, metadata, provider_subscription_id, provider_customer_id, provider_payment_id, created_at",
    identifiers,
  );
  if (signupSession) {
    await updateSignupSessionFromProvider(supabaseAdmin, signupSession, {
      providerCustomerId,
      providerSubscriptionId,
      metadataKey: "last_asaas_subscription_webhook",
      payload,
    });
    handled = true;
  }

  const planChangeSession = await findSessionByProviderData(
    supabaseAdmin,
    "billing_plan_change_sessions",
    [
      "id",
      "status",
      "requested_by",
      "metadata",
      "provider_subscription_id",
      "provider_customer_id",
      "provider_payment_id",
      "created_at",
    ].join(", "),
    identifiers,
  );
  if (planChangeSession) {
    await updatePlanChangeSessionFromProvider(supabaseAdmin, planChangeSession, {
      providerCustomerId,
      providerSubscriptionId,
      metadataKey: "last_asaas_subscription_webhook",
      payload,
      applyWhenReady: planChangeSession.status === "paid",
    });
    handled = true;
  }

  return handled;
}

async function handleSubscriptionWebhook(
  supabaseAdmin: SupabaseAdmin,
  event: string,
  payload: unknown,
) {
  if (!event.startsWith("SUBSCRIPTION_")) return false;

  const subscription = asRecord((payload as { subscription?: unknown }).subscription);
  const providerSubscriptionId = readProviderId(subscription);
  if (!providerSubscriptionId) return false;
  const providerCustomerId = readProviderId(subscription.customer);

  const handledSession = await updateSessionsFromSubscriptionWebhook(
    supabaseAdmin,
    payload,
    subscription,
    providerSubscriptionId,
    providerCustomerId,
  );

  const { data: subscriptionData, error: subscriptionError } = await supabaseAdmin
    .from("billing_subscriptions")
    .select("id, project_id, billing_account_id, metadata, gateway_subscription_id")
    .eq("gateway_provider", "asaas")
    .eq("gateway_subscription_id", providerSubscriptionId)
    .maybeSingle();

  if (subscriptionError) throw subscriptionError;
  let localSubscription = subscriptionData as BillingSubscriptionWebhookMatch | null;

  if (!localSubscription && providerCustomerId) {
    const { data: accountData, error: accountError } = await supabaseAdmin
      .from("billing_accounts")
      .select("id, project_id")
      .eq("gateway_provider", "asaas")
      .eq("gateway_customer_id", providerCustomerId)
      .limit(5);

    if (accountError) throw accountError;

    for (const account of accountData ?? []) {
      const { data: candidateData, error: candidateError } = await supabaseAdmin
        .from("billing_subscriptions")
        .select("id, project_id, billing_account_id, metadata, gateway_subscription_id")
        .eq("billing_account_id", account.id)
        .eq("project_id", account.project_id)
        .eq("gateway_provider", "asaas")
        .in("status", ["trialing", "active", "past_due", "paused"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (candidateError) throw candidateError;
      if (
        candidateData &&
        (
          !isAsaasSubscriptionId(candidateData.gateway_subscription_id) ||
          candidateData.gateway_subscription_id === providerSubscriptionId
        )
      ) {
        localSubscription = candidateData as BillingSubscriptionWebhookMatch;
        break;
      }
    }
  }

  if (!localSubscription) return handledSession;

  const statusPatch: Record<string, unknown> = {
    metadata: {
      ...getMetadata(localSubscription.metadata),
      last_asaas_subscription_webhook: payload,
    },
  };
  if (!isAsaasSubscriptionId(localSubscription.gateway_subscription_id)) {
    statusPatch.gateway_subscription_id = providerSubscriptionId;
  }
  if (event === "SUBSCRIPTION_INACTIVATED" || event === "SUBSCRIPTION_DELETED") {
    statusPatch.status = "canceled";
    statusPatch.canceled_at = new Date().toISOString();
    statusPatch.ended_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from("billing_subscriptions")
    .update(statusPatch)
    .eq("id", localSubscription.id);

  if (error) throw error;

  if (providerCustomerId) {
    const { error: accountError } = await supabaseAdmin
      .from("billing_accounts")
      .update({
        gateway_provider: "asaas",
        gateway_customer_id: providerCustomerId,
      })
      .eq("id", localSubscription.billing_account_id)
      .eq("project_id", localSubscription.project_id);

    if (accountError) throw accountError;
  }

  return true;
}

async function handlePaymentWebhook(
  supabaseAdmin: SupabaseAdmin,
  event: string,
  payload: unknown,
) {
  if (!event.startsWith("PAYMENT_")) return false;

  const payment = asRecord((payload as { payment?: unknown }).payment);
  const providerPaymentId = readProviderId(payment);
  const providerCustomerId = readProviderId(payment.customer);
  const providerSubscriptionId = readProviderId(payment.subscription);
  const providerCheckoutId = readFirstProviderId(
    payment.checkoutSession,
    payment.checkout,
    payment.checkoutSessionId,
    payment.checkoutId,
  );
  const externalReference = readFirstString(
    payment.externalReference,
    payment.external_reference,
    (payload as { externalReference?: unknown }).externalReference,
  );
  const paymentStatus = normalizeAsaasStatus(payment.status);
  const isPaid = isPaidPaymentEvent(event, paymentStatus);
  const paidAt = isPaid
    ? getDate(payment.confirmedDate ?? payment.clientPaymentDate ?? payment.paymentDate ?? (payload as { dateCreated?: unknown }).dateCreated)
    : null;

  if (!providerPaymentId && !providerCheckoutId && !externalReference && !providerSubscriptionId) return false;

  let handled = false;
  const identifiers = {
    providerCheckoutId,
    externalReference,
    providerPaymentId,
    providerSubscriptionId,
  };

  const signupSession = await findSessionByProviderData(
    supabaseAdmin,
    "signup_checkout_sessions",
    "id, status, metadata, provider_subscription_id, provider_customer_id, provider_payment_id, created_at",
    identifiers,
  );

  if (signupSession) {
    await updateSignupSessionFromProvider(supabaseAdmin, signupSession, {
      nextStatus: isPaid ? "paid" : undefined,
      paidAt,
      providerCustomerId,
      providerSubscriptionId,
      providerPaymentId,
      metadataKey: "last_asaas_payment_webhook",
      payload,
    });
    handled = true;
  }

  const planChangeSession = await findSessionByProviderData(
    supabaseAdmin,
    "billing_plan_change_sessions",
    [
      "id",
      "status",
      "requested_by",
      "metadata",
      "provider_subscription_id",
      "provider_customer_id",
      "provider_payment_id",
      "created_at",
    ].join(", "),
    identifiers,
  );

  if (planChangeSession) {
    await updatePlanChangeSessionFromProvider(supabaseAdmin, planChangeSession, {
      nextStatus: isPaid ? "paid" : undefined,
      paidAt,
      providerCustomerId,
      providerSubscriptionId,
      providerPaymentId,
      metadataKey: "last_asaas_payment_webhook",
      payload,
      applyWhenReady: isPaid || planChangeSession.status === "paid",
    });
    handled = true;
  }

  return handled;
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
    const checkout = asRecord((payload as { checkout?: unknown }).checkout);
    const providerCheckoutId = String(checkout.id ?? "").trim();
    const checkoutStatus = normalizeAsaasStatus(checkout.status);
    const localStatus = getCheckoutLocalStatus(event, checkoutStatus);

    if (await handlePaymentWebhook(supabaseAdmin, event, payload)) {
      return jsonResponse(origin, { received: true });
    }

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
