/// <reference types="https://deno.land/x/deno/cli/types/dts/index.d.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assertProjectUsageAllowed,
  isProjectBillingInactiveError,
  isProjectUsageLimitExceededError,
  PROJECT_BILLING_INACTIVE,
  PROJECT_USAGE_LIMIT_EXCEEDED,
} from "../_shared/billingAccess.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Segredo só pro cron (pg_cron/pg_net)
const CRON_SECRET = (Deno.env.get("CRON_SECRET") ?? "").trim();

const GOOGLE_FN = "send-google-notification";
const APPLE_FN = "send-apple-notification";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function cleanUuid(v: unknown): string | null {
  const s = cleanString(v);
  if (!s) return null;
  // validação simples
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return null;
  return s;
}

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

function computeBackoffSeconds(attempts: number) {
  const table = [60, 300, 900, 3600, 21600]; // 1m, 5m, 15m, 1h, 6h
  return table[Math.min(Math.max(attempts - 1, 0), table.length - 1)];
}

const RECURRING_TRIGGER_TYPE = "recurring_weekly";
const RECURRING_TIMEZONE = "America/Sao_Paulo";
const DAY_MS = 24 * 60 * 60 * 1000;

type WeeklyRecurrence = {
  type: "weekly";
  timezone: string;
  daysOfWeek: number[];
  timeOfDay: string;
};

function isValidTimeOfDay(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());
}

function parseWeeklyRecurrence(raw: unknown): WeeklyRecurrence | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const type = cleanString(record.type);
  if (type !== "weekly") return null;

  const timezone = cleanString(record.timezone);
  if (!timezone || timezone !== RECURRING_TIMEZONE) return null;

  const daysRaw = Array.isArray(record.daysOfWeek) ? record.daysOfWeek : [];
  const daysOfWeek = Array.from(
    new Set(
      daysRaw
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 1 && v <= 7)
    )
  ).sort((a, b) => a - b);

  if (daysOfWeek.length === 0) return null;

  const timeOfDay = cleanString(record.timeOfDay);
  if (!isValidTimeOfDay(timeOfDay)) return null;

  return {
    type: "weekly",
    timezone,
    daysOfWeek,
    timeOfDay,
  };
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

function computeNextWeeklyOccurrence(startIso: string, recurrence: WeeklyRecurrence) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;

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

  return null;
}

function isUniqueViolation(err: unknown) {
  const code = typeof err === "object" && err ? (err as any).code : null;
  const msg = typeof err === "object" && err ? String((err as any).message || "") : "";
  return code === "23505" || /duplicate key/i.test(msg);
}

type MaterializeStats = {
  campaigns_picked: number;
  campaigns_advanced: number;
  campaigns_failed: number;
  jobs_created: number;
  jobs_canceled_by_limit: number;
  jobs_skipped_removed: number;
  jobs_skipped_no_platform: number;
  jobs_skipped_duplicate: number;
};

function newMaterializeStats(): MaterializeStats {
  return {
    campaigns_picked: 0,
    campaigns_advanced: 0,
    campaigns_failed: 0,
    jobs_created: 0,
    jobs_canceled_by_limit: 0,
    jobs_skipped_removed: 0,
    jobs_skipped_no_platform: 0,
    jobs_skipped_duplicate: 0,
  };
}

