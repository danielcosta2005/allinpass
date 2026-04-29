import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

console.info("send-google-segmented-notification started");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";


function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-test-secret, x-internal-secret",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(status: number, payload: unknown, origin?: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Connection": "keep-alive",
      ...corsHeaders(origin),
    },
  });
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function norm(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

function base64UrlEncode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function importPrivateKeyFromPem(pem: string): Promise<CryptoKey> {
  const clean = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  const der = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signJwtRS256(payload: Record<string, unknown>, privateKeyPem: string) {
  const header = { alg: "RS256", typ: "JWT" };
  const enc = new TextEncoder();

  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));

  const data = enc.encode(`${headerB64}.${payloadB64}`);
  const key = await importPrivateKeyFromPem(privateKeyPem);

  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data));
  const sigB64 = base64UrlEncode(sig);

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

function getServiceAccountFromBase64() {
  const b64 = Deno.env.get("GOOGLE_WALLET_BASE64");
  if (!b64) throw new Error("Missing secret GOOGLE_WALLET_BASE64");

  const decoded = atob(b64);
  const sa = JSON.parse(decoded);

  if (!sa?.client_email) throw new Error("Service Account JSON missing client_email");
  if (!sa?.private_key) throw new Error("Service Account JSON missing private_key");
  if (!sa?.token_uri) throw new Error("Service Account JSON missing token_uri");

  return sa;
}

async function getGoogleAccessToken() {
  const sa = getServiceAccountFromBase64();
  const now = Math.floor(Date.now() / 1000);

  const assertionPayload = {
    iss: sa.client_email,
    scope: WALLET_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 60 * 60,
  };

  const assertion = await signJwtRS256(assertionPayload, sa.private_key);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(`OAuth token error: ${JSON.stringify(data)}`);

  return data.access_token as string;
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

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  const origin = req.headers.get("origin") ?? "*";

  // ✅ preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") return json(405, { error: "Method not allowed. Use POST.", requestId }, origin);
  
  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed. Use POST.", requestId }, origin);

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios (para DB check).");
    }

    // Gate opcional (compatível com sua função atual)
    const testSecret = Deno.env.get("WALLET_TEST_SECRET");
    if (testSecret) {
      const got = req.headers.get("x-test-secret");
      if (got !== testSecret) return json(401, { error: "Unauthorized (x-test-secret)", requestId }, origin);
    }

    const body = await req.json().catch(() => ({}));

    const projectId = cleanString(body?.projectId);
    const message = cleanString(body?.message);
    const header = cleanString(body?.header) ?? "Allin Pass";
    const targets = Array.isArray(body?.targets) ? body.targets : [];

    if (!projectId) return json(400, { error: "projectId is required", requestId }, origin);
    if (!message) return json(400, { error: "message is required", requestId }, origin);
    if (message.length > 200) return json(400, { error: "message too long (max 200)", requestId }, origin);

    // ✅ CORRETO: filtra por install_platform=google e install_status=installed
    const googleTargets = targets
      .filter((t: any) => norm(t?.install_platform) === "google")
      .filter((t: any) => norm(t?.install_status) === "installed")
      .map((t: any) => ({
        user_pass_id: cleanString(t?.user_pass_id),
        google_object_id: cleanString(t?.google_object_id),
        project_id: cleanString(t?.project_id),
      }))
      .filter((t: any) => t.google_object_id && t.user_pass_id);

    if (googleTargets.length === 0) {
      return json(200, {
        ok: true,
        requestId,
        note: "Nenhum target Google (installed) válido para envio.",
        totals: { received: targets.length, googleTargets: 0, sent: 0, failed: 0 },
        results: [],
      }, origin);
    }

    // defesa: só permite targets do mesmo projectId (do payload)
    const filteredByProject = googleTargets.filter((t: any) => t.project_id === projectId);

    if (filteredByProject.length === 0) {
      return json(403, { error: "Nenhum target Google pertence ao projectId informado.", requestId }, origin);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1 token por request
    const accessToken = await getGoogleAccessToken();

    const results = await runWithConcurrency(filteredByProject, 8, async (t: any) => {
      const objectId = t.google_object_id as string;
      const userPassId = t.user_pass_id as string;

      try {
        // ✅ DB check: garante project + plataforma + status
        const { data: up, error: eUp } = await sb
          .from("user_passes")
          .select("id, google_object_id, install_platform, install_status, passes(project_id)")
          .eq("id", userPassId)
          .maybeSingle();

        if (eUp) throw new Error(`Erro ao buscar user_passes: ${eUp.message}`);
        if (!up) throw new Error("user_passes não encontrado");

        const passesRel = Array.isArray((up as any).passes) ? (up as any).passes[0] : (up as any).passes;
        const upProjectId = passesRel?.project_id ?? null;

        if (upProjectId !== projectId) throw new Error("Target não pertence ao projectId (DB check)");
        if (norm((up as any).install_platform) !== "google") throw new Error("install_platform não é google (DB check)");
        if (norm((up as any).install_status) !== "installed") throw new Error("install_status não é installed (DB check)");

        // opcional: garante que objectId é o mesmo do DB (evita spoof do payload)
        const dbObjectId = cleanString((up as any).google_object_id);
        if (dbObjectId && dbObjectId !== objectId) {
          throw new Error("google_object_id divergente do banco (DB check)");
        }

        const messageId = crypto.randomUUID();
        const url =
          `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}/addMessage`;

        const payload = {
          message: {
            id: messageId,
            header,
            body: message,
            message_type: "TEXT_AND_NOTIFY",
          },
        };

        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          return {
            ok: false,
            user_pass_id: userPassId,
            google_object_id: objectId,
            error: "Google Wallet API error",
            status: resp.status,
            details: data,
          };
        }

        return {
          ok: true,
          user_pass_id: userPassId,
          google_object_id: objectId,
          sentMessageId: messageId,
        };
      } catch (err) {
        return {
          ok: false,
          user_pass_id: userPassId,
          google_object_id: objectId,
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
      header,
      message,
      totals: {
        received: targets.length,
        googleTargets: googleTargets.length,
        filteredByProject: filteredByProject.length,
        sent,
        failed,
      },
      results,
      notes: [
        "A push notification depende das notificações do app Carteira do Google estarem ativadas no aparelho.",
        "Há limites anti-spam em janelas de tempo (Google Wallet).",
      ],
    }, origin);
  } catch (err) {
    console.error("send-google-segmented-notification error:", err);
    return json(500, { ok: false, error: (err as any)?.message ?? String(err), requestId }, origin);
  }
});