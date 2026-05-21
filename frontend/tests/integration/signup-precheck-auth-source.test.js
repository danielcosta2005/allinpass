const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

describe("signup-precheck auth source", () => {
  test("checks existing signup accounts through an auth.users-backed RPC", () => {
    const functionSource = fs.readFileSync(
      path.join(repoRoot, "supabase/functions/signup-precheck/index.ts"),
      "utf8"
    );

    expect(functionSource).toContain("signup_precheck_auth_email_exists");
    expect(functionSource).not.toContain('.from("profiles")\n      .select("id")\n      .eq("email", email)');
  });

  test("ships database repair for profile emails and future auth trigger rows", () => {
    const migrationsDir = path.join(repoRoot, "supabase/migrations");
    const migrationSources = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    expect(migrationSources).toContain("signup_precheck_auth_email_exists");
    expect(migrationSources).toContain("update public.profiles");
    expect(migrationSources).toContain("lower(new.email)");
  });
});
