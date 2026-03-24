const { cleanupProjectData, provisionProjectAndOwner } = require("./helpers/fixtures.js");
const { invokeEdgeFunction } = require("./helpers/supabase.js");

describe("Edge Function admin-update-member", () => {
  let context = null;

  beforeAll(async () => {
    context = await provisionProjectAndOwner();
  });

  afterAll(async () => {
    if (!context?.project?.id) return;
    const errors = await cleanupProjectData(context.project.id, context.owner?.client);
    if (errors.length > 0) {
      console.warn("admin-update-member cleanup warnings:", errors.join(" | "));
    }
  });

  test("bloqueia atualização quando o caller não é superadmin", async () => {
    const { project, owner } = context;
    const response = await invokeEdgeFunction("admin-update-member", {
      body: {
        memberId: owner.user.id,
        projectId: project.id,
        role: "staff",
      },
      accessToken: owner.accessToken,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body?.error || response.text).toBeTruthy();

    const { data: memberRow, error } = await owner.client
      .from("project_members")
      .select("role")
      .eq("project_id", project.id)
      .eq("user_id", owner.user.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(memberRow?.role).toBe("owner");
  });
});
