const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const migrationName = "20260721173935_promotional_codes_schema_rpcs.sql";

function readPromotionalCodeMigrations() {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  if (!fs.existsSync(migrationsDir)) return "";

  const migrationPath = path.join(migrationsDir, migrationName);
  return fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";
}

function functionSection(source, functionName) {
  const start = source.indexOf(`create or replace function public.${functionName}`);
  if (start === -1) return "";

  const end = source.indexOf("\n$$;", start);
  return end === -1 ? source.slice(start) : source.slice(start, end + 4);
}

describe("promotional codes schema and RPCs", () => {
  test("ships the canonical promotional-code tables and checkout audit columns", () => {
    const migrationSource = readPromotionalCodeMigrations();

    expect(migrationSource).toContain("create table if not exists public.billing_promotional_codes");
    expect(migrationSource).toContain("create table if not exists public.billing_promotional_code_redemptions");
    expect(migrationSource).toContain("create table if not exists public.billing_promotional_code_migration_issues");
    expect(migrationSource).toContain("create table if not exists public.payment_provider_requests");
    expect(migrationSource).toContain("create table if not exists public.affiliate_commission_reversals");
    expect(migrationSource).toContain("alter table public.signup_checkout_sessions");
    expect(migrationSource).toContain("promo_code_id");
    expect(migrationSource).toContain("promo_redemption_id");
    expect(migrationSource).toContain("references public.billing_promotional_codes(id)");
    expect(migrationSource).toContain("references public.billing_promotional_code_redemptions(id)");
  });

  test("constrains promotional code format, bps values, and lifecycle statuses", () => {
    const migrationSource = readPromotionalCodeMigrations();

    expect(migrationSource).toContain("code text not null");
    expect(migrationSource).toContain("billing_promotional_codes_code_format");
    expect(migrationSource).toContain("^[a-z0-9]{5,10}$");
    expect(migrationSource).toContain("billing_promotional_codes_lower_code_uidx");
    expect(migrationSource).toContain("discount_bps integer not null");
    expect(migrationSource).toContain("commission_bps integer not null");
    expect(migrationSource).toContain("billing_promotional_codes_discount_bps_check");
    expect(migrationSource).toContain("billing_promotional_codes_commission_bps_check");
    expect(migrationSource).toContain("10000");
    expect(migrationSource).toContain("billing_promotional_codes_status_check");
    expect(migrationSource).toContain("billing_promotional_code_redemptions_status_check");
    expect(migrationSource).toContain("status = 'reserved'");
    expect(migrationSource).toContain("redeemed_at is null");
    expect(migrationSource).toContain("released_at is null");
    expect(migrationSource).toContain("'active'");
    expect(migrationSource).toContain("'inactive'");
    expect(migrationSource).toContain("'reserved'");
    expect(migrationSource).toContain("'confirmed'");
    expect(migrationSource).toContain("'released'");
  });

  test("enables RLS and keeps direct table access restricted to service role", () => {
    const migrationSource = readPromotionalCodeMigrations();

    [
      "billing_promotional_codes",
      "billing_promotional_code_redemptions",
      "billing_promotional_code_migration_issues",
      "payment_provider_requests",
      "affiliate_commission_reversals",
    ].forEach((tableName) => {
      expect(migrationSource).toContain(`alter table public.${tableName} enable row level security`);
      expect(migrationSource).toContain(`revoke all on table public.${tableName} from anon`);
      expect(migrationSource).toContain(`revoke all on table public.${tableName} from authenticated`);
      expect(migrationSource).toContain(`grant all on table public.${tableName} to service_role`);
    });

    expect(migrationSource).not.toContain("grant insert on table public.billing_promotional_codes to anon");
    expect(migrationSource).not.toContain("grant insert on table public.billing_promotional_codes to authenticated");
    expect(migrationSource).not.toContain("grant update on table public.billing_promotional_codes to anon");
    expect(migrationSource).not.toContain("grant update on table public.billing_promotional_codes to authenticated");
  });

  test("defines service-role-only RPCs with secure definer search path", () => {
    const migrationSource = readPromotionalCodeMigrations();

    [
      ["resolve_public_promotional_code", "public.resolve_public_promotional_code(text)"],
      "reserve_promotional_code",
      "confirm_promotional_code_redemption",
      "release_promotional_code_redemption",
    ].forEach((entry) => {
      const functionName = Array.isArray(entry) ? entry[0] : entry;
      const functionGrant = Array.isArray(entry) ? entry[1] : `public.${functionName}`;
      const section = functionSection(migrationSource, functionName);

      expect(migrationSource).toContain(`create or replace function public.${functionName}`);
      expect(migrationSource).toContain(`revoke execute on function ${functionGrant}`);
      expect(migrationSource).toContain(`grant execute on function ${functionGrant}`);
      expect(section).toContain("security definer");
      expect(section).toContain("set search_path = ''");
    });

    expect(migrationSource).toContain("reserved");
    expect(migrationSource).toContain("confirmed");
    expect(migrationSource).toContain("released");
    expect(migrationSource).toContain("max_uses");
    expect(migrationSource).toContain("expires_at");
  });

  test("backfills legacy affiliate links as 10 percent coupons and logs migration issues", () => {
    const migrationSource = readPromotionalCodeMigrations();

    expect(migrationSource).toContain("from public.affiliate_links");
    expect(migrationSource).toContain("public.affiliate_sellers");
    expect(migrationSource).toContain("insert into public.billing_promotional_codes");
    expect(migrationSource).toContain("discount_bps");
    expect(migrationSource).toContain("commission_bps");
    expect(migrationSource).toContain("1000");
    expect(migrationSource).toContain("insert into public.billing_promotional_code_migration_issues");
    expect(migrationSource).toContain("existing_code_conflict");
    expect(migrationSource).toContain("existing_seller_conflict");
    expect(migrationSource).toContain("existing_link_conflict");
    expect(migrationSource).toContain("affiliate_link_id");
    expect(migrationSource).toContain("issue_code");
    expect(migrationSource).toContain("issue_message");
    expect(migrationSource).toContain("^[a-z0-9]{5,10}$");
  });

  test("adds idempotency and reversal guardrails for provider and commission operations", () => {
    const migrationSource = readPromotionalCodeMigrations();

    expect(migrationSource).toContain("checkout_session_id");
    expect(migrationSource).toContain("operation");
    expect(migrationSource).toContain("payment_provider_requests_checkout_operation_uidx");
    expect(migrationSource).toContain("commission_id");
    expect(migrationSource).toContain("provider_event_id");
    expect(migrationSource).toContain("affiliate_commission_reversals_commission_event_uidx");
    expect(migrationSource).toContain("trg_guard_affiliate_commission_reversals");
    expect(migrationSource).toContain("commission reversal exceeds original commission");
    expect(migrationSource).toContain("trg_guard_signup_checkout_promotional_refs");
    expect(migrationSource).toContain("promo_redemption_id does not belong to this checkout session");
    expect(migrationSource).toContain("promo_release_reason");
    expect(migrationSource).toContain("invalid_expiration");
    expect(migrationSource).toContain("invalid_provider_payment");
  });
});
