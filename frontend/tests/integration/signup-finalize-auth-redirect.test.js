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

  test("signup finalize callback waits for the AuthProvider session before invoking backend finalization", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );

    expect(signupPageSource).toContain("session: authSession");
    expect(signupPageSource).toContain("const session = authSession");
    expect(signupPageSource).toContain("if (!shouldAttemptFinalize || finalizeFromRedirectRef.current || !user) return;");
    expect(signupPageSource).toContain("provisionSignup");
    expect(signupPageSource).toContain("checkoutSessionIdFromRedirect");
    expect(signupPageSource).toContain("checkoutStatusFromRedirect");
    expect(signupPageSource).toContain("PAID_SIGNUP_FINALIZE_INITIAL_DELAY_MS");
    expect(signupPageSource).toContain("PAID_SIGNUP_FINALIZE_RETRY_DELAYS_MS");
    expect(signupPageSource).toContain("finalizeInitialDelayMs: isPaidFinalize");
  });

  test("pending free trial signups are auto-finalized before redirecting to /org", () => {
    const authContextSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/contexts/SupabaseAuthContext.jsx"),
      "utf8"
    );
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );

    expect(authContextSource).toContain("finalizeFreeTrialSignup");
    expect(authContextSource).toContain("getPendingFreeTrialSignup");
    expect(authContextSource).toContain("shouldAutoFinalizeSignup");
    expect(authContextSource).toContain("didAutoFinalizeSignup");
    expect(authContextSource).toContain("shouldAllowAutoFinalizeOnCallbackPath");
    expect(authContextSource).toContain("isClaimOrCallbackPath() && !shouldAllowAutoFinalizeOnCallbackPath");
    expect(authContextSource).toContain("canProbeSignupIntentOnPath");
    expect(authContextSource).toContain("canProbeBackendSignupIntent");
    expect(authContextSource).toContain("event === 'SIGNED_IN' || event === 'INITIAL_SESSION'");
    expect(authContextSource).toContain("allowBackendIntentFallback");
    expect(authContextSource).toContain("suppressMissingIntentError");
    expect(authContextSource).toContain("passwordSetupRequired");
    expect(authContextSource).toContain("__signup_password_setup_required");
    expect(authContextSource).toContain("passwordSetupParams");
    expect(authContextSource).toContain("passwordSetupParams.set('finalizar', '1')");
    expect(authContextSource).toContain("passwordSetupParams.set('passwordSetup', '1')");
    expect(signupPageSource).toContain("shouldFinalizeFromExistingCustomerContext");
    expect(signupPageSource).toContain("shouldAttemptFinalize");
  });

  test("auth auto-finalization refuses paid signup metadata without a checkout callback", () => {
    const authContextSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/contexts/SupabaseAuthContext.jsx"),
      "utf8"
    );

    const finalizeStart = authContextSource.indexOf("const finalizePendingSignupSession = useCallback");
    const finalizeEnd = authContextSource.indexOf("useEffect(() =>", finalizeStart);
    const finalizeBlock = authContextSource.slice(finalizeStart, finalizeEnd);

    expect(finalizeBlock).toContain("pendingSignup.planCode !== FREE_TRIAL_PLAN_CODE");
    expect(finalizeBlock).toContain("return null");
    expect(finalizeBlock.indexOf("pendingSignup.planCode !== FREE_TRIAL_PLAN_CODE"))
      .toBeLessThan(finalizeBlock.indexOf("finalizeFreeTrialSignup"));
  });

  test("paid signup returns stay on /cadastro instead of using the generic /org redirect", () => {
    const authContextSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/contexts/SupabaseAuthContext.jsx"),
      "utf8"
    );
    expect(authContextSource).toContain(
      "} else if ((event === 'SIGNED_IN' || didAutoFinalizeSignup) && !paidSignupReturn)"
    );
  });

  test("auth callback without a claim project falls back to signup finalization", () => {
    const authCallbackSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/AuthCallback.jsx"),
      "utf8"
    );

    expect(authCallbackSource).toContain("projectId");
    expect(authCallbackSource).toContain("signupFinalizeParams");
    expect(authCallbackSource).toContain("signupFinalizeParams.set('finalizar', '1')");
    expect(authCallbackSource).toContain("navigate(`/cadastro?${signupFinalizeParams.toString()}`");
    expect(authCallbackSource).not.toContain("ID do projeto nao encontrado para redirecionamento");
  });

  test("signup-finalize calls are deduplicated across auth events and strict-mode effects", () => {
    const signupClientSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/lib/signup.js"),
      "utf8"
    );

    expect(signupClientSource).toContain("pendingFinalizeRequests");
    expect(signupClientSource).toContain("completedFinalizeRequests");
    expect(signupClientSource).toContain("dedupeKey");
    expect(signupClientSource).toContain("SIGNUP_FINALIZE_PAYMENT_NOT_CONFIRMED");
    expect(signupClientSource).toContain("retryDelaysMs");
  });

  test("signup finalization emits Meta Pixel registration and purchase events", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );
    const pixelEventsSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/lib/signupPixelEvents.js"),
      "utf8"
    );

    expect(signupPageSource).toContain("trackSignupFinalization");
    expect(signupPageSource).toContain("trackSignupCompleted");
    expect(signupPageSource).toContain("trackSignupTrialStarted");
    expect(signupPageSource).toContain("trackSignupPaymentInfoAdded");
    expect(signupPageSource).toContain("trackSignupPurchaseCompleted");
    expect(signupPageSource).toContain("signup_paid_checkout_return");
    expect(signupPageSource).toContain("signup_email_confirmation");
    expect(pixelEventsSource).toContain("CompleteRegistration");
    expect(pixelEventsSource).toContain("StartTrial");
    expect(pixelEventsSource).toContain("AddPaymentInfo");
    expect(pixelEventsSource).toContain("Purchase");
    expect(pixelEventsSource).toContain("plan_code");
    expect(pixelEventsSource).toContain("SIGNUP_PIXEL_EVENTS_STORAGE_KEY");
  });
});
