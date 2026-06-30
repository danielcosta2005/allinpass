import React from 'react';
import { AlertTriangle } from 'lucide-react';

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

function BillingPastDueNotice({ subscription }) {
  const graceDate = formatDate(subscription?.graceEndsAt);

  return (
    <div className="mb-5 flex gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-700" />
      <div>
        <p className="font-semibold">Pagamento pendente</p>
        <p className="mt-1 text-amber-800">
          O acesso continua ativo durante o período de regularização
          {graceDate ? `, até ${graceDate}` : ''}. Regularize a cobrança pendente para evitar a suspensão.
        </p>
      </div>
    </div>
  );
}

export default BillingPastDueNotice;
