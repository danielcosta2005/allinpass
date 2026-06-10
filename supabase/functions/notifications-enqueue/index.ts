/// <reference types="https://deno.land/x/deno/cli/types/dts/index.d.ts" />
// branch
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assertProjectBillingActive,
  getProjectBillingInactivePayload,
  getProjectUsageLimitExceededPayload,
  getProjectUsageQuotaState,
  isProjectBillingInactiveError,
  isProjectUsageLimitExceededError,
  PROJECT_USAGE_LIMIT_EXCEEDED,
  ProjectUsageLimitExceededError,
} from "../_shared/billingAccess.ts";

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
  recurrence?: unknown | null;
  segment?: unknown | null;
  user_pass_ids: string[];
  channels?: { apple?: boolean; google?: boolean } | null;
  data?: Record<string, unknown> | null;
};

type WalletPlatform = "apple" | "google";

function normalizeWalletPlatform(v: unknown): WalletPlatform | null {
  const s = cleanString(v)?.toLowerCase();
  return s === "apple" || s === "google" ? s : null;
}

function getEligiblePlatforms(params: {
  channels: { apple?: boolean; google?: boolean };
  installPlatform: WalletPlatform | null;
  passType: string | null;
  deviceKey: unknown;
  googleObjectId: unknown;
}): WalletPlatform[] {
  const hasGoogleObjectId = Boolean(cleanString(params.googleObjectId));
  const hasDeviceKey = Boolean(cleanString(params.deviceKey));

  if (params.installPlatform === "google") {
    return params.channels.google && hasGoogleObjectId ? ["google"] : [];
  }

  if (params.installPlatform === "apple") {
    return params.channels.apple ? ["apple"] : [];
  }

  if (hasGoogleObjectId) {
    return params.channels.google ? ["google"] : [];
  }

  if (params.channels.apple && (params.passType === "apple" || hasDeviceKey)) {
    return ["apple"];
  }

  return [];
}

type WeeklyRecurrence = {
  type: "weekly";
  timezone: string;
  daysOfWeek: number[];
  timeOfDay: string;
};

const VALID_RECURRENCE_TIMEZONE = "America/Sao_Paulo";
const DAY_MS = 24 * 60 * 60 * 1000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isValidTimeOfDay(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - date.getTime();
}

function timeZoneDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
) {
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetUtc;

  for (let i = 0; i < 4; i += 1) {
    const offset = getTimeZoneOffsetMs(new Date(guess), timeZone);
    const corrected = targetUtc - offset;
    if (Math.abs(corrected - guess) < 1000) {
      guess = corrected;
      break;
    }
    guess = corrected;
  }

  return new Date(guess);
}

