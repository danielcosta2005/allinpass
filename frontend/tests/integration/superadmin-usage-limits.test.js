const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function readMigrations() {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  return fs.readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .map((fileName) => fs.readFileSync(path.join(migrationsDir, fileName), "utf8"))
    .join("\n");
}

describe("superadmin usage limits tab", () => {
  test("renames the project tab to Usagem and renders the usage limits screen", () => {
    const dashboardSource = readIfExists("frontend/src/pages/SuperadminDashboard.jsx");

    expect(dashboardSource).toContain("UsageConfigTab");
    expect(dashboardSource).toContain("normalizeSuperadminTabValue");
    expect(dashboardSource).toContain("value === 'notifications' ? 'usage' : value");
    expect(dashboardSource).toContain("value: 'usage', label: 'Usagem'");
    expect(dashboardSource).toContain('<TabsContent value="usage"');
    expect(dashboardSource).not.toContain("value: 'notifications', label: 'Notifica");
  });

  test("uses billing subscriptions and current cycle usage as the source of truth", () => {
    const usageSource = readIfExists("frontend/src/components/superadmin/UsageConfigTab.jsx");
    const limitsSource = readIfExists("frontend/src/lib/projectUsageLimits.js");

    expect(usageSource).toContain("Controle de Usagem");
    expect(usageSource).toContain("Instalações de passes");
    expect(usageSource).toContain("Notificações enviadas");
    expect(usageSource).toContain("Estender free trial");
    expect(usageSource).toContain("trialEndsAtValue");
    expect(usageSource).toContain("subscription.isFreeTrial");
    expect(usageSource).toContain("includedPassInstalls");
    expect(usageSource).toContain("includedNotificationSends");
    expect(usageSource).toContain("passLimitValue !== String(subscription.includedPassInstalls)");
    expect(usageSource).toContain("notificationLimitValue !== String(subscription.includedNotificationSends)");
    expect(usageSource).toContain("trialEndsAtValue !== toDateTimeLocalValue(subscription.trialEndsAt)");
    expect(usageSource).not.toContain("projects_notifications");

    expect(limitsSource).toContain(".from('billing_subscriptions')");
    expect(limitsSource).toContain(".from('billing_cycle_usage_summaries')");
    expect(limitsSource).toContain("included_pass_installs");
    expect(limitsSource).toContain("included_notification_sends");
    expect(limitsSource).toContain("trial_ends_at");
    expect(limitsSource).toContain("p_trial_ends_at");
    expect(limitsSource).toContain("pass_install_quantity");
    expect(limitsSource).toContain("notification_sent_quantity");
    expect(limitsSource).toContain("updateProjectUsageLimits");
    expect(limitsSource).not.toContain("projects_notifications");
  });

  test("updates limits through a superadmin RPC instead of direct table updates", () => {
    const limitsSource = readIfExists("frontend/src/lib/projectUsageLimits.js");
    const migrationSources = readMigrations();

    expect(limitsSource).toContain("rpc('update_superadmin_project_usage_limits'");
    expect(limitsSource).not.toContain(".update(payload)");

    expect(migrationSources).toContain("update_superadmin_project_usage_limits");
    expect(migrationSources).toContain("if not public.is_superadmin()");
    expect(migrationSources).toContain("billing_subscriptions");
    expect(migrationSources).toContain("billing_cycle_usage_summaries");
    expect(migrationSources).toContain("grant execute on function public.update_superadmin_project_usage_limits");
  });
});
