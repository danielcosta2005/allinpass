// supabase/functions/scanner-visit/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertProjectBillingActive,
  getProjectBillingInactivePayload,
  isProjectBillingInactiveError,
} from "../_shared/billingAccess.ts";

function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function addDays(date: Date, days: number) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

// Aceita token puro ou URL que contenha token em query/path (robustez)
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

// ---------- Challenge (HMAC) ----------
const te = new TextEncoder();

function b64urlEncode(bytes: Uint8Array) {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  const b64 = btoa(str);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecodeToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(msg));
  return b64urlEncode(new Uint8Array(sig));
}

async function hmacVerify(secret: string, msg: string, sigB64u: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sig = b64urlDecodeToBytes(sigB64u);
  const sigBuffer = sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer;
  return await crypto.subtle.verify("HMAC", key, sigBuffer, te.encode(msg));
}

type ChallengePayload = {
  v: 1;
  project_id: string;
  user_pass_id: string;
  exp: number; // unix seconds
};

async function makeChallenge(secret: string, payload: ChallengePayload): Promise<string> {
  const body = b64urlEncode(te.encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, body);
  return `${body}.${sig}`;
}

async function parseAndVerifyChallenge(secret: string, token: string): Promise<ChallengePayload | null> {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const ok = await hmacVerify(secret, body, sig);
  if (!ok) return null;

  const json = new TextDecoder().decode(b64urlDecodeToBytes(body));
  const payload = JSON.parse(json) as ChallengePayload;

  if (!payload || payload.v !== 1) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowSec) return null;

  return payload;
}

function formatDateBR(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

type AvailableReward = {
  id: string;
  name: string;
  points_required: number;
};

function normalizeRewards(rows: unknown): AvailableReward[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row: any) => {
      const id = cleanString(row?.id);
      const name = cleanString(row?.name);
      const pointsRequired = Number(row?.points_required);

      if (!id || !name || !Number.isFinite(pointsRequired)) return null;

      return {
        id,
        name,
        points_required: pointsRequired,
      };
    })
    .filter((row): row is AvailableReward => Boolean(row));
}

function formatPoints(points: number) {
  return points === 1 ? "1 ponto" : `${points} pontos`;
}

