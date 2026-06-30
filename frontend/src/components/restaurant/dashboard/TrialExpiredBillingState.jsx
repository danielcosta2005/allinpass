import React from 'react';
import { AlertTriangle, CreditCard, Loader2, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';

function TrialExpiredBillingState({
  billingError,
  billingLoading,
  canManageBilling,
  onOpenPlanChange,
  planChangeOptions,
}) {
  const hasPlans = Array.isArray(planChangeOptions) && planChangeOptions.length > 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center rounded-xl border border-amber-500/30 bg-card px-6 py-10 text-center shadow-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <LockKeyhole className="h-7 w-7" />
      </div>

      <p className="mt-5 text-xs font-bold uppercase tracking-wide text-amber-700">Trial encerrado</p>
      <h2 className="mt-2 text-3xl font-bold text-foreground">Assine um plano para continuar</h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
        Seu Free Trial chegou ao fim. Os dados do projeto foram preservados, mas as ações operacionais ficam
        bloqueadas até que um plano pago seja ativado.
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
    </div>
  );
}

export default TrialExpiredBillingState;
