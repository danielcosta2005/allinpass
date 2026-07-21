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
  if (event === "CHECKOUT_CANCELED" || checkoutStatus === "CANCELED") {
    return "canceled";
  }
  if (event === "CHECKOUT_EXPIRED" || checkoutStatus === "EXPIRED") {
    return "expired";
  }
  if (event === "CHECKOUT_CREATED" || checkoutStatus === "ACTIVE") {
    return "created";
  }
  return "";
}

function isPaidPaymentEvent(event: string, paymentStatus: string) {
  return event === "PAYMENT_CONFIRMED" ||
    event === "PAYMENT_RECEIVED" ||
    paymentStatus === "CONFIRMED" ||
    paymentStatus === "RECEIVED" ||
    paymentStatus === "RECEIVED_IN_CASH" ||
    paymentStatus === "PAID";
}

const DELINQUENCY_GRACE_DAYS = 10;
const PAYMENT_DELINQUENCY_STATUSES = new Set([
  "OVERDUE",
  "REFUSED",
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
]);

const SUBSCRIPTION_EVENTS = new Set([
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_UPDATED",
  "SUBSCRIPTION_INACTIVATED",
  "SUBSCRIPTION_DELETED",
]);

const AFFILIATE_COMMISSION_RATE_BPS = 1000;
const NON_COMMISSIONABLE_SUBSCRIPTION_STATUSES = new Set([
  "canceled",
  "expired",
  "paused",
]);
const NON_COMMISSIONABLE_PAYMENT_EVENTS = new Set([
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_REFUND_IN_PROGRESS",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
]);
const NON_COMMISSIONABLE_PAYMENT_STATUSES = new Set([
  "PENDING",
  "OVERDUE",
  "CANCELED",
  "DELETED",
  "REFUNDED",
  "AWAITING_RISK_ANALYSIS",
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
]);

function isAffiliateCommissionPaidPaymentEvent(
  event: string,
  paymentStatus: string,
) {
  return isPaidPaymentEvent(event, paymentStatus) &&
    !NON_COMMISSIONABLE_PAYMENT_EVENTS.has(event) &&
    !NON_COMMISSIONABLE_PAYMENT_STATUSES.has(paymentStatus);
}

function getDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return new Date().toISOString();
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
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

function readMoneyCents(...values: unknown[]) {
  for (const value of values) {
    const text = readString(value).replace(",", ".");
    if (!text) continue;

    const amount = Number(text);
    if (Number.isFinite(amount) && amount > 0) {
      return Math.round(amount * 100);
    }
  }

  return 0;
}

