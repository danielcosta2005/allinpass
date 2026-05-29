const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

describe("paid signup for existing customers", () => {
  test("marks existing customer magic links so the authenticated return can ask for a password before checkout", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );

    expect(signupPageSource).toContain("existingCustomer: true");
    expect(signupPageSource).toContain("params.set('existingCustomer', '1')");
    expect(signupPageSource).toContain("shouldSetupExistingCustomerPasswordBeforePaidCheckout");
  });

  test("continues to paid checkout after an existing customer creates a password from the magic-link session", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );
    const passwordSetupStart = signupPageSource.indexOf("const handlePasswordSetupSubmit");
    const passwordSetupEnd = signupPageSource.indexOf("const handleCreatePasswordSubmit", passwordSetupStart);
    const passwordSetupBlock = signupPageSource.slice(passwordSetupStart, passwordSetupEnd);
    const continueToCheckoutStart = passwordSetupBlock.indexOf("if (shouldContinueToPaidCheckoutAfterPasswordSetup)");
    const continueToCheckoutEnd = passwordSetupBlock.indexOf("navigate('/org'", continueToCheckoutStart);
    const continueToCheckoutBlock = passwordSetupBlock.slice(continueToCheckoutStart, continueToCheckoutEnd);

    expect(passwordSetupBlock).toContain("shouldContinueToPaidCheckoutAfterPasswordSetup");
    expect(continueToCheckoutBlock).toContain("markExistingCustomerSignupPasswordReady");
    expect(continueToCheckoutBlock).toContain("setFinishedFlow('')");
    expect(continueToCheckoutBlock).toContain("setStep(3)");
    expect(continueToCheckoutBlock).toContain("Senha criada. Agora siga para o checkout seguro do Asaas.");
  });

  test("does not ask for the password again after payment when it was created before checkout", () => {
    const signupPageSource = fs.readFileSync(
      path.join(repoRoot, "frontend/src/pages/SignupPage.jsx"),
      "utf8"
    );
    const finalizeStart = signupPageSource.indexOf("const finalizePendingSignup = async () =>");
    const finalizeEnd = signupPageSource.indexOf("finalizePendingSignup();", finalizeStart);
    const finalizeBlock = signupPageSource.slice(finalizeStart, finalizeEnd);

    expect(finalizeBlock).toContain("existingCustomerPasswordReadyBeforeFinalize");
    expect(finalizeBlock).toContain("if (passwordSetupRequired && !existingCustomerPasswordReadyBeforeFinalize)");
    expect(finalizeBlock).toContain("clearExistingCustomerSignupContext()");
    expect(finalizeBlock).toContain("setFinishedFlow(finalizedPlanCode === 'free_trial' ? 'trial' : 'paid')");
  });
});
