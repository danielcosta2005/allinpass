/// <reference types="https://deno.land/x/deno/cli/types/dts/index.d.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// URL pública da sua própria edge function apple-push
const APPLE_PUSH_URL = Deno.env.get("APPLE_PUSH_URL");

// (Opcional) defesa extra entre serviços
const INTERNAL_FN_SECRET = Deno.env.get("INTERNAL_FN_SECRET");

function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-test-secret, x-internal-secret",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(status: number, body: unknown, origin?: string) {
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

function isUuidLike(v: unknown) {
  return typeof v === "string" && /^[0-9a-fA-F-]{36}$/.test(v);
}

function norm(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

/**
 * Limite simples de concorrência (sem libs)
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });

  await Promise.all(runners);
  return results;
}

serve(async (req) => {
  const origin = req.headers.get("origin") ?? "*";

  // ✅ preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  const requestId = crypto.randomUUID();

  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed", requestId }, origin);

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
    }
    if (!APPLE_PUSH_URL) {
      throw new Error("Missing env: APPLE_PUSH_URL");
    }

    const body = await req.json().catch(() => ({}));

    const projectId = cleanString(body?.projectId);
    const message = cleanString(body?.message);
    const targets = Array.isArray(body?.targets) ? body.targets : [];

    if (!projectId || !isUuidLike(projectId)) {
      return json(400, { error: "projectId inválido", requestId }, origin);
    }
    if (!message) return json(400, { error: "message is required", requestId }, origin);

    // (nice) anti-abuso / layout
    const safeMessage = message.length > 140 ? message.slice(0, 140) : message;

    // ✅ CORRETO: filtra por install_platform=apple e install_status=installed
    const appleTargets = targets
      .filter((t: any) => norm(t?.install_platform) === "apple")
      .filter((t: any) => norm(t?.install_status) === "installed")
      .map((t: any) => ({
        user_pass_id: cleanString(t?.user_pass_id),
        pass_token: cleanString(t?.pass_token),
        project_id: cleanString(t?.project_id),
      }))
      .filter((t: any) => t.pass_token && t.user_pass_id);

    if (appleTargets.length === 0) {
      return json(200, {
        ok: true,
        requestId,
        note: "Nenhum target Apple (installed) válido para envio.",
        totals: { received: targets.length, appleTargets: 0, sent: 0, failed: 0 },
        results: [],
      }, origin);
    }

    // defesa: só permite targets do mesmo projectId (do payload)
    const filteredByProject = appleTargets.filter((t: any) => t.project_id === projectId);

    if (filteredByProject.length === 0) {
      return json(403, {
        error: "Nenhum target Apple pertence ao projectId informado.",
        requestId,
      }, origin);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const nowIso = new Date().toISOString();

    const results = await runWithConcurrency(filteredByProject, 10, async (t: any) => {
      const token = t.pass_token as string;
      const userPassId = t.user_pass_id as string;

      try {
        // 1) DB check: garante que o user_pass pertence ao projeto e está installed/apple
        const { data: up, error: eUp } = await sb
          .from("user_passes")
          .select("id, metadata, install_platform, install_status, passes(project_id)")
          .eq("id", userPassId)
          .maybeSingle();

        if (eUp) throw new Error(`Erro ao buscar user_passes: ${eUp.message}`);
        if (!up) throw new Error("user_passes não encontrado");

        const passesRel = Array.isArray((up as any).passes) ? (up as any).passes[0] : (up as any).passes;
        const upProjectId = passesRel?.project_id ?? null;

        if (upProjectId !== projectId) throw new Error("Target não pertence ao projectId (DB check)");
        if (norm((up as any).install_platform) !== "apple") throw new Error("install_platform não é apple (DB check)");
        if (norm((up as any).install_status) !== "installed") throw new Error("install_status não é installed (DB check)");

        // 2) Atualiza metadata do user_passes
        const nextMetadata = {
          ...((up as any).metadata ?? {}),
          last_message: safeMessage,
          last_message_at: nowIso,
        };

        const { error: eUpd } = await sb
          .from("user_passes")
          .update({ metadata: nextMetadata })
          .eq("id", up.id);

        if (eUpd) throw new Error(`Erro ao atualizar metadata: ${eUpd.message}`);

        // 3) Chama apple-push para notificar device
        const pushResp = await fetch(APPLE_PUSH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            ...(INTERNAL_FN_SECRET ? { "x-internal-secret": INTERNAL_FN_SECRET } : {}),
          },
          body: JSON.stringify({
            token,
            reason: "segmented_message",
          }),
        });

        if (!pushResp.ok) {
          const t2 = await pushResp.text().catch(() => "");
          throw new Error(`Falha apple-push: HTTP ${pushResp.status} ${t2}`);
        }

        return { ok: true, user_pass_id: userPassId, pass_token: token };
      } catch (err) {
        return {
          ok: false,
          user_pass_id: userPassId,
          pass_token: token,
          error: String((err as any)?.message ?? err),
        };
      }
    });

    const sent = results.filter((r: any) => r.ok).length;
    const failed = results.length - sent;

    return json(200, {
      ok: true,
      requestId,
      projectId,
      message: safeMessage,
      last_message_at: nowIso,
      totals: {
        received: targets.length,
        appleTargets: appleTargets.length,
        filteredByProject: filteredByProject.length,
        sent,
        failed,
      },
      results,
    }, origin);
  } catch (err) {
    console.error(`[${requestId}] ❌ send-apple-segmented-notification error:`, err);
    return json(500, { error: String((err as any)?.message ?? err), requestId }, origin);
  }
});