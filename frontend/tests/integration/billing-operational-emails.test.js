const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readMigrationSources() {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");
}

describe("billing operational emails", () => {
  test("enqueues usage threshold and overage emails from billing cycle summaries", () => {
    const migrationSources = readMigrationSources();

    expect(migrationSources).toContain("create or replace function public.enqueue_billing_usage_operational_email");
    expect(migrationSources).toContain("create or replace function public.trg_enqueue_billing_usage_operational_emails");
    expect(migrationSources).toContain("drop trigger if exists trg_enqueue_billing_usage_operational_emails on public.billing_cycle_usage_summaries");
    expect(migrationSources).toContain("after insert or update of pass_install_quantity, notification_sent_quantity, included_pass_installs, included_notification_sends, overage_pass_install_cents, overage_notification_sent_cents");
    expect(migrationSources).toContain("v_thresholds integer[] := array[50, 75, 90]");
    expect(migrationSources).toContain("billing_usage_threshold_reached");
    expect(migrationSources).toContain("billing_usage_overage_started");
    expect(migrationSources).toContain("pass_install_quantity");
    expect(migrationSources).toContain("notification_sent_quantity");
    expect(migrationSources).toContain("included_pass_installs");
    expect(migrationSources).toContain("included_notification_sends");
    expect(migrationSources).toContain("overage_pass_install_cents");
    expect(migrationSources).toContain("overage_notification_sent_cents");
    expect(migrationSources).toContain("previous_usage_percent < v_threshold");
    expect(migrationSources).toContain("current_usage_percent >= v_threshold");
    expect(migrationSources).toContain("previous_quantity <= included_quantity");
    expect(migrationSources).toContain("current_quantity > included_quantity");
    expect(migrationSources).toContain("'billing_usage_threshold:' || p_summary_id::text");
    expect(migrationSources).toContain("'billing_usage_overage:' || p_summary_id::text");
  });

  test("enqueues delinquency warning and suspension emails from subscription status changes", () => {
    const migrationSources = readMigrationSources();

    expect(migrationSources).toContain("create or replace function public.enqueue_billing_subscription_status_operational_email");
    expect(migrationSources).toContain("create or replace function public.trg_enqueue_billing_subscription_status_operational_emails");
    expect(migrationSources).toContain("drop trigger if exists trg_enqueue_billing_subscription_status_operational_emails on public.billing_subscriptions");
    expect(migrationSources).toContain("after update of status, grace_ends_at, suspended_at, delinquency_gateway_charge_id");
    expect(migrationSources).toContain("new.status = 'past_due'");
    expect(migrationSources).toContain("new.status = 'suspended'");
    expect(migrationSources).toContain("billing_subscription_past_due");
    expect(migrationSources).toContain("billing_subscription_suspended");
    expect(migrationSources).toContain("10 dias");
    expect(migrationSources).toContain("grace_ends_at");
    expect(migrationSources).toContain("suspended_at");
    expect(migrationSources).toContain("'billing_subscription_status:' || p_subscription_id::text");
  });

  test("uses project owner recipients with billing email fallback and idempotent email keys", () => {
    const migrationSources = readMigrationSources();

    expect(migrationSources).toContain("join public.project_members pm");
    expect(migrationSources).toContain("pm.role = 'owner'");
    expect(migrationSources).toContain("join auth.users u");
    expect(migrationSources).toContain("lower(btrim(u.email)) as to_email");
    expect(migrationSources).toContain("fallback_recipients");
    expect(migrationSources).toContain("ba.billing_email");
    expect(migrationSources).toContain("public.enqueue_operational_email");
    expect(migrationSources).toContain("p_to_email := r.to_email");
    expect(migrationSources).toContain("p_to_name := r.to_name");
    expect(migrationSources).toContain("md5(r.to_email)");
    expect(migrationSources).toContain("recipient_source");
    expect(migrationSources).toContain("p_metadata := jsonb_build_object");
    expect(migrationSources).toContain("p_provider := 'resend'");
    expect(migrationSources).toContain("p_next_attempt_at := now()");
  });
});
