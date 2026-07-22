import { supabase } from '@/lib/supabaseClient';
import { AFFILIATE_DISCOUNT_BPS, normalizeAffiliateRef } from '@/lib/subscriptionPlans';

const PROMOTIONAL_CODE_COLLECT_PAGE_SIZE = 50;
const PROMOTIONAL_CODE_COLLECT_MAX_PAGES = 20;

function mapLink(link = null) {
  if (!link) return null;

  return {
    id: link.id,
    sellerId: link.sellerId ?? link.seller_id,
    code: link.code,
    status: link.status,
    createdAt: link.createdAt ?? link.created_at,
    updatedAt: link.updatedAt ?? link.updated_at,
  };
}

function mapPromotionalCode(code = null) {
  if (!code) return null;

  return {
    id: code.id,
    sellerId: code.sellerId ?? code.seller_id,
    affiliateLinkId: code.affiliateLinkId ?? code.affiliate_link_id,
    code: code.code,
    discountBps: code.discountBps ?? code.discount_bps ?? 0,
    commissionBps: code.commissionBps ?? code.commission_bps ?? 0,
    duration: code.duration || 'first_month',
    maxUses: code.maxUses ?? code.max_uses ?? null,
    redeemedUses: code.redeemedUses ?? code.redeemed_uses ?? 0,
    reservedUses: code.reservedUses ?? code.reserved_uses ?? 0,
    validUntil: code.validUntil ?? code.valid_until ?? null,
    status: code.status,
    metadata: code.metadata || {},
    createdAt: code.createdAt ?? code.created_at,
    updatedAt: code.updatedAt ?? code.updated_at,
    seller: code.seller ?? code.affiliate_sellers ?? null,
    affiliateLink: mapLink(code.affiliateLink ?? code.affiliate_link ?? code.affiliate_links),
  };
}

function mapSeller(seller = {}) {
  const summary = seller.summary || {};

  return {
    id: seller.id,
    name: seller.name,
    contact: seller.contact,
    phone: seller.phone,
    email: seller.email,
    pixKey: seller.pixKey ?? seller.pix_key,
    status: seller.status,
    createdAt: seller.createdAt ?? seller.created_at,
    updatedAt: seller.updatedAt ?? seller.updated_at,
    affiliateLink: mapLink(seller.affiliateLink ?? seller.affiliate_link),
    promotionalCode: mapPromotionalCode(seller.promotionalCode ?? seller.promotional_code),
    summary: {
      attributedClientsCount: summary.attributedClientsCount ?? summary.attributed_clients_count ?? 0,
      pendingCommissionCents: summary.pendingCommissionCents ?? summary.pending_commission_cents ?? 0,
      paidCommissionCents: summary.paidCommissionCents ?? summary.paid_commission_cents ?? 0,
      totalCommissionCents: summary.totalCommissionCents ?? summary.total_commission_cents ?? 0,
      pendingCommissionCount: summary.pendingCommissionCount ?? summary.pending_commission_count ?? 0,
      paidCommissionCount: summary.paidCommissionCount ?? summary.paid_commission_count ?? 0,
    },
  };
}

function mapPayout(payout = null) {
  if (!payout) return null;

  return {
    id: payout.id,
    sellerId: payout.sellerId ?? payout.seller_id,
    competenceMonth: payout.competenceMonth ?? payout.competence_month,
    amountCents: payout.amountCents ?? payout.amount_cents,
    commissionCount: payout.commissionCount ?? payout.commission_count,
    currency: payout.currency,
    status: payout.status,
    paymentMethod: payout.paymentMethod ?? payout.payment_method,
    paidAt: payout.paidAt ?? payout.paid_at,
    paidBy: payout.paidBy ?? payout.paid_by,
    note: payout.note,
    metadata: payout.metadata || {},
    createdAt: payout.createdAt ?? payout.created_at,
    updatedAt: payout.updatedAt ?? payout.updated_at,
  };
}

