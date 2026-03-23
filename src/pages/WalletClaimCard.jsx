import React from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { motion } from 'framer-motion';

export default function WalletClaimCard() {
  const { c } = useParams();
  const { toast } = useToast();

  const handleLogin = async () => {
    if (!c) {
      toast({
        title: "Link inválido",
        description: "Código do passe não encontrado.",
        variant: "destructive",
      });
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/claim/callback?c=${encodeURIComponent(c)}`,
        scopes: "openid profile email",
      }
    });

    if (error) {
      console.error("❌ Erro no login Google:", error);
      toast({
        title: "Erro no Login",
        description: "Não foi possível iniciar o processo de login com o Google.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-gray-200"
      >
        <div className="flex flex-col items-center justify-center text-center p-8 space-y-6">
          <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-4 rounded-full shadow-lg">
            <Wallet className="h-10 w-10 text-white" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-gray-800">Resgate seu Passe</h1>
            <p className="text-gray-600 max-w-xs">
              Faça login com sua conta Google para adicionar seu passe à sua carteira.
            </p>
          </div>

          <Button
            size="lg"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-3 py-7 rounded-full text-lg font-semibold shadow-lg hover:shadow-xl transition-shadow"
            onClick={handleLogin}
          >
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg"
              alt="Google"
              className="h-7 w-7 bg-white rounded-full p-1"
            />
            <span>Entrar com Google</span>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
