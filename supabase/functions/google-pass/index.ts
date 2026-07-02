// supabase/functions/google-pass/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { importPKCS8, SignJWT } from "npm:jose@5.2.4";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function env(name: string, required = true): string {
  const v = Deno.env.get(name);
  if (!v && required) throw new Error(`Missing env: ${name}`);
  return v ?? "";
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
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

function normalizeDefaults(input: any): any {
  if (!input) return {};
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof input === "object") return input;
  return {};
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

function pickFirstPoints(fields: any): string {
  const direct = fields?.["members.member.points"];
  if (direct !== undefined && direct !== null) return String(direct);

  if (fields && typeof fields === "object") {
    for (const k of Object.keys(fields)) {
      if (k.toLowerCase().includes("points")) {
        const v = (fields as any)[k];
        if (v !== undefined && v !== null) return String(v);
      }
    }
  }
  return "0";
}

function getPassMode(typeRaw: unknown) {
  return cleanString(typeRaw)?.toLowerCase() === "value" ? "value" : "loyalty";
}

function pickBalanceCents(fields: any): number {
  const direct = fields?.balance_cents;
  if (direct !== undefined && direct !== null && direct !== "") {
    const cents = Number(direct);
    if (Number.isFinite(cents)) return Math.max(Math.trunc(cents), 0);
  }

  if (fields && typeof fields === "object") {
    for (const key of Object.keys(fields)) {
      const normalizedKey = key.toLowerCase();
      if (!normalizedKey.includes("balance") && !normalizedKey.includes("saldo")) {
        continue;
      }
      const cents = Number((fields as any)[key]);
      if (Number.isFinite(cents)) return Math.max(Math.trunc(cents), 0);
    }
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

function storagePublicUrl(path: string) {
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/pass-assets/${path}`;
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

// -------------------------
// GEOLOCATION (Google Wallet)
// -------------------------
function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

async function resolvePassIdForLocations(
  sb: any,
  projectId: string,
  passId: string | null,
  shortCode: string | null,
) {
  if (passId) return passId;
  if (!shortCode) return null;

  const { data, error } = await sb
    .from("passes")
    .select("id")
    .eq("project_id", projectId)
    .eq("short_code", shortCode)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Erro ao resolver pass_id por short_code: ${error.message}`,
    );
  }

  return cleanString((data as any)?.id);
}

async function loadPassMerchantLocations(
  sb: any,
  projectId: string,
  passId: string | null,
  shortCode: string | null,
) {
  const resolvedPassId = await resolvePassIdForLocations(
    sb,
    projectId,
    passId,
    shortCode,
  );
  if (!resolvedPassId) return [];

  const { data: mappingRows, error: mappingError } = await sb
    .from("pass_locations")
    .select("location_id")
    .eq("project_id", projectId)
    .eq("pass_id", resolvedPassId)
    .limit(100);

  if (mappingError) {
    throw new Error(`Erro ao buscar pass_locations: ${mappingError.message}`);
  }

  const locationIds = [
    ...new Set(
      (mappingRows ?? []).map((row: any) => cleanString(row.location_id))
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
    throw new Error(
      `Erro ao buscar locations por pass_locations: ${locationsError.message}`,
    );
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
    .sort((a: any, b: any) =>
      (order.get(a.id ?? "") ?? 999) - (order.get(b.id ?? "") ?? 999)
    )
    .slice(0, 10);

  return cleaned.map((row: any) => ({
    latitude: row.latitude,
    longitude: row.longitude,
  })) as Array<{ latitude: number; longitude: number }>;
}

async function loadProjectName(
  sb: any,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw new Error(`Erro ao buscar project.name: ${error.message}`);

  return cleanString((data as any)?.name);
}

async function loadPassRow(
  sb: any,
  projectId: string,
  passId: string | null,
  shortCode: string | null,
) {
  const resolvedPassId = await resolvePassIdForLocations(
    sb,
    projectId,
    passId,
    shortCode,
  );
  if (!resolvedPassId) return null;

  const { data, error } = await sb
    .from("passes")
    .select(
      "id, project_id, type, title, description, fields, design, short_code",
    )
    .eq("project_id", projectId)
    .eq("id", resolvedPassId)
    .maybeSingle();

  if (error) throw new Error(`Erro ao buscar passe: ${error.message}`);
  return data;
}

// ------------------------------------------------------------
// Google OAuth (Service Account) -> Access Token
// ------------------------------------------------------------
function normalizePem(pk: string) {
  // aceita PEM normal ou PEM com \n
  return pk.includes("\\n") ? pk.replace(/\\n/g, "\n") : pk;
}

async function getGoogleAccessToken(
  params: { saEmail: string; saPkPem: string; scope: string },
) {
  const { saEmail, saPkPem, scope } = params;

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

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      `Google token error: HTTP ${resp.status} ${JSON.stringify(json)}`,
    );
  }

  const accessToken = typeof json?.access_token === "string"
    ? json.access_token
    : null;
  if (!accessToken) throw new Error("Google token error: missing access_token");
  return accessToken;
}