async function materializeRecurringWeeklyNotifications(
  sb: ReturnType<typeof createClient>,
  maxCampaigns = 25
): Promise<MaterializeStats> {
  const stats = newMaterializeStats();
  const nowIso = new Date().toISOString();

  const { data: campaigns, error: campaignsErr } = await sb
    .from("notifications")
    .select(
      "id, project_id, title, message, channels, trigger_type, trigger_config, status, scheduled_for"
    )
    .eq("trigger_type", RECURRING_TRIGGER_TYPE)
    .eq("status", "active")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(maxCampaigns);

  if (campaignsErr) {
    console.error("materializeRecurring.fetch.error", campaignsErr.message);
    return stats;
  }

  for (const campaign of campaigns || []) {
    stats.campaigns_picked += 1;
    let campaignHasFatalError = false;

    const notificationId = cleanUuid(campaign.id);
    const projectId = cleanUuid(campaign.project_id);
    const occurrenceIso = cleanString(campaign.scheduled_for);
    const message = cleanString(campaign.message);
    const title = cleanString(campaign.title) ?? "Envio recorrente";

    if (!notificationId || !projectId || !occurrenceIso || !message) {
      stats.campaigns_failed += 1;
      await sb
        .from("notifications")
        .update({ status: "failed", sent_at: new Date().toISOString() })
        .eq("id", campaign.id);
      continue;
    }

    const triggerConfig =
      campaign.trigger_config && typeof campaign.trigger_config === "object"
        ? (campaign.trigger_config as Record<string, unknown>)
        : {};
    const recurrence = parseWeeklyRecurrence(triggerConfig.recurrence);

    if (!recurrence) {
      stats.campaigns_failed += 1;
      await sb
        .from("notifications")
        .update({ status: "failed", sent_at: new Date().toISOString() })
        .eq("id", campaign.id);
      continue;
    }

    const nextRefIso = new Date(new Date(occurrenceIso).getTime() + 1000).toISOString();
    const nextOccurrenceIso = computeNextWeeklyOccurrence(nextRefIso, recurrence);
    if (!nextOccurrenceIso) {
      stats.campaigns_failed += 1;
      await sb
        .from("notifications")
        .update({ status: "failed", sent_at: new Date().toISOString() })
        .eq("id", campaign.id);
      continue;
    }

    const userPassIds = Array.isArray(triggerConfig.user_pass_ids)
      ? triggerConfig.user_pass_ids.map(cleanUuid).filter((v): v is string => Boolean(v))
      : [];

    if (userPassIds.length > 0) {
      const { data: userPasses, error: passErr } = await sb
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
        .in("id", userPassIds)
        .eq("passes.project_id", projectId);

      if (passErr) {
        stats.campaigns_failed += 1;
        console.error("materializeRecurring.userPasses.error", campaign.id, passErr.message);
        await sb
          .from("notifications")
          .update({ status: "failed", sent_at: new Date().toISOString() })
          .eq("id", campaign.id);
        continue;
      }

      const { data: custLinks, error: custErr } = await sb
        .from("customers")
        .select("id, user_pass_id")
        .eq("project_id", projectId)
        .in("user_pass_id", userPassIds);

      if (custErr) {
        stats.campaigns_failed += 1;
        console.error("materializeRecurring.customers.error", campaign.id, custErr.message);
        await sb
          .from("notifications")
          .update({ status: "failed", sent_at: new Date().toISOString() })
          .eq("id", campaign.id);
        continue;
      }

      const customerByUserPass = new Map<string, string>();
      for (const c of custLinks || []) {
        if (c.user_pass_id && c.id) {
          customerByUserPass.set(c.user_pass_id, c.id);
        }
      }

      const channels =
        campaign.channels && typeof campaign.channels === "object"
          ? (campaign.channels as Record<string, unknown>)
          : {};
      const appleEnabled = channels.apple !== false;
      const googleEnabled = channels.google !== false;
      const enabledChannels = { apple: appleEnabled, google: googleEnabled };

      for (const pass of userPasses || []) {
        const userPassId = cleanUuid(pass.id);
        if (!userPassId) continue;

        const installStatus = cleanString(pass.install_status) ?? null;
        if (installStatus === "removed") {
          stats.jobs_skipped_removed += 1;
          continue;
        }

        const passType = cleanString(pass.pass_type)?.toLowerCase() ?? null;
        const installPlatform = normalizeWalletPlatform(pass.install_platform);
        const platforms = getEligiblePlatforms({
          channels: enabledChannels,
          installPlatform,
          passType,
          deviceKey: pass.device_key,
          googleObjectId: pass.google_object_id,
        });

        if (platforms.length === 0) {
          stats.jobs_skipped_no_platform += 1;
          continue;
        }

        const customerId = customerByUserPass.get(userPassId) ?? null;

        for (const platform of platforms) {
          const idempotencyKey = `recurring:${notificationId}:${platform}:${userPassId}:${occurrenceIso}`;
          const baseInsert = {
            project_id: projectId,
            notification_id: notificationId,
            customer_id: customerId,
            user_pass_id: userPassId,
            platform,
            notification_type: RECURRING_TRIGGER_TYPE,
            title,
            body: message,
            data: {
              source: "recurring_weekly",
              segment: triggerConfig.segment ?? null,
              recurrence: {
                ...recurrence,
                occurrence_at: occurrenceIso,
              },
              pass: {
                id: pass.id,
                pass_type: passType,
                pass_token: pass.pass_token ?? null,
                device_key: pass.device_key ?? null,
                google_object_id: pass.google_object_id ?? null,
                google_class_id: pass.google_class_id ?? null,
                expires_at: pass.expires_at ?? null,
                install_status: installStatus,
                install_platform: installPlatform,
              },
              notify: true,
            },
            idempotency_key: idempotencyKey,
            status: "pending",
            priority: 100,
            scheduled_for: occurrenceIso,
            available_at: occurrenceIso,
            attempts: 0,
            max_attempts: 8,
            last_error: null,
            last_error_at: null,
          };

          const { data: insertedJob, error: insertErr } = await sb
            .from("notification_jobs")
            .insert(baseInsert)
            .select("id")
            .maybeSingle();

          if (insertErr) {
            if (isUniqueViolation(insertErr)) {
              stats.jobs_skipped_duplicate += 1;
              continue;
            }

            stats.campaigns_failed += 1;
            console.error("materializeRecurring.insert.error", campaign.id, insertErr.message);
            await sb
              .from("notifications")
              .update({ status: "failed", sent_at: new Date().toISOString() })
              .eq("id", campaign.id);
            campaignHasFatalError = true;
            break;
          }

          if (!insertedJob?.id) continue;
          stats.jobs_created += 1;
        }

        if (campaignHasFatalError) break;
      }
    }

    if (campaignHasFatalError) continue;

    const { error: advanceErr } = await sb
      .from("notifications")
      .update({
        scheduled_for: nextOccurrenceIso,
        status: "active",
      })
      .eq("id", campaign.id)
      .eq("status", "active");

    if (advanceErr) {
      stats.campaigns_failed += 1;
      console.error("materializeRecurring.advance.error", campaign.id, advanceErr.message);
      continue;
    }

    stats.campaigns_advanced += 1;
  }

  return stats;
}

