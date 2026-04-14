import React, { useMemo } from "react";
import { useLocation, Link } from "react-router-dom";

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

export default function ClaimThanks() {
  const loc = useLocation();
  const c = useMemo(() => getSearchParam(loc.search, "c"), [loc.search]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border shadow p-6 text-center">
        <h1 className="text-xl font-semibold">Obrigado! 🎉</h1>
        <p className="text-sm text-gray-600 mt-2">
          Se você concluiu a adição, seu passe já está na sua carteira.
        </p>

        <div className="mt-5 space-y-3">
          <p className="text-xs text-gray-500 mt-2">
            Dica: no iPhone, procure em “Carteira”. No Android, em “Google Wallet”.
          </p>
        </div>
      </div>
    </div>
  );
}
