import React from 'react';
import { AlertTriangle, LockKeyhole, MessageCircle } from 'lucide-react';

function BillingSuspendedState({
  billingError,
  supportUrl,
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center rounded-xl border border-rose-200 bg-white px-6 py-10 text-center shadow-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-700">
        <LockKeyhole className="h-7 w-7" />
      </div>

      <p className="mt-5 text-xs font-bold uppercase tracking-wide text-rose-700">Assinatura suspensa</p>
      <h2 className="mt-2 text-3xl font-bold text-slate-950">Regularize o pagamento para continuar</h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
        A cobranca pendente passou do periodo de regularizacao. Os dados do projeto foram preservados, mas as
        acoes operacionais ficam bloqueadas ate a confirmacao do pagamento.
      </p>

      {billingError ? (
        <div className="mt-5 flex max-w-xl gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-left text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <span>{billingError}</span>
        </div>
      ) : null}

      <div className="mt-7 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        Trocar de plano nao regulariza a pendencia. Pague a cobranca em aberto ou fale com o suporte.
      </div>

      {supportUrl ? (
        <a
          href={supportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:from-purple-700 hover:to-indigo-700"
        >
          <MessageCircle className="h-4 w-4" />
          Falar com suporte
        </a>
      ) : null}
    </div>
  );
}

export default BillingSuspendedState;
