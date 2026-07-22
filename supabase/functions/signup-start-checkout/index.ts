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
  promo_code_id: string | null;
  promo_redemption_id: string | null;
  affiliate_link_id: string | null;
  affiliate_seller_id: string | null;
  affiliate_code: string | null;
  affiliate_discount_bps: number | null;
  affiliate_discount_cents: number | null;
  affiliate_original_amount_cents: number | null;
};

type PromotionalReservation = {
  success: boolean;
  reason: string;
  promoCodeId: string | null;
  redemptionId: string | null;
  code: string;
  discountBps: number;
  discountCents: number;
  finalAmountCents: number;
  commissionBps: number;
  sellerId: string | null;
  affiliateLinkId: string | null;
  status: string;
};

type SupabaseAdminClient = SupabaseClient<any, "public", any>;

const FREE_PLAN_CODE = "free_trial";
const DEFAULT_CHECKOUT_EXPIRATION_MINUTES = 60;
const PROMOTIONAL_CODE_PATTERN = /^[a-z0-9]{5,10}$/;
const ASAAS_REQUEST_TIMEOUT_MS = 20_000;

// Bounds the external Asaas call so a slow/hanging provider never keeps the edge
// function running until the runtime kills it. A killed function returns no CORS
// headers, which the browser surfaces as a misleading "CORS policy" error; with
// the timeout we always return a proper JSON error (with CORS) instead.
async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

function normalizePromotionalCode(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);

  return PROMOTIONAL_CODE_PATTERN.test(normalized) ? normalized : "";
}

function toInteger(value: unknown, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
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
      "O Asaas nao aceita callbacks em localhost ou URL privada. Configure ASAAS_CALLBACK_BASE_URL ou APP_BASE_URL com uma URL publica HTTPS.",
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function computeRequestHash(value: unknown) {
  const data = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function mapPromotionReservation(data: unknown): PromotionalReservation {
  const row = Array.isArray(data) ? data[0] : data;
  const item = row && typeof row === "object"
    ? row as Record<string, unknown>
    : {};

  return {
    success: Boolean(item.success),
    reason: String(item.reason || (item.success ? "reserved" : "invalid")),
    promoCodeId: String(item.promo_code_id || "") || null,
    redemptionId: String(item.redemption_id || "") || null,
    code: normalizePromotionalCode(item.code),
    discountBps: toInteger(item.discount_bps),
    discountCents: toInteger(item.discount_cents),
    finalAmountCents: toInteger(item.final_amount_cents),
    commissionBps: toInteger(item.commission_bps),
    sellerId: String(item.seller_id || "") || null,
    affiliateLinkId: String(item.affiliate_link_id || "") || null,
    status: String(item.status || ""),
  };
}

async function findReusableCheckoutSession(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  planId: string,
  promotionalCode: string,
) {
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
        "promo_code_id",
        "promo_redemption_id",
        "affiliate_link_id",
        "affiliate_seller_id",
        "affiliate_code",
        "affiliate_discount_bps",
        "affiliate_discount_cents",
        "affiliate_original_amount_cents",
      ].join(", "),
    )
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .in("status", ["pending", "created"])
    .gt("expires_at", new Date().toISOString());

  reusableSessionQuery = promotionalCode
    ? reusableSessionQuery.eq("affiliate_code", promotionalCode)
    : reusableSessionQuery.is("promo_code_id", null);

  const { data, error } = await reusableSessionQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as CheckoutSession | null;
}

async function reservePromotionalCode(
  supabaseAdmin: SupabaseAdminClient,
  session: { id: string; expires_at: string },
  plan: BillingPlan,
  promotionalCode: string,
) {
  if (!promotionalCode) return null;

  const { data, error } = await supabaseAdmin.rpc("reserve_promotional_code", {
    p_code: promotionalCode,
    p_checkout_session_id: session.id,
    p_base_amount_cents: plan.base_price_cents,
    p_expires_at: session.expires_at,
    p_metadata: {
      origin: "signup_start_checkout",
      plan_code: plan.code,
    },
  });

  if (error) throw error;
  const reservation = mapPromotionReservation(data);

  if (!reservation.success) {
    throw new SignupCheckoutError(
      "SIGNUP_CHECKOUT_PROMOTIONAL_CODE_INVALID",
      "Codigo promocional invalido ou indisponivel.",
      400,
    );
  }

  return reservation;
}

async function releasePromotionalCodeReservation(
  supabaseAdmin: SupabaseAdminClient,
  checkoutSessionId: string,
  reason: string,
) {
  const { error } = await supabaseAdmin.rpc(
    "release_promotional_code_redemption",
    {
      p_checkout_session_id: checkoutSessionId,
      p_reason: reason,
      p_metadata: { origin: "signup_start_checkout" },
    },
  );

  if (error) {
    console.error("signup-start-checkout release promotion failed", error);
  }
}

