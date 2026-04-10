const {
  cleanupProjectData,
  createMember,
  createProject,
  randomEmail,
  randomPassword,
  UUID_REGEX,
} = require("./helpers/fixtures.js");
const { signInWithPassword } = require("./helpers/supabase.js");

describe("Edge Function admin-create-member", () => {
  let projectId = null;
  let ownerClient = null;

  beforeAll(async () => {
    const { project } = await createProject();
    projectId = project.id;
  });

  afterAll(async () => {
    if (!projectId) return;
    const errors = await cleanupProjectData(projectId, ownerClient);
    if (errors.length > 0) {
      console.warn("admin-create-member cleanup warnings:", errors.join(" | "));
    }
  });

  test("cria membro owner e permite login com email/senha", async () => {
    const email = randomEmail("owner-admin-create");
    const password = randomPassword("Owner");

    const { result, userId } = await createMember({
      projectId,
      role: "owner",
      email,
      password,
    });

    expect(result.status).toBe(200);
    expect(userId).toMatch(UUID_REGEX);

    const auth = await signInWithPassword(email, password);
    ownerClient = auth.client;

    const { data: memberRow, error: memberError } = await ownerClient
      .from("project_members")
      .select("project_id, user_id, role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();

    expect(memberError).toBeNull();
    expect(memberRow?.project_id).toBe(projectId);
    expect(memberRow?.user_id).toBe(userId);
    expect(memberRow?.role).toBe("owner");
  });
});
