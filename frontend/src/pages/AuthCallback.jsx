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
  const [status, setStatus] = useState("Processando autenticação...");
  const handledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let subscription = null;

    const navigateToPasswordReset = () => {
      if (cancelled || handledRef.current) return;
      handledRef.current = true;
      setStatus("Preparando redefinição de senha...");
      navigate('/reset-password', { replace: true });
    };

    const handleSession = (session) => {
      if (cancelled || handledRef.current || !session) return;

      setStatus("Login bem-sucedido! Preparando seu passe...");
      const searchParams = new URLSearchParams(location.search);
      const hashParams = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      const authType = searchParams.get('type') || hashParams.get('type');
      const flow = searchParams.get('flow') || hashParams.get('flow');
      const invitationId = searchParams.get('invitationId') || hashParams.get('invitationId');
      const nonce = searchParams.get('nonce') || hashParams.get('nonce');
      const projectId = searchParams.get('projectId');

      if (authType === 'recovery' || flow === 'recovery') {
        navigateToPasswordReset();
        return;
      }

      if (authType === 'invite' || flow === 'invite') {
        handledRef.current = true;
        setStatus("Preparando seu convite...");
        const inviteParams = new URLSearchParams();
        if (invitationId) inviteParams.set('invitationId', invitationId);
        if (nonce) inviteParams.set('nonce', nonce);
        navigate(`/convite${inviteParams.toString() ? `?${inviteParams.toString()}` : ''}`, { replace: true });
        return;
      }

      handledRef.current = true;

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
            description: "Não foi possível identificar o usuário autenticado.",
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

      const signupFinalizeParams = new URLSearchParams();
      ['plano', 'establishmentName', 'planCode'].forEach((key) => {
        const value = searchParams.get(key);
        if (value) signupFinalizeParams.set(key, value);
      });
      signupFinalizeParams.set('finalizar', '1');
      navigate(`/cadastro?${signupFinalizeParams.toString()}`, { replace: true });
    };

    const start = async () => {
      const {
        data: { subscription: listener },
      } = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (event === 'PASSWORD_RECOVERY') {
          navigateToPasswordReset();
          return;
        }

        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          handleSession(nextSession);
        }
      });

      subscription = listener;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      handleSession(session);
    };

    void start();

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [navigate, location.hash, location.search, toast]);

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