async function upsertProviderRequest(
  supabaseAdmin: SupabaseAdminClient,
  options: {
    checkoutSessionId: string;
    externalReference: string;
    requestHash: string;
    asaasPayload: unknown;
  },
) {
  const { error } = await supabaseAdmin
    .from("payment_provider_requests")
    .upsert(
      {
        checkout_session_id: options.checkoutSessionId,
        operation: "create_signup_checkout",
        provider: "asaas",
        external_reference: options.externalReference,
        request_hash: options.requestHash,
        status: "pending",
        response_metadata: {
          origin: "signup_start_checkout",
          asaas_request: options.asaasPayload,
        },
        attempted_at: new Date().toISOString(),
      },
      { onConflict: "checkout_session_id,operation" },
    );

  if (error) throw error;
}

async function markProviderRequestSucceeded(
  supabaseAdmin: SupabaseAdminClient,
  options: {
    checkoutSessionId: string;
    providerCheckoutId: string;
    checkoutUrl: string;
    asaasBody: unknown;
  },
) {
  const { error } = await supabaseAdmin
    .from("payment_provider_requests")
    .update({
      status: "succeeded",
      provider_request_id: options.providerCheckoutId,
      provider_checkout_id: options.providerCheckoutId,
      checkout_url: options.checkoutUrl,
      response_metadata: {
        origin: "signup_start_checkout",
        asaas_response: options.asaasBody,
      },
      last_error: null,
      succeeded_at: new Date().toISOString(),
    })
    .eq("checkout_session_id", options.checkoutSessionId)
    .eq("operation", "create_signup_checkout");

  if (error) throw error;
}

