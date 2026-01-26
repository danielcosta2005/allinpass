import React, { useEffect, useState } from 'react';
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

export default function ClaimCallback() {
  const [error, setError] = useState(null);

  useEffect(() => {
    let unsub = null;

    const run = async () => {
      const c = getCFromUrl();
      if (!c) {
        setError("Parâmetro 'c' ausente no callback.");
        return;
      }

      // 1) Garantir sessão (OAuth acabou de acontecer)
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

        // Pegue sessão "fresca" aqui (garante user + identities)
        const { data: { session }, error: sessErr } = await supabase.auth.getSession();
        if (sessErr) throw new Error(sessErr.message || 'Falha ao obter sessão.');
        if (!session?.access_token) throw new Error('Sessão ausente após OAuth.');

        // 2) Pede destination + passToken no modo JSON
        const url =
          `${supabaseUrl}/functions/v1/universal-teste?c=${encodeURIComponent(c)}&mode=json`;

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

        const destination = json?.destination;
        const passToken = json?.passToken;

        if (!destination || typeof destination !== 'string') {
          throw new Error(`universal-link não retornou 'destination'. Body=${text || ''}`);
        }

        // 3) Salvar SOMENTE nome + email (e google_sub obrigatório pro teu schema)
        //    -> em user_passes.metadata.claim
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

        if (!passToken || typeof passToken !== 'string') {
          // Se o universal-teste não retornar passToken, não temos como endereçar o user_passes com segurança.
          throw new Error(
            `universal-link não retornou 'passToken'. Body=${text || ''}`
          );
        }

        const claimPatch = {
          ua: navigator.userAgent,
          claim: {
            name,
            email,
            user_id: user?.id || null,
            google_sub: googleSub,
            claimed_at: new Date().toISOString(),
          },
        };

        // Atualiza apenas a linha do token (não mexe em nada do resto)
        // Se metadata já existir, você pode preferir mesclar (RPC). Aqui é o update simples.
        const { error: upErr } = await supabase
          .from('user_passes')
          .update({ metadata: claimPatch, user_id: user?.id ?? null })
          .eq('pass_token', passToken);

        if (upErr) {
          throw new Error(`Falha ao salvar metadata em user_passes: ${upErr.message}`);
        }

        // 4) Redireciona para carteira
        window.location.replace(destination);
      } catch (e) {
        console.error(e);
        setError(e?.message || 'Falha ao concluir o resgate.');
      }
    };

    run();

    return () => {
      if (unsub) unsub.unsubscribe();
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border shadow p-6 text-center">
        {!error ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <h1 className="text-lg font-semibold">Finalizando autenticação…</h1>
            <p className="text-sm text-gray-600 mt-2">
              Salvando seu nome e email e abrindo sua carteira.
            </p>
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
