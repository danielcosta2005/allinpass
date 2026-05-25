import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(status: number, body: unknown, origin?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function extractToken(qrData: unknown): string | null {
  const raw = cleanString(qrData);
  if (!raw) return null;

  if (!raw.startsWith("http://") && !raw.startsWith("https://")) return raw;

  try {
    const u = new URL(raw);
    const sp = u.searchParams;
    const byQuery =
      sp.get("token") ||
      sp.get("t") ||
      sp.get("s") ||
      sp.get("pass_token") ||
      sp.get("pt");
    if (byQuery) return String(byQuery).trim();

    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length) return parts[parts.length - 1];

    return null;
  } catch {
    return raw;
  }
}

function isUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

type RedeemResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  reward_id?: string;
  reward_name?: string;
  redemption_id?: string;
  user_pass_id?: string;
  customer_id?: string | null;
  points_spent?: number;
  points_before?: number;
  points_after?: number;
  [key: string]: unknown;
};

function statusForRedeemError(error: string | undefined) {
  if (error === "not_found" || error === "reward_not_found") return 404;
  if (error === "wrong_project" || error === "wrong_reward_project" || error === "reward_inactive") return 403;
  if (error === "insufficient_points") return 409;
  return 400;
}

serve(async (req) => {
  const origin = req.headers.get("origin") || undefined;

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, origin);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return jsonResponse(
      500,
      { error: "missing_env", message: "SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY obrigatorios." },
      origin,
    );
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader) {
    return jsonResponse(401, { error: "missing_auth", message: "Missing authorization header" }, origin);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse(401, { error: "unauthorized", message: "Sessao invalida do staff." }, origin);
    }

    const body = await req.json().catch(() => ({}));
    const projectId = cleanString(body?.projectId);
    const rewardId = cleanString(body?.rewardId);
    const token = extractToken(body?.qrData);

    if (!isUuid(projectId) || !isUuid(rewardId) || !token) {
      return jsonResponse(
        400,
        { error: "bad_request", message: "projectId, rewardId e qrData sao obrigatorios." },
        origin,
      );
    }

    const { data: membership, error: membershipErr } = await userClient
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userData.user.id)
      .in("role", ["owner", "staff"])
      .maybeSingle();

    if (membershipErr) throw membershipErr;
    if (!membership) {
      return jsonResponse(403, { error: "forbidden", message: "Voce nao e staff deste projeto." }, origin);
    }

    const { data: redeemData, error: redeemErr } = await admin.rpc("redeem_reward_points", {
      p_project_id: projectId,
      p_reward_id: rewardId,
      p_pass_token: token,
    });

    if (redeemErr) {
      return jsonResponse(500, { error: "redeem_failed", message: redeemErr.message }, origin);
    }

    const result = (redeemData || {}) as RedeemResult;
    if (!result.ok) {
      return jsonResponse(statusForRedeemError(result.error), result, origin);
    }

    return jsonResponse(200, result, origin);
  } catch (err) {
    return jsonResponse(
      500,
      { error: "unhandled", message: err instanceof Error ? err.message : String(err) },
      origin,
    );
  }
});
