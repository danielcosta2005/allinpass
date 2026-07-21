import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BadgePercent, CheckCircle2, CreditCard, Loader2, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  calculateAffiliateFirstMonthPrice,
  formatAffiliateDiscountPercent,
  formatCurrencyBRL,
  getAffiliateDiscountBps,
} from '@/lib/subscriptionPlans';

export function FinalizingSignupCard({
  paidPlan,
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
          ? paidPlan ? 'Finalizando sua assinatura' : 'Finalizando seu Free Trial'
          : 'Não foi possível finalizar automaticamente'}
      </h2>
      <p className="text-slate-700 mt-2">
        {signupLoading
          ? paidPlan
            ? 'Estamos validando o pagamento no Asaas e criando seu acesso ao painel.'
            : 'Estamos criando seu projeto, assinatura trial e acesso ao painel.'
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

export function PaymentStep({
  affiliateOffer = null,
  checkoutError,
  checkoutLoading,
  onContinue,
  selectedPlan,
}) {
  const affiliateDiscountBps = getAffiliateDiscountBps(affiliateOffer);
  const showAffiliateOffer = selectedPlan?.type === 'paid' && affiliateDiscountBps > 0;
  const affiliateDiscountPercent = formatAffiliateDiscountPercent(affiliateOffer);
  const affiliateFirstMonthPrice = calculateAffiliateFirstMonthPrice(selectedPlan?.price, affiliateOffer);

  return (
    <motion.div
      key="step-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 via-white to-indigo-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-purple-600 mb-2">
          Resumo do plano selecionado
        </p>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <p className="text-2xl font-bold text-slate-900">{selectedPlan.name}</p>
            <p className="text-sm text-slate-600 mt-1">{selectedPlan.description}</p>
          </div>
          {showAffiliateOffer ? (
            <div className="text-left sm:text-right">
              <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                <BadgePercent className="h-3.5 w-3.5" />
                Condição especial aplicada
              </div>
              <p className="text-sm text-slate-500 line-through decoration-2">
                R$ {formatCurrencyBRL(selectedPlan.price)}/mês
              </p>
              <p className="text-2xl font-bold text-emerald-700">
                R$ {formatCurrencyBRL(affiliateFirstMonthPrice)}
                <span className="ml-1 text-sm font-semibold text-emerald-800">no primeiro mês</span>
              </p>
              <p className="text-xs text-slate-500">
                -{affiliateDiscountPercent}% agora. Depois, R$ {formatCurrencyBRL(selectedPlan.price)}/mês.
              </p>
            </div>
          ) : (
            <p className="text-2xl font-bold text-purple-700">
              R$ {formatCurrencyBRL(selectedPlan.price)}/mês
            </p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
        <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-purple-600" />
          Checkout seguro via Asaas
        </p>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">
          Vamos criar uma sessão de checkout recorrente no Asaas para este plano.
          Nenhum dado de cartão é coletado dentro do AllinPass.
        </p>
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <Lock className="w-3.5 h-3.5" />
          Você será redirecionado para o ambiente seguro do provedor.
        </div>
      </div>

      {checkoutError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {checkoutError}
        </div>
      )}

      <Button
        type="button"
        onClick={onContinue}
        disabled={checkoutLoading}
        className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
      >
        {checkoutLoading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Abrindo checkout...
          </span>
        ) : 'Ir para checkout Asaas'}
      </Button>
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
  paidPlan,
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
          ? paidPlan
            ? `Enviamos um link de acesso para ${formData.email}. Abra o link para continuar a assinatura no checkout.`
            : `Enviamos um link de acesso para ${formData.email}. Abra o link para finalizar o Free Trial e provisionar seu painel.`
          : paidPlan
            ? `Abra o link enviado para ${formData.email} para continuar a assinatura no checkout. Não se esqueça de olhar o lixo eletrônico!`
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

export function PaidSuccessCard({ selectedPlan }) {
  return (
    <motion.div
      key="success-paid"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-purple-200 bg-purple-50 p-6"
    >
      <CheckCircle2 className="w-10 h-10 text-purple-600 mb-4" />
      <h2 className="text-2xl font-bold text-purple-900">Cadastro concluído</h2>
      <p className="text-purple-800 mt-2">
        Pagamento confirmado e acesso criado para o plano {selectedPlan.name}.
        Você já pode acessar o painel do estabelecimento.
      </p>
      <div className="flex flex-wrap gap-3 mt-5">
        <Link to="/org">
          <Button className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
            Acessar painel
          </Button>
        </Link>
        <Link to="/#planos">
          <Button variant="outline" className="border-purple-300 text-purple-800 hover:bg-purple-100">
            Ver outros planos
          </Button>
        </Link>
      </div>
    </motion.div>
  );
}
