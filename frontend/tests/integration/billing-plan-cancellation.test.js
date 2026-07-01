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

describe("billing plan cancellation", () => {
  test("ships a private owner-only cancellation management function", () => {
    const configSource = readIfExists("supabase/config.toml");
    const functionSource = readIfExists("supabase/functions/billing-manage-plan-cancellation/index.ts");
    const billingClientSource = readIfExists("frontend/src/lib/billing.js");
    const billingHookSource = readIfExists("frontend/src/hooks/useRestaurantBilling.js");

    expect(configSource).toContain("[functions.billing-manage-plan-cancellation]");
    expect(configSource).toContain('entrypoint = "./functions/billing-manage-plan-cancellation/index.ts"');

    expect(functionSource).toContain("BILLING_PLAN_CANCELLATION_OWNER_REQUIRED");
    expect(functionSource).toContain('action !== "schedule" && action !== "undo"');
    expect(functionSource).toContain("requireOwnerMembership");
    expect(functionSource).toContain("schedulePlanCancellation");
    expect(functionSource).toContain("undoPlanCancellation");
    expect(functionSource).toContain("billing_plan_change_sessions");
    expect(functionSource).toContain('change_type: "cancellation"');
    expect(functionSource).toContain('effective_mode: "next_cycle"');
    expect(functionSource).toContain("supersede_pending_next_cycle_plan_changes");
    expect(functionSource).toContain('status: "canceled"');

    expect(billingClientSource).toContain("scheduleBillingPlanCancellation");
    expect(billingClientSource).toContain("undoBillingPlanCancellation");
    expect(billingClientSource).toContain("billing-manage-plan-cancellation");
    expect(billingHookSource).toContain("handleSchedulePlanCancellation");
    expect(billingHookSource).toContain("handleUndoPlanCancellation");
    expect(billingHookSource).toContain("pendingPlanChange");
  });

  test("applies scheduled cancellations at the end of the current billing cycle", () => {
    const migrationSources = readMigrationSources();
    const runnerSource = readIfExists("supabase/functions/billing-close-cycles/index.ts");

    expect(migrationSources).toContain("billing_plan_change_sessions_change_type_check");
    expect(migrationSources).toContain("'cancellation'");
    expect(migrationSources).toContain("v_session.change_type = 'cancellation'");
    expect(migrationSources).toContain("status = 'canceled'");
    expect(migrationSources).toContain("cancel_at_period_end = false");
    expect(migrationSources).toContain("ended_at = v_effective_at");
    expect(migrationSources).toContain("'origin', 'plan_cancellation'");

    expect(runnerSource).toContain("processDuePlanCancellations");
    expect(runnerSource).toContain('change_type", "cancellation"');
    expect(runnerSource).toContain('status: "INACTIVE"');
    expect(runnerSource).toContain("updatePendingPayments: false");
    expect(runnerSource).toContain("apply_billing_plan_change");
    expect(runnerSource).toContain("plan_cancellations");
    expect(runnerSource).toContain("skip_next_cycle");
  });

  test("shows cancellation controls and pending state in the billing dashboard", () => {
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");
    const dialogSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingDashboardDialog.jsx");
    const billingClientSource = readIfExists("frontend/src/lib/billing.js");

    expect(dialogSource).toContain("CancelPlanSection");
    expect(dialogSource).toContain("Cancelar plano");
    expect(dialogSource).toContain("Confirmar cancelamento");
    expect(dialogSource).toContain("Cancelamento agendado");
    expect(dialogSource).toContain("Manter assinatura");
    expect(dialogSource).toContain("AlertDialog");
    expect(dialogSource).toContain("onSchedulePlanCancellation");
    expect(dialogSource).toContain("onUndoPlanCancellation");
    expect(dialogSource).toContain("canManageBilling");
    expect(dialogSource).toContain("pendingPlanChange?.changeType === 'cancellation'");

    expect(dashboardSource).toContain("pendingPlanChange");
    expect(dashboardSource).toContain("handleSchedulePlanCancellation");
    expect(dashboardSource).toContain("handleUndoPlanCancellation");
    expect(dashboardSource).toContain("planCancellationAction");

    expect(billingClientSource).toContain("if (pendingPlanChange?.changeType === 'cancellation') return false;");
    expect(billingClientSource).toContain("getPlanChangeOptions");
  });
});
