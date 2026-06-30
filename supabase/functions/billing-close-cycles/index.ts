import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";

const ACTIVE_PAID_STATUSES = ["active", "past_due", "paused"];
const EDITABLE_PAYMENT_STATUSES = new Set(["PENDING", "OVERDUE"]);
const COLLECTION_BUFFER_DAYS = 2;

type SupabaseAdmin = any;

type InvoiceRow = {
  id: string;
  project_id: string;
  subscription_id: string | null;
  billing_account_id: string | null;
  billing_cycle_id: string | null;
  invoice_number: string | null;
  currency: string;
  total_cents: number;
  amount_due_cents: number;
  due_at: string | null;
  metadata: Record<string, unknown> | null;
};

type SubscriptionRow = {
  id: string;
  project_id: string;
  billing_account_id: string | null;
  gateway_subscription_id: string | null;
  current_period_end: string | null;
  metadata: Record<string, unknown> | null;
};

type PastDueSubscriptionRow = {
  id: string;
  project_id: string;
  grace_ends_at: string | null;
  metadata: Record<string, unknown> | null;
};

type AsaasPayment = {
  id?: string;
  status?: string;
  value?: number;
  dueDate?: string;
  description?: string;
  subscription?: string | { id?: string };
};

class HttpError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload.error ?? "Request failed."));
    this.name = "HttpError";
    this.status = status;
    this.payload = payload;
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function requiredEnv(name: string) {
  const value = String(Deno.env.get(name) ?? "").trim();
  if (!value) {
    throw new HttpError(500, {
      ok: false,
      code: "BILLING_CLOSE_CYCLES_MISSING_ENV",
      error: `${name} ausente.`,
    });
  }
  return value;
}

function extractBearerToken(req: Request) {
  const authorization = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

async function assertRunnerAuth(req: Request, serviceRoleKey: string, supabaseAdmin: SupabaseAdmin) {
  const bearer = extractBearerToken(req);
  if (bearer && bearer === serviceRoleKey) return;

  const cronSecrets = [
    Deno.env.get("CRON_SECRET"),
    Deno.env.get("BILLING_CRON_SECRET"),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (bearer && cronSecrets.includes(bearer)) return;

  const cronHeader = String(req.headers.get("x-cron-secret") ?? "").trim();
  if (cronHeader && cronSecrets.includes(cronHeader)) return;

  const cronToken = bearer || cronHeader;
  if (cronToken) {
    const { data, error } = await supabaseAdmin.rpc("verify_billing_cron_secret", {
      p_token: cronToken,
    });
    if (error) throw error;
    if (data === true) return;
  }

  throw new HttpError(401, {
    ok: false,
    code: "BILLING_CLOSE_CYCLES_UNAUTHORIZED",
    error: "Unauthorized.",
  });
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

function getMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function truncate(value: unknown, maxLength = 1000) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function getAsaasApiBaseUrl() {
  const explicit = String(Deno.env.get("ASAAS_API_BASE_URL") ?? "").trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const env = String(Deno.env.get("ASAAS_ENV") ?? "sandbox").trim().toLowerCase();
  return env === "production"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
}

function isAsaasSubscriptionId(value: unknown) {
  return /^sub_[a-z0-9]+$/i.test(String(value ?? "").trim());
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatAsaasDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function centsToAsaasValue(cents: number) {
  return Math.max(0, Math.trunc(cents)) / 100;
}

function asCents(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount * 100));
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizePaymentStatus(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function readPaymentId(payment: AsaasPayment) {
  return String(payment.id ?? "").trim();
}

function readPaymentSubscriptionId(payment: AsaasPayment) {
  const value = payment.subscription;
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return String(value.id ?? "").trim();
  return "";
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

  const text = await response.text().catch(() => "");
  let body: Record<string, unknown> | null = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`Asaas ${response.status}: ${truncate(body?.errors ?? body?.description ?? text, 700)}`);
  }

  return body ?? {};
}

async function listEditableSubscriptionPayments(apiKey: string, subscriptionId: string) {
  const payments: AsaasPayment[] = [];

  for (const status of EDITABLE_PAYMENT_STATUSES) {
    const params = new URLSearchParams({
      subscription: subscriptionId,
      status,
      limit: "100",
    });
    const body = await asaasFetch(apiKey, `/payments?${params.toString()}`, { method: "GET" });
    payments.push(...(asArray(body.data) as AsaasPayment[]));
  }

  const seen = new Set<string>();
  return payments.filter((payment) => {
    const id = readPaymentId(payment);
    if (!id || seen.has(id)) return false;
    seen.add(id);

    const status = normalizePaymentStatus(payment.status);
    if (!EDITABLE_PAYMENT_STATUSES.has(status)) return false;

    const paymentSubscriptionId = readPaymentSubscriptionId(payment);
    return !paymentSubscriptionId || paymentSubscriptionId === subscriptionId;
  });
}

function chooseEditablePayment(payments: AsaasPayment[], invoices: InvoiceRow[]) {
  if (!payments.length) return null;

  const targetDue = invoices
    .map((invoice) => invoice.due_at ? Date.parse(invoice.due_at) : Number.NaN)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0] ?? Date.now();

  return [...payments].sort((a, b) => {
    const aDue = Date.parse(String(a.dueDate ?? ""));
    const bDue = Date.parse(String(b.dueDate ?? ""));
    const aDistance = Number.isFinite(aDue) ? Math.abs(aDue - targetDue) : Number.MAX_SAFE_INTEGER;
    const bDistance = Number.isFinite(bDue) ? Math.abs(bDue - targetDue) : Number.MAX_SAFE_INTEGER;
    if (aDistance !== bDistance) return aDistance - bDistance;
    return String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? ""));
  })[0] ?? null;
}

