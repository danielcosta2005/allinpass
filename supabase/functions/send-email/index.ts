import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

type EmailJob = {
  id: string;
  event_type: string;
  project_id: string | null;
  subscription_id: string | null;
  to_email: string;
  to_name: string | null;
  subject: string;
  html_body: string;
  text_body: string;
  provider: string;
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  metadata: Record<string, unknown> | null;
};

type DispatcherConfig = {
  resendApiKey: string;
  resendFromEmail: string;
  appOrgUrl: string;
};

class HttpError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    const message = typeof payload.error === "string" ? payload.error : "Request failed.";
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.payload = payload;
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function requiredEnv(name: string) {
  const value = String(Deno.env.get(name) ?? "").trim();
  if (!value) {
    throw new HttpError(500, {
      ok: false,
      code: "SEND_EMAIL_MISSING_ENV",
      error: `${name} ausente.`,
    });
  }
  return value;
}

function extractBearerToken(req: Request) {
  const authorization = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

function normalizeSource(value: unknown) {
  if (typeof value !== "string") return "manual";
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return cleaned ? cleaned.slice(0, 40) : "manual";
}

function normalizeAppOrgUrl(rawBaseUrl: string) {
  try {
    const baseUrl = new URL(rawBaseUrl);
    if (!["http:", "https:"].includes(baseUrl.protocol)) {
      throw new Error("Invalid protocol");
    }
    return new URL("/org", `${baseUrl.origin}/`).toString();
  } catch {
    throw new HttpError(500, {
      ok: false,
      code: "SEND_EMAIL_INVALID_APP_BASE_URL",
      error: "APP_BASE_URL invalida.",
    });
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHtmlTemplate(template: string, appOrgUrl: string) {
  return String(template || "").replaceAll("{{app_org_url}}", escapeHtml(appOrgUrl));
}

function renderTextTemplate(template: string, appOrgUrl: string) {
  return String(template || "").replaceAll("{{app_org_url}}", appOrgUrl);
}

function sanitizeTagValue(value: unknown) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 256);
  return cleaned || "unknown";
}

function buildResendTags(job: EmailJob) {
  const tags = [
    { name: "event_type", value: sanitizeTagValue(job.event_type) },
  ];

  if (job.project_id) {
    tags.push({ name: "project_id", value: sanitizeTagValue(job.project_id) });
  }

  if (job.subscription_id) {
    tags.push({ name: "subscription_id", value: sanitizeTagValue(job.subscription_id) });
  }

  return tags;
}

function truncate(value: unknown, maxLength = 1000) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function retryDelayMs(attempts: number) {
  const normalizedAttempts = Math.max(1, Math.trunc(Number(attempts) || 1));
  const seconds = Math.min(3600, 60 * (2 ** Math.max(normalizedAttempts - 1, 0)));
  return seconds * 1000;
}

async function parseJsonBody(req: Request) {
  const rawBody = await req.text();
  if (!rawBody.trim()) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, {
      ok: false,
      code: "SEND_EMAIL_INVALID_JSON",
      error: "Payload JSON invalido.",
    });
  }
}

async function sendWithResend(job: EmailJob, config: DispatcherConfig) {
  if (job.provider !== "resend") {
    throw new Error(`Unsupported email provider: ${job.provider}`);
  }

  const response = await fetch(RESEND_EMAIL_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": job.idempotency_key,
    },
    body: JSON.stringify({
      from: config.resendFromEmail,
      to: [job.to_email],
      subject: renderTextTemplate(job.subject, config.appOrgUrl),
      html: renderHtmlTemplate(job.html_body, config.appOrgUrl),
      text: renderTextTemplate(job.text_body, config.appOrgUrl),
      tags: buildResendTags(job),
    }),
  });

  const responseText = await response.text();
  let parsed: Record<string, unknown> | null = null;
  if (responseText.trim()) {
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const providerError = typeof parsed?.message === "string"
      ? parsed.message
      : responseText;
    throw new Error(`Resend ${response.status}: ${truncate(providerError, 500)}`);
  }

  return typeof parsed?.id === "string" ? parsed.id : null;
}

