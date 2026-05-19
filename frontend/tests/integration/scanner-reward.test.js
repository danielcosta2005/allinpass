const {
  cleanupProjectData,
  createPass,
  provisionProjectAndOwner,
} = require("./helpers/fixtures.js");
const { createServiceRoleClient, invokeEdgeFunction } = require("./helpers/supabase.js");

async function createClaimedUserPass({ pass, owner, points }) {
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

  const userPass = userPassRows[0];
  const { error: updateError } = await client
    .from("user_passes")
    .update({ metadata: { ...(userPass.metadata || {}), points } })
    .eq("id", userPass.id);

  expect(updateError).toBeNull();

  return { ...userPass, metadata: { ...(userPass.metadata || {}), points } };
}

async function createReward({ client, projectId, name, pointsRequired, message }) {
  const { data, error } = await client
    .from("rewards")
    .insert({
      project_id: projectId,
      name,
      points_required: pointsRequired,
      notification_message: message,
      status: "active",
    })
    .select("id, project_id, name, points_required, notification_message, status")
    .single();

  expect(error).toBeNull();
  expect(data?.id).toBeTruthy();
  return data;
}

describe("Edge Function scanner-reward", () => {
  let context = null;
  let otherContext = null;
  let pass = null;
  let otherPass = null;

  beforeAll(async () => {
    context = await provisionProjectAndOwner();
    otherContext = await provisionProjectAndOwner();

    const created = await createPass({
      projectId: context.project.id,
      title: "Passe Recompensa",
      description: "Passe para scanner-reward",
      fields: { points: 0 },
      app_base_url: "https://integration.example.com",
    });
    pass = created.pass;

    const otherCreated = await createPass({
      projectId: otherContext.project.id,
      title: "Passe Outro Projeto",
      description: "Passe para validar wrong_project",
      fields: { points: 0 },
      app_base_url: "https://integration.example.com",
    });
    otherPass = otherCreated.pass;
  });

  afterAll(async () => {
    const errors = [];
    if (context?.project?.id) {
      errors.push(...(await cleanupProjectData(context.project.id, context.owner?.client)));
    }
    if (otherContext?.project?.id) {
      errors.push(...(await cleanupProjectData(otherContext.project.id, otherContext.owner?.client)));
    }
    if (errors.length > 0) {
      console.warn("scanner-reward cleanup warnings:", errors.join(" | "));
    }
  });

  test("debita pontos, registra resgate e retorna notification_id ou aviso", async () => {
    const { project, owner } = context;
    const userPass = await createClaimedUserPass({ pass, owner, points: 12 });
    const reward = await createReward({
      client: owner.client,
      projectId: project.id,
      name: "Cafe gratis",
      pointsRequired: 5,
      message: "Voce resgatou um cafe gratis.",
    });

    const response = await invokeEdgeFunction("scanner-reward", {
      accessToken: owner.accessToken,
      body: {
        projectId: project.id,
        rewardId: reward.id,
        qrData: userPass.pass_token,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body?.ok).toBe(true);
    expect(response.body?.redemption_id).toBeTruthy();
    expect(response.body?.points_before).toBe(12);
    expect(response.body?.points_after).toBe(7);

    const client = createServiceRoleClient() || owner.client;
    const { data: updatedPass, error: passError } = await client
      .from("user_passes")
      .select("metadata")
      .eq("id", userPass.id)
      .maybeSingle();

    expect(passError).toBeNull();
    expect(Number(updatedPass?.metadata?.points)).toBe(7);

    const { data: redemption, error: redemptionError } = await client
      .from("reward_redemptions")
      .select("id, reward_id, user_pass_id, points_spent, points_before, points_after")
      .eq("id", response.body.redemption_id)
      .maybeSingle();

    expect(redemptionError).toBeNull();
    expect(redemption?.reward_id).toBe(reward.id);
    expect(redemption?.user_pass_id).toBe(userPass.id);
    expect(redemption?.points_spent).toBe(5);
  });

  test("bloqueia resgate com pontos insuficientes sem debitar", async () => {
    const { project, owner } = context;
    const userPass = await createClaimedUserPass({ pass, owner, points: 3 });
    const reward = await createReward({
      client: owner.client,
      projectId: project.id,
      name: "Sobremesa",
      pointsRequired: 10,
      message: "Voce resgatou uma sobremesa.",
    });

    const response = await invokeEdgeFunction("scanner-reward", {
      accessToken: owner.accessToken,
      body: {
        projectId: project.id,
        rewardId: reward.id,
        qrData: userPass.pass_token,
      },
    });

    expect(response.status).toBe(409);
    expect(response.body?.error).toBe("insufficient_points");

    const client = createServiceRoleClient() || owner.client;
    const { data: updatedPass, error } = await client
      .from("user_passes")
      .select("metadata")
      .eq("id", userPass.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(Number(updatedPass?.metadata?.points)).toBe(3);
  });

  test("bloqueia QR de outro projeto", async () => {
    const userPass = await createClaimedUserPass({
      pass: otherPass,
      owner: otherContext.owner,
      points: 20,
    });

    const reward = await createReward({
      client: context.owner.client,
      projectId: context.project.id,
      name: "Brinde",
      pointsRequired: 5,
      message: "Voce resgatou um brinde.",
    });

    const response = await invokeEdgeFunction("scanner-reward", {
      accessToken: context.owner.accessToken,
      body: {
        projectId: context.project.id,
        rewardId: reward.id,
        qrData: userPass.pass_token,
      },
    });

    expect(response.status).toBe(403);
    expect(response.body?.error).toBe("wrong_project");
  });
});