function buildPaymentDescription(payment: AsaasPayment, invoices: InvoiceRow[], overageCents: number) {
  const baseDescription = String(payment.description ?? "Assinatura mensal AllinPass").trim();
  const invoiceNumbers = invoices
    .map((invoice) => invoice.invoice_number || invoice.id.slice(0, 8))
    .join(", ");
  const overageText = `Excedente de uso AllinPass (${invoiceNumbers}): R$ ${centsToAsaasValue(overageCents).toFixed(2)}`;
  const description = `${baseDescription}\n${overageText}`;
  return description.length > 500 ? description.slice(0, 497) + "..." : description;
}

async function closeDueCycles(supabaseAdmin: SupabaseAdmin, limit: number) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("billing_cycles")
    .select("id")
    .eq("cycle_type", "subscription")
    .eq("status", "open")
    .not("subscription_id", "is", null)
    .lte("period_end", nowIso)
    .order("period_end", { ascending: true })
    .limit(limit);

  if (error) throw error;

  const cycles = Array.isArray(data) ? data as Array<{ id: string }> : [];
  const results: Array<Record<string, unknown>> = [];
  let closed = 0;
  let failed = 0;

  for (const cycle of cycles) {
    try {
      const { data: result, error: closeError } = await supabaseAdmin.rpc("close_billing_cycle_for_overage", {
        p_cycle_id: cycle.id,
      });
      if (closeError) throw closeError;
      closed += 1;
      results.push({ cycle_id: cycle.id, ok: true, result });
    } catch (error) {
      failed += 1;
      console.error("billing-close-cycles close failed", {
        cycle_id: cycle.id,
        error: truncate(error),
      });
      results.push({ cycle_id: cycle.id, ok: false, error: truncate(error, 300) });
    }
  }

  return { picked: cycles.length, closed, failed, results };
}

