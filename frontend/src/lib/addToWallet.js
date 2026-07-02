import { supabase } from '@/lib/supabaseClient';
import { buildFunctionError } from '@/lib/functionErrors';

export async function addToWallet(user) {
  const { projectId, googleSub, email, name, platform } = user;

  if (!projectId || !platform || !googleSub || !name || !email) {
    throw new Error("Dados insuficientes para gerar o passe.");
  }

  const { data, error, response } = await supabase.functions.invoke('generate-pass', {
    body: {
      projectId,
      platform,
      googleSub,
      name,
      email,
    },
  });

  if (error) {
    throw await buildFunctionError(error, response, 'Erro ao gerar o passe.');
  }

  if (data.error) {
    throw new Error(`Erro na Edge Function: ${data.error}`);
  }

  if (platform === 'apple') {
    if (!(data instanceof Blob)) {
        throw new Error('A resposta para Apple Wallet não é um arquivo .pkpass válido.');
    }
    return data; 
  } else {
    if (!data.saveUrl) {
      throw new Error('A resposta do Google Wallet não contém uma URL de salvamento.');
    }
    return data;
  }
}
