const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function readMigrationSources() {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");
}

describe("free trial quota enforcement", () => {
  test("derives free-trial quota exhaustion from live cycle usage without expiring the subscription", () => {
    const helperSource = readIfExists("supabase/functions/_shared/billingAccess.ts");
    const migrationSources = readMigrationSources();

    expect(helperSource).toContain("PROJECT_USAGE_LIMIT_EXCEEDED");
    expect(helperSource).toContain("Franquia do free trial esgotada. Assine um plano para continuar.");
    expect(helperSource).toContain("getProjectUsageQuotaState");
    expect(helperSource).toContain("assertProjectUsageAllowed");
    expect(helperSource).toContain("throw new ProjectBillingInactiveError()");
    expect(helperSource).toContain("billing_cycle_usage_summaries");
    expect(helperSource).toContain("pass_install_quantity");
    expect(helperSource).toContain("notification_sent_quantity");
    expect(helperSource).toContain("included_pass_installs");
    expect(helperSource).toContain("included_notification_sends");
    expect(helperSource).toContain("planCode !== FREE_PLAN_CODE");

    expect(migrationSources).toContain("public.assert_free_trial_usage_quota_available");
    expect(migrationSources).toContain("p_resource_type = 'pass_install'");
    expect(migrationSources).toContain("p_resource_type = 'notification_sent'");
    expect(migrationSources).toContain("billing_cycle_usage_summaries");
    expect(migrationSources).toContain("PROJECT_USAGE_LIMIT_EXCEEDED");
    expect(migrationSources).toContain("PROJECT_BILLING_INACTIVE");
    expect(migrationSources).toContain("new.install_status = 'installed'");
    expect(migrationSources).toContain("old.install_status is distinct from 'installed'");
    expect(migrationSources).toContain("before insert or update of install_status");
    expect(migrationSources).not.toContain("set status = 'expired' where");
  });

  test("preflights pass installs and limits notification jobs before creating free-trial usage", () => {
    const universalLinkSource = readIfExists("supabase/functions/universal-link/index.ts");
    const enqueueSource = readIfExists("supabase/functions/notifications-enqueue/index.ts");
    const runnerSource = readIfExists("supabase/functions/notifications-runner/index.ts");

    expect(universalLinkSource).toContain("../_shared/billingAccess.ts");
    expect(universalLinkSource).toContain("assertProjectBillingActive");
    expect(universalLinkSource).toContain("isProjectBillingInactiveError");
    expect(universalLinkSource).toContain("getProjectBillingInactivePayload");
    expect(universalLinkSource).toContain("assertProjectUsageAllowed");
    expect(universalLinkSource).toContain("\"pass_install\"");
    expect(universalLinkSource).toContain("isProjectUsageLimitExceededError");

    expect(enqueueSource).toContain("getProjectUsageQuotaState");
    expect(enqueueSource).toContain("\"notification_sent\"");
    expect(enqueueSource).toContain("availableJobQuota");
    expect(enqueueSource).toContain("jobs.slice(0, availableJobQuota)");
    expect(enqueueSource).toContain("skipped_limit");
    expect(enqueueSource).toContain("PROJECT_USAGE_LIMIT_EXCEEDED");
    expect(enqueueSource).toContain("getProjectUsageLimitExceededPayload");

    expect(runnerSource).toContain("../_shared/billingAccess.ts");
    expect(runnerSource).toContain("assertProjectUsageAllowed");
    expect(runnerSource).toContain("\"notification_sent\"");
    expect(runnerSource).toContain("notifications_limit_reached");
    expect(runnerSource).toContain("status: \"canceled\"");
    expect(runnerSource).toContain("PROJECT_USAGE_LIMIT_EXCEEDED");
  });

  test("keeps paid plans above quota on the existing billing summaries path", () => {
    const helperSource = readIfExists("supabase/functions/_shared/billingAccess.ts");
    const planUpgradeSource = readIfExists("frontend/tests/integration/billing-plan-upgrade.test.js");

    expect(helperSource).toContain("remaining: null");
    expect(helperSource).toContain("isFreeTrial: false");
    expect(helperSource).toContain("allowed: true");
    expect(helperSource).not.toContain("insert into public.billing_usage_events");

    expect(planUpgradeSource).toContain("keeps live cycle usage and overage totals in billing cycle summaries");
  });
});
