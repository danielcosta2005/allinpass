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
    expect(functionSource).toContain("Free trial não pode ser destino de mudança de plano.");
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
    expect(billingClientSource).toContain("getPendingBillingPlanChange");
    expect(billingClientSource).toContain("getPlanChangeOptions");
    expect(billingClientSource).toContain("startBillingPlanChange");
    expect(billingClientSource).toContain("billing-start-plan-change");
    expect(billingClientSource).toContain("getPlanChangeKind");
    expect(billingClientSource).toContain("if (targetPlanCode === FREE_PLAN_CODE) return 'unavailable';");
    expect(billingClientSource).toContain(".filter((plan) => plan.changeKind !== 'unavailable')");

    expect(billingHookSource).toContain("getBillingSubscriptionForAccess");
    expect(billingHookSource).toContain("getPendingBillingPlanChange(projectId)");
    expect(billingHookSource).toContain("getPlanChangeOptions(subscription, undefined, pendingPlanChange)");
    expect(billingHookSource).toContain("startBillingPlanChange");
    expect(billingDialogSource).toContain("Escolha seu plano");
    expect(dashboardSource).toContain("handleStartPlanChange");
    expect(billingCardSource).toContain("Plano atual");
    expect(billingCardSource).toContain("Fazer downgrade");
    expect(billingCardSource).toContain("Agendado para próximo ciclo");
    expect(billingCardSource).toContain("Downgrade já agendado");
    expect(billingDialogSource).toContain("flex flex-wrap justify-center gap-5");
    expect(dashboardSource).toContain("billingPlanName");
  });

  test("marks an already scheduled downgrade target as unavailable in the UI", () => {
    const billingClientSource = readIfExists("frontend/src/lib/billing.js");
    const billingCardSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingPlanChoiceCard.jsx");
    const migrationsDir = path.join(repoRoot, "supabase/migrations");
    const migrationSources = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    expect(migrationSources).toContain("create or replace function public.get_pending_billing_plan_change");
    expect(migrationSources).toContain("public.can_access_project(bpcs.project_id)");
    expect(migrationSources).toContain("bpcs.effective_mode = 'next_cycle'");
    expect(migrationSources).toContain("bpcs.status in ('pending', 'created', 'paid')");
    expect(migrationSources).toContain("grant execute on function public.get_pending_billing_plan_change(uuid) to authenticated");

    expect(billingClientSource).toContain("supabase.rpc('get_pending_billing_plan_change'");
    expect(billingClientSource).toContain("isPendingPlanChange");
    expect(billingClientSource).toContain("isSelectable: !isPendingPlanChange");
    expect(billingClientSource).toContain("Downgrade já agendado");

    expect(billingCardSource).toContain("plan?.isPendingPlanChange");
    expect(billingCardSource).toContain("Clock3");
    expect(billingCardSource).toContain("Agendado");
  });

  test("requires an explicit confirmation before starting a paid plan change", () => {
    const billingDialogSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingPlanDialog.jsx");

    expect(billingDialogSource).toContain("pendingPlanChange");
    expect(billingDialogSource).toContain("setPendingPlanChange(plan)");
    expect(billingDialogSource).toContain("Confirmar operação");
    expect(billingDialogSource).toContain("dá franquia cheia do novo plano no ciclo atual");
    expect(billingDialogSource).toContain("cobra excedente usando o preço de excedente do novo plano");
    expect(billingDialogSource).toContain("só vale no próximo ciclo");
    expect(billingDialogSource).toContain("até lá mantém franquia e preço do plano atual");
    expect(billingDialogSource).toContain("onClick={() => onStartPlanChange(pendingPlanChange)}");
  });

  test("blocks self-service plan changes while the subscription is past_due", () => {
    const functionSource = readIfExists("supabase/functions/billing-start-plan-change/index.ts");
    const billingClientSource = readIfExists("frontend/src/lib/billing.js");
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");
    const migrationsDir = path.join(repoRoot, "supabase/migrations");
    const migrationSources = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    expect(functionSource).toContain("BILLING_PLAN_CHANGE_PAST_DUE_REQUIRES_PAYMENT");
    expect(functionSource).toContain('subscription.status === "past_due"');
    expect(functionSource).toContain("BILLING_PLAN_CHANGE_OWNER_REQUIRED");
    expect(functionSource).toContain("Apenas o proprietário do projeto pode alterar o plano.");
    expect(functionSource.indexOf("BILLING_PLAN_CHANGE_PAST_DUE_REQUIRES_PAYMENT"))
      .toBeLessThan(functionSource.indexOf("const reusableSession = await findReusableSession"));
    expect(billingClientSource).toContain("isBillingPastDue(currentSubscription)) return []");
    expect(dashboardSource).toContain("if (!canManageBilling) return;");
    expect(dashboardSource).toContain("if (isBillingPastDue) return;");
    expect(dashboardSource).toContain("planChangeDisabled: !projectId || billingLoading || !canManageBilling || isSuspended || isCanceled || isPastDue");
    expect(dashboardSource).toContain("planChangeDisabledReason: !canManageBilling");
    expect(dashboardSource).toContain("Apenas o proprietário do projeto pode alterar o plano.");
    expect(dashboardSource).not.toContain("title: 'Pagamento pendente'");
    expect(dashboardSource).toContain("Regularize a cobrança pendente antes de trocar de plano.");
    expect(migrationSources).toContain("v_subscription.status = 'past_due'");
    expect(migrationSources).toContain("Regularize a cobrança pendente antes de alterar o plano.");
  });

  test("keeps the restaurant dashboard modular after adding billing flows", () => {
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");

    expect(readIfExists("frontend/src/constants/restaurantDashboard.js")).toContain("DASHBOARD_TABS");
    expect(readIfExists("frontend/src/hooks/useRestaurantBilling.js")).toContain("useRestaurantBilling");
    expect(readIfExists("frontend/src/hooks/usePaidSignupRecovery.js")).toContain("usePaidSignupRecovery");
    expect(readIfExists("frontend/src/hooks/useProjectName.js")).toContain("useProjectName");
    expect(readIfExists("frontend/src/components/dashboard/DashboardShell.jsx")).toContain("DashboardShell");
    expect(readIfExists("frontend/src/components/restaurant/dashboard/BillingPlanDialog.jsx")).toContain("BillingPlanDialog");
    expect(readIfExists("frontend/src/components/restaurant/dashboard/NoProjectSignupState.jsx")).toContain("NoProjectSignupState");

    expect(dashboardSource).toContain("useRestaurantBilling");
    expect(dashboardSource).toContain("DashboardShell");
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

  test("keeps live cycle usage and overage totals in billing cycle summaries", () => {
    const summaryMigration = readIfExists("supabase/migrations/20260610133000_billing_cycle_usage_summaries.sql");

    expect(summaryMigration).toContain("create table if not exists public.billing_cycle_usage_summaries");
    expect(summaryMigration).toContain("included_pass_installs integer not null default 0");
    expect(summaryMigration).toContain("included_notification_sends integer not null default 0");
    expect(summaryMigration).toContain("overage_pass_install_cents integer not null default 0");
    expect(summaryMigration).toContain("overage_notification_sent_cents integer not null default 0");
    expect(summaryMigration).toContain("pass_install_overage_quantity integer not null default 0");
    expect(summaryMigration).toContain("notification_sent_overage_quantity integer not null default 0");
    expect(summaryMigration).toContain("pass_install_overage_cents integer not null default 0");
    expect(summaryMigration).toContain("notification_sent_overage_cents integer not null default 0");
    expect(summaryMigration).toContain("total_overage_cents integer not null default 0");
    expect(summaryMigration).toContain("greatest(v_summary.pass_install_quantity - v_install_allowance, 0)");
    expect(summaryMigration).toContain("greatest(v_summary.notification_sent_quantity - v_notification_allowance, 0)");
    expect(summaryMigration).toContain("public.recalculate_billing_cycle_usage_summary");
    expect(summaryMigration).toContain("perform public.recalculate_billing_cycle_usage_summary");
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

  test("keeps only one pending next-cycle plan change per subscription", () => {
    const functionSource = readIfExists("supabase/functions/billing-start-plan-change/index.ts");
    const migrationsDir = path.join(repoRoot, "supabase/migrations");
    const migrationSources = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    expect(migrationSources).toContain("superseded");
    expect(migrationSources).toContain("billing_plan_change_sessions_one_active_next_cycle_idx");
    expect(migrationSources).toContain("where effective_mode = 'next_cycle'");
    expect(migrationSources).toContain("and status in ('pending', 'created', 'paid')");
    expect(migrationSources).toContain("create or replace function public.supersede_pending_next_cycle_plan_changes");
    expect(migrationSources).toContain("v_subscription.plan_id <> v_session.previous_plan_id");
    expect(migrationSources).toContain("'stale_plan_change_session'");
    expect(migrationSources).toContain("status = 'superseded'");
    expect(migrationSources).toContain("metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('superseded_by_session_id'");

    expect(functionSource).toContain("async function supersedePendingNextCyclePlanChanges");
    expect(functionSource).toContain("supersede_pending_next_cycle_plan_changes");
    expect(functionSource).toContain("p_superseded_by_session_id");
    expect(functionSource).toContain("supersedePendingNextCyclePlanChanges(supabaseAdmin, subscription.id, sessionId)");
  });
});
