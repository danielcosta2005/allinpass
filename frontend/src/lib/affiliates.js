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

export async function createAffiliateSeller({ name, contact, pixKey }) {
  const { data, error } = await supabase.functions.invoke('affiliate-admin', {
    body: { action: 'createSeller', name, contact, pixKey },
  });

  if (error) {
    console.error('invoke affiliate-admin error:', error);
    throw new Error(error.message || 'Falha ao chamar edge function');
  }

  if (!data || data.error) {
    console.error('edge returned error payload:', data);
    throw new Error(data?.error || 'Edge function retornou resposta invalida');
  }

  return mapSeller(data.data?.seller || data.seller);
}
