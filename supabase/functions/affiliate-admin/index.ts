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

type PromotionalCodeRow = {
  id: string;
  affiliate_link_id: string | null;
  seller_id: string | null;
  code: string;
  discount_bps: number;
  commission_bps: number;
  duration: string;
  max_uses: number | null;
  redeemed_uses: number;
  valid_until: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const SELLER_SELECT_FIELDS =
  "id, name, contact, pix_key, status, created_at, updated_at";
const LINK_SELECT_FIELDS =
  "id, seller_id, code, status, created_at, updated_at";
const PROMO_SELECT_FIELDS = [
  "id",
  "affiliate_link_id",
  "seller_id",
  "code",
  "discount_bps",
  "commission_bps",
  "duration",
  "max_uses",
  "redeemed_uses",
  "valid_until",
  "status",
  "metadata",
  "created_at",
  "updated_at",
  "affiliate_sellers(id, name, contact, pix_key, status)",
].join(", ");
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
const VALID_PROMO_STATUSES = new Set(["active", "inactive"]);
const PROMO_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{5,39}$/;
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

function mapPromotionalCode(promo?: PromotionalCodeRow | null) {
  if (!promo) return null;

  return {
    id: promo.id,
    affiliateLinkId: promo.affiliate_link_id,
    sellerId: promo.seller_id,
    code: promo.code,
    discountBps: promo.discount_bps,
    commissionBps: promo.commission_bps,
    duration: promo.duration,
    maxUses: promo.max_uses,
    redeemedUses: promo.redeemed_uses,
    validUntil: promo.valid_until,
    status: promo.status,
    metadata: promo.metadata || {},
    createdAt: promo.created_at,
    updatedAt: promo.updated_at,
    seller: (promo as any).affiliate_sellers || null,
  };
}

function mapSeller(
  seller: AffiliateSellerRow,
  affiliateLink?: AffiliateLinkRow | null,
  summary?: Record<string, unknown>,
  promotionalCode?: PromotionalCodeRow | null,
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
    promotionalCode: mapPromotionalCode(promotionalCode),
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

function normalizePromoStatus(value: unknown, { optional = false } = {}) {
  const status = String(value ?? "").trim().toLowerCase();

  if (optional && !status) return "";

  if (!VALID_PROMO_STATUSES.has(status)) {
    throw new HttpError(
      400,
      "AFFILIATE_INVALID_PROMO_STATUS",
      "Status de codigo promocional invalido.",
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

function validatePromoCodeId(value: unknown) {
  const promoCodeId = String(value ?? "").trim();

  if (!promoCodeId || !UUID_RE.test(promoCodeId)) {
    throw new HttpError(
      400,
      "AFFILIATE_VALIDATION_ERROR",
      "Codigo promocional invalido.",
    );
  }

  return promoCodeId;
}

function validateOptionalSellerId(value: unknown) {
  const sellerId = String(value ?? "").trim();
  return sellerId ? validateSellerId(sellerId) : "";
}

function normalizePromoCode(value: unknown) {
  const code = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);

  if (!PROMO_CODE_PATTERN.test(code)) {
    throw new HttpError(
      400,
      "AFFILIATE_INVALID_PROMO_CODE",
      "Use um codigo com 6 a 40 caracteres, apenas letras minusculas, numeros e hifen.",
    );
  }

  return code;
}

function normalizeBps(
  value: unknown,
  {
    defaultValue,
    allowZero = false,
    fieldName,
  }: { defaultValue: number; allowZero?: boolean; fieldName: string },
) {
  const parsed = Number(value ?? defaultValue);
  const bps = Math.trunc(parsed);
  const minimum = allowZero ? 0 : 1;

  if (!Number.isFinite(parsed) || bps < minimum || bps > 10000) {
    throw new HttpError(
      400,
      "AFFILIATE_INVALID_PROMO_RATE",
      `${fieldName} deve estar entre ${allowZero ? "0" : "0,01"}% e 100%.`,
    );
  }

  return bps;
}

function normalizeMaxUses(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);
  const maxUses = Math.trunc(parsed);
  if (!Number.isFinite(parsed) || maxUses < 1) {
    throw new HttpError(
      400,
      "AFFILIATE_INVALID_PROMO_MAX_USES",
      "Limite de usos deve ser vazio ou maior que zero.",
    );
  }

  return maxUses;
}

function normalizeValidUntil(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(
      400,
      "AFFILIATE_INVALID_PROMO_VALID_UNTIL",
      "Validade do codigo promocional invalida.",
    );
  }

  return date.toISOString();
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

async function getPromosBySellerIds(supabaseAdmin: any, sellerIds: string[]) {
  if (sellerIds.length === 0) return new Map<string, PromotionalCodeRow>();

  const { data: promos, error } = await supabaseAdmin
    .from("billing_promotional_codes")
    .select(PROMO_SELECT_FIELDS)
    .in("seller_id", sellerIds)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const bySellerId = new Map<string, PromotionalCodeRow>();
  for (const promo of promos || []) {
    if (promo.seller_id && !bySellerId.has(promo.seller_id)) {
      bySellerId.set(promo.seller_id, promo as PromotionalCodeRow);
    }
  }

  return bySellerId;
}

async function assertActiveSeller(supabaseAdmin: any, sellerId: string) {
  const { data: seller, error } = await supabaseAdmin
    .from("affiliate_sellers")
    .select("id, status")
    .eq("id", sellerId)
    .maybeSingle();

  if (error) throw error;

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
      "Vendedor inativo nao pode receber codigo promocional.",
    );
  }
}

async function findPromotionalCodeByLinkId(
  supabaseAdmin: any,
  affiliateLinkId: string,
) {
  const { data: promo, error } = await supabaseAdmin
    .from("billing_promotional_codes")
    .select(PROMO_SELECT_FIELDS)
    .eq("affiliate_link_id", affiliateLinkId)
    .maybeSingle();

  if (error) throw error;
  return promo as PromotionalCodeRow | null;
}

async function assertPromotionalCodeAvailable(
  supabaseAdmin: any,
  code: string,
  {
    currentLinkId = null,
    currentPromoCodeId = null,
  }: {
    currentLinkId?: string | null;
    currentPromoCodeId?: string | null;
  } = {},
) {
  const { data: linkData, error: linkError } = await supabaseAdmin
    .from("affiliate_links")
    .select("id")
    .ilike("code", code)
    .maybeSingle();

  if (linkError) throw linkError;

  if (linkData?.id && linkData.id !== currentLinkId) {
    throw new HttpError(
      409,
      "AFFILIATE_PROMO_CODE_CONFLICT",
      "Este codigo promocional ja esta em uso.",
    );
  }

  const { data: promoData, error: promoError } = await supabaseAdmin
    .from("billing_promotional_codes")
    .select("id")
    .ilike("code", code)
    .maybeSingle();

  if (promoError) throw promoError;

  if (promoData?.id && promoData.id !== currentPromoCodeId) {
    throw new HttpError(
      409,
      "AFFILIATE_PROMO_CODE_CONFLICT",
      "Este codigo promocional ja esta em uso.",
    );
  }
}

async function ensureSellerPromotionalCode(
  supabaseAdmin: any,
  caller: Caller,
  {
    sellerId,
    code,
    discountBps = 1000,
    commissionBps = 1000,
    maxUses = null,
    validUntil = null,
    status = "active",
  }: {
    sellerId: string;
    code?: string;
    discountBps?: number;
    commissionBps?: number;
    maxUses?: number | null;
    validUntil?: string | null;
    status?: string;
  },
) {
  await assertActiveSeller(supabaseAdmin, sellerId);

  let link = await findSellerLink(supabaseAdmin, sellerId);
  const existingPromo = link
    ? await findPromotionalCodeByLinkId(supabaseAdmin, link.id)
    : null;
  const nextCode = code || link?.code || generateLinkCode();
  const existingRedeemedUses = Math.max(
    0,
    Math.trunc(Number(existingPromo?.redeemed_uses || 0)),
  );

  if (existingPromo && maxUses !== null && maxUses < existingRedeemedUses) {
    throw new HttpError(
      400,
      "AFFILIATE_INVALID_PROMO_MAX_USES",
      "Limite de usos nao pode ser menor que os usos ja resgatados.",
    );
  }

  await assertPromotionalCodeAvailable(supabaseAdmin, nextCode, {
    currentLinkId: link?.id ?? null,
    currentPromoCodeId: existingPromo?.id ?? null,
  });

  if (!link) {
    const { data: createdLink, error: linkError } = await supabaseAdmin
      .from("affiliate_links")
      .insert({
        seller_id: sellerId,
        code: nextCode,
        status,
        created_by: caller.user.id,
        updated_by: caller.user.id,
      })
      .select(LINK_SELECT_FIELDS)
      .single();

    if (linkError) throw linkError;
    link = createdLink as AffiliateLinkRow;
  } else if (link.code !== nextCode || link.status !== status) {
    const { data: updatedLink, error: linkUpdateError } = await supabaseAdmin
      .from("affiliate_links")
      .update({
        code: nextCode,
        status,
        updated_by: caller.user.id,
      })
      .eq("id", link.id)
      .select(LINK_SELECT_FIELDS)
      .single();

    if (linkUpdateError) throw linkUpdateError;
    link = updatedLink as AffiliateLinkRow;
  }

  if (existingPromo) {
    const { data: promo, error: promoError } = await supabaseAdmin
      .from("billing_promotional_codes")
      .update({
        seller_id: sellerId,
        code: nextCode,
        discount_bps: discountBps,
        commission_bps: commissionBps,
        max_uses: maxUses,
        valid_until: validUntil,
        status,
        updated_by: caller.user.id,
        metadata: {
          ...(existingPromo.metadata || {}),
          origin: "affiliate-admin",
          kind: "seller",
        },
      })
      .eq("id", existingPromo.id)
      .select(PROMO_SELECT_FIELDS)
      .single();

    if (promoError) throw promoError;
    return { link, promo: promo as PromotionalCodeRow };
  }

  const { data: promo, error: promoError } = await supabaseAdmin
    .from("billing_promotional_codes")
    .insert({
      affiliate_link_id: link.id,
      seller_id: sellerId,
      code: nextCode,
      discount_bps: discountBps,
      commission_bps: commissionBps,
      duration: "first_month",
      max_uses: maxUses,
      valid_until: validUntil,
      status,
      created_by: caller.user.id,
      updated_by: caller.user.id,
      metadata: {
        origin: "affiliate-admin",
        kind: "seller",
      },
    })
    .select(PROMO_SELECT_FIELDS)
    .single();

  if (promoError) throw promoError;
  return { link, promo: promo as PromotionalCodeRow };
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
  const promosBySellerId = await getPromosBySellerIds(
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
          promosBySellerId.get(seller.id),
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

function normalizeBpsFromPayload(
  payload: any,
  bpsField: string,
  percentField: string,
  options: { defaultValue: number; allowZero?: boolean; fieldName: string },
) {
  if (payload?.[bpsField] !== undefined && payload?.[bpsField] !== null) {
    return normalizeBps(payload[bpsField], options);
  }

  if (payload?.[percentField] !== undefined && payload?.[percentField] !== null) {
    const percent = Number(payload[percentField]);
    return normalizeBps(
      Number.isFinite(percent) ? Math.round(percent * 100) : payload[percentField],
      options,
    );
  }

  return normalizeBps(options.defaultValue, options);
}

async function listPromotionalCodes(supabaseAdmin: any, payload: any) {
  const page = normalizePage(payload?.page);
  const pageSize = normalizePageSize(payload?.pageSize);
  const status = normalizePromoStatus(payload?.status, { optional: true });
  const sellerId = validateOptionalSellerId(payload?.sellerId);
  const search = normalizeSearch(payload?.search);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from("billing_promotional_codes")
    .select(PROMO_SELECT_FIELDS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status) query = query.eq("status", status);
  if (sellerId) query = query.eq("seller_id", sellerId);
  if (search) query = query.ilike("code", `%${search}%`);

  const { data: promos, error, count } = await query;
  if (error) throw error;

  return jsonResponse({
    success: true,
    data: {
      promotionalCodes: (promos || []).map(mapPromotionalCode),
      page,
      pageSize,
      total: count ?? 0,
    },
  });
}

async function createPromotionalCode(
  supabaseAdmin: any,
  caller: Caller,
  payload: any,
) {
  const code = normalizePromoCode(payload?.code);
  const sellerId = validateOptionalSellerId(payload?.sellerId);
  const status = normalizePromoStatus(payload?.status || "active");
  const discountBps = normalizeBpsFromPayload(
    payload,
    "discountBps",
    "discountPercent",
    { defaultValue: 1000, fieldName: "Desconto" },
  );
  const commissionBps = sellerId
    ? normalizeBpsFromPayload(payload, "commissionBps", "commissionPercent", {
      defaultValue: 1000,
      allowZero: true,
      fieldName: "Comissao",
    })
    : 0;
  const maxUses = normalizeMaxUses(payload?.maxUses);
  const validUntil = normalizeValidUntil(payload?.validUntil);

  if (sellerId) {
    const { link, promo } = await ensureSellerPromotionalCode(
      supabaseAdmin,
      caller,
      { sellerId, code, discountBps, commissionBps, maxUses, validUntil, status },
    );

    return jsonResponse({
      success: true,
      data: { link: mapLink(link), promotionalCode: mapPromotionalCode(promo) },
    });
  }

  const { data: promo, error } = await supabaseAdmin
    .from("billing_promotional_codes")
    .insert({
      code,
      discount_bps: discountBps,
      commission_bps: 0,
      duration: "first_month",
      max_uses: maxUses,
      valid_until: validUntil,
      status,
      created_by: caller.user.id,
      updated_by: caller.user.id,
      metadata: {
        origin: "affiliate-admin",
        kind: "campaign",
      },
    })
    .select(PROMO_SELECT_FIELDS)
    .single();

  if (error) throw error;

  return jsonResponse({
    success: true,
    data: { promotionalCode: mapPromotionalCode(promo) },
  });
}

async function updatePromotionalCode(
  supabaseAdmin: any,
  caller: Caller,
  payload: any,
) {
  const promoCodeId = validatePromoCodeId(payload?.promoCodeId);

  const { data: existingPromoData, error: existingError } = await supabaseAdmin
    .from("billing_promotional_codes")
    .select(PROMO_SELECT_FIELDS)
    .eq("id", promoCodeId)
    .maybeSingle();

  if (existingError) throw existingError;
  const existingPromo = existingPromoData as PromotionalCodeRow | null;

  if (!existingPromo) {
    throw new HttpError(
      404,
      "AFFILIATE_PROMO_NOT_FOUND",
      "Codigo promocional nao encontrado.",
    );
  }

  const code = payload?.code === undefined
    ? existingPromo.code
    : normalizePromoCode(payload?.code);
  const status = payload?.status === undefined
    ? existingPromo.status
    : normalizePromoStatus(payload?.status);
  const discountBps = payload?.discountBps === undefined &&
      payload?.discountPercent === undefined
    ? existingPromo.discount_bps
    : normalizeBpsFromPayload(payload, "discountBps", "discountPercent", {
      defaultValue: existingPromo.discount_bps,
      fieldName: "Desconto",
    });
  const maxUses = payload?.maxUses === undefined
    ? existingPromo.max_uses
    : normalizeMaxUses(payload?.maxUses);
  const validUntil = payload?.validUntil === undefined
    ? existingPromo.valid_until
    : normalizeValidUntil(payload?.validUntil);

  if (existingPromo.seller_id) {
    const commissionBps = payload?.commissionBps === undefined &&
        payload?.commissionPercent === undefined
      ? existingPromo.commission_bps
      : normalizeBpsFromPayload(payload, "commissionBps", "commissionPercent", {
        defaultValue: existingPromo.commission_bps,
        allowZero: true,
        fieldName: "Comissao",
      });
    const { link, promo } = await ensureSellerPromotionalCode(
      supabaseAdmin,
      caller,
      {
        sellerId: existingPromo.seller_id,
        code,
        discountBps,
        commissionBps,
        maxUses,
        validUntil,
        status,
      },
    );

    return jsonResponse({
      success: true,
      data: { link: mapLink(link), promotionalCode: mapPromotionalCode(promo) },
    });
  }

  const { data: promo, error } = await supabaseAdmin
    .from("billing_promotional_codes")
    .update({
      code,
      discount_bps: discountBps,
      commission_bps: 0,
      max_uses: maxUses,
      valid_until: validUntil,
      status,
      updated_by: caller.user.id,
      metadata: {
        ...(existingPromo.metadata || {}),
        origin: "affiliate-admin",
        kind: "campaign",
      },
    })
    .eq("id", existingPromo.id)
    .select(PROMO_SELECT_FIELDS)
    .single();

  if (error) throw error;

  return jsonResponse({
    success: true,
    data: { promotionalCode: mapPromotionalCode(promo) },
  });
}

async function getOrCreateSellerPromotionalCode(
  supabaseAdmin: any,
  caller: Caller,
  payload: any,
) {
  const sellerId = validateSellerId(payload?.sellerId);
  const requestedCode = payload?.code ? normalizePromoCode(payload?.code) : "";
  const discountBps = normalizeBpsFromPayload(
    payload,
    "discountBps",
    "discountPercent",
    { defaultValue: 1000, fieldName: "Desconto" },
  );
  const commissionBps = normalizeBpsFromPayload(
    payload,
    "commissionBps",
    "commissionPercent",
    { defaultValue: 1000, allowZero: true, fieldName: "Comissao" },
  );
  const maxUses = normalizeMaxUses(payload?.maxUses);
  const validUntil = normalizeValidUntil(payload?.validUntil);
  const status = normalizePromoStatus(payload?.status || "active");
  const { link, promo } = await ensureSellerPromotionalCode(
    supabaseAdmin,
    caller,
    {
      sellerId,
      code: requestedCode || undefined,
      discountBps,
      commissionBps,
      maxUses,
      validUntil,
      status,
    },
  );

  return jsonResponse({
    success: true,
    data: { link: mapLink(link), promotionalCode: mapPromotionalCode(promo) },
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
    const { link, promo } = await ensureSellerPromotionalCode(
      supabaseAdmin,
      caller,
      { sellerId, code: existingLink.code },
    );

    return jsonResponse({
      success: true,
      data: {
        link: mapLink(link),
        promotionalCode: mapPromotionalCode(promo),
      },
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
      const { promo } = await ensureSellerPromotionalCode(
        supabaseAdmin,
        caller,
        { sellerId, code: link.code },
      );

      return jsonResponse({
        success: true,
        data: {
          link: mapLink(link),
          promotionalCode: mapPromotionalCode(promo),
        },
      });
    }

    if (
      isUniqueViolation(error) &&
      String(error?.message || "").includes("affiliate_links_seller_id_uidx")
    ) {
      const concurrentLink = await findSellerLink(supabaseAdmin, sellerId);
      if (concurrentLink) {
        const { link, promo } = await ensureSellerPromotionalCode(
          supabaseAdmin,
          caller,
          { sellerId, code: concurrentLink.code },
        );

        return jsonResponse({
          success: true,
          data: {
            link: mapLink(link),
            promotionalCode: mapPromotionalCode(promo),
          },
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

    if (action === "listPromotionalCodes") {
      return await listPromotionalCodes(supabaseAdmin, payload);
    }

    if (action === "createPromotionalCode") {
      return await createPromotionalCode(supabaseAdmin, caller, payload);
    }

    if (action === "updatePromotionalCode") {
      return await updatePromotionalCode(supabaseAdmin, caller, payload);
    }

    if (action === "getOrCreateSellerPromotionalCode") {
      return await getOrCreateSellerPromotionalCode(
        supabaseAdmin,
        caller,
        payload,
      );
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
