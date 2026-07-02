import React from 'react';
import { AlertTriangle, Clock, CreditCard, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

function TrialExpiredBillingState({
  billingError,
  billingLoading,
  canManageBilling,
  onDismiss,
  onOpenPlanChange,
  planChangeOptions,
}) {
  const hasPlans = Array.isArray(planChangeOptions) && planChangeOptions.length > 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-sm" aria-hidden="true" />

      <section
        aria-labelledby="trial-expired-title"
        aria-modal="true"
        role="dialog"
        className="relative flex w-full max-w-2xl flex-col items-center rounded-xl border border-amber-500/30 bg-card px-6 py-10 text-center shadow-2xl shadow-slate-900/20"
      >
        <button
          type="button"
          onClick={() => onDismiss?.()}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-amber-700 transition hover:bg-amber-50 hover:text-amber-900"
          aria-label="Fechar aviso"
          title="Fechar aviso"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Clock className="h-7 w-7" />
        </div>

        <p className="mt-5 text-xs font-bold uppercase tracking-wide text-amber-700">Trial encerrado</p>
        <h2 id="trial-expired-title" className="mt-2 text-3xl font-bold text-foreground">
          Continue usando o Allin Pass sem perder o ritmo
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Seu período gratuito terminou, mas os dados do projeto seguem preservados. Ative um plano para liberar
          novamente o painel completo e continuar atendendo seus clientes sem interrupções.
        </p>

        {billingError ? (
          <div className="mt-5 flex max-w-xl gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-left text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <span>{billingError}</span>
          </div>
        ) : null}

        <div className="mt-7">
          {canManageBilling ? (
            <Button
              type="button"
              onClick={onOpenPlanChange}
              disabled={billingLoading || !hasPlans}
              className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700"
            >
              {billingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Escolher plano
            </Button>
          ) : (
            <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm font-medium text-muted-foreground">
              Fale com o gestor para ativar um plano pago.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default TrialExpiredBillingState;