async function markProviderRequestFailed(
  supabaseAdmin: SupabaseAdminClient,
  options: {
    checkoutSessionId: string;
    message: string;
    asaasBody: unknown;
  },
) {
  const { error } = await supabaseAdmin
    .from("payment_provider_requests")
    .update({
      status: "failed",
      response_metadata: {
        origin: "signup_start_checkout",
        asaas_response: options.asaasBody,
      },
      last_error: options.message.slice(0, 500),
    })
    .eq("checkout_session_id", options.checkoutSessionId)
    .eq("operation", "create_signup_checkout");

  if (error) throw error;
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
    const affiliateRef = normalizePromotionalCode(
      payload.promoCode ??
        payload.promo ??
        payload.affiliateRef ??
        payload.ref ??
        user.user_metadata?.affiliate_ref,
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

    const reusableSession = await findReusableCheckoutSession(
      supabaseAdmin,
      user.id,
      plan.id,
      affiliateRef,
    );

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
        promo_code_id: reusableSession.promo_code_id,
        promo_redemption_id: reusableSession.promo_redemption_id,
        promo_code: reusableSession.affiliate_code,
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
        amount_cents: plan.base_price_cents,
        currency: "BRL",
        affiliate_link_id: null,
        affiliate_seller_id: null,
        affiliate_code: null,
        affiliate_discount_bps: 0,
        affiliate_discount_cents: 0,
        affiliate_original_amount_cents: null,
        expires_at: expiresAt.toISOString(),
        metadata: {
          origin: "signup_start_checkout",
          requested_promotional_code: affiliateRef || null,
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

    const promotionReservation = await reservePromotionalCode(
      supabaseAdmin,
      session,
      plan,
      affiliateRef,
    );
    const checkoutAmountCents = promotionReservation?.finalAmountCents ?? plan.base_price_cents;
    const discountDescription = promotionReservation
      ? `${promotionReservation.discountBps / 100}% de desconto no primeiro mes`
      : "";

    const callbackUrls = {
      success_url: buildSignupRedirectUrl(appBaseUrl, {
        plano: plan.code,
        planCode: plan.code,
        finalizar: "1",
        checkout: "success",
        checkoutSessionId: session.id,
        ref: promotionReservation?.code ?? "",
      }),
      cancel_url: buildSignupRedirectUrl(appBaseUrl, {
        plano: plan.code,
        planCode: plan.code,
        checkout: "cancel",
        checkoutSessionId: session.id,
        ref: promotionReservation?.code ?? "",
      }),
      expired_url: buildSignupRedirectUrl(appBaseUrl, {
        plano: plan.code,
        planCode: plan.code,
        checkout: "expired",
        checkoutSessionId: session.id,
        ref: promotionReservation?.code ?? "",
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
          description: promotionReservation
            ? `Assinatura mensal AllinPass - ${plan.name} (${discountDescription})`
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

    const requestHash = await computeRequestHash(asaasPayload);
    await upsertProviderRequest(supabaseAdmin, {
      checkoutSessionId: session.id,
      externalReference: session.external_reference,
      requestHash,
      asaasPayload,
    });

    let asaasResponse: Response;
    try {
      asaasResponse = await fetchWithTimeout(
        `${getAsaasApiBaseUrl()}/checkouts`,
        {
          method: "POST",
          headers: {
            "accept": "application/json",
            "content-type": "application/json",
            "access_token": asaasApiKey,
            "User-Agent": "AllinPass/1.0",
          },
          body: JSON.stringify(asaasPayload),
        },
        ASAAS_REQUEST_TIMEOUT_MS,
      );
    } catch (fetchError) {
      const aborted = fetchError instanceof DOMException &&
        fetchError.name === "AbortError";
      const message = aborted
        ? "O provedor de pagamento (Asaas) demorou demais para responder. Tente novamente em instantes."
        : "Nao foi possivel conectar ao provedor de pagamento (Asaas). Tente novamente.";

      await markProviderRequestFailed(supabaseAdmin, {
        checkoutSessionId: session.id,
        message,
        asaasBody: { error: String(fetchError) },
      });
      await releasePromotionalCodeReservation(
        supabaseAdmin,
        session.id,
        aborted ? "asaas_checkout_timeout" : "asaas_checkout_network_error",
      );
      await supabaseAdmin
        .from("signup_checkout_sessions")
        .update({
          status: "failed",
          metadata: {
            origin: "signup_start_checkout",
            requested_promotional_code: affiliateRef || null,
            promotion: promotionReservation,
            asaas_request: asaasPayload,
            asaas_error: String(fetchError),
          },
        })
        .eq("id", session.id);

      throw new SignupCheckoutError(
        "SIGNUP_CHECKOUT_ASAAS_TIMEOUT",
        message,
        504,
      );
    }

    const asaasBody = await asaasResponse.json().catch(() => ({}));

    if (!asaasResponse.ok) {
      const message = getAsaasErrorMessage(asaasBody) ||
        "Nao foi possivel criar checkout no Asaas.";

      await markProviderRequestFailed(supabaseAdmin, {
        checkoutSessionId: session.id,
        message,
        asaasBody,
      });
      await releasePromotionalCodeReservation(
        supabaseAdmin,
        session.id,
        "asaas_checkout_failed",
      );
      await supabaseAdmin
        .from("signup_checkout_sessions")
        .update({
          status: "failed",
          metadata: {
            origin: "signup_start_checkout",
            requested_promotional_code: affiliateRef || null,
            promotion: promotionReservation,
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
      await releasePromotionalCodeReservation(
        supabaseAdmin,
        session.id,
        "asaas_checkout_missing_id",
      );
      throw new SignupCheckoutError(
        "SIGNUP_CHECKOUT_ASAAS_MISSING_ID",
        "Asaas nao retornou o ID do checkout.",
        502,
      );
    }

    const checkoutUrl =
      String((asaasBody as { link?: unknown }).link ?? "").trim() ||
      buildCheckoutUrl(providerCheckoutId);

    await markProviderRequestSucceeded(supabaseAdmin, {
      checkoutSessionId: session.id,
      providerCheckoutId,
      checkoutUrl,
      asaasBody,
    });

    const { error: updateError } = await supabaseAdmin
      .from("signup_checkout_sessions")
      .update({
        provider_checkout_id: providerCheckoutId,
        checkout_url: checkoutUrl,
        status: "created",
        metadata: {
          origin: "signup_start_checkout",
          requested_promotional_code: affiliateRef || null,
          promotion: promotionReservation,
          asaas_request: asaasPayload,
          asaas_response: asaasBody,
          callback_urls: callbackUrls,
          request_hash: requestHash,
        },
      })
      .eq("id", session.id);

    if (updateError) throw updateError;

    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        establishment_name: establishmentName,
        plan_code: plan.code,
        affiliate_ref: promotionReservation?.code ??
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
      promo_code_id: promotionReservation?.promoCodeId ?? null,
      promo_redemption_id: promotionReservation?.redemptionId ?? null,
      promo_code: promotionReservation?.code ?? null,
      affiliate_ref: promotionReservation?.code ?? null,
      affiliate_discount_bps: promotionReservation?.discountBps ?? 0,
      affiliate_discount_cents: promotionReservation?.discountCents ?? 0,
      affiliate_original_amount_cents: promotionReservation
        ? plan.base_price_cents
        : null,
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
