import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Loader2 } from 'lucide-react';

function getCFromUrl() {
  const u = new URL(window.location.href);
  return u.searchParams.get('c');
}

function pickDisplayName(user) {
  const m = user?.user_metadata || {};
  return (
    m.full_name ||
    m.name ||
    [m.given_name, m.family_name].filter(Boolean).join(' ') ||
    ''
  );
}

function getGoogleSub(user) {
  const identities = user?.identities || [];
  const google = identities.find((i) => i.provider === 'google');
  return (
    google?.identity_data?.sub ||
    google?.id ||
    user?.user_metadata?.sub ||
    user?.app_metadata?.provider_id ||
    null
  );
}

function isIOSUA(ua) {
  return /iPhone|iPad|iPod/i.test(ua || '');
}

function looksLikePkPass(url) {
  if (!url) return false;
  return /\.pkpass(\?|$)/i.test(url) || /pkpass/i.test(url);
}

export default function ClaimCallback() {
  const [error, setError] = useState(null);
  const [destination, setDestination] = useState(null);
  const [needsUserTap, setNeedsUserTap] = useState(false);

  const ua = useMemo(() => navigator.userAgent, []);

  useEffect(() => {
    let unsub = null;

    const run = async () => {
      const c = getCFromUrl();
      if (!c) {
        setError("Parâmetro 'c' ausente no callback.");
        return;
      }

      let { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        const { data } = supabase.auth.onAuthStateChange(async (event, newSession) => {
          if (event === 'SIGNED_IN' && newSession?.access_token) {
            data.subscription.unsubscribe();
            await continueFlow(c);
          }
        });
        unsub = data.subscription;
        return;
      }

      await continueFlow(c);
    };

    const continueFlow = async (c) => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL não definido.');

        const { data: { session }, error: sessErr } = await supabase.auth.getSession();
        if (sessErr) throw new Error(sessErr.message || 'Falha ao obter sessão.');
        if (!session?.access_token) throw new Error('Sessão ausente após OAuth.');

        // 1) Chama universal-link em JSON
        const url =
          `${supabaseUrl}/functions/v1/universal-link?c=${encodeURIComponent(c)}&mode=json`;

        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            Accept: 'application/json',
          },
        });

        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}

        if (!res.ok) {
          const msg = json?.message || json?.error || `HTTP ${res.status} ao chamar universal-link`;
          throw new Error(`${msg}. Body=${text || ''}`);
        }

        const dest = json?.destination;
        const passToken = json?.passToken;

        if (!dest || typeof dest !== 'string') {
          throw new Error(`universal-link não retornou 'destination'. Body=${text || ''}`);
        }
        if (!passToken || typeof passToken !== 'string') {
          throw new Error(`universal-link não retornou 'passToken'. Body=${text || ''}`);
        }

        // 2) Salva nome + email (+ google_sub obrigatório pro seu schema/triggers)
        const user = session.user;
        const name = pickDisplayName(user) || null;
        const email = user?.email || null;
        const googleSub = getGoogleSub(user);

        if (!googleSub) {
          throw new Error(
            'Não consegui extrair o google_sub do Google OAuth. ' +
            'Sem isso não dá pra sincronizar customers (google_sub é NOT NULL).'
          );
        }

        const claimPatch = {
          ua,
          claim: {
            name,
            email,
            user_id: user?.id || null,
            google_sub: googleSub,
            claimed_at: new Date().toISOString(),
          }
        };

        const { error: upErr } = await supabase
          .from('user_passes')
          .update({ metadata: claimPatch, user_id: user?.id ?? null })
          .eq('pass_token', passToken);

        if (upErr) {
          throw new Error(`Falha ao salvar metadata em user_passes: ${upErr.message}`);
        }

        // 3) Redireciona (com fallback para Apple)
        setDestination(dest);

        const ios = isIOSUA(ua);
        const pkpass = looksLikePkPass(dest);

        // Em iOS, downloads/Wallet às vezes exigem gesto do usuário.
        if (ios && pkpass) {
          // Tenta automático; se o iOS bloquear, mostramos botão.
          try {
            window.location.assign(dest);
            // Se não navegar (bloqueio), o usuário ainda vê o fallback abaixo.
            setTimeout(() => setNeedsUserTap(true), 900);
          } catch {
            setNeedsUserTap(true);
          }
          return;
        }

        // Para Google (e demais), redirect direto costuma funcionar
        window.location.replace(dest);
      } catch (e) {
        console.error(e);
        setError(e?.message || 'Falha ao concluir o resgate.');
      }
    };

    run();

    return () => {
      if (unsub) unsub.unsubscribe();
    };
  }, [ua]);

  const showAppleTap = needsUserTap && destination;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border shadow p-6 text-center">
        {!error ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <h1 className="text-lg font-semibold">Finalizando cadastro…</h1>
            <p className="text-sm text-gray-600 mt-2">
              Estamos abrindo sua carteira para adicionar o passe.
            </p>

            {showAppleTap && (
              <div className="mt-6">
                <p className="text-sm text-gray-600 mb-3">
                  No iPhone, pode ser necessário tocar para abrir o Apple Wallet.
                </p>

                <a
                  href={destination}
                  className="inline-flex items-center justify-center w-full rounded-full bg-black text-white py-3 font-semibold"
                  rel="noopener noreferrer"
                >
                  Abrir no Apple Wallet
                </a>

                <p className="text-xs text-gray-500 mt-3 break-words">
                  Se não abrir, copie e cole este link no Safari: {destination}
                </p>
              </div>
            )}
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
