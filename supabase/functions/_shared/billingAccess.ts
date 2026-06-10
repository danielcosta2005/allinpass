export const PROJECT_BILLING_INACTIVE = "PROJECT_BILLING_INACTIVE";
export const PROJECT_BILLING_INACTIVE_MESSAGE = "Trial encerrado. Assine um plano para continuar.";

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
