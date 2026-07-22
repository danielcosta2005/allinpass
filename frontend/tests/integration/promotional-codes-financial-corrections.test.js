const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("promotional code financial corrections", () => {
  test("signup-finalize records the first-month invoice from the paid promotion snapshot", () => {
    const source = readSource("supabase/functions/signup-finalize/index.ts");

    expect(source).toContain("getExpectedCheckoutAmountCents");
    expect(source).toContain("promotionalRedemption.final_amount_cents");
    expect(source).toContain("SIGNUP_FINALIZE_PAYMENT_AMOUNT_MISMATCH");
    expect(source).toContain("const invoiceTotalCents = Math.max(");
    expect(source).toContain("promotionalRedemption?.final_amount_cents ??");
    expect(source).toContain("assertFirstMonthInvoiceSnapshotMatchesPaidCheckout");
    expect(source).toContain("subtotal_cents: basePriceCents");
    expect(source).toContain("discount_cents: discountCents");
    expect(source).toContain("amount_paid_cents: invoiceTotalCents");
    expect(source).toContain('invoice_kind: "subscription_first_month"');
    expect(source).toContain(".eq(\"checkout_session_id\", paidCheckoutSession.id)");
    expect(source).toContain(".eq(\"metadata->>invoice_kind\", \"subscription_first_month\")");
    expect(source).not.toContain("amount_paid_cents: paidAmountCents");
  });

  test("asaas-webhook calculates recurring affiliate commission from subscription base price and keeps clawback idempotent", () => {
    const source = readSource("supabase/functions/asaas-webhook/index.ts");

    expect(source).toContain("resolveAttributionCommissionBps");
    expect(source).toContain("commission_bps_snapshot");
    expect(source).toContain("const eligibleAmountCents = basePriceCents;");
    expect(source).toContain("payment_value_cents: paidAmountCents");
    expect(source).toContain("subscription_base_price_cents: basePriceCents");
    expect(source).toContain("handleAffiliateCommissionClawback");
    expect(source).toContain('status: "void"');
    expect(source).toContain(".eq(\"status\", \"pending\")");
    expect(source).toContain("affiliate_commission_reversals");
    expect(source).toContain('status: "pending_finance_review"');
    expect(source).toContain("existingReversal");
    expect(source).toContain("isUniqueViolation(reversalError)");
    expect(source).not.toContain("Math.min(paidAmountCents, basePriceCents)");
  });

  test("billing usage dashboard displays the internal discounted first-month invoice instead of a synthetic base total", () => {
    const source = readSource("frontend/src/lib/billingUsageDashboard.js");

    expect(source).toContain("function isFirstMonthDiscountedInvoice");
    expect(source).toContain("subtotal_cents");
    expect(source).toContain("discount_cents");
    expect(source).toContain("metadata");
    expect(source).toContain("checkout_session_id");
    expect(source).toContain("'created_at'");
    expect(source).toContain("createdAt: row.created_at || null");
    expect(source).toContain("isFirstMonthDiscounted");
    expect(source).toContain("if (invoice.billingCycleId && summary.billingCycleId)");
    expect(source).toContain("invoice.paidAt || invoice.dueAt || invoice.createdAt");
    expect(source).toContain("firstMonthInvoice.amountPaidCents || firstMonthInvoice.totalCents");
    expect(source).toContain("firstMonthInvoice");
    expect(source).toContain("baseWithDiscountCents + overageCents");
    expect(source).toContain("discountCents");

    const dialogSource = readSource("frontend/src/components/restaurant/dashboard/BillingDashboardDialog.jsx");
    expect(dialogSource).toContain('label="Desconto"');
    expect(dialogSource).toContain("tone=\"discount\"");
  });
});