function groupInvoicesBySubscription(invoices: InvoiceRow[]) {
  const groups = new Map<string, InvoiceRow[]>();
  for (const invoice of invoices) {
    const subscriptionId = String(invoice.subscription_id ?? "").trim();
    if (!subscriptionId) continue;
    if (!groups.has(subscriptionId)) groups.set(subscriptionId, []);
    groups.get(subscriptionId)!.push(invoice);
  }
  return groups;
}

async function getSubscription(supabaseAdmin: SupabaseAdmin, subscriptionId: string) {
  const { data, error } = await supabaseAdmin
    .from("billing_subscriptions")
    .select("id, project_id, billing_account_id, gateway_subscription_id, current_period_end, metadata")
    .eq("id", subscriptionId)
    .maybeSingle();

  if (error) throw error;
  return data as SubscriptionRow | null;
}

async function findActiveCollectionBatch(
  supabaseAdmin: SupabaseAdmin,
  providerPaymentId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("billing_invoice_collection_batches")
    .select("id, status")
    .eq("gateway_provider", "asaas")
    .eq("gateway_charge_id", providerPaymentId)
    .in("status", ["pending", "open", "paid", "past_due"])
    .maybeSingle();

  if (error) throw error;
  return data as { id: string; status: string } | null;
}

async function markInvoicesCollectionError(
  supabaseAdmin: SupabaseAdmin,
  invoices: InvoiceRow[],
  code: string,
  message: string,
) {
  for (const invoice of invoices) {
    await supabaseAdmin
      .from("billing_invoices")
      .update({
        metadata: {
          ...getMetadata(invoice.metadata),
          last_collection_error: {
            code,
            message,
            at: new Date().toISOString(),
          },
        },
      })
      .eq("id", invoice.id);
  }
}

