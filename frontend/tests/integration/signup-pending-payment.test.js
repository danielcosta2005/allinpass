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

  test("frontend has a signup status client helper", () => {
    const signupClientSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/lib/signup.js"),
      "utf8"
    );

    expect(signupClientSource).toContain("getSignupStatus");
    expect(signupClientSource).toContain("signup-status");
  });

  test("/org replaces the generic no-project state with paid signup recovery actions", () => {
    const dashboardSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/RestaurantDashboard.jsx"),
      "utf8"
    );

    expect(dashboardSource).toContain("getSignupStatus");
    expect(dashboardSource).toContain("startPaidSignupCheckout");
    expect(dashboardSource).toContain("finalizeSignup");
    expect(dashboardSource).toContain("payment_pending");
    expect(dashboardSource).toContain("Continuar pagamento");
    expect(dashboardSource).toContain("Finalizar ativação");
  });
});
