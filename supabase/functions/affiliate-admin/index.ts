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

type AffiliateLinkRow = {
  id: string;
  seller_id: string;
  code: string;
  status: string;
  created_at: string;
  updated_at: string;
};

const SELLER_SELECT_FIELDS =
  "id, name, contact, pix_key, status, created_at, updated_at";
const LINK_SELECT_FIELDS =
  "id, seller_id, code, status, created_at, updated_at";
const PAYOUT_SELECT_FIELDS = [
  "id",
  "seller_id",
  "competence_month",
  "amount_cents",
  "commission_count",
  "currency",
  "status",
  "payment_method",
  "paid_at",
  "paid_by",
  "note",
  "metadata",
  "created_at",
  "updated_at",
].join(", ");
const COMMISSION_ADMIN_SELECT_FIELDS = [
  "id",
  "attribution_id",
  "seller_id",
  "link_id",
  "user_id",
  "project_id",
  "subscription_id",
  "billing_cycle_id",
  "plan_id",
  "competence_month",
  "paid_at",
  "payout_id",
  "marked_paid_at",
  "marked_paid_by",
  "payment_note",
  "provider_payment_id",
  "provider_event_id",
  "eligible_amount_cents",
  "commission_rate_bps",
  "commission_cents",
  "currency",
  "status",
  "source",
  "metadata",
  "created_at",
  "updated_at",
  "affiliate_sellers(id, name, contact, pix_key, status)",
  "projects(id, name, slug)",
  "billing_subscriptions(id, status, plan_id, base_price_cents, currency)",
  "affiliate_payouts(id, seller_id, competence_month, amount_cents, commission_count, currency, status, payment_method, paid_at, paid_by, note)",
].join(", ");
const VALID_SELLER_STATUSES = new Set(["active", "inactive"]);
const VALID_COMMISSION_STATUSES = new Set(["pending", "paid", "void"]);
const LINK_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const LINK_CODE_LENGTH = 10;
const LINK_CODE_MAX_ATTEMPTS = 5;
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

function mapLink(link?: AffiliateLinkRow | null) {
  if (!link) return null;

  return {
    id: link.id,
    sellerId: link.seller_id,
    code: link.code,
    status: link.status,
    createdAt: link.created_at,
    updatedAt: link.updated_at,
  };
}

function mapSeller(
  seller: AffiliateSellerRow,
  affiliateLink?: AffiliateLinkRow | null,
  summary?: Record<string, unknown>,
) {
  return {
    id: seller.id,
    name: seller.name,
    contact: seller.contact,
    pixKey: seller.pix_key,
    status: seller.status,
    createdAt: seller.created_at,
    updatedAt: seller.updated_at,
    affiliateLink: mapLink(affiliateLink),
    summary: summary || {
      attributedClientsCount: 0,
      pendingCommissionCents: 0,
      paidCommissionCents: 0,
      totalCommissionCents: 0,
      pendingCommissionCount: 0,
      paidCommissionCount: 0,
    },
  };
}

function generateLinkCode() {
  const bytes = new Uint8Array(LINK_CODE_LENGTH);
  crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    (byte) => LINK_CODE_ALPHABET[byte % LINK_CODE_ALPHABET.length],
  ).join("");
}

