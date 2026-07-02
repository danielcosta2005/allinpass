import {
  corsHeaders,
  ensureCanManageProjectMembers,
  getCallerProfile,
  getServiceClient,
  HttpError,
  jsonResponse,
} from "../_shared/adminAccess.ts";

const MEMBER_ROLES = new Set(["owner", "staff"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { memberId, invitationId, projectId, role } = await req.json().catch(() => ({}));
    const normalizedProjectId = String(projectId || "").trim();
    const normalizedRole = String(role || "").trim().toLowerCase();
    const normalizedMemberId = String(memberId || "").trim();
    const normalizedInvitationId = String(invitationId || "").trim();

    if (!normalizedProjectId) throw new HttpError(400, "projectId e obrigatorio.", "missing_project");
    if (!normalizedRole || !MEMBER_ROLES.has(normalizedRole)) {
      throw new HttpError(400, "Papel de membro invalido.", "invalid_role");
    }
    if (!normalizedMemberId && !normalizedInvitationId) {
      throw new HttpError(400, "memberId ou invitationId e obrigatorio.", "missing_target");
    }

    const supabaseAdmin = getServiceClient();
    const caller = await getCallerProfile(supabaseAdmin, req);
    await ensureCanManageProjectMembers(supabaseAdmin, caller, normalizedProjectId);

    if (normalizedInvitationId) {
      const { data: invitation, error: lookupError } = await supabaseAdmin
        .from("user_invitations")
        .select("id, invite_type, project_id, status")
        .eq("id", normalizedInvitationId)
        .maybeSingle();

      if (lookupError) throw lookupError;
      if (
        !invitation ||
        invitation.invite_type !== "project_member" ||
        invitation.project_id !== normalizedProjectId ||
        !["invited", "expired"].includes(invitation.status)
      ) {
        throw new HttpError(404, "Convite pendente nao encontrado.", "invitation_not_found");
      }

      const { error: updateInviteError } = await supabaseAdmin
        .from("user_invitations")
        .update({ role: normalizedRole })
        .eq("id", normalizedInvitationId);

      if (updateInviteError) throw updateInviteError;

      return jsonResponse({
        success: true,
        invitationId: normalizedInvitationId,
        role: normalizedRole,
        status: "invited",
      });
    }

    const { error: memberError } = await supabaseAdmin
      .from("project_members")
      .update({ role: normalizedRole })
      .eq("project_id", normalizedProjectId)
      .eq("user_id", normalizedMemberId);

    if (memberError) throw memberError;

    return jsonResponse({
      success: true,
      userId: normalizedMemberId,
      role: normalizedRole,
      status: "active",
    });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("Erro na funcao admin-update-member:", error);
    return jsonResponse(
      {
        error: error?.message || "Erro desconhecido na edge function",
        code: error?.code || null,
      },
      status,
    );
  }
});
