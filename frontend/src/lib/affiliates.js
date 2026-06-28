import { supabase } from '@/lib/supabaseClient';

function mapSeller(seller = {}) {
  return {
    id: seller.id,
    name: seller.name,
    contact: seller.contact,
    pixKey: seller.pixKey ?? seller.pix_key,
    status: seller.status,
    createdAt: seller.createdAt ?? seller.created_at,
    updatedAt: seller.updatedAt ?? seller.updated_at,
  };
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
