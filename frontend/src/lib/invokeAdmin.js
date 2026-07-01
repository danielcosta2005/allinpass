import { supabase } from '@/lib/supabaseClient';
import {
  getFunctionErrorCode,
  getFunctionErrorMessage,
  readFunctionErrorPayload,
} from '@/lib/functionErrors';

async function normalizeInvokeError(error, response, fallback = 'Falha ao chamar edge function') {
  const payload = await readFunctionErrorPayload(error, response);
  return {
    message: getFunctionErrorMessage(payload, error?.message || fallback),
    code: getFunctionErrorCode(payload, error?.code || null),
    payload,
  };
}

export async function invokeAdmin(functionName, payload, returnFullResponse = false) {
  if (!returnFullResponse) {
    const { data, error: functionError, response } = await supabase.functions.invoke(functionName, {
      body: payload,
    });
    if (functionError) {
      return { data: null, error: await normalizeInvokeError(functionError, response) };
    }
    return { data, error: data?.error ? { message: data.error } : null };
  }

  try {
    const response = await supabase.functions.invoke(functionName, { body: payload });
    // Check for network/CORS error indicated by lack of response object
    if (!response.error && !response.data) {
       throw new TypeError('Failed to fetch');
    }
    return {
      ...response,
      error: response.error
        ? await normalizeInvokeError(response.error, response.response)
        : null,
    };
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
