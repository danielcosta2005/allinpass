const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("promotional code admin UI", () => {
  test("affiliate helper exposes promotional code actions through affiliate-admin only", () => {
    const source = readSource("frontend/src/lib/affiliates.js");

    expect(source).toContain("mapPromotionalCode");
    expect(source).toContain("promotionalCode");
    expect(source).toContain("phone");
    expect(source).toContain("email");
    expect(source).toContain("buildPromotionalLinkUrl");
    expect(source).toContain("`/?promo=${encodeURIComponent(cleanCode)}#planos`");
    expect(source).toContain("listPromotionalCodes");
    expect(source).toContain("createPromotionalCode");
    expect(source).toContain("updatePromotionalCode");
    expect(source).toContain("createSellerWithCoupon");
    expect(source).toContain("action: 'listPromotionalCodes'");
    expect(source).toContain("fetchAllPromotionalCodesForType");
    expect(source).toContain("filteredPromotionalCodes.slice(offset, offset + normalizedPageSize)");
    expect(source).toContain("action: 'createPromotionalCode'");
    expect(source).toContain("action: 'updatePromotionalCode'");
    expect(source).toContain("action: 'createSellerWithCoupon'");
    expect(source).toContain("marginWarningAcknowledged");
    expect(source).not.toContain(".from(\"billing_promotional_codes\")");
  });

  test("AffiliatesTab has seller and coupon admin views with coupon filters", () => {
    const source = readSource("frontend/src/components/superadmin/AffiliatesTab.jsx");
    const functionSource = readSource("supabase/functions/affiliate-admin/index.ts");

    expect(source).toContain("adminView");
    expect(source).toContain("setAdminView");
    expect(source).toContain("listPromotionalCodes");
    expect(source).toContain("couponStatusFilter");
    expect(source).toContain("couponTypeFilter");
    expect(source).toContain("couponSellerFilter");
    expect(source).toContain("couponSearchDraft");
    expect(source).toContain("coupon-search");
    expect(source).toContain("coupon-status-filter");
    expect(source).toContain("coupon-type-filter");
    expect(source).toContain("coupon-seller-filter");
    expect(source).toContain("loadSellerPromotionalCodes");
    expect(source).toContain("Vendedores");
    expect(source).toContain("Cupons");
    expect(source).toContain("Cupom de campanha");
    expect(source).toContain("Cupom de vendedor");
    expect(functionSource).toContain("phone.ilike");
    expect(functionSource).toContain("email.ilike");
  });

  test("seller rows render the promotional code inline and toggle coupon status", () => {
    const source = readSource("frontend/src/components/superadmin/AffiliatesTab.jsx");

    expect(source).toContain("renderSellerCoupon");
    expect(source).toContain("promotionalCode");
    expect(source).toContain("buildPromotionalLinkUrl");
    expect(source).toContain("Copiar cupom");
    expect(source).toContain("discountBps");
    expect(source).toContain("commissionBps");
    expect(source).toContain("redeemedUses");
    expect(source).toContain("maxUses");
    expect(source).toContain("handleToggleCouponStatus");
    expect(source).toContain("updatePromotionalCode({");
    expect(source).toContain("status: nextStatus");
    expect(source).toContain("refreshCouponListsAfterMutation");
    expect(source).not.toContain("Ative o vendedor antes de gerar um link de afiliado");
  });

  test("seller creation is a two-step wizard that submits seller and coupon together", () => {
    const source = readSource("frontend/src/components/superadmin/AffiliatesTab.jsx");

    expect(source).toContain("wizardStep");
    expect(source).toContain("setWizardStep");
    expect(source).toContain("createSellerWithCoupon");
    expect(source).toContain("generatePromotionalCode");
    expect(source).toContain("sellerForm");
    expect(source).toContain("couponForm");
    expect(source).toContain("phone");
    expect(source).toContain("email");
    expect(source).toContain("Telefone");
    expect(source).toContain("Email");
    expect(source).toContain("discountBps: 1000");
    expect(source).toContain("commissionBps: 1000");
    expect(source).toContain("negativeMarginAcknowledged");
    expect(source).toContain("marginWarningAcknowledged");
    expect(source).toContain("Etapa 1");
    expect(source).toContain("Etapa 2");
    expect(source).toContain("Criar vendedor e cupom");
    expect(source).toContain('placeholder="Nome, telefone ou email"');
    expect(source).not.toContain('htmlFor="affiliate-contact"');
    expect(source).not.toContain('id="affiliate-contact"');
    expect(source).not.toContain('handleSellerFormChange(\'contact\'');
    expect(source).not.toContain('seller.contact');
    expect(source).not.toContain(">Contato<");
  });

  test("coupon create and edit forms validate coupon rules without seller fields", () => {
    const source = readSource("frontend/src/components/superadmin/AffiliatesTab.jsx");

    expect(source).toContain("const isCouponFormMode = formMode.startsWith('coupon')");
    expect(source).toContain("if (!isCouponFormMode) {");
    expect(source).toContain("const minimumMaxUses = Number(activePromotionalCode?.redeemedUses || 0)");
    expect(source).toContain("Limite menor que usos");
    expect(source).toContain("Erro ao salvar cupom");
  });
});
