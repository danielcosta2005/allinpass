import { invokeAdmin } from './invokeAdmin';

import { supabase } from '@/lib/supabaseClient';

export async function adminCreateMember({ projectId, email, password, role }) {
  const { data, error } = await supabase.functions.invoke('admin-create-member', {
    body: { projectId, email, password, role },
  });

  // ERRO DE INVOKE (401/403/404/500 etc)
  if (error) {
    console.error('invoke admin-create-member error:', error);
    throw new Error(error.message || 'Falha ao chamar edge function');
  }

  // ERRO RETORNADO NO JSON (você retorna { error: ... } em status 400)
  if (!data || data.error) {
    console.error('edge returned error payload:', data);
    throw new Error(data?.error || 'Edge function retornou resposta inválida');
  }

  return data; // { success: true, userId, inviteSent }
}

export async function adminUpdateMember({ memberId, password, projectId, role }) {
  return invokeAdmin('admin-update-member', { memberId, password, projectId, role });
}

export async function adminRemoveMember({ memberId, projectId }) {
  const { data, error } = await supabase.functions.invoke('admin-remove-member', {
    body: { memberId, projectId },
  });

  if (error) {
    console.error('invoke admin-remove-member error:', error);
    throw new Error(error.message || 'Falha ao chamar edge function');
  }

  if (!data || data.error) {
    console.error('edge returned error payload:', data);
    throw new Error(data?.error || 'Edge function retornou resposta inválida');
  }

  return data;
}