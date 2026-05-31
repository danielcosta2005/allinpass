const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

describe("billing plan changes", () => {
  test("ships a private plan-change checkout/session table", () => {
    const migrationsDir = path.join(repoRoot, "supabase/migrations");
    const migrationSources = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    expect(migrationSources).toContain("create table if not exists public.billing_plan_change_sessions");
    expect(migrationSources).toContain("project_id uuid not null references public.projects(id)");
    expect(migrationSources).toContain("subscription_id uuid not null");
    expect(migrationSources).toContain("previous_plan_id uuid not null references public.billing_plans(id)");
    expect(migrationSources).toContain("new_plan_id uuid not null references public.billing_plans(id)");
    expect(migrationSources).toContain("change_type in ('upgrade', 'downgrade', 'trial_conversion', 'plan_change')");
    expect(migrationSources).toContain("'renewal', 'cancellation', 'reactivation', 'trial_conversion', 'plan_change'");
    expect(migrationSources).toContain("provider_checkout_id text");
    expect(migrationSources).toContain("billing_plan_change_sessions_provider_checkout_uidx");
    expect(migrationSources).toContain("alter table public.billing_plan_change_sessions enable row level security");
    expect(migrationSources).toContain("revoke all on table public.billing_plan_change_sessions from authenticated");
    expect(migrationSources).toContain("grant select, insert, update on table public.billing_plan_change_sessions to service_role");
  });

  test("registers a plan-change edge function and integrates Asaas plan-change paths", () => {
    const configSource = readIfExists("supabase/config.toml");
    const functionSource = readIfExists("supabase/functions/billing-start-plan-change/index.ts");
    const webhookSource = readIfExists("supabase/functions/asaas-webhook/index.ts");

    expect(configSource).toContain("[functions.billing-start-plan-change]");
    expect(configSource).toContain('entrypoint = "./functions/billing-start-plan-change/index.ts"');

    expect(functionSource).toContain("billing_plan_change_sessions");
    expect(functionSource).toContain("billing_subscriptions");
    expect(functionSource).toContain("billing_subscription_changes");
    expect(functionSource).toContain("applyBillingPlanChange");
    expect(functionSource).toContain("createPlanChangeCheckout");
    expect(functionSource).toContain("updateAsaasSubscription");
    expect(functionSource).toContain("updatePendingPayments");
    expect(functionSource).toContain("downgrade");
    expect(functionSource).toContain("planCode === FREE_PLAN_CODE");
    expect(functionSource).toContain("Free trial nao pode ser destino de mudanca de plano.");
    expect(functionSource).not.toContain("BILLING_PLAN_CHANGE_NOT_AN_UPGRADE");

    expect(webhookSource).toContain("handlePlanChangeCheckoutWebhook");
    expect(webhookSource).toContain("billing_plan_change_sessions");
    expect(webhookSource).toContain("SUBSCRIPTION_UPDATED");
  });

  test("/org shows the current billing plan and can start any paid plan change", () => {
    const billingClientSource = readIfExists("frontend/src/lib/billing.js");
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");

    expect(billingClientSource).toContain("getCurrentBillingSubscription");
    expect(billingClientSource).toContain("getPlanChangeOptions");
    expect(billingClientSource).toContain("startBillingPlanChange");
    expect(billingClientSource).toContain("billing-start-plan-change");
    expect(billingClientSource).toContain("getPlanChangeKind");
    expect(billingClientSource).toContain("if (targetPlanCode === FREE_PLAN_CODE) return 'unavailable';");
    expect(billingClientSource).toContain(".filter((plan) => plan.changeKind !== 'unavailable')");

    expect(dashboardSource).toContain("getCurrentBillingSubscription");
    expect(dashboardSource).toContain("startBillingPlanChange");
    expect(dashboardSource).toContain("Escolha seu plano");
    expect(dashboardSource).toContain("handleStartPlanChange");
    expect(dashboardSource).toContain("Plano atual");
    expect(dashboardSource).toContain("Fazer downgrade");
    expect(dashboardSource).toContain("flex flex-wrap justify-center gap-5");
    expect(dashboardSource).toContain("billingPlanName");
  });
});
