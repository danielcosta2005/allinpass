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
