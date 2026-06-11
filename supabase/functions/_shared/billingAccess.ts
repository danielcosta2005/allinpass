export const PROJECT_BILLING_INACTIVE = "PROJECT_BILLING_INACTIVE";
export const PROJECT_BILLING_INACTIVE_MESSAGE = "Trial encerrado. Assine um plano para continuar.";
export const PROJECT_USAGE_LIMIT_EXCEEDED = "PROJECT_USAGE_LIMIT_EXCEEDED";
export const PROJECT_USAGE_LIMIT_EXCEEDED_MESSAGE = "Franquia do free trial esgotada. Assine um plano para continuar.";

const FREE_PLAN_CODE = "free_trial";
const ACTIVE_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "paused"];

export type ProjectUsageResourceType = "pass_install" | "notification_sent";

type ProjectUsageQuotaState = {
  allowed: boolean;
  isFreeTrial: boolean;
  remaining: number | null;
  used: number;
  included: number | null;
  requestedQuantity: number;
  resourceType: ProjectUsageResourceType;
  subscriptionId: string | null;
  planCode: string | null;
};

const RESOURCE_QUOTA_COLUMNS: Record<
  ProjectUsageResourceType,
  { usedColumn: string; includedColumn: string }
> = {
  pass_install: {
    usedColumn: "pass_install_quantity",
    includedColumn: "included_pass_installs",
  },
  notification_sent: {
    usedColumn: "notification_sent_quantity",
    includedColumn: "included_notification_sends",
  },
};

export class ProjectBillingInactiveError extends Error {
  code = PROJECT_BILLING_INACTIVE;
  status = 402;
  payload = {
    code: PROJECT_BILLING_INACTIVE,
    error: PROJECT_BILLING_INACTIVE_MESSAGE,
  };

  constructor() {
    super(PROJECT_BILLING_INACTIVE_MESSAGE);
    this.name = "ProjectBillingInactiveError";
  }
}

export class ProjectUsageLimitExceededError extends Error {
  code = PROJECT_USAGE_LIMIT_EXCEEDED;
  status = 402;
  payload = {
    code: PROJECT_USAGE_LIMIT_EXCEEDED,
    error: PROJECT_USAGE_LIMIT_EXCEEDED_MESSAGE,
  };
  state?: ProjectUsageQuotaState;

  constructor(resourceType?: ProjectUsageResourceType, state?: ProjectUsageQuotaState) {
    super(PROJECT_USAGE_LIMIT_EXCEEDED_MESSAGE);
    this.name = "ProjectUsageLimitExceededError";
    this.state = state
      ? { ...state, resourceType: resourceType ?? state.resourceType }
      : undefined;
  }
}

export function isProjectBillingInactiveError(error: unknown): error is ProjectBillingInactiveError {
  return Boolean(
    error
      && typeof error === "object"
      && (
        (error as { code?: unknown }).code === PROJECT_BILLING_INACTIVE
        || (error as { name?: unknown }).name === "ProjectBillingInactiveError"
      ),
  );
}

export function isProjectUsageLimitExceededError(error: unknown): error is ProjectUsageLimitExceededError {
  return Boolean(
    error
      && typeof error === "object"
      && (
        (error as { code?: unknown }).code === PROJECT_USAGE_LIMIT_EXCEEDED
        || (error as { name?: unknown }).name === "ProjectUsageLimitExceededError"
      ),
  );
}

export function getProjectBillingInactivePayload(error: unknown) {
  if (
    error
    && typeof error === "object"
    && "payload" in error
    && (error as { payload?: unknown }).payload
  ) {
    return (error as { payload: unknown }).payload;
  }

  return {
    code: PROJECT_BILLING_INACTIVE,
    error: PROJECT_BILLING_INACTIVE_MESSAGE,
  };
}

export function getProjectUsageLimitExceededPayload(error: unknown) {
  if (
    error
    && typeof error === "object"
    && "payload" in error
    && (error as { payload?: unknown }).payload
  ) {
    return (error as { payload: unknown }).payload;
  }

  return {
    code: PROJECT_USAGE_LIMIT_EXCEEDED,
    error: PROJECT_USAGE_LIMIT_EXCEEDED_MESSAGE,
  };
}

