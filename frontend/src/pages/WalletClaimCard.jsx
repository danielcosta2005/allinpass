import React, { useMemo } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Gift, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { motion } from 'framer-motion';

export default function WalletClaimCard() {
  const { c } = useParams();
  const location = useLocation();
  const { toast } = useToast();
  const passDescription = useMemo(() => {
    const searchParams = new URLSearchParams(location.search || '');
    return (searchParams.get('description') || '').trim();
  }, [location.search]);
  const claimTitle = passDescription ? `Resgate seu ${passDescription}` : 'Resgate seu Cartão de benefícios';

  const handleLogin = async () => {
    if (!c) {
      toast({
        title: 'Link inválido',
        description: 'Código do passe não encontrado.',
        variant: 'destructive',
      });
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/claim/callback?c=${encodeURIComponent(c)}`,
        scopes: 'openid profile email',
      },
    });

    if (error) {
      console.error('Erro no login Google:', error);
      toast({
        title: 'Erro no Login',
        description: 'Não foi possível iniciar o processo de login com o Google.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#eef1ff] px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-violet-400/35 blur-3xl" />
        <div className="absolute bottom-12 right-6 h-56 w-56 rounded-full bg-indigo-400/30 blur-3xl" />
        <div className="absolute bottom-14 left-8 h-44 w-44 rounded-full bg-fuchsia-300/25 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="relative w-full overflow-hidden rounded-[2rem] border border-white/20 bg-gradient-to-b from-violet-700 via-violet-800 to-indigo-900 px-6 pb-7 pt-8 text-white shadow-[0_30px_80px_rgba(54,22,131,0.45)] sm:px-8"
        >
          <div className="pointer-events-none absolute -top-16 left-1/2 h-36 w-36 -translate-x-1/2 rounded-full bg-amber-300/30 blur-3xl" />
          <div className="pointer-events-none absolute right-[-36px] top-24 h-44 w-44 rounded-full bg-violet-400/20 blur-3xl" />

          <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-b from-violet-500/75 to-violet-700/60 shadow-[0_20px_60px_rgba(254,211,104,0.4)]">
            <Gift className="h-10 w-10 text-amber-200" />
          </div>

          <div className="relative mt-6 space-y-3 text-center">
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-[2.1rem]">{claimTitle}</h1>
            <p className="mx-auto max-w-xs text-sm leading-relaxed text-violet-100/90 sm:text-base">
              Receba ofertas, participe de promoções e ganhe benefícios exclusivos quando estiver por perto.
            </p>
          </div>

          <div className="relative mt-6 flex items-center justify-center gap-2 text-sm text-violet-100/85">
            <Sparkles className="h-4 w-4 text-amber-200" />
            <span>Ativação rápida e sem burocracia</span>
          </div>

          <Button
            size="lg"
            className="relative mt-7 h-16 w-full rounded-full border border-white/20 bg-gradient-to-r from-[#4f5dff] via-[#4a68ff] to-[#3768ff] text-lg font-semibold text-white shadow-[0_16px_40px_rgba(36,71,255,0.45)] transition-all hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_20px_50px_rgba(36,71,255,0.55)]"
            onClick={handleLogin}
          >
            <span className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg"
                alt="Google"
                className="h-5 w-5"
              />
            </span>
            <span>Entrar e começar</span>
          </Button>

          <p className="mt-4 text-center text-sm text-violet-100/90">Leva menos de 5 segundos</p>
        </motion.div>
      </div>
    </div>
  );
}
