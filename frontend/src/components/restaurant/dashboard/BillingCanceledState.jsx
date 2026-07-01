import React, { useState } from 'react';
import { AlertTriangle, Loader2, LockKeyhole, MessageCircle, RotateCcw, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function formatCurrencyFromCents(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0) / 100);
}

function getReactivationPlanSummary(subscription) {
  const planName = subscription?.plan?.name
    || subscription?.planName
    || subscription?.plan_name
    || 'Plano atual';
  const rawPriceCents = subscription?.basePriceCents
    ?? subscription?.base_price_cents
    ?? subscription?.plan?.basePriceCents
    ?? subscription?.plan?.base_price_cents;
  const priceCents = Number(rawPriceCents);

  return {
    planName,
    priceLabel: rawPriceCents !== undefined && rawPriceCents !== null && Number.isFinite(priceCents)
      ? `${formatCurrencyFromCents(priceCents)}/mês`
      : 'Valor não informado',
  };
}

function BillingCanceledState({
  billingError,
  canManageBilling,
  onDismiss,
  onReactivateSubscription,
  reactivationLoading,
  subscription,
  supportUrl,
}) {
  const [reactivationConfirmationOpen, setReactivationConfirmationOpen] = useState(false);
  const reactivationPlanSummary = getReactivationPlanSummary(subscription);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-sm" aria-hidden="true" />

      <section
        aria-labelledby="billing-canceled-title"
        aria-modal="true"
        role="dialog"
        className="relative flex w-full max-w-2xl flex-col items-center rounded-xl border border-rose-500/30 bg-card px-6 py-10 text-center shadow-2xl shadow-slate-900/20"
      >
        <button
          type="button"
          onClick={() => onDismiss?.()}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-rose-700 transition hover:bg-rose-50 hover:text-rose-900"
          aria-label="Fechar aviso"
          title="Fechar aviso"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-700">
          <LockKeyhole className="h-7 w-7" />
        </div>

        <p className="mt-5 text-xs font-bold uppercase tracking-wide text-rose-700">Assinatura cancelada</p>
        <h2 id="billing-canceled-title" className="mt-2 text-3xl font-bold text-foreground">
          Regularize a assinatura para voltar a operar
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          A assinatura deste projeto foi cancelada. Os dados permanecem preservados, mas as ações operacionais ficam
          bloqueadas até que a situação da assinatura seja regularizada.
        </p>

        {!canManageBilling ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            Fale com o gestor do projeto para reativar a assinatura.
          </p>
        ) : null}

        {billingError ? (
          <div className="mt-5 flex max-w-xl gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-left text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <span>{billingError}</span>
          </div>
        ) : null}

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {canManageBilling ? (
            <button
              type="button"
              onClick={() => setReactivationConfirmationOpen(true)}
              disabled={reactivationLoading}
              className="inline-flex min-w-[176px] items-center justify-center gap-2 rounded-md bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:from-purple-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {reactivationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Reativar assinatura
            </button>
          ) : null}

          {supportUrl ? (
            <a
              href={supportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent"
            >
              <MessageCircle className="h-4 w-4" />
              Falar com suporte
            </a>
          ) : null}
        </div>
      </section>

      <AlertDialog open={reactivationConfirmationOpen} onOpenChange={setReactivationConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar reativação</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">
                A assinatura será reativada, um novo ciclo de cobrança será iniciado e o acesso operacional do
                projeto será liberado novamente. A cobrança seguirá a forma de pagamento cadastrada.
              </span>
              <span className="mt-3 block rounded-md border border-border bg-muted/50 p-3 text-left">
                <span className="block font-medium text-foreground">
                  Plano que será reativado: {reactivationPlanSummary.planName}
                </span>
                <span className="mt-1 block text-muted-foreground">
                  Valor mensal: {reactivationPlanSummary.priceLabel}
                </span>
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reactivationLoading}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={reactivationLoading}
              onClick={onReactivateSubscription}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {reactivationLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar reativação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default BillingCanceledState;