function formatRewardNames(rewards: AvailableReward[]) {
  const names = rewards.map((reward) => reward.name).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function truncateMessage(message: string, maxLength = 200) {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function buildGooglePointsNotificationMessage(
  points: number,
  reset: boolean,
  expiresFmt: string | null,
  rewards: AvailableReward[],
) {
  const rewardNames = formatRewardNames(rewards);

  if (rewardNames) {
    const base = reset
      ? `Validade renovada${expiresFmt ? ` ate ${expiresFmt}` : ""}. Voce tem ${formatPoints(points)}`
      : `+1 ponto adicionado! Voce tem ${formatPoints(points)}`;

    return truncateMessage(`${base} e pode resgatar: ${rewardNames}.`);
  }

  return truncateMessage(
    reset
      ? `Validade renovada${expiresFmt ? ` ate ${expiresFmt}` : ""} e pontos resetados. Pontos atuais: ${points}.`
      : `+1 ponto adicionado! Pontos atuais: ${points}.`,
  );
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "*";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const SCAN_CONFIRM_SECRET = Deno.env.get("SCAN_CONFIRM_SECRET") ?? "";

    const COOLDOWN_SECONDS = Number(Deno.env.get("SCAN_COOLDOWN_SECONDS") ?? "60") || 60;

    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({
          error: "missing_env",
          message: "SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY obrigatórios.",
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    if (!SCAN_CONFIRM_SECRET) {
      return new Response(
        JSON.stringify({
          error: "missing_env",
          message: "SCAN_CONFIRM_SECRET obrigatório para o anti-replay (confirmação).",
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "missing_auth", message: "Missing authorization header" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const projectId = cleanString(body?.projectId);
    const token = extractToken(body?.qrData);

    const confirm = !!body?.confirm;
    const challenge = cleanString(body?.challenge);

    if (!projectId || !token) {
      return new Response(
        JSON.stringify({ error: "bad_request", message: "projectId e qrData (token) são obrigatórios." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    // 1) valida JWT do staff
    const sbAuth = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await sbAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "unauthorized", message: "Sessão inválida do staff." }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    // 2) Service Role pra lógica
    const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 3) busca user_pass pelo token (✅ inclui google_object_id)
    const { data: upRows, error: upErr } = await sbAdmin
      .from("user_passes")
      .select("id, pass_id, pass_token, expires_at, metadata, google_object_id, install_platform, install_status")
      .eq("pass_token", token)
      .limit(2);

    if (upErr) {
      return new Response(
        JSON.stringify({ error: "db_error", message: upErr.message }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    if (!upRows || upRows.length === 0) {
      return new Response(
        JSON.stringify({ error: "not_found", message: "Passe não encontrado para esse token." }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    if (upRows.length > 1) {
      return new Response(
        JSON.stringify({
          error: "token_not_unique",
          message: "Token duplicado em user_passes. Verifique unicidade do pass_token.",
          token,
          count: upRows.length,
        }),
        { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    const up = upRows[0];

    // 4) pega project_id real do passe e compara
    const { data: passRow, error: passErr } = await sbAdmin
      .from("passes")
      .select("id, project_id")
      .eq("id", up.pass_id)
      .maybeSingle();

    if (passErr) {
      return new Response(
        JSON.stringify({ error: "db_error", message: passErr.message }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    if (!passRow) {
      return new Response(
        JSON.stringify({ error: "not_found", message: "Registro do passe (passes) não encontrado." }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    if (String(passRow.project_id) !== String(projectId)) {
      return new Response(
        JSON.stringify({
          error: "wrong_project",
          message: "Este QR Code pertence a outro estabelecimento.",
          expected_project_id: String(passRow.project_id),
          received_project_id: String(projectId),
          pass_id: String(passRow.id),
        }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    await assertProjectBillingActive(sbAdmin, projectId);

    // ---------- Anti-replay gate ----------
    if (!confirm) {
      const { data: lastRows, error: lastErr } = await sbAdmin
        .from("visits")
        .select("created_at")
        .eq("project_id", projectId)
        .eq("user_pass_id", up.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (lastErr) {
        return new Response(
          JSON.stringify({ error: "db_error", message: lastErr.message }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
        );
      }

      const lastAtISO = lastRows?.[0]?.created_at as string | undefined;
      if (lastAtISO) {
        const lastAt = new Date(lastAtISO);
        const now = new Date();
        const deltaSec = Math.floor((now.getTime() - lastAt.getTime()) / 1000);

        if (Number.isFinite(deltaSec) && deltaSec >= 0 && deltaSec < COOLDOWN_SECONDS) {
          const exp = Math.floor(Date.now() / 1000) + 90;
          const ch = await makeChallenge(SCAN_CONFIRM_SECRET, {
            v: 1,
            project_id: String(projectId),
            user_pass_id: String(up.id),
            exp,
          });

          return new Response(
            JSON.stringify({
              ok: true,
              requires_confirmation: true,
              reason: "recent_scan",
              cooldown_seconds: COOLDOWN_SECONDS,
              seconds_since_last_scan: deltaSec,
              last_scan_at: lastAtISO,
              challenge: ch,
            }),
            { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
          );
        }
      }
    }

    if (confirm) {
      if (!challenge) {
        return new Response(
          JSON.stringify({ error: "bad_request", message: "challenge obrigatório para confirmar." }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
        );
      }

      const payload = await parseAndVerifyChallenge(SCAN_CONFIRM_SECRET, challenge);
      if (!payload) {
        return new Response(
          JSON.stringify({ error: "invalid_challenge", message: "Challenge inválido ou expirado." }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
        );
      }

      if (payload.project_id !== String(projectId) || payload.user_pass_id !== String(up.id)) {
        return new Response(
          JSON.stringify({ error: "invalid_challenge", message: "Challenge não corresponde a este passe/projeto." }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
        );
      }
    }

    // ---------- Fluxo normal: contabilização de pontos ----------
    const meta = (up.metadata && typeof up.metadata === "object") ? up.metadata : {};
    const currentPointsRaw = (meta as any)?.points;
    const currentPoints = Number.isFinite(Number(currentPointsRaw)) ? Number(currentPointsRaw) : 0;

    const now = new Date();
    const expiresAt = up.expires_at ? new Date(up.expires_at) : null;
    const isExpired =
      !expiresAt ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() < now.getTime();

    let newPoints = currentPoints;
    let newExpiresAtISO: string | null = up.expires_at ?? null;
    let reset = false;

    if (isExpired) {
      reset = true;
      newPoints = 1;
      newExpiresAtISO = addDays(now, 30).toISOString();
    } else {
      newPoints += 1;
    }

    const newMeta = { ...(meta as any), points: newPoints };

    const { error: updErr } = await sbAdmin
      .from("user_passes")
      .update({
        metadata: newMeta,
        expires_at: newExpiresAtISO,
      })
      .eq("id", up.id);

    if (updErr) {
      return new Response(
        JSON.stringify({ error: "update_failed", message: updErr.message }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    // ---------- Recompensas disponiveis ----------
    let rewardsAvailable: AvailableReward[] = [];
    let rewardLookupWarning: string | null = null;

    try {
      const { data: rewardRows, error: rewardsErr } = await sbAdmin
        .from("rewards")
        .select("id, name, points_required")
        .eq("project_id", projectId)
        .eq("status", "active")
        .eq("points_required", newPoints)
        .order("created_at", { ascending: true });

      if (rewardsErr) {
        rewardLookupWarning = rewardsErr.message;
        console.log("[scanner-visit] rewards lookup failed (ignored):", rewardsErr.message);
      } else {
        rewardsAvailable = normalizeRewards(rewardRows);
      }
    } catch (err) {
      rewardLookupWarning = String((err as any)?.message ?? err);
      console.log("[scanner-visit] rewards lookup failed (ignored):", rewardLookupWarning);
    }

    const rewardAvailable = rewardsAvailable[0] ?? null;
    const expiresFmt = formatDateBR(newExpiresAtISO);
    const googleNotificationMessage = buildGooglePointsNotificationMessage(
      newPoints,
      reset,
      expiresFmt,
      rewardsAvailable,
    );

    // ---------- Pushes + notificacao (nao bloqueantes) ----------
    try {
      const pushRes = await fetch(`${SUPABASE_URL}/functions/v1/apple-push`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pass_token: token }),
      });
      const pushJson = await pushRes.json().catch(() => ({}));
      console.log("[scanner-visit] apple-push:", pushRes.status, pushJson);
    } catch (err) {
      console.log("[scanner-visit] apple-push failed (ignored):", String(err));
    }

    try {
      const pushRes = await fetch(`${SUPABASE_URL}/functions/v1/google-push`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pass_token: token }),
      });
      const pushJson = await pushRes.json().catch(() => ({}));
      console.log("[scanner-visit] google-push:", pushRes.status, pushJson);
    } catch (err) {
      console.log("[scanner-visit] google-push failed (ignored):", String(err));
    }

    // send-google-notification depois de google-push
    try {
      const objectId = cleanString((up as any)?.google_object_id);

      if (!objectId) {
        console.log("[scanner-visit] send-google-notification skipped: google_object_id vazio no user_passes");
      } else {
        const header = "Allin Pass";
        const message = googleNotificationMessage;
        const target = {
          project_id: String(passRow.project_id),          // já validado acima
          user_pass_id: String(up.id),
          google_object_id: objectId,

          // IMPORTANTÍSSIMO: a segmentada filtra por isso
          install_platform: (up as any).install_platform ?? "google",
          install_status: (up as any).install_status ?? "installed",
        };

        const notifRes = await fetch(`${SUPABASE_URL}/functions/v1/send-google-notification`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: String(projectId),
            header,
            message,
            targets: [target],
          }),
        });

        const notifJson = await notifRes.json().catch(() => ({}));
        console.log("[scanner-visit] send-google-notification:", notifRes.status, notifJson);
      }
    } catch (err) {
      console.log("[scanner-visit] send-google-notification failed (ignored):", String(err));
    }

    return new Response(
      JSON.stringify({
        ok: true,
        pass_token: token,
        user_pass_id: up.id,
        points: newPoints,
        reset,
        expires_at: newExpiresAtISO,
        confirmed: confirm ? true : false,
        reward_available: rewardAvailable,
        rewards_available: rewardsAvailable,
        reward_lookup_warning: rewardLookupWarning,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
    );
  } catch (e) {
    if (isProjectBillingInactiveError(e)) {
      return new Response(
        JSON.stringify(getProjectBillingInactivePayload(e)),
        { status: 402, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    return new Response(
      JSON.stringify({ error: "unhandled", message: String((e as any)?.message ?? e) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
    );
  }
});
