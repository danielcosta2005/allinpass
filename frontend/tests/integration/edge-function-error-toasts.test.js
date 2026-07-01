const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

describe("edge function error toasts", () => {
  test("normalizes non-2xx Edge Function payloads before they reach toast messages", () => {
    const helperSource = readIfExists("frontend/src/lib/functionErrors.js");
    const billingSource = readIfExists("frontend/src/lib/billing.js");
    const signupSource = readIfExists("frontend/src/lib/signup.js");
    const authSessionSource = readIfExists("frontend/src/lib/authSession.js");
    const invokeAdminSource = readIfExists("frontend/src/lib/invokeAdmin.js");
    const adminSource = readIfExists("frontend/src/lib/admin.js");
    const apiSource = readIfExists("frontend/src/lib/api.js");
    const addToWalletSource = readIfExists("frontend/src/lib/addToWallet.js");
    const scannerSource = readIfExists("frontend/src/components/restaurant/ScannerTab.jsx");
    const rewardsSource = readIfExists("frontend/src/components/restaurant/RewardsTab.jsx");
    const addWalletSource = readIfExists("frontend/src/components/AddWallet.jsx");
    const notificationsPanelSource = readIfExists("frontend/src/components/superadmin/wallet/NotificationsPanel.jsx");
    const walletConfigSource = readIfExists("frontend/src/components/superadmin/WalletConfigTab.jsx");

    expect(helperSource).toContain("readFunctionErrorPayload");
    expect(helperSource).toContain("error?.context");
    expect(helperSource).toContain("typeof error.context.clone === 'function'");
    expect(helperSource).toContain("context?.response");
    expect(helperSource).toContain("payload.error || payload.message");

    expect(billingSource).toContain("readFunctionErrorPayload");
    expect(billingSource).toContain("const { data, error, response } = await supabase.functions.invoke('billing-start-payment-recovery'");
    expect(billingSource).not.toContain("const response = context?.response;");

    expect(signupSource).toContain("readFunctionErrorPayload");
    expect(authSessionSource).toContain("readFunctionErrorPayload");
    expect(invokeAdminSource).toContain("readFunctionErrorPayload");
    expect(adminSource).toContain("buildFunctionError");
    expect(apiSource).toContain("buildFunctionError");
    expect(addToWalletSource).toContain("buildFunctionError");
    expect(scannerSource).toContain("readFunctionErrorPayload");
    expect(rewardsSource).toContain("readFunctionErrorPayload");
    expect(addWalletSource).toContain("readFunctionErrorPayload");
    expect(notificationsPanelSource).toContain("buildFunctionError");
    expect(walletConfigSource).toContain("readFunctionErrorPayload");
  });
});
