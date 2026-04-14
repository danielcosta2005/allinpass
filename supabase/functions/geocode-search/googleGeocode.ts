export const MAX_GEOCODE_RESULTS = 5;
export const GOOGLE_GEOCODE_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';
export const GOOGLE_GEOCODE_TIMEOUT_MS = 8_000;

export type NormalizedGeocodeResult = {
  id: string;
  placeId: string | null;
  address: string;
  display_name: string;
  formatted_address: string;
  addressShort: string;
  addressFull: string;
  lat: number;
  lng: number;
  long: number;
  partialMatch: boolean;
  partial_match: boolean;
  locationType: string | null;
};

export type GeocodeSuccessResponse = {
  ok: true;
  input: string;
  provider: 'google-geocoding';
  results: NormalizedGeocodeResult[];
};

export type GeocodeErrorResponse = {
  ok: false;
  error: string;
  errorCode: string;
  userMessage: string;
};

type GoogleGeocodeLocation = {
  lat?: unknown;
  lng?: unknown;
};

type GoogleGeocodeGeometry = {
  location?: GoogleGeocodeLocation;
  location_type?: unknown;
};

type GoogleGeocodeResult = {
  place_id?: unknown;
  formatted_address?: unknown;
  partial_match?: unknown;
  geometry?: GoogleGeocodeGeometry;
};

type GoogleGeocodePayload = {
  status?: unknown;
  error_message?: unknown;
  results?: unknown;
};

const STATUS_MESSAGES: Record<string, string> = {
  INVALID_REQUEST: 'Digite um endereco mais completo para buscar a localizacao.',
  OVER_DAILY_LIMIT: 'A cota diaria do servico de mapas foi atingida.',
  OVER_QUERY_LIMIT: 'O limite de consultas do servico de mapas foi atingido. Tente novamente em instantes.',
  REQUEST_DENIED: 'A busca de enderecos nao esta autorizada no momento.',
  UNKNOWN_ERROR: 'O servico de mapas falhou temporariamente. Tente novamente.',
};

const STATUS_HTTP_CODES: Record<string, number> = {
  INVALID_REQUEST: 400,
  OVER_DAILY_LIMIT: 429,
  OVER_QUERY_LIMIT: 429,
  REQUEST_DENIED: 403,
  UNKNOWN_ERROR: 502,
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hashString(value: string): string {
  let hash = 5381;
  for (const character of value) {
    hash = ((hash << 5) + hash) + character.charCodeAt(0);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function clampGeocodeLimit(value: unknown): number {
  const parsed = toNumber(value);
  if (parsed == null) return MAX_GEOCODE_RESULTS;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_GEOCODE_RESULTS);
}

export function buildGoogleGeocodeUrl(address: string, apiKey: string): string {
  const url = new URL(GOOGLE_GEOCODE_ENDPOINT);
  url.searchParams.set('address', address);
  url.searchParams.set('language', 'pt-BR');
  url.searchParams.set('region', 'BR');
  url.searchParams.set('key', apiKey);
  return url.toString();
}

function normalizeResult(result: GoogleGeocodeResult, index: number): NormalizedGeocodeResult | null {
  const formattedAddress = cleanString(result.formatted_address) ?? '';
  const lat = toNumber(result.geometry?.location?.lat);
  const lng = toNumber(result.geometry?.location?.lng);

  if (!formattedAddress || lat == null || lng == null) {
    return null;
  }

  const placeId = cleanString(result.place_id);
  const fallbackSource = `${formattedAddress}:${lat}:${lng}:${index}`;
  const id = placeId ?? `google-${hashString(fallbackSource)}`;
  const partialMatch = result.partial_match === true;
  const locationType = cleanString(result.geometry?.location_type);

  return {
    id,
    placeId,
    address: formattedAddress,
    display_name: formattedAddress,
    formatted_address: formattedAddress,
    addressShort: formattedAddress,
    addressFull: formattedAddress,
    lat,
    lng,
    long: lng,
    partialMatch,
    partial_match: partialMatch,
    locationType,
  };
}

export function normalizeGoogleGeocodeResponse(
  payload: unknown,
  input: string,
  limit: number,
): GeocodeSuccessResponse | ({ ok: false; httpStatus: number } & GeocodeErrorResponse) {
  const parsed = (payload && typeof payload === 'object' ? payload : {}) as GoogleGeocodePayload;
  const status = cleanString(parsed.status) ?? 'UNKNOWN_ERROR';

  if (status === 'ZERO_RESULTS') {
    return {
      ok: true,
      input,
      provider: 'google-geocoding',
      results: [],
    };
  }

  if (status !== 'OK') {
    const providerMessage = cleanString(parsed.error_message);
    return {
      ok: false,
      httpStatus: STATUS_HTTP_CODES[status] ?? 502,
      error: providerMessage ?? `google_geocode_${status.toLowerCase()}`,
      errorCode: status,
      userMessage: STATUS_MESSAGES[status] ?? 'Nao foi possivel consultar o servico de mapas agora.',
    };
  }

  const rawResults = Array.isArray(parsed.results) ? parsed.results as GoogleGeocodeResult[] : [];
  const results = rawResults
    .map((result, index) => normalizeResult(result, index))
    .filter((result): result is NormalizedGeocodeResult => Boolean(result))
    .slice(0, limit);

  return {
    ok: true,
    input,
    provider: 'google-geocoding',
    results,
  };
}