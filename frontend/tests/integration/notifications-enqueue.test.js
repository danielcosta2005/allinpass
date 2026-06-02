const { cleanupProjectData, createPass, provisionProjectAndOwner } = require("./helpers/fixtures.js");
const { invokeEdgeFunction } = require("./helpers/supabase.js");

describe("Edge Function notifications-enqueue", () => {
  let context = null;

  beforeAll(async () => {
    context = await provisionProjectAndOwner();
  });

  afterAll(async () => {
    if (!context?.project?.id) return;
    const errors = await cleanupProjectData(context.project.id, context.owner?.client);
    if (errors.length > 0) {
      console.warn("notifications-enqueue cleanup warnings:", errors.join(" | "));
    }
  });

  test("enfileira campanha manual e persiste em notifications", async () => {
    const { project, owner } = context;

    const response = await invokeEdgeFunction("notifications-enqueue", {
      accessToken: owner.accessToken,
      body: {
        projectId: project.id,
        title: "Campanha Integração",
        message: "Mensagem de integração para validação.",
        sendMode: "now",
        user_pass_ids: [crypto.randomUUID()],
        channels: { apple: true, google: true },
        data: { source: "jest-integration" },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body?.ok).toBe(true);
    expect(response.body?.notification_id).toBeTruthy();

    const notificationId = response.body.notification_id;

    const { data: notif, error: notifError } = await owner.client
      .from("notifications")
      .select("id, project_id, title, message, trigger_type, status")
      .eq("id", notificationId)
      .eq("project_id", project.id)
      .maybeSingle();

    expect(notifError).toBeNull();
    expect(notif?.id).toBe(notificationId);
    expect(notif?.trigger_type).toBe("manual");

    const { data: jobs, error: jobsError } = await owner.client
      .from("notification_jobs")
      .select("id, notification_id")
      .eq("notification_id", notificationId);

    expect(jobsError).toBeNull();
    expect(Array.isArray(jobs)).toBe(true);
  });

  test("enfileira apenas google quando o passe google tambem tem device_key", async () => {
    const { project, owner } = context;
    const { pass } = await createPass({
      projectId: project.id,
      title: "Passe Google Notificacao",
    });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { data: userPass, error: userPassError } = await owner.client
      .from("user_passes")
      .insert({
        pass_id: pass.id,
        project_id: project.id,
        user_id: owner.user.id,
        device_key: `device-${crypto.randomUUID()}`,
        pass_token: `token-${crypto.randomUUID()}`,
        pass_type: "loyalty",
        install_status: "installed",
        install_platform: "google",
        google_object_id: `issuer.object-${crypto.randomUUID()}`,
        google_class_id: "issuer.class",
        issued_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        metadata: { source: "jest-integration" },
      })
      .select("id")
      .single();

    expect(userPassError).toBeNull();
    expect(userPass?.id).toBeTruthy();

    const response = await invokeEdgeFunction("notifications-enqueue", {
      accessToken: owner.accessToken,
      body: {
        projectId: project.id,
        title: "Envio manual",
        message: "Mensagem para passe google.",
        sendMode: "now",
        user_pass_ids: [userPass.id],
        channels: { apple: true, google: true },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body?.ok).toBe(true);
    expect(response.body?.jobs_created).toBe(1);

    const { data: jobs, error: jobsError } = await owner.client
      .from("notification_jobs")
      .select("platform, user_pass_id")
      .eq("notification_id", response.body.notification_id);

    expect(jobsError).toBeNull();
    expect(jobs).toHaveLength(1);
    expect(jobs?.[0]?.platform).toBe("google");
    expect(jobs?.[0]?.user_pass_id).toBe(userPass.id);
  });

  test("retorna 400 quando user_pass_ids está vazio", async () => {
    const { project, owner } = context;

    const response = await invokeEdgeFunction("notifications-enqueue", {
      accessToken: owner.accessToken,
      body: {
        projectId: project.id,
        message: "Mensagem sem alvo",
        user_pass_ids: [],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body?.error).toBeTruthy();
  });
});
