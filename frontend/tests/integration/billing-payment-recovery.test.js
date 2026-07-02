const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

describe("billing payment recovery", () => {
  test("ships an owner-only payment recovery function registered in Supabase", () => {
    const configSource = readIfExists("supabase/config.toml");
    const functionSource = readIfExists("supabase/functions/billing-start-payment-recovery/index.ts");

    expect(configSource).toContain("[functions.billing-start-payment-recovery]");
    expect(configSource).toContain('entrypoint = "./functions/billing-start-payment-recovery/index.ts"');

    expect(functionSource).toContain("BILLING_PAYMENT_RECOVERY_OWNER_REQUIRED");
    expect(functionSource).toContain("requireOwnerMembership");
    expect(functionSource).toContain("delinquency_gateway_charge_id");
    expect(functionSource).toContain("BILLING_PAYMENT_RECOVERY_CHARGE_NOT_FOUND");
    expect(functionSource).toContain("status\", [\"past_due\", \"suspended\"]");
    expect(functionSource).toContain("/payments/");
    expect(functionSource).toContain('method: "GET"');
    expect(functionSource).toContain("invoiceUrl");
    expect(functionSource).toContain("invoice_url");
    expect(functionSource).toContain("bankSlipUrl");
    expect(functionSource).toContain("bank_slip_url");
    expect(functionSource).toContain("payment_status");
    expect(functionSource).toContain("PAYMENT_CONFIRMED");
    expect(functionSource).toContain("PAYMENT_RECEIVED");
    expect(functionSource).not.toContain('status: "active"');
  });

  test("exposes payment recovery from the billing client, hook, and dashboard UI", () => {
    const billingClientSource = readIfExists("frontend/src/lib/billing.js");
    const billingHookSource = readIfExists("frontend/src/hooks/useRestaurantBilling.js");
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");
    const dialogSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingDashboardDialog.jsx");
    const pastDueNoticeSource = readIfExists("frontend/src/components/restaurant/dashboard/BillingPastDueNotice.jsx");
    const webhookSource = readIfExists("supabase/functions/asaas-webhook/index.ts");

    expect(billingClientSource).toContain("startBillingPaymentRecovery");
    expect(billingClientSource).toContain("billing-start-payment-recovery");

    expect(billingHookSource).toContain("billingPaymentRecoveryAction");
    expect(billingHookSource).toContain("handleStartBillingPaymentRecovery");
    expect(billingHookSource).toContain("window.location.assign(result.invoice_url)");
    expect(billingHookSource).toContain("Pagamento já identificado");

    expect(dashboardSource).toContain("billingPaymentRecoveryAction");
    expect(dashboardSource).toContain("handleStartBillingPaymentRecovery");
    expect(dashboardSource).toContain("onStartPaymentRecovery={handleStartBillingPaymentRecovery}");

    expect(dialogSource).toContain("PaymentRecoverySection");
    expect(dialogSource).toContain("Regularizar pagamento");
    expect(dialogSource).toContain("onStartPaymentRecovery");
    expect(dialogSource).toContain("paymentRecoveryAction");
    expect(dialogSource).toContain("subscription?.status === 'past_due'");
    expect(dialogSource).toContain("subscription?.status === 'suspended'");

    expect(pastDueNoticeSource).toContain("Ver pendência");
    expect(pastDueNoticeSource).not.toContain("Regularizar pagamento");

    expect(webhookSource).toContain("clearSubscriptionDelinquencyForPayment");
    expect(webhookSource).toContain("status: \"active\"");
  });
});
