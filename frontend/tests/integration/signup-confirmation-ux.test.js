const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

describe("signup confirmation UX", () => {
  test("free trial confirmation screen can resend the Supabase signup email", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );
    const signupStatusCardsSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/signup/SignupStatusCards.jsx"),
      "utf8"
    );

    expect(signupPageSource).toContain("handleResendConfirmationEmail");
    expect(signupPageSource).toContain("supabase.auth.resend");
    expect(signupPageSource).toContain("type: 'signup'");
    expect(signupPageSource).toContain("emailRedirectTo");
    expect(signupStatusCardsSource).toContain("Reenviar e-mail");

    const confirmEmailStart = signupStatusCardsSource.indexOf("export function ConfirmEmailCard");
    const confirmEmailBlock = signupStatusCardsSource.slice(
      confirmEmailStart,
      signupStatusCardsSource.indexOf("export function PaidSuccessCard", confirmEmailStart)
    );

    expect(confirmEmailBlock).toContain("Reenviar e-mail");
    expect(confirmEmailBlock).not.toContain("Ir para login");
    expect(confirmEmailBlock).not.toContain("Voltar aos planos");
  });

  test("login confirmation resend does not force the free trial signup redirect", () => {
    const loginSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/Login.jsx"),
      "utf8"
    );
    const resendStart = loginSource.indexOf("const handleResendConfirmationEmail");
    const resendEnd = loginSource.indexOf("if (authLoading)", resendStart);
    const resendBlock = loginSource.slice(resendStart, resendEnd);

    expect(resendBlock).toContain("supabase.auth.resend");
    expect(resendBlock).toContain("type: 'signup'");
    expect(resendBlock).toContain("emailRedirectTo: `${window.location.origin}/login`");
    expect(resendBlock).not.toContain("free-trial");
    expect(resendBlock).not.toContain("finalizar=1");
    expect(resendBlock).not.toContain("/cadastro");
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
    const setPasswordSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/signup/SetPasswordForm.jsx"),
      "utf8"
    );
    const signupPageUtilsSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/signup/signupPageUtils.js"),
      "utf8"
    );
    const stepperSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/signup/SignupProgressSteps.jsx"),
      "utf8"
    );

    expect(signupPageSource).toContain("finishedFlow === 'set-password'");
    expect(signupPageSource).toContain("handlePasswordSetupSubmit");
    expect(signupPageSource).toContain("supabase.auth.updateUser({ password: passwordSetupValue })");
    expect(signupPageUtilsSource).toContain("__signup_password_setup_required");
    expect(signupPageSource).toContain("setFinishedFlow('set-password')");
    expect(signupPageSource).toContain("navigate('/org', { replace: true })");
    expect(setPasswordSource).toContain("rounded-2xl border border-emerald-200 bg-emerald-50 p-5");
    expect(setPasswordSource).not.toContain("border-amber-200 bg-amber-50");
    expect(stepperSource).toContain("finishedFlow === 'confirm-email'");
    expect(stepperSource).toContain("const done =");
    expect(stepperSource).toContain("isSuccessFlow");
  });

  test("free trial signup asks for a password only after precheck confirms a new account can be created", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );
    const stepOneSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/signup/StepOneSignupForm.jsx"),
      "utf8"
    );
    const createPasswordSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/signup/CreatePasswordForm.jsx"),
      "utf8"
    );

    expect(signupPageSource).toContain("setFinishedFlow('create-password')");
    expect(signupPageSource).toContain("handleCreatePasswordSubmit");
    expect(stepOneSource).not.toContain('htmlFor="password"');
    expect(stepOneSource).not.toContain('id="password"');
    expect(createPasswordSource).toContain('htmlFor="password"');
    expect(signupPageSource).toContain("supabase.auth.signUp");
  });

  test("create password step confirms matching passwords and can reveal typed passwords", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );
    const createPasswordSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/signup/CreatePasswordForm.jsx"),
      "utf8"
    );
    const passwordInputSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/signup/PasswordInput.jsx"),
      "utf8"
    );
    const submitStart = signupPageSource.indexOf("const handleCreatePasswordSubmit");
    const submitEnd = signupPageSource.indexOf("const handleStepOneSubmit", submitStart);
    const submitBlock = signupPageSource.slice(submitStart, submitEnd);

    expect(signupPageSource).toContain("passwordConfirmation: ''");
    expect(submitBlock).toContain("formData.passwordConfirmation !== formData.password");
    expect(submitBlock).toContain("nextErrors.passwordConfirmation");
    expect(submitBlock).toContain("As senhas não conferem. Ajuste para continuar.");
    expect(createPasswordSource).toContain('htmlFor="password-confirmation"');
    expect(createPasswordSource).toContain('id="password-confirmation"');
    expect(createPasswordSource).toContain("showPassword");
    expect(passwordInputSource).toContain("autoComplete=\"new-password\"");
    expect(passwordInputSource).toContain("EyeOff");
    expect(passwordInputSource).toContain("Eye");
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
