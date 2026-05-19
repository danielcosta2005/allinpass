import { supabase } from '@/lib/supabaseClient';

async function readFunctionError(error) {
  if (error?.context && typeof error.context.clone === 'function') {
    try {
      const payload = await error.context.clone().json();
      if (payload?.error || payload?.message) {
        return {
          message: payload.error || payload.message,
          code: payload.code || null,
        };
      }
    } catch {
      // Fall through to the generic Supabase error.
    }
  }

  return {
    message: error?.message || 'Nao foi possivel finalizar o cadastro.',
    code: error?.code || null,
  };
}

function buildSignupError(message, code = null) {
  const nextError = new Error(message);
  if (code) nextError.code = code;
  return nextError;
}

export async function finalizeFreeTrialSignup({ establishmentName, planCode = 'free_trial' }) {
  const { data, error } = await supabase.functions.invoke('signup-finalize', {
    body: {
      establishmentName,
      planCode,
    },
  });

  if (error) {
    const parsedError = await readFunctionError(error);
    throw buildSignupError(parsedError.message, parsedError.code);
  }

  if (data?.error) {
    throw buildSignupError(data.error, data.code || null);
  }

  return data;
}
