import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import BillingPlanChoiceCard from './BillingPlanChoiceCard';

const formatCurrencyBRL = (value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-6xl">
        <div className="bg-gradient-to-b from-white to-purple-50/40 px-5 py-8 sm:px-8">
          <DialogHeader className="mx-auto max-w-2xl text-center">
            <span className="mx-auto inline-flex rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold uppercase text-purple-700">
              Planos
            </span>
            <DialogTitle className="mt-3 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Escolha seu plano
            </DialogTitle>
            <DialogDescription>
              {billingSubscription
                ? `${billingPlanName} - ${formatCurrencyBRL(billingSubscription.basePriceCents / 100)}/mes`
                : 'Carregando dados do plano.'}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-8 space-y-6">
            {billingError && (
              <div className="mx-auto flex max-w-3xl gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                <span>{billingError}</span>
              </div>
            )}

            {billingLoading ? (
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
                      onSelect={onStartPlanChange}
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
