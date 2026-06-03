import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import BillingPlanChoiceCard from './BillingPlanChoiceCard';

const formatCurrencyBRL = (value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const PLAN_CHANGE_CONFIRMATION = {
  upgrade: {
    eyebrow: 'Upgrade',
    title: 'Confirmar upgrade de plano',
    description: 'Depois de confirmar esta operação, o upgrade:',
    items: [
      'dá franquia cheia do novo plano no ciclo atual',
      'cobra excedente usando o preço de excedente do novo plano',
    ],
  },
  downgrade: {
    eyebrow: 'Downgrade',
    title: 'Confirmar downgrade de plano',
    description: 'Depois de confirmar esta operação, o downgrade:',
    items: [
      'só vale no próximo ciclo',
      'até lá mantém franquia e preço do plano atual',
    ],
  },
  default: {
    eyebrow: 'Mudanca',
    title: 'Confirmar mudança de plano',
    description: 'Depois de confirmar esta operação, a mudança de plano será processada para este projeto.',
    items: [
      'o plano escolhido será validado antes da conclusão',
      'se houver etapa de checkout, você será redirecionado para finalizar',
    ],
  },
};

const getPlanPriceLabel = (plan) => {
  if (!plan) return '';
  return formatCurrencyBRL(plan.price || Number(plan.basePriceCents || 0) / 100);
};

const getConfirmationContent = (plan) =>
  PLAN_CHANGE_CONFIRMATION[plan?.changeKind] || PLAN_CHANGE_CONFIRMATION.default;

function BillingPlanDialog({
  billingActionPlanCode,
  billingError,
  billingLoading,
  billingPlanName,
  billingSubscription,
  onOpenChange,
  onStartPlanChange,
  open,
  planChangeOptions,
}) {
  const [pendingPlanChange, setPendingPlanChange] = useState(null);
  const confirmationContent = getConfirmationContent(pendingPlanChange);
  const isConfirmingPlan = pendingPlanChange && billingActionPlanCode === pendingPlanChange.code;
  const dialogDescription = pendingPlanChange
    ? `Revise a mudança para o plano ${pendingPlanChange.name}.`
    : billingSubscription
      ? `${billingPlanName} - ${formatCurrencyBRL(billingSubscription.basePriceCents / 100)}/mes`
      : 'Carregando dados do plano.';

  useEffect(() => {
    if (!open) setPendingPlanChange(null);
  }, [open]);

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen) setPendingPlanChange(null);
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={`max-h-[92vh] overflow-y-auto p-0 ${pendingPlanChange ? 'sm:max-w-2xl' : 'sm:max-w-6xl'}`}>
        <div className="bg-gradient-to-b from-white to-purple-50/40 px-5 py-8 sm:px-8">
          <DialogHeader className="mx-auto max-w-2xl text-center">
            <span className="mx-auto inline-flex rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold uppercase text-purple-700">
              {pendingPlanChange ? confirmationContent.eyebrow : 'Planos'}
            </span>
            <DialogTitle className="mt-3 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              {pendingPlanChange ? confirmationContent.title : 'Escolha seu plano'}
            </DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="mt-8 space-y-6">
            {billingError && (
              <div className="mx-auto flex max-w-3xl gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                <span>{billingError}</span>
              </div>
            )}

            {pendingPlanChange ? (
              <div className="mx-auto max-w-xl space-y-5">
                <div className="rounded-lg border border-purple-100 bg-white p-5 shadow-sm">
                  <div className="grid gap-3 text-sm text-gray-600 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase text-gray-400">Plano atual</p>
                      <p className="mt-1 font-semibold text-gray-900">{billingPlanName}</p>
                      {billingSubscription ? (
                        <p>{formatCurrencyBRL(billingSubscription.basePriceCents / 100)}/mes</p>
                      ) : null}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-purple-500">Novo plano</p>
                      <p className="mt-1 font-semibold text-gray-900">{pendingPlanChange.name}</p>
                      <p>{getPlanPriceLabel(pendingPlanChange)}/mes</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-purple-100 bg-white p-5 shadow-sm">
                  <p className="text-sm font-semibold text-gray-900">{confirmationContent.description}</p>
                  <ul className="mt-4 space-y-3">
                    {confirmationContent.items.map((item) => (
                      <li key={item} className="flex gap-3 text-sm text-gray-700">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-purple-600" />
                        <span>{item}.</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <DialogFooter className="gap-2 sm:justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => setPendingPlanChange(null)}
                    disabled={Boolean(billingActionPlanCode)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Voltar
                  </Button>
                  <Button
                    type="button"
                    className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700"
                    onClick={() => onStartPlanChange(pendingPlanChange)}
                    disabled={Boolean(billingActionPlanCode)}
                  >
                    {isConfirmingPlan ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Confirmar operação
                  </Button>
                </DialogFooter>
              </div>
            ) : billingLoading ? (
              <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-md border border-purple-100 bg-purple-50 p-4 text-sm text-purple-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando planos
              </div>
            ) : planChangeOptions.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-5">
                {planChangeOptions.map((plan) => (
                  <div key={plan.code} className="w-full sm:w-[300px] xl:w-[260px]">
                    <BillingPlanChoiceCard
                      plan={plan}
                      busy={billingActionPlanCode === plan.code}
                      disabled={Boolean(billingActionPlanCode)}
                      onSelect={(plan) => setPendingPlanChange(plan)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mx-auto max-w-3xl rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                Nao foi possivel carregar os planos disponiveis.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BillingPlanDialog;
