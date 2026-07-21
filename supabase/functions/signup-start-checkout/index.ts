import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders } from "./cors.ts";

type BillingPlan = {
  id: string;
  code: string;
  name: string;
  base_price_cents: number;
  billing_interval: string;
};

type CheckoutSession = {
  id: string;
  provider_checkout_id: string | null;
  checkout_url: string | null;
  expires_at: string | null;
  status: string;
  amount_cents: number | null;
  affiliate_link_id: string | null;
  affiliate_seller_id: string | null;
  affiliate_code: string | null;
  affiliate_discount_bps: number | null;
  affiliate_discount_cents: number | null;
  affiliate_original_amount_cents: number | null;
};

type AffiliateLinkRow = {
  id: string;
  seller_id: string;
  code: string;
  status: string;
};

type AffiliateSellerRow = {
  id: string;
  status: string;
};

type AffiliateContext = {
  linkId: string;
  sellerId: string;
  code: string;
  discountBps: number;
  discountCents: number;
  originalAmountCents: number;
  checkoutAmountCents: number;
};

type SupabaseAdminClient = SupabaseClient<any, "public", any>;

const FREE_PLAN_CODE = "free_trial";
const DEFAULT_CHECKOUT_EXPIRATION_MINUTES = 60;
const AFFILIATE_DISCOUNT_BPS = 1000;
const AFFILIATE_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{5,39}$/;

class SignupCheckoutError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "SignupCheckoutError";
    this.code = code;
    this.status = status;
  }
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new SignupCheckoutError(
      "SIGNUP_CHECKOUT_MISSING_ENV",
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

function errorResponse(origin: string | null, error: SignupCheckoutError) {
  return jsonResponse(
    origin,
    { error: error.message, code: error.code },
    error.status,
  );
}

function normalizePlanCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function normalizeAffiliateRef(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);

  return AFFILIATE_CODE_PATTERN.test(normalized) ? normalized : "";
}

function calculateDiscountCents(amountCents: number, discountBps: number) {
  return Math.max(0, Math.floor((amountCents * discountBps) / 10_000));
}

function getAsaasApiBaseUrl() {
  const explicit = String(Deno.env.get("ASAAS_API_BASE_URL") ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const env = String(Deno.env.get("ASAAS_ENV") ?? "sandbox").trim()
    .toLowerCase();
  return env === "production"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
}

function getAsaasCheckoutBaseUrl() {
  const explicit = String(Deno.env.get("ASAAS_CHECKOUT_BASE_URL") ?? "").trim();
  if (explicit) return explicit.replace(/[?&]+$/, "");

  const env = String(Deno.env.get("ASAAS_ENV") ?? "sandbox").trim()
    .toLowerCase();
  return env === "production"
    ? "https://asaas.com/checkoutSession/show"
    : "https://sandbox.asaas.com/checkoutSession/show";
}

function getAppBaseUrl(origin: string | null) {
  return String(
    Deno.env.get("ASAAS_CALLBACK_BASE_URL") ??
      Deno.env.get("APP_BASE_URL") ??
      origin ??
      "",
  ).trim().replace(/\/+$/, "");
}

function isPrivateIpv4(hostname: string) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;

  const [first, second] = octets;
  return first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 0 && second === 0);
}

