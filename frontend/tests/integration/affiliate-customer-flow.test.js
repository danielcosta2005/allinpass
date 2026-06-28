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

describe("affiliate referred customer flow", () => {
  test("ships attribution persistence and checkout-session affiliate audit fields", () => {
    const migrationSource = readAllMigrations();

    expect(migrationSource).toContain("create table if not exists public.affiliate_attributions");
    expect(migrationSource).toContain("alter table public.signup_checkout_sessions");
    expect(migrationSource).toContain("affiliate_link_id");
    expect(migrationSource).toContain("affiliate_seller_id");
    expect(migrationSource).toContain("affiliate_code");
    expect(migrationSource).toContain("affiliate_discount_bps");
    expect(migrationSource).toContain("affiliate_discount_cents");
    expect(migrationSource).toContain("affiliate_original_amount_cents");
    expect(migrationSource).toContain("references public.affiliate_sellers(id)");
    expect(migrationSource).toContain("references public.affiliate_links(id)");
    expect(migrationSource).toContain("references public.billing_subscriptions(id)");
    expect(migrationSource).toContain("affiliate_attributions_project_uidx");
    expect(migrationSource).toContain("affiliate_attributions_subscription_uidx");
    expect(migrationSource).toContain("affiliate_attributions_checkout_session_uidx");
    expect(migrationSource).toContain("alter table public.affiliate_attributions enable row level security");
    expect(migrationSource).toContain("to authenticated");
    expect(migrationSource).toContain("(select public.is_superadmin())");
    expect(migrationSource).not.toContain("auth.role()");
  });

  test("public affiliate resolver validates refs without exposing seller sensitive fields", () => {
    const configSource = readIfExists(path.join(repoRoot, "supabase/config.toml"));
    const functionSource = readIfExists(path.join(repoRoot, "supabase/functions/affiliate-public/index.ts"));

    expect(configSource).toContain("[functions.affiliate-public]");
    expect(configSource).toContain("verify_jwt = false");
    expect(functionSource).toContain("resolveAffiliateRef");
    expect(functionSource).toContain("normalizeAffiliateRef");
    expect(functionSource).toContain(".from(\"affiliate_links\")");
    expect(functionSource).toContain(".from(\"affiliate_sellers\")");
    expect(functionSource).toContain("discountBps");
    expect(functionSource).toContain("valid: false");
    expect(functionSource).not.toContain("pix_key");
    expect(functionSource).not.toContain("contact");
  });

  test("landing page preserves valid affiliate refs through paid plan selection", () => {
    const landingSource = readIfExists(path.join(repoRoot, "frontend/src/pages/LandingPage.jsx"));
    const planCardSource = readIfExists(path.join(repoRoot, "frontend/src/components/landing/PlanCard.jsx"));
    const plansSource = readIfExists(path.join(repoRoot, "frontend/src/lib/subscriptionPlans.js"));

    expect(plansSource).toContain("normalizeAffiliateRef");
    expect(plansSource).toContain("buildSignupPath");
    expect(plansSource).toContain("ref");
    expect(landingSource).toContain("resolveAffiliateRef");
    expect(landingSource).toContain("affiliateRef");
    expect(landingSource).toContain("10% de desconto no primeiro mes");
    expect(landingSource).toContain("buildSignupPath(p.key, { ref: affiliateRef })");
    expect(planCardSource).toContain("affiliateOffer");
    expect(planCardSource).toContain("10% de desconto no primeiro mes");
  });

  test("signup preserves affiliateRef without sending trusted financial values", () => {
    const signupPageSource = readIfExists(path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"));
    const signupHelperSource = readIfExists(path.join(repoRoot, "frontend/src/lib/signup.js"));
    const recoverySource = readIfExists(path.join(repoRoot, "frontend/src/hooks/usePaidSignupRecovery.js"));

    expect(signupPageSource).toContain("affiliateRef");
    expect(signupPageSource).toContain("searchParams.get('ref')");
    expect(signupPageSource).toContain("params.set('ref', affiliateRef)");
    expect(signupPageSource).toContain("affiliate_ref");
    expect(signupPageSource).toContain("startPaidSignupCheckout({");
    expect(signupHelperSource).toContain("affiliateRef");
    expect(signupHelperSource).toContain("affiliateRef,");
    expect(recoverySource).toContain("affiliateRef");
    expect(signupHelperSource).not.toContain("amountCents");
    expect(signupHelperSource).not.toContain("discountCents");
    expect(signupHelperSource).not.toContain("commissionRate");
  });

  test("signup checkout applies affiliate discount server-side and audits it", () => {
    const checkoutSource = readIfExists(path.join(repoRoot, "supabase/functions/signup-start-checkout/index.ts"));

    expect(checkoutSource).toContain("AFFILIATE_DISCOUNT_BPS = 1000");
    expect(checkoutSource).toContain("resolveAffiliateContext");
    expect(checkoutSource).toContain(".from(\"affiliate_links\")");
    expect(checkoutSource).toContain(".from(\"affiliate_sellers\")");
    expect(checkoutSource).toContain("affiliate_discount_cents");
    expect(checkoutSource).toContain("affiliate_original_amount_cents");
    expect(checkoutSource).toContain("checkoutAmountCents");
    expect(checkoutSource).toContain("amount_cents: checkoutAmountCents");
    expect(checkoutSource).toContain("affiliateRef");
    expect(checkoutSource).not.toContain("payload.amountCents");
    expect(checkoutSource).not.toContain("payload.discountCents");
  });

  test("signup finalize creates attribution and restores recurring provider price", () => {
    const finalizeSource = readIfExists(path.join(repoRoot, "supabase/functions/signup-finalize/index.ts"));

    expect(finalizeSource).toContain("affiliate_attributions");
    expect(finalizeSource).toContain("restoreAsaasSubscriptionBasePrice");
    expect(finalizeSource).toContain("SIGNUP_FINALIZE_AFFILIATE_ATTRIBUTION_FAILED");
    expect(finalizeSource).toContain("SIGNUP_FINALIZE_ASAAS_RECURRING_PRICE_RESTORE_FAILED");
    expect(finalizeSource).toContain("updatePendingPayments: false");
    expect(finalizeSource).toContain("affiliate_discount_cents");
    expect(finalizeSource).toContain("affiliate_original_amount_cents");
    expect(finalizeSource).toContain("expectedCheckoutAmountCents");
    expect(finalizeSource).toContain("checkout_session_id");
  });
});