function mapCommission(commission = {}) {
  return {
    id: commission.id,
    attributionId: commission.attributionId ?? commission.attribution_id,
    sellerId: commission.sellerId ?? commission.seller_id,
    linkId: commission.linkId ?? commission.link_id,
    userId: commission.userId ?? commission.user_id,
    projectId: commission.projectId ?? commission.project_id,
    subscriptionId: commission.subscriptionId ?? commission.subscription_id,
    billingCycleId: commission.billingCycleId ?? commission.billing_cycle_id,
    planId: commission.planId ?? commission.plan_id,
    competenceMonth: commission.competenceMonth ?? commission.competence_month,
    paidAt: commission.paidAt ?? commission.paid_at,
    payoutId: commission.payoutId ?? commission.payout_id,
    markedPaidAt: commission.markedPaidAt ?? commission.marked_paid_at,
    markedPaidBy: commission.markedPaidBy ?? commission.marked_paid_by,
    paymentNote: commission.paymentNote ?? commission.payment_note,
    providerPaymentId: commission.providerPaymentId ?? commission.provider_payment_id,
    providerEventId: commission.providerEventId ?? commission.provider_event_id,
    eligibleAmountCents: commission.eligibleAmountCents ?? commission.eligible_amount_cents,
    rateBps: commission.rateBps ?? commission.commission_rate_bps,
    commissionCents: commission.commissionCents ?? commission.commission_cents,
    currency: commission.currency,
    status: commission.status,
    source: commission.source,
    metadata: commission.metadata || {},
    createdAt: commission.createdAt ?? commission.created_at,
    updatedAt: commission.updatedAt ?? commission.updated_at,
    seller: commission.seller ?? commission.affiliate_sellers ?? null,
    project: commission.project ?? commission.projects ?? null,
    subscription: commission.subscription ?? commission.billing_subscriptions ?? null,
    payout: mapPayout(commission.payout ?? commission.affiliate_payouts),
  };
}

function mapCommissionClient(client = {}) {
  const rawCommissions = client.commissions ?? client.affiliate_commissions ?? [];

  return {
    id: client.id,
    sellerId: client.sellerId ?? client.seller_id,
    linkId: client.linkId ?? client.link_id,
    userId: client.userId ?? client.user_id,
    projectId: client.projectId ?? client.project_id,
    subscriptionId: client.subscriptionId ?? client.subscription_id,
    checkoutSessionId: client.checkoutSessionId ?? client.checkout_session_id,
    planId: client.planId ?? client.plan_id,
    sourceCode: client.sourceCode ?? client.source_code,
    status: client.status,
    attributedAt: client.attributedAt ?? client.attributed_at,
    metadata: client.metadata || {},
    createdAt: client.createdAt ?? client.created_at,
    updatedAt: client.updatedAt ?? client.updated_at,
    seller: client.seller ?? client.affiliate_sellers ?? null,
    link: client.link ?? client.affiliate_links ?? null,
    project: client.project ?? client.projects ?? null,
    subscription: client.subscription ?? client.billing_subscriptions ?? null,
    commissions: Array.isArray(rawCommissions) ? rawCommissions.map(mapCommission) : [],
  };
}

export function buildAffiliateLinkUrl(code) {
  return buildPromotionalLinkUrl(code);
}

export function buildPromotionalLinkUrl(code) {
  const cleanCode = String(code || '').trim();
  const path = `/?promo=${encodeURIComponent(cleanCode)}#planos`;

  if (typeof window === 'undefined' || !window.location?.origin) {
    return path;
  }

  return `${window.location.origin}${path}`;
}

async function readAffiliateAdminError(error) {
  if (error?.context && typeof error.context.json === 'function') {
    try {
      const payload = await error.context.json();
      return payload?.error || payload?.message || error.message;
    } catch {
      return error.message || 'Falha ao chamar edge function';
    }
  }

  return error?.message || 'Falha ao chamar edge function';
}

