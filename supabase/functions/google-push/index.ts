// supabase/functions/google-push/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "https://esm.sh/jose@5.2.4";

type WalletResourceKind =
  | "loyaltyObject"
  | "genericObject"
  | "loyaltyClass"
  | "genericClass";

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

function toObject(v: unknown): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
}

function normalizeDefaults(input: unknown): Record<string, any> {
  if (!input) return {};
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return toObject(parsed);
    } catch {
      return {};
    }
  }
  return toObject(input);
}

function ensureHttpUrl(v: unknown): string | null {
  const s = cleanString(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function normalizeHexColor(input: unknown, fallback: string): string {
  if (typeof input !== "string") return fallback;
  const s = input.trim();
  if (!s) return fallback;
  const raw = s.startsWith("#") ? s.slice(1) : s;
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return fallback;
  return `#${raw.toLowerCase()}`;
}

function mapBgColor(colors: any) {
  return normalizeHexColor(colors?.background ?? "#6c5ce7", "#6c5ce7");
}

function storagePublicUrl(supabaseUrl: string, path: string) {
  if (!supabaseUrl) return null;
  return `${supabaseUrl}/storage/v1/object/public/pass-assets/${path}`;
}

function envPreview(name: string, value: string) {
  const v = value ?? "";
  return {
    name,
    present: !!v,
    length: v.length,
    prefix: v ? `${v.slice(0, 6)}...` : "",
  };
}

function requireEnvs(
  requestId: string,
  entries: Array<{ name: string; value: string }>,
) {
  const missing = entries
    .filter((e) => !e.value || !e.value.trim())
    .map((e) => e.name);

  console.info(`[google-push:${requestId}] env check`, {
    previews: entries.map((e) => envPreview(e.name, e.value)),
    missing,
  });

  return { ok: missing.length === 0, missing };
}

function normalizePem(pk: string) {
  // accepts normal PEM or PEM with escaped line breaks
  return pk.includes("\\n") ? pk.replace(/\\n/g, "\n") : pk;
}

function formatBRDateShort(input: unknown): string | null {
  const s = cleanString(input);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function getPointsFromMetadata(meta: any): number | null {
  const m = meta && typeof meta === "object" ? meta : {};
  const raw = (m as any)?.points;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getPointsFromFields(fields: any): number {
  const f = toObject(fields);
  const direct = f["members.member.points"];
  if (direct !== undefined && direct !== null && direct !== "") {
    const n = Number(direct);
    if (Number.isFinite(n)) return n;
  }

  for (const key of Object.keys(f)) {
    if (!key.toLowerCase().includes("points")) continue;
    const n = Number(f[key]);
    if (Number.isFinite(n)) return n;
  }

  return 0;
}

function getBalanceCentsFromMetadata(meta: any): number | null {
  const m = meta && typeof meta === "object" ? meta : {};
  const raw = (m as any)?.balance_cents;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(Math.trunc(n), 0) : null;
}

function getBalanceCentsFromFields(fields: any): number {
  const f = toObject(fields);
  const direct = f.balance_cents;
  if (direct !== undefined && direct !== null && direct !== "") {
    const n = Number(direct);
    if (Number.isFinite(n)) return Math.max(Math.trunc(n), 0);
  }

  for (const key of Object.keys(f)) {
    const normalizedKey = key.toLowerCase();
    if (!normalizedKey.includes("balance") && !normalizedKey.includes("saldo")) {
      continue;
    }
    const n = Number(f[key]);
    if (Number.isFinite(n)) return Math.max(Math.trunc(n), 0);
  }

  return 0;
}

function formatCurrencyBRL(cents: number) {
  const normalizedCents = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(normalizedCents / 100);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

async function loadProjectName(
  sb: any,
  projectId: string,
) {
  const { data, error } = await sb
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw new Error(`Error loading projects.name: ${error.message}`);
  return cleanString((data as any)?.name);
}

async function loadWalletTemplateDefaults(
  sb: any,
  projectId: string,
) {
  const [projectRes, globalRes] = await Promise.all([
    sb.from("wallet_templates")
      .select("defaults")
      .eq("project_id", projectId)
      .maybeSingle(),
    sb.from("wallet_templates")
      .select("defaults")
      .is("project_id", null)
      .maybeSingle(),
  ]);

  if (projectRes.error) {
    throw new Error(
      `Error loading project wallet template: ${projectRes.error.message}`,
    );
  }
  if (globalRes.error) {
    throw new Error(
      `Error loading global wallet template: ${globalRes.error.message}`,
    );
  }

  const projectDefaults = normalizeDefaults(projectRes.data?.defaults);
  const globalDefaults = normalizeDefaults(globalRes.data?.defaults);

  return {
    ...globalDefaults,
    ...projectDefaults,
    colors: {
      ...toObject(globalDefaults.colors),
      ...toObject(projectDefaults.colors),
    },
    images: {
      ...toObject(globalDefaults.images),
      ...toObject(projectDefaults.images),
    },
    fields: {
      ...toObject(globalDefaults.fields),
      ...toObject(projectDefaults.fields),
    },
  };
}

async function loadPassMerchantLocations(
  sb: any,
  projectId: string,
  passId: string,
) {
  const { data: mappingRows, error: mappingError } = await sb
    .from("pass_locations")
    .select("location_id")
    .eq("project_id", projectId)
    .eq("pass_id", passId)
    .limit(100);

  if (mappingError) {
    throw new Error(`Error loading pass_locations: ${mappingError.message}`);
  }

  const locationIds = [
    ...new Set(
      (mappingRows ?? [])
        .map((row: any) => cleanString(row.location_id))
        .filter(Boolean) as string[],
    ),
  ];

  if (locationIds.length === 0) return [];

  const { data: locationRows, error: locationsError } = await sb
    .from("locations")
    .select("id, lat, lng")
    .eq("project_id", projectId)
    .in("id", locationIds)
    .limit(100);

  if (locationsError) {
    throw new Error(`Error loading locations: ${locationsError.message}`);
  }

  const order = new Map(locationIds.map((id, index) => [id, index]));
  const cleaned = (locationRows ?? [])
    .map((row: any) => {
      const lat = toNumber(row.lat);
      const lng = toNumber(row.lng);
      if (lat === null || lng === null) return null;
      return {
        id: cleanString(row.id),
        latitude: lat,
        longitude: lng,
      };
    })
    .filter(Boolean)
    .sort(
      (a: any, b: any) =>
        (order.get(a.id ?? "") ?? 999) - (order.get(b.id ?? "") ?? 999),
    )
    .slice(0, 10);

  return cleaned.map((row: any) => ({
    latitude: row.latitude,
    longitude: row.longitude,
  })) as Array<{ latitude: number; longitude: number }>;
}

function buildGooglePatchPayloads(args: {
  passRow: any;
  templateDefaults: Record<string, any>;
  projectName: string | null;
  merchantLocations: Array<{ latitude: number; longitude: number }>;
  up?: any | null;
  objectId?: string | null;
  classId?: string | null;
  supabaseUrl: string;
  includeObjectGlobalFields?: boolean;
}) {
  const {
    passRow,
    templateDefaults,
    projectName,
    merchantLocations,
    up,
    objectId,
    classId,
    supabaseUrl,
    includeObjectGlobalFields = true,
  } = args;

  const passDesign = toObject((passRow as any).design);
  const mergedColors = {
    ...toObject(templateDefaults.colors),
    ...toObject(passDesign.colors),
  };
  const mergedImages = {
    ...toObject(templateDefaults.images),
    ...toObject(passDesign.images),
  };
  const mergedFields = {
    ...toObject(templateDefaults.fields),
    ...toObject((passRow as any).fields),
  };

  const title = cleanString((passRow as any).title) ??
    cleanString((templateDefaults as any).title) ??
    "Cartao Fidelidade";
  const header = cleanString((passRow as any).description) ??
    "Programa Fidelidade";

  const metadataPoints = up
    ? getPointsFromMetadata((up as any).metadata)
    : null;
  const points = metadataPoints ?? getPointsFromFields(mergedFields);
  const metadataBalanceCents = up
    ? getBalanceCentsFromMetadata((up as any).metadata)
    : null;
  const balanceCents = metadataBalanceCents ?? getBalanceCentsFromFields(mergedFields);

  const expSource = cleanString((mergedFields as any).exp_date) ??
    cleanString((up as any)?.expires_at);
  const expText = formatBRDateShort(expSource);
  const expLabel = expText ? `EXPIRA EM ${expText}` : "EXPIRA EM --/--/----";

  const passTypeFromPass = cleanString((passRow as any).type)?.toLowerCase();
  const inferFromIds = `${classId ?? ""} ${objectId ?? ""}`.toLowerCase();
  const isValue = passTypeFromPass === "value" || inferFromIds.includes("value");
  const isLoyalty = passTypeFromPass
    ? passTypeFromPass === "loyalty" || passTypeFromPass === "value"
    : inferFromIds.includes("loyalty");
  const metricLabel = isValue ? "SALDO" : "PONTOS";
  const metricValue = isValue ? formatCurrencyBRL(balanceCents) : String(points);

  const bgColor = mapBgColor(mergedColors);

  const logoUrl = ensureHttpUrl((mergedImages as any).googleLogo) ??
    ensureHttpUrl((mergedImages as any).logo) ??
    storagePublicUrl(supabaseUrl, "templates/default/logo.png");

  const heroUrl = ensureHttpUrl((mergedImages as any).googleHero);

  // For installed passes, barcode value should keep using per-user token.
  const qrMessage = cleanString((up as any)?.pass_token) ??
    cleanString((passRow as any).qr_url) ??
    cleanString((passRow as any).universal_url) ??
    objectId ??
    classId ??
    "";

  const issuerName = projectName ?? "Allin Pass";

  const classKind: WalletResourceKind = isLoyalty
    ? "loyaltyClass"
    : "genericClass";
  const objectKind: WalletResourceKind = isLoyalty
    ? "loyaltyObject"
    : "genericObject";

  const classPatchBody = isLoyalty
    ? {
      issuerName,
      reviewStatus: "UNDER_REVIEW",
      programName: title,
      hexBackgroundColor: bgColor,
      ...(logoUrl ? { programLogo: { sourceUri: { uri: logoUrl } } } : {}),
      ...(heroUrl ? { heroImage: { sourceUri: { uri: heroUrl } } } : {}),
      ...(merchantLocations.length ? { merchantLocations } : {}),
    }
    : {
      issuerName,
      reviewStatus: "UNDER_REVIEW",
      hexBackgroundColor: bgColor,
      ...(logoUrl ? { logo: { sourceUri: { uri: logoUrl } } } : {}),
      ...(heroUrl ? { heroImage: { sourceUri: { uri: heroUrl } } } : {}),
      ...(merchantLocations.length ? { merchantLocations } : {}),
    };

  const objectGlobalFields = includeObjectGlobalFields
    ? {
      hexBackgroundColor: bgColor,
      ...(heroUrl ? { heroImage: { sourceUri: { uri: heroUrl } } } : {}),
      ...(merchantLocations.length ? { merchantLocations } : {}),
    }
    : {};

  const objectPatchBody = isLoyalty
    ? {
      state: "ACTIVE",
      ...objectGlobalFields,
      loyaltyPoints: { label: metricLabel, balance: { string: metricValue } },
      barcode: { type: "QR_CODE", value: qrMessage },
      textModulesData: [{ header: "EXPIRA EM", body: expText ?? "--/--/----" }],
    }
    : {
      state: "ACTIVE",
      ...objectGlobalFields,
      cardTitle: { defaultValue: { language: "pt-BR", value: title } },
      header: { defaultValue: { language: "pt-BR", value: header } },
      subheader: { defaultValue: { language: "pt-BR", value: expLabel } },
      textModulesData: [
        { header: metricLabel, body: String(metricValue) },
        { header: "EXPIRA EM", body: expText ?? "--/--/----" },
      ],
      barcode: { type: "QR_CODE", value: qrMessage },
    };

  return {
    classKind,
    objectKind,
    classPatchBody,
    objectPatchBody,
    applied: {
      pass_type: passTypeFromPass ?? null,
      title,
      header,
      points,
      balance_cents: balanceCents,
      metric_label: metricLabel,
      metric_value: metricValue,
      exp_source: expSource,
      expText,
      has_logo: !!logoUrl,
      has_hero: !!heroUrl,
      merchant_locations: merchantLocations.length,
    },
  };
}

async function getGoogleAccessToken(params: {
  saEmail: string;
  saPkPem: string;
  scope: string;
  requestId: string;
}) {
  const { saEmail, saPkPem, scope, requestId } = params;

  const now = Math.floor(Date.now() / 1000);
  const jwtAssertion = await new SignJWT({
    iss: saEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .sign(await importPKCS8(saPkPem, "RS256"));

  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", jwtAssertion);

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error(`[google-push:${requestId}] google token error`, {
      status: resp.status,
      body: j,
    });
    throw new Error(`Google token error: HTTP ${resp.status}`);
  }

  const accessToken = typeof j?.access_token === "string"
    ? j.access_token
    : null;
  if (!accessToken) throw new Error("Google token error: missing access_token");
  return accessToken;
}

async function patchWalletResource(args: {
  accessToken: string;
  kind: WalletResourceKind;
  resourceId: string;
  patchBody: any;
  requestId: string;
}) {
  const { accessToken, kind, resourceId, patchBody, requestId } = args;

  const base = "https://walletobjects.googleapis.com/walletobjects/v1";
  const url = `${base}/${kind}/${encodeURIComponent(resourceId)}`;

  console.info(`[google-push:${requestId}] patch start`, {
    kind,
    resourceId,
    patchKeys: Object.keys(patchBody ?? {}),
  });

  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patchBody),
  });

  const text = await resp.text().catch(() => "");

  console.info(`[google-push:${requestId}] patch done`, {
    kind,
    ok: resp.ok,
    status: resp.status,
    body_preview: text.slice(0, 1200),
  });

  if (!resp.ok) {
    throw new Error(
      `Wallet PATCH ${kind} failed: HTTP ${resp.status} ${text.slice(0, 300)}`,
    );
  }

  return { ok: true, status: resp.status, body: text };
}

function authIsServiceRole(req: Request, serviceRoleKey: string) {
  const h = req.headers.get("authorization") ||
    req.headers.get("Authorization");
  if (!h) return false;
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const token = m[1].trim();
  return token === serviceRoleKey;
}

serve(async (req) => {
  const origin = req.headers.get("Origin") || "*";
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  const requestId = crypto.randomUUID();
  console.info(`[google-push:${requestId}] request in`, {
    method: req.method,
    url: req.url,
  });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const GOOGLE_SA_EMAIL = Deno.env.get("GOOGLE_SA_EMAIL") ?? "";
    const GOOGLE_SA_PK_RAW = Deno.env.get("GOOGLE_SA_PK") ?? "";

    const baseCheck = requireEnvs(requestId, [
      { name: "SUPABASE_URL", value: SUPABASE_URL },
      { name: "SUPABASE_SERVICE_ROLE_KEY", value: SERVICE_ROLE_KEY },
      { name: "GOOGLE_SA_EMAIL", value: GOOGLE_SA_EMAIL },
      { name: "GOOGLE_SA_PK", value: GOOGLE_SA_PK_RAW },
    ]);
    if (!baseCheck.ok) {
      console.error(
        `[google-push:${requestId}] missing envs`,
        baseCheck.missing,
      );
      return json(
        500,
        {
          error: "missing_env",
          requestId,
          missing: baseCheck.missing,
        },
        origin,
      );
    }

    if (!authIsServiceRole(req, SERVICE_ROLE_KEY)) {
      console.warn(
        `[google-push:${requestId}] unauthorized (expected Bearer SERVICE_ROLE_KEY)`,
      );
      return json(401, { error: "unauthorized", requestId }, origin);
    }

    const body = await req.json().catch(() => ({}));
    const mode = cleanString(body?.mode ?? body?.scope)?.toLowerCase();
    const classPatchOnly = mode === "class";
    const skipClassPatch = body?.skip_class_patch === true || mode === "object";
    const passToken = cleanString(
      body?.pass_token || body?.token || body?.serialNumber,
    );

    console.info(`[google-push:${requestId}] body parsed`, {
      hasBody: !!body && typeof body === "object",
      mode: mode ?? null,
      passTokenPrefix: passToken ? `${passToken.slice(0, 8)}...` : null,
      skipClassPatch,
    });

    const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (classPatchOnly) {
      const passId = cleanString(body?.pass_id);
      const classId = cleanString(body?.google_class_id ?? body?.class_id);

      if (!passId || !classId) {
        return json(
          400,
          {
            error: "bad_request",
            requestId,
            message: "Send { mode: 'class', pass_id, google_class_id }",
          },
          origin,
        );
      }

      const { data: passRow, error: passErr } = await sbAdmin
        .from("passes")
        .select(
          "id, project_id, type, title, description, fields, design, qr_url, universal_url",
        )
        .eq("id", passId)
        .maybeSingle();

      if (passErr) {
        return json(
          500,
          {
            error: "db_error",
            requestId,
            message: passErr.message,
          },
          origin,
        );
      }
      if (!passRow) {
        return json(
          404,
          {
            error: "not_found",
            requestId,
            message: "pass not found",
          },
          origin,
        );
      }

      const projectId = String((passRow as any).project_id);
      const [templateDefaults, projectName, merchantLocations] = await Promise
        .all([
          loadWalletTemplateDefaults(sbAdmin, projectId),
          loadProjectName(sbAdmin, projectId),
          loadPassMerchantLocations(sbAdmin, projectId, passId),
        ]);

      const payloads = buildGooglePatchPayloads({
        passRow,
        templateDefaults,
        projectName,
        merchantLocations,
        classId,
        supabaseUrl: SUPABASE_URL,
      });

      const GOOGLE_SA_PK = normalizePem(GOOGLE_SA_PK_RAW);
      const accessToken = await getGoogleAccessToken({
        saEmail: GOOGLE_SA_EMAIL,
        saPkPem: GOOGLE_SA_PK,
        scope: "https://www.googleapis.com/auth/wallet_object.issuer",
        requestId,
      });

      const classPatchResult = await patchWalletResource({
        accessToken,
        kind: payloads.classKind,
        resourceId: classId,
        patchBody: payloads.classPatchBody,
        requestId,
      });

      return json(
        200,
        {
          ok: true,
          requestId,
          patched: true,
          mode: "class",
          classKind: payloads.classKind,
          classId,
          applied: payloads.applied,
          wallet: {
            class: classPatchResult,
            object: null,
          },
        },
        origin,
      );
    }

    if (!passToken) {
      return json(
        400,
        {
          error: "bad_request",
          requestId,
          message: "Send { pass_token }",
        },
        origin,
      );
    }

    const { data: up, error: upErr } = await sbAdmin
      .from("user_passes")
      .select(
        "id, pass_id, pass_token, pass_type, metadata, expires_at, install_status, install_platform, google_object_id, google_class_id",
      )
      .eq("pass_token", passToken)
      .maybeSingle();

    if (upErr) {
      console.error(`[google-push:${requestId}] db_error user_passes`, {
        message: upErr.message,
      });
      return json(
        500,
        {
          error: "db_error",
          requestId,
          message: upErr.message,
        },
        origin,
      );
    }
    if (!up) {
      console.warn(`[google-push:${requestId}] not_found user_pass`, {
        passTokenPrefix: `${passToken.slice(0, 8)}...`,
      });
      return json(
        404,
        {
          error: "not_found",
          requestId,
          message: "user_pass not found for this token",
        },
        origin,
      );
    }

    const objectId = cleanString((up as any).google_object_id);
    const classId = cleanString((up as any).google_class_id);

    console.info(`[google-push:${requestId}] user_pass loaded`, {
      user_pass_id: up.id,
      pass_id: up.pass_id,
      pass_type: cleanString((up as any).pass_type),
      install_status: cleanString((up as any).install_status),
      install_platform: cleanString((up as any).install_platform),
      hasObjectId: !!objectId,
      hasClassId: !!classId,
    });

    if (!objectId) {
      console.warn(
        `[google-push:${requestId}] skip patch (missing google_object_id)`,
      );
      return json(
        200,
        {
          ok: true,
          requestId,
          patched: false,
          reason: "missing_google_object_id",
          details: { hasObjectId: false, hasClassId: !!classId },
        },
        origin,
      );
    }

    const { data: passRow, error: passErr } = await sbAdmin
      .from("passes")
      .select(
        "id, project_id, type, title, description, fields, design, qr_url, universal_url",
      )
      .eq("id", (up as any).pass_id)
      .maybeSingle();

    if (passErr) {
      console.error(`[google-push:${requestId}] db_error passes`, {
        message: passErr.message,
      });
      return json(
        500,
        {
          error: "db_error",
          requestId,
          message: passErr.message,
        },
        origin,
      );
    }
    if (!passRow) {
      return json(
        404,
        {
          error: "not_found",
          requestId,
          message: "pass not found for this user_pass",
        },
        origin,
      );
    }

    const projectId = String((passRow as any).project_id);
    const passId = String((passRow as any).id);

    const [templateDefaults, projectName, merchantLocations] = await Promise
      .all([
        loadWalletTemplateDefaults(sbAdmin, projectId),
        loadProjectName(sbAdmin, projectId),
        loadPassMerchantLocations(sbAdmin, projectId, passId),
      ]);

    const payloads = buildGooglePatchPayloads({
      passRow,
      templateDefaults,
      projectName,
      merchantLocations,
      up,
      objectId,
      classId,
      supabaseUrl: SUPABASE_URL,
      includeObjectGlobalFields: body?.include_object_global_fields !== false,
    });

    const GOOGLE_SA_PK = normalizePem(GOOGLE_SA_PK_RAW);
    const accessToken = await getGoogleAccessToken({
      saEmail: GOOGLE_SA_EMAIL,
      saPkPem: GOOGLE_SA_PK,
      scope: "https://www.googleapis.com/auth/wallet_object.issuer",
      requestId,
    });

    let classPatchResult: any = null;
    if (classId && !skipClassPatch) {
      try {
        classPatchResult = await patchWalletResource({
          accessToken,
          kind: payloads.classKind,
          resourceId: classId,
          patchBody: payloads.classPatchBody,
          requestId,
        });
      } catch (classError: any) {
        const classMessage = String(classError?.message ?? classError);
        console.warn(
          `[google-push:${requestId}] class patch failed (continuing)`,
          {
            classId,
            classKind: payloads.classKind,
            message: classMessage,
          },
        );
        classPatchResult = {
          ok: false,
          error: classMessage,
        };
      }
    }

    const objectPatchResult = await patchWalletResource({
      accessToken,
      kind: payloads.objectKind,
      resourceId: objectId,
      patchBody: payloads.objectPatchBody,
      requestId,
    });

    return json(
      200,
      {
        ok: true,
        requestId,
        patched: true,
        mode: skipClassPatch ? "object" : "object_with_optional_class",
        objectKind: payloads.objectKind,
        objectId,
        classKind: payloads.classKind,
        classId,
        applied: payloads.applied,
        wallet: {
          class: classPatchResult,
          object: objectPatchResult,
        },
      },
      origin,
    );
  } catch (e: any) {
    console.error(`[google-push:${e?.requestId ?? "?"}] unhandled`, {
      message: String(e?.message ?? e),
    });
    return json(
      500,
      {
        error: "unhandled",
        requestId: crypto.randomUUID(),
        message: String(e?.message ?? e),
      },
      origin,
    );
  }
});
