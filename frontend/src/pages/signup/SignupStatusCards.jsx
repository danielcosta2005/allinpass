import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function FinalizingSignupCard({
  signupError,
  signupLoading,
}) {
  return (
    <motion.div
      key="finalizing-signup"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="rounded-2xl border border-purple-200 bg-purple-50 p-6"
    >
      {signupLoading ? (
        <Loader2 className="w-10 h-10 text-purple-600 mb-4 animate-spin" />
      ) : (
        <CheckCircle2 className="w-10 h-10 text-rose-600 mb-4" />
      )}
      <h2 className="text-2xl font-bold text-slate-900">
        {signupLoading
          ? 'Finalizando seu Free Trial'
          : 'Não foi possível finalizar automaticamente'}
      </h2>
      <p className="text-slate-700 mt-2">
        {signupLoading
          ? 'Estamos criando seu projeto e acesso ao painel.'
          : signupError || 'Entre novamente para continuar o provisionamento.'}
      </p>
      {!signupLoading && (
        <div className="flex flex-wrap gap-3 mt-5">
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
            className="border-purple-300 text-purple-800 hover:bg-purple-100"
          >
            Tentar novamente
          </Button>
          <Link to="/login">
            <Button className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
              Ir para login
            </Button>
          </Link>
          <Link to="/#planos">
            <Button variant="outline" className="border-purple-300 text-purple-800 hover:bg-purple-100">
              Voltar aos planos
            </Button>
          </Link>
        </div>
      )}
    </motion.div>
  );
}

export function TrialSuccessCard() {
  return (
    <motion.div
      key="success-trial"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6"
    >
      <CheckCircle2 className="w-10 h-10 text-emerald-600 mb-4" />
      <h2 className="text-2xl font-bold text-emerald-900">Free Trial iniciado com sucesso</h2>
      <p className="text-emerald-800 mt-2">
        Seu acesso de 7 dias foi iniciado sem necessidade de cartão de crédito.
      </p>
      <div className="flex flex-wrap gap-3 mt-5">
        <Link to="/org">
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
            Acessar painel
          </Button>
        </Link>
        <Link to="/#planos">
          <Button variant="outline" className="border-emerald-300 text-emerald-800 hover:bg-emerald-100">
            Voltar aos planos
          </Button>
        </Link>
      </div>
    </motion.div>
  );
}

export function ConfirmEmailCard({
  confirmationFlow,
  formData,
  onResendConfirmationEmail,
  resendLoading,
}) {
  return (
    <motion.div
      key="confirm-email"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-sky-200 bg-sky-50 p-6"
    >
      <CheckCircle2 className="w-10 h-10 text-sky-600 mb-4" />
      <h2 className="text-2xl font-bold text-sky-950">
        {confirmationFlow === 'existing-customer' ? 'Confira seu e-mail' : 'Confirme seu e-mail'}
      </h2>
      <p className="text-sky-900 mt-2">
        {confirmationFlow === 'existing-customer'
          ? `Enviamos um link de acesso para ${formData.email}. Abra o link para finalizar o Free Trial e provisionar seu painel.`
          : `Abra o link enviado para ${formData.email} para finalizar o Free Trial e provisionar seu painel. Não se esqueça de olhar o lixo eletrônico!`}
      </p>
      <p className="text-sm text-sky-800 mt-3">
        Se o link não chegou, você pode pedir um novo envio sem refazer o cadastro.
      </p>
      <div className="flex flex-wrap gap-3 mt-5">
        <Button
          type="button"
          variant="outline"
          onClick={onResendConfirmationEmail}
          disabled={resendLoading}
          className="border-sky-300 text-sky-900 hover:bg-sky-100"
        >
          {resendLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Reenviar e-mail
        </Button>
      </div>
    </motion.div>
  );
}
