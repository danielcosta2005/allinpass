const {
  createAnonClient,
  createServiceRoleClient,
  invokeEdgeFunction,
  signInWithPassword,
} = require("./supabase.js");
const { getOptionalEnv } = require("./env.js");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const trackedProjectIds = new Set();
let cachedSuperadminClient = undefined;
let cachedSuperadminAuth = undefined;
let cachedSuperadminAuthError = null;

function trackProjectId(projectId) {
  if (projectId) trackedProjectIds.add(projectId);
}

function untrackProjectId(projectId) {
  if (projectId) trackedProjectIds.delete(projectId);
}

async function resolveSuperadminClient() {
  if (cachedSuperadminClient !== undefined) return cachedSuperadminClient;

  const auth = await resolveSuperadminAuth();
  cachedSuperadminClient = auth?.client ?? null;
  return cachedSuperadminClient;
}

async function resolveSuperadminAuth() {
  if (cachedSuperadminAuth !== undefined) return cachedSuperadminAuth;

  const { superadminEmail, superadminPassword } = getOptionalEnv();
  if (!superadminEmail || !superadminPassword) {
    cachedSuperadminAuth = null;
    return cachedSuperadminAuth;
  }

  try {
    const auth = await signInWithPassword(superadminEmail, superadminPassword);
    cachedSuperadminAuth = auth;
    return cachedSuperadminAuth;
  } catch (error) {
    cachedSuperadminAuth = null;
    cachedSuperadminAuthError = error instanceof Error ? error.message : String(error);
    return cachedSuperadminAuth;
  }
}

function randomId(prefix = "it") {
  const chunk = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${chunk}`;
}

function randomEmail(prefix = "it-user") {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;
}

function randomPassword(prefix = "Teste") {
  return `${prefix}!${Math.random().toString(36).slice(2, 9)}A1`;
}

async function createProject(overrides = {}) {
  const body = {
    name: overrides.name ?? `Projeto ${randomId("integ")}`,
    description: overrides.description ?? "Projeto de teste de integracao",
    logo_url: overrides.logo_url ?? null,
  };

  const result = await invokeEdgeFunction("create-project", { body });
  if (!result.ok) {
    throw new Error(
      `create-project falhou (${result.status}): ${result.text || "sem payload"}`,
    );
  }

  const project = result.body?.project;
  if (!project?.id) {
    throw new Error("create-project nao retornou project.id.");
  }

  trackProjectId(project.id);
  return { result, project };
}

async function createProjectTeste({ name, description, logo_url, accessToken } = {}) {
  const body = {
    name: name ?? `Projeto Teste ${randomId("integ")}`,
    description: description ?? "Projeto de teste de integracao",
    logo_url: logo_url ?? null,
  };

  const result = await invokeEdgeFunction("create-project-teste", {
    body,
    accessToken,
  });

  if (!result.ok) {
    throw new Error(
      `create-project-teste falhou (${result.status}): ${result.text || "sem payload"}`,
    );
  }

  const project = result.body?.project;
  if (!project?.id) {
    throw new Error("create-project-teste nao retornou project.id.");
  }

  trackProjectId(project.id);
  return { result, project };
}

async function createProjectOwner({
  projectId,
  email = randomEmail("owner"),
  password = randomPassword("Owner"),
} = {}) {
  if (!projectId) throw new Error("projectId e obrigatorio para createProjectOwner().");

  const serviceRoleClient = createServiceRoleClient();
  if (!serviceRoleClient) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY e obrigatorio para criar owner de teste.");
  }

  const { data: createdUser, error: createError } = await serviceRoleClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) throw createError;

  const userId = createdUser?.user?.id;
  if (!userId) throw new Error("auth.admin.createUser nao retornou user.id.");

  const { error: profileError } = await serviceRoleClient
    .from("profiles")
    .upsert({
      id: userId,
      email,
      role: "establishment",
      created_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (profileError) throw profileError;

  const { error: memberError } = await serviceRoleClient
    .from("project_members")
    .upsert({
      project_id: projectId,
      user_id: userId,
      role: "owner",
    }, { onConflict: "project_id,user_id" });

  if (memberError) throw memberError;

  return {
    email,
    password,
    userId,
    role: "owner",
  };
}

async function createMember({
  projectId,
  role = "staff",
  email = randomEmail("member"),
  password = randomPassword(),
  accessToken,
} = {}) {
  if (!projectId) throw new Error("projectId e obrigatorio para createMember().");
  if (!accessToken) throw new Error("accessToken e obrigatorio para createMember().");

  const result = await invokeEdgeFunction("admin-create-member", {
    body: { projectId, email, password, role },
    accessToken,
  });

  if (!result.ok || !result.body?.success) {
    throw new Error(
      `admin-create-member falhou (${result.status}): ${result.text || "sem payload"}`,
    );
  }

  return {
    result,
    email,
    password,
    userId: result.body.userId,
    inviteSent: !!result.body.inviteSent,
    role,
  };
}

async function createPass({
  projectId,
  title = "Passe Integracao",
  description = "Passe criado por teste de integracao",
  type = "loyalty",
  fields = { points: 0 },
  colors = { background: "#112233", label: "#ffffff", text: "#ffffff" },
  images = {},
  location_ids = [],
  app_base_url = "https://integration.example.com",
} = {}) {
  if (!projectId) throw new Error("projectId e obrigatorio para createPass().");

  const result = await invokeEdgeFunction("create-pass", {
    body: {
      project_id: projectId,
      type,
      title,
      description,
      fields,
      colors,
      images,
      location_ids,
      app_base_url,
    },
  });

  if (!result.ok) {
    throw new Error(
      `create-pass falhou (${result.status}): ${result.text || "sem payload"}`,
    );
  }

  if (!result.body?.id || !result.body?.short_code) {
    throw new Error("create-pass nao retornou id/short_code.");
  }

  return { result, pass: result.body };
}

async function provisionProjectAndOwner() {
  const { supabaseServiceRoleKey } = getOptionalEnv();
  if (!supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY e obrigatorio para criar owner de teste.");
  }

  const { project } = await createProject();

  try {
    const member = await createProjectOwner({
      projectId: project.id,
    });

    const auth = await signInWithPassword(member.email, member.password);

    return {
      project,
      owner: {
        ...member,
        accessToken: auth.accessToken,
        client: auth.client,
        user: auth.user,
        session: auth.session,
      },
    };
  } catch (error) {
    const cleanupErrors = await cleanupProjectData(project.id);
    const cleanupSuffix =
      cleanupErrors.length > 0 ? ` | cleanup: ${cleanupErrors.join(" | ")}` : "";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha em provisionProjectAndOwner (${project.id}): ${message}${cleanupSuffix}`);
  }
}

