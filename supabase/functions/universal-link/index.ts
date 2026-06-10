// supabase/functions/universal-link/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ApiErrorCategory = "validation" | "config" | "upstream" | "internal";

type ApiErrorOptions = {
  code: string;
  status: number;
  category: ApiErrorCategory;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

class ApiError extends Error {
  code: string;
  status: number;
  category: ApiErrorCategory;
  retryable: boolean;
  details?: Record<string, unknown>;

  constructor(message: string, options: ApiErrorOptions) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

function apiError(
  code: string,
  message: string,
  status: number,
  category: ApiErrorCategory,
  details?: Record<string, unknown>,
  retryable = false,
) {
  return new ApiError(message, {
    code,
    status,
    category,
    details,
    retryable,
  });
}

function asApiError(error: unknown) {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) {
    return apiError(
      "universal_link_unhandled",
      error.message || "Falha ao processar o link universal.",
      500,
      "internal",
    );
  }
  return apiError(
    "universal_link_unhandled",
    "Falha ao processar o link universal.",
    500,
    "internal",
  );
}

function jsonResponse(
  body: unknown,
  status: number,
  origin = "*",
  extraHeaders: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

function errorResponse(error: unknown, origin = "*") {
  const apiError = asApiError(error);
  return jsonResponse(
    {
      error: apiError.code,
      message: apiError.message,
      category: apiError.category,
      retryable: apiError.retryable,
      details: apiError.details ?? null,
    },
    apiError.status,
    origin,
  );
}

function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function isIOS(userAgent: string | null) {
  const ua = (userAgent ?? "").toLowerCase();
  return (
    ua.includes("iphone") ||
    ua.includes("ipad") ||
    ua.includes("ipod") ||
    (ua.includes("macintosh") && ua.includes("mobile"))
  );
}

function base62Random(len = 24): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();
    if (k === name) return v;
  }
  return null;
}

