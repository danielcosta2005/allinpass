import { supabase } from '@/lib/supabaseClient';

export async function invokeAdmin(functionName, payload, returnFullResponse = false) {
  if (!returnFullResponse) {
    const { data, error: functionError } = await supabase.functions.invoke(functionName, {
      body: payload,
    });
    if (functionError) {
      return { data: null, error: { message: functionError.message } };
    }
    return { data, error: data?.error ? { message: data.error } : null };
  }

  try {
    const response = await supabase.functions.invoke(functionName, { body: payload });
    // Check for network/CORS error indicated by lack of response object
    if (!response.error && !response.data) {
       throw new TypeError('Failed to fetch');
    }
    return { ...response, error: response.error ? { message: response.error.message } : null };
  } catch (e) {
    console.error("invokeAdmin Network/CORS Error:", e);
    const errorMessage = (e instanceof TypeError && e.message === 'Failed to fetch')
      ? 'Erro de rede ou CORS. Verifique a conexão e as configurações da função no Supabase.'
      : e.message || 'Erro de rede desconhecido.';
      
    if (e.context) {
       return { data: null, error: { ...e.context, message: errorMessage }, response: e.context.response };
    }
    
    return { data: null, error: { message: errorMessage }, response: null };
  }
}