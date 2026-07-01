import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function getCallerProfile(supabaseAdmin: any, req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new HttpError(401, "Missing Authorization header");

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw new HttpError(401, "Sessão inválida.");

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  return { user, profile };
}

function ensureCanListAdmins(caller: { profile?: { role?: string } | null }) {
  if (!["superadmin", "admin"].includes(caller.profile?.role || "")) {
    throw new HttpError(403, "Acesso negado. Apenas admins podem visualizar admins.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error("Variáveis de ambiente do Supabase não configuradas.");
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    ensureCanListAdmins(await getCallerProfile(supabaseAdmin, req));

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, name, created_at")
      .eq("role", "admin")
      .order("created_at", { ascending: false });

    if (profilesError) throw profilesError;

    const adminIds = (profiles || []).map((profile: any) => profile.id).filter(Boolean);
    const projectsByAdmin = new Map<string, any[]>();

    if (adminIds.length > 0) {
      const { data: projects, error: projectsError } = await supabaseAdmin
        .from("projects")
        .select("id, name, created_at, created_by")
        .in("created_by", adminIds)
        .order("created_at", { ascending: false });

      if (projectsError) throw projectsError;

      (projects || []).forEach((project: any) => {
        if (!project.created_by) return;
        const current = projectsByAdmin.get(project.created_by) || [];
        current.push({
          id: project.id,
          name: project.name,
          created_at: project.created_at,
        });
        projectsByAdmin.set(project.created_by, current);
      });
    }

    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    const authUsersById = new Map(
      (authUsers?.users || []).map((user: any) => [user.id, user]),
    );

    const admins = (profiles || []).map((profile: any) => ({
      ...profile,
      email: profile.email || authUsersById.get(profile.id)?.email || null,
      projects: projectsByAdmin.get(profile.id) || [],
    }));

    return jsonResponse({ success: true, admins });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("Erro na função superadmin-list-admins:", error);
    return jsonResponse({ error: error?.message || "Erro desconhecido na edge function" }, status);
  }
});
