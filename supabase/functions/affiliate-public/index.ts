import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders, jsonResponse } from "./cors.ts";

const AFFILIATE_DISCOUNT_BPS = 1000;
const PROMO_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{5,39}$/;

type AffiliateLinkRow = {
  id: string;
  seller_id: string;
  code: string;
  status: string;
};

type PromotionalCodeRow = {
  id: string;
  affiliate_link_id: string | null;
  seller_id: string | null;
  code: string;
  discount_bps: number;
  max_uses: number | null;
  redeemed_uses: number;
  valid_until: string | null;
  status: string;
};

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

export function normalizePromotionalCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
}

export const normalizeAffiliateRef = normalizePromotionalCode;

function isPromoUsable(promo: PromotionalCodeRow | null) {
  if (!promo || promo.status !== "active") return false;

  if (promo.valid_until) {
    const validUntil = new Date(promo.valid_until);
    if (!Number.isNaN(validUntil.getTime()) && validUntil <= new Date()) {
      return false;
    }
  }

  const maxUses = promo.max_uses == null
    ? null
    : Math.max(0, Math.trunc(Number(promo.max_uses || 0)));
  const redeemedUses = Math.max(
    0,
    Math.trunc(Number(promo.redeemed_uses || 0)),
  );

  return maxUses == null || redeemedUses < maxUses;
}

function promoResponse(
  origin: string | null,
  {
    valid = false,
    code = "",
    discountBps = 0,
  }: {
    valid?: boolean;
    code?: string;
    discountBps?: number;
  } = {},
) {
  const safeDiscountBps = valid
    ? Math.max(0, Math.min(10000, Math.trunc(Number(discountBps || 0))))
    : 0;

  return jsonResponse(origin, {
    success: true,
    data: {
      valid,
      code: valid ? code : "",
      discountBps: safeDiscountBps,
    },
  });
}

async function hasActiveSeller(supabaseAdmin: any, sellerId: string | null) {
  if (!sellerId) return true;

  const { data: sellerData, error: sellerError } = await supabaseAdmin
    .from("affiliate_sellers")
    .select("id, status")
    .eq("id", sellerId)
    .eq("status", "active")
    .maybeSingle();

  if (sellerError) throw sellerError;
  return Boolean(sellerData);
}

async function resolvePromotionalCode(
  supabaseAdmin: any,
  code: string,
): Promise<{
  code: string;
  discountBps: number;
} | null> {
  const { data: promoData, error: promoError } = await supabaseAdmin
    .from("billing_promotional_codes")
    .select([
      "id",
      "affiliate_link_id",
      "seller_id",
      "code",
      "discount_bps",
      "max_uses",
      "redeemed_uses",
      "valid_until",
      "status",
    ].join(", "))
    .ilike("code", code)
    .eq("status", "active")
    .maybeSingle();

  if (promoError) throw promoError;
  const promo = promoData as PromotionalCodeRow | null;

  if (promo && isPromoUsable(promo)) {
    const sellerActive = await hasActiveSeller(supabaseAdmin, promo.seller_id);
    if (sellerActive) {
      return {
        code: normalizePromotionalCode(promo.code) || code,
        discountBps: Number(promo.discount_bps || 0),
      };
    }
  }

  const { data: linkData, error: linkError } = await supabaseAdmin
    .from("affiliate_links")
    .select("id, seller_id, code, status")
    .ilike("code", code)
    .eq("status", "active")
    .maybeSingle();

  if (linkError) throw linkError;
  const link = linkData as AffiliateLinkRow | null;
  if (!link) return null;

  const sellerActive = await hasActiveSeller(supabaseAdmin, link.seller_id);
  if (!sellerActive) return null;

  return {
    code: normalizePromotionalCode(link.code) || code,
    discountBps: AFFILIATE_DISCOUNT_BPS,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse(origin, {
      error: "Metodo nao permitido.",
      code: "AFFILIATE_PUBLIC_METHOD_NOT_ALLOWED",
    }, 405);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const action = String(payload?.action ?? "").trim();

    if (
      action !== "resolveAffiliateRef" &&
      action !== "resolvePromotionalCode"
    ) {
      return jsonResponse(origin, {
        error: "Acao desconhecida.",
        code: "AFFILIATE_PUBLIC_UNKNOWN_ACTION",
      }, 400);
    }

    const code = normalizePromotionalCode(
      payload?.promoCode ?? payload?.promo ?? payload?.code ?? payload?.ref,
    );
    if (!PROMO_CODE_PATTERN.test(code)) {
      return promoResponse(origin);
    }

    const supabaseAdmin = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const promo = await resolvePromotionalCode(supabaseAdmin, code);
    if (!promo) return promoResponse(origin);

    return promoResponse(origin, {
      valid: true,
      code: promo.code,
      discountBps: promo.discountBps,
    });
  } catch (error) {
    console.error("affiliate-public error", error);
    return jsonResponse(origin, {
      success: true,
      data: { valid: false, code: "", discountBps: 0 },
    });
  }
});
