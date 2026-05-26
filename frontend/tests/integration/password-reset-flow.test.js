const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

describe("password reset flow", () => {
  test("login page can request a password reset email", () => {
    const loginSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/Login.jsx"),
      "utf8"
    );

    expect(loginSource).toContain("resetPasswordForEmail");
    expect(loginSource).toContain("redirectTo: `${window.location.origin}/auth/callback?flow=recovery`");
    expect(loginSource).toContain("Esqueci minha senha");
    expect(loginSource).toContain("Enviar link de redefinicao");
  });

  test("reset password route lets the authenticated recovery session update the password", () => {
    const appSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/App.jsx"),
      "utf8"
    );
    const resetPasswordSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/ResetPassword.jsx"),
      "utf8"
    );
    const authContextSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/contexts/SupabaseAuthContext.jsx"),
      "utf8"
    );
    const authCallbackSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/AuthCallback.jsx"),
      "utf8"
    );

    expect(appSource).toContain("ResetPassword");
    expect(appSource).toContain('path="/reset-password"');
    expect(resetPasswordSource).toContain("supabase.auth.updateUser({ password })");
    expect(resetPasswordSource).toContain("navigate('/app', { replace: true })");
    expect(resetPasswordSource).toContain("Link expirado ou invalido");
    expect(authContextSource).toContain("p === '/reset-password'");
    expect(authCallbackSource).toContain("authType === 'recovery'");
    expect(authCallbackSource).toContain("flow === 'recovery'");
    expect(authCallbackSource).toContain("event === 'PASSWORD_RECOVERY'");
    expect(authCallbackSource).toContain("navigate('/reset-password', { replace: true })");
  });
});
