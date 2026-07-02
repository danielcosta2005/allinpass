import {
  corsHeaders,
  ensureSuperadmin,
  getCallerProfile,
  getServiceClient,
  HttpError,
  jsonResponse,
} from "../_shared/adminAccess.ts";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { adminId, invitationId, role } = await req.json().catch(() => ({}));
    const normalizedAdminId = String(adminId || "").trim();
    const normalizedInvitationId = String(invitationId || "").trim();
    const requestedRole = String(role || "").trim().toLowerCase();

    if (!ADMIN_ROLES.has(requestedRole)) {
      throw new HttpError(400, "Papel administrativo invalido.", "invalid_role");
    }
    if (!normalizedAdminId && !normalizedInvitationId) {
      throw new HttpError(400, "adminId ou invitationId e obrigatorio.", "missing_target");
    }

    const supabaseAdmin = getServiceClient();
    const caller = await getCallerProfile(supabaseAdmin, req);
    ensureSuperadmin(caller, "Acesso negado. Apenas superadmins podem editar admins.");

    if (normalizedInvitationId) {
      const { data: invitation, error: lookupError } = await supabaseAdmin
        .from("user_invitations")
        .select("id, invite_type, status")
        .eq("id", normalizedInvitationId)
        .maybeSingle();

      if (lookupError) throw lookupError;
      if (!invitation || invitation.invite_type !== "admin" || !["invited", "expired"].includes(invitation.status)) {
        throw new HttpError(404, "Convite administrativo pendente nao encontrado.", "invitation_not_found");
      }

      const { error: updateInviteError } = await supabaseAdmin
        .from("user_invitations")
        .update({ role: requestedRole })
        .eq("id", normalizedInvitationId);

      if (updateInviteError) throw updateInviteError;

      return jsonResponse({
        success: true,
        invitationId: normalizedInvitationId,
        role: requestedRole,
        status: "invited",
      });
    }

    const { data: targetProfile, error: lookupError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", normalizedAdminId)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (targetProfile?.role !== "admin" && targetProfile?.role !== "superadmin") {
      throw new HttpError(404, "Admin nao encontrado.", "admin_not_found");
    }

    const { error: updateProfileError } = await supabaseAdmin
      .from("profiles")
      .update({ role: requestedRole })
      .eq("id", normalizedAdminId);

    if (updateProfileError) throw updateProfileError;

    return jsonResponse({
      success: true,
      userId: normalizedAdminId,
      role: requestedRole,
      status: "active",
    });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("Erro na funcao superadmin-update-admin:", error);
    return jsonResponse(
      {
        error: error?.message || "Erro desconhecido na edge function",
        code: error?.code || null,
      },
      status,
    );
  }
});
