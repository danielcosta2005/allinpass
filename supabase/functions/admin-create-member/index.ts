import {
  corsHeaders,
  ensureCanManageProjectMembers,
  findAuthUserByEmail,
  getCallerProfile,
  getProfileForUser,
  getServiceClient,
  hasAnyProjectMembership,
  HttpError,
  jsonResponse,
  markInvitationSendFailure,
  sendInvitationEmail,
  type SupabaseAdminClient,
} from "../_shared/adminAccess.ts";

const FREE_PLAN_CODE = "free_trial";
const BILLING_PROVISIONING_ORIGIN = "legacy_admin_create_member";
const MEMBER_ROLES = new Set(["owner", "staff"]);

type BillingPlanRow = {
  id: string;
  code: string;
  trial_days: number | null;
  base_price_cents: number | null;
  included_pass_installs: number | null;
  included_notification_sends: number | null;
  overage_pass_install_cents: number | null;
  overage_notification_sent_cents: number | null;
};

function addHours(date: Date, hours: number) {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function isDuplicateKeyError(error: unknown) {
  const maybeError = error as { code?: string; message?: string } | null;
  const code = String(maybeError?.code ?? "");
  const message = String(maybeError?.message ?? "");
  return code === "23505" || /duplicate key value/i.test(message);
}

async function getExistingProjectSubscription(supabaseAdmin: SupabaseAdminClient, projectId: string) {
  const { data, error } = await supabaseAdmin
    .from("billing_subscriptions")
    .select("id")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as { id: string } | null;
}

async function getOrCreateBillingAccount(
  supabaseAdmin: SupabaseAdminClient,
  projectId: string,
  billingEmail: string,
) {
  const { data: existingAccount, error: lookupError } = await supabaseAdmin
    .from("billing_accounts")
    .select("id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existingAccount?.id) return existingAccount.id as string;

  const { data: project, error: projectError } = await supabaseAdmin
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) throw projectError;

  const { data: createdAccount, error: createError } = await supabaseAdmin
    .from("billing_accounts")
    .insert({
      project_id: projectId,
      legal_name: project?.name || "Projeto",
      billing_email: billingEmail,
      document_type: "other",
      document_number: "pending",
      address: {},
      gateway_provider: "other",
      provider_status: "active",
      metadata: {
        origin: BILLING_PROVISIONING_ORIGIN,
        plan_code: FREE_PLAN_CODE,
      },
    })
    .select("id")
    .single();

  if (!createError && createdAccount?.id) return createdAccount.id as string;
  if (!isDuplicateKeyError(createError)) throw createError;

  const { data: accountAfterConflict, error: conflictLookupError } = await supabaseAdmin
    .from("billing_accounts")
    .select("id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (conflictLookupError) throw conflictLookupError;
  if (!accountAfterConflict?.id) throw createError;
  return accountAfterConflict.id as string;
}

async function ensureProjectFreeTrialBilling(
  supabaseAdmin: SupabaseAdminClient,
  projectId: string,
  billingEmail: string,
) {
  const existingSubscription = await getExistingProjectSubscription(supabaseAdmin, projectId);
  if (existingSubscription?.id) {
    return { created: false, subscriptionId: existingSubscription.id };
  }

  const { data: planData, error: planError } = await supabaseAdmin
    .from("billing_plans")
    .select(
      "id, code, trial_days, base_price_cents, included_pass_installs, included_notification_sends, overage_pass_install_cents, overage_notification_sent_cents",
    )
    .eq("code", FREE_PLAN_CODE)
    .eq("is_active", true)
    .maybeSingle();

  if (planError) throw planError;
  const plan = planData as BillingPlanRow | null;
  if (!plan?.id) throw new Error("Plano free_trial ativo nao encontrado.");

  const billingAccountId = await getOrCreateBillingAccount(supabaseAdmin, projectId, billingEmail);

  const subscriptionAfterAccount = await getExistingProjectSubscription(supabaseAdmin, projectId);
  if (subscriptionAfterAccount?.id) {
    return { created: false, subscriptionId: subscriptionAfterAccount.id };
  }

  const now = new Date();
  const trialDays = Math.max(0, Number(plan.trial_days ?? 0));
  const status = trialDays > 0 ? "trialing" : "active";
  const trialEndsAt = trialDays > 0 ? addDays(now, trialDays) : null;
  const periodEnd = trialEndsAt ?? addMonths(now, 1);

  const { data: subscriptionData, error: subscriptionError } = await supabaseAdmin
    .from("billing_subscriptions")
    .insert({
      project_id: projectId,
      billing_account_id: billingAccountId,
      plan_id: plan.id,
      status,
      trial_started_at: trialDays > 0 ? now.toISOString() : null,
      trial_ends_at: trialEndsAt?.toISOString() ?? null,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      gateway_provider: "other",
      base_price_cents: plan.base_price_cents ?? 0,
      included_pass_installs: plan.included_pass_installs ?? 0,
      included_notification_sends: plan.included_notification_sends ?? 0,
      overage_pass_install_cents: plan.overage_pass_install_cents ?? 0,
      overage_notification_sent_cents: plan.overage_notification_sent_cents ?? 0,
      currency: "BRL",
      metadata: {
        origin: BILLING_PROVISIONING_ORIGIN,
        plan_code: FREE_PLAN_CODE,
      },
    })
    .select("id")
    .single();

  if (subscriptionError) {
    if (!isDuplicateKeyError(subscriptionError)) throw subscriptionError;

    const existingAfterConflict = await getExistingProjectSubscription(supabaseAdmin, projectId);
    if (existingAfterConflict?.id) {
      return { created: false, subscriptionId: existingAfterConflict.id };
    }

    throw subscriptionError;
  }

  const subscriptionId = subscriptionData.id as string;

  const { error: cycleError } = await supabaseAdmin.from("billing_cycles").insert({
    project_id: projectId,
    subscription_id: subscriptionId,
    cycle_type: "subscription",
    frequency: "monthly",
    period_start: now.toISOString(),
    period_end: periodEnd.toISOString(),
    status: "open",
    metadata: {
      origin: BILLING_PROVISIONING_ORIGIN,
      plan_code: FREE_PLAN_CODE,
    },
  });

  if (cycleError && !isDuplicateKeyError(cycleError)) throw cycleError;

  const { error: walletError } = await supabaseAdmin.from("billing_credit_wallets").upsert(
    {
      project_id: projectId,
      balance_credits: 0,
      low_balance_threshold: 0,
      auto_recharge_enabled: false,
    },
    { onConflict: "project_id", ignoreDuplicates: true },
  );

  if (walletError) throw walletError;

  const { error: notificationsError } = await supabaseAdmin.from("projects_notifications").upsert(
    {
      project_id: projectId,
      notifications_limit: plan.included_notification_sends ?? 0,
      total_notifications_sent: 0,
      recent_notifications_sent: 0,
      notifications_exp: periodEnd.toISOString(),
    },
    { onConflict: "project_id" },
  );

  if (notificationsError) throw notificationsError;

  return { created: true, subscriptionId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, projectId, role = "staff" } = await req.json().catch(() => ({}));
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedProjectId = String(projectId || "").trim();
    const requestedRole = String(role || "staff").trim().toLowerCase();

    if (!normalizedProjectId) throw new HttpError(400, "projectId e obrigatorio.", "missing_project");
    if (!normalizedEmail) throw new HttpError(400, "Email e obrigatorio.", "missing_email");
    if (!MEMBER_ROLES.has(requestedRole)) {
      throw new HttpError(400, "Papel de membro invalido.", "invalid_role");
    }

    const supabaseAdmin = getServiceClient();
    const caller = await getCallerProfile(supabaseAdmin, req);
    await ensureCanManageProjectMembers(supabaseAdmin, caller, normalizedProjectId);

    const { data: project, error: projectError } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", normalizedProjectId)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!project?.id) throw new HttpError(404, "Projeto nao encontrado.", "project_not_found");

    const { data: pendingInvitation, error: pendingError } = await supabaseAdmin
      .from("user_invitations")
      .select("id, invited_user_id")
      .eq("invite_type", "project_member")
      .eq("project_id", normalizedProjectId)
      .eq("email", normalizedEmail)
      .in("status", ["invited", "expired"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendingError) throw pendingError;

    const { data: otherProjectInvitation, error: otherProjectInvitationError } = await supabaseAdmin
      .from("user_invitations")
      .select("id")
      .eq("invite_type", "project_member")
      .eq("email", normalizedEmail)
      .in("status", ["invited", "expired"])
      .neq("project_id", normalizedProjectId)
      .limit(1)
      .maybeSingle();

    if (otherProjectInvitationError) throw otherProjectInvitationError;
    if (otherProjectInvitation?.id) {
      throw new HttpError(
        409,
        "Este email ja possui convite para outro projeto.",
        "project_member_invitation_conflict",
      );
    }

    const existingUser = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);

    if (existingUser?.id) {
      const currentProfile = await getProfileForUser(supabaseAdmin, existingUser.id);
      const hasExistingMembership = await hasAnyProjectMembership(supabaseAdmin, existingUser.id);
      const isSamePendingInviteUser = pendingInvitation?.invited_user_id === existingUser.id;

      if (hasExistingMembership) {
        throw new HttpError(
          409,
          "Este email ja esta vinculado a um projeto. Um login de restaurante nao pode pertencer a mais de um projeto.",
          "project_member_account_conflict",
        );
      }

      if (currentProfile?.role === "admin" || currentProfile?.role === "superadmin") {
        throw new HttpError(409, "Este email ja esta cadastrado como login administrativo.", "admin_login_conflict");
      }

      if (currentProfile?.role === "establishment") {
        throw new HttpError(
          409,
          "Este email ja possui uma conta de restaurante na Allinpass.",
          "restaurant_login_conflict",
        );
      }

      if (currentProfile?.role !== "customer" && !isSamePendingInviteUser) {
        throw new HttpError(
          409,
          "Este email ja possui uma conta na Allinpass. Convites de membro devem ser enviados apenas para emails sem conta.",
          "existing_account_conflict",
        );
      }
    }

    const { data: adminInvitation, error: adminInvitationError } = await supabaseAdmin
      .from("user_invitations")
      .select("id")
      .eq("invite_type", "admin")
      .eq("email", normalizedEmail)
      .in("status", ["invited", "expired"])
      .limit(1)
      .maybeSingle();

    if (adminInvitationError) throw adminInvitationError;
    if (adminInvitation?.id) {
      throw new HttpError(409, "Este email ja possui convite de login administrativo.", "admin_login_conflict");
    }

    const now = new Date();
    const expiresAt = addHours(now, 24).toISOString();
    const inviteNonce = crypto.randomUUID();

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
          invite_type: "project_member",
          role: requestedRole,
          project_id: normalizedProjectId,
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
        data: {
          invite_type: "project_member",
          project_id: normalizedProjectId,
          role: requestedRole,
        },
      });

      if (delivery.userId && delivery.userId !== existingUser?.id) {
        const { error: updateUserError } = await supabaseAdmin
          .from("user_invitations")
          .update({ invited_user_id: delivery.userId })
          .eq("id", invitationId);

        if (updateUserError) throw updateUserError;
      }

      await ensureProjectFreeTrialBilling(supabaseAdmin, normalizedProjectId, normalizedEmail);

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
    const status = error instanceof HttpError ? error.status : 400;
    console.error("Erro na funcao admin-create-member:", error);
    return jsonResponse(
      {
        error: error?.message || "Erro desconhecido na edge function",
        code: error?.code || null,
      },
      status,
    );
  }
});
