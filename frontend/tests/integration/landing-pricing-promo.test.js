const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("landing pricing limited promotion", () => {
  test("LandingPage advertises a first-100 limited 50 percent promotion for paid plans", () => {
    const landingSource = readSource("frontend/src/pages/LandingPage.jsx");

    expect(landingSource).toContain("LIMITED_FIRST_100_PROMOTION");
    expect(landingSource).toContain("50% OFF");
    expect(landingSource).toContain("100 primeiros");
    expect(landingSource).toContain(
      "limitedPromotion={p.type === 'paid' ? LIMITED_FIRST_100_PROMOTION : null}",
    );
  });

  test("PlanCard renders a simulated higher original price when limited promotion is active", () => {
    const planCardSource = readSource("frontend/src/components/landing/PlanCard.jsx");

    expect(planCardSource).toContain("limitedPromotion = null");
    expect(planCardSource).toContain("showLimitedPromotion");
    expect(planCardSource).toContain("originalPriceMultiplier");
    expect(planCardSource).toContain("plan.price * limitedPromotion.originalPriceMultiplier");
    expect(planCardSource).toContain("formatCurrencyBRL(limitedPromotionOriginalPrice)");
    expect(planCardSource).toContain("line-through");
  });
});
