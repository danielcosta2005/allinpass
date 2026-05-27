// supabase/functions/apple-push/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "https://esm.sh/jose@5.2.4";

function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(status: number, body: any, origin?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function envPreview(name: string, value: string) {
  const v = value ?? "";
  return {
    name,
    present: !!v,
    length: v.length,
    prefix: v ? v.slice(0, 6) + "…" : "",
  };
}

function requireEnvs(
  requestId: string,
  entries: Array<{ name: string; value: string }>,
) {
  const missing = entries.filter((e) => !e.value || !e.value.trim()).map((e) =>
    e.name
  );

  console.info(`[apple-push:${requestId}] env check`, {
    previews: entries.map((e) => envPreview(e.name, e.value)),
    missing,
  });

  return { ok: missing.length === 0, missing };
}

async function makeApnsProviderToken(
  params: { teamId: string; keyId: string; p8: string },
) {
  const { teamId, keyId, p8 } = params;
  const key = await importPKCS8(p8, "ES256");
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuedAt(now)
    .setIssuer(teamId)
    .sign(key);
}

async function ensureUpdatedPkpass(args: {
  sbAdmin: any;
  supabaseUrl: string;
  serviceRoleKey: string;
  passId: string;
  passToken: string;
  requestId: string;
  suppressPointsNotification: boolean;
}) {
  const {
    sbAdmin,
    supabaseUrl,
    serviceRoleKey,
    passId,
    passToken,
    requestId,
    suppressPointsNotification,
  } = args;

  const pkPath = `issued_users/${passId}/${passToken}.pkpass`;
  console.info(`[apple-push:${requestId}] regenerate pkpass`, {
    pkPath,
    suppressPointsNotification,
  });

  const genUrl = new URL(`${supabaseUrl}/functions/v1/apple-pass`);
  genUrl.searchParams.set("token", passToken);
  if (suppressPointsNotification) {
    genUrl.searchParams.set("suppress_points_notification", "1");
  }

  const genRes = await fetch(genUrl.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/vnd.apple.pkpass",
    },
  });

  if (!genRes.ok) {
    const t = await genRes.text().catch(() => "");
    console.error(`[apple-push:${requestId}] apple-pass failed`, {
      status: genRes.status,
      body_preview: t.slice(0, 800),
    });
    throw new Error(`apple-pass falhou (${genRes.status})`);
  }

  const bytes = new Uint8Array(await genRes.arrayBuffer());
  console.info(`[apple-push:${requestId}] apple-pass ok`, {
    size: bytes.length,
  });

  const up = await sbAdmin.storage.from("pass-assets").upload(pkPath, bytes, {
    contentType: "application/vnd.apple.pkpass",
    upsert: true,
  });

  if (up.error) {
    console.error(`[apple-push:${requestId}] storage upload failed`, {
      message: up.error.message,
    });
    throw new Error(`upload pkpass falhou: ${up.error.message}`);
  }

  console.info(`[apple-push:${requestId}] storage upload ok`, { pkPath });
  return pkPath;
}

