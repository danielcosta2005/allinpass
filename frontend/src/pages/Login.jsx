import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { KeyRound, LogIn, Wallet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';

const EMAIL_CONFIRMATION_REQUIRED_MESSAGE = 'Confirmação de email necessária.';

function isEmailNotConfirmedError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  return code === 'email_not_confirmed' || message.includes('email not confirmed');
}

const Login = () => {
  const { signIn, user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);

    setLoading(false);

    if (error) {
      if (isEmailNotConfirmedError(error)) {
        setNeedsEmailConfirmation(true);
        return;
      }

      toast({
        title: "Erro no login",
        description: error.message || "Verifique suas credenciais e tente novamente.",
        variant: "destructive",
      });
      return;
    }

    setNeedsEmailConfirmation(false);
    // No explicit navigation here, let AuthProvider handle it via onAuthStateChange
  };

  const handlePasswordResetRequest = async (e) => {
    e.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast({
        title: 'Informe seu e-mail',
        description: 'Preencha o e-mail para receber o link de redefinicao de senha.',
        variant: 'destructive',
      });
      return;
    }

    setResetLoading(true);
    setResetSent(false);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setResetSent(true);
      toast({
        title: 'Link enviado',
        description: 'Se o e-mail estiver cadastrado, voce recebera um link para criar uma nova senha.',
      });
    } catch (error) {
      toast({
        title: 'Nao foi possivel enviar',
        description: error?.message || 'Tente novamente em alguns minutos.',
        variant: 'destructive',
      });
    } finally {
      setResetLoading(false);
    }
  };

  const handleResendConfirmationEmail = async () => {
    if (resendLoading) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast({
        title: 'Informe seu e-mail',
        description: 'Preencha o e-mail para reenviar a confirmação.',
        variant: 'destructive',
      });
      return;
    }

    setResendLoading(true);

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: normalizedEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/cadastro?plano=free-trial&finalizar=1`,
        },
      });

      if (error) throw error;

      toast({
        title: 'E-mail reenviado',
        description: 'Enviamos um novo link de confirmação para sua caixa de entrada.',
      });
    } catch (error) {
      toast({
        title: 'Não foi possível reenviar',
        description: error?.message || 'Tente novamente em alguns minutos.',
        variant: 'destructive',
      });
    } finally {
      setResendLoading(false);
    }
  };

  if (authLoading) {
    return (
       <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin rounded-full h-12 w-12 text-primary" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <Helmet>
        <title>Login - Allin Pass</title>
        <meta name="description" content="Acesse o sistema de fidelidade Allin Pass" />
      </Helmet>
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-600/10 via-indigo-600/10 to-pink-600/10"></div>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md relative z-10"
        >
          <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl p-8 border border-purple-100">
            <div className="flex items-center justify-center mb-8">
              <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-4 rounded-2xl">
                <Wallet className="w-10 h-10 text-white" />
              </div>
            </div>
            
            <h1 className="text-3xl font-bold text-center mb-2 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
              Allin Pass
            </h1>
            <p className="text-center text-gray-600 mb-8">
              {resetMode ? 'Redefinicao de senha' : 'Painel Administrativo'}
            </p>

            <form onSubmit={resetMode ? handlePasswordResetRequest : handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12"
                />
              </div>

              {!resetMode && (
                <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12"
                />
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold"
                disabled={resetMode ? resetLoading : loading}
              >
                {(resetMode ? resetLoading : loading) ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : resetMode ? (
                  <div className="flex items-center justify-center gap-2">
                    <KeyRound className="w-5 h-5" />
                    Enviar link de redefinicao
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <LogIn className="w-5 h-5" />
                    Entrar
                  </div>
                )}
              </Button>
              {resetMode && resetSent && (
                <p className="text-sm text-emerald-700 text-center">
                  Confira sua caixa de entrada e abra o link para criar uma nova senha.
                </p>
              )}
              <button
                type="button"
                className="w-full text-sm font-semibold text-purple-700 hover:text-purple-800 underline underline-offset-4"
                onClick={() => {
                  setResetMode((current) => !current);
                  setResetSent(false);
                  setNeedsEmailConfirmation(false);
                }}
              >
                {resetMode ? 'Voltar para o login' : 'Esqueci minha senha'}
              </button>
              {needsEmailConfirmation && (
                <p className="text-sm text-rose-600 text-center">
                  {EMAIL_CONFIRMATION_REQUIRED_MESSAGE}{' '}
                  Não recebeu nosso email?{' '}
                  <button
                    type="button"
                    className="font-semibold underline underline-offset-2 hover:text-rose-700 disabled:opacity-60"
                    onClick={handleResendConfirmationEmail}
                    disabled={resendLoading}
                  >
                    {resendLoading ? 'Reenviando...' : 'Clique aqui'}
                  </button>
                </p>
              )}
            </form>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default Login;
