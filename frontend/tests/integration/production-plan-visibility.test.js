const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("production plan visibility", () => {
  test("public signup plans are locked to free trial", () => {
    const planSource = readSource("frontend/src/lib/subscriptionPlans.js");

    expect(planSource).toContain("export const PAID_SIGNUP_PUBLIC_ENABLED = false;");
    expect(planSource).toContain("export const PLAN_CHANGES_PUBLIC_ENABLED = false;");
    expect(planSource).toContain("export const PUBLIC_SIGNUP_PLAN_CODES = new Set(['free_trial']);");
    expect(planSource).toContain("export const DEFAULT_PLAN_KEY = 'free-trial';");
    expect(planSource).toContain("export const filterPublicSignupPlans");
    expect(planSource).toContain("export const publicSignupPlans");
    expect(planSource).toContain("export const fetchPublicSignupPlans");
    expect(planSource).toContain("export const isPublicSignupPlan");
  });

  test("landing renders only public signup plans", () => {
    const landingSource = readSource("frontend/src/pages/LandingPage.jsx");

    expect(landingSource).toContain("fetchPublicSignupPlans");
    expect(landingSource).toContain("publicSignupPlans");
    expect(landingSource).toContain("useState(publicSignupPlans)");
    expect(landingSource).toContain("const remotePlans = await fetchPublicSignupPlans();");
    expect(landingSource).toContain("plans.length === 1");
    expect(landingSource).toContain("flex justify-center");
    expect(landingSource).toContain("max-w-md mx-auto");
    expect(landingSource).not.toContain("fetchSubscriptionPlans");
    expect(landingSource).not.toContain("Faça upgrade ou downgrade");
  });

  test("signup page normalizes direct paid plan links back to free trial", () => {
    const signupSource = readSource("frontend/src/pages/SignupPage.jsx");

    expect(signupSource).toContain("fetchPublicSignupPlans");
    expect(signupSource).toContain("publicSignupPlans");
    expect(signupSource).toContain("isPublicSignupPlan");
    expect(signupSource).toContain("useState(publicSignupPlans)");
    expect(signupSource).toContain("const remotePlans = await fetchPublicSignupPlans();");
    expect(signupSource).toContain("const selectedPlan = useMemo(");
    expect(signupSource).toContain("isPublicSignupPlan(plan) ? plan : findPlanByKey(DEFAULT_PLAN_KEY, publicSignupPlans)");
  });

  test("restaurant dashboard shows current plan without upgrade or downgrade controls", () => {
    const dashboardSource = readSource("frontend/src/pages/RestaurantDashboard.jsx");
    const topBarSource = readSource("frontend/src/components/restaurant/dashboard/RestaurantTopBar.jsx");
    const billingHookSource = readSource("frontend/src/hooks/useRestaurantBilling.js");

    expect(dashboardSource).not.toContain("BillingPlanDialog");
    expect(dashboardSource).not.toContain("setPlanChangeOpen(true)");
    expect(topBarSource).not.toContain("onOpenPlanChange");
    expect(topBarSource).not.toContain("onClick={onOpenPlanChange}");
    expect(billingHookSource).toContain("PLAN_CHANGES_PUBLIC_ENABLED");
    expect(billingHookSource).toContain("if (!PLAN_CHANGES_PUBLIC_ENABLED) return undefined;");
    expect(billingHookSource).toContain("if (!PLAN_CHANGES_PUBLIC_ENABLED || !projectId || !plan?.code");
  });

  test("no-project state does not expose paid signup recovery actions", () => {
    const noProjectSource = readSource("frontend/src/components/restaurant/dashboard/NoProjectSignupState.jsx");

    expect(noProjectSource).not.toContain("Continuar pagamento");
    expect(noProjectSource).not.toContain("Finalizar ativacao");
    expect(noProjectSource).not.toContain("onContinuePayment");
    expect(noProjectSource).not.toContain("onFinalizeActivation");
    expect(noProjectSource).not.toContain("startPaidSignupCheckout");
  });
});
