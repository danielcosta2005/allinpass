import { supabase } from '@/lib/supabaseClient';

const FINALIZE_DEDUPE_TTL_MS = 60_000;
const pendingFinalizeRequests = new Map();
const completedFinalizeRequests = new Map();
const EXISTING_CUSTOMER_SIGNUP_CONTEXT_KEY = '__allinpass_existing_customer_signup_context_v1';
const EXISTING_CUSTOMER_SIGNUP_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

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
    message: error?.message || 'Não foi possível finalizar o cadastro.',
    code: error?.code || null,
  };
}

function buildSignupError(message, code = null) {
  const nextError = new Error(message);
  if (code) nextError.code = code;
  return nextError;
}

function safeReadExistingCustomerSignupContextRaw() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(EXISTING_CUSTOMER_SIGNUP_CONTEXT_KEY);
  } catch {
    return null;
  }
}

export function clearExistingCustomerSignupContext() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(EXISTING_CUSTOMER_SIGNUP_CONTEXT_KEY);
  } catch {
    // ignore
  }
}

export function readExistingCustomerSignupContext() {
  const raw = safeReadExistingCustomerSignupContextRaw();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const email = String(parsed?.email || '').trim().toLowerCase();
    const establishmentName = String(parsed?.establishmentName || '').trim();
    const planCode = String(parsed?.planCode || 'free_trial').trim().toLowerCase();
    const planKey = String(parsed?.planKey || '').trim().toLowerCase();
    const createdAt = Number(parsed?.createdAt || 0);
    const now = Date.now();
    const expired = !Number.isFinite(createdAt) || createdAt <= 0 || now - createdAt > EXISTING_CUSTOMER_SIGNUP_CONTEXT_TTL_MS;

    if (!email || !establishmentName || expired) {
      clearExistingCustomerSignupContext();
      return null;
    }

    return {
      email,
      establishmentName,
      planCode: planCode || 'free_trial',
      planKey,
      createdAt,
    };
  } catch {
    clearExistingCustomerSignupContext();
    return null;
  }
}

export function rememberExistingCustomerSignupContext({
  email,
  establishmentName,
  planCode = 'free_trial',
  planKey = '',
}) {
  if (typeof window === 'undefined') return;

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedEstablishmentName = String(establishmentName || '').trim();
  const normalizedPlanCode = String(planCode || 'free_trial').trim().toLowerCase();
  const normalizedPlanKey = String(planKey || '').trim().toLowerCase();

  if (!normalizedEmail || !normalizedEstablishmentName) {
    clearExistingCustomerSignupContext();
    return;
  }

  const payload = {
    email: normalizedEmail,
    establishmentName: normalizedEstablishmentName,
    planCode: normalizedPlanCode || 'free_trial',
    planKey: normalizedPlanKey,
    createdAt: Date.now(),
  };

  try {
    window.localStorage.setItem(EXISTING_CUSTOMER_SIGNUP_CONTEXT_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function buildFinalizeDedupeKey({ dedupeKey, establishmentName, planCode, checkoutSessionId }) {
  if (dedupeKey) return String(dedupeKey);

  return [
    'signup-finalize',
    String(planCode || 'free_trial').trim().toLowerCase(),
    String(checkoutSessionId || '').trim(),
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

export async function finalizeSignup({
  establishmentName,
  planCode = 'free_trial',
  checkoutSessionId = '',
  dedupeKey = '',
}) {
  const requestKey = buildFinalizeDedupeKey({
    dedupeKey,
    establishmentName,
    planCode,
    checkoutSessionId,
  });
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
        checkoutSessionId,
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

export async function finalizeFreeTrialSignup({
  establishmentName,
  planCode = 'free_trial',
  dedupeKey = '',
}) {
  return finalizeSignup({
    establishmentName,
    planCode,
    dedupeKey,
  });
}

export async function startPaidSignupCheckout({
  establishmentName,
  planCode,
}) {
  const { data, error } = await supabase.functions.invoke('signup-start-checkout', {
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

  if (!data?.checkout_url) {
    throw buildSignupError('Não foi possível iniciar o checkout do Asaas.');
  }

  return data;
}

export async function getSignupStatus() {
  const { data, error } = await supabase.functions.invoke('signup-status', {
    body: {},
  });

  if (error) {
    const parsedError = await readFunctionError(error);
    throw buildSignupError(parsedError.message, parsedError.code);
  }

  if (data?.error) {
    throw buildSignupError(data.error, data.code || null);
  }

  return {
    success: Boolean(data?.success),
    hasProject: Boolean(data?.has_project),
    projectId: data?.project_id || null,
    signupState: data?.signup_state || 'no_project_no_signup_context',
    planCode: data?.plan_code || null,
    establishmentName: data?.establishment_name || '',
    checkoutStatus: data?.checkout_status || null,
    checkoutSessionId: data?.checkout_session_id || null,
    checkoutUrl: data?.checkout_url || null,
    checkoutExpired: Boolean(data?.checkout_expired),
    expiresAt: data?.expires_at || null,
    paidAt: data?.paid_at || null,
    amountCents: data?.amount_cents ?? null,
    currency: data?.currency || null,
    updatedAt: data?.updated_at || null,
  };
}

export async function sendExistingCustomerSignupLink({
  email,
  emailRedirectTo,
  establishmentName,
  planCode = 'free_trial',
  planKey = '',
}) {
  rememberExistingCustomerSignupContext({ email, establishmentName, planCode, planKey });

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo,
    },
  });

  if (error) {
    clearExistingCustomerSignupContext();
    const parsedError = await readFunctionError(error);
    throw buildSignupError(parsedError.message, parsedError.code);
  }

  return { success: true };
}

export async function precheckFreeTrialSignup({
  email,
  establishmentName,
  planCode = 'free_trial',
  captchaToken = '',
}) {
  const { data, error } = await supabase.functions.invoke('signup-precheck', {
    body: {
      email,
      establishmentName,
      planCode,
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
