import {
  corsHeaders,
  ensureSuperadmin,
  findAuthUserByEmail,
  getCallerProfile,
  getProfileForUser,
  getServiceClient,
  hasAnyProjectMembership,
  HttpError,
  jsonResponse,
  markInvitationSendFailure,
  sendInvitationEmail,
} from "../_shared/adminAccess.ts";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

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
    const supabaseAdmin = getServiceClient();
    const caller = await getCallerProfile(supabaseAdmin, req);
    ensureSuperadmin(caller, "Acesso negado. Apenas superadmins podem gerenciar admins.");

    const { email, role = "admin" } = await req.json().catch(() => ({}));
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const requestedRole = String(role || "admin").trim().toLowerCase();

    if (!normalizedEmail) throw new HttpError(400, "Email e obrigatorio.", "missing_email");
    if (!ADMIN_ROLES.has(requestedRole)) {
      throw new HttpError(400, "Papel administrativo invalido.", "invalid_role");
    }

    const existingUser = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);

    if (existingUser?.id) {
      const currentProfile = await getProfileForUser(supabaseAdmin, existingUser.id);
      const hasMembership = await hasAnyProjectMembership(supabaseAdmin, existingUser.id);

      if (currentProfile?.role === "establishment" || hasMembership) {
        throw new HttpError(409, "Este email ja esta cadastrado como login de restaurante.", "restaurant_login_conflict");
      }

      if (currentProfile?.role === "admin" || currentProfile?.role === "superadmin") {
        const { error: updateProfileError } = await supabaseAdmin
          .from("profiles")
          .update({
            role: requestedRole,
            email: normalizedEmail,
          })
          .eq("id", existingUser.id);

        if (updateProfileError) throw updateProfileError;

        return jsonResponse({
          success: true,
          userId: existingUser.id,
          inviteSent: false,
          status: "active",
          role: requestedRole,
          updated: true,
        });
      }
    }

    const { data: restaurantInvitation, error: restaurantInvitationError } = await supabaseAdmin
      .from("user_invitations")
      .select("id")
      .eq("invite_type", "project_member")
      .eq("email", normalizedEmail)
      .in("status", ["invited", "expired"])
      .limit(1)
      .maybeSingle();

    if (restaurantInvitationError) throw restaurantInvitationError;
    if (restaurantInvitation?.id) {
      throw new HttpError(409, "Este email ja possui convite de login de restaurante.", "restaurant_login_conflict");
    }

    const now = new Date();
    const expiresAt = addHours(now, 24).toISOString();
    const inviteNonce = crypto.randomUUID();

    const { data: pendingInvitation, error: pendingError } = await supabaseAdmin
      .from("user_invitations")
      .select("id")
      .eq("invite_type", "admin")
      .eq("email", normalizedEmail)
      .in("status", ["invited", "expired"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendingError) throw pendingError;

    let invitationId = pendingInvitation?.id as string | undefined;

    if (invitationId) {
      const { error: updateInviteError } = await supabaseAdmin
        .from("user_invitations")
        .update({
          role: requestedRole,
          status: "invited",
          invited_user_id: existingUser?.id ?? null,
          invited_by: caller.user.id,
          expires_at: expiresAt,
          last_sent_at: now.toISOString(),
          accepted_at: null,
          accepted_by: null,
          metadata: { nonce: inviteNonce },
        })
        .eq("id", invitationId);

      if (updateInviteError) throw updateInviteError;
    } else {
      const { data: createdInvitation, error: createInviteError } = await supabaseAdmin
        .from("user_invitations")
        .insert({
          email: normalizedEmail,
          invite_type: "admin",
          role: requestedRole,
          invited_user_id: existingUser?.id ?? null,
          status: "invited",
          invited_by: caller.user.id,
          expires_at: expiresAt,
          last_sent_at: now.toISOString(),
          metadata: { nonce: inviteNonce },
        })
        .select("id")
        .single();

      if (createInviteError) throw createInviteError;
      invitationId = createdInvitation.id as string;
    }

    try {
      const delivery = await sendInvitationEmail({
        supabaseAdmin,
        req,
        email: normalizedEmail,
        invitationId,
        nonce: inviteNonce,
        data: { invite_type: "admin", role: requestedRole },
      });

      if (delivery.userId && delivery.userId !== existingUser?.id) {
        const { error: updateUserError } = await supabaseAdmin
          .from("user_invitations")
          .update({ invited_user_id: delivery.userId })
          .eq("id", invitationId);

        if (updateUserError) throw updateUserError;
      }

      return jsonResponse({
        success: true,
        userId: delivery.userId ?? existingUser?.id ?? null,
        invitationId,
        inviteSent: true,
        status: "invited",
        role: requestedRole,
        expiresAt,
      });
    } catch (sendError) {
      await markInvitationSendFailure(supabaseAdmin, invitationId, sendError);
      throw sendError;
    }
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("Erro na funcao superadmin-create-admin:", error);
    return jsonResponse(
      {
        error: error?.message || "Erro desconhecido na edge function",
        code: error?.code || null,
      },
      status,
    );
  }
});
