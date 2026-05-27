/// <reference types="https://deno.land/x/deno/cli/types/dts/index.d.ts" />
// branch
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
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

function isUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type EnqueueBody = {
  projectId: string;
  title?: string | null;
  message: string;
  sendMode?: string | null; // now | schedule
  scheduledFor?: string | null; // ISO
  segment?: unknown | null;
  user_pass_ids: string[];
  channels?: { apple?: boolean; google?: boolean } | null;
  data?: Record<string, unknown> | null;
};

serve(async (req) => {
  const origin = req.headers.get("origin") || undefined;

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" }, origin);
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
    return jsonResponse(
      500,
      {
        error:
          "Missing env vars (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)",
      },
      origin
    );
  }

  const authHeader = req.headers.get("authorization") || "";

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // 🔐 1) Auth
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse(401, { error: "Unauthorized" }, origin);
    }

    const userId = userData.user.id;

    // 📦 2) Payload
    const body = (await req.json().catch(() => null)) as EnqueueBody | null;
    if (!body) return jsonResponse(400, { error: "Invalid JSON body" }, origin);

    const projectId = cleanString(body.projectId);
    const message = cleanString(body.message);
    const title = cleanString(body.title) || "Envio manual";
    const sendMode = cleanString(body.sendMode) || "now";
    const scheduledFor = cleanString(body.scheduledFor);

    if (!projectId || !isUuid(projectId)) {
      return jsonResponse(400, { error: "projectId inválido" }, origin);
    }

    if (!message) {
      return jsonResponse(400, { error: "message não pode estar vazio" }, origin);
    }

    if (!Array.isArray(body.user_pass_ids) || body.user_pass_ids.length === 0) {
      return jsonResponse(
        400,
        { error: "user_pass_ids é obrigatório e não pode estar vazio" },
        origin
      );
    }

    if (sendMode === "schedule") {
      if (!scheduledFor) {
        return jsonResponse(
          400,
          { error: "scheduledFor é obrigatório quando sendMode='schedule'" },
          origin
        );
      }

      const d = new Date(scheduledFor);
      if (Number.isNaN(d.getTime())) {
        return jsonResponse(
          400,
          { error: "scheduledFor inválido (esperado ISO)" },
          origin
        );
      }
    }

    // 🧑‍🤝‍🧑 3) Autorização
    const { data: membership, error: memErr } = await userClient
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .eq("role", "owner")
      .maybeSingle();

    if (memErr) throw memErr;
    if (!membership) {
      return jsonResponse(
        403,
        { error: "Forbidden (apenas owner pode enviar notificacoes)" },
        origin
      );
    }

    // 📡 4) Canais
    const channels = {
      apple: body.channels?.apple ?? true,
      google: body.channels?.google ?? true,
    };

    // 🧾 5) Criar notification
    const trigger_type = sendMode === "schedule" ? "scheduled" : "manual";
    const status = sendMode === "schedule" ? "scheduled" : "running";

    const trigger_config = {
      source: "NotificationsTab",
      segment: body.segment ?? null,
      user_pass_ids: body.user_pass_ids,
      requested_by: userId,
    };

    const { data: notif, error: notifErr } = await admin
      .from("notifications")
      .insert({
        project_id: projectId,
        title,
        message,
        channels,
        trigger_type,
        trigger_config,
        status,
        scheduled_for: scheduledFor ?? null,
        sent_at: null,
      })
      .select("id")
      .single();

    if (notifErr) throw notifErr;
    const notificationId = notif.id as string;

    // 🎟️ 6) Buscar passes
    const passIds = body.user_pass_ids.filter(isUuid);
    if (passIds.length === 0) {
      return jsonResponse(
        400,
        { error: "user_pass_ids não contém UUIDs válidos" },
        origin
      );
    }

    const { data: userPasses, error: upErr } = await admin
      .from("user_passes")
      .select(
        [
          "id",
          "pass_token",
          "pass_type",
          "metadata",
          "expires_at",
          "install_status",
          "device_key",
          "google_object_id",
          "google_class_id",
          "pass_id",
          "passes(project_id)",
        ].join(",")
      )
      .in("id", passIds)
      .eq("passes.project_id", projectId);

    if (upErr) throw upErr;

    // 👤 7) Mapear customer
    const { data: custLinks, error: custErr } = await admin
      .from("customers")
      .select("id, user_pass_id")
      .eq("project_id", projectId)
      .in("user_pass_id", passIds);

    if (custErr) throw custErr;

    const customerByUserPass = new Map<string, string>();
    for (const c of custLinks || []) {
      if (c.user_pass_id && c.id) {
        customerByUserPass.set(c.user_pass_id, c.id);
      }
    }

    // ⚙️ 8) Criar jobs (AGORA com rate limit via RPC)
    let skipped_removed = 0;
    let skipped_no_platform = 0;
    let skipped_limit = 0;
    let limit_reached = false;

    const nowIso = new Date().toISOString();
    const scheduleIso = scheduledFor ?? null;
    const contentHash = await sha256Hex(
      `${title}::${message}::${scheduleIso ?? "now"}`
    );

    const jobs: any[] = [];

    // Helper: consome 1 unidade do limite com RPC
    async function tryConsumeNotificationSlot(): Promise<boolean> {
      const { data, error } = await admin.rpc("check_and_increment_notifications", {
        p_project_id: projectId,
      });

      if (error) throw error;
      return data === true;
    }

    for (const p of userPasses || []) {
      const user_pass_id = p.id as string;
      const installStatus = (p.install_status as string | null) ?? null;

      if (installStatus === "removed") {
        skipped_removed += 1;
        continue;
      }

      const passType = (p.pass_type as string | null) ?? null;

      const canApple = channels.apple && (passType === "apple" || !!p.device_key);
      const canGoogle =
        channels.google && (passType === "google" || !!p.google_object_id);

      if (!canApple && !canGoogle) {
        skipped_no_platform += 1;
        continue;
      }

      const customer_id = customerByUserPass.get(user_pass_id) ?? null;

      const baseJob = {
        project_id: projectId,
        notification_id: notificationId,
        customer_id,
        user_pass_id,
        notification_type: trigger_type,
        title,
        body: message,
        data: {
          ...((body.data ?? {}) as Record<string, unknown>),
          segment: body.segment ?? null,
          pass: {
            id: p.id,
            pass_type: passType,
            pass_token: p.pass_token ?? null,
            device_key: p.device_key ?? null,
            google_object_id: p.google_object_id ?? null,
            google_class_id: p.google_class_id ?? null,
            expires_at: p.expires_at ?? null,
            install_status: installStatus,
          },
          notify: true,
        },
        status: "pending",
        priority: 100,
        scheduled_for: scheduleIso,
        available_at: scheduleIso ?? nowIso,
        max_attempts: 8,
      };

      // 🍎 Apple job consome 1 slot
      if (canApple) {
        const ok = await tryConsumeNotificationSlot();
        if (!ok) {
          skipped_limit += 1;
          limit_reached = true;
        } else {
          jobs.push({
            ...baseJob,
            platform: "apple",
            idempotency_key: `notif:${notificationId}:apple:${user_pass_id}:${contentHash}`,
          });
        }
      }

      // 🤖 Google job consome 1 slot
      if (canGoogle) {
        const ok = await tryConsumeNotificationSlot();
        if (!ok) {
          skipped_limit += 1;
          limit_reached = true;
        } else {
          jobs.push({
            ...baseJob,
            platform: "google",
            idempotency_key: `notif:${notificationId}:google:${user_pass_id}:${contentHash}`,
          });
        }
      }
    }

    if (jobs.length === 0) {
      // Não tem nenhum job elegível (ou limite estourou em tudo)
      return jsonResponse(
        200,
        {
          ok: true,
          notification_id: notificationId,
          jobs_created: 0,
          skipped: {
            removed: skipped_removed,
            no_platform: skipped_no_platform,
            limit: skipped_limit,
          },
          limit_reached,
          note: limit_reached
            ? "Limite de notificações atingido: nenhum job foi enfileirado."
            : "Nenhum job elegível foi criado.",
        },
        origin
      );
    }

    const BATCH = 500;
    let created = 0;

    for (let i = 0; i < jobs.length; i += BATCH) {
      const chunk = jobs.slice(i, i + BATCH);
      const { error: jobsErr } = await admin.from("notification_jobs").insert(chunk);
      if (jobsErr) throw jobsErr;
      created += chunk.length;
    }

    return jsonResponse(
      200,
      {
        ok: true,
        notification_id: notificationId,
        jobs_created: created,
        skipped: {
          removed: skipped_removed,
          no_platform: skipped_no_platform,
          limit: skipped_limit,
        },
        limit_reached,
      },
      origin
    );
  } catch (err) {
    return jsonResponse(
      500,
      { error: (err as any)?.message || "Erro inesperado" },
      origin
    );
  }
});