function isUniqueViolation(error: any) {
  return error?.code === "23505" ||
    String(error?.message || "").toLowerCase().includes("duplicate key");
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

function normalizeCommissionStatus(value: unknown, { optional = false } = {}) {
  const status = String(value ?? "").trim().toLowerCase();

  if (optional && !status) return "";

  if (!VALID_COMMISSION_STATUSES.has(status)) {
    throw new HttpError(
      400,
      "AFFILIATE_INVALID_COMMISSION_STATUS",
      "Status de comissao invalido.",
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

function validateCommissionId(value: unknown) {
  const commissionId = String(value ?? "").trim();

  if (!commissionId || !UUID_RE.test(commissionId)) {
    throw new HttpError(
      400,
      "AFFILIATE_VALIDATION_ERROR",
      "Comissao afiliada invalida.",
    );
  }

  return commissionId;
}

function validateOptionalSellerId(value: unknown) {
  const sellerId = String(value ?? "").trim();
  return sellerId ? validateSellerId(sellerId) : "";
}

function normalizeCompetenceMonth(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const match = raw.match(/^(\d{4})-(\d{2})(?:-01)?$/);
  if (!match) {
    throw new HttpError(
      400,
      "AFFILIATE_INVALID_COMPETENCE_MONTH",
      "Competencia de comissao invalida.",
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) {
    throw new HttpError(
      400,
      "AFFILIATE_INVALID_COMPETENCE_MONTH",
      "Competencia de comissao invalida.",
    );
  }

  return `${match[1]}-${match[2]}-01`;
}

function normalizeSearch(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[%_,]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function normalizePaymentNote(value: unknown) {
  const note = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 500);

  return note || null;
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

async function getLinksBySellerIds(supabaseAdmin: any, sellerIds: string[]) {
  if (sellerIds.length === 0) return new Map<string, AffiliateLinkRow>();

  const { data: links, error } = await supabaseAdmin
    .from("affiliate_links")
    .select(LINK_SELECT_FIELDS)
    .in("seller_id", sellerIds);

  if (error) throw error;

  return new Map<string, AffiliateLinkRow>(
    (links || []).map((link: AffiliateLinkRow) => [link.seller_id, link]),
  );
}

async function getSellerCommissionSummaries(
  supabaseAdmin: any,
  sellerIds: string[],
  competenceMonth: string,
) {
  const summaries = new Map<string, Record<string, number>>(
    sellerIds.map((sellerId) => [
      sellerId,
      {
        attributedClientsCount: 0,
        pendingCommissionCents: 0,
        paidCommissionCents: 0,
        totalCommissionCents: 0,
        pendingCommissionCount: 0,
        paidCommissionCount: 0,
      },
    ]),
  );

  if (sellerIds.length === 0) return summaries;

  const { data: attributions, error: attributionsError } = await supabaseAdmin
    .from("affiliate_attributions")
    .select("seller_id")
    .in("seller_id", sellerIds);

  if (attributionsError) throw attributionsError;

  for (const attribution of attributions || []) {
    const summary = summaries.get(attribution.seller_id);
    if (summary) {
      summary.attributedClientsCount += 1;
    }
  }

  let commissionsQuery = supabaseAdmin
    .from("affiliate_commissions")
    .select("seller_id, status, commission_cents")
    .in("seller_id", sellerIds);

  if (competenceMonth) {
    commissionsQuery = commissionsQuery.eq("competence_month", competenceMonth);
  }

  const { data: commissions, error: commissionsError } = await commissionsQuery;
  if (commissionsError) throw commissionsError;

  for (const commission of commissions || []) {
    const summary = summaries.get(commission.seller_id);
    if (!summary) continue;

    const commissionCents = Number(commission.commission_cents || 0);
    summary.totalCommissionCents += commissionCents;

    if (commission.status === "paid") {
      summary.paidCommissionCents += commissionCents;
      summary.paidCommissionCount += 1;
    } else if (commission.status === "pending") {
      summary.pendingCommissionCents += commissionCents;
      summary.pendingCommissionCount += 1;
    }
  }

  return summaries;
}

async function listSellers(supabaseAdmin: any, payload: any) {
  const page = normalizePage(payload?.page);
  const pageSize = normalizePageSize(payload?.pageSize);
  const status = normalizeStatus(payload?.status, { optional: true });
  const search = normalizeSearch(payload?.search);
  const includeSummary = Boolean(payload?.includeSummary);
  const competenceMonth = normalizeCompetenceMonth(payload?.competenceMonth);
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

  const safeSellers = sellers || [];
  const linksBySellerId = await getLinksBySellerIds(
    supabaseAdmin,
    safeSellers.map((seller: AffiliateSellerRow) => seller.id),
  );
  const summariesBySellerId = includeSummary
    ? await getSellerCommissionSummaries(
      supabaseAdmin,
      safeSellers.map((seller: AffiliateSellerRow) => seller.id),
      competenceMonth,
    )
    : new Map<string, Record<string, number>>();

  return jsonResponse({
    success: true,
    data: {
      sellers: safeSellers.map((seller: AffiliateSellerRow) =>
        mapSeller(
          seller,
          linksBySellerId.get(seller.id),
          summariesBySellerId.get(seller.id),
        )
      ),
      page,
      pageSize,
      total: count ?? 0,
    },
  });
}

async function listCommissions(supabaseAdmin: any, payload: any) {
  const page = normalizePage(payload?.page);
  const pageSize = normalizePageSize(payload?.pageSize);
  const sellerId = validateOptionalSellerId(payload?.sellerId);
  const competenceMonth = normalizeCompetenceMonth(payload?.competenceMonth);
  const status = normalizeCommissionStatus(payload?.status, {
    optional: true,
  });
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from("affiliate_commissions")
    .select(COMMISSION_ADMIN_SELECT_FIELDS, { count: "exact" })
    .order("competence_month", { ascending: false })
    .order("paid_at", { ascending: false })
    .range(from, to);

  if (sellerId) {
    query = query.eq("seller_id", sellerId);
  }

  if (competenceMonth) {
    query = query.eq("competence_month", competenceMonth);
  }

  if (status) {
    query = query.eq("status", status);
  }

  const { data: commissions, error, count } = await query;
  if (error) throw error;

  return jsonResponse({
    success: true,
    data: {
      commissions: commissions || [],
      page,
      pageSize,
      total: count ?? 0,
    },
  });
}

async function listCommissionClients(supabaseAdmin: any, payload: any) {
  const page = normalizePage(payload?.page);
  const pageSize = normalizePageSize(payload?.pageSize);
  const sellerId = validateOptionalSellerId(payload?.sellerId);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from("affiliate_attributions")
    .select(
      [
        "id",
        "seller_id",
        "link_id",
        "user_id",
        "project_id",
        "subscription_id",
        "checkout_session_id",
        "plan_id",
        "source_code",
        "status",
        "attributed_at",
        "metadata",
        "created_at",
        "updated_at",
        "affiliate_sellers(id, name, contact, pix_key, status)",
        "affiliate_links(id, code, status)",
        "projects(id, name, slug)",
        "billing_subscriptions(id, status, plan_id, base_price_cents, currency, current_period_start, current_period_end)",
        "affiliate_commissions(id, competence_month, paid_at, payout_id, marked_paid_at, marked_paid_by, payment_note, provider_payment_id, eligible_amount_cents, commission_rate_bps, commission_cents, currency, status, affiliate_payouts(id, paid_at, paid_by, note))",
      ].join(", "),
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (sellerId) {
    query = query.eq("seller_id", sellerId);
  }

  const { data: clients, error, count } = await query;
  if (error) throw error;

  return jsonResponse({
    success: true,
    data: {
      clients: clients || [],
      page,
      pageSize,
      total: count ?? 0,
    },
  });
}

async function getCommissionById(supabaseAdmin: any, commissionId: string) {
  const { data: commission, error } = await supabaseAdmin
    .from("affiliate_commissions")
    .select(COMMISSION_ADMIN_SELECT_FIELDS)
    .eq("id", commissionId)
    .maybeSingle();

  if (error) throw error;

  if (!commission) {
    throw new HttpError(
      404,
      "AFFILIATE_COMMISSION_NOT_FOUND",
      "Comissao afiliada nao encontrada.",
    );
  }

  return commission;
}

async function createManualPayout(
  supabaseAdmin: any,
  caller: Caller,
  {
    sellerId,
    competenceMonth,
    amountCents,
    commissionCount,
    currency,
    note,
    commissionIds,
  }: {
    sellerId: string;
    competenceMonth: string;
    amountCents: number;
    commissionCount: number;
    currency?: string | null;
    note: string | null;
    commissionIds: string[];
  },
) {
  const { data: payout, error } = await supabaseAdmin
    .from("affiliate_payouts")
    .insert({
      seller_id: sellerId,
      competence_month: competenceMonth,
      amount_cents: amountCents,
      commission_count: commissionCount,
      currency: currency || "BRL",
      status: "paid",
      payment_method: "pix_manual",
      paid_by: caller.user.id,
      note,
      metadata: {
        source: "affiliate-admin",
        commission_ids: commissionIds,
      },
    })
    .select(PAYOUT_SELECT_FIELDS)
    .single();

  if (error) throw error;
  return payout;
}

async function markCommissionPaid(
  supabaseAdmin: any,
  caller: Caller,
  payload: any,
) {
  const commissionId = validateCommissionId(payload?.commissionId);
  const note = normalizePaymentNote(payload?.note);
  const commission = await getCommissionById(supabaseAdmin, commissionId);

  if (commission.status === "paid") {
    return jsonResponse({
      success: true,
      data: {
        commission,
        payout: commission.affiliate_payouts || null,
        alreadyPaid: true,
      },
    });
  }

  if (commission.status !== "pending") {
    throw new HttpError(
      409,
      "AFFILIATE_COMMISSION_NOT_PAYABLE",
      "Apenas comissoes pendentes podem ser marcadas como pagas.",
    );
  }

  const payout = await createManualPayout(supabaseAdmin, caller, {
    sellerId: commission.seller_id,
    competenceMonth: commission.competence_month,
    amountCents: Number(commission.commission_cents || 0),
    commissionCount: 1,
    currency: commission.currency,
    note,
    commissionIds: [commission.id],
  });

  const { data: updatedCommission, error } = await supabaseAdmin
    .from("affiliate_commissions")
    .update({
      status: "paid",
      payout_id: payout.id,
      marked_paid_at: payout.paid_at,
      marked_paid_by: caller.user.id,
      payment_note: note,
    })
    .eq("id", commissionId)
    .eq("status", "pending")
    .select(COMMISSION_ADMIN_SELECT_FIELDS)
    .maybeSingle();

  if (error) throw error;

  if (!updatedCommission) {
    const currentCommission = await getCommissionById(
      supabaseAdmin,
      commissionId,
    );
    if (currentCommission.status === "paid") {
      return jsonResponse({
        success: true,
        data: {
          commission: currentCommission,
          payout: currentCommission.affiliate_payouts || null,
          alreadyPaid: true,
        },
      });
    }

    throw new HttpError(
      409,
      "AFFILIATE_COMMISSION_PAYMENT_RACE",
      "Nao foi possivel confirmar a marcacao de pagamento da comissao.",
    );
  }

  return jsonResponse({
    success: true,
    data: {
      commission: updatedCommission,
      payout,
      alreadyPaid: false,
    },
  });
}

async function markSellerCompetencePaid(
  supabaseAdmin: any,
  caller: Caller,
  payload: any,
) {
  const sellerId = validateSellerId(payload?.sellerId);
  const competenceMonth = normalizeCompetenceMonth(payload?.competenceMonth);
  const note = normalizePaymentNote(payload?.note);

  if (!competenceMonth) {
    throw new HttpError(
      400,
      "AFFILIATE_INVALID_COMPETENCE_MONTH",
      "Competencia de comissao invalida.",
    );
  }

  const { data: commissions, error: commissionsError } = await supabaseAdmin
    .from("affiliate_commissions")
    .select(
      "id, seller_id, competence_month, commission_cents, currency, status",
    )
    .eq("seller_id", sellerId)
    .eq("competence_month", competenceMonth)
    .eq("status", "pending");

  if (commissionsError) throw commissionsError;

  const pendingCommissions = commissions || [];
  if (pendingCommissions.length === 0) {
    return jsonResponse({
      success: true,
      data: {
        payout: null,
        commissions: [],
        updatedCount: 0,
        alreadyPaid: true,
      },
    });
  }

  const amountCents = pendingCommissions.reduce(
    (total: number, commission: any) =>
      total + Number(commission.commission_cents || 0),
    0,
  );
  const commissionIds = pendingCommissions.map((commission: any) =>
    commission.id
  );
  const payout = await createManualPayout(supabaseAdmin, caller, {
    sellerId,
    competenceMonth,
    amountCents,
    commissionCount: pendingCommissions.length,
    currency: pendingCommissions[0]?.currency || "BRL",
    note,
    commissionIds,
  });

  const { data: updatedCommissions, error: updateError } = await supabaseAdmin
    .from("affiliate_commissions")
    .update({
      status: "paid",
      payout_id: payout.id,
      marked_paid_at: payout.paid_at,
      marked_paid_by: caller.user.id,
      payment_note: note,
    })
    .in("id", commissionIds)
    .eq("status", "pending")
    .select(COMMISSION_ADMIN_SELECT_FIELDS);

  if (updateError) throw updateError;

  return jsonResponse({
    success: true,
    data: {
      payout,
      commissions: updatedCommissions || [],
      updatedCount: updatedCommissions?.length || 0,
      alreadyPaid: false,
    },
  });
}

async function findSellerLink(supabaseAdmin: any, sellerId: string) {
  const { data: link, error } = await supabaseAdmin
    .from("affiliate_links")
    .select(LINK_SELECT_FIELDS)
    .eq("seller_id", sellerId)
    .maybeSingle();

  if (error) throw error;
  return link as AffiliateLinkRow | null;
}

async function getOrCreateSellerLink(
  supabaseAdmin: any,
  caller: Caller,
  payload: any,
) {
  const sellerId = validateSellerId(payload?.sellerId);

  const { data: seller, error: sellerError } = await supabaseAdmin
    .from("affiliate_sellers")
    .select("id, status")
    .eq("id", sellerId)
    .maybeSingle();

  if (sellerError) throw sellerError;

  if (!seller) {
    throw new HttpError(
      404,
      "AFFILIATE_SELLER_NOT_FOUND",
      "Vendedor afiliado nao encontrado.",
    );
  }

  if (seller.status !== "active") {
    throw new HttpError(
      409,
      "AFFILIATE_SELLER_INACTIVE",
      "Vendedor inativo nao pode gerar link de afiliado.",
    );
  }

  const existingLink = await findSellerLink(supabaseAdmin, sellerId);
  if (existingLink) {
    return jsonResponse({
      success: true,
      data: { link: mapLink(existingLink) },
    });
  }

  for (let attempt = 0; attempt < LINK_CODE_MAX_ATTEMPTS; attempt += 1) {
    const { data: link, error } = await supabaseAdmin
      .from("affiliate_links")
      .insert({
        seller_id: sellerId,
        code: generateLinkCode(),
        status: "active",
        created_by: caller.user.id,
        updated_by: caller.user.id,
      })
      .select(LINK_SELECT_FIELDS)
      .single();

    if (!error) {
      return jsonResponse({
        success: true,
        data: { link: mapLink(link) },
      });
    }

    if (
      isUniqueViolation(error) &&
      String(error?.message || "").includes("affiliate_links_seller_id_uidx")
    ) {
      const concurrentLink = await findSellerLink(supabaseAdmin, sellerId);
      if (concurrentLink) {
        return jsonResponse({
          success: true,
          data: { link: mapLink(concurrentLink) },
        });
      }
    }

    if (!isUniqueViolation(error)) throw error;
  }

  throw new HttpError(
    409,
    "AFFILIATE_LINK_CODE_COLLISION",
    "Nao foi possivel gerar um codigo unico de afiliado.",
  );
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

    if (action === "listCommissions") {
      return await listCommissions(supabaseAdmin, payload);
    }

    if (action === "listCommissionClients") {
      return await listCommissionClients(supabaseAdmin, payload);
    }

    if (action === "markCommissionPaid") {
      return await markCommissionPaid(supabaseAdmin, caller, payload);
    }

    if (action === "markSellerCompetencePaid") {
      return await markSellerCompetencePaid(supabaseAdmin, caller, payload);
    }

    if (action === "getOrCreateSellerLink") {
      return await getOrCreateSellerLink(supabaseAdmin, caller, payload);
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
