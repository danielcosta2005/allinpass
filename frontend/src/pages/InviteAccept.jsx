import React, { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, KeyRound, Loader2, MailCheck, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { adminAcceptInvitation } from '@/lib/admin';
import { supabase } from '@/lib/supabaseClient';
import PasswordInput from './signup/PasswordInput';
import PasswordStrengthMeter from './signup/PasswordStrengthMeter';

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

export default function InviteAccept() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invitationId = searchParams.get('invitationId') || '';
  const nonce = searchParams.get('nonce') || '';
  const { session, loading: authLoading, refreshAuthProfile } = useAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmationErrorMessage, setConfirmationErrorMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const passwordState = useMemo(() => evaluatePassword(password), [password]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setTouched(true);
    setConfirmationTouched(true);
    setErrorMessage('');
    setConfirmationErrorMessage('');

    const passwordError = getPasswordError(password, passwordState);
    if (passwordError) {
      setErrorMessage(passwordError);
      return;
    }

    if (!passwordConfirmation) {
      setConfirmationErrorMessage('Confirme a senha para evitar erros de acesso.');
      return;
    }

    if (passwordConfirmation !== password) {
      setConfirmationErrorMessage('As senhas nao conferem. Ajuste para continuar.');
      return;
    }

    setSubmitting(true);

    try {
      await adminAcceptInvitation({
        invitationId: invitationId || undefined,
        nonce: nonce || undefined,
        validateOnly: true,
      });

      const { error: passwordUpdateError } = await supabase.auth.updateUser({ password });
      if (passwordUpdateError) throw passwordUpdateError;

      const result = await adminAcceptInvitation({
        invitationId: invitationId || undefined,
        nonce: nonce || undefined,
      });
      await refreshAuthProfile();

      toast({
        title: 'Convite aceito',
        description: 'Sua conta ja esta pronta para acessar o painel.',
      });

      navigate(result?.redirectTo || '/app', { replace: true });
    } catch (error) {
      const message = error?.message || 'Nao foi possivel aceitar o convite agora.';
      setErrorMessage(message);
      toast({
        title: 'Erro ao aceitar convite',
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
        <title>Aceitar convite - Allin Pass</title>
        <meta name="description" content="Crie sua senha para aceitar o convite da Allin Pass" />
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
              Aceitar convite
            </h1>
            <p className="text-center text-gray-600 mb-8">
              Crie sua senha para acessar o painel Allin Pass.
            </p>

            {!session?.user ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
                <KeyRound className="w-9 h-9 text-amber-600 mx-auto mb-3" />
                <p className="font-semibold text-amber-950">Link expirado ou invalido</p>
                <p className="text-sm text-amber-800 mt-2">
                  Peça para quem enviou o convite reenviar o link.
                </p>
                <Link to="/login" className="mt-5 inline-flex">
                  <Button className="bg-amber-700 hover:bg-amber-800 text-white">
                    Voltar para login
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <MailCheck className="h-4 w-4" />
                    {session.user.email}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="invite-password">Senha</Label>
                  <PasswordInput
                    id="invite-password"
                    value={password}
                    visible={showPassword}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setErrorMessage('');
                    }}
                    onBlur={() => setTouched(true)}
                    onToggleVisibility={() => setShowPassword((visible) => !visible)}
                    placeholder="Crie uma senha forte"
                    ariaInvalid={Boolean(errorMessage)}
                  />
                  {errorMessage && touched && (
                    <p className="text-sm text-rose-600">{errorMessage}</p>
                  )}

                  <Label htmlFor="invite-password-confirmation">Confirmacao de senha</Label>
                  <PasswordInput
                    id="invite-password-confirmation"
                    value={passwordConfirmation}
                    visible={showPasswordConfirmation}
                    onChange={(event) => {
                      setPasswordConfirmation(event.target.value);
                      setConfirmationErrorMessage('');
                    }}
                    onBlur={() => setConfirmationTouched(true)}
                    onToggleVisibility={() => setShowPasswordConfirmation((visible) => !visible)}
                    placeholder="Digite a senha novamente"
                    ariaInvalid={Boolean(confirmationErrorMessage)}
                    showLabel="Mostrar confirmacao de senha"
                    hideLabel="Ocultar confirmacao de senha"
                  />
                  {confirmationErrorMessage && confirmationTouched && (
                    <p className="text-sm text-rose-600">{confirmationErrorMessage}</p>
                  )}

                  <PasswordStrengthMeter passwordState={passwordState} />
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
                      Entrar no painel
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
