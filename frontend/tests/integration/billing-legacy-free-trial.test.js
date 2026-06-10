const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function readMigrationByMarker(marker) {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  const migrationName = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .find((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8").includes(marker));

  return migrationName ? fs.readFileSync(path.join(migrationsDir, migrationName), "utf8") : "";
}

describe("legacy free trial provisioning", () => {
  test("backfills only legacy projects with members and zero subscriptions", () => {
    const migrationSource = readMigrationByMarker("legacy_free_trial_backfill");

    expect(migrationSource).toContain("billing_plans");
    expect(migrationSource).toContain("code = 'free_trial'");
    expect(migrationSource).toContain("from public.projects p");
    expect(migrationSource).toContain("exists (select 1 from public.project_members pm");
    expect(migrationSource).toContain("not exists (select 1 from public.billing_subscriptions bs");
    expect(migrationSource).toContain("billing_accounts");
    expect(migrationSource).toContain("billing_subscriptions");
    expect(migrationSource).toContain("billing_cycles");
    expect(migrationSource).toContain("billing_credit_wallets");
    expect(migrationSource).toContain("projects_notifications");
    expect(migrationSource).toContain("case when coalesce(fp.trial_days, 0) > 0 then 'trialing' else 'active' end as status");
    expect(migrationSource).toContain("gateway_provider");
    expect(migrationSource).toContain("'other'");
  });

  test("superadmin member creation provisionally creates free-trial billing when project has no subscription", () => {
    const functionSource = readIfExists("supabase/functions/admin-create-member/index.ts");

    expect(functionSource).toContain("ensureProjectFreeTrialBilling");
    expect(functionSource).toContain("FREE_PLAN_CODE");
    expect(functionSource).toContain("free_trial");
    expect(functionSource).toContain("billing_plans");
    expect(functionSource).toContain("billing_accounts");
    expect(functionSource).toContain("billing_subscriptions");
    expect(functionSource).toContain("billing_cycles");
    expect(functionSource).toContain("billing_credit_wallets");
    expect(functionSource).toContain("projects_notifications");
    expect(functionSource).toContain("legacy_admin_create_member");
    expect(functionSource).toContain("isDuplicateKeyError");
    expect(functionSource).toContain("23505");
  });

  test("project creation remains billing-free until a member is added", () => {
    const functionSource = readIfExists("supabase/functions/create-project/index.ts");

    expect(functionSource).not.toContain("ensureProjectFreeTrialBilling");
    expect(functionSource).not.toContain("billing_subscriptions");
    expect(functionSource).not.toContain("free_trial");
  });

  test("integration cleanup removes billing rows before deleting projects", () => {
    const fixturesSource = readIfExists("frontend/tests/integration/helpers/fixtures.js");

    expect(fixturesSource).toContain("[\"billing_usage_events\", byProject]");
    expect(fixturesSource).toContain("[\"billing_cycle_usage_summaries\", byProject]");
    expect(fixturesSource).toContain("[\"billing_cycles\", byProject]");
    expect(fixturesSource).toContain("[\"billing_subscription_changes\", byProject]");
    expect(fixturesSource).toContain("[\"billing_subscriptions\", byProject]");
    expect(fixturesSource).toContain("[\"billing_accounts\", byProject]");
    expect(fixturesSource).toContain("[\"billing_credit_wallets\", byProject]");
  });
});
