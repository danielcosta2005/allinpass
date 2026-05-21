const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

describe("signup finalize auth redirect", () => {
  test("auth redirects do not hijack the signup finalize callback", () => {
    const authContextSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/contexts/SupabaseAuthContext.jsx"),
      "utf8"
    );

    expect(authContextSource).toContain("isSignupFinalizeCallbackPath");
    expect(authContextSource).toContain("finalizar");
    expect(authContextSource).toContain("p === '/cadastro'");
  });

  test("pending free trial signups are auto-finalized before redirecting to /org", () => {
    const authContextSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/contexts/SupabaseAuthContext.jsx"),
      "utf8"
    );

    expect(authContextSource).toContain("finalizeFreeTrialSignup");
    expect(authContextSource).toContain("getPendingFreeTrialSignup");
    expect(authContextSource).toContain("shouldAutoFinalizeSignup");
    expect(authContextSource).toContain("didAutoFinalizeSignup");
  });

  test("signup-finalize calls are deduplicated across auth events and strict-mode effects", () => {
    const signupClientSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/lib/signup.js"),
      "utf8"
    );

    expect(signupClientSource).toContain("pendingFinalizeRequests");
    expect(signupClientSource).toContain("completedFinalizeRequests");
    expect(signupClientSource).toContain("dedupeKey");
  });
});
