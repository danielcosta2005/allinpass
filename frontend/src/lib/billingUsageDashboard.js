import { getBillingSubscriptionForAccess } from '@/lib/billing';
import { supabase } from '@/lib/supabaseClient';

const DEFAULT_HISTORY_LIMIT = 12;
const BILLING_INVOICE_SELECT_FIELDS = [
  'id',
  'subscription_id',
  'billing_cycle_id',
  'collection_batch_id',
  'invoice_number',
  'status',
  'currency',
  'subtotal_cents',
  'discount_cents',
  'total_cents',
  'amount_due_cents',
  'amount_paid_cents',
  'metadata',
  'checkout_session_id',
  'due_at',
  'paid_at',
].join(', ');

function toNumber(value) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function toDateMs(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function isSameInstant(left, right) {
  const leftMs = toDateMs(left);
  const rightMs = toDateMs(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isFirstMonthDiscountedInvoice(row) {
  const metadata = normalizeMetadata(row?.metadata);
  const status = normalizeStatus(row?.status);
  return (metadata.invoice_kind || row?.invoiceKind) === 'subscription_first_month'
    && toNumber(row?.discount_cents ?? row?.discountCents) > 0
    && !['canceled', 'failed'].includes(status)
    && Boolean(row?.checkout_session_id ?? row?.checkoutSessionId);
}

function normalizeSummary(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    subscriptionId: row.subscription_id,
    billingCycleId: row.billing_cycle_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    passInstallQuantity: toNumber(row.pass_install_quantity),
    notificationSentQuantity: toNumber(row.notification_sent_quantity),
    includedPassInstalls: toNumber(row.included_pass_installs),
    includedNotificationSends: toNumber(row.included_notification_sends),
    overagePassInstallCents: toNumber(row.overage_pass_install_cents),
    overageNotificationSentCents: toNumber(row.overage_notification_sent_cents),
    passInstallOverageQuantity: toNumber(row.pass_install_overage_quantity),
    notificationSentOverageQuantity: toNumber(row.notification_sent_overage_quantity),
    passInstallOverageCents: toNumber(row.pass_install_overage_cents),
    notificationSentOverageCents: toNumber(row.notification_sent_overage_cents),
    totalOverageCents: toNumber(row.total_overage_cents),
    lastUsageEventAt: row.last_usage_event_at || null,
  };
}

function normalizeInvoice(row) {
  if (!row) return null;

  const metadata = normalizeMetadata(row.metadata);
  const invoiceKind = metadata.invoice_kind || null;

  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    billingCycleId: row.billing_cycle_id,
    collectionBatchId: row.collection_batch_id || null,
    invoiceNumber: row.invoice_number || null,
    status: normalizeStatus(row.status),
    currency: row.currency || 'BRL',
    subtotalCents: toNumber(row.subtotal_cents),
    discountCents: toNumber(row.discount_cents),
    totalCents: toNumber(row.total_cents),
    amountDueCents: toNumber(row.amount_due_cents || row.total_cents),
    amountPaidCents: toNumber(row.amount_paid_cents),
    invoiceKind,
    isFirstMonthDiscounted: isFirstMonthDiscountedInvoice(row),
    dueAt: row.due_at || null,
    paidAt: row.paid_at || null,
  };
}

function normalizeBatch(row) {
  if (!row) return null;

  return {
    id: row.id,
    status: normalizeStatus(row.status),
    gatewayChargeStatus: row.gateway_charge_status || null,
    invoiceCount: toNumber(row.invoice_count),
    originalSubscriptionPaymentCents: toNumber(row.original_subscription_payment_cents),
    overageCents: toNumber(row.overage_cents),
    updatedPaymentCents: toNumber(row.updated_payment_cents),
    currency: row.currency || 'BRL',
    dueAt: row.due_at || null,
    paidAt: row.paid_at || null,
    failedAt: row.failed_at || null,
  };
}

function normalizeSubscriptionSnapshot(row) {
  if (!row) return null;

  return {
    id: row.id,
    basePriceCents: toNumber(row.base_price_cents),
    currency: row.currency || 'BRL',
  };
}

function groupInvoicesByCycle(invoices) {
  const grouped = new Map();

  for (const invoice of invoices) {
    if (!invoice.billingCycleId) continue;
    const existing = grouped.get(invoice.billingCycleId);
    if (!existing) {
      grouped.set(invoice.billingCycleId, invoice);
      continue;
    }

    if (existing.status === 'canceled' && invoice.status !== 'canceled') {
      grouped.set(invoice.billingCycleId, invoice);
    }
  }

  return grouped;
}

function dedupeInvoices(invoices) {
  const deduped = new Map();

  for (const invoice of invoices) {
    if (!invoice?.id || deduped.has(invoice.id)) continue;
    deduped.set(invoice.id, invoice);
  }

  return [...deduped.values()];
}

function findFirstMonthInvoiceForSummary(summary, invoices) {
  const periodStart = toDateMs(summary.periodStart);
  const periodEnd = toDateMs(summary.periodEnd);

  return invoices.find((invoice) => {
    if (!invoice?.isFirstMonthDiscounted) return false;
    if (invoice.subscriptionId !== summary.subscriptionId) return false;
    if (invoice.billingCycleId) return invoice.billingCycleId === summary.billingCycleId;

    const paidAt = toDateMs(invoice.paidAt || invoice.dueAt);
    return Number.isFinite(periodStart)
      && Number.isFinite(periodEnd)
      && Number.isFinite(paidAt)
      && periodStart <= paidAt
      && paidAt < periodEnd;
  }) || null;
}

function getCurrentCycleMatch(summary, subscription) {
  if (!subscription || summary.subscriptionId !== subscription.id) return false;
  if (isSameInstant(summary.periodStart, subscription.currentPeriodStart)
    && isSameInstant(summary.periodEnd, subscription.currentPeriodEnd)) {
    return true;
  }

  const nowMs = Date.now();
  const startsAt = toDateMs(summary.periodStart);
  const endsAt = toDateMs(summary.periodEnd);
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= nowMs && nowMs < endsAt;
}

function getCycleTitle({ isCurrent, invoice, batch, overageCents }) {
  if (isCurrent) return 'Fatura atual';
  if (!invoice && overageCents <= 0) return 'Fatura sem excedente';

  const status = normalizeStatus(batch?.status || invoice?.status);
  if (status === 'paid') return 'Fatura paga';
  if (status === 'past_due') return 'Fatura em atraso';
  if (status === 'failed') return 'Fatura falhou';
  if (status === 'canceled') return 'Fatura cancelada';
  if (status === 'refunded') return 'Fatura reembolsada';
  if (['draft', 'pending', 'open'].includes(status)) return 'Fatura pendente';
  return overageCents > 0 ? 'Fatura pendente' : 'Fatura sem excedente';
}

function buildSyntheticCurrentSummary(subscription, projectId) {
  if (!subscription?.id || !subscription?.currentPeriodStart || !subscription?.currentPeriodEnd) return null;

  return {
    id: `current-${subscription.id}`,
    project_id: projectId,
    subscription_id: subscription.id,
    billing_cycle_id: null,
    period_start: subscription.currentPeriodStart,
    period_end: subscription.currentPeriodEnd,
    pass_install_quantity: 0,
    notification_sent_quantity: 0,
    included_pass_installs: subscription.includedPassInstalls,
    included_notification_sends: subscription.includedNotificationSends,
    overage_pass_install_cents: subscription.overagePassInstallCents,
    overage_notification_sent_cents: subscription.overageNotificationSentCents,
    pass_install_overage_quantity: 0,
    notification_sent_overage_quantity: 0,
    pass_install_overage_cents: 0,
    notification_sent_overage_cents: 0,
    total_overage_cents: 0,
    last_usage_event_at: null,
  };
}

function isRefundedInvoice(invoice) {
  return normalizeStatus(invoice?.status) === 'refunded';
}

function buildDashboardCycle(summary, {
  currentSubscription,
  invoice,
  firstMonthInvoice,
  batch,
  subscriptionSnapshot,
}) {
  const isCurrent = getCurrentCycleMatch(summary, currentSubscription);
  const subscriptionBasePriceCents = isCurrent
    ? toNumber(currentSubscription?.basePriceCents)
    : toNumber(subscriptionSnapshot?.basePriceCents || currentSubscription?.basePriceCents);
  const batchBasePriceCents = toNumber(batch?.originalSubscriptionPaymentCents);
  const firstMonthBasePriceCents = firstMonthInvoice?.isFirstMonthDiscounted ? toNumber(firstMonthInvoice.subtotalCents) : 0;
  const basePriceCents = firstMonthBasePriceCents > 0
    ? firstMonthBasePriceCents
    : batchBasePriceCents > 0
      ? batchBasePriceCents
      : subscriptionBasePriceCents;
  const discountCents = firstMonthInvoice?.isFirstMonthDiscounted
    ? toNumber(firstMonthInvoice.discountCents)
    : 0;
  const firstMonthChargeCents = firstMonthInvoice?.isFirstMonthDiscounted
    ? isRefundedInvoice(firstMonthInvoice)
      ? 0
      : toNumber(firstMonthInvoice.amountPaidCents || firstMonthInvoice.totalCents)
    : null;
  const invoiceOverageCents = toNumber(invoice?.amountDueCents || invoice?.totalCents);
  const batchOverageCents = toNumber(batch?.overageCents);
  const overageCents = isCurrent
    ? summary.totalOverageCents
    : batch
      ? (batchOverageCents || invoiceOverageCents || summary.totalOverageCents)
      : invoice
        ? (invoiceOverageCents || summary.totalOverageCents)
        : summary.totalOverageCents;
  const updatedPaymentCents = toNumber(batch?.updatedPaymentCents);
  const baseWithDiscountCents = firstMonthChargeCents ?? Math.max(0, basePriceCents - discountCents);
  const totalInvoiceCents = firstMonthInvoice?.isFirstMonthDiscounted
    ? baseWithDiscountCents + overageCents
    : isCurrent
      ? basePriceCents + summary.totalOverageCents
      : updatedPaymentCents || basePriceCents + overageCents;

  return {
    ...summary,
    isCurrent,
    invoice,
    firstMonthInvoice: firstMonthInvoice
      ? {
        id: firstMonthInvoice.id,
        status: firstMonthInvoice.status,
        paidAt: firstMonthInvoice.paidAt,
      }
      : null,
    batch,
    basePriceCents,
    discountCents,
    overageCents,
    totalInvoiceCents,
    currency: batch?.currency || invoice?.currency || subscriptionSnapshot?.currency || currentSubscription?.currency || 'BRL',
    status: isCurrent ? 'current' : normalizeStatus(batch?.status || invoice?.status || firstMonthInvoice?.status || ''),
    title: getCycleTitle({ isCurrent, invoice: invoice || firstMonthInvoice, batch, overageCents }),
  };
}

export async function getBillingUsageDashboard(projectId) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) {
    return { cycles: [], currentCycleId: null, subscription: null };
  }

  const [currentSubscription, summariesResult] = await Promise.all([
    getBillingSubscriptionForAccess(normalizedProjectId),
    supabase
      .from('billing_cycle_usage_summaries')
      .select([
        'id',
        'project_id',
        'subscription_id',
        'billing_cycle_id',
        'period_start',
        'period_end',
        'pass_install_quantity',
        'notification_sent_quantity',
        'included_pass_installs',
        'included_notification_sends',
        'overage_pass_install_cents',
        'overage_notification_sent_cents',
        'pass_install_overage_quantity',
        'notification_sent_overage_quantity',
        'pass_install_overage_cents',
        'notification_sent_overage_cents',
        'total_overage_cents',
        'last_usage_event_at',
      ].join(', '))
      .eq('project_id', normalizedProjectId)
      .order('period_start', { ascending: false })
      .limit(DEFAULT_HISTORY_LIMIT),
  ]);

  if (summariesResult.error) throw summariesResult.error;

  const summaryRows = Array.isArray(summariesResult.data) ? [...summariesResult.data] : [];
  const hasCurrentSummary = summaryRows.some((row) =>
    getCurrentCycleMatch(normalizeSummary(row), currentSubscription)
  );

  if (!hasCurrentSummary) {
    const syntheticSummary = buildSyntheticCurrentSummary(currentSubscription, normalizedProjectId);
    if (syntheticSummary) summaryRows.unshift(syntheticSummary);
  }

  const summaries = summaryRows.map(normalizeSummary);
  const billingCycleIds = [...new Set(summaries.map((summary) => summary.billingCycleId).filter(Boolean))];
  const subscriptionIds = [...new Set(summaries.map((summary) => summary.subscriptionId).filter(Boolean))];

  const [cycleInvoicesResult, firstMonthInvoicesResult, subscriptionsResult] = await Promise.all([
    billingCycleIds.length > 0
      ? supabase
        .from('billing_invoices')
        .select(BILLING_INVOICE_SELECT_FIELDS)
        .in('billing_cycle_id', billingCycleIds)
        .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    subscriptionIds.length > 0
      ? supabase
        .from('billing_invoices')
        .select(BILLING_INVOICE_SELECT_FIELDS)
        .in('subscription_id', subscriptionIds)
        .eq('metadata->>invoice_kind', 'subscription_first_month')
        .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    subscriptionIds.length > 0
      ? supabase
        .from('billing_subscriptions')
        .select('id, base_price_cents, currency')
        .in('id', subscriptionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (cycleInvoicesResult.error) throw cycleInvoicesResult.error;
  if (firstMonthInvoicesResult.error) throw firstMonthInvoicesResult.error;
  if (subscriptionsResult.error) throw subscriptionsResult.error;

  const invoices = dedupeInvoices([
    ...(Array.isArray(cycleInvoicesResult.data) ? cycleInvoicesResult.data : []),
    ...(Array.isArray(firstMonthInvoicesResult.data) ? firstMonthInvoicesResult.data : []),
  ].map(normalizeInvoice));
  const cycleInvoices = invoices.filter((invoice) => !invoice.isFirstMonthDiscounted);
  const invoicesByCycle = groupInvoicesByCycle(cycleInvoices);
  const firstMonthInvoices = invoices.filter((invoice) => invoice.isFirstMonthDiscounted);
  const collectionBatchIds = [...new Set(invoices.map((invoice) => invoice.collectionBatchId).filter(Boolean))];
  const batchesResult = collectionBatchIds.length > 0
    ? await supabase
      .from('billing_invoice_collection_batches')
      .select([
        'id',
        'status',
        'gateway_charge_status',
        'invoice_count',
        'original_subscription_payment_cents',
        'overage_cents',
        'updated_payment_cents',
        'currency',
        'due_at',
        'paid_at',
        'failed_at',
      ].join(', '))
      .in('id', collectionBatchIds)
    : { data: [], error: null };

  if (batchesResult.error) throw batchesResult.error;

  const batchesById = new Map((Array.isArray(batchesResult.data) ? batchesResult.data : [])
    .map((row) => {
      const batch = normalizeBatch(row);
      return [batch.id, batch];
    }));
  const subscriptionsById = new Map((Array.isArray(subscriptionsResult.data) ? subscriptionsResult.data : [])
    .map((row) => {
      const subscription = normalizeSubscriptionSnapshot(row);
      return [subscription.id, subscription];
    }));

  const cycles = summaries.map((summary) => {
    const invoice = invoicesByCycle.get(summary.billingCycleId)
      || null;
    const firstMonthInvoice = findFirstMonthInvoiceForSummary(summary, firstMonthInvoices);
    const batch = invoice?.collectionBatchId ? batchesById.get(invoice.collectionBatchId) || null : null;
    const subscriptionSnapshot = subscriptionsById.get(summary.subscriptionId) || null;
    return buildDashboardCycle(summary, {
      currentSubscription,
      invoice,
      firstMonthInvoice,
      batch,
      subscriptionSnapshot,
    });
  });
  const currentCycle = cycles.find((cycle) => cycle.isCurrent) || cycles[0] || null;

  return {
    cycles,
    currentCycleId: currentCycle?.id || null,
    subscription: currentSubscription,
  };
}
