// src/pages/ClaimCallback.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function getSearchParam(search, key) {
  if (!search) return null;
  const s = search.startsWith("?") ? search.slice(1) : search;
  const parts = s.split("&").filter(Boolean);
  for (const p of parts) {
    const eq = p.indexOf("=");
    const k = eq >= 0 ? p.slice(0, eq) : p;
    const v = eq >= 0 ? p.slice(eq + 1) : "";
    if (decodeURIComponent(k) === key) return decodeURIComponent(v || "");
  }
  return null;
}

function toDisplayError(err) {
  if (!err) return "Erro desconhecido.";
  if (typeof err === "string") return err;
  if (typeof err?.message === "string") return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function hasAuthCodeInUrl() {
  try {
    const u = new URL(window.location.href);
    // OAuth code costuma vir em query (?code=...)
    if (u.searchParams.get("code")) return true;

    // Alguns fluxos podem vir no hash (#...code=...)
    if (u.hash && u.hash.includes("code=")) return true;

    return false;
  } catch {
    return false;
  }
}

function cleanCallbackUrlKeepOnlyC() {
  // ✅ remove code/state/etc. e mantém só ?c=...
  try {
    const u = new URL(window.location.href);

    const c =
      u.searchParams.get("c") ||
      u.searchParams.get("short_code") ||
      null;

    const newUrl = c
      ? `${u.pathname}?c=${encodeURIComponent(c)}`
      : `${u.pathname}`;

    window.history.replaceState({}, document.title, newUrl);
  } catch {
    // nada
  }
}

async function waitForSession({ timeoutMs = 3500 } = {}) {
  // Espera a sessão existir (resolve casos em que o exchange é async/race)
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data?.session?.access_token) return data.session;
    // pequena pausa
    await new Promise((r) => setTimeout(r, 200));
  }

  // último tiro: tenta via onAuthStateChange por um instante
  return await new Promise((resolve) => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.access_token) {
        data.subscription.unsubscribe();
        resolve(session);
      }
    });

    setTimeout(() => {
      data.subscription.unsubscribe();
      resolve(null);
    }, 1200);
  });
}

export default function ClaimCallback() {
  const nav = useNavigate();
  const loc = useLocation();

  const [status, setStatus] = useState("finalizando autenticação...");
  const [details, setDetails] = useState(null);

  const didRun = useRef(false);

  const shortCode = useMemo(() => {
    return (
      getSearchParam(loc.search, "c") ||
      getSearchParam(loc.search, "short_code") ||
      null
    );
  }, [loc.search]);

  const fullUrl = useMemo(() => {
    try {
      return window.location.href;
    } catch {
      return "";
    }
  }, []);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    (async () => {
      try {
        setStatus("validando retorno do login...");

        if (!shortCode) {
          throw new Error(
            "Faltou o parâmetro ?c=... no callback. O redirectTo do login deve ser /claim/callback?c=SEU_SHORT_CODE."
          );
        }

        // 1) Se houver code, troca por sessão
        const hasCode = hasAuthCodeInUrl();

        if (hasCode) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(fullUrl);
          if (exErr) {
            console.log("[ClaimCallback] exchangeCodeForSession error:", exErr);
            // não limpamos URL aqui — ainda pode precisar do code
          }
        }

        // 2) Aguarda sessão existir
        const session = await waitForSession({ timeoutMs: 4500 });

        if (!session?.access_token) {
          throw new Error(
            "Não foi possível obter a sessão após o login. " +
              "Verifique Redirect URLs no Supabase e no Google, e se cookies estão permitidos."
          );
        }

        // ✅ CRÍTICO: só agora, com sessão confirmada, limpamos o code/state da URL
        // Isso evita: "invalid request: both auth code and access token provided"
        cleanCallbackUrlKeepOnlyC();

        setStatus("sessão ok. gerando destino do passe...");

        // 3) Chama universal-link em modo JSON
        const universalUrl =
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/universal-link` +
          `?c=${encodeURIComponent(shortCode)}&mode=json`;

        const uRes = await fetch(universalUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            Accept: "application/json",
          },
        });

        const uJson = await uRes.json().catch(() => ({}));

        if (!uRes.ok) {
          console.log("[ClaimCallback] universal-link error:", uRes.status, uJson);
          throw new Error(
            `universal-link falhou (HTTP ${uRes.status}): ${
              uJson?.error || uJson?.message || "sem detalhes"
            }`
          );
        }

        const destinationRaw = uJson?.destination || null;
        if (!destinationRaw) {
          throw new Error("universal-link não retornou 'destination'.");
        }

        const destination = String(destinationRaw);

        setStatus("redirecionando para a carteira...");
        setDetails({
          shortCode,
          destinationPreview:
            destination.slice(0, 120) + (destination.length > 120 ? "…" : ""),
          passTokenPreview:
            typeof uJson?.passToken === "string"
              ? uJson.passToken.slice(0, 12) + "…"
              : null,
        });

        window.location.href = destination;
      } catch (e) {
        console.error("[ClaimCallback] FAILED:", e);
        setStatus("não foi possível finalizar. veja detalhes abaixo.");
        setDetails({
          shortCode,
          error: toDisplayError(e),
          url: fullUrl ? fullUrl.slice(0, 300) + (fullUrl.length > 300 ? "…" : "") : null,
          hint:
            "Se o erro citar 'both auth code and access token', o code não foi limpo no momento certo. " +
            "Se citar sessão ausente, verifique Redirect URLs no Supabase/Google.",
        });

        if (shortCode) {
          setTimeout(() => {
            nav(`/claim/${encodeURIComponent(shortCode)}`, { replace: true });
          }, 3500);
        }
      }
    })();
  }, [fullUrl, nav, shortCode]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow p-6">
        <div className="text-lg font-semibold text-gray-900">
          Estamos abrindo sua carteira…
        </div>
        <div className="mt-2 text-sm text-gray-600">{status}</div>

        {details ? (
          <pre className="mt-4 text-xs bg-gray-100 rounded-lg p-3 overflow-auto">
            {JSON.stringify(details, null, 2)}
          </pre>
        ) : null}

        <div className="mt-4 text-xs text-gray-500">
          Se isso ficar preso, normalmente é <b>redirectTo sem ?c=...</b> ou{" "}
          <b>Redirect URLs</b> faltando no Supabase/Google.
        </div>
      </div>
    </div>
  );
}
