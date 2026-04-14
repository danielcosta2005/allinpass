const {
  cleanupProjectData,
  createPass,
  provisionProjectAndOwner,
} = require("./helpers/fixtures.js");
const { invokeEdgeFunction } = require("./helpers/supabase.js");

describe("Edge Function universal-link", () => {
  let context = null;
  let pass = null;

  beforeAll(async () => {
    context = await provisionProjectAndOwner();
    const created = await createPass({
      projectId: context.project.id,
      title: "Passe Universal Link",
      description: "Validação da função universal-link",
      app_base_url: "https://integration.example.com",
    });
    pass = created.pass;
  });

  afterAll(async () => {
    if (!context?.project?.id) return;
    const errors = await cleanupProjectData(context.project.id, context.owner?.client);
    if (errors.length > 0) {
      console.warn("universal-link cleanup warnings:", errors.join(" | "));
    }
  });

  test("retorna 400 quando o parâmetro c não é enviado", async () => {
    const response = await invokeEdgeFunction("universal-link", {
      method: "GET",
      searchParams: { mode: "json" },
    });

    expect(response.status).toBe(400);
    expect(response.body?.error).toBe("missing_query_params");
  });

  test("com short_code válido cria/atualiza user_pass e responde com JSON estruturado", async () => {
    const { owner } = context;

    const response = await invokeEdgeFunction("universal-link", {
      method: "GET",
      accessToken: owner.accessToken,
      searchParams: {
        c: pass.short_code,
        mode: "json",
      },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
    });

    if (response.status === 200) {
      expect(response.body?.destination).toBeTruthy();
      expect(response.body?.passToken).toBeTruthy();
      expect(response.body?.claimed).toBe(true);
    } else {
      expect([500, 502]).toContain(response.status);
      expect(response.body?.error).toBeTruthy();
      expect(response.body?.message).toBeTruthy();
    }

    const { data: rows, error } = await owner.client
      .from("user_passes")
      .select("id, pass_id, user_id, pass_token")
      .eq("pass_id", pass.id)
      .eq("user_id", owner.user.id);

    expect(error).toBeNull();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.pass_token).toBeTruthy();
  });
});
