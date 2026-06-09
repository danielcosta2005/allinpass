const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

describe("signup paid checkout recovery", () => {
  test("signup-status edge function is registered and reads checkout sessions privately", () => {
    const configSource = fs.readFileSync(
      path.join(repoRoot, "supabase/config.toml"),
      "utf8"
    );
    const statusFunctionSource = fs.readFileSync(
      path.join(repoRoot, "supabase/functions/signup-status/index.ts"),
      "utf8"
    );

    expect(configSource).toContain("[functions.signup-status]");
    expect(configSource).toContain('entrypoint = "./functions/signup-status/index.ts"');
    expect(statusFunctionSource).toContain("signup_checkout_sessions");
    expect(statusFunctionSource).toContain("payment_pending");
    expect(statusFunctionSource).toContain("payment_retry_available");
    expect(statusFunctionSource).toContain("payment_confirmed_finalization_pending");
  });

  test("signup-status can recover existing-customer paid intent before checkout exists", () => {
    const statusFunctionSource = fs.readFileSync(
      path.join(repoRoot, "supabase/functions/signup-status/index.ts"),
      "utf8"
    );

    expect(statusFunctionSource).toContain("signup_existing_customer_intents");
    expect(statusFunctionSource).toContain("getExistingCustomerSignupIntent");
    expect(statusFunctionSource).toContain("intentPlanCode");
    expect(statusFunctionSource).toContain("intentEstablishmentName");
    expect(statusFunctionSource).toContain(
      "const paidSignupContextPlanCode = sessionPlanCode || intentPlanCode || metadataPlanCode;"
    );
  });

  test("frontend has a signup status client helper", () => {
    const signupClientSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/lib/signup.js"),
      "utf8"
    );

    expect(signupClientSource).toContain("getSignupStatus");
    expect(signupClientSource).toContain("signup-status");
    expect(signupClientSource).toContain("pendingSignupStatusRequest");
    expect(signupClientSource).toContain("completedSignupStatusRequest");
    expect(signupClientSource).toContain("SIGNUP_STATUS_DEDUPE_TTL_MS");
    expect(signupClientSource).toContain("force = false");
    expect(signupClientSource).toContain("cacheKey = ''");
  });

  test("/org keeps paid signup recovery helpers but hides paid recovery actions from the public UI", () => {
    const dashboardSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/RestaurantDashboard.jsx"),
      "utf8"
    );
    const recoveryHookSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/hooks/usePaidSignupRecovery.js"),
      "utf8"
    );
    const noProjectStateSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/components/restaurant/dashboard/NoProjectSignupState.jsx"),
      "utf8"
    );

    expect(dashboardSource).toContain("usePaidSignupRecovery");
    expect(dashboardSource).toContain("NoProjectSignupState");
    expect(recoveryHookSource).toContain("getSignupStatus");
    expect(recoveryHookSource).toContain("startPaidSignupCheckout");
    expect(recoveryHookSource).toContain("finalizeSignup");
    expect(recoveryHookSource).toContain("PAID_SIGNUP_FINALIZE_RETRY_DELAYS_MS");
    expect(noProjectStateSource).not.toContain("payment_pending");
    expect(noProjectStateSource).not.toContain("Continuar pagamento");
    expect(noProjectStateSource).not.toContain("Finalizar ativacao");
    expect(noProjectStateSource).toContain("Seu usuario nao esta associado a nenhum projeto");
  });
});
