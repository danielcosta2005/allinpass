const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function readAffiliateLinkMigrations() {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  if (!fs.existsSync(migrationsDir)) return "";

  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql") && name.includes("affiliate_program_links"))
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");
}

describe("affiliate links admin lifecycle", () => {
  test("ships a constrained affiliate_links table with superadmin-only RLS", () => {
    const migrationSource = readAffiliateLinkMigrations();

    expect(migrationSource).toContain("create table if not exists public.affiliate_links");
    expect(migrationSource).toContain("seller_id uuid not null references public.affiliate_sellers(id) on delete cascade");
    expect(migrationSource).toContain("code text not null");
    expect(migrationSource).toContain("status text not null default 'active'");
    expect(migrationSource).toContain("affiliate_links_code_not_blank");
    expect(migrationSource).toContain("affiliate_links_code_format");
    expect(migrationSource).toContain("affiliate_links_status_check");
    expect(migrationSource).toContain("affiliate_links_seller_id_uidx");
    expect(migrationSource).toContain("affiliate_links_lower_code_uidx");
    expect(migrationSource).toContain("trg_affiliate_links_updated_at");
    expect(migrationSource).toContain("alter table public.affiliate_links enable row level security");
    expect(migrationSource).toContain("revoke all on table public.affiliate_links from anon");
    expect(migrationSource).toContain("grant select, insert, update, delete on table public.affiliate_links to authenticated");
    expect(migrationSource).toContain("grant all on table public.affiliate_links to service_role");
    expect(migrationSource).toContain("to authenticated");
    expect(migrationSource).toContain("(select public.is_superadmin())");
    expect(migrationSource).not.toContain("auth.role()");
  });

  test("affiliate-admin can get or create seller links without trusting client codes", () => {
    const functionSource = readIfExists(
      path.join(repoRoot, "supabase/functions/affiliate-admin/index.ts"),
    );

    expect(functionSource).toContain("AffiliateLinkRow");
    expect(functionSource).toContain("mapLink");
    expect(functionSource).toContain("affiliateLink");
    expect(functionSource).toContain("generateLinkCode");
    expect(functionSource).toContain("getOrCreateSellerLink");
    expect(functionSource).toContain("AFFILIATE_SELLER_INACTIVE");
    expect(functionSource).toContain("AFFILIATE_LINK_CODE_COLLISION");
    expect(functionSource).toContain(".from(\"affiliate_links\")");
    expect(functionSource).toContain(".from(\"affiliate_sellers\")");
    expect(functionSource).toContain("updated_by: caller.user.id");
    expect(functionSource).toContain("action === \"getOrCreateSellerLink\"");
    expect(functionSource).not.toContain("payload?.code");
    expect(functionSource).not.toContain("code: payload");
    expect(functionSource).not.toContain("auth.role()");
  });

  test("frontend helper exposes getOrCreateAffiliateLink and link URL building", () => {
    const helperSource = readIfExists(path.join(repoRoot, "frontend/src/lib/affiliates.js"));

    expect(helperSource).toContain("getOrCreateAffiliateLink");
    expect(helperSource).toContain("buildAffiliateLinkUrl");
    expect(helperSource).toContain("action: 'getOrCreateSellerLink'");
    expect(helperSource).toContain("affiliate-admin");
    expect(helperSource).toContain("affiliateLink");
    expect(helperSource).toContain("#planos");
    expect(helperSource).not.toContain(".from('affiliate_links')");
    expect(helperSource).not.toContain('.from("affiliate_links")');
  });

  test("AffiliatesTab renders generate and copy link affordances with inactive gating", () => {
    const tabSource = readIfExists(
      path.join(repoRoot, "frontend/src/components/superadmin/AffiliatesTab.jsx"),
    );

    expect(tabSource).toContain("getOrCreateAffiliateLink");
    expect(tabSource).toContain("buildAffiliateLinkUrl");
    expect(tabSource).toContain("navigator.clipboard.writeText");
    expect(tabSource).toContain("Gerar link");
    expect(tabSource).toContain("Copiar link");
    expect(tabSource).toContain("Vendedor inativo");
    expect(tabSource).toContain("generatingLinkSellerId");
    expect(tabSource).toContain("Copy");
    expect(tabSource).toContain("Link");
    expect(tabSource).toContain("aria-label");
    expect(tabSource).not.toContain("<td className=\"px-5 py-4 text-gray-500\">Aguardando link</td>");
  });

  test("SuperadminDashboard keeps AffiliatesTab in the superadmin-only flow", () => {
    const dashboardSource = readIfExists(
      path.join(repoRoot, "frontend/src/pages/SuperadminDashboard.jsx"),
    );

    expect(dashboardSource).toContain("AffiliatesTab");
    expect(dashboardSource).toContain("value: 'affiliates'");
    expect(dashboardSource).toContain("label: 'Afiliados'");
    expect(dashboardSource).toContain("isSuperadmin");
    expect(dashboardSource).toContain("<TabsContent value=\"affiliates\"><AffiliatesTab /></TabsContent>");
    expect(dashboardSource).not.toContain("projectTabs.push({ value: 'affiliates'");
  });
});