async function markJobSent(
  supabaseAdmin: any,
  job: EmailJob,
  providerMessageId: string | null,
) {
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("email_outbox")
    .update({
      status: "sent",
      sent_at: nowIso,
      failed_at: null,
      locked_at: null,
      locked_by: null,
      next_attempt_at: null,
      provider_message_id: providerMessageId,
      last_error: null,
    })
    .eq("id", job.id);

  if (error) throw error;
}

async function markJobFailed(
  supabaseAdmin: any,
  job: EmailJob,
  error: unknown,
) {
  const attempts = Math.max(1, Math.trunc(Number(job.attempts) || 1));
  const maxAttempts = Math.max(1, Math.trunc(Number(job.max_attempts) || 5));
  const exhausted = attempts >= maxAttempts;
  const now = new Date();
  const nextAttemptAt = exhausted
    ? null
    : new Date(now.getTime() + retryDelayMs(attempts)).toISOString();

  const { error: updateError } = await supabaseAdmin
    .from("email_outbox")
    .update({
      status: exhausted ? "failed" : "pending",
      failed_at: exhausted ? now.toISOString() : null,
      locked_at: null,
      locked_by: null,
      next_attempt_at: nextAttemptAt,
      last_error: truncate(error),
    })
    .eq("id", job.id);

  if (updateError) throw updateError;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    if (req.method !== "POST") {
      throw new HttpError(405, {
        ok: false,
        code: "SEND_EMAIL_METHOD_NOT_ALLOWED",
        error: "Metodo nao permitido.",
      });
    }

    const emailDispatchSecret = requiredEnv("EMAIL_DISPATCH_SECRET");
    if (extractBearerToken(req) !== emailDispatchSecret) {
      throw new HttpError(401, {
        ok: false,
        code: "SEND_EMAIL_UNAUTHORIZED",
        error: "Unauthorized.",
      });
    }

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const config: DispatcherConfig = {
      resendApiKey: requiredEnv("RESEND_API_KEY"),
      resendFromEmail: requiredEnv("RESEND_FROM_EMAIL"),
      appOrgUrl: normalizeAppOrgUrl(requiredEnv("APP_BASE_URL")),
    };

    const body = await parseJsonBody(req) as Record<string, unknown>;
    const limit = normalizeLimit(body.limit);
    const source = normalizeSource(body.source);
    const worker = `send-email:${source}:${crypto.randomUUID()}`;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error: claimError } = await supabaseAdmin.rpc("claim_email_outbox_jobs", {
      p_limit: limit,
      p_worker: worker,
      p_lock_timeout_minutes: 10,
    });

    if (claimError) throw claimError;

    const jobs = (Array.isArray(data) ? data : []) as EmailJob[];
    let sent = 0;
    let failed = 0;

    for (const job of jobs) {
      try {
        const providerMessageId = await sendWithResend(job, config);

        try {
          await markJobSent(supabaseAdmin, job, providerMessageId);
          sent += 1;
        } catch (markSentError) {
          failed += 1;
          console.error("send-email mark sent error", {
            job_id: job.id,
            error: truncate(markSentError),
          });
        }
      } catch (sendError) {
        failed += 1;

        try {
          await markJobFailed(supabaseAdmin, job, sendError);
        } catch (markFailedError) {
          console.error("send-email mark failed error", {
            job_id: job.id,
            send_error: truncate(sendError),
            update_error: truncate(markFailedError),
          });
        }
      }
    }

    return jsonResponse({
      ok: true,
      processed: jobs.length,
      sent,
      failed,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(error.payload, error.status);
    }

    console.error("send-email error", truncate(error));
    return jsonResponse({
      ok: false,
      code: "SEND_EMAIL_INTERNAL_ERROR",
      error: "Falha ao processar emails.",
    }, 500);
  }
});
