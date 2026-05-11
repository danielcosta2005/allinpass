import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

type BillingPlan = {
  id: string;
  code: string;
  name: string;
  base_price_cents: number;
  included_passes: number;
  overage_price_cents: number;
  trial_days: number;
  included_pass_installs: number;
  included_notification_sends: number;
  overage_pass_install_cents: number;
  overage_notification_sent_cents: number;
};

const FREE_PLAN_CODE = "free_trial";

type SignupFinalizeErrorCode =
  | "SIGNUP_FINALIZE_METHOD_NOT_ALLOWED"
  | "SIGNUP_FINALIZE_MISSING_ENV"
  | "SIGNUP_FINALIZE_MISSING_AUTHORIZATION"
  | "SIGNUP_FINALIZE_INVALID_SESSION"
  | "SIGNUP_FINALIZE_MISSING_ESTABLISHMENT_NAME"
  | "SIGNUP_FINALIZE_MISSING_USER_EMAIL"
  | "SIGNUP_FINALIZE_UNSUPPORTED_PLAN"
  | "SIGNUP_FINALIZE_PLAN_NOT_FOUND"
  | "SIGNUP_FINALIZE_PROJECT_NOT_CREATED"
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

    const payload = await req.json().catch(() => ({}));
    const establishmentName = String(
      payload.establishmentName ?? user.user_metadata?.establishment_name ?? "",
    ).trim();
    const planCode = String(payload.planCode ?? user.user_metadata?.plan_code ?? FREE_PLAN_CODE).trim();
    const email = String(user.email ?? "").trim().toLowerCase();

    if (!establishmentName) {
      return errorResponse(
        origin,
        "SIGNUP_FINALIZE_MISSING_ESTABLISHMENT_NAME",
        "Informe o nome do estabelecimento.",
        400,
      );
    }

    if (!email) {
      return errorResponse(
        origin,
        "SIGNUP_FINALIZE_MISSING_USER_EMAIL",
        "Usuario autenticado sem email.",
        400,
      );
    }

    if (planCode !== FREE_PLAN_CODE) {
      return errorResponse(
        origin,
        "SIGNUP_FINALIZE_UNSUPPORTED_PLAN",
        "Por enquanto o cadastro automatico aceita apenas o plano Free Trial.",
        400,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: planData, error: planError } = await supabaseAdmin
      .from("billing_plans")
      .select(
        [
          "id",
          "code",
          "name",
          "base_price_cents",
          "included_passes",
          "overage_price_cents",
          "trial_days",
          "included_pass_installs",
          "included_notification_sends",
          "overage_pass_install_cents",
          "overage_notification_sent_cents",
        ].join(", "),
      )
      .eq("code", FREE_PLAN_CODE)
      .eq("is_active", true)
      .maybeSingle();

    if (planError) throw planError;
    const plan = planData as BillingPlan | null;

    if (!plan) {
      return errorResponse(
        origin,
        "SIGNUP_FINALIZE_PLAN_NOT_FOUND",
        "Plano Free Trial ativo nao encontrado.",
        404,
      );
    }

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

    const { data: existingMember, error: memberLookupError } = await supabaseAdmin
      .from("project_members")
      .select("project_id, role")
      .eq("user_id", user.id)
      .eq("role", "owner")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberLookupError) throw memberLookupError;

    let projectId = existingMember?.project_id ?? null;
    let projectSlug: string | null = null;
    let createdProject = false;

    if (!projectId) {
      const baseSlug = slugify(establishmentName);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const slug = `${baseSlug}-${randomSuffix(6)}`.slice(0, 64);
        const { data: project, error: projectError } = await supabaseAdmin
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
      const { data: project } = await supabaseAdmin
        .from("projects")
        .select("slug")
        .eq("id", projectId)
        .maybeSingle();

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

      const { data: existingAccount, error: accountLookupError } = await supabaseAdmin
        .from("billing_accounts")
        .select("id")
        .eq("project_id", projectId)
        .maybeSingle();

      if (accountLookupError) throw accountLookupError;

      let billingAccountId = existingAccount?.id ?? null;

      if (!billingAccountId) {
        const { data: billingAccount, error: accountError } = await supabaseAdmin
          .from("billing_accounts")
          .insert({
            project_id: projectId,
            legal_name: establishmentName,
            billing_email: email,
            document_type: "other",
            document_number: "pending",
            address: {},
            gateway_provider: "other",
            provider_status: "active",
            metadata: { origin: "signup_finalize", plan_code: FREE_PLAN_CODE },
          })
          .select("id")
          .single();

        if (accountError) throw accountError;
        billingAccountId = billingAccount.id;
      }

      const { data: existingSubscription, error: subscriptionLookupError } = await supabaseAdmin
        .from("billing_subscriptions")
        .select("id, status, trial_ends_at, current_period_end")
        .eq("project_id", projectId)
        .in("status", ["trialing", "active", "past_due", "paused"])
        .limit(1)
        .maybeSingle();

      if (subscriptionLookupError) throw subscriptionLookupError;

      let subscriptionId = existingSubscription?.id ?? null;
      const now = new Date();
      const trialDays = Math.max(0, Number(plan.trial_days ?? 0));
      const status = trialDays > 0 ? "trialing" : "active";
      const trialEndsAt = trialDays > 0 ? addDays(now, trialDays) : null;
      const periodEnd = trialEndsAt ?? addMonths(now, 1);

      if (!subscriptionId) {
        const { data: subscription, error: subscriptionError } = await supabaseAdmin
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
            base_price_cents: plan.base_price_cents,
            included_passes: plan.included_passes ?? plan.included_pass_installs ?? 0,
            overage_price_cents: plan.overage_price_cents ?? plan.overage_pass_install_cents ?? 0,
            included_pass_installs: plan.included_pass_installs ?? 0,
            included_notification_sends: plan.included_notification_sends ?? 0,
            overage_pass_install_cents: plan.overage_pass_install_cents ?? 0,
            overage_notification_sent_cents: plan.overage_notification_sent_cents ?? 0,
            currency: "BRL",
            metadata: { origin: "signup_finalize", plan_code: FREE_PLAN_CODE },
          })
          .select("id")
          .single();

        if (subscriptionError) throw subscriptionError;
        subscriptionId = subscription.id;

        const { error: cycleError } = await supabaseAdmin.from("billing_cycles").insert({
          project_id: projectId,
          subscription_id: subscriptionId,
          cycle_type: "subscription",
          frequency: "monthly",
          period_start: now.toISOString(),
          period_end: periodEnd.toISOString(),
          status: "open",
          metadata: { origin: "signup_finalize", plan_code: FREE_PLAN_CODE },
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
          signup_plan_code: FREE_PLAN_CODE,
        },
        user_metadata: {
          ...user.user_metadata,
          establishment_name: establishmentName,
          plan_code: FREE_PLAN_CODE,
        },
      });

      if (userUpdateError) throw userUpdateError;

      return jsonResponse(origin, {
        success: true,
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
      });
    } catch (error) {
      if (createdProject && projectId) {
        await supabaseAdmin.from("projects").delete().eq("id", projectId);
      }
      throw error;
    }
  } catch (error) {
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