function normalizeQuantity(quantity: unknown) {
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.trunc(parsed));
}

function normalizeNonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function getRelationRecord(row: any, key: string) {
  const value = row?.[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function assertProjectBillingActive(supabase: any, projectId: string) {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) return;

  const { data, error } = await supabase
    .from("billing_subscriptions")
    .select("id")
    .eq("project_id", normalizedProjectId)
    .in("status", ["trialing", "active", "past_due", "paused"])
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new ProjectBillingInactiveError();
}

export async function getProjectUsageQuotaState(
  supabase: any,
  projectId: string,
  resourceType: ProjectUsageResourceType,
  quantity = 1,
): Promise<ProjectUsageQuotaState> {
  const normalizedProjectId = String(projectId || "").trim();
  const requestedQuantity = normalizeQuantity(quantity);
  const quotaColumns = RESOURCE_QUOTA_COLUMNS[resourceType];

  if (!normalizedProjectId || !quotaColumns) {
    return {
      allowed: true,
      isFreeTrial: false,
      remaining: null,
      used: 0,
      included: null,
      requestedQuantity,
      resourceType,
      subscriptionId: null,
      planCode: null,
    };
  }

  const { data: subscription, error: subscriptionError } = await supabase
    .from("billing_subscriptions")
    .select([
      "id",
      "plan_id",
      "status",
      "current_period_start",
      "current_period_end",
      "included_pass_installs",
      "included_notification_sends",
      "billing_plans(code)",
    ].join(","))
    .eq("project_id", normalizedProjectId)
    .in("status", ACTIVE_SUBSCRIPTION_STATUSES)
    .order("current_period_start", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError) throw subscriptionError;

  const billingPlan = getRelationRecord(subscription, "billing_plans");
  let planCode = String(billingPlan?.code || "").trim();

  if (subscription?.plan_id && !planCode) {
    const { data: plan, error: planError } = await supabase
      .from("billing_plans")
      .select("code")
      .eq("id", subscription.plan_id)
      .maybeSingle();

    if (planError) throw planError;
    planCode = String(plan?.code || "").trim();
  }

  if (!subscription) throw new ProjectBillingInactiveError();

  if (planCode !== FREE_PLAN_CODE) {
    return {
      allowed: true,
      isFreeTrial: false,
      remaining: null,
      used: 0,
      included: null,
      requestedQuantity,
      resourceType,
      subscriptionId: subscription?.id ?? null,
      planCode: planCode || null,
    };
  }

  const nowIso = new Date().toISOString();
  const { data: summary, error: summaryError } = await supabase
    .from("billing_cycle_usage_summaries")
    .select([
      "pass_install_quantity",
      "notification_sent_quantity",
      "included_pass_installs",
      "included_notification_sends",
    ].join(","))
    .eq("project_id", normalizedProjectId)
    .eq("subscription_id", subscription.id)
    .lte("period_start", nowIso)
    .gt("period_end", nowIso)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (summaryError) throw summaryError;

  const used = normalizeNonNegativeInteger(summary?.[quotaColumns.usedColumn]);
  const included = normalizeNonNegativeInteger(subscription?.[quotaColumns.includedColumn]);
  const remaining = Math.max(included - used, 0);

  return {
    allowed: remaining >= requestedQuantity,
    isFreeTrial: true,
    remaining,
    used,
    included,
    requestedQuantity,
    resourceType,
    subscriptionId: subscription.id,
    planCode,
  };
}

export async function assertProjectUsageAllowed(
  supabase: any,
  projectId: string,
  resourceType: ProjectUsageResourceType,
  quantity = 1,
) {
  const state = await getProjectUsageQuotaState(supabase, projectId, resourceType, quantity);
  if (!state.allowed) throw new ProjectUsageLimitExceededError(resourceType, state);
  return state;
}
