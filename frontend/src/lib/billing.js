import { supabase } from '@/lib/supabaseClient';
import { fetchSubscriptionPlans } from '@/lib/subscriptionPlans';

const ACTIVE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'paused'];

async function readFunctionError(error) {
  const context = error?.context;
  const response = context?.response;

  if (response && typeof response.json === 'function') {
    try {
      return await response.json();
    } catch {
      // keep the generic message below
    }
  }

  if (typeof error?.message === 'string' && error.message) {
    return { error: error.message, code: null };
  }

  return { error: 'Nao foi possivel concluir a operacao.', code: null };
}

function buildBillingError(message, code = null) {
  const error = new Error(message || 'Nao foi possivel concluir a operacao.');
  if (code) error.code = code;
  return error;
}

function normalizePlan(row) {
  if (!row) return null;

  return {
    id: row.id || null,
    code: row.code || null,
    name: row.name || row.code || 'Plano',
    basePriceCents: Number(row.base_price_cents || 0),
    includedPassInstalls: Number(row.included_pass_installs || 0),
    includedNotificationSends: Number(row.included_notification_sends || 0),
    overagePassInstallCents: Number(row.overage_pass_install_cents || 0),
    overageNotificationSentCents: Number(row.overage_notification_sent_cents || 0),
  };
}

function normalizeSubscription(row) {
  if (!row) return null;

  const joinedPlan = Array.isArray(row.billing_plans)
    ? row.billing_plans[0]
    : row.billing_plans;

  return {
    id: row.id,
    projectId: row.project_id,
    planId: row.plan_id,
    status: row.status,
    currentPeriodStart: row.current_period_start || null,
    currentPeriodEnd: row.current_period_end || null,
    gatewayProvider: row.gateway_provider || null,
    gatewaySubscriptionId: row.gateway_subscription_id || null,
    basePriceCents: Number(row.base_price_cents || 0),
    includedPassInstalls: Number(row.included_pass_installs || 0),
    includedNotificationSends: Number(row.included_notification_sends || 0),
    overagePassInstallCents: Number(row.overage_pass_install_cents || 0),
    overageNotificationSentCents: Number(row.overage_notification_sent_cents || 0),
    plan: normalizePlan(joinedPlan),
  };
}

export async function getCurrentBillingSubscription(projectId) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return null;

  const { data, error } = await supabase
    .from('billing_subscriptions')
    .select([
      'id',
      'project_id',
      'plan_id',
      'status',
      'current_period_start',
      'current_period_end',
      'gateway_provider',
      'gateway_subscription_id',
      'base_price_cents',
      'included_pass_installs',
      'included_notification_sends',
      'overage_pass_install_cents',
      'overage_notification_sent_cents',
      'billing_plans(code, name, base_price_cents, included_pass_installs, included_notification_sends, overage_pass_install_cents, overage_notification_sent_cents)',
    ].join(', '))
    .eq('project_id', normalizedProjectId)
    .in('status', ACTIVE_SUBSCRIPTION_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return normalizeSubscription(data);
}

export async function getUpgradeablePlans(currentSubscription, planList) {
  if (!currentSubscription) return [];

  const plans = Array.isArray(planList) ? planList : await fetchSubscriptionPlans();
  const currentPlanCode = String(currentSubscription.plan?.code || '').trim().toLowerCase();
  const currentPrice = Number(currentSubscription.basePriceCents || currentSubscription.plan?.basePriceCents || 0);

  return plans
    .filter((plan) => plan?.type === 'paid')
    .filter((plan) => String(plan.code || '').trim().toLowerCase() !== currentPlanCode)
    .filter((plan) => Number(plan.price || 0) * 100 > currentPrice)
    .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
}

export function getBillingPlanName(subscription) {
  return subscription?.plan?.name || 'Plano atual';
}

export async function startBillingPlanChange({ projectId, planCode }) {
  const { data, error } = await supabase.functions.invoke('billing-start-plan-change', {
    body: {
      projectId,
      planCode,
    },
  });

  if (error) {
    const parsedError = await readFunctionError(error);
    throw buildBillingError(parsedError.error, parsedError.code);
  }

  if (data?.error) {
    throw buildBillingError(data.error, data.code || null);
  }

  return data;
}

export async function finalizeBillingPlanChange({ planChangeSessionId }) {
  const { data, error } = await supabase.functions.invoke('billing-finalize-plan-change', {
    body: {
      planChangeSessionId,
    },
  });

  if (error) {
    const parsedError = await readFunctionError(error);
    throw buildBillingError(parsedError.error, parsedError.code);
  }

  if (data?.error) {
    throw buildBillingError(data.error, data.code || null);
  }

  return data;
}