function setCookieHeader(
  req: Request,
  name: string,
  value: string,
  maxAgeSeconds = 31536000
) {
  const url = new URL(req.url);
  const secure = url.protocol === "https:" ? "Secure; " : "";
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax; ${secure}HttpOnly`;
}

function redirect302(to: string, extraHeaders: Record<string, string> = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: to,
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function addDays(date: Date, days: number) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

type AuthUserInfo = {
  id: string;
  email: string | null;
  name: string | null;
  google_sub: string | null;
};

async function getUserFromAuthHeader(
  sbAdmin: any,
  req: Request
): Promise<AuthUserInfo | null> {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const jwt = m[1].trim();
  if (!jwt) return null;

  const { data, error } = await sbAdmin.auth.getUser(jwt);
  if (error) return null;

  const u = data?.user;
  if (!u?.id) return null;

  const name =
    (typeof u.user_metadata?.full_name === "string" &&
      u.user_metadata.full_name) ||
    (typeof u.user_metadata?.name === "string" && u.user_metadata.name) ||
    null;

  const identities = Array.isArray((u as any).identities)
    ? (u as any).identities
    : [];
  const google = identities.find((i: any) => i?.provider === "google");
  const google_sub =
    (google?.identity_data?.sub as string | undefined) ||
    (google?.id as string | undefined) ||
    (u.user_metadata?.sub as string | undefined) ||
    (u.app_metadata?.provider_id as string | undefined) ||
    null;

  return { id: u.id, email: u.email ?? null, name, google_sub };
}

async function parseFunctionError(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null);
    if (payload && typeof payload === "object") {
      return payload as Record<string, any>;
    }
  }

  const text = await response.text().catch(() => "");
  return text ? { message: text } : null;
}

async function ensurePkPass(
  sbAdmin: any,
  SUPABASE_URL: string,
  SERVICE_ROLE_KEY: string,
  projectId: string,
  pass_data: any,
  pkPath: string,
  wantBytes: boolean
): Promise<Uint8Array | null> {
  const dlTry = await sbAdmin.storage.from("pass-assets").download(pkPath);

  if (dlTry.data && !dlTry.error) {
    if (!wantBytes) return null;
    const ab = await dlTry.data.arrayBuffer();
    return new Uint8Array(ab);
  }

  const genRes = await fetch(`${SUPABASE_URL}/functions/v1/apple-pass`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json, application/vnd.apple.pkpass",
    },
    body: JSON.stringify({ project_id: projectId, pass_data }),
  });

  if (!genRes.ok) {
    const payload = await parseFunctionError(genRes);
    const message =
      payload?.message ||
      payload?.error ||
      `Falha ao gerar o passe Apple (HTTP ${genRes.status}).`;

    throw apiError(
      "apple_pass_generation_failed",
      message,
      genRes.status >= 400 && genRes.status < 600 ? genRes.status : 502,
      genRes.status >= 500 ? "upstream" : "validation",
      {
        upstream: "apple-pass",
        upstreamStatus: genRes.status,
        upstreamError: payload?.error ?? null,
        requestId: payload?.requestId ?? null,
        details: payload?.details ?? null,
      },
      payload?.retryable ?? genRes.status >= 500,
    );
  }

  const bytes = new Uint8Array(await genRes.arrayBuffer());

  const up = await sbAdmin.storage.from("pass-assets").upload(pkPath, bytes, {
    contentType: "application/vnd.apple.pkpass",
    upsert: true,
  });

  if (up.error) {
    throw apiError(
      "upload_pkpass_failed",
      `Falha ao salvar o pkpass gerado: ${up.error.message}`,
      500,
      "upstream",
      { pkPath },
      true,
    );
  }

  return wantBytes ? bytes : null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "*";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw apiError(
        "missing_env",
        "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.",
        500,
        "config",
      );
    }

    const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const url = new URL(req.url);
    const c = url.searchParams.get("c");
    const dkParam = url.searchParams.get("dk");

    const wantsJson =
      url.searchParams.get("mode") === "json" ||
      (req.headers.get("accept") || "").includes("application/json");
    const wantsDownload = url.searchParams.get("dl") === "1";

    if (!c) {
      throw apiError(
        "missing_query_params",
        "Parâmetro obrigatório ausente: informe ?c=short_code no universal link.",
        400,
        "validation",
        { field: "c" },
      );
    }

    const { data: pass, error: passErr } = await sbAdmin
      .from("passes")
      .select(
        "id, project_id, type, title, description, fields, design, status, deleted_at, short_code_expires_at"
      )
      .eq("short_code", c)
      .maybeSingle();

    if (passErr) {
      throw apiError(
        "db_error",
        `Falha ao buscar o passe pelo short_code: ${passErr.message}`,
        500,
        "upstream",
      );
    }
    if (!pass) {
      throw apiError(
        "not_found",
        "Nenhum passe foi encontrado para este link.",
        404,
        "validation",
        { shortCode: c },
        false,
      );
    }

    if (pass.deleted_at || String(pass.status ?? "").toLowerCase() === "excluido") {
      throw apiError(
        "pass_deleted",
        "Este link de carteira não está mais disponível.",
        410,
        "validation",
        { shortCode: c },
        false,
      );
    }

    if (pass.short_code_expires_at) {
      const exp = new Date(pass.short_code_expires_at).getTime();
      if (Number.isFinite(exp) && Date.now() > exp) {
        throw apiError(
          "link_expired",
          "Este link de carteira expirou e não pode mais ser usado.",
          410,
          "validation",
          { shortCodeExpiresAt: pass.short_code_expires_at },
          false,
        );
      }
    }

    const ua = req.headers.get("user-agent") ?? "";
    const preferApple = isIOS(ua);
    const authUser = await getUserFromAuthHeader(sbAdmin, req);

    const cookieDevice = getCookie(req, "device_key");
    const legacyDevice = getCookie(req, "pass_token");
    const deviceKey =
      (dkParam && dkParam.length >= 12 ? dkParam : null) ??
      (cookieDevice && cookieDevice.length >= 12 ? cookieDevice : null) ??
      (legacyDevice && legacyDevice.length >= 12 ? legacyDevice : null) ??
      base62Random(24);

    const { data: existingUP, error: upSelErr } = await sbAdmin
      .from("user_passes")
      .select("id, pass_token, issued_at, expires_at, device_key, user_id, metadata")
      .eq("pass_id", pass.id)
      .eq("device_key", deviceKey)
      .maybeSingle();

    if (upSelErr) {
      throw apiError(
        "select_user_pass_failed",
        `Falha ao localizar o passe emitido para este dispositivo: ${upSelErr.message}`,
        500,
        "upstream",
      );
    }

    let issuedAt: Date;
    let expiresAt: Date;

    const passToken = existingUP?.pass_token ?? base62Random(32);

    const claimMeta = authUser
      ? {
          claim: {
            user_id: authUser.id,
            email: authUser.email,
            name: authUser.name,
            google_sub: authUser.google_sub,
            claimed_at: new Date().toISOString(),
          },
        }
      : {};

    if (existingUP?.issued_at && existingUP?.expires_at) {
      issuedAt = new Date(existingUP.issued_at);
      expiresAt = new Date(existingUP.expires_at);

      if (authUser?.id) {
        const nextMeta = {
          ...(existingUP.metadata ?? {}),
          ...claimMeta,
        };

        const nextUserId = existingUP.user_id ?? authUser.id;

        await sbAdmin
          .from("user_passes")
          .update({ user_id: nextUserId, metadata: nextMeta })
          .eq("id", existingUP.id);
      }
    } else {
      issuedAt = new Date();
      expiresAt = addDays(issuedAt, 30);

      const { error: upInsErr } = await sbAdmin.from("user_passes").insert({
        pass_id: pass.id,
        project_id: pass.project_id,
        device_key: deviceKey,
        pass_token: passToken,
        pass_type: pass.type ?? "loyalty",
        user_id: authUser?.id ?? null,
        issued_at: issuedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        metadata: {
          ua,
          ...(claimMeta ?? {}),
        },
      });

      if (upInsErr) {
        throw apiError(
          "insert_user_pass_failed",
          `Falha ao registrar o passe emitido: ${upInsErr.message}`,
          500,
          "upstream",
        );
      }
    }

    const colors = pass.design?.colors ?? {};
    const images = pass.design?.images ?? {};
    const fields = pass.fields ?? {};

    const pass_data = {
      type: pass.type ?? "loyalty",
      title: pass.title ?? "Cartão Fidelidade",
      description: pass.description ?? "Ganhe prêmios acumulando pontos!",
      fields,
      colors,
      images,
      exp_date: expiresAt.toISOString(),

      serialNumber: passToken,
      serial: passToken,
      qr_url: passToken,
      qrMessage: passToken,

      short_code: c,

      universal_url: `${SUPABASE_URL}/functions/v1/universal-link?c=${encodeURIComponent(
        c
      )}`,
    };

    let destination: string;

    if (preferApple) {
      const pkPath = `issued_users/${pass.id}/${passToken}.pkpass`;

      if (wantsDownload) {
        const bytes = await ensurePkPass(
          sbAdmin,
          SUPABASE_URL,
          SERVICE_ROLE_KEY,
          pass.project_id,
          pass_data,
          pkPath,
          true
        );

        const headers: Record<string, string> = {
          ...corsHeaders(origin),
          "Set-Cookie": setCookieHeader(req, "device_key", deviceKey),
          "Cache-Control": "no-store",
          "Content-Type": "application/vnd.apple.pkpass",
          "Content-Disposition": `attachment; filename="pass-${passToken}.pkpass"`,
        };

        return new Response(bytes, { status: 200, headers });
      }

      await ensurePkPass(
        sbAdmin,
        SUPABASE_URL,
        SERVICE_ROLE_KEY,
        pass.project_id,
        pass_data,
        pkPath,
        false
      );

      destination = `${SUPABASE_URL}/functions/v1/universal-link?c=${encodeURIComponent(
        c
      )}&dl=1&dk=${encodeURIComponent(deviceKey)}`;
    } else {
      const gRes = await fetch(`${SUPABASE_URL}/functions/v1/google-pass`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project_id: pass.project_id, pass_data }),
      });

      if (!gRes.ok) {
        const payload = await parseFunctionError(gRes);
        throw apiError(
          "google_pass_failed",
          payload?.message || payload?.error || `Falha ao gerar o passe Google (HTTP ${gRes.status}).`,
          gRes.status >= 400 && gRes.status < 600 ? gRes.status : 500,
          gRes.status >= 500 ? "upstream" : "validation",
          {
            upstream: "google-pass",
            upstreamError: payload?.error ?? null,
            details: payload?.details ?? null,
          },
          gRes.status >= 500,
        );
      }

      const gJson = await gRes.json().catch(() => ({}));
      const saveUrl = gJson?.saveUrl;
      if (!saveUrl) {
        throw apiError(
          "google_pass_missing_saveUrl",
          "A geração do passe Google não retornou saveUrl.",
          500,
          "upstream",
        );
      }

      const objectId = gJson?.objectId ?? null;
      const classId = gJson?.classId ?? null;

      if (objectId) {
        await sbAdmin
          .from("user_passes")
          .update({
            google_object_id: objectId,
            google_class_id: classId,
            install_platform: "google",
          })
          .eq("pass_id", pass.id)
          .eq("device_key", deviceKey);
      }

      destination = saveUrl;
    }

    const headers: Record<string, string> = {
      ...corsHeaders(origin),
      "Set-Cookie": setCookieHeader(req, "device_key", deviceKey),
    };

    if (wantsJson) {
      return jsonResponse(
        { destination, passToken, deviceKey, claimed: !!authUser },
        200,
        origin,
        { "Set-Cookie": setCookieHeader(req, "device_key", deviceKey) },
      );
    }

    return redirect302(destination, headers);
  } catch (e) {
    console.error("[universal-link] ERROR:", e);
    return errorResponse(e, origin);
  }
});

