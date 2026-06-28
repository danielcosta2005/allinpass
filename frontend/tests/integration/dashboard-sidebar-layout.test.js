const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

describe("dashboard sidebar layout", () => {
  test("provides a shared shell with desktop sidebar, mobile drawer, and account footer", () => {
    const shellSource = readIfExists("frontend/src/components/dashboard/DashboardShell.jsx");

    expect(shellSource).toContain("function DashboardShell");
    expect(shellSource).toContain("navGroups");
    expect(shellSource).toContain("contentHeader");
    expect(shellSource).toContain("activeSubItem");
    expect(shellSource).toContain("children");
    expect(shellSource).toContain("const hasContentHeader = Boolean(contentHeader)");
    expect(shellSource).toContain("hasContentHeader ? 'sticky top-0 z-30' : 'sticky top-0 z-30 lg:hidden'");
    expect(shellSource).toContain("aria-expanded");
    expect(shellSource).toContain("DashboardNavChildren");
    const navChildrenSource = shellSource.match(/function DashboardNavChildren\([\s\S]*?\n}\n\nfunction DashboardSidebarContent/)?.[0] || "";
    expect(navChildrenSource).toContain("? 'text-purple-700'");
    expect(navChildrenSource).not.toContain("bg-purple-50 text-purple-700 ring-1 ring-purple-100");
    expect(navChildrenSource).not.toContain("focus:ring-2 focus:ring-purple-500");
    expect(navChildrenSource).toContain("childActive ? 'text-purple-600' : 'text-slate-400'");
    expect(shellSource).toContain("AnimatePresence");
    expect(shellSource).toContain("motion.div");
    expect(shellSource).toContain("initial={{ height: 0, opacity: 0, y: -4 }}");
    expect(shellSource).toContain("animate={{ height: 'auto', opacity: 1, y: 0 }}");
    expect(shellSource).toContain("exit={{ height: 0, opacity: 0, y: -4 }}");
    expect(shellSource).toContain("expandedNavItems");
    expect(shellSource).toContain("handleParentNavigate");
    expect(shellSource).not.toContain("setExpandedNavItems([])");
    expect(shellSource).toContain("current.includes(value)");
    expect(shellSource).toContain("? current.filter((itemValue) => itemValue !== value)");
    expect(shellSource).toContain(": [...current, value]");
    expect(shellSource).toContain("setExpandedNavItems(subValue ? [value] : [])");
    expect(shellSource).toContain("const expanded = expandedNavItems.includes(item.value)");
    expect(shellSource).not.toContain("handleNavigate(item.value, item.disabled, undefined");
    expect(shellSource).not.toContain("itemActive || expandedNavItems.includes(item.value)");
    expect(shellSource).toContain("lg:fixed");
    expect(shellSource).toContain("sidebarCollapsed");
    expect(shellSource).toContain("useState(false)");
    expect(shellSource).toContain("lg:w-16");
    expect(shellSource).toContain("lg:w-72");
    expect(shellSource).toContain("lg:pl-16");
    expect(shellSource).toContain("lg:pl-72");
    expect(shellSource).toContain("Fechar barra lateral");
    expect(shellSource).toContain("Abrir barra lateral");
    expect(shellSource).toContain("onBrandClick");
    expect(shellSource).toContain("Ir para inicio");
    expect(shellSource).toContain("PanelLeftClose");
    expect(shellSource).toContain("PanelLeftOpen");
    expect(shellSource).toContain("dashboard-shell-logo-open-icon");
    const collapsedLogoButton = shellSource.match(/aria-label="Abrir barra lateral"[\s\S]*?<\/button>/)?.[0] || "";
    expect(collapsedLogoButton).toContain("bg-purple-600 text-white");
    expect(collapsedLogoButton).toContain("hover:bg-purple-700");
    expect(collapsedLogoButton).not.toContain("bg-slate-950");
    expect(collapsedLogoButton).not.toContain("hover:bg-slate-900");
    expect(shellSource).not.toContain("text-purple-300");
    expect(shellSource).toContain("dashboard-shell-label");
    expect(shellSource).toContain("title={label}");
    expect(shellSource).toContain("Abrir navegacao");
    expect(shellSource).toContain("role=\"dialog\"");
    expect(shellSource).toContain("<AccountMenu");
    expect(shellSource).toContain("dashboard-shell-account");
  });

  test("moves restaurant dashboard navigation from horizontal tabs into the shared sidebar", () => {
    const dashboardSource = readIfExists("frontend/src/pages/RestaurantDashboard.jsx");

    expect(dashboardSource).toContain("DashboardShell");
    expect(dashboardSource).toContain("navGroups");
    expect(dashboardSource).toContain("DASHBOARD_TABS");
    expect(dashboardSource).toContain("NOTIFICATION_SUBTABS");
    expect(dashboardSource).toContain("REWARD_SUBTABS");
    expect(dashboardSource).toContain("activeNotificationTab");
    expect(dashboardSource).toContain("activeRewardTab");
    expect(dashboardSource).toContain("activeSubItem");
    expect(dashboardSource).toContain("handleDashboardNavigate");
    expect(dashboardSource).toContain("if (!subValue) return");
    expect(dashboardSource).toContain("restaurant_active_tab");
    expect(dashboardSource).toContain("onBrandClick");
    expect(dashboardSource).toContain("handleTabChange('kpis')");
    expect(dashboardSource).not.toContain("Painel do Projeto");
    expect(dashboardSource).not.toContain("activeTabConfig");
    expect(dashboardSource).toContain("contentHeader={null}");
    expect(dashboardSource).not.toContain("TabsList");
    expect(dashboardSource).not.toContain("TabsTrigger");
  });

  test("moves restaurant notification and reward subsections into sidebar dropdowns", () => {
    const constantsSource = readIfExists("frontend/src/constants/restaurantDashboard.js");
    const notificationsSource = readIfExists("frontend/src/components/restaurant/NotificationsDashboard.jsx");
    const rewardsSource = readIfExists("frontend/src/components/restaurant/RewardsTab.jsx");

    expect(constantsSource).toContain("NOTIFICATION_SUBTABS");
    expect(constantsSource).toContain("REWARD_SUBTABS");
    expect(constantsSource).toContain("children: NOTIFICATION_SUBTABS");
    expect(constantsSource).toContain("children: REWARD_SUBTABS");

    expect(notificationsSource).toContain("activeTab");
    expect(notificationsSource).toContain("onTabChange");
    expect(notificationsSource).not.toContain("TabsList");
    expect(notificationsSource).not.toContain("TabsTrigger");
    expect(notificationsSource).not.toContain("Central de Notifica");
    expect(notificationsSource).not.toContain("Gerencie envios manuais");
    expect(notificationsSource).not.toContain("Bell,");

    expect(rewardsSource).toContain("activeTab");
    expect(rewardsSource).toContain("onTabChange");
    expect(rewardsSource).not.toContain("TabsList");
    expect(rewardsSource).not.toContain("TabsTrigger");
    expect(rewardsSource).not.toContain("<h2 className=\"text-xl font-semibold text-gray-900\">Recompensas</h2>");
    expect(rewardsSource).not.toContain("Configure benef");
    expect(rewardsSource).toContain("Criar recompensa");
  });

  test("uses grouped admin navigation with global and selected project sidebar groups", () => {
    const dashboardSource = readIfExists("frontend/src/pages/SuperadminDashboard.jsx");

    expect(dashboardSource).toContain("DashboardShell");
    expect(dashboardSource).toContain("adminNavGroups");
    expect(dashboardSource).toContain("mainTabs");
    expect(dashboardSource).toContain("projectTabs");
    expect(dashboardSource).toContain("selectedProject");
    expect(dashboardSource).toContain("superadmin_active_tab");
    expect(dashboardSource).toContain("handleDashboardHome");
    expect(dashboardSource).toContain("onBrandClick");
    expect(dashboardSource).not.toContain("TabsList");
    expect(dashboardSource).not.toContain("TabsTrigger");
  });
});
