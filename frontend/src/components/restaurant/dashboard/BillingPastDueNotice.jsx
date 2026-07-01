import React from 'react';
import { AlertTriangle, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';

function formatDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(value));
  } catch (_) {
    return '';
  }
}

function BillingPastDueNotice({ onViewPendingInvoice, subscription }) {
  const graceDate = formatDate(subscription?.graceEndsAt);

  return (
    <>
      <div className="fixed top-20 left-4 right-4 z-40 flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg shadow-amber-900/10 sm:flex-row sm:items-center sm:justify-between lg:left-[calc(var(--dashboard-sidebar-width)+2rem)] lg:right-8 lg:top-6">
        <div className="flex min-w-0 gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-700" />
          <div className="min-w-0">
            <p className="font-semibold">Pagamento pendente</p>
            <p className="mt-1 text-amber-800">
              O acesso continua ativo durante o período de regularização
              {graceDate ? `, até ${graceDate}` : ''}. Regularize a cobrança pendente para evitar a suspensão.
              {' '}Trocar de plano fica disponível depois da confirmação do pagamento pendente.
            </p>
          </div>
        </div>

        {onViewPendingInvoice ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-2 border-amber-300 bg-white text-amber-900 hover:bg-amber-100 hover:text-amber-950"
            onClick={onViewPendingInvoice}
          >
            <Receipt className="h-4 w-4" />
            Ver pendência
          </Button>
        ) : null}
      </div>
      <div aria-hidden="true" className="h-40 sm:h-28 lg:h-24" />
    </>
  );
}

export default BillingPastDueNotice;
