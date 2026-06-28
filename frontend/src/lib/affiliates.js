import { supabase } from '@/lib/supabaseClient';
import { AFFILIATE_DISCOUNT_BPS, normalizeAffiliateRef } from '@/lib/subscriptionPlans';

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

function mapSeller(seller = {}) {
  return {
    id: seller.id,
    name: seller.name,
    contact: seller.contact,
    pixKey: seller.pixKey ?? seller.pix_key,
    status: seller.status,
    createdAt: seller.createdAt ?? seller.created_at,
    updatedAt: seller.updatedAt ?? seller.updated_at,
    affiliateLink: mapLink(seller.affiliateLink ?? seller.affiliate_link),
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
  const cleanCode = String(code || '').trim();
  const path = `/?ref=${encodeURIComponent(cleanCode)}#planos`;

  if (typeof window === 'undefined' || !window.location?.origin) {
    return path;
  }

  return `${window.location.origin}${path}`;
}

async function invokeAffiliateAdmin(body) {
  const { data, error } = await supabase.functions.invoke('affiliate-admin', {
    body,
  });

  if (error) {
    console.error('invoke affiliate-admin error:', error);
    throw new Error(error.message || 'Falha ao chamar edge function');
  }

  if (!data || data.error) {
    console.error('edge returned error payload:', data);
    throw new Error(data?.error || 'Edge function retornou resposta invalida');
  }

  return data.data || data;
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

export async function createAffiliateSeller({ name, contact, pixKey }) {
  const data = await invokeAffiliateAdmin({ action: 'createSeller', name, contact, pixKey });

  return mapSeller(data.seller);
}

export async function listAffiliateSellers({ page = 1, pageSize = 25, status = '', search = '' } = {}) {
  const data = await invokeAffiliateAdmin({ action: 'listSellers', page, pageSize, status, search });

  return {
    sellers: Array.isArray(data.sellers) ? data.sellers.map(mapSeller) : [],
    page: data.page || page,
    pageSize: data.pageSize || pageSize,
    total: data.total || 0,
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

export async function updateAffiliateSeller({ sellerId, name, contact, pixKey, status }) {
  const data = await invokeAffiliateAdmin({
    action: 'updateSeller',
    sellerId,
    name,
    contact,
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
