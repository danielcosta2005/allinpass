import { supabase } from '@/lib/supabaseClient';

export const AUTH_SESSION_INVALID_EVENT = 'allinpass:auth-session-invalid';
export const AUTH_SESSION_ERROR_CODE = 'AUTH_SESSION_INVALID';

const SESSION_REFRESH_MARGIN_SECONDS = 30;
const AUTH_INVALID_EVENT_THROTTLE_MS = 1500;
const DEFAULT_SESSION_EXPIRED_MESSAGE = 'Sua sessão expirou. Faça login novamente.';

let lastInvalidSessionEventAt = 0;

export class AuthSessionError extends Error {
  constructor(message = DEFAULT_SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = 'AuthSessionError';
    this.code = AUTH_SESSION_ERROR_CODE;
    this.isAuthSessionError = true;
  }
}

export function isAuthSessionError(error) {
  return Boolean(
    error?.isAuthSessionError ||
      error?.code === AUTH_SESSION_ERROR_CODE ||
      error?.name === 'AuthSessionError',
  );
}

function notifyInvalidSession(message = DEFAULT_SESSION_EXPIRED_MESSAGE) {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  if (now - lastInvalidSessionEventAt < AUTH_INVALID_EVENT_THROTTLE_MS) return;
  lastInvalidSessionEventAt = now;

  window.dispatchEvent(
    new CustomEvent(AUTH_SESSION_INVALID_EVENT, {
      detail: { message },
    }),
  );
}

function createInvalidSessionError(message = DEFAULT_SESSION_EXPIRED_MESSAGE) {
  notifyInvalidSession(message);
  return new AuthSessionError(message);
}

async function getFreshSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    throw createInvalidSessionError();
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = Number(session.expires_at || 0);
  const shouldRefresh = expiresAt > 0 && expiresAt <= nowSec + SESSION_REFRESH_MARGIN_SECONDS;

  if (!shouldRefresh) return session;

  const {
    data: { session: refreshedSession },
    error: refreshError,
  } = await supabase.auth.refreshSession(session);

  if (refreshError || !refreshedSession?.access_token) {
    throw createInvalidSessionError();
  }

  return refreshedSession;
}

function getFunctionErrorStatus(error, response) {
  return (
    response?.status ||
    error?.context?.status ||
    error?.status ||
    error?.context?.response?.status ||
    null
  );
}

async function readFunctionErrorPayload(error, response) {
  const source = response || error?.context?.response || error?.context;
  if (!source || typeof source.clone !== 'function') return null;

  try {
    return await source.clone().json();
  } catch (_) {
    try {
      return await source.clone().text();
    } catch {
      return null;
    }
  }
}

function getPayloadMessage(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  return payload.message || payload.error || '';
}

function isInvalidSessionPayload(status, message) {
  const normalizedMessage = String(message || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return (
    status === 401 ||
    normalizedMessage.includes('sessao invalida') ||
    normalizedMessage.includes('missing authorization') ||
    normalizedMessage.includes('invalid jwt') ||
    normalizedMessage.includes('jwt expired') ||
    normalizedMessage.includes('auth session missing')
  );
}

export async function invokeAuthenticatedFunction(functionName, options = {}) {
  const session = await getFreshSession();
  const { headers = {}, ...invokeOptions } = options;

  const { data, error, response } = await supabase.functions.invoke(functionName, {
    ...invokeOptions,
    headers: {
      ...headers,
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    const status = getFunctionErrorStatus(error, response);
    const payload = await readFunctionErrorPayload(error, response);
    const payloadMessage = getPayloadMessage(payload);

    if (isInvalidSessionPayload(status, payloadMessage || error.message)) {
      throw createInvalidSessionError();
    }

    const message = payloadMessage || error.message || `Falha ao chamar ${functionName}.`;
    const normalizedError = new Error(message);
    normalizedError.status = status;
    normalizedError.cause = error;
    throw normalizedError;
  }

  if (data?.error) {
    const message = data.message || data.error;

    if (isInvalidSessionPayload(null, message)) {
      throw createInvalidSessionError();
    }

    throw new Error(message);
  }

  return data;
}