function assertPublicHttpsAppBaseUrl(appBaseUrl: string) {
  let parsed: URL;

  try {
    parsed = new URL(appBaseUrl);
  } catch {
    throw new SignupCheckoutError(
      "SIGNUP_CHECKOUT_INVALID_APP_BASE_URL",
      "Configure ASAAS_CALLBACK_BASE_URL ou APP_BASE_URL com uma URL publica HTTPS valida.",
      500,
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalHost = hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local");

  if (
    parsed.protocol !== "https:" ||
    isLocalHost ||
    isPrivateIpv4(hostname)
  ) {
    throw new SignupCheckoutError(
      "SIGNUP_CHECKOUT_INVALID_APP_BASE_URL",
      "O Asaas nao aceita callbacks em localhost ou URL privada. Configure ASAAS_CALLBACK_BASE_URL ou APP_BASE_URL com uma URL publica HTTPS, como um dominio de staging ou tunnel HTTPS.",
      500,
    );
  }
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatAsaasDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildCheckoutUrl(providerCheckoutId: string) {
  const base = getAsaasCheckoutBaseUrl();
  return `${base}?id=${encodeURIComponent(providerCheckoutId)}`;
}

function buildSignupRedirectUrl(
  appBaseUrl: string,
  params: Record<string, string>,
) {
  const url = new URL("/cadastro", `${appBaseUrl}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

async function resolveAffiliateContext(
  supabaseAdmin: SupabaseAdminClient,
  affiliateRef: string,
  plan: BillingPlan,
): Promise<AffiliateContext | null> {
  const code = normalizeAffiliateRef(affiliateRef);
  if (!code) return null;

  const { data: linkData, error: linkError } = await supabaseAdmin
    .from("affiliate_links")
    .select("id, seller_id, code, status")
    .ilike("code", code)
    .eq("status", "active")
    .maybeSingle();

  if (linkError) {
    throw new SignupCheckoutError(
      "SIGNUP_CHECKOUT_AFFILIATE_LOOKUP_FAILED",
      "Nao foi possivel validar o link de afiliado.",
      500,
    );
  }

  const link = linkData as AffiliateLinkRow | null;
  if (!link?.id || !link.seller_id) return null;

  const { data: sellerData, error: sellerError } = await supabaseAdmin
    .from("affiliate_sellers")
    .select("id, status")
    .eq("id", link.seller_id)
    .eq("status", "active")
    .maybeSingle();

  if (sellerError) {
    throw new SignupCheckoutError(
      "SIGNUP_CHECKOUT_AFFILIATE_LOOKUP_FAILED",
      "Nao foi possivel validar o vendedor afiliado.",
      500,
    );
  }

  const seller = sellerData as AffiliateSellerRow | null;
  if (!seller?.id) return null;

  const originalAmountCents = Math.max(
    0,
    Math.trunc(Number(plan.base_price_cents || 0)),
  );
  const discountCents = calculateDiscountCents(
    originalAmountCents,
    AFFILIATE_DISCOUNT_BPS,
  );
  const checkoutAmountCents = Math.max(0, originalAmountCents - discountCents);

  return {
    linkId: link.id,
    sellerId: seller.id,
    code: normalizeAffiliateRef(link.code) || code,
    discountBps: AFFILIATE_DISCOUNT_BPS,
    discountCents,
    originalAmountCents,
    checkoutAmountCents,
  };
}

function getAsaasErrorMessage(payload: unknown) {
  if (payload && typeof payload === "object" && "errors" in payload) {
    const errors = (payload as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return errors
        .map((item) => {
          if (item && typeof item === "object" && "description" in item) {
            return String(
              (item as { description?: unknown }).description ?? "",
            );
          }
          return "";
        })
        .filter(Boolean)
        .join(" ");
    }
  }

  if (payload && typeof payload === "object" && "message" in payload) {
    return String((payload as { message?: unknown }).message ?? "");
  }

  return "";
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return errorResponse(
      origin,
      new SignupCheckoutError(
        "SIGNUP_CHECKOUT_METHOD_NOT_ALLOWED",
        "Metodo nao permitido.",
        405,
      ),
    );
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const asaasApiKey = requiredEnv("ASAAS_API_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      throw new SignupCheckoutError(
        "SIGNUP_CHECKOUT_MISSING_AUTHORIZATION",
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
      throw new SignupCheckoutError(
        "SIGNUP_CHECKOUT_INVALID_SESSION",
        "Sessao invalida ou expirada.",
        401,
      );
    }

    const payload = await req.json().catch(() => ({}));
    const establishmentName = String(
      payload.establishmentName ?? user.user_metadata?.establishment_name ?? "",
    ).trim();
    const planCode = normalizePlanCode(
      payload.planCode ?? user.user_metadata?.plan_code,
    );
    const affiliateRef = normalizeAffiliateRef(
      payload.affiliateRef ?? payload.ref ?? user.user_metadata?.affiliate_ref,
    );
    const email = String(user.email ?? "").trim().toLowerCase();

    if (!email) {
      throw new SignupCheckoutError(
        "SIGNUP_CHECKOUT_MISSING_USER_EMAIL",
        "Usuario autenticado sem email.",
        400,
      );
    }

    if (!establishmentName) {
      throw new SignupCheckoutError(
        "SIGNUP_CHECKOUT_MISSING_ESTABLISHMENT_NAME",
        "Informe o nome do estabelecimento.",
        400,
      );
    }

    if (!planCode || planCode === FREE_PLAN_CODE) {
      throw new SignupCheckoutError(
        "SIGNUP_CHECKOUT_UNSUPPORTED_PLAN",
        "Checkout pago exige um plano pago.",
        400,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: planData, error: planError } = await supabaseAdmin
      .from("billing_plans")
      .select("id, code, name, base_price_cents, billing_interval")
      .eq("code", planCode)
      .eq("is_active", true)
      .eq("billing_interval", "monthly")
      .maybeSingle();

    if (planError) throw planError;
    const plan = planData as BillingPlan | null;

    if (!plan || plan.base_price_cents <= 0) {
      throw new SignupCheckoutError(
        "SIGNUP_CHECKOUT_PLAN_NOT_FOUND",
        "Plano pago ativo nao encontrado.",
        404,
      );
    }

    const affiliateContext = await resolveAffiliateContext(
      supabaseAdmin,
      affiliateRef,
      plan,
    );
    const checkoutAmountCents = affiliateContext?.checkoutAmountCents ??
      plan.base_price_cents;

    let reusableSessionQuery = supabaseAdmin
      .from("signup_checkout_sessions")
      .select(
        [
          "id",
          "provider_checkout_id",
          "checkout_url",
          "expires_at",
          "status",
          "amount_cents",
          "affiliate_link_id",
          "affiliate_seller_id",
          "affiliate_code",
          "affiliate_discount_bps",
          "affiliate_discount_cents",
          "affiliate_original_amount_cents",
        ].join(", "),
      )
      .eq("user_id", user.id)
      .eq("plan_id", plan.id)
      .in("status", ["pending", "created"])
      .gt("expires_at", new Date().toISOString());

    reusableSessionQuery = affiliateContext
      ? reusableSessionQuery.eq("affiliate_link_id", affiliateContext.linkId)
      : reusableSessionQuery.is("affiliate_link_id", null);

    const { data: reusableSessionData, error: reusableSessionError } =
      await reusableSessionQuery
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (reusableSessionError) throw reusableSessionError;

    const reusableSession = reusableSessionData as CheckoutSession | null;
    if (reusableSession?.checkout_url) {
      return jsonResponse(origin, {
        success: true,
        checkout_session_id: reusableSession.id,
        provider: "asaas",
        provider_checkout_id: reusableSession.provider_checkout_id,
        checkout_url: reusableSession.checkout_url,
        expires_at: reusableSession.expires_at,
        reused: true,
        amount_cents: reusableSession.amount_cents,
        affiliate_ref: reusableSession.affiliate_code,
        affiliate_discount_bps: reusableSession.affiliate_discount_bps ?? 0,
        affiliate_discount_cents: reusableSession.affiliate_discount_cents ?? 0,
        affiliate_original_amount_cents:
          reusableSession.affiliate_original_amount_cents ?? null,
      });
    }

    const appBaseUrl = getAppBaseUrl(origin);
    if (!appBaseUrl) {
      throw new SignupCheckoutError(
        "SIGNUP_CHECKOUT_MISSING_APP_BASE_URL",
        "ASAAS_CALLBACK_BASE_URL ou APP_BASE_URL ausente.",
        500,
      );
    }
    assertPublicHttpsAppBaseUrl(appBaseUrl);

    const expiresAt = addMinutes(
      new Date(),
      DEFAULT_CHECKOUT_EXPIRATION_MINUTES,
    );
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("signup_checkout_sessions")
      .insert({
        user_id: user.id,
        plan_id: plan.id,
        plan_code: plan.code,
        email,
        establishment_name: establishmentName,
        provider: "asaas",
        external_reference: crypto.randomUUID(),
        status: "pending",
        amount_cents: checkoutAmountCents,
        currency: "BRL",
        affiliate_link_id: affiliateContext?.linkId ?? null,
        affiliate_seller_id: affiliateContext?.sellerId ?? null,
        affiliate_code: affiliateContext?.code ?? null,
        affiliate_discount_bps: affiliateContext?.discountBps ?? 0,
        affiliate_discount_cents: affiliateContext?.discountCents ?? 0,
        affiliate_original_amount_cents:
          affiliateContext?.originalAmountCents ?? null,
        expires_at: expiresAt.toISOString(),
        metadata: {
          origin: "signup_start_checkout",
          affiliate: affiliateContext
            ? {
              code: affiliateContext.code,
              discount_bps: affiliateContext.discountBps,
              discount_cents: affiliateContext.discountCents,
              original_amount_cents: affiliateContext.originalAmountCents,
            }
            : null,
        },
      })
      .select(
        "id, external_reference, success_url, cancel_url, expired_url, expires_at",
      )
      .single();

    if (sessionError) throw sessionError;

    const session = sessionData as {
      id: string;
      external_reference: string;
      success_url: string;
      cancel_url: string;
      expired_url: string;
      expires_at: string;
    };

    const callbackUrls = {
      success_url: buildSignupRedirectUrl(appBaseUrl, {
        plano: plan.code,
        planCode: plan.code,
        finalizar: "1",
        checkout: "success",
        checkoutSessionId: session.id,
        ref: affiliateContext?.code ?? "",
      }),
      cancel_url: buildSignupRedirectUrl(appBaseUrl, {
        plano: plan.code,
        planCode: plan.code,
        checkout: "cancel",
        checkoutSessionId: session.id,
        ref: affiliateContext?.code ?? "",
      }),
      expired_url: buildSignupRedirectUrl(appBaseUrl, {
        plano: plan.code,
        planCode: plan.code,
        checkout: "expired",
        checkoutSessionId: session.id,
        ref: affiliateContext?.code ?? "",
      }),
    };

    const { error: callbackUrlError } = await supabaseAdmin
      .from("signup_checkout_sessions")
      .update(callbackUrls)
      .eq("id", session.id);

    if (callbackUrlError) throw callbackUrlError;

    const asaasPayload = {
      billingTypes: ["CREDIT_CARD"],
      chargeTypes: ["RECURRENT"],
      minutesToExpire: DEFAULT_CHECKOUT_EXPIRATION_MINUTES,
      externalReference: session.external_reference,
      callback: {
        successUrl: callbackUrls.success_url,
        cancelUrl: callbackUrls.cancel_url,
        expiredUrl: callbackUrls.expired_url,
      },
      items: [
        {
          name: plan.name,
          description: affiliateContext
            ? `Assinatura mensal AllinPass - ${plan.name} (10% de desconto no primeiro mes)`
            : `Assinatura mensal AllinPass - ${plan.name}`,
          quantity: 1,
          value: checkoutAmountCents / 100,
        },
      ],
      subscription: {
        cycle: "MONTHLY",
        nextDueDate: formatAsaasDate(new Date()),
      },
    };

    const asaasResponse = await fetch(`${getAsaasApiBaseUrl()}/checkouts`, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "access_token": asaasApiKey,
        "User-Agent": "AllinPass/1.0",
      },
      body: JSON.stringify(asaasPayload),
    });

    const asaasBody = await asaasResponse.json().catch(() => ({}));

    if (!asaasResponse.ok) {
      const message = getAsaasErrorMessage(asaasBody) ||
        "Nao foi possivel criar checkout no Asaas.";
      await supabaseAdmin
        .from("signup_checkout_sessions")
        .update({
          status: "failed",
          metadata: {
            origin: "signup_start_checkout",
            affiliate: affiliateContext
              ? {
                code: affiliateContext.code,
                discount_bps: affiliateContext.discountBps,
                discount_cents: affiliateContext.discountCents,
                original_amount_cents: affiliateContext.originalAmountCents,
              }
              : null,
            asaas_request: asaasPayload,
            asaas_response: asaasBody,
          },
        })
        .eq("id", session.id);

      throw new SignupCheckoutError(
        "SIGNUP_CHECKOUT_ASAAS_ERROR",
        message,
        502,
      );
    }

    const providerCheckoutId = String((asaasBody as { id?: unknown }).id ?? "")
      .trim();
    if (!providerCheckoutId) {
      throw new SignupCheckoutError(
        "SIGNUP_CHECKOUT_ASAAS_MISSING_ID",
        "Asaas nao retornou o ID do checkout.",
        502,
      );
    }

    const checkoutUrl =
      String((asaasBody as { link?: unknown }).link ?? "").trim() ||
      buildCheckoutUrl(providerCheckoutId);

    const { error: updateError } = await supabaseAdmin
      .from("signup_checkout_sessions")
      .update({
        provider_checkout_id: providerCheckoutId,
        checkout_url: checkoutUrl,
        status: "created",
        metadata: {
          origin: "signup_start_checkout",
          affiliate: affiliateContext
            ? {
              code: affiliateContext.code,
              discount_bps: affiliateContext.discountBps,
              discount_cents: affiliateContext.discountCents,
              original_amount_cents: affiliateContext.originalAmountCents,
            }
            : null,
          asaas_request: asaasPayload,
          asaas_response: asaasBody,
          callback_urls: callbackUrls,
        },
      })
      .eq("id", session.id);

    if (updateError) throw updateError;

    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        establishment_name: establishmentName,
        plan_code: plan.code,
        affiliate_ref: affiliateContext?.code ??
          user.user_metadata?.affiliate_ref ?? "",
      },
    });

    return jsonResponse(origin, {
      success: true,
      checkout_session_id: session.id,
      provider: "asaas",
      provider_checkout_id: providerCheckoutId,
      checkout_url: checkoutUrl,
      expires_at: session.expires_at,
      reused: false,
      amount_cents: checkoutAmountCents,
      affiliate_ref: affiliateContext?.code ?? null,
      affiliate_discount_bps: affiliateContext?.discountBps ?? 0,
      affiliate_discount_cents: affiliateContext?.discountCents ?? 0,
      affiliate_original_amount_cents: affiliateContext?.originalAmountCents ??
        null,
    });
  } catch (error) {
    console.error("signup-start-checkout error", error);

    if (error instanceof SignupCheckoutError) {
      return errorResponse(origin, error);
    }

    return errorResponse(
      origin,
      new SignupCheckoutError(
        "SIGNUP_CHECKOUT_INTERNAL_ERROR",
        "Erro interno ao iniciar checkout.",
        500,
      ),
    );
  }
});
