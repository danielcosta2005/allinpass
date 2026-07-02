import {
  corsHeaders,
  ensureCanManageProjectMembers,
  getCallerProfile,
  getServiceClient,
  HttpError,
  jsonResponse,
} from "../_shared/adminAccess.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { memberId, invitationId, projectId } = await req.json().catch(() => ({}));
    const normalizedProjectId = String(projectId || "").trim();
    const normalizedMemberId = String(memberId || "").trim();
    const normalizedInvitationId = String(invitationId || "").trim();

    if (!normalizedProjectId) throw new HttpError(400, "projectId e obrigatorio.", "missing_project");
    if (!normalizedMemberId && !normalizedInvitationId) {
      throw new HttpError(400, "memberId ou invitationId e obrigatorio.", "missing_target");
    }

    const supabaseAdmin = getServiceClient();
    const caller = await getCallerProfile(supabaseAdmin, req);
    await ensureCanManageProjectMembers(supabaseAdmin, caller, normalizedProjectId);

    if (normalizedInvitationId) {
      const { error: cancelError } = await supabaseAdmin
        .from("user_invitations")
        .update({ status: "cancelled" })
        .eq("id", normalizedInvitationId)
        .eq("invite_type", "project_member")
        .eq("project_id", normalizedProjectId)
        .in("status", ["invited", "expired"]);

      if (cancelError) throw cancelError;

      return jsonResponse({
        success: true,
        invitationId: normalizedInvitationId,
        status: "cancelled",
      });
    }

    if (normalizedMemberId === caller.user.id) {
      throw new HttpError(400, "Voce nao pode remover seu proprio acesso ao projeto.", "cannot_remove_self");
    }

    const { error: deleteError } = await supabaseAdmin
      .from("project_members")
      .delete()
      .match({ project_id: normalizedProjectId, user_id: normalizedMemberId });

    if (deleteError) throw deleteError;

    return jsonResponse({ success: true, userId: normalizedMemberId });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("Erro na edge function admin-remove-member:", error);
    return jsonResponse(
      {
        error: error?.message || "Erro desconhecido na edge function",
        code: error?.code || null,
      },
      status,
    );
  }
});
