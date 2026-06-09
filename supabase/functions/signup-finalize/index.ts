import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

type BillingPlan = {
  id: string;
  code: string;
  name: string;
  base_price_cents: number;
  trial_days: number;
  included_pass_installs: number;
  included_notification_sends: number;
  overage_pass_install_cents: number;
  overage_notification_sent_cents: number;
};

type SignupCheckoutSessionRow = {
  id: string;
  status: string;
  provider: string;
  provider_checkout_id: string | null;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  provider_payment_id: string | null;
  amount_cents: number;
  paid_at: string | null;
};

type SupabaseAdminClient = ReturnType<typeof createClient>;

type SignupFinalizationStatus = "processing" | "completed" | "failed";

type SignupFinalizationRow = {
  status: SignupFinalizationStatus;
  response: Record<string, unknown> | null;
  updated_at: string | null;
  attempts: number | null;
};

type SignupFinalizationClaim =
  | { action: "proceed" }
  | { action: "completed"; response: Record<string, unknown> }
  | { action: "processing" };

type ExistingCustomerSignupIntentRow = {
  establishment_name: string;
  plan_code: string;
};

type ProjectMemberRow = {
  project_id: string;
  role: string;
};

type ProjectRow = {
  id: string;
  slug: string | null;
};

type BillingAccountRow = {
  id: string;
};

type BillingSubscriptionRow = {
  id: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
};

const FREE_PLAN_CODE = "free_trial";
const FINALIZATION_STALE_AFTER_MS = 2 * 60 * 1000;
const FINALIZATION_WAIT_ATTEMPTS = 20;
const FINALIZATION_WAIT_DELAY_MS = 350;

type SignupFinalizeErrorCode =
  | "SIGNUP_FINALIZE_METHOD_NOT_ALLOWED"
  | "SIGNUP_FINALIZE_MISSING_ENV"
  | "SIGNUP_FINALIZE_MISSING_AUTHORIZATION"
  | "SIGNUP_FINALIZE_INVALID_SESSION"
  | "SIGNUP_FINALIZE_MISSING_ESTABLISHMENT_NAME"
  | "SIGNUP_FINALIZE_MISSING_USER_EMAIL"
  | "SIGNUP_FINALIZE_PLAN_NOT_FOUND"
  | "SIGNUP_FINALIZE_CHECKOUT_NOT_FOUND"
  | "SIGNUP_FINALIZE_PAYMENT_NOT_CONFIRMED"
  | "SIGNUP_FINALIZE_PAYMENT_AMOUNT_MISMATCH"
  | "SIGNUP_FINALIZE_PROJECT_NOT_CREATED"
  | "SIGNUP_FINALIZE_IN_PROGRESS"
  | "SIGNUP_FINALIZE_INTERNAL_ERROR";

class SignupFinalizeError extends Error {
  code: SignupFinalizeErrorCode;
  status: number;

  constructor(code: SignupFinalizeErrorCode, message: string, status = 500) {
    super(message);
    this.name = "SignupFinalizeError";
    this.code = code;
    this.status = status;
  }
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new SignupFinalizeError(
      "SIGNUP_FINALIZE_MISSING_ENV",
      `Variavel de ambiente obrigatoria ausente: ${name}.`,
      500,
    );
  }
  return value;
}

