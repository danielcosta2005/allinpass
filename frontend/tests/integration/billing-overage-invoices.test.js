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

describe("billing overage invoices", () => {
  test("adds overage invoice closure primitives without billing the base subscription", () => {
    const migrationSource = readIfExists("supabase/migrations/20260619093000_billing_overage_invoice_closure.sql");
    const migrationSources = readMigrationSources();

    expect(migrationSource).toContain("create table if not exists public.billing_invoice_collection_batches");
    expect(migrationSource).toContain("subscription_payment_adjustment");
    expect(migrationSources).toContain("subscription_value_adjustment");
    expect(migrationSource).toContain("add column if not exists collection_batch_id uuid");
    expect(migrationSource).toContain("billing_invoices_overage_cycle_uidx");
    expect(migrationSource).toContain("create or replace function public.refresh_billing_cycle_usage_summary_for_cycle");
    expect(migrationSource).toContain("create or replace function public.close_billing_cycle_for_overage");
    expect(migrationSource).toContain("v_summary.total_overage_cents");
    expect(migrationSource).toContain("'overage_pass_install'");
    expect(migrationSource).toContain("'overage_notification_sent'");
    expect(migrationSource).not.toContain("'subscription_base'");
  });

  test("closes the old cycle before applying next-cycle downgrades", () => {
    const migrationSources = readMigrationSources();

    expect(migrationSources).toContain("perform public.apply_billing_plan_change(");
    expect(migrationSources).toContain("v_applied_plan_changes");
    expect(migrationSources).toContain("v_next_period_start := v_cycle.period_end");
    expect(migrationSources).toContain("current_period_start = v_next_period_start");
    expect(migrationSources).toContain("current_period_end = v_next_period_end");
    expect(migrationSources).toContain("bc.status in ('closed', 'invoiced', 'paid', 'void')");
  });

  test("registers the billing-close-cycles runner and supports credit-card subscription value adjustments", () => {
    const configSource = readIfExists("supabase/config.toml");
    const functionSource = readIfExists("supabase/functions/billing-close-cycles/index.ts");
    const migrationSources = readMigrationSources();

    expect(configSource).toContain("[functions.billing-close-cycles]");
    expect(configSource).toContain("verify_jwt = false");
    expect(configSource).toContain('entrypoint = "./functions/billing-close-cycles/index.ts"');

    expect(functionSource).toContain("CRON_SECRET");
    expect(functionSource).toContain("verify_billing_cron_secret");
    expect(functionSource).not.toContain("EMAIL_DISPATCH_SECRET");
    expect(functionSource).toContain("close_billing_cycle_for_overage");
    expect(functionSource).toContain("billing_invoice_collection_batches");
    expect(functionSource).toContain("listEditableSubscriptionPayments");
    expect(functionSource).toContain("prepareSubscriptionValueAdjustment");
    expect(functionSource).toContain("subscription_value_adjustment");
    expect(functionSource).toContain("billingType");
    expect(functionSource).toContain("`/payments?${params.toString()}`");
    expect(functionSource).toContain("listEditableSubscriptionPayments");
    expect(functionSource).toContain("`/payments/${encodeURIComponent(providerPaymentId)}`");
    expect(functionSource).toContain("`/subscriptions/${encodeURIComponent(gatewaySubscriptionId)}`");
    expect(functionSource).toContain('method: "PUT"');
    expect(functionSource).toContain("value: centsToAsaasValue(updatedPaymentCents)");
    expect(functionSource).toContain("nextDueDate: targetNextDueDate");
    expect(functionSource).toContain("updatePendingPayments: false");
    expect(functionSource).not.toContain("asaasFetch(apiKey, \"/payments\",");

    expect(migrationSources).toContain("billing-close-cycles");
    expect(migrationSources).toContain("'/functions/v1/billing-close-cycles'");
    expect(migrationSources).toContain("vault.create_secret");
    expect(migrationSources).toContain("create or replace function public.verify_billing_cron_secret");
  });

  test("webhook reconciles Asaas payment events into overage batches before signup sessions", () => {
    const webhookSource = readIfExists("supabase/functions/asaas-webhook/index.ts");

    expect(webhookSource).toContain("handleOverageInvoicePaymentWebhook");
    expect(webhookSource).toContain("billing_invoice_collection_batches");
    expect(webhookSource).toContain("billing_invoices");
    expect(webhookSource).toContain("collection_batch_id");
    expect(webhookSource).toContain("last_asaas_overage_payment_webhook");
    expect(webhookSource).toContain("findSubscriptionValueAdjustmentBatch");
    expect(webhookSource).toContain("resetSubscriptionValueAdjustment");
    expect(webhookSource).toContain("subscription_value_adjustment");
    expect(webhookSource).toContain("ASAAS_API_KEY");
    expect(webhookSource).toContain('nextStatus === "paid"');
    expect(webhookSource).toContain("PAYMENT_OVERDUE");
    expect(webhookSource).toContain("PAYMENT_REFUNDED");

    const paymentHandlerIndex = webhookSource.indexOf("async function handlePaymentWebhook");
    const overageIndex = webhookSource.indexOf("await handleOverageInvoicePaymentWebhook", paymentHandlerIndex);
    const signupIndex = webhookSource.indexOf("const signupSession = await findSessionByProviderData", paymentHandlerIndex);
    expect(paymentHandlerIndex).toBeGreaterThan(-1);
    expect(overageIndex).toBeGreaterThan(-1);
    expect(signupIndex).toBeGreaterThan(-1);
    expect(overageIndex).toBeLessThan(signupIndex);
  });

  test("documents carry-forward behavior and no automatic standalone overage charge", () => {
    const schemaDoc = readIfExists("docs/database/schema-mod3.md");
    const edgeDoc = readIfExists("docs/backend-edge-functions.md");

    expect(schemaDoc).toContain("Invoice interna de fechamento cobra apenas excedentes");
    expect(schemaDoc).toContain("nao cria cobranca avulsa automaticamente");
    expect(schemaDoc).toContain("a invoice permanece `draft` para carry-forward");
    expect(schemaDoc).toContain("close_billing_cycle_for_overage");

    expect(edgeDoc).toContain("billing-close-cycles");
    expect(edgeDoc).toContain("Atualiza a cobranca mensal escolhida via `PUT /v3/payments/{id}` quando ela ja existe");
    expect(edgeDoc).toContain("Para assinaturas `CREDIT_CARD` sem cobranca editavel, prepara temporariamente o valor da assinatura");
    expect(edgeDoc).toContain("Se nenhuma cobranca mensal editavel existir e a assinatura nao for cartao, a invoice permanece `draft`");
  });
});
