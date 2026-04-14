/// <reference types="https://deno.land/x/deno/cli/types/dts/index.d.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = (Deno.env.get("CRON_SECRET") ?? "").trim();

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Mesmo gate de segurança da notifications-runner
function assertRunnerAuth(req: Request) {
  if (!CRON_SECRET) return;

  const cronGot = req.headers.get("x-cron-secret") ?? "";
  if (cronGot && cronGot === CRON_SECRET) return;

  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  if (auth === `Bearer ${SERVICE_ROLE_KEY}`) return;

  throw new Error("Unauthorized (missing/invalid x-cron-secret)");
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

    const { data, error } = await sb.rpc("enqueue_automation_notifications");

    if (error) {
      return json(500, {
        ok: false,
        error: "enqueue_active_automation_notifications_failed",
        message: error.message,
      });
    }

    return json(200, {
      ok: true,
      result: data,
    });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const status = msg.includes("Unauthorized") ? 401 : 500;
    return json(status, { ok: false, error: msg });
  }
});