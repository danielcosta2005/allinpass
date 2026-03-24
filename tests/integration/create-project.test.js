const {
  cleanupProjectData,
  provisionProjectAndOwner,
  UUID_REGEX,
} = require("./helpers/fixtures.js");

describe("Edge Function create-project", () => {
  let context = null;

  afterAll(async () => {
    if (!context?.project?.id) return;
    const errors = await cleanupProjectData(context.project.id, context.owner?.client);
    if (errors.length > 0) {
      console.warn("create-project cleanup warnings:", errors.join(" | "));
    }
  });

  test("cria projeto, template padrão e permite leitura pelo membro owner", async () => {
    context = await provisionProjectAndOwner();
    const { project, owner } = context;

    expect(project.id).toMatch(UUID_REGEX);
    expect(project.slug).toBeTruthy();
    expect(project.name).toBeTruthy();

    const { data: projectRow, error: projectError } = await owner.client
      .from("projects")
      .select("id, slug, name, auth_mode")
      .eq("id", project.id)
      .maybeSingle();

    expect(projectError).toBeNull();
    expect(projectRow?.id).toBe(project.id);
    expect(projectRow?.slug).toBe(project.slug);

    const { data: templateRow, error: templateError } = await owner.client
      .from("wallet_templates")
      .select("project_id, defaults")
      .eq("project_id", project.id)
      .maybeSingle();

    expect(templateError).toBeNull();
    expect(templateRow?.project_id).toBe(project.id);
    expect(templateRow?.defaults).toBeTruthy();
  });
});
