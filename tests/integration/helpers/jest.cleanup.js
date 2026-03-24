const { cleanupTrackedProjects } = require("./fixtures.js");
const { getOptionalEnv } = require("./env.js");

afterAll(async () => {
  const { supabaseServiceRoleKey, superadminEmail, superadminPassword } = getOptionalEnv();
  if (!supabaseServiceRoleKey && (!superadminEmail || !superadminPassword)) return;

  const pending = await cleanupTrackedProjects();
  if (pending.length === 0) return;

  const details = pending
    .map(({ projectId, errors }) => `${projectId}: ${errors.join(" | ")}`)
    .join(" || ");

  console.warn("global integration cleanup warnings:", details);
});
