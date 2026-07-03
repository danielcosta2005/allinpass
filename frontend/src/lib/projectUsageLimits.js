import { supabase } from '@/lib/supabaseClient';

const USAGE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'paused', 'suspended', 'expired'];

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function normalizePlan(row) {
  const joinedPlan = Array.isArray(row?.billing_plans)
    ? row.billing_plans[0]
    : row?.billing_plans;

  return {
    code: joinedPlan?.code || null,
    name: joinedPlan?.name || joinedPlan?.code || 'Plano',
  };
}

function normalizeSubscription(row) {
  if (!row) return null;
  const plan = normalizePlan(row);

  return {
    id: row.id,
    projectId: row.project_id,
    plan,
    status: row.status || null,
    trialEndsAt: row.trial_ends_at || null,
    isFreeTrial: plan.code === 'free_trial',
    currentPeriodStart: row.current_period_start || null,
    currentPeriodEnd: row.current_period_end || null,
    includedPassInstalls: toNonNegativeInteger(row.included_pass_installs),
    includedNotificationSends: toNonNegativeInteger(row.included_notification_sends),
  };
}

function normalizeSummary(row) {
  if (!row) return null;

  return {
    id: row.id,
    projectId: row.project_id,
    subscriptionId: row.subscription_id,
    periodStart: row.period_start || null,
    periodEnd: row.period_end || null,
    passInstallQuantity: toNonNegativeInteger(row.pass_install_quantity),
    notificationSentQuantity: toNonNegativeInteger(row.notification_sent_quantity),
  };
}

function buildUsageMetric({ included, used }) {
  const normalizedIncluded = toNonNegativeInteger(included);
  const normalizedUsed = toNonNegativeInteger(used);
  const remaining = Math.max(normalizedIncluded - normalizedUsed, 0);
  const usagePercent = normalizedIncluded > 0
    ? Math.min(100, Math.round((normalizedUsed * 100) / normalizedIncluded))
    : 0;

  return {
    included: normalizedIncluded,
    used: normalizedUsed,
    remaining,
    usagePercent,
  };
}

function buildUsageSnapshot(subscription, summary) {
  if (!subscription) {
    return {
      subscription: null,
      summary: null,
      passInstalls: buildUsageMetric({ included: 0, used: 0 }),
      notifications: buildUsageMetric({ included: 0, used: 0 }),
    };
  }

  return {
    subscription,
    summary,
    passInstalls: buildUsageMetric({
      included: subscription.includedPassInstalls,
      used: summary?.passInstallQuantity || 0,
    }),
    notifications: buildUsageMetric({
      included: subscription.includedNotificationSends,
      used: summary?.notificationSentQuantity || 0,
    }),
  };
}

async function getCurrentCycleSummary(projectId, subscription) {
  if (!subscription?.id) return null;

  const nowIso = new Date().toISOString();
  const baseSelect = [
    'id',
    'project_id',
    'subscription_id',
    'period_start',
    'period_end',
    'pass_install_quantity',
    'notification_sent_quantity',
  ].join(', ');

  const currentResult = await supabase
    .from('billing_cycle_usage_summaries')
    .select(baseSelect)
    .eq('project_id', projectId)
    .eq('subscription_id', subscription.id)
    .lte('period_start', nowIso)
    .gt('period_end', nowIso)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentResult.error) throw currentResult.error;
  if (currentResult.data) return normalizeSummary(currentResult.data);

  if (!subscription.currentPeriodStart || !subscription.currentPeriodEnd) return null;

  const periodResult = await supabase
    .from('billing_cycle_usage_summaries')
    .select(baseSelect)
    .eq('project_id', projectId)
    .eq('subscription_id', subscription.id)
    .eq('period_start', subscription.currentPeriodStart)
    .eq('period_end', subscription.currentPeriodEnd)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (periodResult.error) throw periodResult.error;
  return normalizeSummary(periodResult.data);
}

export async function getProjectUsageLimits(projectId) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return buildUsageSnapshot(null, null);

  const { data, error } = await supabase
    .from('billing_subscriptions')
    .select([
      'id',
      'project_id',
      'status',
      'trial_ends_at',
      'current_period_start',
      'current_period_end',
      'included_pass_installs',
      'included_notification_sends',
      'billing_plans(code, name)',
    ].join(', '))
    .eq('project_id', normalizedProjectId)
    .in('status', USAGE_SUBSCRIPTION_STATUSES)
    .order('current_period_start', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  const subscription = normalizeSubscription(data);
  const summary = await getCurrentCycleSummary(normalizedProjectId, subscription);

  return buildUsageSnapshot(subscription, summary);
}

export async function updateProjectUsageLimits({
  projectId,
  subscriptionId,
  includedPassInstalls,
  includedNotificationSends,
  trialEndsAt = null,
}) {
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedSubscriptionId = String(subscriptionId || '').trim();

  if (!normalizedProjectId || !normalizedSubscriptionId) {
    throw new Error('Assinatura ativa não encontrada para este projeto.');
  }

  const { data, error } = await supabase
    .rpc('update_superadmin_project_usage_limits', {
      p_project_id: normalizedProjectId,
      p_subscription_id: normalizedSubscriptionId,
      p_included_pass_installs: toNonNegativeInteger(includedPassInstalls),
      p_included_notification_sends: toNonNegativeInteger(includedNotificationSends),
      p_trial_ends_at: trialEndsAt || null,
    });

  if (error) throw error;
  if (!data) throw new Error('Assinatura ativa não encontrada para este projeto.');

  return normalizeSubscription(data);
}
