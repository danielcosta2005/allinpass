import {
  corsHeaders,
  ensureSuperadmin,
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
    const { adminId, invitationId } = await req.json().catch(() => ({}));
    const targetAdminId = String(adminId || "").trim();
    const targetInvitationId = String(invitationId || "").trim();

    if (!targetAdminId && !targetInvitationId) {
      throw new HttpError(400, "adminId ou invitationId e obrigatorio.", "missing_target");
    }

    const supabaseAdmin = getServiceClient();
    const caller = await getCallerProfile(supabaseAdmin, req);
    ensureSuperadmin(caller, "Acesso negado. Apenas superadmins podem gerenciar admins.");

    if (targetInvitationId) {
      const { error: cancelError } = await supabaseAdmin
        .from("user_invitations")
        .update({ status: "cancelled" })
        .eq("id", targetInvitationId)
        .eq("invite_type", "admin")
        .in("status", ["invited", "expired"]);

      if (cancelError) throw cancelError;

      return jsonResponse({
        success: true,
        invitationId: targetInvitationId,
        status: "cancelled",
      });
    }

    if (targetAdminId === caller.user.id) {
      throw new HttpError(400, "Voce nao pode remover seu proprio acesso.", "cannot_remove_self");
    }

    const { data: targetProfile, error: lookupError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", targetAdminId)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (targetProfile?.role !== "admin" && targetProfile?.role !== "superadmin") {
      throw new HttpError(404, "Admin nao encontrado.", "admin_not_found");
    }

    const { error: deleteError } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", targetAdminId)
      .in("role", ["admin", "superadmin"]);

    if (deleteError) throw deleteError;

    return jsonResponse({ success: true, userId: targetAdminId });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("Erro na funcao superadmin-remove-admin:", error);
    return jsonResponse(
      {
        error: error?.message || "Erro desconhecido na edge function",
        code: error?.code || null,
      },
      status,
    );
  }
});