function getCompetenceMonth(value: string) {
  const date = new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = safeDate.getUTCFullYear();
  const month = String(safeDate.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function isAsaasSubscriptionId(value: unknown) {
  return /^sub_[a-z0-9]+$/i.test(readString(value));
}

function isUniqueViolation(error: any) {
  return error?.code === "23505" ||
    String(error?.message || "").toLowerCase().includes("duplicate key");
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
  plan_id?: string | null;
  status?: string | null;
  base_price_cents?: number | null;
  currency?: string | null;
  metadata: Record<string, unknown> | null;
  gateway_subscription_id?: string | null;
};

type AffiliateAttributionWebhookMatch = {
  id: string;
  seller_id: string;
  link_id: string | null;
  user_id: string | null;
  project_id: string;
  subscription_id: string;
  plan_id: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

type InvoiceCollectionBatchWebhookMatch = {
  id: string;
  subscription_id: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

type BillingSubscriptionDelinquencyMatch = {
  id: string;
  status: string;
  metadata: Record<string, unknown> | null;
  delinquent_since?: string | null;
  grace_ends_at?: string | null;
  delinquency_gateway_charge_id?: string | null;
};

function getMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function addDaysIso(value: string, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function laterIsoDate(currentValue: string | null | undefined, policyValue: string) {
  if (!currentValue) return policyValue;
  const currentTime = new Date(currentValue).getTime();
  const policyTime = new Date(policyValue).getTime();
  if (Number.isNaN(currentTime)) return policyValue;
  if (Number.isNaN(policyTime)) return currentValue;
  return currentTime >= policyTime ? currentValue : policyValue;
}

function isPaymentDelinquencyEvent(event: string, paymentStatus: string) {
  return event === "PAYMENT_OVERDUE" ||
    event === "PAYMENT_FAILED" ||
    PAYMENT_DELINQUENCY_STATUSES.has(paymentStatus);
}

async function findBillingSubscriptionForDelinquency(
  supabaseAdmin: SupabaseAdmin,
  options: {
    localSubscriptionId?: string | null;
    providerSubscriptionId?: string | null;
  },
) {
  const selectColumns = [
    "id",
    "status",
    "metadata",
    "delinquent_since",
    "grace_ends_at",
    "delinquency_gateway_charge_id",
  ].join(", ");

  if (options.localSubscriptionId) {
    const { data, error } = await supabaseAdmin
      .from("billing_subscriptions")
      .select(selectColumns)
      .eq("id", options.localSubscriptionId)
      .in("status", ["active", "past_due", "paused", "suspended"])
      .maybeSingle();

    if (error) throw error;
    if (data) return data as BillingSubscriptionDelinquencyMatch;
  }

  if (!options.providerSubscriptionId) return null;

  const { data, error } = await supabaseAdmin
    .from("billing_subscriptions")
    .select(selectColumns)
    .eq("gateway_provider", "asaas")
    .eq("gateway_subscription_id", options.providerSubscriptionId)
    .in("status", ["active", "past_due", "paused", "suspended"])
    .maybeSingle();

  if (error) throw error;
  return data as BillingSubscriptionDelinquencyMatch | null;
}

async function markSubscriptionPastDueForPayment(
  supabaseAdmin: SupabaseAdmin,
  options: {
    localSubscriptionId?: string | null;
    providerSubscriptionId?: string | null;
    providerPaymentId?: string | null;
    reason: string;
    payload: unknown;
  },
) {
  if (!options.providerPaymentId) return false;

  const subscription = await findBillingSubscriptionForDelinquency(supabaseAdmin, options);
  if (!subscription) return false;

  const nowIso = new Date().toISOString();
  const delinquentSince = subscription.delinquent_since || nowIso;
  const policyGraceEndsAt = addDaysIso(delinquentSince, DELINQUENCY_GRACE_DAYS);
  const graceEndsAt = subscription.status === "suspended"
    ? subscription.grace_ends_at || policyGraceEndsAt
    : laterIsoDate(subscription.grace_ends_at, policyGraceEndsAt);
  const delinquencyGatewayChargeId = subscription.delinquency_gateway_charge_id || options.providerPaymentId;
  const metadata = getMetadata(subscription.metadata);
  const nextStatus = subscription.status === "suspended" ? "suspended" : "past_due";

  const { error } = await supabaseAdmin
    .from("billing_subscriptions")
    .update({
      status: nextStatus,
      delinquent_since: delinquentSince,
      grace_ends_at: graceEndsAt,
      last_payment_failure_at: nowIso,
      delinquency_gateway_charge_id: delinquencyGatewayChargeId,
      delinquency_reason: options.reason,
      metadata: {
        ...metadata,
        last_asaas_delinquency_webhook: options.payload,
        delinquency_grace_days: DELINQUENCY_GRACE_DAYS,
      },
    })
    .eq("id", subscription.id);

  if (error) throw error;
  return true;
}

async function clearSubscriptionDelinquencyForPayment(
  supabaseAdmin: SupabaseAdmin,
  options: {
    localSubscriptionId?: string | null;
    providerSubscriptionId?: string | null;
    providerPaymentId?: string | null;
    payload: unknown;
  },
) {
  if (!options.providerPaymentId) return false;

  const subscription = await findBillingSubscriptionForDelinquency(supabaseAdmin, options);
  if (!subscription) return false;
  if (subscription.delinquency_gateway_charge_id !== options.providerPaymentId) return false;

  const metadata = getMetadata(subscription.metadata);
  const { error } = await supabaseAdmin
    .from("billing_subscriptions")
    .update({
      status: "active",
      delinquent_since: null,
      grace_ends_at: null,
      suspended_at: null,
      last_payment_failure_at: null,
      delinquency_gateway_charge_id: null,
      delinquency_reason: null,
      metadata: {
        ...metadata,
        last_asaas_delinquency_recovery_webhook: options.payload,
      },
    })
    .eq("id", subscription.id);

  if (error) throw error;
  return true;
}

async function reconcileSubscriptionDelinquencyFromPayment(
  supabaseAdmin: SupabaseAdmin,
  options: {
    event: string;
    payload: unknown;
    localSubscriptionId?: string | null;
    providerSubscriptionId?: string | null;
    providerPaymentId?: string | null;
    paymentStatus: string;
    isPaid: boolean;
    reason: string;
  },
) {
  if (options.isPaid) {
    return await clearSubscriptionDelinquencyForPayment(supabaseAdmin, options);
  }

  if (!isPaymentDelinquencyEvent(options.event, options.paymentStatus)) return false;

  return await markSubscriptionPastDueForPayment(supabaseAdmin, options);
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
  if (providerSubscriptionId) {
    patch.provider_subscription_id = providerSubscriptionId;
  }
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
  if (!providerIds.providerCustomerId && !providerIds.providerSubscriptionId) {
    return false;
  }

  const { data: subscriptionData, error: subscriptionError } =
    await supabaseAdmin
      .from("billing_subscriptions")
      .select(
        "id, project_id, billing_account_id, metadata, gateway_subscription_id",
      )
      .eq("metadata->>checkout_session_id", checkoutSessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  if (subscriptionError) throw subscriptionError;
  const localSubscription = subscriptionData as
    | BillingSubscriptionWebhookMatch
    | null;
  if (!localSubscription) return false;

  const subscriptionPatch: Record<string, unknown> = {
    gateway_provider: "asaas",
    metadata: {
      ...getMetadata(localSubscription.metadata),
      last_asaas_payment_webhook: payload,
    },
  };

  if (
    providerIds.providerSubscriptionId &&
    !isAsaasSubscriptionId(localSubscription.gateway_subscription_id)
  ) {
    subscriptionPatch.gateway_subscription_id =
      providerIds.providerSubscriptionId;
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

  const providerSubscriptionId = providerIds.providerSubscriptionId ||
    session.provider_subscription_id || null;
  const providerCustomerId = providerIds.providerCustomerId ||
    session.provider_customer_id || null;
  const providerPaymentId = providerIds.providerPaymentId ||
    session.provider_payment_id || null;

  if (!providerSubscriptionId || !providerCustomerId) return false;

  const { error: applyError } = await supabaseAdmin.rpc(
    "apply_billing_plan_change",
    {
      p_session_id: session.id,
      p_actor_user_id: session.requested_by ?? null,
      p_provider_subscription_id: providerSubscriptionId,
      p_provider_customer_id: providerCustomerId,
      p_provider_payment_id: providerPaymentId,
    },
  );

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

  if (options.nextStatus && session.status !== "finalized") {
    updatePayload.status = options.nextStatus;
  }
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
        providerCustomerId: options.providerCustomerId ||
          session.provider_customer_id || null,
        providerSubscriptionId: options.providerSubscriptionId ||
          session.provider_subscription_id || null,
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

  if (options.nextStatus && session.status !== "applied") {
    updatePayload.status = options.nextStatus;
  }
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
      providerCustomerId: options.providerCustomerId ||
        session.provider_customer_id || null,
      providerSubscriptionId: options.providerSubscriptionId ||
        session.provider_subscription_id || null,
      providerPaymentId: options.providerPaymentId ||
        session.provider_payment_id || null,
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
  const paidAt = localStatus === "paid"
    ? getDate((payload as { dateCreated?: unknown }).dateCreated)
    : null;

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
  const paidAt = localStatus === "paid"
    ? getDate((payload as { dateCreated?: unknown }).dateCreated)
    : null;

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
    await updatePlanChangeSessionFromProvider(
      supabaseAdmin,
      planChangeSession,
      {
        providerCustomerId,
        providerSubscriptionId,
        metadataKey: "last_asaas_subscription_webhook",
        payload,
        applyWhenReady: planChangeSession.status === "paid",
      },
    );
    handled = true;
  }

  return handled;
}

async function handleSubscriptionWebhook(
  supabaseAdmin: SupabaseAdmin,
  event: string,
  payload: unknown,
) {
  if (!SUBSCRIPTION_EVENTS.has(event)) return false;

  const subscription = asRecord(
    (payload as { subscription?: unknown }).subscription,
  );
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

  const { data: subscriptionData, error: subscriptionError } =
    await supabaseAdmin
      .from("billing_subscriptions")
      .select(
        "id, project_id, billing_account_id, metadata, gateway_subscription_id",
      )
      .eq("gateway_provider", "asaas")
      .eq("gateway_subscription_id", providerSubscriptionId)
      .maybeSingle();

  if (subscriptionError) throw subscriptionError;
  let localSubscription = subscriptionData as
    | BillingSubscriptionWebhookMatch
    | null;

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
        .select(
          "id, project_id, billing_account_id, metadata, gateway_subscription_id",
        )
        .eq("billing_account_id", account.id)
        .eq("project_id", account.project_id)
        .eq("gateway_provider", "asaas")
        .in("status", ["trialing", "active", "past_due", "paused", "suspended"])
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
  if (
    event === "SUBSCRIPTION_INACTIVATED" || event === "SUBSCRIPTION_DELETED"
  ) {
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

function getOverageInvoicePaymentStatus(
  event: string,
  paymentStatus: string,
  isPaid: boolean,
) {
  if (isPaid) return "paid";
  if (event === "PAYMENT_OVERDUE" || paymentStatus === "OVERDUE") {
    return "past_due";
  }
  if (event === "PAYMENT_REFUNDED" || paymentStatus === "REFUNDED") {
    return "refunded";
  }
  if (
    event === "PAYMENT_DELETED" ||
    paymentStatus === "CANCELED" ||
    paymentStatus === "DELETED"
  ) {
    return "canceled";
  }
  if (
    paymentStatus === "CHARGEBACK_REQUESTED" ||
    paymentStatus === "CHARGEBACK_DISPUTE" ||
    paymentStatus === "AWAITING_CHARGEBACK_REVERSAL"
  ) {
    return "failed";
  }
  if (
    event === "PAYMENT_CREATED" ||
    event === "PAYMENT_UPDATED" ||
    paymentStatus === "PENDING" ||
    paymentStatus === "AWAITING_RISK_ANALYSIS"
  ) {
    return "open";
  }
  return "";
}

async function updateOverageInvoicesForBatch(
  supabaseAdmin: SupabaseAdmin,
  batchId: string,
  nextStatus: string,
  paidAt: string | null,
  payload: unknown,
) {
  const { data: invoicesData, error: invoicesError } = await supabaseAdmin
    .from("billing_invoices")
    .select("id, total_cents, metadata")
    .eq("collection_batch_id", batchId);

  if (invoicesError) throw invoicesError;

  for (const invoice of invoicesData ?? []) {
    const totalCents = Math.max(0, Number(invoice.total_cents || 0));
    const isPaid = nextStatus === "paid";
    const isTerminalWithoutDebt = nextStatus === "canceled" ||
      nextStatus === "refunded";

    const invoicePatch: Record<string, unknown> = {
      status: nextStatus,
      amount_paid_cents: isPaid ? totalCents : 0,
      amount_due_cents: isPaid || isTerminalWithoutDebt ? 0 : totalCents,
      paid_at: isPaid ? paidAt : null,
      metadata: {
        ...getMetadata(invoice.metadata),
        last_asaas_overage_payment_webhook: payload,
      },
    };

    if (nextStatus === "failed") {
      invoicePatch.failed_at = new Date().toISOString();
    }

    const { error: invoiceError } = await supabaseAdmin
      .from("billing_invoices")
      .update(invoicePatch)
      .eq("id", invoice.id);

    if (invoiceError) throw invoiceError;
  }
}

async function handleOverageInvoicePaymentWebhook(
  supabaseAdmin: SupabaseAdmin,
  event: string,
  payload: unknown,
  providerPaymentId: string | null,
  providerSubscriptionId: string | null,
  paymentStatus: string,
  isPaid: boolean,
  paidAt: string | null,
) {
  if (!providerPaymentId) return false;

  const nextStatus = getOverageInvoicePaymentStatus(
    event,
    paymentStatus,
    isPaid,
  );
  if (!nextStatus) return false;

  const { data, error } = await supabaseAdmin
    .from("billing_invoice_collection_batches")
    .select("id, subscription_id, status, metadata")
    .eq("gateway_provider", "asaas")
    .eq("gateway_charge_id", providerPaymentId)
    .maybeSingle();

  if (error) throw error;
  const batch = data as InvoiceCollectionBatchWebhookMatch | null;
  if (!batch) return false;

  const batchPatch: Record<string, unknown> = {
    status: nextStatus,
    gateway_charge_status: paymentStatus || event,
    metadata: {
      ...getMetadata(batch.metadata),
      last_asaas_payment_webhook: payload,
    },
  };

  if (nextStatus === "paid") {
    batchPatch.paid_at = paidAt;
    batchPatch.failed_at = null;
  }
  if (nextStatus === "failed") {
    batchPatch.failed_at = new Date().toISOString();
  }

  const { error: batchError } = await supabaseAdmin
    .from("billing_invoice_collection_batches")
    .update(batchPatch)
    .eq("id", batch.id);

  if (batchError) throw batchError;

  await updateOverageInvoicesForBatch(
    supabaseAdmin,
    batch.id,
    nextStatus,
    paidAt,
    payload,
  );

  await reconcileSubscriptionDelinquencyFromPayment(supabaseAdmin, {
    event,
    payload,
    localSubscriptionId: batch.subscription_id,
    providerSubscriptionId,
    providerPaymentId,
    paymentStatus,
    isPaid,
    reason: nextStatus === "failed" ? "overage_payment_failed" : "overage_payment_overdue",
  });

  return true;
}

async function findBillingCycleIdForCommission(
  supabaseAdmin: SupabaseAdmin,
  subscriptionId: string,
  paidAt: string,
) {
  const { data, error } = await supabaseAdmin
    .from("billing_cycles")
    .select("id")
    .eq("subscription_id", subscriptionId)
    .eq("cycle_type", "subscription")
    .lte("period_start", paidAt)
    .gt("period_end", paidAt)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

async function getExistingAffiliateCommission(
  supabaseAdmin: SupabaseAdmin,
  options: {
    attributionId: string;
    competenceMonth: string;
    providerPaymentId?: string | null;
  },
) {
  if (options.providerPaymentId) {
    const { data, error } = await supabaseAdmin
      .from("affiliate_commissions")
      .select("id")
      .eq("provider_payment_id", options.providerPaymentId)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  const { data, error } = await supabaseAdmin
    .from("affiliate_commissions")
    .select("id")
    .eq("attribution_id", options.attributionId)
    .eq("competence_month", options.competenceMonth)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function createAffiliateCommission(
  supabaseAdmin: SupabaseAdmin,
  options: {
    event: string;
    payload: unknown;
    payment: Record<string, unknown>;
    providerPaymentId?: string | null;
    providerCustomerId?: string | null;
    providerSubscriptionId?: string | null;
    paymentStatus: string;
    paidAt?: string | null;
  },
) {
  if (!options.paidAt || !options.providerSubscriptionId) return false;

  const paidAmountCents = readMoneyCents(
    options.payment.value,
    options.payment.amount,
    options.payment.totalValue,
  );
  if (paidAmountCents <= 0) return false;

  const { data: subscriptionData, error: subscriptionError } =
    await supabaseAdmin
      .from("billing_subscriptions")
      .select([
        "id",
        "project_id",
        "billing_account_id",
        "plan_id",
        "status",
        "base_price_cents",
        "currency",
        "metadata",
        "gateway_subscription_id",
      ].join(", "))
      .eq("gateway_provider", "asaas")
      .eq("gateway_subscription_id", options.providerSubscriptionId)
      .maybeSingle();

  if (subscriptionError) throw subscriptionError;
  const subscription = subscriptionData as
    | BillingSubscriptionWebhookMatch
    | null;
  if (!subscription) return false;

  const subscriptionStatus = String(subscription.status || "").toLowerCase();
  if (NON_COMMISSIONABLE_SUBSCRIPTION_STATUSES.has(subscriptionStatus)) {
    return false;
  }

  const basePriceCents = Math.max(
    0,
    Math.trunc(Number(subscription.base_price_cents || 0)),
  );
  if (basePriceCents <= 0) return false;

  const { data: attributionData, error: attributionError } = await supabaseAdmin
    .from("affiliate_attributions")
    .select([
      "id",
      "seller_id",
      "link_id",
      "user_id",
      "project_id",
      "subscription_id",
      "plan_id",
      "status",
      "metadata",
    ].join(", "))
    .eq("subscription_id", subscription.id)
    .eq("status", "active")
    .maybeSingle();

  if (attributionError) throw attributionError;
  const attribution = attributionData as
    | AffiliateAttributionWebhookMatch
    | null;
  if (!attribution) return false;

  const eligibleAmountCents = Math.min(paidAmountCents, basePriceCents);
  if (eligibleAmountCents <= 0) return false;

  const commissionCents = Math.round(
    (eligibleAmountCents * AFFILIATE_COMMISSION_RATE_BPS) / 10000,
  );
  const competenceMonth = getCompetenceMonth(options.paidAt);
  const billingCycleId = await findBillingCycleIdForCommission(
    supabaseAdmin,
    subscription.id,
    options.paidAt,
  );

  const insertPayload = {
    attribution_id: attribution.id,
    seller_id: attribution.seller_id,
    link_id: attribution.link_id,
    user_id: attribution.user_id,
    project_id: attribution.project_id || subscription.project_id,
    subscription_id: subscription.id,
    billing_cycle_id: billingCycleId,
    plan_id: subscription.plan_id || attribution.plan_id,
    competence_month: competenceMonth,
    paid_at: options.paidAt,
    provider_payment_id: options.providerPaymentId ?? null,
    provider_event_id: readFirstString(
      (options.payload as Record<string, unknown>)?.id,
      (options.payload as Record<string, unknown>)?.eventId,
      options.event,
    ),
    eligible_amount_cents: eligibleAmountCents,
    commission_rate_bps: AFFILIATE_COMMISSION_RATE_BPS,
    commission_cents: commissionCents,
    currency: readString(subscription.currency || "BRL").toUpperCase() || "BRL",
    status: "pending",
    source: "asaas_webhook",
    metadata: {
      origin: "asaas_webhook",
      event: options.event,
      payment_status: options.paymentStatus,
      provider_subscription_id: options.providerSubscriptionId,
      provider_customer_id: options.providerCustomerId ?? null,
      payment_value_cents: paidAmountCents,
      subscription_base_price_cents: basePriceCents,
      billing_cycle_id: billingCycleId,
    },
  };

  const { error } = await supabaseAdmin
    .from("affiliate_commissions")
    .insert(insertPayload)
    .select("id")
    .single();

  if (!error) return true;

  if (isUniqueViolation(error)) {
    await getExistingAffiliateCommission(supabaseAdmin, {
      attributionId: attribution.id,
      competenceMonth,
      providerPaymentId: options.providerPaymentId,
    });
    return true;
  }

  throw error;
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
  const isCommissionEligiblePayment = isAffiliateCommissionPaidPaymentEvent(
    event,
    paymentStatus,
  );
  const paidAt = isPaid
    ? getDate(
      payment.confirmedDate ?? payment.clientPaymentDate ??
        payment.paymentDate ??
        (payload as { dateCreated?: unknown }).dateCreated,
    )
    : null;

  if (
    !providerPaymentId && !providerCheckoutId && !externalReference &&
    !providerSubscriptionId
  ) return false;

  if (
    await handleOverageInvoicePaymentWebhook(
      supabaseAdmin,
      event,
      payload,
      providerPaymentId,
      providerSubscriptionId,
      paymentStatus,
      isPaid,
      paidAt,
    )
  ) {
    return true;
  }

  let handled = false;
  let commissionProviderSubscriptionId = providerSubscriptionId;
  let commissionProviderPaymentId = providerPaymentId;
  const identifiers = {
    providerCheckoutId,
    externalReference,
    providerPaymentId,
    providerSubscriptionId,
  };

  if (
    await reconcileSubscriptionDelinquencyFromPayment(supabaseAdmin, {
      event,
      payload,
      providerSubscriptionId,
      providerPaymentId,
      paymentStatus,
      isPaid,
      reason: isPaymentDelinquencyEvent(event, paymentStatus)
        ? "subscription_payment_overdue"
        : "subscription_payment_recovered",
    })
  ) {
    handled = true;
  }

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
    commissionProviderSubscriptionId = commissionProviderSubscriptionId ||
      signupSession.provider_subscription_id ||
      null;
    commissionProviderPaymentId = commissionProviderPaymentId ||
      signupSession.provider_payment_id ||
      null;
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
    await updatePlanChangeSessionFromProvider(
      supabaseAdmin,
      planChangeSession,
      {
        nextStatus: isPaid ? "paid" : undefined,
        paidAt,
        providerCustomerId,
        providerSubscriptionId,
        providerPaymentId,
        metadataKey: "last_asaas_payment_webhook",
        payload,
        applyWhenReady: isPaid || planChangeSession.status === "paid",
      },
    );
    commissionProviderSubscriptionId = commissionProviderSubscriptionId ||
      planChangeSession.provider_subscription_id ||
      null;
    commissionProviderPaymentId = commissionProviderPaymentId ||
      planChangeSession.provider_payment_id ||
      null;
    handled = true;
  }

  if (isCommissionEligiblePayment) {
    const commissionHandled = await createAffiliateCommission(supabaseAdmin, {
      event,
      payload,
      payment,
      providerPaymentId: commissionProviderPaymentId,
      providerCustomerId,
      providerSubscriptionId: commissionProviderSubscriptionId,
      paymentStatus,
      paidAt,
    });
    handled = commissionHandled || handled;
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
    const webhookToken = String(Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "")
      .trim();
    if (webhookToken) {
      const receivedToken = String(req.headers.get("asaas-access-token") ?? "")
        .trim();
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

    if (
      await handleSignupCheckoutWebhook(
        supabaseAdmin,
        providerCheckoutId,
        localStatus,
        payload,
        checkout,
      )
    ) {
      return jsonResponse(origin, { received: true });
    }

    if (
      await handlePlanChangeCheckoutWebhook(
        supabaseAdmin,
        providerCheckoutId,
        localStatus,
        payload,
        checkout,
      )
    ) {
      return jsonResponse(origin, { received: true });
    }

    return jsonResponse(origin, { received: true, ignored: true });
  } catch (error) {
    console.error("asaas-webhook error", error);
    return jsonResponse(origin, { error: "Erro interno no webhook." }, 500);
  }
});
