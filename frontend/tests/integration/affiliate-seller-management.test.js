const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

describe("affiliate seller management UI and backend", () => {
  test("affiliate-admin supports bounded seller listing and seller updates", () => {
    const functionSource = readIfExists(
      path.join(repoRoot, "supabase/functions/affiliate-admin/index.ts"),
    );

    expect(functionSource).toContain("listSellers");
    expect(functionSource).toContain("updateSeller");
    expect(functionSource).toContain("AFFILIATE_INVALID_STATUS");
    expect(functionSource).toContain("AFFILIATE_SELLER_NOT_FOUND");
    expect(functionSource).toContain("pageSize");
    expect(functionSource).toContain(".range(from, to)");
    expect(functionSource).toContain(".order(\"created_at\", { ascending: false })");
    expect(functionSource).toContain(".from(\"affiliate_sellers\")");
    expect(functionSource).toContain("ensureSuperadmin");
    expect(functionSource).toContain("updated_by: caller.user.id");
    expect(functionSource).toContain(".eq(\"id\", sellerId)");
    expect(functionSource).not.toContain("auth.role()");
  });

  test("frontend affiliate helper exposes list/create/update through affiliate-admin", () => {
    const helperSource = readIfExists(path.join(repoRoot, "frontend/src/lib/affiliates.js"));

    expect(helperSource).toContain("createAffiliateSeller");
    expect(helperSource).toContain("listAffiliateSellers");
    expect(helperSource).toContain("updateAffiliateSeller");
    expect(helperSource).toContain("affiliate-admin");
    expect(helperSource).toContain("action: 'createSeller'");
    expect(helperSource).toContain("action: 'listSellers'");
    expect(helperSource).toContain("action: 'updateSeller'");
    expect(helperSource).toContain("readAffiliateAdminError");
    expect(helperSource).toContain("error.context");
    expect(helperSource).toContain("await error.context.json()");
    expect(helperSource).toContain("pixKey");
  });

  test("AffiliatesTab renders seller wizard/list/edit affordances with inline coupons", () => {
    const tabSource = readIfExists(
      path.join(repoRoot, "frontend/src/components/superadmin/AffiliatesTab.jsx"),
    );

    expect(tabSource).toContain("createSellerWithCoupon");
    expect(tabSource).toContain("listAffiliateSellers");
    expect(tabSource).toContain("updateAffiliateSeller");
    expect(tabSource).toContain("Dialog");
    expect(tabSource).toContain("Input");
    expect(tabSource).toContain("Label");
    expect(tabSource).toContain("Select");
    expect(tabSource).toContain("useToast");
    expect(tabSource).toContain("phone");
    expect(tabSource).toContain("email");
    expect(tabSource).toContain("wizardStep");
    expect(tabSource).toContain("Novo vendedor");
    expect(tabSource).toContain("Editar vendedor");
    expect(tabSource).toContain("Criar vendedor e cupom");
    expect(tabSource).toContain("renderSellerCoupon");
    expect(tabSource).toContain("Copiar cupom");
    expect(tabSource).toContain("Ativo");
    expect(tabSource).toContain("Inativo");
  });

  test("SuperadminDashboard exposes AffiliatesTab only as a superadmin main tab", () => {
    const dashboardSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SuperadminDashboard.jsx"),
      "utf8",
    );

    expect(dashboardSource).toContain("AffiliatesTab");
    expect(dashboardSource).toContain("value: 'affiliates'");
    expect(dashboardSource).toContain("label: 'Afiliados'");
    expect(dashboardSource).toContain("isSuperadmin");
    expect(dashboardSource).toContain("<TabsContent value=\"affiliates\"");
    expect(dashboardSource).toContain("<AffiliatesTab />");
    expect(dashboardSource).not.toContain("projectTabs.push({ value: 'affiliates'");
  });
});
