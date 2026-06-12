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

describe("trial expiration email outbox", () => {
  test("creates a service-role-only email outbox with enqueue and claim RPCs", () => {
    const migrationSources = readMigrationSources();

    expect(migrationSources).toContain("create table if not exists public.email_outbox");
    expect(migrationSources).toContain("status in ('pending', 'processing', 'sent', 'failed')");
    expect(migrationSources).toContain("idempotency_key text not null");
    expect(migrationSources).toContain("unique (idempotency_key)");
    expect(migrationSources).toContain("alter table public.email_outbox enable row level security");
    expect(migrationSources).toContain("revoke all on table public.email_outbox from authenticated");
    expect(migrationSources).toContain("grant select, insert, update, delete on table public.email_outbox to service_role");
    expect(migrationSources).toContain("create or replace function public.enqueue_operational_email");
    expect(migrationSources).toContain("insert into public.email_outbox");
    expect(migrationSources).toContain("return v_email_id");
    expect(migrationSources).toContain("grant execute on function public.enqueue_operational_email");
    expect(migrationSources).toContain("create or replace function public.claim_email_outbox_jobs");
    expect(migrationSources).toContain("for update skip locked");
    expect(migrationSources).toContain("grant execute on function public.claim_email_outbox_jobs(integer, text, integer) to service_role");
  });

  test("enqueues trial-expired emails for owners with billing email fallback", () => {
    const migrationSources = readMigrationSources();

    expect(migrationSources).toContain("create or replace function public.expire_trial_subscriptions()");
    expect(migrationSources).toContain("set status = 'expired'");
    expect(migrationSources).toContain("bp.code = 'free_trial'");
    expect(migrationSources).toContain("join auth.users u");
    expect(migrationSources).toContain("pm.role = 'owner'");
    expect(migrationSources).toContain("fallback_recipients");
    expect(migrationSources).toContain("ba.billing_email");
    expect(migrationSources).toContain("'trial_expired'");
    expect(migrationSources).toContain("email_enqueue_rows");
    expect(migrationSources).toContain("public.enqueue_operational_email");
    expect(migrationSources).toContain("p_event_type := 'trial_expired'");
    expect(migrationSources).toContain("'Seu free trial do AllinPass terminou'");
    expect(migrationSources).toContain("#9333EA");
    expect(migrationSources).toContain("#4F46E5");
    expect(migrationSources).toContain("Free trial encerrado");
    expect(migrationSources).toContain("AllinPass");
    expect(migrationSources).toContain("{{app_org_url}}");
    expect(migrationSources).toContain("on conflict (idempotency_key) do nothing");
    expect(migrationSources).toContain("select expired_count");
  });

  test("schedules the internal dispatcher through pg_net and Supabase Vault", () => {
    const migrationSources = readMigrationSources();
    const configSource = readIfExists("supabase/config.toml");

    expect(configSource).toContain("[functions.send-email]");
    expect(configSource).toContain("verify_jwt = false");
    expect(configSource).toContain('entrypoint = "./functions/send-email/index.ts"');
    expect(migrationSources).toContain("'email-dispatcher'");
    expect(migrationSources).toContain("net.http_post");
    expect(migrationSources).toContain("vault.decrypted_secrets");
    expect(migrationSources).toContain("name = 'project_url'");
    expect(migrationSources).toContain("name = 'email_dispatch_secret'");
    expect(migrationSources).toContain("'/functions/v1/send-email'");
  });

  test("send-email dispatches only claimed outbox jobs through Resend", () => {
    const functionSource = readIfExists("supabase/functions/send-email/index.ts");

    expect(functionSource).toContain("RESEND_API_KEY");
    expect(functionSource).toContain("RESEND_FROM_EMAIL");
    expect(functionSource).toContain("EMAIL_DISPATCH_SECRET");
    expect(functionSource).toContain("APP_BASE_URL");
    expect(functionSource).toContain("https://api.resend.com/emails");
    expect(functionSource).toContain("Authorization");
    expect(functionSource).toContain("Idempotency-Key");
    expect(functionSource).toContain("claim_email_outbox_jobs");
    expect(functionSource).toContain(".from(\"email_outbox\")");
    expect(functionSource).toContain("status: \"sent\"");
    expect(functionSource).toContain("status: exhausted ? \"failed\" : \"pending\"");
    expect(functionSource).toContain("Unsupported email provider");
    expect(functionSource).toContain("processed: jobs.length");
  });
});
