const {
  cleanupProjectData,
  createPass,
  provisionProjectAndOwner,
} = require("./helpers/fixtures.js");
const { invokeEdgeFunction } = require("./helpers/supabase.js");

describe("Edge Function update-pass", () => {
  let context = null;
  let pass = null;

  beforeAll(async () => {
    context = await provisionProjectAndOwner();
    const created = await createPass({
      projectId: context.project.id,
      title: "Passe Original",
      description: "Descrição original",
      fields: { points: 0 },
      app_base_url: "https://integration.example.com",
    });
    pass = created.pass;
  });

  afterAll(async () => {
    if (!context?.project?.id) return;
    const errors = await cleanupProjectData(context.project.id, context.owner?.client);
    if (errors.length > 0) {
      console.warn("update-pass cleanup warnings:", errors.join(" | "));
    }
  });

  test("atualiza título, descrição, fields e design do passe", async () => {
    const { project, owner } = context;

    const response = await invokeEdgeFunction("update-pass", {
      body: {
        project_id: project.id,
        pass_id: pass.id,
        pass_data: {
          pass_id: pass.id,
          project_id: project.id,
          title: "Passe Atualizado",
          description: "Descrição atualizada por teste",
          fields: {
            points: 5,
            tier: "gold",
          },
          design: {
            colors: { background: "#000000", label: "#ffffff", text: "#f0f0f0" },
            images: {},
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body?.ok).toBe(true);
    expect(response.body?.pass?.id).toBe(pass.id);
    expect(response.body?.pass?.wallet_revision).toBeGreaterThanOrEqual(2);
    expect(response.body?.sync?.mode).toBe("queued");
    expect(response.body?.sync?.total_jobs).toBe(0);

    const { data: passRow, error } = await owner.client
      .from("passes")
      .select("id, title, description, fields, design, wallet_revision")
      .eq("id", pass.id)
      .eq("project_id", project.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(passRow?.title).toBe("Passe Atualizado");
    expect(passRow?.description).toBe("Descrição atualizada por teste");
    expect(passRow?.fields?.points).toBe(5);
    expect(passRow?.fields?.tier).toBe("gold");
    expect(passRow?.design?.colors?.background).toBe("#000000");
    expect(passRow?.wallet_revision).toBeGreaterThanOrEqual(2);
  });
});
