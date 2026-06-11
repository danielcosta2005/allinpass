import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";

const FREE_PLAN_CODE = "free_trial";
const BILLING_PROVISIONING_ORIGIN = "legacy_admin_create_member";

type SupabaseAdminClient = ReturnType<typeof createClient>;

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

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function getCaller(supabaseAdmin: any, req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new HttpError(401, "Missing Authorization header");

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw new HttpError(401, "Sessão inválida.");

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  return { user, profile };
}

async function ensureCanManageStaffMembers(supabaseAdmin: any, caller: any, projectId: string) {
  if (caller.profile?.role === "superadmin") return;

  const { data: membership, error } = await supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", caller.user.id)
    .maybeSingle();

  if (error) throw error;
  if (membership?.role !== "owner") {
    throw new HttpError(403, "Acesso negado. Apenas gestores do projeto ou superadmins podem convidar membros da equipe.");
  }
}

function ensureStaffRole(role: unknown) {
  if (role !== "staff") {
    throw new HttpError(400, "Apenas membros com papel staff podem ser adicionados por este fluxo.");
  }
}

async function ensureConfirmedUser(supabaseAdmin: any, userId: string) {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    email_confirm: true,
  });

  if (error) throw error;
}

async function ensureTargetCanBeStaffMember(supabaseAdmin: any, projectId: string, userId: string) {
  const { data: member, error } = await supabaseAdmin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (member && member.role !== "staff") {
    throw new HttpError(403, "Apenas membros staff podem ser gerenciados por este fluxo.");
  }
}

async function ensureEstablishmentProfile(supabaseAdmin: any, userId: string, email: string) {
  const { data: profile, error: profileReadError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profileReadError) throw profileReadError;
  if (profile?.role === "superadmin" || profile?.role === "admin") return;

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert({
      id: userId,
      email,
      role: "establishment",
      created_at: new Date().toISOString(),
    }, { onConflict: "id" });

  if (profileError) throw profileError;
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
    const { email, password, projectId, role } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail) throw new HttpError(400, "Email é obrigatório.");
    if (!projectId) throw new HttpError(400, "projectId é obrigatório.");
    ensureStaffRole(role);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error("Variáveis de ambiente do Supabase não configuradas.");
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const caller = await getCaller(supabaseAdmin, req);
    await ensureCanManageStaffMembers(supabaseAdmin, caller, projectId);

    let userId: string | null = null;
    let inviteSent = false;

    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw listError;

    const existingUser = users.find((u: any) => u.email?.toLowerCase() === normalizedEmail);

    if (existingUser) {
      userId = existingUser.id;
      await ensureConfirmedUser(supabaseAdmin, userId);
    } else if (password && password.trim().length > 0) {
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password: password.trim(),
        email_confirm: true,
      });
      if (createError) throw createError;
      userId = newUser.user.id;
    } else {
      const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail);
      if (inviteError) throw inviteError;
      userId = invited.user?.id ?? null;
      inviteSent = true;
    }

    if (!userId) throw new Error("Não foi possível determinar o userId.");
    await ensureTargetCanBeStaffMember(supabaseAdmin, projectId, userId);

    await ensureEstablishmentProfile(supabaseAdmin, userId, normalizedEmail);

    const { error: linkError } = await supabaseAdmin
      .from("project_members")
      .upsert({
        project_id: projectId,
        user_id: userId,
        role: "staff",
      }, { onConflict: "project_id,user_id" });

    if (linkError) throw linkError;

    const billingEmail = String(caller.user?.email || normalizedEmail).trim().toLowerCase();
    await ensureProjectFreeTrialBilling(supabaseAdmin, projectId, billingEmail || normalizedEmail);

    return jsonResponse({ success: true, userId, inviteSent });
  } catch (error) {
    console.error("Erro na função admin-create-member:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro desconhecido." },
      error instanceof HttpError ? error.status : 400,
    );
  }
});
