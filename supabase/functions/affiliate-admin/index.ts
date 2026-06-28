import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";

import { corsHeaders, jsonResponse } from "./cors.ts";

type Caller = {
  user: { id: string };
  profile?: { role?: string } | null;
};

type AffiliateSellerRow = {
  id: string;
  name: string;
  contact: string;
  pix_key: string;
  status: string;
  created_at: string;
  updated_at: string;
};

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function getCallerProfile(
  supabaseAdmin: any,
  req: Request,
): Promise<Caller> {
  const token = getBearerToken(req);
  if (!token) {
    throw new HttpError(
      401,
      "AFFILIATE_MISSING_AUTH",
      "Cabecalho Authorization obrigatorio.",
    );
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(
    token,
  );
  const user = userData?.user;
  if (userError || !user) {
    throw new HttpError(401, "AFFILIATE_INVALID_SESSION", "Sessao invalida.");
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  return { user, profile };
}

function ensureSuperadmin(caller: Caller) {
  if (caller.profile?.role !== "superadmin") {
    throw new HttpError(
      403,
      "AFFILIATE_FORBIDDEN",
      "Acesso negado. Apenas superadmins podem gerenciar afiliados.",
    );
  }
}

function mapSeller(seller: AffiliateSellerRow) {
  return {
    id: seller.id,
    name: seller.name,
    contact: seller.contact,
    pixKey: seller.pix_key,
    status: seller.status,
    createdAt: seller.created_at,
    updatedAt: seller.updated_at,
  };
}

function validateRequiredFields(payload: any) {
  const name = String(payload?.name ?? "");
  const contact = String(payload?.contact ?? "");
  const pixKey = String(payload?.pixKey ?? "");

  const cleanName = name.trim();
  const cleanContact = contact.trim();
  const cleanPixKey = pixKey.trim();

  if (!cleanName || !cleanContact || !cleanPixKey) {
    throw new HttpError(
      400,
      "AFFILIATE_VALIDATION_ERROR",
      "Nome, contato e chave Pix sao obrigatorios.",
    );
  }

  return { cleanName, cleanContact, cleanPixKey };
}

async function createSeller(supabaseAdmin: any, caller: Caller, payload: any) {
  const { cleanName, cleanContact, cleanPixKey } = validateRequiredFields(
    payload,
  );

  const { data: seller, error } = await supabaseAdmin
    .from("affiliate_sellers")
    .insert({
      name: cleanName,
      contact: cleanContact,
      pix_key: cleanPixKey,
      created_by: caller.user.id,
      updated_by: caller.user.id,
    })
    .select("id, name, contact, pix_key, status, created_at, updated_at")
    .single();

  if (error) throw error;

  return jsonResponse({
    success: true,
    data: {
      seller: mapSeller(seller),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw new HttpError(
        405,
        "AFFILIATE_METHOD_NOT_ALLOWED",
        "Metodo nao permitido para afiliados.",
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error("Variaveis de ambiente do Supabase nao configuradas.");
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const caller = await getCallerProfile(supabaseAdmin, req);
    ensureSuperadmin(caller);

    const payload = await req.json().catch(() => ({}));
    const action = String(payload?.action || "");

    if (action === "createSeller") {
      return await createSeller(supabaseAdmin, caller, payload);
    }

    throw new HttpError(
      400,
      "AFFILIATE_UNKNOWN_ACTION",
      "Acao de afiliados desconhecida.",
    );
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError
      ? error.code
      : "AFFILIATE_INTERNAL_ERROR";
    const message = error instanceof HttpError
      ? error.message
      : "Erro inesperado ao gerenciar afiliados.";

    console.error("Erro na funcao affiliate-admin:", error);
    return jsonResponse({ error: message, code }, status);
  }
});
