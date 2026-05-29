const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

describe("signup confirmation UX", () => {
  test("free trial confirmation screen can resend the Supabase signup email", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );

    expect(signupPageSource).toContain("handleResendConfirmationEmail");
    expect(signupPageSource).toContain("supabase.auth.resend");
    expect(signupPageSource).toContain("type: 'signup'");
    expect(signupPageSource).toContain("emailRedirectTo");
    expect(signupPageSource).toContain("Reenviar e-mail");

    const confirmEmailStart = signupPageSource.indexOf("{finishedFlow === 'confirm-email'");
    const confirmEmailBlock = signupPageSource.slice(
      confirmEmailStart,
      signupPageSource.indexOf("finishedFlow === 'paid'", confirmEmailStart)
    );

    expect(confirmEmailBlock).toContain("Reenviar e-mail");
    expect(confirmEmailBlock).not.toContain("Ir para login");
    expect(confirmEmailBlock).not.toContain("Voltar aos planos");
  });

  test("existing customer precheck sends a passwordless login link without creating a new auth user", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );
    const signupClientSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/lib/signup.js"),
      "utf8"
    );

    expect(signupPageSource).toContain("precheck.code === 'existing_customer'");
    expect(signupPageSource).toContain("sendExistingCustomerSignupLink");
    expect(signupPageSource).toContain("precheckFreeTrialSignup({");
    expect(signupPageSource).toContain("planCode,");
    expect(signupPageSource).toContain("buildSignupEmailRedirectTo({");
    expect(signupPageSource).toContain("existingCustomer: true");
    expect(signupPageSource).toContain("params.set('existingCustomer', '1')");
    expect(signupPageSource).toContain("planKey: selectedPlanKey");
    expect(signupPageSource).toContain("searchParams.get('establishmentName')");
    expect(signupPageSource).toContain("setFinishedFlow('confirm-email')");
    expect(signupClientSource).toContain("supabase.auth.signInWithOtp");
    expect(signupClientSource).toContain("shouldCreateUser: false");
    expect(signupClientSource).toContain("planCode = 'free_trial'");
    expect(signupClientSource).toContain("planCode,");
    expect(signupClientSource).toContain("emailRedirectTo");
  });

  test("magic link redirect preserves the plan key from the signup URL", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );

    expect(signupPageSource).toContain("plano: selectedPlanKey");
    expect(signupPageSource).toContain("plan_key: selectedPlanKey");
    expect(signupPageSource).toContain("searchParams.get('planCode')");
    expect(signupPageSource).toContain("findPlanKeyByCode");
    expect(signupPageSource).toContain("planCodeFromMetadata");
    expect(signupPageSource).toContain("[selectedPlan, selectedPlanKey]");
    expect(signupPageSource).not.toContain("const planKey = selectedPlan?.key || 'free-trial'");
  });

  test("existing customer flow sets password only after the magic link creates an authenticated session", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );
    const setPasswordStart = signupPageSource.indexOf("{finishedFlow === 'set-password'");
    const setPasswordEnd = signupPageSource.indexOf("finishedFlow === 'confirm-email'", setPasswordStart);
    const setPasswordBlock = signupPageSource.slice(
      setPasswordStart,
      setPasswordEnd
    );
    const stepperBlock = signupPageSource.slice(
      signupPageSource.indexOf("steps.map"),
      signupPageSource.indexOf("</ol>")
    );

    expect(signupPageSource).toContain("finishedFlow === 'set-password'");
    expect(signupPageSource).toContain("handlePasswordSetupSubmit");
    expect(signupPageSource).toContain("supabase.auth.updateUser({ password: passwordSetupValue })");
    expect(signupPageSource).toContain("__signup_password_setup_required");
    expect(signupPageSource).toContain("setFinishedFlow('set-password')");
    expect(signupPageSource).toContain("navigate('/org', { replace: true })");
    expect(setPasswordBlock).toContain("rounded-2xl border border-emerald-200 bg-emerald-50 p-5");
    expect(setPasswordBlock).not.toContain("border-amber-200 bg-amber-50");
    expect(stepperBlock).toContain("finishedFlow === 'confirm-email'");
    expect(stepperBlock).toContain("const done =");
    expect(stepperBlock).toContain("isSuccessFlow");
  });

  test("free trial signup asks for a password only after precheck confirms a new account can be created", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );
    const firstStepBlock = signupPageSource.slice(
      signupPageSource.indexOf('key="step-1"'),
      signupPageSource.indexOf('{signupCaptchaEnabled && (')
    );
    const createPasswordBlock = signupPageSource.slice(
      signupPageSource.indexOf("finishedFlow === 'create-password'"),
      signupPageSource.indexOf("finishedFlow === 'trial'")
    );

    expect(signupPageSource).toContain("setFinishedFlow('create-password')");
    expect(signupPageSource).toContain("handleCreatePasswordSubmit");
    expect(firstStepBlock).not.toContain('htmlFor="password"');
    expect(firstStepBlock).not.toContain('id="password"');
    expect(createPasswordBlock).toContain('htmlFor="password"');
    expect(signupPageSource).toContain("supabase.auth.signUp");
  });

  test("home route shows a progress screen while Supabase processes auth return URLs", () => {
    const appSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/App.jsx"),
      "utf8"
    );
    const authProgressScreenSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/components/app/AuthProgressScreen.jsx"),
      "utf8"
    );

    expect(appSource).toContain("HomeRoute");
    expect(appSource).toContain("isAuthReturnUrl");
    expect(appSource).toContain("@/components/app/AuthProgressScreen");
    expect(authProgressScreenSource).toContain("AuthProgressScreen");
    expect(appSource).toContain("AuthProgressScreen");
    expect(authProgressScreenSource).toContain("Confirmando seu e-mail");
    expect(authProgressScreenSource).toContain("bg-gradient-to-br from-purple-50 via-white to-indigo-50");
    expect(authProgressScreenSource).not.toContain("radial-gradient");
  });

  test("signup page top plans link scrolls to the landing plans section", () => {
    const appSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/App.jsx"),
      "utf8"
    );
    const hashScrollSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/components/app/HashScrollHandler.jsx"),
      "utf8"
    );
    const landingSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/LandingPage.jsx"),
      "utf8"
    );

    expect(landingSource).toContain('id="planos"');
    expect(appSource).toContain("@/components/app/HashScrollHandler");
    expect(appSource).toContain("<HashScrollHandler />");
    expect(hashScrollSource).toContain("scrollIntoView");
  });
});
