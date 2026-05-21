import { supabase } from '@/lib/supabaseClient';

const FINALIZE_DEDUPE_TTL_MS = 60_000;
const pendingFinalizeRequests = new Map();
const completedFinalizeRequests = new Map();

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

function buildFinalizeDedupeKey({ dedupeKey, establishmentName, planCode }) {
  if (dedupeKey) return String(dedupeKey);

  return [
    'free-trial',
    String(planCode || 'free_trial').trim().toLowerCase(),
    String(establishmentName || '').trim().toLowerCase(),
  ].join(':');
}

function readCompletedFinalizeRequest(requestKey) {
  const completed = completedFinalizeRequests.get(requestKey);
  if (!completed) return null;

  if (completed.expiresAt <= Date.now()) {
    completedFinalizeRequests.delete(requestKey);
    return null;
  }

  return completed.data;
}

export async function finalizeFreeTrialSignup({
  establishmentName,
  planCode = 'free_trial',
  dedupeKey = '',
}) {
  const requestKey = buildFinalizeDedupeKey({ dedupeKey, establishmentName, planCode });
  const completed = readCompletedFinalizeRequest(requestKey);

  if (completed) {
    return completed;
  }

  const pending = pendingFinalizeRequests.get(requestKey);
  if (pending) {
    return pending;
  }

  const request = (async () => {
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

    completedFinalizeRequests.set(requestKey, {
      data,
      expiresAt: Date.now() + FINALIZE_DEDUPE_TTL_MS,
    });

    return data;
  })();

  pendingFinalizeRequests.set(requestKey, request);

  try {
    return await request;
  } finally {
    pendingFinalizeRequests.delete(requestKey);
  }
}

export async function precheckFreeTrialSignup({ email, establishmentName, captchaToken = '' }) {
  const { data, error } = await supabase.functions.invoke('signup-precheck', {
    body: {
      email,
      establishmentName,
      captchaToken,
    },
  });

  if (error) {
    const parsedError = await readFunctionError(error);
    throw buildSignupError(parsedError.message, parsedError.code);
  }

  if (data?.error) {
    throw buildSignupError(data.error, data.code || null);
  }

  return {
    canProceed: Boolean(data?.can_proceed),
    code: data?.code || null,
    message: data?.message || null,
    retryAfterSeconds: Number(data?.retry_after_seconds || 0),
  };
}
