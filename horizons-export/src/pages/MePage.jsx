import React, { useEffect, useState } from 'react';
    import { supabase } from '@/lib/supabaseClient';
    import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
    import { Button } from '@/components/ui/button';
    import { Loader2 } from 'lucide-react';

    export default function MePage() {
      const [search] = useSearchParams();
      const navigate = useNavigate();
      const location = useLocation();
      
      const [projectId, setProjectId] = useState('');
      const [checking, setChecking] = useState(true);
      const [error, setError] = useState(null);

      useEffect(() => {
        let idFromUrl = search.get('projectId') || search.get('p') || '';
        if (!idFromUrl) {
          const match = location.pathname.match(/\/c\/([^/]+)\/me/);
          if (match) {
            idFromUrl = match[1];
          }
        }
        setProjectId(idFromUrl);

        if (!idFromUrl) {
          setError('O identificador do projeto (projectId) não foi encontrado na URL.');
          setChecking(false);
          return;
        }

        const run = async () => {
          setChecking(true);
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) {
            setError('Falha ao obter sessão. Tente novamente.');
            setChecking(false);
            return;
          }

          if (!session) {
            setChecking(false);
            return;
          }

          const sub = session.user?.id;
          if (idFromUrl && sub) {
            navigate(`/c/${idFromUrl}/${sub}`, { replace: true });
          } else {
            setChecking(false);
          }
        };
        run();
      }, [search, location.pathname, navigate]);

      const startGoogleLogin = async () => {
        if (!projectId) {
          setError('O identificador do projeto (projectId) não foi encontrado na URL.');
          return;
        }

        const redirectTo = `https://carteira49.com/auth/callback?projectId=${encodeURIComponent(projectId)}`;

        const { error: oauthError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            scopes: 'openid profile email',
          },
        });
        if (oauthError) setError(oauthError.message);
      };

      if (checking) {
        return (
          <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
            <div className="text-center space-y-4">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="text-gray-600">Verificando sessão...</p>
            </div>
          </div>
        );
      }
      
      if (!projectId) {
         return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-pink-50 p-4">
                <div className="p-8 bg-white rounded-2xl shadow-xl max-w-md mx-auto text-center space-y-6 border border-red-200">
                    <h1 className="text-2xl font-bold text-red-700">Erro de Configuração</h1>
                    <p className="text-gray-600">O identificador do projeto (projectId) não foi encontrado na URL. Verifique o link e tente novamente.</p>
                </div>
            </div>
        );
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-indigo-50 to-pink-50 p-4">
            <div className="p-8 bg-white rounded-2xl shadow-xl max-w-md mx-auto text-center space-y-6 border border-gray-200">
                <h1 className="text-2xl font-bold text-gray-800">Adicionar à sua Carteira Digital</h1>
                <p className="text-gray-600">Para resgatar seu cartão de fidelidade, precisamos que você faça login de forma segura.</p>

                {error && <p className="text-red-600 bg-red-100 p-3 rounded-md">{error}</p>}

                <Button
                    onClick={startGoogleLogin}
                    className="w-full rounded-lg py-3 bg-black text-white font-semibold hover:bg-gray-800 transition-colors text-base flex items-center justify-center gap-2"
                    disabled={!projectId}
                >
                    <svg className="w-5 h-5" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512"><path fill="currentColor" d="M488 261.8C488 403.3 381.5 512 244 512 109.8 512 0 402.2 0 256S109.8 0 244 0c73.2 0 141.1 28.5 192.3 75.8L388.9 128C350.3 93.2 300.7 72 244 72c-94.2 0-170.8 76.5-170.8 170.8s76.5 170.8 170.8 170.8c58.8 0 109.5-29.4 139.7-74.8a152.3 152.3 0 0 0-7.3-130.2h-132.3v-84.3h245.3c1.7 13.6 2.7 27.6 2.7 42.5z"></path></svg>
                    Continuar com Google
                </Button>
                <p className="text-xs text-gray-500">Ao continuar, você concorda com nossos Termos de Serviço.</p>
            </div>
        </div>
      );
    }