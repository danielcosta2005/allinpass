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

const SELLER_SELECT_FIELDS =
  "id, name, contact, pix_key, status, created_at, updated_at";
const VALID_SELLER_STATUSES = new Set(["active", "inactive"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function normalizePage(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function normalizePageSize(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 25;
  return Math.min(Math.floor(parsed), 50);
}

function normalizeStatus(value: unknown, { optional = false } = {}) {
  const status = String(value ?? "").trim().toLowerCase();

  if (optional && !status) return "";

  if (!VALID_SELLER_STATUSES.has(status)) {
    throw new HttpError(
      400,
      "AFFILIATE_INVALID_STATUS",
      "Status de afiliado invalido.",
    );
  }

  return status;
}

function validateSellerId(value: unknown) {
  const sellerId = String(value ?? "").trim();

  if (!sellerId || !UUID_RE.test(sellerId)) {
    throw new HttpError(
      400,
      "AFFILIATE_VALIDATION_ERROR",
      "Vendedor afiliado invalido.",
    );
  }

  return sellerId;
}

function normalizeSearch(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[%_,]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
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
    .select(SELLER_SELECT_FIELDS)
    .single();

  if (error) throw error;

  return jsonResponse({
    success: true,
    data: {
      seller: mapSeller(seller),
    },
  });
}

async function listSellers(supabaseAdmin: any, payload: any) {
  const page = normalizePage(payload?.page);
  const pageSize = normalizePageSize(payload?.pageSize);
  const status = normalizeStatus(payload?.status, { optional: true });
  const search = normalizeSearch(payload?.search);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from("affiliate_sellers")
    .select(SELLER_SELECT_FIELDS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status) {
    query = query.eq("status", status);
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,contact.ilike.%${search}%`);
  }

  const { data: sellers, error, count } = await query;

  if (error) throw error;

  return jsonResponse({
    success: true,
    data: {
      sellers: (sellers || []).map(mapSeller),
      page,
      pageSize,
      total: count ?? 0,
    },
  });
}

async function updateSeller(
  supabaseAdmin: any,
  caller: Caller,
  payload: any,
) {
  const sellerId = validateSellerId(payload?.sellerId);
  const { cleanName, cleanContact, cleanPixKey } = validateRequiredFields(
    payload,
  );
  const status = normalizeStatus(payload?.status);

  const { data: seller, error } = await supabaseAdmin
    .from("affiliate_sellers")
    .update({
      name: cleanName,
      contact: cleanContact,
      pix_key: cleanPixKey,
      status,
      updated_by: caller.user.id,
    })
    .eq("id", sellerId)
    .select(SELLER_SELECT_FIELDS)
    .maybeSingle();

  if (error) throw error;

  if (!seller) {
    throw new HttpError(
      404,
      "AFFILIATE_SELLER_NOT_FOUND",
      "Vendedor afiliado nao encontrado.",
    );
  }

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

    if (action === "listSellers") {
      return await listSellers(supabaseAdmin, payload);
    }

    if (action === "updateSeller") {
      return await updateSeller(supabaseAdmin, caller, payload);
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
