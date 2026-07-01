import { supabase } from '@/lib/supabaseClient';
import { fetchSubscriptionPlans } from '@/lib/subscriptionPlans';
import {
  getFunctionErrorCode,
  getFunctionErrorMessage,
  readFunctionErrorPayload,
} from '@/lib/functionErrors';

const VISIBLE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'paused', 'suspended'];
const EXPIRED_SUBSCRIPTION_STATUS = 'expired';
const CANCELED_SUBSCRIPTION_STATUS = 'canceled';
const SUSPENDED_SUBSCRIPTION_STATUS = 'suspended';
const PAST_DUE_SUBSCRIPTION_STATUS = 'past_due';
const FREE_PLAN_CODE = 'free_trial';
const ACTIVE_PENDING_PLAN_CHANGE_STATUSES = ['pending', 'created', 'paid'];

async function readFunctionError(error, invokeResponse) {
  const payload = await readFunctionErrorPayload(error, invokeResponse);
  if (payload) {
    return {
      error: getFunctionErrorMessage(payload),
      code: getFunctionErrorCode(payload),
    };
  }

  const context = error?.context;

  if (context && typeof context.json === 'function') {
    try {
      return await context.json();
    } catch {
      // keep the generic message below
    }
  }

  if (typeof error?.message === 'string' && error.message) {
    return { error: error.message, code: null };
  }

  return { error: 'Não foi possível concluir a operação.', code: null };
}

function buildBillingError(message, code = null) {
  const error = new Error(message || 'Não foi possível concluir a operação.');
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
    endedAt: row.ended_at || null,
    canceledAt: row.canceled_at || null,
    delinquentSince: row.delinquent_since || null,
    graceEndsAt: row.grace_ends_at || null,
    suspendedAt: row.suspended_at || null,
    lastPaymentFailureAt: row.last_payment_failure_at || null,
    delinquencyGatewayChargeId: row.delinquency_gateway_charge_id || null,
    delinquencyReason: row.delinquency_reason || null,
    gatewayProvider: row.gateway_provider || null,
    gatewaySubscriptionId: row.gateway_subscription_id || null,
    basePriceCents: Number(row.base_price_cents || 0),
    includedPassInstalls: Number(row.included_pass_installs || 0),
    includedNotificationSends: Number(row.included_notification_sends || 0),
    overagePassInstallCents: Number(row.overage_pass_install_cents || 0),
    overageNotificationSentCents: Number(row.overage_notification_sent_cents || 0),
    plan: normalizePlan(joinedPlan),
    isPastDue: row.status === PAST_DUE_SUBSCRIPTION_STATUS,
    isSuspended: row.status === SUSPENDED_SUBSCRIPTION_STATUS,
    isCanceled: row.status === CANCELED_SUBSCRIPTION_STATUS,
    isTrialExpired: row.status === EXPIRED_SUBSCRIPTION_STATUS
      && normalizePlanCode(joinedPlan?.code) === FREE_PLAN_CODE,
  };
}

function normalizePendingPlanChange(row) {
  if (!row) return null;

  return {
    id: row.id || null,
    projectId: row.project_id || null,
    subscriptionId: row.subscription_id || null,
    previousPlanId: row.previous_plan_id || null,
    newPlanId: row.new_plan_id || null,
    newPlanCode: row.new_plan_code || null,
    newPlanName: row.new_plan_name || null,
    changeType: row.change_type || null,
    effectiveMode: row.effective_mode || null,
    status: row.status || null,
    currentPeriodEnd: row.current_period_end || null,
    createdAt: row.created_at || null,
  };
}