function jsonResponse(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function errorResponse(
  origin: string | null,
  code: SignupFinalizeErrorCode,
  message: string,
  status: number,
) {
  return jsonResponse(origin, { error: message, code }, status);
}

function slugify(input: string) {
  const base = input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base.length ? base : "projeto";
}

function normalizePlanCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function resolvePlanCode({
  payloadPlanCode,
  metadataPlanCode,
  metadataPlanKey,
  intentPlanCode,
}: {
  payloadPlanCode: unknown;
  metadataPlanCode: unknown;
  metadataPlanKey: unknown;
  intentPlanCode: unknown;
}) {
  const payloadCode = normalizePlanCode(payloadPlanCode);
  const intentCode = normalizePlanCode(intentPlanCode);
  const metadataCode = normalizePlanCode(metadataPlanCode);
  const metadataKeyCode = normalizePlanCode(metadataPlanKey);
  const paidSignal = [intentCode, metadataCode, metadataKeyCode].find((code) =>
    code && code !== FREE_PLAN_CODE
  );

  if (payloadCode) {
    return payloadCode === FREE_PLAN_CODE && paidSignal
      ? paidSignal
      : payloadCode;
  }
  if (intentCode) return intentCode;

  // If old user_metadata says free_trial but plan_key says a paid plan,
  // prefer the paid signal so we fail closed and require checkout.
  if (
    metadataCode === FREE_PLAN_CODE &&
    metadataKeyCode &&
    metadataKeyCode !== FREE_PLAN_CODE
  ) {
    return metadataKeyCode;
  }

  return metadataCode || metadataKeyCode || FREE_PLAN_CODE;
}

function randomSuffix(length = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let output = "";
  for (let i = 0; i < length; i += 1) {
    output += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return output;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);

  if (next.getUTCDate() < day) {
    next.setUTCDate(0);
  }

  return next;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error: unknown) {
  if (error instanceof SignupFinalizeError) return error.code;
  if (typeof error === "object" && error && "code" in error) {
    return String((error as { code?: unknown }).code || "SIGNUP_FINALIZE_INTERNAL_ERROR");
  }
  return "SIGNUP_FINALIZE_INTERNAL_ERROR";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message || "Erro interno ao finalizar cadastro.");
  }
  return "Erro interno ao finalizar cadastro.";
}

function isUniqueViolation(error: unknown) {
  return getErrorCode(error) === "23505";
}

function buildFinalizationIdempotencyKey(userId: string) {
  return `signup-finalize:${userId}`;
}

function asFinalizationResponse(response: unknown) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;
  return response as Record<string, unknown>;
}

function withPasswordSetupRequirement(
  response: Record<string, unknown>,
  passwordSetupRequired: boolean,
) {
  const auth = response.auth;
  const currentAuth =
    auth && typeof auth === "object" && !Array.isArray(auth)
      ? auth as Record<string, unknown>
      : {};

  return {
    ...response,
    auth: {
      ...currentAuth,
      password_setup_required:
        Boolean(currentAuth.password_setup_required) || passwordSetupRequired,
    },
  };
}

async function getSignupFinalization(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
): Promise<SignupFinalizationRow | null> {
  const { data, error } = await supabaseAdmin
    .from("signup_finalizations")
    .select("status, response, updated_at, attempts")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as SignupFinalizationRow | null) ?? null;
}

async function reclaimSignupFinalization(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  row: SignupFinalizationRow,
): Promise<boolean> {
  const now = new Date();
  const updatePayload = {
    idempotency_key: buildFinalizationIdempotencyKey(userId),
    status: "processing",
    response: null,
    error_code: null,
    error_message: null,
    attempts: Math.max(1, Number(row.attempts ?? 1) + 1),
    started_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: null,
  };

  let query = supabaseAdmin
    .from("signup_finalizations")
    .update(updatePayload)
    .eq("user_id", userId);

  if (row.status === "failed") {
    query = query.eq("status", "failed");
  } else {
    const staleBefore = new Date(now.getTime() - FINALIZATION_STALE_AFTER_MS).toISOString();
    query = query.eq("status", "processing").lte("updated_at", staleBefore);
  }

  const { data, error } = await query.select("status").maybeSingle();
  if (error) throw error;

  return Boolean(data);
}

