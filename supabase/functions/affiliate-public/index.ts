import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";
import { corsHeaders, jsonResponse } from "./cors.ts";

const PROMOTIONAL_CODE_PATTERN = /^[a-z0-9]{5,10}$/;

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

export function normalizePromotionalCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);
}

function promotionResponse(
  origin: string | null,
  {
    valid = false,
    code = "",
    discountBps = 0,
    reason = "not_found",
  }: {
    valid?: boolean;
    code?: string;
    discountBps?: number;
    reason?: string;
  } = {},
) {
  return jsonResponse(origin, {
    success: true,
    data: {
      valid,
      code: valid ? code : "",
      discountBps: valid ? discountBps : 0,
      reason,
    },
  });
}

async function resolvePromotionalCode(
  supabaseAdmin: ReturnType<typeof createClient>,
  code: string,
) {
  const { data, error } = await supabaseAdmin.rpc(
    "resolve_public_promotional_code",
    { p_code: code },
  );

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;

  return {
    valid: Boolean(row?.valid),
    code: normalizePromotionalCode(row?.code || code),
    discountBps: Math.max(0, Math.trunc(Number(row?.discount_bps ?? 0))),
    reason: String(row?.reason || (row?.valid ? "valid" : "not_found")),
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
    const isResolvePromotionalCode = action === "resolvePromotionalCode";
    const isResolveAffiliateRef = action === "resolveAffiliateRef";

    if (!isResolvePromotionalCode && !isResolveAffiliateRef) {
      return jsonResponse(origin, {
        error: "Acao desconhecida.",
        code: "AFFILIATE_PUBLIC_UNKNOWN_ACTION",
      }, 400);
    }

    const code = normalizePromotionalCode(
      payload?.code ?? payload?.promoCode ?? payload?.ref,
    );
    if (!PROMOTIONAL_CODE_PATTERN.test(code)) {
      return promotionResponse(origin, { reason: "invalid_format" });
    }

    const supabaseAdmin = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const resolved = await resolvePromotionalCode(supabaseAdmin, code);

    return promotionResponse(origin, resolved);
  } catch (error) {
    console.error("affiliate-public error", error);
    return promotionResponse(origin, { reason: "lookup_failed" });
  }
});
