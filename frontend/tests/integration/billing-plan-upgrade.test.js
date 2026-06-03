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
    expect(functionSource).toContain("resolveAsaasSubscriptionId");
    expect(functionSource).toContain("isAsaasSubscriptionId");
    expect(functionSource).toContain("downgrade");
    expect(functionSource).toContain("planCode === FREE_PLAN_CODE");
    expect(functionSource).toContain("Free trial nao pode ser destino de mudanca de plano.");
    expect(functionSource).not.toContain("BILLING_PLAN_CHANGE_NOT_AN_UPGRADE");

    expect(webhookSource).toContain("handlePlanChangeCheckoutWebhook");
    expect(webhookSource).toContain("handlePaymentWebhook");
    expect(webhookSource).toContain("PAYMENT_CONFIRMED");
    expect(webhookSource).toContain("last_asaas_payment_webhook");
    expect(webhookSource).toContain("provider_checkout_id");
    expect(webhookSource).toContain("billing_plan_change_sessions");
    expect(webhookSource).toContain("SUBSCRIPTION_UPDATED");
    expect(webhookSource).toContain("gateway_customer_id");
    expect(readIfExists("supabase/functions/signup-finalize/index.ts")).toContain("provider_customer_id || !checkoutSession.provider_subscription_id");
    expect(readIfExists("supabase/functions/billing-finalize-plan-change/index.ts")).toContain("provider_subscription_id || !session.provider_customer_id");
    expect(readIfExists("supabase/functions/signup-finalize/index.ts")).not.toContain("?? paidCheckoutSession?.provider_checkout_id");
  });

  test("/org shows the current billing plan and can start any paid plan change", () => {
    const billingClientSource = readIfExists("frontend/src/lib/billing.js");
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");
    const billingHookSource = readIfExists("frontend/src/hooks/useRestaurantBilling.js");
    const billingDialogSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingPlanDialog.jsx");
    const billingCardSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingPlanChoiceCard.jsx");

    expect(billingClientSource).toContain("getCurrentBillingSubscription");
    expect(billingClientSource).toContain("getPlanChangeOptions");
    expect(billingClientSource).toContain("startBillingPlanChange");
    expect(billingClientSource).toContain("billing-start-plan-change");
    expect(billingClientSource).toContain("getPlanChangeKind");
    expect(billingClientSource).toContain("if (targetPlanCode === FREE_PLAN_CODE) return 'unavailable';");
    expect(billingClientSource).toContain(".filter((plan) => plan.changeKind !== 'unavailable')");

    expect(billingHookSource).toContain("getCurrentBillingSubscription");
    expect(billingHookSource).toContain("startBillingPlanChange");
    expect(billingDialogSource).toContain("Escolha seu plano");
    expect(dashboardSource).toContain("handleStartPlanChange");
    expect(billingCardSource).toContain("Plano atual");
    expect(billingCardSource).toContain("Fazer downgrade");
    expect(billingDialogSource).toContain("flex flex-wrap justify-center gap-5");
    expect(dashboardSource).toContain("billingPlanName");
  });

  test("keeps the restaurant dashboard modular after adding billing flows", () => {
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");

    expect(readIfExists("frontend/src/constants/restaurantDashboard.js")).toContain("DASHBOARD_TABS");
    expect(readIfExists("frontend/src/hooks/useRestaurantBilling.js")).toContain("useRestaurantBilling");
    expect(readIfExists("frontend/src/hooks/usePaidSignupRecovery.js")).toContain("usePaidSignupRecovery");
    expect(readIfExists("frontend/src/hooks/useProjectName.js")).toContain("useProjectName");
    expect(readIfExists("frontend/src/components/restaurant/dashboard/RestaurantTopBar.jsx")).toContain("RestaurantTopBar");
    expect(readIfExists("frontend/src/components/restaurant/dashboard/BillingPlanDialog.jsx")).toContain("BillingPlanDialog");
    expect(readIfExists("frontend/src/components/restaurant/dashboard/NoProjectSignupState.jsx")).toContain("NoProjectSignupState");

    expect(dashboardSource).toContain("useRestaurantBilling");
    expect(dashboardSource).toContain("RestaurantTopBar");
    expect(dashboardSource).not.toContain("const BillingPlanChoiceCard");
    expect(dashboardSource).not.toContain("const NoProjectSignupState");
  });

  test("codifies full upgrade allowance and new-plan overage prices for cycle billing", () => {
    const migrationsDir = path.join(repoRoot, "supabase/migrations");
    const migrationSources = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    expect(migrationSources).toContain("full_new_plan");
    expect(migrationSources).toContain("effective_overage_pass_install_cents");
    expect(migrationSources).toContain("effective_overage_notification_sent_cents");
    expect(migrationSources).toContain("new.change_type in ('upgrade', 'trial_conversion', 'plan_change')");
    expect(migrationSources).toContain("new.prorated_install_allowance := coalesce(new.new_included_pass_installs, 0)");
    expect(migrationSources).toContain("new.prorated_notification_allowance := coalesce(new.new_included_notification_sends, 0)");
    expect(migrationSources).toContain("new.effective_overage_pass_install_cents := coalesce(new.new_overage_pass_install_cents, 0)");
    expect(migrationSources).toContain("new.effective_overage_notification_sent_cents := coalesce(new.new_overage_notification_sent_cents, 0)");
    expect(migrationSources).toContain("create or replace function public.get_billing_cycle_entitlements");
    expect(migrationSources).toContain("create or replace function public.calculate_billing_cycle_overage");
    expect(migrationSources).toContain("ceil(coalesce(");
    expect(migrationSources).toContain("v_change.prorated_notification_allowance");
  });

  test("schedules downgrades for the next cycle instead of applying them immediately", () => {
    const functionSource = readIfExists("supabase/functions/billing-start-plan-change/index.ts");
    const migrationsDir = path.join(repoRoot, "supabase/migrations");
    const migrationSources = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    expect(functionSource).toContain("function getPlanChangeEffectiveMode");
    expect(functionSource).toContain('return changeType === "downgrade" ? "next_cycle" : "immediate";');
    expect(functionSource).toContain("effective_mode: effectiveMode");
    expect(functionSource).toContain("updatePendingPayments: effectiveMode === \"immediate\"");
    expect(functionSource).toContain("scheduled: effectiveMode === \"next_cycle\"");

    expect(migrationSources).toContain("v_session.effective_mode = 'next_cycle'");
    expect(migrationSources).toContain("v_subscription.current_period_end > now()");
    expect(migrationSources).toContain("'scheduled', true");
    expect(migrationSources).toContain("create or replace function public.apply_due_billing_plan_changes");
    expect(migrationSources).toContain("where status = 'paid'");
    expect(migrationSources).toContain("and effective_mode = 'next_cycle'");
    expect(migrationSources).toContain("perform public.apply_billing_plan_change");
    expect(migrationSources).toContain("cron.schedule(");
    expect(migrationSources).toContain("billing-apply-due-plan-changes");
  });
});
