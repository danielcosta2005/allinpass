import {
  corsHeaders,
  getCallerProfile,
  getProfileForUser,
  getServiceClient,
  hasAnyProjectMembership,
  HttpError,
  jsonResponse,
} from "../_shared/adminAccess.ts";

async function findInvitationForUser(supabaseAdmin: any, invitationId: string, email: string, userId: string) {
  if (invitationId) {
    const { data, error } = await supabaseAdmin
      .from("user_invitations")
      .select("id, email, invite_type, role, project_id, status, expires_at, invited_user_id, metadata")
      .eq("id", invitationId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const inviteEmail = String(data.email || "").trim().toLowerCase();
    if (inviteEmail !== email) {
      throw new HttpError(403, "Este convite pertence a outro email.", "email_mismatch");
    }

    if (data.invited_user_id && data.invited_user_id !== userId) {
      throw new HttpError(403, "Este convite pertence a outro usuario.", "user_mismatch");
    }

    return data;
  }

  const { data, error } = await supabaseAdmin
    .from("user_invitations")
    .select("id, email, invite_type, role, project_id, status, expires_at, invited_user_id, metadata")
    .eq("email", email)
    .eq("status", "invited")
    .order("last_sent_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { invitationId, nonce, validateOnly = false } = await req.json().catch(() => ({}));
    const normalizedInvitationId = String(invitationId || "").trim();
    const normalizedNonce = String(nonce || "").trim();

    const supabaseAdmin = getServiceClient();
    const caller = await getCallerProfile(supabaseAdmin, req);
    const email = String(caller.user.email || "").trim().toLowerCase();
    if (!email) throw new HttpError(400, "Usuario autenticado sem email.", "missing_email");

    const invitation = await findInvitationForUser(
      supabaseAdmin,
      normalizedInvitationId,
      email,
      caller.user.id,
    );

    if (
      invitation?.status === "active" &&
      invitation.invited_user_id === caller.user.id
    ) {
      return jsonResponse({
        success: true,
        alreadyActive: true,
        invitationId: invitation.id,
        inviteType: invitation.invite_type,
        role: invitation.invite_type === "admin" ? invitation.role : "establishment",
        memberRole: invitation.invite_type === "project_member" ? invitation.role : null,
        projectId: invitation.project_id || null,
        redirectTo: invitation.invite_type === "admin" ? "/admin" : "/org",
      });
    }

    if (!invitation || invitation.status !== "invited") {
      throw new HttpError(404, "Convite pendente nao encontrado.", "invitation_not_found");
    }

    const expectedNonce = String(invitation.metadata?.nonce || "").trim();
    if (expectedNonce && expectedNonce !== normalizedNonce) {
      throw new HttpError(410, "Este link de convite nao e mais valido. Peca um novo envio.", "stale_invitation_link");
    }

    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      await supabaseAdmin
        .from("user_invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
      throw new HttpError(410, "Este convite expirou. Peca um novo envio.", "invitation_expired");
    }

    if (validateOnly) {
      return jsonResponse({
        success: true,
        valid: true,
        invitationId: invitation.id,
        inviteType: invitation.invite_type,
      });
    }

    const currentProfile = await getProfileForUser(supabaseAdmin, caller.user.id);

    if (invitation.invite_type === "admin") {
      const hasMembership = await hasAnyProjectMembership(supabaseAdmin, caller.user.id);
      if (currentProfile?.role === "establishment" || hasMembership) {
        throw new HttpError(409, "Este email ja esta cadastrado como login de restaurante.", "restaurant_login_conflict");
      }

      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert(
          {
            id: caller.user.id,
            email,
            role: invitation.role,
            created_at: currentProfile?.created_at || new Date().toISOString(),
          },
          { onConflict: "id" },
        );

      if (profileError) throw profileError;
    } else if (invitation.invite_type === "project_member") {
      if (!invitation.project_id) {
        throw new HttpError(400, "Convite de membro sem projeto.", "missing_project");
      }
      if (currentProfile?.role === "admin" || currentProfile?.role === "superadmin") {
        throw new HttpError(409, "Este email ja esta cadastrado como login administrativo.", "admin_login_conflict");
      }

      const hasMembership = await hasAnyProjectMembership(supabaseAdmin, caller.user.id);
      if (hasMembership) {
        throw new HttpError(
          409,
          "Este email ja esta vinculado a um projeto. Um login de restaurante nao pode pertencer a mais de um projeto.",
          "project_member_account_conflict",
        );
      }

      if (currentProfile?.role === "establishment") {
        throw new HttpError(
          409,
          "Este email ja possui uma conta de restaurante na Allinpass.",
          "restaurant_login_conflict",
        );
      }

      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert(
          {
            id: caller.user.id,
            email,
            role: "establishment",
            created_at: currentProfile?.created_at || new Date().toISOString(),
          },
          { onConflict: "id" },
        );

      if (profileError) throw profileError;

      const { error: memberError } = await supabaseAdmin
        .from("project_members")
        .upsert(
          {
            project_id: invitation.project_id,
            user_id: caller.user.id,
            role: invitation.role,
          },
          { onConflict: "project_id,user_id" },
        );

      if (memberError) throw memberError;
    } else {
      throw new HttpError(400, "Tipo de convite invalido.", "invalid_invitation");
    }

    const { error: invitationUpdateError } = await supabaseAdmin
      .from("user_invitations")
      .update({
        status: "active",
        invited_user_id: caller.user.id,
        accepted_by: caller.user.id,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", invitation.id);

    if (invitationUpdateError) throw invitationUpdateError;

    return jsonResponse({
      success: true,
      invitationId: invitation.id,
      inviteType: invitation.invite_type,
      role: invitation.invite_type === "admin" ? invitation.role : "establishment",
      memberRole: invitation.invite_type === "project_member" ? invitation.role : null,
      projectId: invitation.project_id || null,
      redirectTo: invitation.invite_type === "admin" ? "/admin" : "/org",
    });
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("Erro na funcao admin-accept-invitation:", error);
    return jsonResponse(
      {
        error: error?.message || "Erro desconhecido na edge function",
        code: error?.code || null,
      },
      status,
    );
  }
});