async function invokeAffiliateAdmin(body) {
  const { data, error } = await supabase.functions.invoke('affiliate-admin', {
    body,
  });

  if (error) {
    const message = await readAffiliateAdminError(error);
    console.error('invoke affiliate-admin error:', error);
    throw new Error(message);
  }

  if (!data || data.error) {
    console.error('edge returned error payload:', data);
    throw new Error(data?.error || 'Edge function retornou resposta invalida');
  }

  return data.data || data;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function filterPromotionalCodesByType(promotionalCodes, type) {
  if (type === 'campaign') {
    return promotionalCodes.filter((code) => !code.sellerId);
  }

  if (type === 'seller') {
    return promotionalCodes.filter((code) => Boolean(code.sellerId));
  }

  return promotionalCodes;
}

async function fetchPromotionalCodesPage({
  page,
  pageSize,
  status = '',
  sellerId = '',
  search = '',
}) {
  const data = await invokeAffiliateAdmin({
    action: 'listPromotionalCodes',
    page,
    pageSize,
    status,
    sellerId,
    search,
  });

  return {
    promotionalCodes: Array.isArray(data.promotionalCodes)
      ? data.promotionalCodes.map(mapPromotionalCode)
      : [],
    page: data.page || page,
    pageSize: data.pageSize || pageSize,
    total: data.total || 0,
  };
}

async function fetchAllPromotionalCodesForType({
  type,
  status = '',
  sellerId = '',
  search = '',
}) {
  const collectedPromotionalCodes = [];
  let currentPage = 1;
  let total = 0;

  do {
    const result = await fetchPromotionalCodesPage({
      page: currentPage,
      pageSize: PROMOTIONAL_CODE_COLLECT_PAGE_SIZE,
      status,
      sellerId,
      search,
    });

    collectedPromotionalCodes.push(...result.promotionalCodes);
    total = result.total;

    if (result.promotionalCodes.length === 0 || collectedPromotionalCodes.length >= total) {
      break;
    }

    currentPage += 1;
  } while (currentPage <= PROMOTIONAL_CODE_COLLECT_MAX_PAGES);

  return filterPromotionalCodesByType(collectedPromotionalCodes, type);
}

export async function resolveAffiliateRef(ref) {
  const normalizedRef = normalizeAffiliateRef(ref);

  if (!normalizedRef) {
    return { valid: false, code: '', discountBps: 0 };
  }

  const { data, error } = await supabase.functions.invoke('affiliate-public', {
    body: {
      action: 'resolveAffiliateRef',
      ref: normalizedRef,
    },
  });

  if (error) {
    console.error('invoke affiliate-public error:', error);
    return { valid: false, code: '', discountBps: 0 };
  }

  const response = data?.data || data || {};
  const code = normalizeAffiliateRef(response.code || normalizedRef);
  const valid = Boolean(response.valid) && Boolean(code);

  return {
    valid,
    code: valid ? code : '',
    discountBps: valid ? Number(response.discountBps || AFFILIATE_DISCOUNT_BPS) : 0,
  };
}

export async function createAffiliateSeller({ name, contact, phone, email, pixKey }) {
  const data = await invokeAffiliateAdmin({
    action: 'createSeller',
    name,
    contact,
    phone,
    email,
    pixKey,
  });

  return mapSeller(data.seller);
}

export async function listAffiliateSellers({
  page = 1,
  pageSize = 25,
  status = '',
  search = '',
  includeSummary = false,
  competenceMonth = '',
} = {}) {
  const data = await invokeAffiliateAdmin({
    action: 'listSellers',
    page,
    pageSize,
    status,
    search,
    includeSummary,
    competenceMonth,
  });

  return {
    sellers: Array.isArray(data.sellers) ? data.sellers.map(mapSeller) : [],
    page: data.page || page,
    pageSize: data.pageSize || pageSize,
    total: data.total || 0,
  };
}

export async function listPromotionalCodes({
  page = 1,
  pageSize = 25,
  status = '',
  type = '',
  sellerId = '',
  search = '',
} = {}) {
  const normalizedPage = normalizePositiveInteger(page, 1);
  const normalizedPageSize = normalizePositiveInteger(pageSize, 25);

  if (type === 'campaign' || type === 'seller') {
    const filteredPromotionalCodes = await fetchAllPromotionalCodesForType({
      type,
      status,
      sellerId,
      search,
    });
    const offset = (normalizedPage - 1) * normalizedPageSize;

    return {
      promotionalCodes: filteredPromotionalCodes.slice(offset, offset + normalizedPageSize),
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total: filteredPromotionalCodes.length,
    };
  }

  const data = await fetchPromotionalCodesPage({
    page: normalizedPage,
    pageSize: normalizedPageSize,
    status,
    sellerId,
    search,
  });

  return {
    promotionalCodes: data.promotionalCodes,
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
  };
}

export async function listAffiliateCommissions({
  page = 1,
  pageSize = 25,
  sellerId = '',
  competenceMonth = '',
  status = '',
} = {}) {
  const data = await invokeAffiliateAdmin({
    action: 'listCommissions',
    page,
    pageSize,
    sellerId,
    competenceMonth,
    status,
  });

  return {
    commissions: Array.isArray(data.commissions) ? data.commissions.map(mapCommission) : [],
    page: data.page || page,
    pageSize: data.pageSize || pageSize,
    total: data.total || 0,
  };
}

export async function listAffiliateCommissionClients({ page = 1, pageSize = 25, sellerId = '' } = {}) {
  const data = await invokeAffiliateAdmin({
    action: 'listCommissionClients',
    page,
    pageSize,
    sellerId,
  });

  return {
    clients: Array.isArray(data.clients) ? data.clients.map(mapCommissionClient) : [],
    page: data.page || page,
    pageSize: data.pageSize || pageSize,
    total: data.total || 0,
  };
}

export async function markAffiliateCommissionPaid({ commissionId, note = '' }) {
  const data = await invokeAffiliateAdmin({
    action: 'markCommissionPaid',
    commissionId,
    note,
  });

  return {
    commission: mapCommission(data.commission),
    payout: mapPayout(data.payout),
    alreadyPaid: Boolean(data.alreadyPaid),
  };
}

export async function markAffiliateSellerCompetencePaid({
  sellerId,
  competenceMonth,
  note = '',
}) {
  const data = await invokeAffiliateAdmin({
    action: 'markSellerCompetencePaid',
    sellerId,
    competenceMonth,
    note,
  });

  return {
    commissions: Array.isArray(data.commissions) ? data.commissions.map(mapCommission) : [],
    payout: mapPayout(data.payout),
    updatedCount: data.updatedCount || 0,
    alreadyPaid: Boolean(data.alreadyPaid),
  };
}

export async function updateAffiliateSeller({ sellerId, name, contact, phone, email, pixKey, status }) {
  const data = await invokeAffiliateAdmin({
    action: 'updateSeller',
    sellerId,
    name,
    contact,
    phone,
    email,
    pixKey,
    status,
  });

  return mapSeller(data.seller);
}

export async function getOrCreateAffiliateLink({ sellerId }) {
  const data = await invokeAffiliateAdmin({
    action: 'getOrCreateSellerLink',
    sellerId,
  });

  return mapLink(data.link);
}

export async function createPromotionalCode({
  code,
  sellerId = '',
  discountBps,
  commissionBps = 0,
  status = 'active',
  duration = 'first_month',
  maxUses = null,
  validUntil = null,
  marginWarningAcknowledged = false,
}) {
  const data = await invokeAffiliateAdmin({
    action: 'createPromotionalCode',
    code,
    sellerId,
    discountBps,
    commissionBps,
    status,
    duration,
    maxUses,
    validUntil,
    marginWarningAcknowledged,
  });

  return mapPromotionalCode(data.promotionalCode);
}

export async function updatePromotionalCode({
  promotionalCodeId,
  promoCodeId,
  id,
  code,
  discountBps,
  commissionBps,
  status,
  duration,
  maxUses,
  validUntil,
  marginWarningAcknowledged = false,
}) {
  const data = await invokeAffiliateAdmin({
    action: 'updatePromotionalCode',
    promotionalCodeId: promotionalCodeId || promoCodeId || id,
    code,
    discountBps,
    commissionBps,
    status,
    duration,
    maxUses,
    validUntil,
    marginWarningAcknowledged,
  });

  return mapPromotionalCode(data.promotionalCode);
}

export async function createSellerWithCoupon({
  name,
  contact = '',
  phone = '',
  email = '',
  pixKey,
  coupon = {},
  marginWarningAcknowledged = false,
}) {
  const data = await invokeAffiliateAdmin({
    action: 'createSellerWithCoupon',
    name,
    contact,
    phone,
    email,
    pixKey,
    coupon: {
      ...coupon,
      marginWarningAcknowledged,
    },
    marginWarningAcknowledged,
  });

  return {
    seller: mapSeller({
      ...data.seller,
      promotionalCode: data.promotionalCode,
      affiliateLink: data.link,
    }),
    promotionalCode: mapPromotionalCode(data.promotionalCode),
    link: mapLink(data.link),
  };
}
