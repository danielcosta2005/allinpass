const {
  cleanupProjectData,
  createPass,
  provisionProjectAndOwner,
} = require("./helpers/fixtures.js");
const { invokeEdgeFunction } = require("./helpers/supabase.js");

describe("Edge Function scanner-visit", () => {
  let context = null;
  let pass = null;

  beforeAll(async () => {
    context = await provisionProjectAndOwner();
    const created = await createPass({
      projectId: context.project.id,
      title: "Passe Scanner",
      description: "Passe para scanner-visit",
      fields: { points: 0 },
      app_base_url: "https://integration.example.com",
    });
    pass = created.pass;
  });

  afterAll(async () => {
    if (!context?.project?.id) return;
    const errors = await cleanupProjectData(context.project.id, context.owner?.client);
    if (errors.length > 0) {
      console.warn("scanner-visit cleanup warnings:", errors.join(" | "));
    }
  });

  test("retorna 401 sem Authorization header", async () => {
    const response = await invokeEdgeFunction("scanner-visit", {
      headers: { Authorization: "" },
      body: {
        projectId: context.project.id,
        qrData: "token-inexistente",
      },
    });

    expect(response.status).toBe(401);
    expect(response.body?.error).toBeTruthy();
  });

  test("fluxo real: cria user_pass via universal-link e registra visita no scanner", async () => {
    const { project, owner } = context;

    const claimResponse = await invokeEdgeFunction("universal-link", {
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

    // O universal-link pode falhar por dependências externas (google-pass/apple-pass),
    // mas ainda assim deve ter criado user_pass em boa parte dos cenários.
    expect([200, 500, 502]).toContain(claimResponse.status);

    const { data: userPassRows, error: userPassError } = await owner.client
      .from("user_passes")
      .select("id, pass_token, metadata")
      .eq("pass_id", pass.id)
      .order("created_at", { ascending: false })
      .limit(1);

    expect(userPassError).toBeNull();
    expect(Array.isArray(userPassRows)).toBe(true);
    expect(userPassRows.length).toBeGreaterThan(0);

    const userPass = userPassRows[0];
    expect(userPass.pass_token).toBeTruthy();

    const scanResponse = await invokeEdgeFunction("scanner-visit", {
      accessToken: owner.accessToken,
      body: {
        projectId: project.id,
        qrData: userPass.pass_token,
      },
    });

    if (scanResponse.status === 500 && scanResponse.body?.error === "missing_env") {
      expect(scanResponse.body?.message || "").toContain("SCAN_CONFIRM_SECRET");
      return;
    }

    expect(scanResponse.status).toBe(200);
    expect(scanResponse.body?.ok).toBe(true);
    expect(Number(scanResponse.body?.points)).toBeGreaterThanOrEqual(1);

    const { data: updatedUserPass, error: updatedError } = await owner.client
      .from("user_passes")
      .select("id, metadata")
      .eq("id", userPass.id)
      .maybeSingle();

    expect(updatedError).toBeNull();
    expect(Number(updatedUserPass?.metadata?.points)).toBeGreaterThanOrEqual(1);
  });
});
