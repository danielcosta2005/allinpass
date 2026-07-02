import {
  corsHeaders,
  getCallerProfile,
  getServiceClient,
  HttpError,
  jsonResponse,
} from "../_shared/adminAccess.ts";

function ensureCanReadAdmins(caller: { profile?: { role?: string | null } | null }) {
  if (caller.profile?.role !== "superadmin" && caller.profile?.role !== "admin") {
    throw new HttpError(403, "Acesso negado. Apenas admins podem visualizar esta aba.", "forbidden");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = getServiceClient();
    const caller = await getCallerProfile(supabaseAdmin, req);
    ensureCanReadAdmins(caller);

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, name, role, created_at")
      .in("role", ["admin", "superadmin"])
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

    const activeAdmins = (profiles || []).map((profile: any) => ({
      ...profile,
      email: profile.email || authUsersById.get(profile.id)?.email || null,
      status: "active",
      invitation_id: null,
      expires_at: null,
      projects: projectsByAdmin.get(profile.id) || [],
    }));

    const activeEmails = new Set(
      activeAdmins.map((admin: any) => String(admin.email || "").trim().toLowerCase()).filter(Boolean),
    );

    const { data: invitations, error: invitationsError } = await supabaseAdmin
      .from("user_invitations")
      .select("id, email, role, created_at, expires_at, status, invited_user_id")
      .eq("invite_type", "admin")
      .in("status", ["invited", "expired"])
      .order("created_at", { ascending: false });

    if (invitationsError) throw invitationsError;

    const seenInvitationEmails = new Set<string>();
    const invitedAdmins = (invitations || [])
      .filter((invitation: any) => {
        const email = String(invitation.email || "").trim().toLowerCase();
        if (!email || activeEmails.has(email) || seenInvitationEmails.has(email)) return false;
        seenInvitationEmails.add(email);
        return true;
      })
      .map((invitation: any) => ({
        id: invitation.invited_user_id || invitation.id,
        email: invitation.email,
        name: null,
        role: invitation.role,
        created_at: invitation.created_at,
        status: invitation.status === "expired" || new Date(invitation.expires_at).getTime() <= Date.now()
          ? "expired"
          : "invited",
        invitation_id: invitation.id,
        expires_at: invitation.expires_at,
        projects: [],
      }));

    return jsonResponse({
      success: true,
      admins: [...invitedAdmins, ...activeAdmins],
      canManageAdmins: caller.profile?.role === "superadmin",
    });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("Erro na funcao superadmin-list-admins:", error);
    return jsonResponse(
      {
        error: error?.message || "Erro desconhecido na edge function",
        code: error?.code || null,
      },
      status,
    );
  }
});
