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
    const dashboardShellSource = readIfExists("frontend/src/components/dashboard/DashboardShell.jsx");
    const protectedLayoutSource = readIfExists("frontend/src/layouts/ProtectedLayout.jsx");
    const restaurantDashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");
    const superadminDashboardSource = readIfExists("frontend/src/pages/SuperadminDashboard.jsx");
    const themeContextSource = readIfExists("frontend/src/contexts/ThemeContext.jsx");
    const globalCssSource = readIfExists("frontend/src/index.css");

    expect(accountMenuSource).toContain("function AccountMenu");
    expect(accountMenuSource).toContain("Abrir menu da conta");
    expect(accountMenuSource).toContain("Mudar de plano");
    expect(accountMenuSource).toContain("Faturamento");
    expect(accountMenuSource).toContain("Tema");
    expect(accountMenuSource).toContain("Moon");
    expect(accountMenuSource).toContain("Sun");
    expect(accountMenuSource).toContain("Sair");
    expect(accountMenuSource).toContain("showPlanChangeOption");
    expect(accountMenuSource).toContain("planChangeDisabledReason");
    expect(accountMenuSource).toContain("TooltipContent");
    expect(accountMenuSource).toContain("title={planChangeDisabledReason}");
    expect(accountMenuSource).toContain("showBillingOption");
    expect(accountMenuSource).toContain("onOpenBilling");
    expect(accountMenuSource).toContain("projectName");
    expect(accountMenuSource).toContain("Projeto");
    expect(accountMenuSource).toContain("{projectName ? (");
    expect(accountMenuSource).toContain("AnimatePresence");
    expect(accountMenuSource).toContain("motion.div");
    expect(accountMenuSource).toContain("'top-left': 'bottom-full -left-2 mb-3'");
    expect(accountMenuSource).toContain("initial={{ opacity: 0, y: 8, scale: 0.98 }}");
    expect(accountMenuSource).toContain("animate={{ opacity: 1, y: 0, scale: 1 }}");
    expect(accountMenuSource).toContain("exit={{ opacity: 0, y: 8, scale: 0.98 }}");
    expect(accountMenuSource).toContain("useTheme");
    expect(accountMenuSource).toContain("toggleTheme");
    expect(accountMenuSource).toContain('role="switch"');
    expect(accountMenuSource).toContain("aria-checked={isDarkTheme}");
    expect(accountMenuSource).toContain("Alternar para tema");
    expect(accountMenuSource).not.toContain("Tema visual indisponivel");

    expect(dashboardShellSource).toContain("<AccountMenu");
    expect(dashboardShellSource).toContain("accountMenuProps");
    expect(dashboardShellSource).toContain("dashboard-shell-account");
    expect(dashboardShellSource).toContain("dashboard-shell-account-avatar");
    expect(dashboardShellSource).toContain("dashboard-shell-account-copy");
    expect(dashboardShellSource).toContain("menuPlacement=\"top-left\"");
    expect(dashboardShellSource).toContain("bg-background");
    expect(dashboardShellSource).toContain("bg-card");
    expect(dashboardShellSource).toContain("text-muted-foreground");
    expect(dashboardShellSource.indexOf("dashboard-shell-account-avatar")).toBeLessThan(
      dashboardShellSource.indexOf("dashboard-shell-account-copy")
    );

    expect(protectedLayoutSource).toContain("ThemeProvider");
    expect(protectedLayoutSource).toContain("<ThemeProvider>");
    expect(protectedLayoutSource).toContain("</ThemeProvider>");

    expect(themeContextSource).toContain("THEME_STORAGE_KEY = 'allinpass-theme'");
    expect(themeContextSource).toContain("function ThemeProvider");
    expect(themeContextSource).toContain("function useTheme");
    expect(themeContextSource).toContain("toggleTheme");
    expect(themeContextSource).toContain("document.documentElement");
    expect(themeContextSource).toContain("classList.toggle('dark'");
    expect(themeContextSource).toContain("localStorage.setItem(THEME_STORAGE_KEY");

    expect(globalCssSource).toContain("--chart-1");
    expect(globalCssSource).toContain("color-scheme: dark");
    expect(globalCssSource).toContain("--background: 226");

    expect(restaurantDashboardSource).toContain("showPlanChangeOption");
    expect(restaurantDashboardSource).toContain("showBillingOption");
    expect(restaurantDashboardSource).toContain("onOpenBilling");
    expect(restaurantDashboardSource).toContain("onOpenPlanChange");
    expect(restaurantDashboardSource).toContain("useProjectName(projectId)");
    expect(restaurantDashboardSource).toContain("projectName: projectId");
    expect(restaurantDashboardSource).not.toContain("<Button");

    expect(superadminDashboardSource).toContain("accountMenuProps");
    expect(superadminDashboardSource).toContain("showPlanChangeOption: false");
    expect(superadminDashboardSource).not.toContain("showBillingOption");
    expect(superadminDashboardSource).not.toContain("<Button");
  });
});
