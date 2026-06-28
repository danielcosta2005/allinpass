import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, CreditCard, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { subscriptionPlans } from '@/lib/subscriptionPlans';

const PAID_SIGNUP_RECOVERY_STATES = new Set([
  'payment_pending',
  'payment_retry_available',
]);

const formatPlanName = (planCode) => {
  const normalizedPlanCode = String(planCode || '').trim().toLowerCase();
  if (!normalizedPlanCode) return 'plano selecionado';

  const plan = subscriptionPlans.find((candidate) => candidate.code === normalizedPlanCode);
  return plan?.name || normalizedPlanCode.replace(/_/g, ' ');
};

const getPaidSignupCardCopy = (signupState) => {
  if (signupState === 'payment_confirmed_finalization_pending') {
    return {
      icon: CheckCircle2,
      tone: 'emerald',
      eyebrow: 'Pagamento confirmado',
      title: 'Finalize a ativacao da sua conta',
      description:
        'Recebemos a confirmacao do pagamento. Falta apenas concluir a criacao do projeto para liberar o painel.',
      actionLabel: 'Finalizar ativacao',
    };
  }

  if (signupState === 'payment_retry_available') {
    return {
      icon: RefreshCw,
      tone: 'amber',
      eyebrow: 'Pagamento nao concluido',
      title: 'Retome sua assinatura',
      description:
        'Sua conta foi criada, mas o pagamento ainda nao ativou o plano. Gere um novo checkout seguro para continuar.',
      actionLabel: 'Continuar pagamento',
    };
  }

  return {
    icon: CreditCard,
    tone: 'blue',
    eyebrow: 'Pagamento pendente',
    title: 'Conclua o pagamento para liberar o painel',
    description:
      'Sua conta ja existe no AllinPass. Agora falta concluir o checkout seguro do Asaas para ativar o projeto.',
    actionLabel: 'Continuar pagamento',
  };
};

const getToneClasses = (tone) => {
  if (tone === 'emerald') {
    return {
      wrapper: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      icon: 'bg-emerald-600 text-white',
      button: 'bg-emerald-600 hover:bg-emerald-700',
    };
  }

  if (tone === 'amber') {
    return {
      wrapper: 'border-amber-200 bg-amber-50 text-amber-900',
      icon: 'bg-amber-500 text-white',
      button: 'bg-amber-500 hover:bg-amber-600',
    };
  }

  return {
    wrapper: 'border-blue-200 bg-blue-50 text-blue-900',
    icon: 'bg-blue-600 text-white',
    button: 'bg-blue-600 hover:bg-blue-700',
  };
};

function NoProjectSignupState({
  actionLoading,
  onContinuePayment,
  onFinalizeActivation,
  onRefreshStatus,
  status,
  statusError,
  statusLoading,
}) {
  if (statusLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border bg-card p-6 text-center shadow-lg shadow-slate-950/5 dark:shadow-black/20"
      >
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-purple-600" />
        <p className="mt-3 font-semibold text-foreground">Verificando sua assinatura...</p>
        <p className="mt-1 text-sm text-muted-foreground">Estamos conferindo se existe pagamento pendente para sua conta.</p>
      </motion.div>
    );
  }

  if (statusError) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-900 shadow-lg"
      >
        <AlertCircle className="mx-auto h-8 w-8" />
        <p className="mt-3 font-bold">Nao foi possivel verificar sua assinatura</p>
        <p className="mt-1 text-sm">{statusError}</p>
        <Button
          type="button"
          variant="outline"
          onClick={onRefreshStatus}
          className="mt-5 border-red-200 bg-card text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-500/10"
        >
          Tentar novamente
        </Button>
      </motion.div>
    );
  }

  const signupState = status?.signupState || 'no_project_no_signup_context';
  const canContinuePayment = PAID_SIGNUP_RECOVERY_STATES.has(signupState);
  const canFinalizeActivation = signupState === 'payment_confirmed_finalization_pending';

  if (canContinuePayment || canFinalizeActivation) {
    const copy = getPaidSignupCardCopy(signupState);
    const toneClasses = getToneClasses(copy.tone);
    const Icon = copy.icon;
    const planName = formatPlanName(status?.planCode);
    const handleAction = canFinalizeActivation ? onFinalizeActivation : onContinuePayment;

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-2xl border p-6 shadow-lg ${toneClasses.wrapper}`}
      >
        <div className="flex flex-col gap-5 text-left md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${toneClasses.icon}`}>
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em]">{copy.eyebrow}</p>
              <h2 className="mt-2 text-2xl font-bold text-foreground">{copy.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.description}</p>
              <div className="mt-4 rounded-xl border border-border bg-card/80 p-3 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Plano:</span> {planName}
                {status?.checkoutStatus ? (
                  <span className="ml-3">
                    <span className="font-semibold text-foreground">Status:</span> {status.checkoutStatus}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <Button
            type="button"
            onClick={handleAction}
            disabled={actionLoading}
            className={`min-w-[210px] gap-2 text-white ${toneClasses.button}`}
          >
            {actionLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : canFinalizeActivation ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            {copy.actionLabel}
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded-md shadow-lg"
    >
      <p className="font-bold">Atencao</p>
      <p>Seu usuario nao esta associado a nenhum projeto, fale com um administrador.</p>
    </motion.div>
  );
}

export default NoProjectSignupState;