async function collectInvoiceGroup(
  supabaseAdmin: SupabaseAdmin,
  apiKey: string,
  subscription: SubscriptionRow,
  invoices: InvoiceRow[],
) {
  const gatewaySubscriptionId = String(subscription.gateway_subscription_id ?? "").trim();
  if (!isAsaasSubscriptionId(gatewaySubscriptionId)) {
    await markInvoicesCollectionError(
      supabaseAdmin,
      invoices,
      "missing_gateway_subscription_id",
      "Assinatura Asaas ausente para anexar excedente.",
    );
    return { ok: false, skipped: true, reason: "missing_gateway_subscription_id" };
  }

  const editablePayments = await listEditableSubscriptionPayments(apiKey, gatewaySubscriptionId);
  const payment = chooseEditablePayment(editablePayments, invoices);
  if (!payment) {
    await markInvoicesCollectionError(
      supabaseAdmin,
      invoices,
      "editable_payment_not_found",
      "Nenhuma cobranca mensal pendente ou vencida encontrada no Asaas.",
    );
    return { ok: false, skipped: true, reason: "editable_payment_not_found" };
  }

  const providerPaymentId = readPaymentId(payment);
  const existingBatch = await findActiveCollectionBatch(supabaseAdmin, providerPaymentId);
  if (existingBatch) {
    await markInvoicesCollectionError(
      supabaseAdmin,
      invoices,
      "payment_already_has_collection_batch",
      `Cobranca Asaas ja vinculada ao batch ${existingBatch.id}.`,
    );
    return {
      ok: false,
      skipped: true,
      reason: "payment_already_has_collection_batch",
      batch_id: existingBatch.id,
    };
  }

  const overageCents = invoices.reduce(
    (sum, invoice) => sum + Math.max(0, Number(invoice.amount_due_cents || invoice.total_cents || 0)),
    0,
  );
  const originalPaymentCents = asCents(payment.value);
  const updatedPaymentCents = originalPaymentCents + overageCents;
  const dueAt = payment.dueDate
    ? new Date(`${payment.dueDate}T00:00:00.000Z`).toISOString()
    : invoices[0]?.due_at ?? null;

  const { data: batchData, error: batchError } = await supabaseAdmin
    .from("billing_invoice_collection_batches")
    .insert({
      project_id: subscription.project_id,
      subscription_id: subscription.id,
      billing_account_id: subscription.billing_account_id,
      gateway_provider: "asaas",
      gateway_subscription_id: gatewaySubscriptionId,
      gateway_charge_id: providerPaymentId,
      gateway_charge_status: normalizePaymentStatus(payment.status),
      collection_mode: "subscription_payment_adjustment",
      status: "pending",
      invoice_count: invoices.length,
      original_subscription_payment_cents: originalPaymentCents,
      overage_cents: overageCents,
      updated_payment_cents: updatedPaymentCents,
      currency: invoices[0]?.currency ?? "BRL",
      due_at: dueAt,
      attempt_count: 1,
      last_attempt_at: new Date().toISOString(),
      metadata: {
        origin: "billing-close-cycles",
        invoice_ids: invoices.map((invoice) => invoice.id),
        asaas_payment_before_update: payment,
      },
    })
    .select("id")
    .single();

  if (batchError) throw batchError;
  const batch = batchData as { id: string };

  try {
    const asaasBody = await asaasFetch(apiKey, `/payments/${encodeURIComponent(providerPaymentId)}`, {
      method: "PUT",
      body: JSON.stringify({
        value: centsToAsaasValue(updatedPaymentCents),
        description: buildPaymentDescription(payment, invoices, overageCents),
      }),
    });

    await supabaseAdmin
      .from("billing_invoice_collection_batches")
      .update({
        status: "open",
        gateway_charge_status: normalizePaymentStatus(asaasBody.status ?? payment.status),
        metadata: {
          origin: "billing-close-cycles",
          invoice_ids: invoices.map((invoice) => invoice.id),
          asaas_payment_before_update: payment,
          asaas_payment_after_update: asaasBody,
        },
      })
      .eq("id", batch.id);

    for (const invoice of invoices) {
      await supabaseAdmin
        .from("billing_invoices")
        .update({
          collection_batch_id: batch.id,
          gateway_provider: "asaas",
          gateway_charge_id: providerPaymentId,
          status: "open",
          due_at: dueAt ?? invoice.due_at,
          amount_due_cents: Math.max(0, Number(invoice.total_cents || invoice.amount_due_cents || 0)),
          metadata: {
            ...getMetadata(invoice.metadata),
            collection_batch_id: batch.id,
            gateway_charge_id: providerPaymentId,
            collection_mode: "subscription_payment_adjustment",
            collected_with_subscription_payment: true,
          },
        })
        .eq("id", invoice.id);
    }

    return {
      ok: true,
      batch_id: batch.id,
      gateway_charge_id: providerPaymentId,
      invoice_count: invoices.length,
      overage_cents: overageCents,
      updated_payment_cents: updatedPaymentCents,
    };
  } catch (error) {
    await supabaseAdmin
      .from("billing_invoice_collection_batches")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        metadata: {
          origin: "billing-close-cycles",
          invoice_ids: invoices.map((invoice) => invoice.id),
          asaas_payment_before_update: payment,
          update_error: truncate(error),
        },
      })
      .eq("id", batch.id);

    await markInvoicesCollectionError(supabaseAdmin, invoices, "asaas_payment_update_failed", truncate(error, 300));
    return { ok: false, failed: true, batch_id: batch.id, error: truncate(error, 300) };
  }
}