function isIgnorableDeleteError(error) {
  if (!error) return false;

  const code = String(error.code || "");
  const message = String(error.message || "");

  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST205" ||
    /relation .* does not exist/i.test(message) ||
    /column .* does not exist/i.test(message) ||
    /could not find the table/i.test(message)
  );
}

async function safeDelete(client, table, matcher) {
  return safeDeleteWithChecks(client, table, matcher);
}

async function safeDeleteWithChecks(client, table, matcher, options = {}) {
  const { expectAtLeastOne = false } = options;

  try {
    let query = client.from(table).delete({ count: "exact" });
    for (const [column, value] of matcher) {
      query = query.eq(column, value);
    }
    const { error, count } = await query;
    if (expectAtLeastOne && typeof count === "number" && count < 1) {
      return `${table}: nenhum registro removido`;
    }
    if (!error || isIgnorableDeleteError(error)) return null;
    return `${table}: ${error.message}`;
  } catch (error) {
    return `${table}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function canReadProject(client, projectId) {
  try {
    const { data, error } = await client
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();

    if (error) return null;
    return Boolean(data?.id);
  } catch {
    return null;
  }
}

async function cleanupProjectDataWithClient(projectId, client) {
  const errors = [];
  const projectVisibleBeforeCleanup = await canReadProject(client, projectId);

  const byProject = [["project_id", projectId]];
  const byProjectId = [["id", projectId]];

  const deletes = [
    ["reward_redemptions", byProject],
    ["rewards", byProject],
    ["notification_jobs", byProject],
    ["notifications", byProject],
    ["automation_dispatches", byProject],
    ["automations", byProject],
    ["visits", byProject],
    ["events", byProject],
    ["loyalty_states", byProject],
    ["customers", byProject],
    ["wallet_links", byProject],
    ["passkit_registrations", byProject],
    ["pass_locations", byProject],
    ["user_passes", byProject],
    ["locations", byProject],
    ["passes", byProject],
    ["project_members", byProject],
    ["wallet_configs_history", byProject],
    ["wallet_configs", byProject],
    ["projects_notifications", byProject],
    ["wallet_templates", byProject],
    ["projects", byProjectId],
  ];

  for (const [table, matcher] of deletes) {
    const shouldExpectProjectDelete = table === "projects" && projectVisibleBeforeCleanup === true;
    const err = shouldExpectProjectDelete
      ? await safeDeleteWithChecks(client, table, matcher, { expectAtLeastOne: true })
      : await safeDelete(client, table, matcher);
    if (err) errors.push(err);
  }

  return errors;
}

async function buildCleanupClients(client = null) {
  const clients = [];
  if (client) clients.push(client);

  const superadminClient = await resolveSuperadminClient();
  if (superadminClient) clients.push(superadminClient);

  const serviceRoleClient = createServiceRoleClient();
  if (serviceRoleClient) clients.push(serviceRoleClient);

  if (!client && !superadminClient && !serviceRoleClient) {
    clients.push(createAnonClient());
  }

  return clients;
}

async function cleanupProjectData(projectId, client = null) {
  if (!projectId) return [];

  const superadminClient = await resolveSuperadminClient();
  const serviceRoleClient = createServiceRoleClient();
  if (!client && !superadminClient && !serviceRoleClient) {
    const message =
      "cleanup sem credencial com permissao de delete. Forneca owner client, SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD ou SUPABASE_SERVICE_ROLE_KEY.";
    if (cachedSuperadminAuthError) {
      return [`${message} superadmin auth: ${cachedSuperadminAuthError}`];
    }
    return [message];
  }

  const clients = await buildCleanupClients(client);
  let lastErrors = [];

  for (const sb of clients) {
    const errors = await cleanupProjectDataWithClient(projectId, sb);
    if (errors.length === 0) {
      untrackProjectId(projectId);
      return [];
    }
    lastErrors = errors;
  }

  return lastErrors;
}

async function cleanupTrackedProjects(client = null) {
  const report = [];
  for (const projectId of Array.from(trackedProjectIds)) {
    const errors = await cleanupProjectData(projectId, client);
    if (errors.length > 0) {
      report.push({ projectId, errors });
      untrackProjectId(projectId);
    }
  }
  return report;
}

module.exports = {
  UUID_REGEX,
  randomId,
  randomEmail,
  randomPassword,
  createProject,
  createProjectTeste,
  createProjectOwner,
  createMember,
  createPass,
  provisionProjectAndOwner,
  cleanupProjectData,
  cleanupTrackedProjects,
  resolveSuperadminAuth,
};
