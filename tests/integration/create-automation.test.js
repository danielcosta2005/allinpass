const { cleanupProjectData, provisionProjectAndOwner } = require("./helpers/fixtures.js");
const { invokeEdgeFunction } = require("./helpers/supabase.js");

describe("Edge Function create-automation", () => {
  let context = null;

  beforeAll(async () => {
    context = await provisionProjectAndOwner();
  });

  afterAll(async () => {
    if (!context?.project?.id) return;
    const errors = await cleanupProjectData(context.project.id, context.owner?.client);
    if (errors.length > 0) {
      console.warn("create-automation cleanup warnings:", errors.join(" | "));
    }
  });

  test("cria automação autenticada para projeto do membro owner", async () => {
    const { project, owner } = context;

    const response = await invokeEdgeFunction("create-automation", {
      accessToken: owner.accessToken,
      body: {
        project_id: project.id,
        type: "points_wallet",
        quantity: 15,
        message: "Você atingiu 15 pontos!",
        status: "on",
      },
    });

    expect(response.status).toBe(200);
    expect(response.body?.success).toBe(true);
    expect(response.body?.automation?.project_id).toBe(project.id);

    const automationId = response.body?.automation?.id;
    const { data: row, error } = await owner.client
      .from("automations")
      .select("id, project_id, type, quantity, message, status")
      .eq("id", automationId)
      .eq("project_id", project.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(row?.type).toBe("points_wallet");
    expect(Number(row?.quantity)).toBe(15);
    expect(row?.status).toBe("on");
  });

  test("retorna 401 sem Authorization", async () => {
    const response = await invokeEdgeFunction("create-automation", {
      headers: { Authorization: "" },
      body: {
        project_id: context.project.id,
        type: "points_wallet",
        quantity: 10,
        message: "Teste sem auth",
      },
    });

    expect(response.status).toBe(401);
    expect(response.body?.error).toBeTruthy();
  });
});
