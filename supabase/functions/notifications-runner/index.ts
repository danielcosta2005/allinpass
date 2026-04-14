/// <reference types="https://deno.land/x/deno/cli/types/dts/index.d.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function computeBackoffSeconds(attempts: number) {
  const table = [60, 300, 900, 3600, 21600]; // 1m, 5m, 15m, 1h, 6h
  return table[Math.min(Math.max(attempts - 1, 0), table.length - 1)];
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
 *   - failed se sent=0 e failed=total
 *   - partial_failed se sent>0 e failed>0
 *   - sent caso contrário
 */
async function finalizeNotifications(sb: ReturnType<typeof createClient>, notificationIds: string[]) {
  const uniq = Array.from(new Set(notificationIds)).filter(Boolean);
  if (uniq.length === 0) return;

  for (const notificationId of uniq) {
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
    const [{ count: totalCount, error: totalErr }, { count: sentCount, error: sentErr }, { count: failedCount, error: failedErr }] =
      await Promise.all([
        sb.from("notification_jobs").select("id", { count: "exact", head: true }).eq("notification_id", notificationId),
        sb.from("notification_jobs").select("id", { count: "exact", head: true }).eq("notification_id", notificationId).eq("status", "sent"),
        sb.from("notification_jobs").select("id", { count: "exact", head: true }).eq("notification_id", notificationId).eq("status", "failed"),
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

    const total = totalCount ?? 0;
    const sent = sentCount ?? 0;
    const failed = failedCount ?? 0;

    if (total === 0) {
      // Notificação existe mas sem jobs — não mexe (ou você pode marcar failed)
      continue;
    }

    let finalStatus: string;
    if (sent === 0 && failed === total) {
      finalStatus = "failed";
    } else if (sent > 0 && failed > 0) {
      finalStatus = "partial_failed";
    } else {
      finalStatus = "sent";
    }

    // 3) Atualiza notifications
    const { error: updErr } = await sb
      .from("notifications")
      .update({
        status: finalStatus,
        sent_at: new Date().toISOString(),
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

    const { data: jobs, error } = await sb.rpc("claim_notification_jobs", {
      p_limit: limit,
      p_worker: workerId,
      p_lock_timeout_minutes: 5,
    });

    if (error) {
      return json(500, { ok: false, error: "claim_failed", message: error.message });
    }

    if (!jobs || jobs.length === 0) {
      return json(200, { ok: true, picked: 0, sent: 0, failed: 0, requeued: 0 });
    }

    let sent = 0;
    let failed = 0;
    let requeued = 0;

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

    await sb
      .from("notification_jobs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", job.id);

    sent++;
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
    });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return json(status, { ok: false, error: msg });
  }
});