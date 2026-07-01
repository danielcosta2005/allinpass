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

describe("billing subscription reactivation", () => {
  test("ships a private owner-only reactivation function registered in Supabase", () => {
    const configSource = readIfExists("supabase/config.toml");
    const functionSource = readIfExists("supabase/functions/billing-reactivate-subscription/index.ts");

    expect(configSource).toContain("[functions.billing-reactivate-subscription]");
    expect(configSource).toContain('entrypoint = "./functions/billing-reactivate-subscription/index.ts"');

    expect(functionSource).toContain("BILLING_SUBSCRIPTION_REACTIVATION_OWNER_REQUIRED");
    expect(functionSource).toContain("requireOwnerMembership");
    expect(functionSource).toContain(".eq(\"status\", \"canceled\")");
    expect(functionSource).toContain("isAsaasSubscriptionId");
    expect(functionSource).toContain("/subscriptions/");
    expect(functionSource).toContain('method: "GET"');
    expect(functionSource).toContain('method: "PUT"');
    expect(functionSource).toContain('status: "ACTIVE"');
    expect(functionSource).toContain("nextDueDate");
    expect(functionSource).toContain("function addDays");
    expect(functionSource).toContain("nextDueDate: formatAsaasDate(addDays(reactivationDate, 1))");
    expect(functionSource).toContain("reactivate_billing_subscription");
    expect(functionSource).toContain("BILLING_SUBSCRIPTION_REACTIVATION_DELETED_PROVIDER_SUBSCRIPTION");
    expect(functionSource).toContain("BILLING_SUBSCRIPTION_REACTIVATION_EXPIRED_PROVIDER_SUBSCRIPTION");
  });

  test("adds a transactional RPC that restores the local subscription and opens a new cycle", () => {
    const migrationSources = readMigrationSources();

    expect(migrationSources).toContain("create or replace function public.reactivate_billing_subscription");
    expect(migrationSources).toContain("for update");
    expect(migrationSources).toContain("status = 'active'");
    expect(migrationSources).toContain("cancel_at_period_end = false");
    expect(migrationSources).toContain("canceled_at = null");
    expect(migrationSources).toContain("ended_at = null");
    expect(migrationSources).toContain("current_period_start = v_effective_at");
    expect(migrationSources).toContain("current_period_end = v_period_end");
    expect(migrationSources).toContain("change_type");
    expect(migrationSources).toContain("'reactivation'");
    expect(migrationSources).toContain("insert into public.billing_cycles");
    expect(migrationSources).toContain("'origin', 'billing_subscription_reactivation'");
    expect(migrationSources).toContain("project_billing_audit_logs");
    expect(migrationSources).toContain("grant execute on function public.reactivate_billing_subscription");
  });

  test("exposes reactivation from the billing client and dashboard UI", () => {
    const billingClientSource = readIfExists("frontend/src/lib/billing.js");
    const billingHookSource = readIfExists("frontend/src/hooks/useRestaurantBilling.js");
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");
    const canceledStateSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingCanceledState.jsx");
    const dialogSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingDashboardDialog.jsx");

    expect(billingClientSource).toContain("reactivateBillingSubscription");
    expect(billingClientSource).toContain("billing-reactivate-subscription");

    expect(billingHookSource).toContain("billingReactivationAction");
    expect(billingHookSource).toContain("handleReactivateBillingSubscription");
    expect(billingHookSource).toContain("Assinatura reativada");

    expect(dashboardSource).toContain("handleReactivateBillingSubscription");
    expect(dashboardSource).toContain("billingReactivationAction");
    expect(dashboardSource).toContain("onReactivateSubscription={handleReactivateBillingSubscription}");
    expect(dashboardSource).toContain("subscription={billingSubscription}");

    expect(canceledStateSource).toContain("subscription,");
    expect(canceledStateSource).toContain("getReactivationPlanSummary");
    expect(canceledStateSource).toContain("Reativar assinatura");
    expect(canceledStateSource).toContain("Confirmar reativação");
    expect(canceledStateSource).toContain("Plano que será reativado");
    expect(canceledStateSource).toContain("Valor mensal");
    expect(canceledStateSource).toContain("setReactivationConfirmationOpen(true)");
    expect(canceledStateSource).toContain("A assinatura será reativada no Asaas");
    expect(canceledStateSource).toContain("novo ciclo de cobrança");
    expect(canceledStateSource).toContain("forma de pagamento cadastrada");
    expect(canceledStateSource).toContain("canManageBilling");
    expect(canceledStateSource).toContain("onReactivateSubscription");
    expect(canceledStateSource).toContain("Fale com o gestor");

    expect(dialogSource).toContain("onReactivateSubscription");
    expect(dialogSource).toContain("getReactivationPlanSummary");
    expect(dialogSource).toContain("Assinatura cancelada");
    expect(dialogSource).toContain("Reativar assinatura");
    expect(dialogSource).toContain("Confirmar reativação");
    expect(dialogSource).toContain("Plano que será reativado");
    expect(dialogSource).toContain("Valor mensal");
    expect(dialogSource).toContain("setReactivationConfirmationOpen(true)");
    expect(dialogSource).toContain("A assinatura será reativada no Asaas");
    expect(dialogSource).toContain("novo ciclo de cobrança");
    expect(dialogSource).toContain("forma de pagamento cadastrada");
    expect(dialogSource).not.toContain("disabled={isBusy || isBillingCanceled}");
  });

  test("keeps plan changes unavailable while the subscription is canceled", () => {
    const billingClientSource = readIfExists("frontend/src/lib/billing.js");
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");

    expect(billingClientSource).toContain("if (isBillingCanceled(currentSubscription)) return [];");
    expect(dashboardSource).toContain("if (isBillingCanceled) {");
    expect(dashboardSource).toContain("Assinatura cancelada");
    expect(dashboardSource).toContain("Reative a assinatura antes de trocar de plano");
  });
});
