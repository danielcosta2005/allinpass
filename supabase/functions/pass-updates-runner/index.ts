import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
const CRON_SECRET = (Deno.env.get("CRON_SECRET") ?? "").trim();

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

function computeBackoffSeconds(attempts: number) {
  const table = [60, 300, 900, 3600, 21600];
  return table[Math.min(Math.max(attempts - 1, 0), table.length - 1)];
}

function assertRunnerAuth(req: Request) {
  const auth = req.headers.get("authorization") ??
    req.headers.get("Authorization") ?? "";

  if (auth === `Bearer ${SERVICE_ROLE_KEY}`) return;

  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  if (CRON_SECRET && cronHeader === CRON_SECRET) return;

  if (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) return;

  throw new Error("Unauthorized (missing/invalid cron secret)");
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

async function refreshCampaigns(sb: any, ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  for (const id of uniqueIds) {
    const { error } = await sb.rpc("refresh_pass_update_campaign_status", {
      p_campaign_id: id,
    });
    if (error) {
      console.error("[pass-updates-runner] refresh campaign failed", {
        campaign_id: id,
        message: error.message,
      });
    }
  }
}

serve(async (req) => {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json(500, {
        ok: false,
        error: "missing_env",
        message: "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.",
      });
    }

    assertRunnerAuth(req);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit ?? 50), 1), 200);
    const workerId = `pass-updates:${crypto.randomUUID().slice(0, 8)}`;

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: jobs, error } = await sb.rpc("claim_pass_update_jobs", {
      p_limit: limit,
      p_worker: workerId,
      p_lock_timeout_minutes: 5,
    });

    if (error) {
      return json(500, {
        ok: false,
        error: "claim_failed",
        message: error.message,
      });
    }

    if (!jobs || jobs.length === 0) {
      return json(200, {
        ok: true,
        picked: 0,
        done: 0,
        failed: 0,
        requeued: 0,
      });
    }

    let done = 0;
    let failed = 0;
    let requeued = 0;
    const touchedCampaignIds: string[] = [];

    for (const job of jobs) {
      touchedCampaignIds.push(String(job.campaign_id));

      try {
        const jobType = cleanString(job.job_type);
        const passToken = cleanString(job.target_token) ??
          cleanString(job.data?.pass_token);
        const googleClassId = cleanString(job.google_class_id) ??
          cleanString(job.data?.google_class_id);

        let result: { ok: boolean; status: number; data: any };

        if (jobType === "apple_push") {
          if (!passToken) throw new Error("missing_apple_pass_token");
          result = await callFn("apple-push", { pass_token: passToken });
        } else if (jobType === "google_class_patch") {
          if (!googleClassId) throw new Error("missing_google_class_id");
          result = await callFn("google-push", {
            mode: "class",
            pass_id: job.pass_id,
            google_class_id: googleClassId,
          });
        } else if (jobType === "google_object_patch") {
          if (!passToken) throw new Error("missing_google_pass_token");
          result = await callFn("google-push", {
            pass_token: passToken,
            skip_class_patch: true,
            include_object_global_fields:
              job.data?.include_object_global_fields !== false,
          });
        } else {
          throw new Error(`unknown_job_type:${jobType ?? "null"}`);
        }

        if (!result.ok || result.data?.error) {
          throw new Error(
            `wallet_update_error_${result.status}:${
              String(JSON.stringify(result.data)).slice(0, 240)
            }`,
          );
        }

        const { error: doneError } = await sb
          .from("pass_update_jobs")
          .update({
            status: "done",
            processed_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
          })
          .eq("id", job.id);

        if (doneError) throw new Error(`mark_done_failed:${doneError.message}`);
        done++;
      } catch (e: any) {
        const attempts = (job.attempts ?? 0) + 1;
        const maxAttempts = job.max_attempts ?? 8;
        const errMsg = String(e?.message ?? e).slice(0, 300);

        if (attempts >= maxAttempts) {
          await sb
            .from("pass_update_jobs")
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
          const next = new Date(
            Date.now() + computeBackoffSeconds(attempts) * 1000,
          ).toISOString();

          await sb
            .from("pass_update_jobs")
            .update({
              status: "pending",
              attempts,
              available_at: next,
              last_error: errMsg,
              last_error_at: new Date().toISOString(),
              locked_at: null,
              locked_by: null,
            })
            .eq("id", job.id);
          requeued++;
        }
      }
    }

    await refreshCampaigns(sb, touchedCampaignIds);

    return json(200, {
      ok: true,
      picked: jobs.length,
      done,
      failed,
      requeued,
    });
  } catch (e: any) {
    const message = String(e?.message ?? e);
    const status = message.includes("Unauthorized") ? 401 : 500;
    return json(status, {
      ok: false,
      error: status === 401 ? "unauthorized" : "internal_error",
      message,
    });
  }
});
