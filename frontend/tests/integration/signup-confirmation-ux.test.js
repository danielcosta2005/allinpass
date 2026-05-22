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

    const confirmEmailBlock = signupPageSource.slice(
      signupPageSource.indexOf("finishedFlow === 'confirm-email'"),
      signupPageSource.indexOf("finishedFlow === 'paid'")
    );

    expect(confirmEmailBlock).toContain("Reenviar e-mail");
    expect(confirmEmailBlock).not.toContain("Ir para login");
    expect(confirmEmailBlock).not.toContain("Voltar aos planos");
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
