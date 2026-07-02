const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function readAffiliateSellerMigrations() {
  const migrationsDir = path.join(repoRoot, "supabase/migrations");
  if (!fs.existsSync(migrationsDir)) return "";

  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql") && name.includes("affiliate_program_sellers"))
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n");
}

describe("affiliate seller foundation", () => {
  test("ships a constrained affiliate_sellers table with RLS enabled", () => {
    const migrationSource = readAffiliateSellerMigrations();

    expect(migrationSource).toContain("create table if not exists public.affiliate_sellers");
    expect(migrationSource).toContain("pix_key text not null");
    expect(migrationSource).toContain("created_by uuid references public.profiles(id) on delete set null");
    expect(migrationSource).toContain("updated_by uuid references public.profiles(id) on delete set null");
    expect(migrationSource).toContain("status text not null default 'active'");
    expect(migrationSource).toContain("affiliate_sellers_name_not_blank");
    expect(migrationSource).toContain("affiliate_sellers_contact_not_blank");
    expect(migrationSource).toContain("affiliate_sellers_pix_key_not_blank");
    expect(migrationSource).toContain("affiliate_sellers_status_check");
    expect(migrationSource).toContain("alter table public.affiliate_sellers enable row level security");
    expect(migrationSource).toContain("trg_affiliate_sellers_updated_at");
    expect(migrationSource).toContain("public.set_updated_at()");
  });

  test("restricts affiliate sellers to superadmins without auth.role policies", () => {
    const migrationSource = readAffiliateSellerMigrations();

    expect(migrationSource).toContain("revoke all on table public.affiliate_sellers from anon");
    expect(migrationSource).toContain("grant select, insert, update, delete on table public.affiliate_sellers to authenticated");
    expect(migrationSource).toContain("grant all on table public.affiliate_sellers to service_role");
    expect(migrationSource).toContain("affiliate_sellers_superadmin_select");
    expect(migrationSource).toContain("affiliate_sellers_superadmin_insert");
    expect(migrationSource).toContain("affiliate_sellers_superadmin_update");
    expect(migrationSource).toContain("affiliate_sellers_superadmin_delete");
    expect(migrationSource).toContain("to authenticated");
    expect(migrationSource).toContain("(select public.is_superadmin())");
    expect(migrationSource).not.toContain("auth.role()");
  });

  test("registers affiliate-admin as a JWT-protected Edge Function", () => {
    const configSource = fs.readFileSync(path.join(repoRoot, "supabase/config.toml"), "utf8");

    expect(configSource).toContain("[functions.affiliate-admin]");
    expect(configSource).toContain("verify_jwt = true");
    expect(configSource).toContain('entrypoint = "./functions/affiliate-admin/index.ts"');
  });

  test("affiliate-admin validates superadmin callers and creates sellers", () => {
    const functionSource = readIfExists(
      path.join(repoRoot, "supabase/functions/affiliate-admin/index.ts"),
    );

    expect(functionSource).toContain("auth.getUser");
    expect(functionSource).toContain(".from(\"profiles\")");
    expect(functionSource).toContain(".select(\"role\")");
    expect(functionSource).toContain("ensureSuperadmin");
    expect(functionSource).toContain("AFFILIATE_FORBIDDEN");
    expect(functionSource).toContain("createSeller");
    expect(functionSource).toContain("AFFILIATE_UNKNOWN_ACTION");
    expect(functionSource).toContain("AFFILIATE_VALIDATION_ERROR");
    expect(functionSource).toContain("name.trim()");
    expect(functionSource).toContain("contact.trim()");
    expect(functionSource).toContain("pixKey.trim()");
    expect(functionSource).toContain(".from(\"affiliate_sellers\")");
    expect(functionSource).toContain("created_by");
    expect(functionSource).toContain("updated_by");
    expect(functionSource).toContain("pixKey: seller.pix_key");
    expect(functionSource).not.toContain("serviceRoleKey:");
    expect(functionSource).not.toContain("SERVICE_ROLE_KEY:");
  });

  test("frontend exposes a camelCase createAffiliateSeller helper", () => {
    const helperSource = readIfExists(path.join(repoRoot, "frontend/src/lib/affiliates.js"));

    expect(helperSource).toContain("createAffiliateSeller");
    expect(helperSource).toContain("affiliate-admin");
    expect(helperSource).toContain("action: 'createSeller'");
    expect(helperSource).toContain("pixKey");
    expect(helperSource).toContain("supabase.functions.invoke");
  });
});
