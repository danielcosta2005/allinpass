// supabase/functions/google-wallet-callback/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function safeInsert(sbAdmin: any, event_type: string, payload: any) {
  try {
    await sbAdmin.from("passkit_events").insert({ event_type, payload });
  } catch {
    // best-effort
  }
}

/**
 * Google Wallet callback pode vir como envelope:
 * { protocolVersion, signature, signedMessage: "{...}" }
 */
function extractInnerMessage(parsed: any): any | null {
  if (!parsed || typeof parsed !== "object") return null;

  // Já veio plano
  if (typeof parsed.eventType === "string" && typeof parsed.objectId === "string") return parsed;

  // Envelope assinado
  const sm = typeof parsed.signedMessage === "string" ? parsed.signedMessage : null;
  if (sm) {
    try {
      const inner = JSON.parse(sm);
      return inner && typeof inner === "object" ? inner : null;
    } catch {
      return null;
    }
  }

  if (parsed.message && typeof parsed.message === "object") return parsed.message;

  return null;
}

function extractSerialFromObjectId(objectIdFull: string): string | null {
  const suffix = objectIdFull.includes(".")
    ? objectIdFull.split(".").slice(1).join(".")
    : objectIdFull;

  // carteira49_${type}_${project_id}_${serial}
  const lastUnderscore = suffix.lastIndexOf("_");
  if (lastUnderscore === -1) return null;

  const serial = suffix.slice(lastUnderscore + 1).trim();
  return serial.length ? serial : null;
}

serve(async (req) => {
  const requestId = crypto.randomUUID();

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "missing_env", requestId });
  }

  const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") return json(200, { ok: true });

  const raw = await req.text().catch(() => "");
  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  await safeInsert(sbAdmin, "google_wallet_callback_raw", {
    requestId,
    ua: req.headers.get("user-agent") ?? null,
    headers: Object.fromEntries(req.headers.entries()),
    raw_preview: raw.slice(0, 8000),
    parsed,
  });

  const msg = extractInnerMessage(parsed);
  if (!msg) {
    await safeInsert(sbAdmin, "google_wallet_callback_unparsed", {
      requestId,
      note: "could_not_extract_inner_message",
    });
    return json(200, { ok: true, requestId, note: "unparsed" });
  }

  const eventType = typeof msg.eventType === "string" ? msg.eventType : null;
  const objectId = typeof msg.objectId === "string" ? msg.objectId : null;
  const classId = typeof msg.classId === "string" ? msg.classId : null;
  const nonce = typeof msg.nonce === "string" ? msg.nonce : null;

  if (!eventType || !objectId) {
    await safeInsert(sbAdmin, "google_wallet_callback_missing_fields", { requestId, msg });
    return json(200, { ok: true, requestId, note: "missing_eventType_or_objectId" });
  }

  const serial = extractSerialFromObjectId(objectId);
  if (!serial) {
    await safeInsert(sbAdmin, "google_wallet_callback_bad_objectId", {
      requestId,
      objectId,
      classId,
      eventType,
    });
    return json(200, { ok: true, requestId, note: "could_not_extract_serial" });
  }

  const nowIso = new Date().toISOString();

  // SAVE
  if (eventType === "save") {
    const { error } = await sbAdmin
      .from("user_passes")
      .update({
        install_status: "installed",
        installed_at: nowIso,
        install_platform: "google",
        removed_at: null,

        // ✅ aqui o ouro:
        google_object_id: objectId,
        google_class_id: classId,
      })
      .eq("pass_token", serial);

    if (error) {
      await safeInsert(sbAdmin, "google_wallet_update_failed", {
        requestId,
        eventType,
        objectId,
        classId,
        serial,
        message: error.message,
      });
      return json(500, { error: "db_update_failed", requestId });
    }

    await safeInsert(sbAdmin, "google_wallet_saved", {
      requestId,
      eventType,
      objectId,
      classId,
      serial,
      nonce,
    });

    return json(200, { ok: true, requestId });
  }

  // DEL
  if (eventType === "del") {
    const { error } = await sbAdmin
      .from("user_passes")
      .update({
        install_status: "removed",
        removed_at: nowIso,
        install_platform: "google",

        // (eu manteria objectId/classId pra auditoria; se quiser limpar, é só setar null)
        google_object_id: objectId ?? undefined,
        google_class_id: classId ?? undefined,
      })
      .eq("pass_token", serial)
      .is("removed_at", null);

    if (error) {
      await safeInsert(sbAdmin, "google_wallet_update_failed", {
        requestId,
        eventType,
        objectId,
        classId,
        serial,
        message: error.message,
      });
      return json(500, { error: "db_update_failed", requestId });
    }

    await safeInsert(sbAdmin, "google_wallet_deleted", {
      requestId,
      eventType,
      objectId,
      classId,
      serial,
      nonce,
    });

    return json(200, { ok: true, requestId });
  }

  await safeInsert(sbAdmin, "google_wallet_unknown_event", {
    requestId,
    eventType,
    objectId,
    classId,
    nonce,
    msg,
  });

  return json(200, { ok: true, requestId });
});