async function apnsPush(args: {
  devicePushToken: string;
  apnsTopic: string;
  providerToken: string;
  useSandbox: boolean;
  requestId: string;
}) {
  const { devicePushToken, apnsTopic, providerToken, useSandbox, requestId } =
    args;

  const host = useSandbox
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
  const url = `${host}/3/device/${devicePushToken}`;

  console.info(`[apple-push:${requestId}] apns push start`, {
    sandbox: useSandbox,
    apnsTopic,
    deviceTokenPrefix: devicePushToken.slice(0, 8) + "…",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `bearer ${providerToken}`,
      "apns-topic": apnsTopic,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const text = await res.text().catch(() => "");
  console.info(`[apple-push:${requestId}] apns push done`, {
    ok: res.ok,
    status: res.status,
    body_preview: text.slice(0, 800),
  });

  return { ok: res.ok, status: res.status, body: text };
}

serve(async (req) => {
  const origin = req.headers.get("Origin") || "*";
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  const requestId = crypto.randomUUID();
  console.info(`[apple-push:${requestId}] request in`, {
    method: req.method,
    url: req.url,
  });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const APNS_TEAM_ID = Deno.env.get("APPLE_TEAM_ID") ?? "";
    const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
    const APNS_P8 = Deno.env.get("APNS_PRIVATE_KEY_P8") ?? ""; // PEM ES256
    const APNS_USE_SANDBOX =
      (Deno.env.get("APNS_USE_SANDBOX") ?? "true").toLowerCase() === "true";

    // 0) base envs
    const baseCheck = requireEnvs(requestId, [
      { name: "SUPABASE_URL", value: SUPABASE_URL },
      { name: "SUPABASE_SERVICE_ROLE_KEY", value: SERVICE_ROLE_KEY },
    ]);
    if (!baseCheck.ok) {
      console.error(
        `[apple-push:${requestId}] missing base envs`,
        baseCheck.missing,
      );
      return json(500, {
        error: "missing_env",
        requestId,
        missing: baseCheck.missing,
      }, origin);
    }

    // 1) body
    const body = await req.json().catch(() => ({}));
    const passToken = cleanString(
      body?.pass_token || body?.token || body?.serialNumber,
    );
    const suppressPointsNotification =
      body?.suppress_points_notification === true;

    console.info(`[apple-push:${requestId}] body parsed`, {
      hasBody: !!body && typeof body === "object",
      passTokenPrefix: passToken ? passToken.slice(0, 8) + "…" : null,
      suppressPointsNotification,
    });

    if (!passToken) {
      console.warn(`[apple-push:${requestId}] bad_request missing pass_token`);
      return json(400, {
        error: "bad_request",
        requestId,
        message: "Envie { pass_token }",
      }, origin);
    }

    const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 2) load user_pass
    const { data: up, error: upErr } = await sbAdmin
      .from("user_passes")
      .select("id, pass_id, pass_token, install_status, install_platform")
      .eq("pass_token", passToken)
      .maybeSingle();

    if (upErr) {
      console.error(`[apple-push:${requestId}] db_error user_passes`, {
        message: upErr.message,
      });
      return json(
        500,
        { error: "db_error", requestId, message: upErr.message },
        origin,
      );
    }
    if (!up) {
      console.warn(`[apple-push:${requestId}] user_pass not_found`, {
        passTokenPrefix: passToken.slice(0, 8) + "…",
      });
      return json(404, {
        error: "not_found",
        requestId,
        message: "user_pass não encontrado para esse token",
      }, origin);
    }

    console.info(`[apple-push:${requestId}] user_pass loaded`, {
      user_pass_id: up.id,
      pass_id: up.pass_id,
      install_status: up.install_status,
      install_platform: up.install_platform,
    });

    // 3) load passkit registration FROM TABLE
    const { data: reg, error: regErr } = await sbAdmin
      .from("passkit_registrations")
      .select(
        "id, user_pass_id, serial_number, device_library_identifier, push_token, pass_type_identifier, updated_at",
      )
      .eq("user_pass_id", up.id)
      .eq("serial_number", passToken)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (regErr) {
      console.error(
        `[apple-push:${requestId}] db_error passkit_registrations`,
        { message: regErr.message },
      );
      return json(500, {
        error: "db_error",
        requestId,
        message: regErr.message,
      }, origin);
    }

    if (!reg) {
      console.warn(
        `[apple-push:${requestId}] skip push (no passkit registration row)`,
        {
          user_pass_id: up.id,
          serial_number: passToken.slice(0, 8) + "…",
        },
      );
      return json(
        200,
        {
          ok: true,
          requestId,
          pushed: false,
          reason: "missing_passkit_registration_row",
          details: { user_pass_id: up.id, serial_number: passToken },
        },
        origin,
      );
    }

    const pushToken = cleanString(reg.push_token);
    const passTypeIdentifier = cleanString(reg.pass_type_identifier);

    console.info(`[apple-push:${requestId}] passkit registration loaded`, {
      reg_id: reg.id,
      deviceLibraryIdentifier: reg.device_library_identifier,
      passTypeIdentifier: passTypeIdentifier ?? null,
      pushTokenPrefix: pushToken ? pushToken.slice(0, 8) + "…" : null,
      updated_at: reg.updated_at,
    });

    if (!pushToken || !passTypeIdentifier) {
      console.warn(
        `[apple-push:${requestId}] skip push (registration row missing fields)`,
        {
          hasPushToken: !!pushToken,
          hasPassTypeIdentifier: !!passTypeIdentifier,
        },
      );
      return json(
        200,
        {
          ok: true,
          requestId,
          pushed: false,
          reason: "registration_row_missing_fields",
          details: {
            hasPushToken: !!pushToken,
            hasPassTypeIdentifier: !!passTypeIdentifier,
          },
        },
        origin,
      );
    }

    // 4) APNS envs
    const apnsCheck = requireEnvs(requestId, [
      { name: "APNS_TEAM_ID", value: APNS_TEAM_ID },
      { name: "APNS_KEY_ID", value: APNS_KEY_ID },
      { name: "APNS_PRIVATE_KEY_P8", value: APNS_P8 },
    ]);
    if (!apnsCheck.ok) {
      console.error(
        `[apple-push:${requestId}] missing apns envs`,
        apnsCheck.missing,
      );
      return json(500, {
        error: "missing_env",
        requestId,
        missing: apnsCheck.missing,
      }, origin);
    }

    // 5) regenerate pkpass
    await ensureUpdatedPkpass({
      sbAdmin,
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SERVICE_ROLE_KEY,
      passId: String(up.pass_id),
      passToken: String(up.pass_token),
      requestId,
      suppressPointsNotification,
    });

    // 6) provider token
    let providerToken = "";
    try {
      providerToken = await makeApnsProviderToken({
        teamId: APNS_TEAM_ID,
        keyId: APNS_KEY_ID,
        p8: APNS_P8,
      });
      console.info(`[apple-push:${requestId}] provider token ok`, {
        jwtPrefix: providerToken.slice(0, 12) + "…",
      });
    } catch (e: any) {
      console.error(`[apple-push:${requestId}] provider token failed`, {
        message: String(e?.message ?? e),
      });
      return json(500, {
        error: "apns_token_failed",
        requestId,
        message: String(e?.message ?? e),
      }, origin);
    }

    // 7) apns push
    const pushRes = await apnsPush({
      devicePushToken: pushToken,
      apnsTopic: passTypeIdentifier,
      providerToken,
      useSandbox: APNS_USE_SANDBOX,
      requestId,
    });

    return json(
      200,
      {
        ok: true,
        requestId,
        pushed: pushRes.ok,
        apns: pushRes,
        pass_token: passToken,
        passTypeIdentifier,
        sandbox: APNS_USE_SANDBOX,
        registration_id: reg.id,
      },
      origin,
    );
  } catch (e: any) {
    console.error(`[apple-push:${requestId}] unhandled`, {
      message: String(e?.message ?? e),
    });
    return json(500, {
      error: "unhandled",
      requestId,
      message: String(e?.message ?? e),
    }, origin);
  }
});