function addDaysToDateParts(year: number, month: number, day: number, days: number) {
  const utc = Date.UTC(year, month - 1, day) + days * DAY_MS;
  const d = new Date(utc);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function getIsoWeekday(year: number, month: number, day: number) {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function parseWeeklyRecurrence(raw: unknown): WeeklyRecurrence | null {
  if (raw == null) return null;
  if (!isPlainObject(raw)) throw new Error("recurrence inválido (esperado objeto)");

  const type = cleanString(raw.type);
  if (type !== "weekly") throw new Error("recurrence.type inválido (use 'weekly')");

  const timezone = cleanString(raw.timezone);
  if (!timezone || timezone !== VALID_RECURRENCE_TIMEZONE) {
    throw new Error(`recurrence.timezone inválido (use '${VALID_RECURRENCE_TIMEZONE}')`);
  }

  const daysRaw = Array.isArray(raw.daysOfWeek) ? raw.daysOfWeek : [];
  const daysOfWeek = Array.from(
    new Set(
      daysRaw
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 1 && v <= 7)
    )
  ).sort((a, b) => a - b);

  if (daysOfWeek.length === 0) {
    throw new Error("recurrence.daysOfWeek inválido (mínimo 1 dia entre 1 e 7)");
  }

  const timeOfDayRaw = cleanString(raw.timeOfDay);
  if (!isValidTimeOfDay(timeOfDayRaw)) {
    throw new Error("recurrence.timeOfDay inválido (esperado HH:mm)");
  }

  return {
    type: "weekly",
    timezone,
    daysOfWeek,
    timeOfDay: timeOfDayRaw,
  };
}

function computeFirstWeeklyOccurrence(startIso: string, recurrence: WeeklyRecurrence) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) {
    throw new Error("scheduledFor inválido para recorrência");
  }

  const startLocal = getTimeZoneParts(start, recurrence.timezone);
  const [hourStr, minuteStr] = recurrence.timeOfDay.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const startMinutes = startLocal.hour * 60 + startLocal.minute;
  const selectedDays = new Set(recurrence.daysOfWeek);

  for (let offset = 0; offset < 21; offset += 1) {
    const candidateDate = addDaysToDateParts(
      startLocal.year,
      startLocal.month,
      startLocal.day,
      offset
    );
    const weekday = getIsoWeekday(candidateDate.year, candidateDate.month, candidateDate.day);
    if (!selectedDays.has(weekday)) continue;

    const candidateMinutes = hour * 60 + minute;
    if (offset === 0 && candidateMinutes < startMinutes) continue;

    const candidateUtc = timeZoneDateTimeToUtc(
      candidateDate.year,
      candidateDate.month,
      candidateDate.day,
      hour,
      minute,
      recurrence.timezone
    );

    if (candidateUtc.getTime() < start.getTime()) continue;
    return candidateUtc.toISOString();
  }

  throw new Error("Não foi possível calcular a primeira ocorrência semanal");
}

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
    let recurrence: WeeklyRecurrence | null = null;
    try {
      recurrence = parseWeeklyRecurrence(body.recurrence);
    } catch (error) {
      return jsonResponse(
        400,
        { error: (error as Error)?.message || "recurrence inválido" },
        origin
      );
    }
    const isRecurringWeekly = recurrence?.type === "weekly";

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

    if (isRecurringWeekly && sendMode !== "schedule") {
      return jsonResponse(
        400,
        { error: "recurrence só é permitido quando sendMode='schedule'" },
        origin
      );
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
    await assertProjectBillingActive(admin, projectId);

    const channels = {
      apple: body.channels?.apple ?? true,
      google: body.channels?.google ?? true,
    };

    // 🧾 5) Criar notification
    let effectiveScheduledFor = scheduledFor ?? null;
    if (isRecurringWeekly && scheduledFor) {
      try {
        effectiveScheduledFor = computeFirstWeeklyOccurrence(
          scheduledFor,
          recurrence as WeeklyRecurrence
        );
      } catch (error) {
        return jsonResponse(
          400,
          {
            error:
              (error as Error)?.message ||
              "Não foi possível calcular a primeira ocorrência da recorrência",
          },
          origin
        );
      }
    }

    const trigger_type = isRecurringWeekly
      ? "recurring_weekly"
      : sendMode === "schedule"
        ? "scheduled"
        : "manual";
    const status = isRecurringWeekly
      ? "active"
      : sendMode === "schedule"
        ? "scheduled"
        : "running";

    const trigger_config = {
      source: "NotificationsTab",
      segment: body.segment ?? null,
      user_pass_ids: body.user_pass_ids,
      requested_by: userId,
      recurrence: recurrence ?? null,
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
        scheduled_for: effectiveScheduledFor,
        sent_at: null,
      })
      .select("id")
      .single();

    if (notifErr) throw notifErr;
    const notificationId = notif.id as string;

    if (isRecurringWeekly) {
      return jsonResponse(
        200,
        {
          ok: true,
          recurring: true,
          notification_id: notificationId,
          jobs_created: 0,
          scheduled_for: effectiveScheduledFor,
          note:
            "Campanha recorrente ativada. Os jobs serão materializados automaticamente pelo notifications-runner.",
        },
        origin
      );
    }

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
          "install_platform",
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

    // ⚙️ 8) Criar jobs
    let skipped_removed = 0;
    let skipped_no_platform = 0;
    let skipped_limit = 0;
    let limit_reached = false;

    const nowIso = new Date().toISOString();
    const scheduleIso = effectiveScheduledFor ?? null;
    const contentHash = await sha256Hex(
      `${title}::${message}::${scheduleIso ?? "now"}`
    );

    const jobs: any[] = [];

    for (const p of userPasses || []) {
      const user_pass_id = p.id as string;
      const installStatus = (p.install_status as string | null) ?? null;

      if (installStatus === "removed") {
        skipped_removed += 1;
        continue;
      }

      const passType = cleanString(p.pass_type)?.toLowerCase() ?? null;
      const installPlatform = normalizeWalletPlatform(p.install_platform);
      const platforms = getEligiblePlatforms({
        channels,
        installPlatform,
        passType,
        deviceKey: p.device_key,
        googleObjectId: p.google_object_id,
      });

      if (platforms.length === 0) {
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
            install_platform: installPlatform,
          },
          notify: true,
        },
        status: "pending",
        priority: 100,
        scheduled_for: scheduleIso,
        available_at: scheduleIso ?? nowIso,
        max_attempts: 8,
      };

      // 🍎 Apple job
      if (platforms.includes("apple")) {
        jobs.push({
          ...baseJob,
          platform: "apple",
          idempotency_key: `notif:${notificationId}:apple:${user_pass_id}:${contentHash}`,
        });
      }

      // 🤖 Google job
      if (platforms.includes("google")) {
        jobs.push({
          ...baseJob,
          platform: "google",
          idempotency_key: `notif:${notificationId}:google:${user_pass_id}:${contentHash}`,
        });
      }
    }

    if (jobs.length === 0) {
      // Não tem nenhum job elegível.
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
          note: "Nenhum job elegível foi criado.",
        },
        origin
      );
    }

    const quotaState = await getProjectUsageQuotaState(admin, projectId, "notification_sent", jobs.length);
    let availableJobQuota = jobs.length;
    let jobsToInsert = jobs;

    if (quotaState.isFreeTrial && quotaState.remaining !== null) {
      availableJobQuota = Math.max(0, quotaState.remaining);

      if (availableJobQuota <= 0) {
        console.warn(PROJECT_USAGE_LIMIT_EXCEEDED, {
          projectId,
          resourceType: "notification_sent",
        });
        const quotaError = new ProjectUsageLimitExceededError("notification_sent", quotaState);
        return jsonResponse(402, getProjectUsageLimitExceededPayload(quotaError), origin);
      }

      if (jobs.length > availableJobQuota) {
        skipped_limit = jobs.length - availableJobQuota;
        limit_reached = true;
        jobsToInsert = jobs.slice(0, availableJobQuota);
      }
    }

    const BATCH = 500;
    let created = 0;

    for (let i = 0; i < jobsToInsert.length; i += BATCH) {
      const chunk = jobsToInsert.slice(i, i + BATCH);
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
    if (isProjectBillingInactiveError(err)) {
      return jsonResponse(402, getProjectBillingInactivePayload(err), origin);
    }

    if (isProjectUsageLimitExceededError(err)) {
      return jsonResponse(402, getProjectUsageLimitExceededPayload(err), origin);
    }

    return jsonResponse(
      500,
      { error: (err as any)?.message || "Erro inesperado" },
      origin
    );
  }
});
