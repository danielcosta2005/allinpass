import {
  corsHeaders,
  ensureCanManageProjectMembers,
  ensureSuperadmin,
  getCallerProfile,
  getServiceClient,
  HttpError,
  jsonResponse,
  sendInvitationEmail,
} from "../_shared/adminAccess.ts";

function addHours(date: Date, hours: number) {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { invitationId } = await req.json().catch(() => ({}));
    const normalizedInvitationId = String(invitationId || "").trim();
    if (!normalizedInvitationId) {
      throw new HttpError(400, "invitationId e obrigatorio.", "missing_invitation");
    }

    const supabaseAdmin = getServiceClient();
    const caller = await getCallerProfile(supabaseAdmin, req);

    const { data: invitation, error: invitationError } = await supabaseAdmin
      .from("user_invitations")
      .select("id, email, invite_type, role, project_id, status")
      .eq("id", normalizedInvitationId)
      .maybeSingle();

    if (invitationError) throw invitationError;
    if (!invitation || !["invited", "expired"].includes(invitation.status)) {
      throw new HttpError(404, "Convite pendente nao encontrado.", "invitation_not_found");
    }

    if (invitation.invite_type === "admin") {
      ensureSuperadmin(caller, "Acesso negado. Apenas superadmins podem reenviar convites administrativos.");
    } else if (invitation.invite_type === "project_member" && invitation.project_id) {
      await ensureCanManageProjectMembers(supabaseAdmin, caller, invitation.project_id);
    } else {
      throw new HttpError(400, "Convite invalido.", "invalid_invitation");
    }

    const now = new Date();
    const expiresAt = addHours(now, 24).toISOString();
    const inviteNonce = crypto.randomUUID();

    const delivery = await sendInvitationEmail({
      supabaseAdmin,
      req,
      email: invitation.email,
      invitationId: invitation.id,
      nonce: inviteNonce,
      data: {
        invite_type: invitation.invite_type,
        project_id: invitation.project_id,
        role: invitation.role,
      },
    });

    const { error: updateError } = await supabaseAdmin
      .from("user_invitations")
      .update({
        status: "invited",
        invited_user_id: delivery.userId ?? null,
        expires_at: expiresAt,
        last_sent_at: now.toISOString(),
        metadata: { nonce: inviteNonce },
      })
      .eq("id", invitation.id);

    if (updateError) throw updateError;

    return jsonResponse({
      success: true,
      invitationId: invitation.id,
      inviteSent: true,
      expiresAt,
    });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("Erro na funcao admin-resend-invitation:", error);
    return jsonResponse(
      {
        error: error?.message || "Erro desconhecido na edge function",
        code: error?.code || null,
      },
      status,
    );
  }
});
