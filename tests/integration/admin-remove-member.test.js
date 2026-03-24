const { cleanupProjectData, provisionProjectAndOwner } = require("./helpers/fixtures.js");
const { invokeEdgeFunction } = require("./helpers/supabase.js");

describe("Edge Function admin-remove-member", () => {
  let context = null;

  beforeAll(async () => {
    context = await provisionProjectAndOwner();
  });

  afterAll(async () => {
    if (!context?.project?.id) return;
    const errors = await cleanupProjectData(context.project.id, context.owner?.client);
    if (errors.length > 0) {
      console.warn("admin-remove-member cleanup warnings:", errors.join(" | "));
    }
  });

  test("retorna forbidden para usuário autenticado que não é superadmin", async () => {
    const { project, owner } = context;

    const response = await invokeEdgeFunction("admin-remove-member", {
      body: {
        memberId: owner.user.id,
        projectId: project.id,
      },
      accessToken: owner.accessToken,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body?.error || response.text).toBeTruthy();

    const { data: memberRow, error } = await owner.client
      .from("project_members")
      .select("project_id, user_id, role")
      .eq("project_id", project.id)
      .eq("user_id", owner.user.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(memberRow?.user_id).toBe(owner.user.id);
  });
});