function normalizePlanCode(value) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function getPlanPriceCents(plan) {
  if (!plan) return 0;
  if (Number.isFinite(Number(plan.basePriceCents))) {
    return Number(plan.basePriceCents || 0);
  }
  return Math.round(Number(plan.price || 0) * 100);
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
      'ended_at',
      'canceled_at',
      'delinquent_since',
      'grace_ends_at',
      'suspended_at',
      'last_payment_failure_at',
      'delinquency_gateway_charge_id',
      'delinquency_reason',
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
    .in('status', VISIBLE_SUBSCRIPTION_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return normalizeSubscription(data);
}

export async function getBillingSubscriptionForAccess(projectId) {
  const activeSubscription = await getCurrentBillingSubscription(projectId);
  if (activeSubscription) return activeSubscription;

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
      'ended_at',
      'canceled_at',
      'gateway_provider',
      'gateway_subscription_id',
      'base_price_cents',
      'included_pass_installs',
      'included_notification_sends',
      'overage_pass_install_cents',
      'overage_notification_sent_cents',
      'billing_plans!inner(code, name, base_price_cents, included_pass_installs, included_notification_sends, overage_pass_install_cents, overage_notification_sent_cents)',
    ].join(', '))
    .eq('project_id', normalizedProjectId)
    .eq('status', EXPIRED_SUBSCRIPTION_STATUS)
    .eq('billing_plans.code', FREE_PLAN_CODE)
    .order('ended_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const expiredTrialSubscription = normalizeSubscription(data);
  if (expiredTrialSubscription) return expiredTrialSubscription;

  const { data: canceledData, error: canceledError } = await supabase
    .from('billing_subscriptions')
    .select([
      'id',
      'project_id',
      'plan_id',
      'status',
      'current_period_start',
      'current_period_end',
      'ended_at',
      'canceled_at',
      'delinquent_since',
      'grace_ends_at',
      'suspended_at',
      'last_payment_failure_at',
      'delinquency_gateway_charge_id',
      'delinquency_reason',
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
    .eq('status', CANCELED_SUBSCRIPTION_STATUS)
    .order('ended_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (canceledError) throw canceledError;
  return normalizeSubscription(canceledData);
}

export function isTrialExpired(subscription) {
  return Boolean(subscription?.isTrialExpired);
}

export function isBillingPastDue(subscription) {
  return Boolean(subscription?.isPastDue);
}

export function isBillingSuspended(subscription) {
  return Boolean(subscription?.isSuspended);
}

export function isBillingCanceled(subscription) {
  return Boolean(subscription?.isCanceled);
}

export async function getPendingBillingPlanChange(projectId) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return null;

  const { data, error } = await supabase.rpc('get_pending_billing_plan_change', {
    p_project_id: normalizedProjectId,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return normalizePendingPlanChange(row);
}

export function getPlanChangeKind(currentSubscription, targetPlan) {
  if (!currentSubscription || !targetPlan) return 'unavailable';

  const currentPlanCode = normalizePlanCode(currentSubscription.plan?.code);
  const targetPlanCode = normalizePlanCode(targetPlan.code);
  if (!targetPlanCode) return 'unavailable';
  if (targetPlanCode === FREE_PLAN_CODE) return 'unavailable';
  if (targetPlanCode === currentPlanCode) return 'current';

  const currentPriceCents = getPlanPriceCents(currentSubscription) || getPlanPriceCents(currentSubscription.plan);
  const targetPriceCents = getPlanPriceCents(targetPlan);

  if (currentPlanCode === FREE_PLAN_CODE || currentPriceCents <= 0) {
    return targetPriceCents > 0 ? 'trial_conversion' : 'current';
  }

  if (targetPriceCents > currentPriceCents) return 'upgrade';
  if (targetPriceCents < currentPriceCents) return 'downgrade';
  return 'plan_change';
}

export function getPlanChangeActionLabel(changeKind) {
  if (changeKind === 'current') return 'Plano atual';
  if (changeKind === 'trial_conversion') return 'Assinar plano';
  if (changeKind === 'upgrade') return 'Fazer upgrade';
  if (changeKind === 'downgrade') return 'Fazer downgrade';
  if (changeKind === 'plan_change') return 'Trocar plano';
  return 'Indisponível';
}

export async function getPlanChangeOptions(currentSubscription, planList, pendingPlanChange = null) {
  if (!currentSubscription) return [];
  if (isBillingSuspended(currentSubscription)) return [];
  if (isBillingPastDue(currentSubscription)) return [];
  if (isBillingCanceled(currentSubscription)) return [];

  const plans = Array.isArray(planList) ? planList : await fetchSubscriptionPlans();
  const pendingPlanCode = normalizePlanCode(pendingPlanChange?.newPlanCode);

  return plans
    .filter(Boolean)
    .map((plan) => {
      const changeKind = getPlanChangeKind(currentSubscription, plan);
      const isCurrent = changeKind === 'current';
      const expiredTrialConversion = isTrialExpired(currentSubscription) && changeKind === 'trial_conversion';
      const isPendingPlanChange = (() => {
        if (pendingPlanChange?.changeType === 'cancellation') return false;
        return Boolean(
          pendingPlanChange
            && pendingPlanChange.effectiveMode === 'next_cycle'
            && ACTIVE_PENDING_PLAN_CHANGE_STATUSES.includes(pendingPlanChange.status)
            && (
              (pendingPlanChange.newPlanId && pendingPlanChange.newPlanId === plan.id)
                || (pendingPlanCode && pendingPlanCode === normalizePlanCode(plan.code))
            ),
        );
      })();

      return {
        ...plan,
        changeKind,
        isCurrent,
        isPendingPlanChange,
        pendingPlanChange: isPendingPlanChange ? pendingPlanChange : null,
        isSelectable: !isPendingPlanChange
          && (expiredTrialConversion || (!isCurrent && changeKind !== 'unavailable')),
        actionLabel: isPendingPlanChange
          ? 'Downgrade já agendado'
          : getPlanChangeActionLabel(changeKind),
      };
    })
    .filter((plan) => plan.changeKind !== 'unavailable');
}

export const getUpgradeablePlans = getPlanChangeOptions;

export function getBillingPlanName(subscription) {
  if (isTrialExpired(subscription)) return 'Trial encerrado';
  return subscription?.plan?.name || 'Plano atual';
}

export async function startBillingPlanChange({ projectId, planCode }) {
  const { data, error, response } = await supabase.functions.invoke('billing-start-plan-change', {
    body: {
      projectId,
      planCode,
    },
  });

  if (error) {
    const parsedError = await readFunctionError(error, response);
    throw buildBillingError(parsedError.error, parsedError.code);
  }

  if (data?.error) {
    throw buildBillingError(data.error, data.code || null);
  }

  return data;
}

export async function finalizeBillingPlanChange({ planChangeSessionId }) {
  const { data, error, response } = await supabase.functions.invoke('billing-finalize-plan-change', {
    body: {
      planChangeSessionId,
    },
  });

  if (error) {
    const parsedError = await readFunctionError(error, response);
    throw buildBillingError(parsedError.error, parsedError.code);
  }

  if (data?.error) {
    throw buildBillingError(data.error, data.code || null);
  }

  return data;
}

async function manageBillingPlanCancellation({ projectId, action }) {
  const { data, error, response } = await supabase.functions.invoke('billing-manage-plan-cancellation', {
    body: {
      projectId,
      action,
    },
  });

  if (error) {
    const parsedError = await readFunctionError(error, response);
    throw buildBillingError(parsedError.error, parsedError.code);
  }

  if (data?.error) {
    throw buildBillingError(data.error, data.code || null);
  }

  return data;
}

export async function scheduleBillingPlanCancellation({ projectId }) {
  return manageBillingPlanCancellation({ projectId, action: 'schedule' });
}

export async function undoBillingPlanCancellation({ projectId }) {
  return manageBillingPlanCancellation({ projectId, action: 'undo' });
}

export async function reactivateBillingSubscription({ projectId }) {
  const { data, error, response } = await supabase.functions.invoke('billing-reactivate-subscription', {
    body: {
      projectId,
    },
  });

  if (error) {
    const parsedError = await readFunctionError(error, response);
    throw buildBillingError(parsedError.error, parsedError.code);
  }

  if (data?.error) {
    throw buildBillingError(data.error, data.code || null);
  }

  return data;
}

export async function startBillingPaymentRecovery({ projectId }) {
  const { data, error, response } = await supabase.functions.invoke('billing-start-payment-recovery', {
    body: {
      projectId,
    },
  });

  if (error) {
    const parsedError = await readFunctionError(error, response);
    throw buildBillingError(parsedError.error, parsedError.code);
  }

  if (data?.error) {
    throw buildBillingError(data.error, data.code || null);
  }

  return data;
}
