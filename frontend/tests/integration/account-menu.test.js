const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

describe("account menu", () => {
  test("replaces topbar sign-out buttons with a reusable account dropdown", () => {
    const accountMenuSource = readIfExists("frontend/src/components/app/AccountMenu.jsx");
    const restaurantTopBarSource = readIfExists("frontend/src/components/restaurant/dashboard/RestaurantTopBar.jsx");
    const superadminDashboardSource = readIfExists("frontend/src/pages/SuperadminDashboard.jsx");

    expect(accountMenuSource).toContain("function AccountMenu");
    expect(accountMenuSource).toContain("Abrir menu da conta");
    expect(accountMenuSource).toContain("Mudar de plano");
    expect(accountMenuSource).toContain("Tema");
    expect(accountMenuSource).toContain("Moon");
    expect(accountMenuSource).toContain("Sun");
    expect(accountMenuSource).toContain("Sair");
    expect(accountMenuSource).toContain("showPlanChangeOption");

    expect(restaurantTopBarSource).toContain("<AccountMenu");
    expect(restaurantTopBarSource).toContain("showPlanChangeOption");
    expect(restaurantTopBarSource).toContain("onOpenPlanChange={onOpenPlanChange}");
    expect(restaurantTopBarSource).not.toContain("<Button");

    expect(superadminDashboardSource).toContain("<AccountMenu");
    expect(superadminDashboardSource).toContain("showPlanChangeOption={false}");
    expect(superadminDashboardSource).not.toContain("<Button");
  });
});