async function collectDraftOverageInvoices(
  supabaseAdmin: SupabaseAdmin,
  apiKey: string,
  limit: number,
) {
  const { data, error } = await supabaseAdmin
    .from("billing_invoices")
    .select("id, project_id, subscription_id, billing_account_id, billing_cycle_id, invoice_number, currency, total_cents, amount_due_cents, due_at, metadata")
    .eq("status", "draft")
    .eq("gateway_provider", "asaas")
    .is("collection_batch_id", null)
    .gt("amount_due_cents", 0)
    .order("due_at", { ascending: true })
    .limit(limit);

  if (error) throw error;

  const invoices = ((Array.isArray(data) ? data : []) as InvoiceRow[])
    .filter((invoice) => getMetadata(invoice.metadata).invoice_kind === "overage");

  const groups = groupInvoicesBySubscription(invoices);
  const results: Array<Record<string, unknown>> = [];
  let collected = 0;
  let skipped = 0;
  let failed = 0;

  for (const [subscriptionId, groupInvoices] of groups) {
    try {
      const subscription = await getSubscription(supabaseAdmin, subscriptionId);
      if (!subscription) {
        skipped += groupInvoices.length;
        await markInvoicesCollectionError(
          supabaseAdmin,
          groupInvoices,
          "subscription_not_found",
          "Assinatura local nao encontrada.",
        );
        results.push({ subscription_id: subscriptionId, ok: false, skipped: true, reason: "subscription_not_found" });
        continue;
      }

      const result = await collectInvoiceGroup(supabaseAdmin, apiKey, subscription, groupInvoices);
      if (result.ok) collected += groupInvoices.length;
      else if (result.failed) failed += groupInvoices.length;
      else skipped += groupInvoices.length;

      results.push({ subscription_id: subscriptionId, ...result });
    } catch (error) {
      failed += groupInvoices.length;
      console.error("billing-close-cycles collect failed", {
        subscription_id: subscriptionId,
        error: truncate(error),
      });
      await markInvoicesCollectionError(supabaseAdmin, groupInvoices, "collection_failed", truncate(error, 300));
      results.push({ subscription_id: subscriptionId, ok: false, error: truncate(error, 300) });
    }
  }

  return { picked: invoices.length, collected, skipped, failed, results };
}

async function realignSubscriptionDueDates(
  supabaseAdmin: SupabaseAdmin,
  apiKey: string,
  limit: number,
) {
  const { data, error } = await supabaseAdmin
    .from("billing_subscriptions")
    .select("id, project_id, billing_account_id, gateway_subscription_id, current_period_end, metadata")
    .eq("gateway_provider", "asaas")
    .in("status", ACTIVE_PAID_STATUSES)
    .not("gateway_subscription_id", "is", null)
    .not("current_period_end", "is", null)
    .order("current_period_end", { ascending: true })
    .limit(limit);

  if (error) throw error;

  const subscriptions = (Array.isArray(data) ? data : []) as SubscriptionRow[];
  let aligned = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const subscription of subscriptions) {
    const gatewaySubscriptionId = String(subscription.gateway_subscription_id ?? "").trim();
    if (!isAsaasSubscriptionId(gatewaySubscriptionId) || !subscription.current_period_end) {
      skipped += 1;
      continue;
    }

    const targetNextDueDate = formatAsaasDate(addDays(new Date(subscription.current_period_end), COLLECTION_BUFFER_DAYS));
    const metadata = getMetadata(subscription.metadata);
    if (metadata.overage_next_due_date_aligned_to === targetNextDueDate) {
      skipped += 1;
      continue;
    }

    try {
      const asaasBody = await asaasFetch(apiKey, `/subscriptions/${encodeURIComponent(gatewaySubscriptionId)}`, {
        method: "PUT",
        body: JSON.stringify({
          nextDueDate: targetNextDueDate,
          updatePendingPayments: false,
        }),
      });

      await supabaseAdmin
        .from("billing_subscriptions")
        .update({
          metadata: {
            ...metadata,
            overage_next_due_date_aligned_to: targetNextDueDate,
            overage_next_due_date_aligned_at: new Date().toISOString(),
            overage_next_due_date_aligned_response: asaasBody,
          },
        })
        .eq("id", subscription.id);

      aligned += 1;
      results.push({
        subscription_id: subscription.id,
        gateway_subscription_id: gatewaySubscriptionId,
        next_due_date: targetNextDueDate,
        ok: true,
      });
    } catch (error) {
      failed += 1;
      console.error("billing-close-cycles due date alignment failed", {
        subscription_id: subscription.id,
        gateway_subscription_id: gatewaySubscriptionId,
        error: truncate(error),
      });

      await supabaseAdmin
        .from("billing_subscriptions")
        .update({
          metadata: {
            ...metadata,
            overage_next_due_date_alignment_error: {
              at: new Date().toISOString(),
              next_due_date: targetNextDueDate,
              message: truncate(error, 300),
            },
          },
        })
        .eq("id", subscription.id);

      results.push({
        subscription_id: subscription.id,
        gateway_subscription_id: gatewaySubscriptionId,
        next_due_date: targetNextDueDate,
        ok: false,
        error: truncate(error, 300),
      });
    }
  }

  return { picked: subscriptions.length, aligned, skipped, failed, results };
}