// Gate de segurança:
// - Se CRON_SECRET existir: exige x-cron-secret correto OU Authorization Bearer service_role (fallback debug)
// - Se CRON_SECRET NÃO existir: permite (mas recomendo MUITO setar)
function assertRunnerAuth(req: Request) {
  if (!CRON_SECRET) return;

  const cronGot = req.headers.get("x-cron-secret") ?? "";
  if (cronGot && cronGot === CRON_SECRET) return;

  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  if (auth === `Bearer ${SERVICE_ROLE_KEY}`) return;

  throw new Error("Unauthorized (missing/invalid x-cron-secret)");
}

async function callFn(path: string, payload: unknown) {
  const resp = await fetch(`${FUNCTIONS_URL}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text().catch(() => "");
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }

  return { ok: resp.ok, status: resp.status, data };
}

/**
 * Finaliza o status macro em public.notifications quando TODOS os jobs
 * de uma notification_id estão finalizados (sem pending/processing/rate_limited).
 *
 * Regras:
 * - Se não tem mais jobs abertos:
 *   - canceled se canceled=total
 *   - failed se sent=0 e houver falhas/cancelamentos
 *   - partial_failed se sent>0 e houver falhas/cancelamentos
 *   - sent se todos foram enviados
 */
async function finalizeNotifications(sb: ReturnType<typeof createClient>, notificationIds: string[]) {
  const uniq = Array.from(new Set(notificationIds)).filter(Boolean);
  if (uniq.length === 0) return;

  for (const notificationId of uniq) {
    const { data: notificationMeta, error: metaErr } = await sb
      .from("notifications")
      .select("trigger_type")
      .eq("id", notificationId)
      .maybeSingle();

    if (metaErr) {
      console.error("finalizeNotifications.meta.error", notificationId, metaErr.message);
      continue;
    }

    if (notificationMeta?.trigger_type === RECURRING_TRIGGER_TYPE) {
      continue;
    }

    // 1) Ainda existe job "aberto"?
    const { count: openCount, error: openErr } = await sb
      .from("notification_jobs")
      .select("id", { count: "exact", head: true })
      .eq("notification_id", notificationId)
      .in("status", ["pending", "processing", "rate_limited"]);

    if (openErr) {
      console.error("finalizeNotifications.openCount.error", notificationId, openErr.message);
      continue;
    }

    if ((openCount ?? 0) > 0) continue; // ainda não acabou

    // 2) Contagens finais
    const [
      { count: totalCount, error: totalErr },
      { count: sentCount, error: sentErr },
      { count: failedCount, error: failedErr },
      { count: canceledCount, error: canceledErr },
    ] =
      await Promise.all([
        sb.from("notification_jobs").select("id", { count: "exact", head: true }).eq("notification_id", notificationId),
        sb.from("notification_jobs").select("id", { count: "exact", head: true }).eq("notification_id", notificationId).eq("status", "sent"),
        sb.from("notification_jobs").select("id", { count: "exact", head: true }).eq("notification_id", notificationId).eq("status", "failed"),
        sb.from("notification_jobs").select("id", { count: "exact", head: true }).eq("notification_id", notificationId).eq("status", "canceled"),
      ]);

    if (totalErr) {
      console.error("finalizeNotifications.totalCount.error", notificationId, totalErr.message);
      continue;
    }
    if (sentErr) {
      console.error("finalizeNotifications.sentCount.error", notificationId, sentErr.message);
      continue;
    }
    if (failedErr) {
      console.error("finalizeNotifications.failedCount.error", notificationId, failedErr.message);
      continue;
    }
    if (canceledErr) {
      console.error("finalizeNotifications.canceledCount.error", notificationId, canceledErr.message);
      continue;
    }

    const total = totalCount ?? 0;
    const sent = sentCount ?? 0;
    const failed = failedCount ?? 0;
    const canceled = canceledCount ?? 0;

    if (total === 0) {
      // Notificação existe mas sem jobs — não mexe (ou você pode marcar failed)
      continue;
    }

    let finalStatus: string;
    if (canceled === total) {
      finalStatus = "canceled";
    } else if (sent === 0 && failed + canceled > 0) {
      finalStatus = "failed";
    } else if (sent > 0 && failed + canceled > 0) {
      finalStatus = "partial_failed";
    } else if (sent === total) {
      finalStatus = "sent";
    } else {
      finalStatus = "partial_failed";
    }

    // 3) Atualiza notifications
    const { error: updErr } = await sb
      .from("notifications")
      .update({
        status: finalStatus,
        sent_at: finalStatus === "canceled" ? null : new Date().toISOString(),
      })
      .eq("id", notificationId);

    if (updErr) {
      console.error("finalizeNotifications.notifications.update.error", notificationId, updErr.message);
    }
  }
}

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    assertRunnerAuth(req);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number((body as any)?.limit ?? 25), 1), 200);
    const workerId = `runner:${crypto.randomUUID().slice(0, 8)}`;
    const recurringCampaignLimit = Math.min(
      Math.max(Number((body as any)?.recurring_limit ?? 25), 1),
      200
    );

    const materialized = await materializeRecurringWeeklyNotifications(
      sb,
      recurringCampaignLimit
    );

    const { data: jobs, error } = await sb.rpc("claim_notification_jobs", {
      p_limit: limit,
      p_worker: workerId,
      p_lock_timeout_minutes: 5,
    });

    if (error) {
      return json(500, { ok: false, error: "claim_failed", message: error.message });
    }

    if (!jobs || jobs.length === 0) {
      return json(200, {
        ok: true,
        picked: 0,
        sent: 0,
        failed: 0,
        requeued: 0,
        canceled_by_limit: 0,
        recurring_materialized: materialized,
      });
    }

    let sent = 0;
    let failed = 0;
    let requeued = 0;
    let canceled_by_limit = 0;

    // ✅ notificações tocadas no batch para finalização macro
    const touchedNotificationIds: string[] = [];

    for (const job of jobs) {
  try {
    const platform = cleanString(job.platform) ?? "";
    const message = cleanString(job.body) ?? "";
    const title = cleanString(job.title) ?? "Allin Pass";

    // Compatível com os dois formatos:
    // 1) data.pass.{...}
    // 2) data.{pass_token, google_object_id, install_status, ...}
    const pass = job.data?.pass ?? {};
    const passToken =
      cleanString(pass.pass_token) ??
      cleanString(job.data?.pass_token);

    const googleObjectId =
      cleanString(pass.google_object_id) ??
      cleanString(job.data?.google_object_id);

    const installStatus =
      cleanString(pass.install_status) ??
      cleanString(job.data?.install_status) ??
      "installed";

    if (!message) throw new Error("missing_message");

    const projectId = cleanUuid(job.project_id);
    if (!projectId) throw new Error("missing_project_id");

    const userPassId = cleanUuid(job.user_pass_id);
    if (!userPassId) throw new Error("missing_user_pass_id");

    const notificationId = cleanUuid(job.notification_id);
    if (notificationId) touchedNotificationIds.push(notificationId);

    try {
      await assertProjectUsageAllowed(sb, projectId, "notification_sent");
    } catch (quotaErr) {
      if (isProjectUsageLimitExceededError(quotaErr) || isProjectBillingInactiveError(quotaErr)) {
        const lastError = isProjectBillingInactiveError(quotaErr)
          ? "project_billing_inactive"
          : "notifications_limit_reached";

        console.warn(isProjectBillingInactiveError(quotaErr) ? PROJECT_BILLING_INACTIVE : PROJECT_USAGE_LIMIT_EXCEEDED, {
          job_id: job.id,
          project_id: projectId,
          resource_type: "notification_sent",
        });

        const { error: cancelErr } = await sb
          .from("notification_jobs")
          .update({
            status: "canceled",
            last_error: lastError,
            last_error_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
          })
          .eq("id", job.id);

        if (cancelErr) throw new Error(`cancel_by_limit_failed:${cancelErr.message}`);

        if (lastError === "notifications_limit_reached") canceled_by_limit++;
        continue;
      }

      throw quotaErr;
    }

    if (platform === "google") {
      if (!googleObjectId) throw new Error("missing_google_object_id");

      const r = await callFn(GOOGLE_FN, {
        projectId,
        header: null,
        message,
        targets: [
          {
            project_id: projectId,
            user_pass_id: userPassId,
            install_platform: "google",
            install_status: installStatus,
            google_object_id: googleObjectId,
          },
        ],
      });

      if (!r.ok || r.data?.error) {
        throw new Error(`google_error_${r.status}:${String(JSON.stringify(r.data)).slice(0, 200)}`);
      }
    } else if (platform === "apple") {
      if (!passToken) throw new Error("missing_apple_token");

      const r = await callFn(APPLE_FN, {
        projectId,
        message,
        targets: [
          {
            project_id: projectId,
            user_pass_id: userPassId,
            install_platform: "apple",
            install_status: installStatus,
            pass_token: passToken,
          },
        ],
      });

      if (!r.ok || r.data?.error) {
        throw new Error(`apple_error_${r.status}:${String(JSON.stringify(r.data)).slice(0, 200)}`);
      }
    } else {
      throw new Error("unknown_platform");
    }

    const { data: updatedJob, error: sentUpdErr } = await sb
      .from("notification_jobs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", job.id)
      .select("id,status,last_error")
      .maybeSingle();

    if (sentUpdErr) {
      throw new Error(`mark_sent_failed:${sentUpdErr.message}`);
    }

    if (!updatedJob) {
      throw new Error("mark_sent_failed:missing_updated_row");
    }

    if (updatedJob.status === "sent") {
      sent++;
    } else if (
      updatedJob.status === "canceled" &&
      updatedJob.last_error === "notifications_limit_reached"
    ) {
      canceled_by_limit++;
    } else {
      failed++;
    }
  } catch (e: any) {
    const attempts = (job.attempts ?? 0) + 1;
    const max = job.max_attempts ?? 8;
    const errMsg = String(e?.message ?? e).slice(0, 300);

    if (attempts >= max) {
      await sb
        .from("notification_jobs")
        .update({
          status: "failed",
          attempts,
          last_error: errMsg,
          last_error_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
        })
        .eq("id", job.id);

      failed++;
    } else {
      const delay = computeBackoffSeconds(attempts);
      const next = new Date(Date.now() + delay * 1000).toISOString();

      await sb
        .from("notification_jobs")
        .update({
          status: "pending",
          attempts,
          last_error: errMsg,
          last_error_at: new Date().toISOString(),
          available_at: next,
          locked_at: null,
          locked_by: null,
        })
        .eq("id", job.id);

      requeued++;
    }
  }
}
    // ✅ finaliza status macro das notifications afetadas
    await finalizeNotifications(sb, touchedNotificationIds);

    return json(200, {
      ok: true,
      picked: jobs.length,
      sent,
      failed,
      requeued,
      canceled_by_limit,
      recurring_materialized: materialized,
    });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return json(status, { ok: false, error: msg });
  }
});
