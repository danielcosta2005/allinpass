const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function readAffiliateCommissionMigrations() {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  if (!fs.existsSync(migrationsDir)) return "";

  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql") && name.includes("affiliate_commissions"))
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");
}

describe("affiliate recurring commissions", () => {
  test("ships an idempotent affiliate_commissions table with superadmin-only RLS", () => {
    const migrationSource = readAffiliateCommissionMigrations();

    expect(migrationSource).toContain("create table if not exists public.affiliate_commissions");
    expect(migrationSource).toContain("attribution_id uuid not null references public.affiliate_attributions(id)");
    expect(migrationSource).toContain("seller_id uuid not null references public.affiliate_sellers(id)");
    expect(migrationSource).toContain("link_id uuid references public.affiliate_links(id)");
    expect(migrationSource).toContain("user_id uuid references auth.users(id)");
    expect(migrationSource).toContain("project_id uuid not null references public.projects(id)");
    expect(migrationSource).toContain("subscription_id uuid not null references public.billing_subscriptions(id)");
    expect(migrationSource).toContain("billing_cycle_id uuid references public.billing_cycles(id)");
    expect(migrationSource).toContain("plan_id uuid references public.billing_plans(id)");
    expect(migrationSource).toContain("competence_month date not null");
    expect(migrationSource).toContain("eligible_amount_cents integer not null");
    expect(migrationSource).toContain("commission_rate_bps integer not null default 1000");
    expect(migrationSource).toContain("commission_cents integer not null");
    expect(migrationSource).toContain("provider_payment_id text");
    expect(migrationSource).toContain("affiliate_commissions_provider_payment_uidx");
    expect(migrationSource).toContain("affiliate_commissions_attribution_month_uidx");
    expect(migrationSource).toContain("affiliate_commissions_competence_month_check");
    expect(migrationSource).toContain("trg_affiliate_commissions_updated_at");
    expect(migrationSource).toContain("alter table public.affiliate_commissions enable row level security");
    expect(migrationSource).toContain("revoke all on table public.affiliate_commissions from anon");
    expect(migrationSource).toContain("grant select, insert, update, delete on table public.affiliate_commissions to authenticated");
    expect(migrationSource).toContain("grant all on table public.affiliate_commissions to service_role");
    expect(migrationSource).toContain("to authenticated");
    expect(migrationSource).toContain("(select public.is_superadmin())");
    expect(migrationSource).not.toContain("auth.role()");
  });

  test("asaas webhook creates commissions only for confirmed base subscription payments", () => {
    const webhookSource = readIfExists(path.join(repoRoot, "supabase/functions/asaas-webhook/index.ts"));

    expect(webhookSource).toContain("AFFILIATE_COMMISSION_RATE_BPS = 1000");
    expect(webhookSource).toContain("getAffiliateCommissionRateBps");
    expect(webhookSource).toContain("metadata.commission_bps");
    expect(webhookSource).toContain("createAffiliateCommission");
    expect(webhookSource).toContain("affiliate_commissions");
    expect(webhookSource).toContain("affiliate_attributions");
    expect(webhookSource).toContain(".from(\"billing_subscriptions\")");
    expect(webhookSource).toContain("base_price_cents");
    expect(webhookSource).toContain("PAYMENT_CONFIRMED");
    expect(webhookSource).toContain("PAYMENT_RECEIVED");
    expect(webhookSource).toContain("isPaidPaymentEvent(event, paymentStatus)");
    expect(webhookSource).toContain("eligibleAmountCents");
    expect(webhookSource).toContain("Math.min");
    expect(webhookSource).toContain("commissionRateBps");
    expect(webhookSource).toContain("commissionCents");
    expect(webhookSource).toContain("competenceMonth");
    expect(webhookSource).toContain("provider_payment_id");
    expect(webhookSource).toContain("isUniqueViolation");
    expect(webhookSource).toContain("status: \"pending\"");
    expect(webhookSource).not.toContain("total_overage");

    const overageIndex = webhookSource.indexOf("handleOverageInvoicePaymentWebhook");
    const commissionIndex = webhookSource.indexOf("createAffiliateCommission");
    expect(overageIndex).toBeGreaterThanOrEqual(0);
    expect(commissionIndex).toBeGreaterThan(overageIndex);
  });

  test("affiliate-admin exposes paginated commission and client queries for superadmins", () => {
    const functionSource = readIfExists(path.join(repoRoot, "supabase/functions/affiliate-admin/index.ts"));

    expect(functionSource).toContain("listCommissions");
    expect(functionSource).toContain("listCommissionClients");
    expect(functionSource).toContain(".from(\"affiliate_commissions\")");
    expect(functionSource).toContain(".from(\"affiliate_attributions\")");
    expect(functionSource).toContain("competenceMonth");
    expect(functionSource).toContain("sellerId");
    expect(functionSource).toContain("status");
    expect(functionSource).toContain(".range(from, to)");
    expect(functionSource).toContain("action === \"listCommissions\"");
    expect(functionSource).toContain("action === \"listCommissionClients\"");
    expect(functionSource).toContain("ensureSuperadmin");
    expect(functionSource).not.toContain("auth.role()");
  });

  test("frontend helper wraps commission queries without calculating commission values", () => {
    const helperSource = readIfExists(path.join(repoRoot, "frontend/src/lib/affiliates.js"));

    expect(helperSource).toContain("listAffiliateCommissions");
    expect(helperSource).toContain("listAffiliateCommissionClients");
    expect(helperSource).toContain("action: 'listCommissions'");
    expect(helperSource).toContain("action: 'listCommissionClients'");
    expect(helperSource).toContain("affiliate-admin");
    expect(helperSource).not.toContain("commissionCents =");
    expect(helperSource).not.toContain("* 0.1");
    expect(helperSource).not.toContain("* 0.10");
  });
});