async function claimSignupFinalization(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
): Promise<SignupFinalizationClaim> {
  const now = new Date().toISOString();
  const { error: insertError } = await supabaseAdmin
    .from("signup_finalizations")
    .insert({
      user_id: userId,
      idempotency_key: buildFinalizationIdempotencyKey(userId),
      status: "processing",
      attempts: 1,
      started_at: now,
      updated_at: now,
    })
    .select("status")
    .single();

  if (!insertError) return { action: "proceed" };
  if (!isUniqueViolation(insertError)) throw insertError;

  const row = await getSignupFinalization(supabaseAdmin, userId);
  const completedResponse = asFinalizationResponse(row?.response);

  if (row?.status === "completed" && completedResponse) {
    return { action: "completed", response: completedResponse };
  }

  if (row?.status === "failed" || row?.status === "processing") {
    const reclaimed = await reclaimSignupFinalization(supabaseAdmin, userId, row);
    if (reclaimed) return { action: "proceed" };
  }

  return { action: "processing" };
}

async function waitForCompletedSignupFinalization(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
) {
  for (let attempt = 0; attempt < FINALIZATION_WAIT_ATTEMPTS; attempt += 1) {
    await delay(FINALIZATION_WAIT_DELAY_MS);
    const row = await getSignupFinalization(supabaseAdmin, userId);
    const completedResponse = asFinalizationResponse(row?.response);

    if (row?.status === "completed" && completedResponse) {
      return completedResponse;
    }

    if (row?.status === "failed") {
      return null;
    }
  }

  return null;
}

async function completeSignupFinalization(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  projectId: string,
  response: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("signup_finalizations")
    .update({
      status: "completed",
      project_id: projectId,
      response,
      error_code: null,
      error_message: null,
      updated_at: now,
      completed_at: now,
    })
    .eq("user_id", userId);

  if (error) throw error;
}

