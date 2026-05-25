const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

describe("signup-precheck auth source", () => {
  test("classifies existing signup accounts through an auth.users-backed role RPC", () => {
    const functionSource = fs.readFileSync(
      path.join(repoRoot, "supabase/functions/signup-precheck/index.ts"),
      "utf8"
    );

    expect(functionSource).toContain("signup_precheck_auth_account_status");
    expect(functionSource).toContain("existing_customer");
    expect(functionSource).toContain("existing_establishment");
    expect(functionSource).not.toContain('.from("profiles")\n      .select("id")\n      .eq("email", email)');
  });

  test("ships database repair for profile emails and future auth trigger rows", () => {
    const migrationsDir = path.join(repoRoot, "supabase/migrations");
    const migrationSources = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    expect(migrationSources).toContain("signup_precheck_auth_account_status");
    expect(migrationSources).toContain("public.profiles p");
    expect(migrationSources).toContain("p.role = 'customer'");
    expect(migrationSources).toContain("drop function if exists public.signup_precheck_auth_email_exists(text)");
    expect(migrationSources).toContain("update public.profiles");
    expect(migrationSources).toContain("lower(new.email)");
  });
});
