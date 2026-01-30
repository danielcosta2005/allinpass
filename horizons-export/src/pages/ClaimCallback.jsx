// src/pages/ClaimCallback.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Loader2 } from "lucide-react";

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

function parseHashParams(hash) {
  if (!hash || typeof hash !== "string") return {};
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const out = {};
  for (const part of h.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = eq >= 0 ? part.slice(0, eq) : part;
    const v = eq >= 0 ? part.slice(eq + 1) : "";
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v || "");
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function cleanUrlKeepOnlyC(c) {
  try {
    const u = new URL(window.location.href);
    const pathname = u.pathname;
    window.history.replaceState(
      {},
      document.title,
      `${pathname}?c=${encodeURIComponent(c)}`
    );
  } catch {}
}

// ✅ base62 e device_key persistido no localStorage (evita duplicatas)
function base62Random(len = 24) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function getOrCreateDeviceKey() {
  const KEY = "device_key_v1";
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing && existing.length >= 12) return existing;
    const created = base62Random(24);
    window.localStorage.setItem(KEY, created);
    return created;
  } catch {
    // se localStorage falhar por qualquer motivo, ainda gera um dk (menos ideal, mas funciona)
    return base62Random(24);
  }
}

export default function ClaimCallback() {
  const loc = useLocation();
  const didRun = useRef(false);

  const [phase, setPhase] = useState("Iniciando…");
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState(null);

  const c = useMemo(() => getSearchParam(loc.search, "c"), [loc.search]);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    (async () => {
      try {
        if (!c) throw new Error("Parâmetro ?c=... ausente no callback.");

        const sbUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!sbUrl) throw new Error("VITE_SUPABASE_URL não definido.");

        setPhase("Validando sessão…");

        const sessResp = await withTimeout(supabase.auth.getSession(), 1200);
        let accessToken = sessResp?.data?.session?.access_token || null;

        if (!accessToken) {
          const hp = parseHashParams(window.location.hash || "");
          if (hp.access_token) {
            accessToken = hp.access_token;
            //setWarning(
              //"Sessão não respondeu a tempo; usando token retornado na URL (iPhone)."
            //);
          }
        }

        if (!accessToken) {
          throw new Error(
            "Não consegui obter access_token (nem por sessão, nem pelo hash da URL)."
          );
        }

        setPhase("Estamos abrindo sua carteira…");

        const dk = getOrCreateDeviceKey();

        const url = `${sbUrl}/functions/v1/universal-link?c=${encodeURIComponent(
          c
        )}&mode=json&dk=${encodeURIComponent(dk)}`;

        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            `universal-link falhou (HTTP ${res.status}): ${
              json?.error || json?.message || "sem detalhes"
            }`
          );
        }

        if (!json?.destination) {
          throw new Error("universal-link não retornou destination.");
        }

        cleanUrlKeepOnlyC(c);

        setPhase("Redirecionando…");
        
        const THANKS_URL = `/thanks?c=${encodeURIComponent(c)}`;

        // ✅ Só redireciona para /thanks se a página ficou hidden pelo menos 1x.
        // Isso evita "obrigado antes de abrir o Wallet".
        let sawHidden = false;

        const onVis = () => {
          if (document.hidden) {
            sawHidden = true;
            return;
          }
          // voltamos a ficar visíveis
          if (sawHidden) {
            cleanup();
            window.location.replace(THANKS_URL);
          }
        };

        const onPageHide = () => {
          // Em iOS, pagehide costuma acontecer quando troca de app
          sawHidden = true;
        };

        const cleanup = () => {
          document.removeEventListener("visibilitychange", onVis);
          window.removeEventListener("pagehide", onPageHide);
          window.clearTimeout(fallbackTimer);
        };

        document.addEventListener("visibilitychange", onVis);
        window.addEventListener("pagehide", onPageHide);

        // ✅ Fallback: se o Wallet NÃO abriu (não ficou hidden), espera mais tempo.
        // 4.5s é curto demais no iOS; use 12–15s.
        const fallbackTimer = window.setTimeout(() => {
          cleanup();
          // Só manda pro thanks se ainda estamos visíveis (indicando que não saímos pro Wallet)
          if (!document.hidden) {
            window.location.replace(THANKS_URL);
          }
        }, 15000);

        // Agora sim: tenta abrir o destino (Wallet/pkpass)
        window.location.assign(json.destination);
      } catch (e) {
        setError(e?.message || "Falha ao concluir o resgate.");
      }
    })();
  }, [c]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border shadow p-6 text-center">
        {!error ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <h1 className="text-lg font-semibold">{phase}</h1>
            <p className="text-sm text-gray-600 mt-2">Preparando seu passe.</p>
            {warning ? (
              <div className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 text-left">
                {warning}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-red-600">
              Falha ao concluir o resgate
            </h1>
            <p className="text-sm text-gray-600 mt-2 break-words">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}