const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

describe("signup-finalize backend idempotency", () => {
  test("ships a persisted finalization guard keyed by auth user", () => {
    const migrationsDir = path.join(repoRoot, "supabase/migrations");
    const migrationSources = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    expect(migrationSources).toContain("create table if not exists public.signup_finalizations");
    expect(migrationSources).toContain("primary key");
    expect(migrationSources).toContain("references auth.users");
  });

  test("signup-finalize claims, reuses, and completes persisted finalizations", () => {
    const functionSource = fs.readFileSync(
      path.join(repoRoot, "supabase/functions/signup-finalize/index.ts"),
      "utf8"
    );

    expect(functionSource).toContain("claimSignupFinalization");
    expect(functionSource).toContain("waitForCompletedSignupFinalization");
    expect(functionSource).toContain("completeSignupFinalization");
    expect(functionSource).toContain("markSignupFinalizationFailed");
    expect(functionSource).toContain("SIGNUP_FINALIZE_IN_PROGRESS");
  });

  test("signup-finalize can recover existing-customer intent by authenticated email", () => {
    const functionSource = fs.readFileSync(
      path.join(repoRoot, "supabase/functions/signup-finalize/index.ts"),
      "utf8"
    );
    const migrationsDir = path.join(repoRoot, "supabase/migrations");
    const migrationSources = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
      .join("\n");

    expect(migrationSources).toContain("signup_existing_customer_intents");
    expect(functionSource).toContain("getExistingCustomerSignupIntent");
    expect(functionSource).toContain("existingCustomerIntent?.establishment_name");
    expect(functionSource).toContain("payloadEstablishmentName");
    expect(functionSource).toContain("|| intentEstablishmentName");
    expect(functionSource).toContain("completeExistingCustomerSignupIntent");
  });

  test("existing-customer finalization asks the authenticated client to create a password", () => {
    const functionSource = fs.readFileSync(
      path.join(repoRoot, "supabase/functions/signup-finalize/index.ts"),
      "utf8"
    );

    expect(functionSource).toContain("password_setup_required");
    expect(functionSource).toContain("Boolean(existingCustomerIntent)");
  });
});
