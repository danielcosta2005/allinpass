/// <reference types="https://deno.land/x/deno/cli/types/dts/index.d.ts" />
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  buildGoogleGeocodeUrl,
  clampGeocodeLimit,
  GOOGLE_GEOCODE_TIMEOUT_MS,
  normalizeGoogleGeocodeResponse,
} from './googleGeocode.ts';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed', errorCode: 'METHOD_NOT_ALLOWED' });

  try {
    const body = await req.json().catch(() => ({}));
    const address = cleanString(body?.address);
    const limit = clampGeocodeLimit(body?.limit);

    if (!address) {
      return json(400, {
        ok: false,
        error: 'address is required',
        errorCode: 'INVALID_REQUEST',
        userMessage: 'Digite um endereco para buscar as coordenadas.',
      });
    }

    // Fallback aceito so para nao bloquear ambientes antigos; em producao use a chave server-side dedicada.
    const apiKey = cleanString(Deno.env.get('GOOGLE_MAPS_SERVER_KEY'))
      ?? cleanString(Deno.env.get('VITE_GOOGLE_MAPS_KEY'));

    if (!apiKey) {
      return json(500, {
        ok: false,
        error: 'missing_google_maps_api_key',
        errorCode: 'MISSING_API_KEY',
        userMessage: 'A busca de enderecos nao esta configurada no servidor.',
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GOOGLE_GEOCODE_TIMEOUT_MS);

    try {
      const response = await fetch(buildGoogleGeocodeUrl(address, apiKey), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const details = await response.text().catch(() => '');
        return json(502, {
          ok: false,
          error: `provider_error_http_${response.status}`,
          errorCode: 'PROVIDER_HTTP_ERROR',
          userMessage: 'O servico de mapas nao respondeu corretamente.',
          details: details.slice(0, 300),
        });
      }

      const payload = await response.json().catch(() => null);
      const normalized = normalizeGoogleGeocodeResponse(payload, address, limit);

      if (!normalized.ok) {
        return json(normalized.httpStatus, normalized);
      }

      return json(200, normalized);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return json(504, {
          ok: false,
          error: 'provider_timeout',
          errorCode: 'TIMEOUT',
          userMessage: 'A busca demorou mais do que o esperado. Tente novamente.',
        });
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('geocode-search failed', message);
    return json(500, {
      ok: false,
      error: message,
      errorCode: 'INTERNAL_ERROR',
      userMessage: 'Nao foi possivel buscar o endereco agora.',
    });
  }
});