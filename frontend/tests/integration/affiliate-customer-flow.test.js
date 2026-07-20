const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function readAllMigrations() {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  if (!fs.existsSync(migrationsDir)) return "";

  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");
}

describe("promotional code customer flow", () => {
  test("ships affiliate and promotional audit fields", () => {
    const migrationSource = readAllMigrations();

    expect(migrationSource).toContain("create table if not exists public.affiliate_attributions");
    expect(migrationSource).toContain("create table if not exists public.billing_promotional_codes");
    expect(migrationSource).toContain("promo_code_id");
    expect(migrationSource).toContain("promo_code");
    expect(migrationSource).toContain("promo_discount_bps");
    expect(migrationSource).toContain("promo_discount_cents");
    expect(migrationSource).toContain("promo_original_amount_cents");
    expect(migrationSource).toContain("promo_commission_bps");
    expect(migrationSource).toContain("affiliate_link_id");
    expect(migrationSource).toContain("affiliate_seller_id");
    expect(migrationSource).toContain("affiliate_code");
    expect(migrationSource).toContain("references public.affiliate_sellers(id)");
    expect(migrationSource).toContain("references public.affiliate_links(id)");
    expect(migrationSource).toContain("references public.billing_subscriptions(id)");
    expect(migrationSource).toContain("billing_promotional_code_redemptions");
    expect(migrationSource).toContain("confirm_billing_promotional_code_redemption");
    expect(migrationSource).toContain("(select public.is_superadmin())");
    expect(migrationSource).not.toContain("auth.role()");
  });

  test("public resolver validates promo codes without exposing seller sensitive fields", () => {
    const configSource = readIfExists(path.join(repoRoot, "supabase/config.toml"));
    const functionSource = readIfExists(path.join(repoRoot, "supabase/functions/affiliate-public/index.ts"));

    expect(configSource).toContain("[functions.affiliate-public]");
    expect(configSource).toContain("verify_jwt = false");
    expect(functionSource).toContain("resolvePromotionalCode");
    expect(functionSource).toContain("resolveAffiliateRef");
    expect(functionSource).toContain("normalizePromotionalCode");
    expect(functionSource).toContain(".from(\"billing_promotional_codes\")");
    expect(functionSource).toContain(".from(\"affiliate_links\")");
    expect(functionSource).toContain(".from(\"affiliate_sellers\")");
    expect(functionSource).toContain("discountBps");
    expect(functionSource).toContain("valid: false");
    expect(functionSource).not.toContain("pix_key");
    expect(functionSource).not.toContain("contact");
  });

  test("landing page preserves promo codes with legacy ref fallback", () => {
    const landingSource = readIfExists(path.join(repoRoot, "frontend/src/pages/LandingPage.jsx"));
    const planCardSource = readIfExists(path.join(repoRoot, "frontend/src/components/landing/PlanCard.jsx"));
    const plansSource = readIfExists(path.join(repoRoot, "frontend/src/lib/subscriptionPlans.js"));

    expect(plansSource).toContain("normalizePromoCode");
    expect(plansSource).toContain("normalizeAffiliateRef");
    expect(plansSource).toContain("buildSignupPath");
    expect(plansSource).toContain("params.set('promo', promoCode)");
    expect(landingSource).toContain("resolvePromotionalCode");
    expect(landingSource).toContain("searchParams.get('promo') || searchParams.get('ref')");
    expect(landingSource).toContain("buildSignupPath(p.key, { promo: promoCode })");
    expect(planCardSource).toContain("affiliateOffer");
    expect(planCardSource).toContain("calculateAffiliateFirstMonthPrice");
    expect(planCardSource).toContain("line-through");
    expect(planCardSource).toContain("no primeiro");
  });

  test("signup preserves promoCode without sending trusted financial values", () => {
    const signupPageSource = readIfExists(path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"));
    const signupHelperSource = readIfExists(path.join(repoRoot, "frontend/src/lib/signup.js"));
    const recoverySource = readIfExists(path.join(repoRoot, "frontend/src/hooks/usePaidSignupRecovery.js"));

    expect(signupPageSource).toContain("promoCode");
    expect(signupPageSource).toContain("searchParams.get('promo')");
    expect(signupPageSource).toContain("searchParams.get('ref')");
    expect(signupPageSource).toContain("params.set('promo', promoCode)");
    expect(signupPageSource).toContain("promo_code");
    expect(signupPageSource).toContain("affiliate_ref");
    expect(signupPageSource).toContain("resolvePromotionalCode");
    expect(signupPageSource).toContain("promoOffer");
    expect(signupPageSource).toContain("promoLoading");
    expect(signupPageSource).toContain("startPaidSignupCheckout({");
    expect(signupHelperSource).toContain("promoCode");
    expect(signupHelperSource).toContain("affiliateRef");
    expect(recoverySource).toContain("promoCode");
    expect(signupHelperSource).not.toContain("amountCents");
    expect(signupHelperSource).not.toContain("discountCents");
    expect(signupHelperSource).not.toContain("commissionRate");
  });

  test("signup checkout applies promo discount server-side and audits it", () => {
    const checkoutSource = readIfExists(path.join(repoRoot, "supabase/functions/signup-start-checkout/index.ts"));

    expect(checkoutSource).toContain("AFFILIATE_DISCOUNT_BPS = 1000");
    expect(checkoutSource).toContain("AFFILIATE_COMMISSION_BPS = 1000");
    expect(checkoutSource).toContain("resolvePromotionalContext");
    expect(checkoutSource).toContain(".from(\"billing_promotional_codes\")");
    expect(checkoutSource).toContain(".from(\"affiliate_links\")");
    expect(checkoutSource).toContain(".from(\"affiliate_sellers\")");
    expect(checkoutSource).toContain("promo_discount_cents");
    expect(checkoutSource).toContain("promo_original_amount_cents");
    expect(checkoutSource).toContain("promo_commission_bps");
    expect(checkoutSource).toContain("checkoutAmountCents");
    expect(checkoutSource).toContain("amount_cents: checkoutAmountCents");
    expect(checkoutSource).toContain("promoCode");
    expect(checkoutSource).toContain("affiliateRef");
    expect(checkoutSource).toContain("SIGNUP_CHECKOUT_PROMO_UNAVAILABLE");
    expect(checkoutSource).toContain(".is(\"affiliate_link_id\", null)");
    expect(checkoutSource).not.toContain("payload.amountCents");
    expect(checkoutSource).not.toContain("payload.discountCents");
  });

  test("signup finalize creates attribution when seller exists and restores recurring provider price", () => {
    const finalizeSource = readIfExists(path.join(repoRoot, "supabase/functions/signup-finalize/index.ts"));

    expect(finalizeSource).toContain("affiliate_attributions");
    expect(finalizeSource).toContain("restoreAsaasSubscriptionBasePrice");
    expect(finalizeSource).toContain("hasPromotionalCheckout");
    expect(finalizeSource).toContain("confirmPromotionalCodeUsage");
    expect(finalizeSource).toContain("confirm_billing_promotional_code_redemption");
    expect(finalizeSource).toContain("isAffiliateSellerActive");
    expect(finalizeSource).toContain("SIGNUP_FINALIZE_AFFILIATE_ATTRIBUTION_FAILED");
    expect(finalizeSource).toContain("SIGNUP_FINALIZE_PROMO_UNAVAILABLE");
    expect(finalizeSource).toContain("SIGNUP_FINALIZE_ASAAS_RECURRING_PRICE_RESTORE_FAILED");
    expect(finalizeSource).toContain("updatePendingPayments: false");
    expect(finalizeSource).toContain("promo_discount_cents");
    expect(finalizeSource).toContain("promo_original_amount_cents");
    expect(finalizeSource).toContain("commission_bps");
    expect(finalizeSource).toContain("expectedCheckoutAmountCents");
    expect(finalizeSource).toContain("checkout_session_id");
  });
});
