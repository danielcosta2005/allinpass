const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function readMigrationSources() {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");
}

describe("billing trial expiration enforcement", () => {
  test("keeps the trial expiration scheduler and exposes an expired-trial lock state in /org", () => {
    const migrationSources = readMigrationSources();
    const billingClientSource = readIfExists("frontend/src/lib/billing.js");
    const billingHookSource = readIfExists("frontend/src/hooks/useRestaurantBilling.js");
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");
    const trialExpiredStateSource = readIfExists("frontend/src/components/restaurant/dashboard/TrialExpiredBillingState.jsx");

    expect(migrationSources).toContain("create or replace function public.expire_trial_subscriptions()");
    expect(migrationSources).toContain("set status = 'expired'");
    expect(migrationSources).toContain("'billing-expire-trials'");

    expect(billingClientSource).toContain("getBillingSubscriptionForAccess");
    expect(billingClientSource).toContain("isTrialExpired");
    expect(billingHookSource).toContain("billingAccessState");
    expect(billingHookSource).toContain("canManageBilling");
    expect(billingHookSource).toContain("memberRole");
    expect(dashboardSource).toContain("TrialExpiredBillingState");
    expect(dashboardSource).toContain("isTrialExpired");
    expect(dashboardSource).toContain("trialExpiredNoticeDismissed");
    expect(dashboardSource).toContain("onDismiss={() => setTrialExpiredNoticeDismissed(true)}");
    expect(trialExpiredStateSource).toContain("Trial encerrado");
    expect(trialExpiredStateSource).toContain("Fechar aviso");
    expect(trialExpiredStateSource).toContain("fixed inset-0");
    expect(trialExpiredStateSource).toContain("backdrop-blur-sm");
    expect(trialExpiredStateSource).toContain("role=\"dialog\"");
    expect(trialExpiredStateSource).toContain("Clock");
    expect(trialExpiredStateSource).not.toContain("Sparkles");
    expect(trialExpiredStateSource).toContain("Continue usando o Allin Pass sem perder o ritmo");
    expect(trialExpiredStateSource).toContain("Escolher plano");
    expect(trialExpiredStateSource).toContain("Fale com o gestor");
  });

  test("allows a paid checkout to reactivate an expired free trial subscription only as trial conversion", () => {
    const functionSource = readIfExists("supabase/functions/billing-start-plan-change/index.ts");
    const migrationSources = readMigrationSources();

    expect(functionSource).toContain("EXPIRABLE_SUBSCRIPTION_STATUSES");
    expect(functionSource).toContain("allowExpiredTrial");
    expect(functionSource).toContain("currentPlanCode === FREE_PLAN_CODE");
    expect(functionSource).toContain("targetPriceCents > 0");
    expect(functionSource).toContain("BILLING_PLAN_CHANGE_EXPIRED_SUBSCRIPTION_UNSUPPORTED");

    expect(migrationSources).toContain("v_is_expired_trial_conversion");
    expect(migrationSources).toContain("status in ('trialing', 'active', 'past_due', 'paused', 'expired')");
    expect(migrationSources).toContain("ended_at = null");
    expect(migrationSources).toContain("canceled_at = null");
    expect(migrationSources).toContain("current_period_start = case when v_is_expired_trial_conversion then v_effective_at");
    expect(migrationSources).toContain("current_period_end = case when v_is_expired_trial_conversion then v_effective_at + interval '1 month'");
    expect(migrationSources).toContain("insert into public.billing_cycles");
  });

  test("critical operational edge functions reject inactive billing before creating project usage", () => {
    const helperSource = readIfExists("supabase/functions/_shared/billingAccess.ts");
    const criticalFunctions = [
      "supabase/functions/scanner-visit/index.ts",
      "supabase/functions/scanner-reward/index.ts",
      "supabase/functions/notifications-enqueue/index.ts",
      "supabase/functions/create-pass/index.ts",
      "supabase/functions/update-pass/index.ts",
      "supabase/functions/create-automation/index.ts",
    ];

    expect(helperSource).toContain("PROJECT_BILLING_INACTIVE");
    expect(helperSource).toContain("Plano inativo. Regularize sua assinatura para continuar.");
    expect(helperSource).toContain("assertProjectBillingActive");
    expect(helperSource).toContain("status\", [\"trialing\", \"active\", \"past_due\", \"paused\"]");

    for (const relativePath of criticalFunctions) {
      const source = readIfExists(relativePath);
      expect(source).toContain("../_shared/billingAccess.ts");
      expect(source).toContain("assertProjectBillingActive");
    }
  });

  test("superadmin pass management functions keep the billing guard used by the UI", () => {
    const walletConfigSource = readIfExists("frontend/src/components/superadmin/WalletConfigTab.jsx");
    const createPassSource = readIfExists("supabase/functions/create-pass/index.ts");
    const updatePassSource = readIfExists("supabase/functions/update-pass/index.ts");

    expect(walletConfigSource).toContain("invokeWalletFunction('create-pass'");
    expect(walletConfigSource).toContain("invokeWalletFunction('update-pass'");
    expect(walletConfigSource).not.toContain("invokeWalletFunction('create-pass-teste'");
    expect(walletConfigSource).not.toContain("invokeWalletFunction('update-pass-teste'");
    expect(walletConfigSource).toContain("readFunctionErrorPayload");
    expect(walletConfigSource).toContain("error?.context?.response || error?.context");
    expect(walletConfigSource).toContain("payload.message || payload.error");

    for (const source of [createPassSource, updatePassSource]) {
      expect(source).toContain("../_shared/billingAccess.ts");
      expect(source).toContain("assertProjectBillingActive");
      expect(source).toContain("isProjectBillingInactiveError");
      expect(source).toContain("getProjectBillingInactivePayload");
      expect(source).toContain("402");
    }
  });
});