// ------------------------------------------------------------
// Wallet Objects API: Patch/Insert Class w/ callbackOptions.url
// ------------------------------------------------------------
async function upsertClassWithCallback(params: {
  accessToken: string;
  kind: "loyaltyClass" | "genericClass";
  classId: string; // fully qualified: ISSUER_ID.suffix
  classPayload: any;
  callbackUrl: string;
}) {
  const { accessToken, kind, classId, classPayload, callbackUrl } = params;

  const base = "https://walletobjects.googleapis.com/walletobjects/v1";
  const getUrl = `${base}/${kind}/${encodeURIComponent(classId)}`;
  const patchUrl = getUrl;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const getResp = await fetch(getUrl, { method: "GET", headers });
  const exists = getResp.ok;

  const body = {
    ...classPayload,
    callbackOptions: { url: callbackUrl },
  };

  if (exists) {
    const patchResp = await fetch(patchUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });

    if (!patchResp.ok) {
      const t = await patchResp.text().catch(() => "");
      throw new Error(
        `Wallet PATCH ${kind} failed: HTTP ${patchResp.status} ${t}`,
      );
    }
    return;
  }

  const postUrl = `${base}/${kind}`;
  const postResp = await fetch(postUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!postResp.ok) {
    const t = await postResp.text().catch(() => "");
    throw new Error(`Wallet POST ${kind} failed: HTTP ${postResp.status} ${t}`);
  }
}

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ ok: true, howTo: "POST: { project_id, pass_data }" }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    }

    const GOOGLE_ISSUER_ID = env("GOOGLE_ISSUER_ID");
    const GOOGLE_SA_EMAIL = env("GOOGLE_SA_EMAIL");
    const GOOGLE_SA_PK_RAW = env("GOOGLE_SA_PK");
    const GOOGLE_WALLET_CALLBACK_URL = env("GOOGLE_WALLET_CALLBACK_URL");

    const GOOGLE_SA_PK = normalizePem(GOOGLE_SA_PK_RAW);

    const body = await req.json().catch(() => ({}));
    const project_id = body?.project_id ?? body?.pass_data?.project_id;
    const pass_data = body?.pass_data ?? body ?? {};

    if (!project_id) throw new Error("O 'project_id' é obrigatório.");
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error(
        "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.",
      );
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ✅ issuerName = projects.name (fonte de verdade)
    const projectName = await loadProjectName(sb, project_id);
    const issuerName = projectName ?? "Allin Pass";

    const passId = cleanString(pass_data?.pass_id) ??
      cleanString(pass_data?.id) ??
      cleanString(body?.pass_id);
    const shortCode = cleanString(pass_data?.short_code);
    const passRow = await loadPassRow(sb, project_id, passId, shortCode);

    // ✅ merchantLocations vindo de pass_locations (máx 10)
    const merchantLocations = await loadPassMerchantLocations(
      sb,
      project_id,
      passId,
      shortCode,
    );

    const { data: projectTpl } = await sb
      .from("wallet_templates")
      .select("defaults")
      .eq("project_id", project_id)
      .maybeSingle();

    const { data: globalTpl } = await sb
      .from("wallet_templates")
      .select("defaults")
      .is("project_id", null)
      .maybeSingle();

    const templateDefaults = normalizeDefaults(projectTpl?.defaults);
    const globalDefaults = normalizeDefaults(globalTpl?.defaults);
    const passBaseData = passRow
      ? {
        type: passRow.type,
        title: passRow.title,
        description: passRow.description,
        fields: passRow.fields,
        short_code: passRow.short_code,
      }
      : {};

    const finalPassData: any = {
      ...globalDefaults,
      ...templateDefaults,
      ...passBaseData,
      ...pass_data,
    };

    if (passRow) {
      const passDesign = normalizeDefaults(passRow.design);
      finalPassData.colors = normalizeDefaults(passDesign?.colors);
      finalPassData.images = normalizeDefaults(passDesign?.images);
    }

    const rawType = (cleanString(finalPassData.type) ?? "loyalty").toLowerCase();
    const type = rawType === "value" ? "value" : rawType;
    const passMode = getPassMode(type);
    const title = cleanString(finalPassData.title) ?? "Cartão Fidelidade";
    const header = cleanString(finalPassData.header) ?? "Programa Fidelidade";

    const serial = cleanString(finalPassData.serialNumber) ??
      cleanString(finalPassData.serial) ??
      crypto.randomUUID();

    const fields = finalPassData?.fields ?? {};
    const points = pickFirstPoints(fields);
    const balanceCents = pickBalanceCents(fields);
    const metricLabel = passMode === "value" ? "SALDO" : "PONTOS";
    const metricValue = passMode === "value" ? formatCurrencyBRL(balanceCents) : points;

    const bgColor = mapBgColor(finalPassData.colors);

    const savedShortCode = cleanString(finalPassData.short_code);
    const shortUniversal = savedShortCode && SUPABASE_URL
      ? `${SUPABASE_URL}/functions/v1/universal-link?c=${
        encodeURIComponent(savedShortCode)
      }`
      : null;

    const qrMessage = cleanString(finalPassData.qrMessage) ??
      cleanString(finalPassData.qr_url) ??
      cleanString(finalPassData.universal_url) ??
      shortUniversal ??
      serial;

    const expText = formatBRDateShort(finalPassData.exp_date);
    const expLabel = expText ? `EXPIRA EM ${expText}` : "EXPIRA EM --/--/----";

    const mergedImages = passRow
      ? {
        ...(finalPassData?.images ?? {}),
      }
      : {
        ...(globalDefaults?.images ?? {}),
        ...(templateDefaults?.images ?? {}),
        ...(finalPassData?.images ?? {}),
        ...(pass_data?.images ?? {}),
      };

    const logoUrl = ensureHttpUrl(mergedImages?.googleLogo) ??
      ensureHttpUrl(mergedImages?.logo) ??
      storagePublicUrl("templates/default/logo.png") ??
      null;

    const heroUrl = ensureHttpUrl(mergedImages?.googleHero) ?? null;

    const resolvedClassPassId = cleanString((passRow as any)?.id) ??
      cleanString(finalPassData?.pass_id) ??
      cleanString(pass_data?.pass_id);

    const classSuffix = resolvedClassPassId
      ? `carteira49_${type}_pass_${resolvedClassPassId}_v1`
      : `carteira49_${type}_v1_${project_id}`;
    const objectSuffix = `carteira49_${type}_${project_id}_${serial}`;

    const classId = `${GOOGLE_ISSUER_ID}.${classSuffix}`;
    const objectId = `${GOOGLE_ISSUER_ID}.${objectSuffix}`;

    const isLoyalty = type === "loyalty" || type === "value";

    const loyaltyClass: any = isLoyalty
      ? {
        id: classId,
        issuerName,
        reviewStatus: "UNDER_REVIEW",
        programName: title,
        hexBackgroundColor: bgColor,
        programLogo: logoUrl ? { sourceUri: { uri: logoUrl } } : undefined,
        heroImage: heroUrl ? { sourceUri: { uri: heroUrl } } : undefined,
        // ✅ put on CLASS too (helps Nearby in practice)
        ...(merchantLocations.length ? { merchantLocations } : {}),
      }
      : null;

    const loyaltyObject: any = isLoyalty
      ? {
        id: objectId,
        classId,
        state: "ACTIVE",
        accountId: serial,
        loyaltyPoints: { label: metricLabel, balance: { string: metricValue } },
        barcode: { type: "QR_CODE", value: qrMessage },
        textModulesData: [{
          header: "EXPIRA EM",
          body: expText ?? "--/--/----",
        }],
      }
      : null;

    const genericClass: any = !isLoyalty
      ? {
        id: classId,
        issuerName,
        reviewStatus: "UNDER_REVIEW",
        hexBackgroundColor: bgColor,
        logo: logoUrl ? { sourceUri: { uri: logoUrl } } : undefined,
        heroImage: heroUrl ? { sourceUri: { uri: heroUrl } } : undefined,
        ...(merchantLocations.length ? { merchantLocations } : {}),
      }
      : null;

    const genericObject: any = !isLoyalty
      ? {
        id: objectId,
        classId,
        state: "ACTIVE",
        cardTitle: { defaultValue: { language: "pt-BR", value: title } },
        header: { defaultValue: { language: "pt-BR", value: header } },
        subheader: { defaultValue: { language: "pt-BR", value: expLabel } },
        textModulesData: [
          { header: metricLabel, body: String(metricValue) },
          { header: "EXPIRA EM", body: expText ?? "--/--/----" },
        ],
        barcode: { type: "QR_CODE", value: qrMessage },
      }
      : null;

    // ✅ Upsert do CLASS com callbackOptions.url ANTES do JWT
    const accessToken = await getGoogleAccessToken({
      saEmail: GOOGLE_SA_EMAIL,
      saPkPem: GOOGLE_SA_PK,
      scope: "https://www.googleapis.com/auth/wallet_object.issuer",
    });

    if (isLoyalty && loyaltyClass) {
      await upsertClassWithCallback({
        accessToken,
        kind: "loyaltyClass",
        classId,
        classPayload: loyaltyClass,
        callbackUrl: GOOGLE_WALLET_CALLBACK_URL,
      });
    } else if (!isLoyalty && genericClass) {
      await upsertClassWithCallback({
        accessToken,
        kind: "genericClass",
        classId,
        classPayload: genericClass,
        callbackUrl: GOOGLE_WALLET_CALLBACK_URL,
      });
    }

    // ✅ JWT "Save to Wallet"
    const jwtPayload: any = {
      iss: GOOGLE_SA_EMAIL,
      aud: "google",
      typ: "savetowallet",
      payload: isLoyalty
        ? { loyaltyClasses: [loyaltyClass], loyaltyObjects: [loyaltyObject] }
        : { genericClasses: [genericClass], genericObjects: [genericObject] },
    };

    const privateKey = await importPKCS8(GOOGLE_SA_PK, "RS256");
    const token = await new SignJWT(jwtPayload)
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .sign(privateKey);

    return new Response(
      JSON.stringify({
        saveUrl: `https://pay.google.com/gp/v/save/${token}`,
        objectId,
        classId,
        issuerName,
        injectedMerchantLocations: merchantLocations.length,
        merchantLocationsPreview: merchantLocations,
        callbackUrl: GOOGLE_WALLET_CALLBACK_URL,
        applied: {
          type,
          bgColor,
          points,
          balance_cents: balanceCents,
          metric_label: metricLabel,
          metric_value: metricValue,
          qrMessage,
          exp_date: finalPassData.exp_date ?? null,
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (err: any) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: String(err?.message ?? err) }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
});
