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

describe("billing delinquency suspension", () => {
  test("adds paid delinquency columns and a blocking suspended status", () => {
    const migrationSources = readMigrationSources();
    const helperSource = readIfExists("supabase/functions/_shared/billingAccess.ts");

    expect(migrationSources).toContain("add column if not exists delinquent_since");
    expect(migrationSources).toContain("add column if not exists grace_ends_at");
    expect(migrationSources).toContain("add column if not exists suspended_at");
    expect(migrationSources).toContain("add column if not exists delinquency_gateway_charge_id");
    expect(migrationSources).toContain("'suspended'");
    expect(migrationSources).toContain("billing_subscriptions_past_due_grace_idx");

    expect(helperSource).toContain("Plano inativo. Regularize sua assinatura para continuar.");
    expect(helperSource).toContain("status\", [\"trialing\", \"active\", \"past_due\", \"paused\"]");
    expect(helperSource).not.toContain("\"suspended\"]");
  });

  test("asaas webhook records and clears subscription delinquency by payment id", () => {
    const webhookSource = readIfExists("supabase/functions/asaas-webhook/index.ts");

    expect(webhookSource).toContain("const DELINQUENCY_GRACE_DAYS = 5");
    expect(webhookSource).toContain("markSubscriptionPastDueForPayment");
    expect(webhookSource).toContain("clearSubscriptionDelinquencyForPayment");
    expect(webhookSource).toContain("reconcileSubscriptionDelinquencyFromPayment");
    expect(webhookSource).toContain("PAYMENT_OVERDUE");
    expect(webhookSource).toContain("PAYMENT_FAILED");
    expect(webhookSource).toContain("CHARGEBACK_REQUESTED");
    expect(webhookSource).toContain("delinquency_gateway_charge_id: delinquencyGatewayChargeId");
    expect(webhookSource).toContain("subscription.delinquency_gateway_charge_id !== options.providerPaymentId");
    expect(webhookSource).toContain("status: \"active\"");
    expect(webhookSource).toContain(".eq(\"gateway_subscription_id\", options.providerSubscriptionId)");
  });

  test("billing-close-cycles suspends past_due subscriptions after grace without canceling", () => {
    const runnerSource = readIfExists("supabase/functions/billing-close-cycles/index.ts");

    expect(runnerSource).toContain("suspendPastDueSubscriptions");
    expect(runnerSource).toContain(".eq(\"status\", \"past_due\")");
    expect(runnerSource).toContain(".lte(\"grace_ends_at\", nowIso)");
    expect(runnerSource).toContain("status: \"suspended\"");
    expect(runnerSource).toContain("suspended_subscriptions");
    expect(runnerSource).not.toContain("status: \"canceled\"");
  });

  test("frontend shows past_due warning and suspended lock without plan-change escape hatch", () => {
    const billingClientSource = readIfExists("frontend/src/lib/billing.js");
    const billingHookSource = readIfExists("frontend/src/hooks/useRestaurantBilling.js");
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");
    const topbarSource = readIfExists("frontend/src/components/restaurant/dashboard/RestaurantTopBar.jsx");
    const suspendedStateSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingSuspendedState.jsx");
    const pastDueNoticeSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingPastDueNotice.jsx");

    expect(billingClientSource).toContain("VISIBLE_SUBSCRIPTION_STATUSES");
    expect(billingClientSource).toContain("'suspended'");
    expect(billingClientSource).toContain("isBillingSuspended(currentSubscription)) return []");
    expect(billingHookSource).toContain("return 'suspended'");
    expect(billingHookSource).toContain("return 'past_due'");
    expect(dashboardSource).toContain("BillingSuspendedState");
    expect(dashboardSource).toContain("BillingPastDueNotice");
    expect(topbarSource).toContain("pagamento pendente");
    expect(topbarSource).toContain("suspenso");
    expect(suspendedStateSource).toContain("Trocar de plano nao regulariza a pendencia");
    expect(pastDueNoticeSource).toContain("Pagamento pendente");
  });

  test("documents paid delinquency semantics separately from trial expiration", () => {
    const schemaDoc = readIfExists("docs/database/schema-mod3.md");
    const edgeDoc = readIfExists("docs/backend-edge-functions.md");

    expect(schemaDoc).toContain("`past_due` indica cobranca paga vencida/falha dentro do grace period");
    expect(schemaDoc).toContain("`suspended` bloqueia acesso operacional");
    expect(schemaDoc).toContain("`expired` continua reservado para free trial encerrado");
    expect(edgeDoc).toContain("grace_ends_at = delinquent_since + 5 dias");
    expect(edgeDoc).toContain("somente linhas `past_due` com `grace_ends_at` vencido");
  });
});
