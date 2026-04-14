import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Loader2 } from 'lucide-react';
import { motion } from "framer-motion";
import { useToast } from "@/components/ui/use-toast";

export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [status, setStatus] = useState("Processando autenticacao...");
  const handledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let subscription = null;

    const handleSession = (session) => {
      if (cancelled || handledRef.current || !session) return;
      handledRef.current = true;

      setStatus("Login bem-sucedido! Preparando seu passe...");
      const searchParams = new URLSearchParams(location.search);
      const projectId = searchParams.get('projectId');

      if (projectId) {
        const sub = session.user?.id;
        const email = session.user?.email || '';
        const name =
          session.user?.user_metadata?.full_name ||
          session.user?.user_metadata?.name ||
          session.user?.user_metadata?.given_name ||
          '';

        if (!sub) {
          toast({
            title: "Erro",
            description: "Nao foi possivel identificar o usuario autenticado.",
            variant: "destructive",
          });
          navigate('/', { replace: true });
          return;
        }

        navigate(`/c/${projectId}/${sub}?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`, {
          replace: true,
        });
        return;
      }

      toast({
        title: "Erro",
        description: "ID do projeto nao encontrado para redirecionamento.",
        variant: "destructive",
      });
      navigate('/', { replace: true });
    };

    const start = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      handleSession(session);

      const {
        data: { subscription: listener },
      } = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          handleSession(nextSession);
        }
      });

      subscription = listener;
    };

    void start();

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [navigate, location.search, toast]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-purple-50 via-white to-indigo-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center"
      >
        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-6" />
        <h1 className="text-2xl font-semibold text-gray-700">{status}</h1>
        <p className="text-gray-500 mt-2">Aguarde um instante, estamos finalizando seu login.</p>
      </motion.div>
    </div>
  );
}
