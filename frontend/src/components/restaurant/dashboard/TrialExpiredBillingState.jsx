import React from 'react';
import { AlertTriangle, Loader2, LockKeyhole } from 'lucide-react';

function TrialExpiredBillingState({
  billingError,
  billingLoading,
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center rounded-xl border border-amber-200 bg-white px-6 py-10 text-center shadow-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <LockKeyhole className="h-7 w-7" />
      </div>

      <p className="mt-5 text-xs font-bold uppercase tracking-wide text-amber-700">Trial encerrado</p>
      <h2 className="mt-2 text-3xl font-bold text-slate-950">Acesso operacional pausado</h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
        Seu Free Trial chegou ao fim. Os dados do projeto foram preservados, mas as ações operacionais ficam
        bloqueadas até que o acesso seja reativado.
      </p>

      {billingError ? (
        <div className="mt-5 flex max-w-xl gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-left text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <span>{billingError}</span>
        </div>
      ) : null}

      <div className="mt-7">
        {billingLoading ? (
          <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verificando status do acesso
          </div>
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
            Fale com o suporte para avaliar a reativação do acesso.
          </div>
        )}
      </div>
    </div>
  );
}

export default TrialExpiredBillingState;
