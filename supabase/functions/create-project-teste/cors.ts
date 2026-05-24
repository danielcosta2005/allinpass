export function corsHeaders(origin: string | null) {
  // Para dev: aceita qualquer origin.
  // Se quiser travar depois, substitua por whitelist.
  const o = origin ?? "*";

  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}
