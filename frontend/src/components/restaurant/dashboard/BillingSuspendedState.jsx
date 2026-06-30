import React from 'react';
import { AlertTriangle, LockKeyhole, MessageCircle, X } from 'lucide-react';

function BillingSuspendedState({
  billingError,
  onDismiss,
  supportUrl,
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-sm" aria-hidden="true" />

      <section
        aria-labelledby="billing-suspended-title"
        aria-modal="true"
        role="dialog"
        className="relative flex w-full max-w-2xl flex-col items-center rounded-xl border border-rose-500/30 bg-card px-6 py-10 text-center shadow-2xl shadow-slate-900/20"
      >
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-rose-700 transition hover:bg-rose-50 hover:text-rose-900"
          aria-label="Fechar aviso"
          title="Fechar aviso"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-700">
          <LockKeyhole className="h-7 w-7" />
        </div>

        <p className="mt-5 text-xs font-bold uppercase tracking-wide text-rose-700">Assinatura suspensa</p>
        <h2 id="billing-suspended-title" className="mt-2 text-3xl font-bold text-foreground">
          Regularize o pagamento para continuar
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          A cobrança pendente passou do período de regularização. Os dados do projeto foram preservados, mas as
          ações operacionais ficam bloqueadas até a confirmação do pagamento.
        </p>

        {billingError ? (
          <div className="mt-5 flex max-w-xl gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-left text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <span>{billingError}</span>
          </div>
        ) : null}

        <div className="mt-7 rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Trocar de plano não regulariza a pendência. Pague a cobrança em aberto ou fale com o suporte.
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
      </section>
    </div>
  );
}

export default BillingSuspendedState;
