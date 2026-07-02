const DEFAULT_FUNCTION_ERROR_MESSAGE = 'Nao foi possivel concluir a operacao.';

function canReadResponse(value) {
  return Boolean(value && typeof value.clone === 'function');
}

async function readResponsePayload(response) {
  if (!canReadResponse(response)) return null;

  try {
    return await response.clone().json();
  } catch {
    // Some functions return text/plain error bodies; keep reading below.
  }

  try {
    const text = await response.clone().text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

export async function readFunctionErrorPayload(error, response = null) {
  const context = error?.context;
  const candidates = [];

  if (canReadResponse(response)) candidates.push(response);
  if (error?.context && typeof error.context.clone === 'function') candidates.push(error.context);
  if (context?.response && typeof context.response.clone === 'function') candidates.push(context.response);

  for (const candidate of candidates) {
    const payload = await readResponsePayload(candidate);
    if (payload !== null && payload !== undefined) return payload;
  }

  return null;
}

export function getFunctionErrorMessage(payload, fallback = DEFAULT_FUNCTION_ERROR_MESSAGE) {
  if (typeof payload === 'string') return payload || fallback;
  if (!payload || typeof payload !== 'object') return fallback;

  return payload.error || payload.message || fallback;
}

export function getFunctionErrorCode(payload, fallback = null) {
  if (!payload || typeof payload !== 'object') return fallback;
  return payload.code || fallback;
}

export function getFunctionErrorStatus(error, response = null) {
  return (
    response?.status ||
    error?.context?.status ||
    error?.status ||
    error?.context?.response?.status ||
    null
  );
}

export async function normalizeFunctionError(
  error,
  response = null,
  fallback = DEFAULT_FUNCTION_ERROR_MESSAGE,
) {
  const payload = await readFunctionErrorPayload(error, response);
  const message = getFunctionErrorMessage(payload, error?.message || fallback);

  return {
    message,
    error: message,
    code: getFunctionErrorCode(payload, error?.code || null),
    status: getFunctionErrorStatus(error, response),
    payload,
  };
}

export async function buildFunctionError(error, response = null, fallback = DEFAULT_FUNCTION_ERROR_MESSAGE) {
  const normalized = await normalizeFunctionError(error, response, fallback);
  const nextError = new Error(normalized.message || fallback);
  nextError.code = normalized.code;
  nextError.status = normalized.status;
  nextError.payload = normalized.payload;
  nextError.cause = error;
  return nextError;
}
