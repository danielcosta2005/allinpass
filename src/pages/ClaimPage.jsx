import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function ClaimPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [message, setMessage] = useState("Verificando sua sessão...");

  useEffect(() => {
    const processClaim = async () => {
      if (!projectId) {
        toast({
          title: "Erro",
          description: "ID do projeto não encontrado na URL.",
          variant: "destructive",
        });
        navigate('/', { replace: true });
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;

      if (user && user.id) {
        setMessage("Sessão encontrada! Redirecionando...");
        const googleSub = user.id;
        const email = user.email;
        const name = user.user_metadata.full_name || "Cliente";
        
        const destination = `/c/${projectId}/${googleSub}?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`;
        navigate(destination, { replace: true });
      } else {
        setMessage("Iniciando autenticação...");
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/auth/callback?projectId=${projectId}`,
            scopes: 'openid profile email',
          },
        });

        if (error) {
          console.error('Erro ao iniciar o login com Google:', error);
          toast({
            title: "Erro de Login",
            description: "Não foi possível iniciar a autenticação com o Google. Tente novamente.",
            variant: "destructive",
          });
        }
      }
    };

    processClaim();
  }, [projectId, navigate, toast]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-purple-50 via-white to-indigo-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center"
      >
        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-6" />
        <h1 className="text-2xl font-semibold text-gray-700">{message}</h1>
        <p className="text-gray-500 mt-2">Por favor, aguarde um instante.</p>
      </motion.div>
    </div>
  );
}