async function suspendPastDueSubscriptions(supabaseAdmin: SupabaseAdmin, limit: number) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("billing_subscriptions")
    .select("id, project_id, grace_ends_at, metadata")
    .eq("status", "past_due")
    .not("grace_ends_at", "is", null)
    .lte("grace_ends_at", nowIso)
    .order("grace_ends_at", { ascending: true })
    .limit(limit);

  if (error) throw error;

  const subscriptions = (Array.isArray(data) ? data : []) as PastDueSubscriptionRow[];
  let suspended = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const subscription of subscriptions) {
    try {
      const metadata = getMetadata(subscription.metadata);
      const { error: updateError } = await supabaseAdmin
        .from("billing_subscriptions")
        .update({
          status: "suspended",
          suspended_at: nowIso,
          metadata: {
            ...metadata,
            last_billing_suspension: {
              at: nowIso,
              grace_ends_at: subscription.grace_ends_at,
              source: "billing-close-cycles",
            },
          },
        })
        .eq("id", subscription.id)
        .eq("status", "past_due");

      if (updateError) throw updateError;

      suspended += 1;
      results.push({
        subscription_id: subscription.id,
        project_id: subscription.project_id,
        ok: true,
      });
    } catch (error) {
      failed += 1;
      console.error("billing-close-cycles suspension failed", {
        subscription_id: subscription.id,
        error: truncate(error),
      });
      results.push({
        subscription_id: subscription.id,
        project_id: subscription.project_id,
        ok: false,
        error: truncate(error, 300),
      });
    }
  }

  return { picked: subscriptions.length, suspended, failed, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    if (req.method !== "POST") {
      throw new HttpError(405, {
        ok: false,
        code: "BILLING_CLOSE_CYCLES_METHOD_NOT_ALLOWED",
        error: "Metodo nao permitido.",
      });
    }

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const asaasApiKey = requiredEnv("ASAAS_API_KEY");

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await assertRunnerAuth(req, serviceRoleKey, supabaseAdmin);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const limit = normalizeLimit(body.limit);

    const closedCycles = await closeDueCycles(supabaseAdmin, limit);
    const collectedInvoices = await collectDraftOverageInvoices(supabaseAdmin, asaasApiKey, limit);
    const alignedDueDates = await realignSubscriptionDueDates(supabaseAdmin, asaasApiKey, limit);
    const suspendedSubscriptions = await suspendPastDueSubscriptions(supabaseAdmin, limit);

    return jsonResponse({
      ok: true,
      closed_cycles: closedCycles,
      collected_invoices: collectedInvoices,
      aligned_due_dates: alignedDueDates,
      suspended_subscriptions: suspendedSubscriptions,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(error.payload, error.status);
    }

    console.error("billing-close-cycles error", truncate(error));
    return jsonResponse({
      ok: false,
      code: "BILLING_CLOSE_CYCLES_INTERNAL_ERROR",
      error: "Falha ao fechar ciclos de billing.",
    }, 500);
  }
});
