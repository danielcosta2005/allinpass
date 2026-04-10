const { createClient } = require("@supabase/supabase-js");
const { getOptionalEnv, getRequiredEnv, initTestEnv } = require("./env.js");

initTestEnv();

function resolveFunctionUrl(functionName, searchParams) {
  const { supabaseUrl } = getRequiredEnv();
  const url = new URL(
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}`,
  );

  if (searchParams && typeof searchParams === "object") {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function createAnonClient() {
  const { supabaseUrl, supabaseAnonKey } = getRequiredEnv();
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function createServiceRoleClient() {
  const { supabaseUrl } = getRequiredEnv();
  const { supabaseServiceRoleKey } = getOptionalEnv();
  if (!supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function signInWithPassword(email, password) {
  const client = createAnonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Falha no login de teste (${email}): ${error.message}`);
  }

  const accessToken = data?.session?.access_token;
  if (!accessToken) {
    throw new Error(`Sessão sem access_token para o usuário ${email}.`);
  }

  return {
    client,
    user: data.user,
    session: data.session,
    accessToken,
  };
}

async function invokeEdgeFunction(
  functionName,
  {
    method = "POST",
    body,
    rawBody,
    accessToken,
    headers = {},
    searchParams,
    redirect = "follow",
  } = {},
) {
  const { supabaseAnonKey } = getRequiredEnv();
  const url = resolveFunctionUrl(functionName, searchParams);

  const requestHeaders = {
    apikey: supabaseAnonKey,
    ...headers,
  };

  if (!requestHeaders.Authorization) {
    requestHeaders.Authorization = accessToken
      ? `Bearer ${accessToken}`
      : `Bearer ${supabaseAnonKey}`;
  }

  let payload = undefined;
  const upperMethod = String(method).toUpperCase();

  if (rawBody !== undefined) {
    payload = rawBody;
  } else if (body !== undefined && upperMethod !== "GET" && upperMethod !== "HEAD") {
    if (!requestHeaders["Content-Type"]) {
      requestHeaders["Content-Type"] = "application/json";
    }
    payload = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method: upperMethod,
    headers: requestHeaders,
    body: payload,
    redirect,
  });

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return {
    url,
    response,
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    text,
    body: json,
  };
}

module.exports = {
  createAnonClient,
  createServiceRoleClient,
  signInWithPassword,
  invokeEdgeFunction,
};
