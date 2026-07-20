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

describe("affiliate links and promotional codes admin lifecycle", () => {
  test("keeps affiliate_links constrained and adds promotional code canon", () => {
    const migrationSource = readAllMigrations();

    expect(migrationSource).toContain("create table if not exists public.affiliate_links");
    expect(migrationSource).toContain("affiliate_links_seller_id_uidx");
    expect(migrationSource).toContain("affiliate_links_lower_code_uidx");
    expect(migrationSource).toContain("create table if not exists public.billing_promotional_codes");
    expect(migrationSource).toContain("billing_promotional_codes_lower_code_uidx");
    expect(migrationSource).toContain("billing_promotional_codes_affiliate_link_uidx");
    expect(migrationSource).toContain("validate_billing_promotional_code_affiliate_link");
    expect(migrationSource).toContain("billing_promotional_code_redemptions");
    expect(migrationSource).toContain("checkout_session_id uuid not null references public.signup_checkout_sessions(id)");
    expect(migrationSource).toContain("discount_bps integer not null default 1000");
    expect(migrationSource).toContain("commission_bps integer not null default 0");
    expect(migrationSource).toContain("seller_id is not null or commission_bps = 0");
    expect(migrationSource).toContain("affiliate_link_backfill");
    expect(migrationSource).toContain("alter table public.billing_promotional_codes enable row level security");
    expect(migrationSource).toContain("(select public.is_superadmin())");
    expect(migrationSource).not.toContain("auth.role()");
  });

  test("affiliate-admin manages seller promotional codes without trusting financial client values in checkout", () => {
    const functionSource = readIfExists(
      path.join(repoRoot, "supabase/functions/affiliate-admin/index.ts"),
    );

    expect(functionSource).toContain("PromotionalCodeRow");
    expect(functionSource).toContain("mapPromotionalCode");
    expect(functionSource).toContain("promotionalCode");
    expect(functionSource).toContain("generateLinkCode");
    expect(functionSource).toContain("assertPromotionalCodeAvailable");
    expect(functionSource).toContain("AFFILIATE_PROMO_CODE_CONFLICT");
    expect(functionSource).toContain("getOrCreateSellerLink");
    expect(functionSource).toContain("getOrCreateSellerPromotionalCode");
    expect(functionSource).toContain("listPromotionalCodes");
    expect(functionSource).toContain("createPromotionalCode");
    expect(functionSource).toContain("updatePromotionalCode");
    expect(functionSource).toContain(".from(\"billing_promotional_codes\")");
    expect(functionSource).toContain(".from(\"affiliate_links\")");
    expect(functionSource).toContain(".from(\"affiliate_sellers\")");
    expect(functionSource).toContain("updated_by: caller.user.id");
    expect(functionSource).toContain("action === \"getOrCreateSellerPromotionalCode\"");
    expect(functionSource).not.toContain("auth.role()");
  });

  test("frontend helper exposes promotional code APIs and promo URL building", () => {
    const helperSource = readIfExists(path.join(repoRoot, "frontend/src/lib/affiliates.js"));

    expect(helperSource).toContain("getOrCreateAffiliateLink");
    expect(helperSource).toContain("getOrCreateSellerPromotionalCode");
    expect(helperSource).toContain("buildPromotionalLinkUrl");
    expect(helperSource).toContain("buildAffiliateLinkUrl");
    expect(helperSource).toContain("/?promo=");
    expect(helperSource).toContain("resolvePromotionalCode");
    expect(helperSource).toContain("listPromotionalCodes");
    expect(helperSource).toContain("createPromotionalCode");
    expect(helperSource).toContain("affiliate-admin");
    expect(helperSource).not.toContain(".from('affiliate_links')");
    expect(helperSource).not.toContain('.from("affiliate_links")');
  });

  test("AffiliatesTab renders seller codes and campaign code affordances", () => {
    const tabSource = readIfExists(
      path.join(repoRoot, "frontend/src/components/superadmin/AffiliatesTab.jsx"),
    );

    expect(tabSource).toContain("getOrCreateSellerPromotionalCode");
    expect(tabSource).toContain("createPromotionalCode");
    expect(tabSource).toContain("listPromotionalCodes");
    expect(tabSource).toContain("buildAffiliateLinkUrl");
    expect(tabSource).toContain("navigator.clipboard.writeText");
    expect(tabSource).toContain("Gerar codigo");
    expect(tabSource).toContain("Nova campanha");
    expect(tabSource).toContain("Codigos promocionais");
    expect(tabSource).toContain("Campanha geral");
    expect(tabSource).toContain("Vendedor inativo");
    expect(tabSource).toContain("generatingLinkSellerId");
    expect(tabSource).toContain("Copy");
    expect(tabSource).toContain("aria-label");
    expect(tabSource).not.toContain("/?ref=");
  });

  test("SuperadminDashboard keeps AffiliatesTab in the superadmin-only flow", () => {
    const dashboardSource = readIfExists(
      path.join(repoRoot, "frontend/src/pages/SuperadminDashboard.jsx"),
    );

    expect(dashboardSource).toContain("AffiliatesTab");
    expect(dashboardSource).toContain("value: 'affiliates'");
    expect(dashboardSource).toContain("label: 'Afiliados'");
    expect(dashboardSource).toContain("isSuperadmin");
    expect(dashboardSource).toMatch(
      /<TabsContent\s+value="affiliates"[\s\S]*?<AffiliatesTab\s+\/>[\s\S]*?<\/TabsContent>/,
    );
    expect(dashboardSource).not.toContain("projectTabs.push({ value: 'affiliates'");
  });
});
