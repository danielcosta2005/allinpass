const {
  cleanupProjectData,
  createPass,
  provisionProjectAndOwner,
  UUID_REGEX,
} = require("./helpers/fixtures.js");

describe("Edge Function create-pass", () => {
  let context = null;

  beforeAll(async () => {
    context = await provisionProjectAndOwner();
  });

  afterAll(async () => {
    if (!context?.project?.id) return;
    const errors = await cleanupProjectData(context.project.id, context.owner?.client);
    if (errors.length > 0) {
      console.warn("create-pass cleanup warnings:", errors.join(" | "));
    }
  });

  test("gera passe e persiste registro na tabela passes", async () => {
    const { project, owner } = context;

    const { result, pass } = await createPass({
      projectId: project.id,
      title: "Passe Integracao Create",
      description: "Criado por teste automatizado",
      fields: { points: 0, level: "bronze" },
      app_base_url: "https://integration.example.com",
    });

    expect(result.status).toBe(200);
    expect(pass.id).toMatch(UUID_REGEX);
    expect(pass.short_code).toBeTruthy();
    expect(pass.qr_url).toContain(`/claim/${pass.short_code}`);

    const { data: passRow, error } = await owner.client
      .from("passes")
      .select("id, project_id, title, description, qr_url")
      .eq("id", pass.id)
      .eq("project_id", project.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(passRow?.id).toBe(pass.id);
    expect(passRow?.title).toBe("Passe Integracao Create");
    expect(passRow?.qr_url).toBe(pass.qr_url);
  });
});