async function markSignupFinalizationFailed(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  error: unknown,
) {
  const { error: updateError } = await supabaseAdmin
    .from("signup_finalizations")
    .update({
      status: "failed",
      error_code: getErrorCode(error),
      error_message: getErrorMessage(error).slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("status", "processing");

  if (updateError) {
    console.error("signup-finalize failed to persist failure state", updateError);
  }
}

async function getExistingCustomerSignupIntent(
  supabaseAdmin: SupabaseAdminClient,
  email: string,
): Promise<ExistingCustomerSignupIntentRow | null> {
  if (!email) return null;

  const { data, error } = await supabaseAdmin
    .from("signup_existing_customer_intents")
    .select("establishment_name, plan_code")
    .eq("email", email)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw error;
  return (data as ExistingCustomerSignupIntentRow | null) ?? null;
}

async function completeExistingCustomerSignupIntent(
  supabaseAdmin: SupabaseAdminClient,
  email: string,
  userId: string,
) {
  if (!email) return;

  const { error } = await supabaseAdmin
    .from("signup_existing_customer_intents")
    .update({
      status: "completed",
      user_id: userId,
      completed_at: new Date().toISOString(),
    })
    .eq("email", email)
    .eq("status", "pending");

  if (error) throw error;
}

async function getPaidCheckoutSession(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  planId: string,
  checkoutSessionId: string,
): Promise<SignupCheckoutSessionRow> {
  const { data, error } = await supabaseAdmin
    .from("signup_checkout_sessions")
    .select(
      [
        "id",
        "status",
        "provider",
        "provider_checkout_id",
        "provider_subscription_id",
        "provider_customer_id",
        "provider_payment_id",
        "amount_cents",
        "paid_at",
      ].join(", "),
    )
    .eq("id", checkoutSessionId)
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .maybeSingle();

  if (error) throw error;

  const checkoutSession = data as SignupCheckoutSessionRow | null;
  if (!checkoutSession) {
    throw new SignupFinalizeError(
      "SIGNUP_FINALIZE_CHECKOUT_NOT_FOUND",
      "Checkout pago nao encontrado para este usuario e plano.",
      404,
    );
  }

  if (checkoutSession.status !== "paid") {
    throw new SignupFinalizeError(
      "SIGNUP_FINALIZE_PAYMENT_NOT_CONFIRMED",
      "Pagamento ainda nao confirmado pelo Asaas.",
      402,
    );
  }

  if (!checkoutSession.paid_at) {
    throw new SignupFinalizeError(
      "SIGNUP_FINALIZE_PAYMENT_NOT_CONFIRMED",
      "Pagamento confirmado sem data de pagamento.",
      409,
    );
  }

  if (!checkoutSession.provider_customer_id || !checkoutSession.provider_subscription_id) {
    throw new SignupFinalizeError(
      "SIGNUP_FINALIZE_PAYMENT_NOT_CONFIRMED",
      "Pagamento confirmado, aguardando vinculacao da assinatura no Asaas.",
      409,
    );
  }

  return checkoutSession;
}

function buildWalletDefaults(projectName: string) {
  return {
    type: "loyalty",
    title: projectName,
    description: `Cartao de beneficios ${projectName}`,
    organizationName: "Khaos Omni LTDA",
    passTypeIdentifier: "pass.com.khaosomni.carteira49",
    teamIdentifier: "JM2D9G6ZFB",
    colors: {
      text: "#ffffff",
      label: "#ffffff",
      background: "#6c5ce7",
    },
    images: {
      icon:
        "https://tjagxmusbnbipeeitsyi.supabase.co/storage/v1/object/public/pass-assets/templates/default/icon.png",
      appleLogo:
        "https://tjagxmusbnbipeeitsyi.supabase.co/storage/v1/object/public/pass-assets/templates/default/logo.png",
      googleLogo:
        "https://tjagxmusbnbipeeitsyi.supabase.co/storage/v1/object/public/pass-assets/templates/default/logo.png",
      appleStrip: null,
      googleHero: null,
    },
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  let supabaseAdmin: SupabaseAdminClient | null = null;
  let claimedFinalizationUserId: string | null = null;

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return errorResponse(
      origin,
      "SIGNUP_FINALIZE_METHOD_NOT_ALLOWED",
      "Metodo nao permitido.",
      405,
    );
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return errorResponse(
        origin,
        "SIGNUP_FINALIZE_MISSING_AUTHORIZATION",
        "Sessao autenticada obrigatoria.",
        401,
      );
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return errorResponse(
        origin,
        "SIGNUP_FINALIZE_INVALID_SESSION",
        "Sessao invalida ou expirada.",
        401,
      );
    }

    const email = String(user.email ?? "").trim().toLowerCase();

    if (!email) {
      return errorResponse(
        origin,
        "SIGNUP_FINALIZE_MISSING_USER_EMAIL",
        "Usuario autenticado sem email.",
        400,
      );
    }

    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const payload = await req.json().catch(() => ({}));
    const existingCustomerIntent = await getExistingCustomerSignupIntent(supabaseAdmin, email);
    const payloadEstablishmentName = String(payload.establishmentName ?? "").trim();
    const metadataEstablishmentName = String(user.user_metadata?.establishment_name ?? "").trim();
    const intentEstablishmentName = String(existingCustomerIntent?.establishment_name ?? "").trim();
    const payloadPlanCode = payload.planCode;
    const metadataPlanCode = user.user_metadata?.plan_code;
    const metadataPlanKey = user.user_metadata?.plan_key;
    const intentPlanCode = existingCustomerIntent?.plan_code;
    const checkoutSessionId = String(payload.checkoutSessionId ?? "").trim();
    const establishmentName = String(
      payloadEstablishmentName
        || metadataEstablishmentName
        || intentEstablishmentName
        || "",
    ).trim();
    const planCode = resolvePlanCode({
      payloadPlanCode,
      metadataPlanCode,
      metadataPlanKey,
      intentPlanCode,
    });

    if (!establishmentName) {
      return errorResponse(
        origin,
        "SIGNUP_FINALIZE_MISSING_ESTABLISHMENT_NAME",
        "Informe o nome do estabelecimento.",
        400,
      );
    }

    const { data: planData, error: planError } = await supabaseAdmin
      .from("billing_plans")
      .select(
        [
          "id",
          "code",
          "name",
          "base_price_cents",
          "trial_days",
          "included_pass_installs",
          "included_notification_sends",
          "overage_pass_install_cents",
          "overage_notification_sent_cents",
        ].join(", "),
      )
      .eq("code", planCode)
      .eq("is_active", true)
      .maybeSingle();

    if (planError) throw planError;
    const plan = planData as BillingPlan | null;

    if (!plan) {
      return errorResponse(
        origin,
        "SIGNUP_FINALIZE_PLAN_NOT_FOUND",
        "Plano ativo nao encontrado.",
        404,
      );
    }

    const isFreeTrial = plan.code === FREE_PLAN_CODE;
    let paidCheckoutSession: SignupCheckoutSessionRow | null = null;

    if (!isFreeTrial) {
      if (!checkoutSessionId) {
        return errorResponse(
          origin,
          "SIGNUP_FINALIZE_CHECKOUT_NOT_FOUND",
          "Informe a sessao de checkout paga para finalizar o cadastro.",
          400,
        );
      }

      paidCheckoutSession = await getPaidCheckoutSession(
        supabaseAdmin,
        user.id,
        plan.id,
        checkoutSessionId,
      );

      if (paidCheckoutSession.amount_cents !== plan.base_price_cents) {
        return errorResponse(
          origin,
          "SIGNUP_FINALIZE_PAYMENT_AMOUNT_MISMATCH",
          "Valor pago nao corresponde ao plano selecionado.",
          409,
        );
      }
    }

    const finalizationClaim = await claimSignupFinalization(supabaseAdmin, user.id);

    if (finalizationClaim.action === "completed") {
      await completeExistingCustomerSignupIntent(supabaseAdmin, email, user.id);
      return jsonResponse(
        origin,
        withPasswordSetupRequirement(finalizationClaim.response, Boolean(existingCustomerIntent)),
      );
    }

    if (finalizationClaim.action === "processing") {
      const completedResponse = await waitForCompletedSignupFinalization(supabaseAdmin, user.id);

      if (completedResponse) {
        return jsonResponse(
          origin,
          withPasswordSetupRequirement(completedResponse, Boolean(existingCustomerIntent)),
        );
      }

      return errorResponse(
        origin,
        "SIGNUP_FINALIZE_IN_PROGRESS",
        "Seu cadastro ja esta sendo finalizado. Aguarde alguns segundos e atualize a pagina.",
        409,
      );
    }

    claimedFinalizationUserId = user.id;

    const { error: profileError } = await supabaseAdmin.from("profiles").upsert(
      {
        id: user.id,
        email,
        name: establishmentName,
        role: "establishment",
      },
      { onConflict: "id" },
    );

    if (profileError) throw profileError;

    const { data: existingMemberData, error: memberLookupError } = await supabaseAdmin
      .from("project_members")
      .select("project_id, role")
      .eq("user_id", user.id)
      .eq("role", "owner")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberLookupError) throw memberLookupError;
    const existingMember = existingMemberData as unknown as ProjectMemberRow | null;

    let projectId = existingMember?.project_id ?? null;
    let projectSlug: string | null = null;
    let createdProject = false;

    if (!projectId) {
      const baseSlug = slugify(establishmentName);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const slug = `${baseSlug}-${randomSuffix(6)}`.slice(0, 64);
        const { data: projectData, error: projectError } = await supabaseAdmin
          .from("projects")
          .insert({
            name: establishmentName,
            slug,
            description: null,
            logo_url: null,
            auth_mode: "form_only",
          })
          .select("id, slug")
          .single();
        const project = projectData as unknown as ProjectRow | null;

        if (!projectError && project) {
          projectId = project.id;
          projectSlug = project.slug;
          createdProject = true;
          break;
        }

        if (projectError?.code !== "23505" || attempt === 2) {
          throw projectError;
        }
      }
    }

    if (!projectId) {
      throw new SignupFinalizeError(
        "SIGNUP_FINALIZE_PROJECT_NOT_CREATED",
        "Nao foi possivel criar o projeto do estabelecimento.",
        500,
      );
    }

    try {
      const { data: projectData } = await supabaseAdmin
        .from("projects")
        .select("slug")
        .eq("id", projectId)
        .maybeSingle();
      const project = projectData as unknown as Pick<ProjectRow, "slug"> | null;

      projectSlug = project?.slug ?? projectSlug;

      const { error: memberError } = await supabaseAdmin.from("project_members").upsert(
        {
          project_id: projectId,
          user_id: user.id,
          role: "owner",
        },
        { onConflict: "project_id,user_id" },
      );

      if (memberError) throw memberError;

      if (createdProject) {
        const { error: templateError } = await supabaseAdmin.from("wallet_templates").upsert(
          {
            project_id: projectId,
            name: "Template do Projeto",
            defaults: buildWalletDefaults(establishmentName),
          },
          { onConflict: "project_id" },
        );

        if (templateError) throw templateError;
      }

      const { data: existingAccountData, error: accountLookupError } = await supabaseAdmin
        .from("billing_accounts")
        .select("id")
        .eq("project_id", projectId)
        .maybeSingle();

      if (accountLookupError) throw accountLookupError;
      const existingAccount = existingAccountData as unknown as BillingAccountRow | null;

      let billingAccountId = existingAccount?.id ?? null;

      if (!billingAccountId) {
        const { data: billingAccountData, error: accountError } = await supabaseAdmin
          .from("billing_accounts")
          .insert({
            project_id: projectId,
            legal_name: establishmentName,
            billing_email: email,
            document_type: "other",
            document_number: "pending",
            address: {},
            gateway_provider: isFreeTrial ? "other" : "asaas",
            gateway_customer_id: paidCheckoutSession?.provider_customer_id ?? null,
            provider_status: "active",
            metadata: {
              origin: "signup_finalize",
              plan_code: plan.code,
              checkout_session_id: paidCheckoutSession?.id ?? null,
            },
          })
          .select("id")
          .single();

        if (accountError) throw accountError;
        const billingAccount = billingAccountData as unknown as BillingAccountRow;
        billingAccountId = billingAccount.id;
      } else if (!isFreeTrial && paidCheckoutSession?.provider_customer_id) {
        const { error: accountUpdateError } = await supabaseAdmin
          .from("billing_accounts")
          .update({
            gateway_provider: "asaas",
            gateway_customer_id: paidCheckoutSession.provider_customer_id,
          })
          .eq("id", billingAccountId);

        if (accountUpdateError) throw accountUpdateError;
      }

      const { data: existingSubscriptionData, error: subscriptionLookupError } = await supabaseAdmin
        .from("billing_subscriptions")
        .select("id, status, trial_ends_at, current_period_end")
        .eq("project_id", projectId)
        .in("status", ["trialing", "active", "past_due", "paused"])
        .limit(1)
        .maybeSingle();

      if (subscriptionLookupError) throw subscriptionLookupError;
      const existingSubscription = existingSubscriptionData as unknown as BillingSubscriptionRow | null;

      let subscriptionId = existingSubscription?.id ?? null;
      const now = new Date();
      const trialDays = isFreeTrial ? Math.max(0, Number(plan.trial_days ?? 0)) : 0;
      const status = isFreeTrial && trialDays > 0 ? "trialing" : "active";
      const trialEndsAt = isFreeTrial && trialDays > 0 ? addDays(now, trialDays) : null;
      const periodEnd = trialEndsAt ?? addMonths(now, 1);

      if (!subscriptionId) {
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
            gateway_provider: isFreeTrial ? "other" : "asaas",
            gateway_subscription_id: paidCheckoutSession?.provider_subscription_id ?? null,
            base_price_cents: plan.base_price_cents,
            included_pass_installs: plan.included_pass_installs ?? 0,
            included_notification_sends: plan.included_notification_sends ?? 0,
            overage_pass_install_cents: plan.overage_pass_install_cents ?? 0,
            overage_notification_sent_cents: plan.overage_notification_sent_cents ?? 0,
            currency: "BRL",
            metadata: {
              origin: "signup_finalize",
              plan_code: plan.code,
              checkout_session_id: paidCheckoutSession?.id ?? null,
              provider_checkout_id: paidCheckoutSession?.provider_checkout_id ?? null,
            },
          })
          .select("id")
          .single();

        if (subscriptionError) throw subscriptionError;
        const subscription = subscriptionData as unknown as BillingSubscriptionRow;
        subscriptionId = subscription.id;

        const { error: cycleError } = await supabaseAdmin.from("billing_cycles").insert({
          project_id: projectId,
          subscription_id: subscriptionId,
          cycle_type: "subscription",
          frequency: "monthly",
          period_start: now.toISOString(),
          period_end: periodEnd.toISOString(),
          status: "open",
          metadata: {
            origin: "signup_finalize",
            plan_code: plan.code,
            checkout_session_id: paidCheckoutSession?.id ?? null,
          },
        });

        if (cycleError) throw cycleError;
      }

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
          notifications_limit: plan.included_notification_sends,
          total_notifications_sent: 0,
          recent_notifications_sent: 0,
          notifications_exp: periodEnd.toISOString(),
        },
        { onConflict: "project_id", ignoreDuplicates: true },
      );

      if (notificationsError) throw notificationsError;

      const { error: userUpdateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        app_metadata: {
          ...user.app_metadata,
          signup_project_id: projectId,
          signup_plan_code: plan.code,
        },
        user_metadata: {
          ...user.user_metadata,
          establishment_name: establishmentName,
          plan_code: plan.code,
        },
      });

      if (userUpdateError) throw userUpdateError;

      const responseBody = {
        success: true,
        auth: {
          password_setup_required: Boolean(existingCustomerIntent),
        },
        project: {
          id: projectId,
          slug: projectSlug,
          name: establishmentName,
        },
        subscription: {
          id: subscriptionId,
          status: existingSubscription?.status ?? status,
          trial_ends_at: existingSubscription?.trial_ends_at ?? trialEndsAt?.toISOString() ?? null,
          current_period_end: existingSubscription?.current_period_end ?? periodEnd.toISOString(),
        },
        plan: {
          code: plan.code,
          name: plan.name,
          trial_days: trialDays,
        },
        checkout: paidCheckoutSession
          ? {
            id: paidCheckoutSession.id,
            provider: paidCheckoutSession.provider,
            provider_checkout_id: paidCheckoutSession.provider_checkout_id,
            paid_at: paidCheckoutSession.paid_at,
          }
          : null,
      };

      await completeSignupFinalization(supabaseAdmin, user.id, projectId, responseBody);
      await completeExistingCustomerSignupIntent(supabaseAdmin, email, user.id);
      claimedFinalizationUserId = null;

      if (paidCheckoutSession) {
        const { error: checkoutUpdateError } = await supabaseAdmin
          .from("signup_checkout_sessions")
          .update({
            status: "finalized",
            finalized_at: new Date().toISOString(),
          })
          .eq("id", paidCheckoutSession.id);

        if (checkoutUpdateError) {
          console.error("signup-finalize failed to mark checkout session finalized", checkoutUpdateError);
        }
      }

      return jsonResponse(origin, responseBody);
    } catch (error) {
      if (createdProject && projectId) {
        await supabaseAdmin.from("projects").delete().eq("id", projectId);
      }
      throw error;
    }
  } catch (error) {
    if (supabaseAdmin && claimedFinalizationUserId) {
      await markSignupFinalizationFailed(supabaseAdmin, claimedFinalizationUserId, error);
    }

    console.error("signup-finalize error", error);

    if (error instanceof SignupFinalizeError) {
      return errorResponse(origin, error.code, error.message, error.status);
    }

    return errorResponse(
      origin,
      "SIGNUP_FINALIZE_INTERNAL_ERROR",
      "Erro interno ao finalizar cadastro.",
      500,
    );
  }
});
