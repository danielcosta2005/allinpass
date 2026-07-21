import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders, jsonResponse } from "./cors.ts";

const AFFILIATE_DISCOUNT_BPS = 1000;
const AFFILIATE_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{5,39}$/;

type AffiliateLinkRow = {
  id: string;
  seller_id: string;
  code: string;
  status: string;
};

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

export function normalizeAffiliateRef(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
}

function affiliateResponse(origin: string | null, valid = false, code = "") {
  return jsonResponse(origin, {
    success: true,
    data: {
      valid,
      code: valid ? code : "",
      discountBps: valid ? AFFILIATE_DISCOUNT_BPS : 0,
    },
  });
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

    if (action !== "resolveAffiliateRef") {
      return jsonResponse(origin, {
        error: "Acao desconhecida.",
        code: "AFFILIATE_PUBLIC_UNKNOWN_ACTION",
      }, 400);
    }

    const code = normalizeAffiliateRef(payload?.ref);
    if (!AFFILIATE_CODE_PATTERN.test(code)) {
      return affiliateResponse(origin);
    }

    const supabaseAdmin = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: linkData, error: linkError } = await supabaseAdmin
      .from("affiliate_links")
      .select("id, seller_id, code, status")
      .ilike("code", code)
      .eq("status", "active")
      .maybeSingle();

    if (linkError) throw linkError;
    const link = linkData as AffiliateLinkRow | null;
    if (!link) return affiliateResponse(origin);

    const { data: sellerData, error: sellerError } = await supabaseAdmin
      .from("affiliate_sellers")
      .select("id, status")
      .eq("id", link.seller_id)
      .eq("status", "active")
      .maybeSingle();

    if (sellerError) throw sellerError;
    if (!sellerData) return affiliateResponse(origin);

    return affiliateResponse(origin, true, link.code);
  } catch (error) {
    console.error("affiliate-public error", error);
    return jsonResponse(origin, {
      success: true,
      data: { valid: false, code: "", discountBps: 0 },
    });
  }
});
