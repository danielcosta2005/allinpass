import React, { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, KeyRound, Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/supabaseClient';

const PASSWORD_RULES = [
  { id: 'length', label: 'Pelo menos 10 caracteres', test: (value) => value.length >= 10 },
  { id: 'upper', label: 'Uma letra maiuscula', test: (value) => /[A-Z]/.test(value) },
  { id: 'lower', label: 'Uma letra minuscula', test: (value) => /[a-z]/.test(value) },
  { id: 'number', label: 'Um numero', test: (value) => /\d/.test(value) },
  { id: 'symbol', label: 'Um simbolo especial', test: (value) => /[^A-Za-z0-9]/.test(value) },
];

function evaluatePassword(password) {
  const checks = PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.test(password),
  }));
  const score = checks.filter((rule) => rule.met).length;
  const progress = Math.max(8, (score / PASSWORD_RULES.length) * 100);
  const strength =
    score <= 1
      ? { label: 'Muito fraca', textColor: 'text-rose-600', barColor: 'bg-rose-500' }
      : score <= 3
        ? { label: 'Em evolucao', textColor: 'text-amber-600', barColor: 'bg-amber-500' }
        : { label: 'Forte', textColor: 'text-emerald-600', barColor: 'bg-emerald-500' };

  return {
    checks,
    progress,
    ...strength,
    isStrong: score >= 4,
  };
}

function getPasswordError(password, passwordState) {
  if (!password) return 'Crie uma senha forte para acessar sua conta.';

  if (!passwordState.isStrong) {
    const missingRules = passwordState.checks
      .filter((rule) => !rule.met)
      .map((rule) => rule.label.toLowerCase());
    return `Sua senha ainda precisa de: ${missingRules.join(', ')}.`;
  }

  return '';
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const passwordState = useMemo(() => evaluatePassword(password), [password]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setTouched(true);
    setErrorMessage('');

    const passwordError = getPasswordError(password, passwordState);
    if (passwordError) {
      setErrorMessage(passwordError);
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      toast({
        title: 'Senha atualizada',
        description: 'Sua nova senha ja esta ativa.',
      });
      navigate('/app', { replace: true });
    } catch (error) {
      const message = error?.message || 'Nao foi possivel atualizar sua senha agora.';
      setErrorMessage(message);
      toast({
        title: 'Erro ao atualizar senha',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Redefinir senha - Allin Pass</title>
        <meta name="description" content="Crie uma nova senha de acesso para sua conta Allin Pass" />
      </Helmet>
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-600/10 via-indigo-600/10 to-pink-600/10" />

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
              Nova senha
            </h1>
            <p className="text-center text-gray-600 mb-8">
              Crie uma senha forte para voltar a acessar sua conta.
            </p>

            {!session?.user ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
                <KeyRound className="w-9 h-9 text-amber-600 mx-auto mb-3" />
                <p className="font-semibold text-amber-950">Link expirado ou invalido</p>
                <p className="text-sm text-amber-800 mt-2">
                  Solicite um novo link de redefinicao na tela de login.
                </p>
                <Link to="/login" className="mt-5 inline-flex">
                  <Button className="bg-amber-700 hover:bg-amber-800 text-white">
                    Voltar para login
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nova senha</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="Crie uma senha forte"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setErrorMessage('');
                    }}
                    onBlur={() => setTouched(true)}
                    autoComplete="new-password"
                    className="h-12"
                    aria-invalid={Boolean(errorMessage)}
                  />
                  {errorMessage && touched && (
                    <p className="text-sm text-rose-600">{errorMessage}</p>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-slate-700">Forca da senha</p>
                    <p className={`text-sm font-semibold ${passwordState.textColor}`}>
                      {passwordState.label}
                    </p>
                  </div>

                  <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                    <motion.div
                      className={`h-full ${passwordState.barColor}`}
                      initial={false}
                      animate={{ width: `${passwordState.progress}%` }}
                      transition={{ duration: 0.35, ease: 'easeOut' }}
                    />
                  </div>

                  <ul className="mt-3 grid sm:grid-cols-2 gap-2">
                    {passwordState.checks.map((rule) => (
                      <li
                        key={rule.id}
                        className={`text-xs flex items-center gap-2 ${
                          rule.met ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${rule.met ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        {rule.label}
                      </li>
                    ))}
                  </ul>
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold"
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5" />
                      Atualizar senha
                    </span>
                  )}
                </Button>
              </form>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
