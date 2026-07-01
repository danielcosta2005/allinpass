import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";

const FREE_PLAN_CODE = "free_trial";
const BILLING_PROVISIONING_ORIGIN = "legacy_admin_create_member";

type SupabaseAdminClient = any;

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

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function generatePassword() {
  const length = 12;
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
  let retVal = "";
  for (let i = 0, n = charset.length; i < length; ++i) {
    retVal += charset.charAt(Math.floor(Math.random() * n));
  }
  return retVal;
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

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function normalizeOrigin(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    return new URL(raw).origin;
  } catch (_) {
    return "";
  }
}

function getInviteRedirectTo(req: Request) {
  const configuredBaseUrl =
    Deno.env.get("APP_BASE_URL") ||
    Deno.env.get("SITE_URL") ||
    Deno.env.get("PUBLIC_SITE_URL") ||
    Deno.env.get("FRONTEND_URL");

  const origin = normalizeOrigin(configuredBaseUrl) || normalizeOrigin(req.headers.get("Origin"));
  return origin ? `${origin}/reset-password?flow=invite` : undefined;
}

function getInviteOptions(req: Request, data: Record<string, unknown>) {
  const redirectTo = getInviteRedirectTo(req);
  return redirectTo ? { redirectTo, data } : { data };
}

async function getCallerProfile(supabaseAdmin: SupabaseAdminClient, req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new HttpError(401, "Missing Authorization header");

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw new HttpError(401, "Sessao invalida.");

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  return { user, profile };
}

async function assertCanManageProjectMembers(
  supabaseAdmin: SupabaseAdminClient,
  caller: { user: { id: string }; profile?: { role?: string } | null },
  projectId: string,
) {
  if (!projectId) throw new HttpError(400, "projectId e obrigatorio.");

  const callerRole = caller.profile?.role;
  if (callerRole === "superadmin") return;

  if (callerRole === "admin") {
    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("created_by", caller.user.id)
      .maybeSingle();

    if (error) throw error;
    if (project?.id) return;
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", caller.user.id)
    .maybeSingle();

  if (membershipError) throw membershipError;
  if (membership?.role === "owner") return;

  throw new HttpError(403, "Acesso negado. Apenas gestores podem convidar membros.");
}

function assertValidMemberRole(role: string) {
  if (!["owner", "staff"].includes(role)) {
    throw new HttpError(400, "Papel invalido para membro do projeto.");
  }
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

  const subscriptionPayload = {
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
  };

  const { data: subscriptionData, error: subscriptionError } = await supabaseAdmin
    .from("billing_subscriptions")
    .insert(subscriptionPayload)
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
    const { email, password, projectId: rawProjectId, role: rawRole } = await req.json().catch(() => ({}));
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const projectId = String(rawProjectId || "").trim();
    const role = String(rawRole || "").trim();
    const cleanPassword = typeof password === "string" ? password.trim() : "";

    if (!normalizedEmail) throw new HttpError(400, "Email e obrigatorio.");
    if (!projectId) throw new HttpError(400, "projectId e obrigatorio.");
    assertValidMemberRole(role);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const caller = await getCallerProfile(supabaseAdmin, req);
    await assertCanManageProjectMembers(supabaseAdmin, caller, projectId);

    if (cleanPassword && caller.profile?.role !== "superadmin") {
      throw new HttpError(403, "Apenas superadmins podem definir senha diretamente.");
    }

    if (cleanPassword && cleanPassword.length < 6) {
      throw new HttpError(400, "A senha deve ter no minimo 6 caracteres.");
    }

    let userId: string | null = null;
    let inviteSent = false;

    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw listError;

    const existingUser = users.find(u => u.email?.toLowerCase() === normalizedEmail);

    if (existingUser) {
      // User existe -> get id.
      userId = existingUser.id;
    } else {
      // User não existe
      if (cleanPassword) {
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: normalizedEmail,
          password: cleanPassword,
          email_confirm: true,
        });
        if (createError) throw createError;
        userId = newUser.user.id;
      } else {
        const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
          normalizedEmail,
          getInviteOptions(req, {
            invited_project_id: projectId,
            invited_project_role: role,
          }),
        );
        if (inviteError) throw inviteError;
        userId = invited.user?.id ?? null;
        inviteSent = true;
      }
    }

    if (!userId) throw new Error("Não foi possível determinar o userId.");

    const { data: currentProfile, error: profileLookupError } = await supabaseAdmin
      .from("profiles")
      .select("role, created_at")
      .eq("id", userId)
      .maybeSingle();

    if (profileLookupError) throw profileLookupError;
    if (["superadmin", "admin"].includes(currentProfile?.role || "")) {
      throw new HttpError(409, "Este usuario ja possui acesso administrativo.");
    }

    const profileRole = currentProfile?.role === "customer"
      ? "establishment"
      : currentProfile?.role || "establishment";

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        id: userId,
        email: normalizedEmail,
        role: profileRole,
        created_at: currentProfile?.created_at || new Date().toISOString(),
      }, { onConflict: "id" });

    if (profileError) throw profileError;

    const { error: linkError } = await supabaseAdmin
      .from("project_members")
      .upsert({
        project_id: projectId,
        user_id: userId,
        role, // staff or owner
      }, { onConflict: "project_id,user_id" });

    if (linkError) throw linkError;

    await ensureProjectFreeTrialBilling(supabaseAdmin, projectId, normalizedEmail);

    return new Response(JSON.stringify({ success: true, userId, inviteSent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error: any) {
    console.error("Erro na função admin-create-member:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: error instanceof HttpError ? error.status : 400,
    });
  }
});
