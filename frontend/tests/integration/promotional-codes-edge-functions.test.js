const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function expectInOrder(source, before, after) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);

  expect(beforeIndex).toBeGreaterThanOrEqual(0);
  expect(afterIndex).toBeGreaterThanOrEqual(0);
  expect(beforeIndex).toBeLessThan(afterIndex);
}

describe("promotional code edge functions", () => {
  test("affiliate-public resolves promotional codes through the public RPC without exposing affiliate internals", () => {
    const source = readSource("supabase/functions/affiliate-public/index.ts");

    expect(source).toContain("resolvePromotionalCode");
    expect(source).toContain("resolve_public_promotional_code");
    expect(source).toContain("normalizePromotionalCode");
    expect(source).toContain("discountBps");
    expect(source).toContain("reason");
    expect(source).toContain('action === "resolvePromotionalCode"');
    expect(source).toContain('action === "resolveAffiliateRef"');
    expect(source).not.toContain('.from("affiliate_links")');
    expect(source).not.toContain('.from("affiliate_sellers")');
    expect(source).not.toContain("commission_bps");
    expect(source).not.toContain("seller_id");
    expect(source).not.toContain("pix_key");
    expect(source).not.toContain("contact");
    expect(source).not.toContain("phone");
  });

  test("signup-start-checkout reserves server-side promotional codes before creating the Asaas checkout", () => {
    const source = readSource("supabase/functions/signup-start-checkout/index.ts");

    expect(source).toContain("normalizePromotionalCode");
    expect(source).toContain("reserve_promotional_code");
    expect(source).toContain("reservePromotionalCode");
    expect(source).toContain("p_checkout_session_id: session.id");
    expect(source).toContain("p_base_amount_cents: plan.base_price_cents");
    expect(source).toContain("p_expires_at: session.expires_at");
    expect(source).toContain("payment_provider_requests");
    expect(source).toContain("upsertProviderRequest");
    expect(source).toContain("requestHash");
    expect(source).toContain("amount_cents: plan.base_price_cents");
    expect(source).toContain("promotionReservation?.finalAmountCents ?? plan.base_price_cents");
    expect(source).toContain("promo_redemption_id");
    expect(source).toContain("promo_code_id");
    expect(source).toContain("affiliateRef");
    expect(source).not.toContain("resolveAffiliateContext");
    expect(source).not.toContain("AFFILIATE_DISCOUNT_BPS = 1000");
    expect(source).not.toContain("payload.amountCents");
    expect(source).not.toContain("payload.discountCents");

    expectInOrder(
      source,
      '.from("signup_checkout_sessions")',
      "reservePromotionalCode",
    );
    expectInOrder(source, "reservePromotionalCode", "upsertProviderRequest");
    expectInOrder(source, "upsertProviderRequest", "await fetch(`${getAsaasApiBaseUrl()}/checkouts`");
  });

  test("signup-finalize confirms redemptions, records first-month invoice, and uses promo snapshots for attribution", () => {
    const source = readSource("supabase/functions/signup-finalize/index.ts");

    expect(source).toContain("billing_promotional_code_redemptions");
    expect(source).toContain("getPromotionalRedemptionSnapshot");
    expect(source).toContain("confirm_promotional_code_redemption");
    expect(source).toContain("confirmPromotionalCodeRedemption");
    expect(source).toContain("createFirstMonthInvoice");
    expect(source).toContain('.from("billing_invoices")');
    expect(source).toContain("checkout_session_id: paidCheckoutSession.id");
    expect(source).toContain('invoice_kind: "subscription_first_month"');
    expect(source).toContain("subtotal_cents: basePriceCents");
    expect(source).toContain("discount_cents: discountCents");
    expect(source).toContain("promo_redemption_id");
    expect(source).toContain("promo_code_snapshot");
    expect(source).toContain("commission_bps_snapshot");
    expect(source).toContain("seller_id_snapshot");
    expect(source).toContain("eligibleAmountCents = basePriceCents");
    expect(source).not.toContain("Math.min(paidAmountCents, basePriceCents)");
    expect(source).not.toContain("AFFILIATE_COMMISSION_RATE_BPS = 1000");

    expectInOrder(source, "getPaidCheckoutSession", "getPromotionalRedemptionSnapshot");
    expectInOrder(source, "const promotionalCodeConfirmation", "const firstMonthInvoice = await createFirstMonthInvoice");
  });

  test("asaas-webhook releases terminal checkout reservations and applies snapshot-based commission clawbacks", () => {
    const source = readSource("supabase/functions/asaas-webhook/index.ts");

    expect(source).toContain("TERMINAL_SIGNUP_CHECKOUT_STATUSES");
    expect(source).toContain("releaseSignupPromotionalReservation");
    expect(source).toContain("release_promotional_code_redemption");
    expect(source).toContain("resolveAttributionCommissionBps");
    expect(source).toContain("commission_bps_snapshot");
    expect(source).toContain("affiliate_commission_reversals");
    expect(source).toContain("handleAffiliateCommissionClawback");
    expect(source).toContain("PAYMENT_REFUNDED");
    expect(source).toContain("PAYMENT_CHARGEBACK_REQUESTED");
    expect(source).toContain("PAYMENT_DELETED");
    expect(source).toContain('status: "void"');
    expect(source).toContain('status: "pending_finance_review"');
    expect(source).toContain("reversal_cents");
    expect(source).not.toContain("AFFILIATE_COMMISSION_RATE_BPS = 1000");

    expectInOrder(source, "updateSignupSessionFromProvider", "releaseSignupPromotionalReservation");
  });

  test("affiliate-admin manages promotional codes and seller-coupon wizard fields for superadmins", () => {
    const source = readSource("supabase/functions/affiliate-admin/index.ts");

    expect(source).toContain("PROMOTIONAL_CODE_SELECT_FIELDS");
    expect(source).toContain("billing_promotional_codes");
    expect(source).toContain("listPromotionalCodes");
    expect(source).toContain("createPromotionalCode");
    expect(source).toContain("updatePromotionalCode");
    expect(source).toContain("createSellerWithCoupon");
    expect(source).toContain("normalizePromotionalCode");
    expect(source).toContain("normalizePhone");
    expect(source).toContain("normalizeEmail");
    expect(source).toContain("marginWarningAcknowledged");
    expect(source).toContain("discount_bps");
    expect(source).toContain("commission_bps");
    expect(source).toContain("max_uses");
    expect(source).toContain("valid_until");
    expect(source).toContain("affiliate_link_id");
    expect(source).toContain('action === "listPromotionalCodes"');
    expect(source).toContain('action === "createPromotionalCode"');
    expect(source).toContain('action === "updatePromotionalCode"');
    expect(source).toContain('action === "createSellerWithCoupon"');
    expect(source).toContain("ensureSuperadmin");
    expect(source).not.toContain("auth.role()");
  });
});
