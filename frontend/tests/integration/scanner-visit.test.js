const {
  cleanupProjectData,
  createPass,
  provisionProjectAndOwner,
} = require("./helpers/fixtures.js");
const { createServiceRoleClient, invokeEdgeFunction } = require("./helpers/supabase.js");

async function claimLatestUserPass({ pass, owner }) {
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

  expect([200, 500, 502]).toContain(claimResponse.status);

  const client = createServiceRoleClient() || owner.client;
  const { data: userPassRows, error: userPassError } = await client
    .from("user_passes")
    .select("id, pass_token, metadata")
    .eq("pass_id", pass.id)
    .order("created_at", { ascending: false })
    .limit(1);

  expect(userPassError).toBeNull();
  expect(Array.isArray(userPassRows)).toBe(true);
  expect(userPassRows.length).toBeGreaterThan(0);
  expect(userPassRows[0].pass_token).toBeTruthy();

  return userPassRows[0];
}

async function createReward({ client, projectId, name, pointsRequired }) {
  const { data, error } = await client
    .from("rewards")
    .insert({
      project_id: projectId,
      name,
      points_required: pointsRequired,
      notification_message: "Mensagem padrao de teste.",
      status: "active",
    })
    .select("id, name, points_required, status")
    .single();

  expect(error).toBeNull();
  expect(data?.id).toBeTruthy();
  return data;
}

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

  test("retorna recompensa disponivel quando pontos atingem exatamente o requisito", async () => {
    const { project, owner } = context;
    const rewardPass = (await createPass({
      projectId: project.id,
      title: "Passe Scanner Recompensa",
      description: "Passe para recompensa no scanner-visit",
      fields: { points: 0 },
      app_base_url: "https://integration.example.com",
    })).pass;

    const reward = await createReward({
      client: owner.client,
      projectId: project.id,
      name: "Bala",
      pointsRequired: 1,
    });

    const userPass = await claimLatestUserPass({ pass: rewardPass, owner });

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
    expect(scanResponse.body?.points).toBe(1);
    expect(scanResponse.body?.reward_available?.id).toBe(reward.id);
    expect(scanResponse.body?.reward_available?.name).toBe("Bala");
    expect(scanResponse.body?.notification_message).toContain("1 ponto");
    expect(scanResponse.body?.notification_message).toContain("Bala");
  });
});
