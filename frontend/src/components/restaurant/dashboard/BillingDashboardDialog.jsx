import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bell, Loader2, Receipt, RotateCcw, WalletCards } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useBillingUsageDashboard } from '@/hooks/useBillingUsageDashboard';

const STATUS_TONE = {
  current: 'border-purple-200 bg-purple-50 text-purple-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  open: 'border-amber-200 bg-amber-50 text-amber-700',
  draft: 'border-amber-200 bg-amber-50 text-amber-700',
  past_due: 'border-rose-200 bg-rose-50 text-rose-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
  canceled: 'border-slate-200 bg-slate-50 text-slate-600',
  refunded: 'border-sky-200 bg-sky-50 text-sky-700',
};

const INVOICE_STATUS_LABELS = {
  current: 'Fatura atual',
  paid: 'Fatura paga',
  pending: 'Fatura pendente',
  open: 'Fatura pendente',
  draft: 'Fatura pendente',
  past_due: 'Fatura em atraso',
  failed: 'Fatura falhou',
  canceled: 'Fatura cancelada',
  refunded: 'Fatura reembolsada',
  no_overage: 'Fatura sem excedente',
};

const PERCENT_AXIS_TICKS = [25, 50, 75, 100];

function formatCurrencyFromCents(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0) / 100);
}

function formatInteger(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatPercentAxis(value) {
  return `${Math.round(Number(value || 0))}%`;
}

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

function formatPeriod(cycle) {
  const start = formatDate(cycle?.periodStart);
  const end = formatDate(cycle?.periodEnd);
  if (start && end) return `${start} a ${end}`;
  return start || end || 'Período não informado';
}

function getStatusTone(status) {
  return STATUS_TONE[status] || STATUS_TONE.pending;
}

function getCycleDisplayTitle(cycle) {
  if (!cycle) return INVOICE_STATUS_LABELS.no_overage;
  return cycle.title || INVOICE_STATUS_LABELS[cycle.status] || INVOICE_STATUS_LABELS.pending;
}

function buildUsageChartData(cycle, resource) {
  if (!cycle) return { data: [], allowance: 0, chartMax: 1 };

  const quantity = resource === 'notifications'
    ? cycle.notificationSentQuantity
    : cycle.passInstallQuantity;
  const allowance = resource === 'notifications'
    ? cycle.includedNotificationSends
    : cycle.includedPassInstalls;
  const overageQuantity = resource === 'notifications'
    ? cycle.notificationSentOverageQuantity
    : cycle.passInstallOverageQuantity;
  const unitOverageCents = resource === 'notifications'
    ? cycle.overageNotificationSentCents
    : cycle.overagePassInstallCents;
  const overageCents = resource === 'notifications'
    ? cycle.notificationSentOverageCents
    : cycle.passInstallOverageCents;
  const includedUsage = Math.min(quantity, allowance);
  const percentBase = allowance > 0 ? allowance : Math.max(quantity, 1);
  const includedUsagePercent = allowance > 0 ? (includedUsage / percentBase) * 100 : 0;
  const overageUsagePercent = overageQuantity > 0 ? (overageQuantity / percentBase) * 100 : 0;
  const totalUsagePercent = includedUsagePercent + overageUsagePercent;
  const chartMax = Math.max(totalUsagePercent, 100, 1);

  return {
    allowance,
    chartMax,
    data: [{
      name: resource === 'notifications' ? 'Notificações' : 'Instalações de cartão',
      total: quantity,
      allowance,
      includedUsage,
      includedUsagePercent,
      overageUsage: overageQuantity,
      overageUsagePercent,
      unitOverageCents,
      overageCents,
    }],
  };
}

function UsageTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-lg">
      <p className="font-semibold text-slate-950">{row.name}</p>
      <p className="mt-1">Uso total: {formatInteger(row.total)}</p>
      <p>Franquia: {formatInteger(row.allowance)}</p>
      <p>Excedente: {formatInteger(row.overageUsage)}</p>
      <p>Valor unitário do excedente: {formatCurrencyFromCents(row.unitOverageCents)}</p>
      <p>Valor cobrado: {formatCurrencyFromCents(row.overageCents)}</p>
    </div>
  );
}

function UsageBarChart({ cycle, icon: Icon, resource, title }) {
  const { allowance, chartMax, data } = useMemo(
    () => buildUsageChartData(cycle, resource),
    [cycle, resource],
  );
  const row = data[0];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {formatInteger(row?.total)} de {formatInteger(row?.allowance)} incluídos
          </p>
        </div>
        {row?.overageUsage > 0 ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
            +{formatCurrencyFromCents(row.overageCents)} de excedente
          </span>
        ) : null}
      </div>

      <div className="mt-4 h-36">
        <ResponsiveContainer>
          <BarChart layout="vertical" data={data} margin={{ top: 8, right: 72, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} domain={[0, chartMax]} ticks={PERCENT_AXIS_TICKS} tickFormatter={formatPercentAxis} />
            <YAxis type="category" dataKey="name" hide width={0} />
            <Tooltip content={<UsageTooltip />} />
            <ReferenceLine x={100} stroke="#94a3b8" strokeDasharray="4 4" />
            <Bar dataKey="includedUsagePercent" name="Franquia consumida" stackId="usage" fill="#16a34a" radius={[4, 0, 0, 4]}>
              <LabelList dataKey="includedUsage" position="insideRight" formatter={formatInteger} fill="#ffffff" />
            </Bar>
            <Bar dataKey="overageUsagePercent" name="Excedente" stackId="usage" fill="#f59e0b" radius={[0, 4, 4, 0]}>
              <LabelList dataKey="overageUsage" position="right" formatter={(value) => Number(value || 0) > 0 ? formatInteger(value) : ''} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#16a34a]" />
          Franquia consumida
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#f59e0b]" />
          Excedente cobrado
        </span>
      </div>
    </div>
  );
}

function AmountTile({ label, value, tone = 'default' }) {
  const toneClass = tone === 'strong'
    ? 'border-purple-200 bg-purple-50 text-purple-950'
    : 'border-slate-200 bg-white text-slate-950';

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold">{formatCurrencyFromCents(value)}</p>
    </div>
  );
}

function HistoryItem({ cycle, isSelected, onSelect }) {
  const title = getCycleDisplayTitle(cycle);

  return (
    <button
      type="button"
      onClick={() => onSelect(cycle.id)}
      className={`flex w-full items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition ${
        isSelected
          ? 'border-purple-300 bg-purple-50'
          : 'border-slate-200 bg-white hover:border-purple-200 hover:bg-purple-50/50'
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-950">{title}</p>
        <p className="mt-1 text-xs text-slate-500">{formatPeriod(cycle)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-slate-950">{formatCurrencyFromCents(cycle.totalInvoiceCents)}</p>
        <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${getStatusTone(cycle.status)}`}>
          {title.replace('Fatura ', '')}
        </span>
      </div>
    </button>
  );
}

function BillingDashboardDialog({ open, onOpenChange, projectId }) {
  const topRef = useRef(null);
  const [selectedCycleId, setSelectedCycleId] = useState(null);
  const {
    billingUsageData,
    billingUsageError,
    billingUsageLoading,
    refreshBillingUsageDashboard,
  } = useBillingUsageDashboard({ projectId, open });
  const cycles = billingUsageData.cycles || [];
  const selectedCycle = cycles.find((cycle) => cycle.id === selectedCycleId)
    || cycles.find((cycle) => cycle.id === billingUsageData.currentCycleId)
    || cycles[0]
    || null;
  const currentCycle = cycles.find((cycle) => cycle.id === billingUsageData.currentCycleId) || null;
  const historicalCycles = cycles.filter((cycle) => !cycle.isCurrent);
  const selectedCycleTitle = getCycleDisplayTitle(selectedCycle);

  useEffect(() => {
    if (!open) return;
    setSelectedCycleId(billingUsageData.currentCycleId || cycles[0]?.id || null);
  }, [billingUsageData.currentCycleId, cycles, open]);

  const handleSelectCycle = (cycleId) => {
    setSelectedCycleId(cycleId);
    window.setTimeout(() => {
      topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-6xl">
        <div ref={topRef} className="bg-gradient-to-b from-white to-purple-50/40 px-5 py-8 sm:px-8">
          <DialogHeader className="mx-auto max-w-3xl text-center">
            <span className="mx-auto inline-flex rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold uppercase text-purple-700">
              Faturamento
            </span>
            <DialogTitle className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Uso e faturas
            </DialogTitle>
            <DialogDescription>
              Acompanhe assinatura, excedente e consumo por ciclo.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-8 space-y-6">
            {billingUsageError ? (
              <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                <div className="min-w-0">
                  <p>{billingUsageError}</p>
                  <button
                    type="button"
                    className="mt-2 inline-flex text-xs font-semibold text-rose-800 underline"
                    onClick={refreshBillingUsageDashboard}
                  >
                    Tentar novamente
                  </button>
                </div>
              </div>
            ) : null}

            {billingUsageLoading ? (
              <div className="flex items-center gap-2 rounded-md border border-purple-100 bg-purple-50 p-4 text-sm text-purple-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando faturamento
              </div>
            ) : selectedCycle ? (
              <>
                <section className="rounded-xl border border-purple-100 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusTone(selectedCycle.status)}`}>
                        {selectedCycleTitle}
                      </span>
                      <h2 className="mt-3 text-2xl font-bold text-slate-950">
                        {formatCurrencyFromCents(selectedCycle.totalInvoiceCents)}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">{formatPeriod(selectedCycle)}</p>
                    </div>

                    {!selectedCycle.isCurrent && currentCycle ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2 self-start"
                        onClick={() => handleSelectCycle(currentCycle.id)}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Ver fatura atual
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <AmountTile label="Assinatura" value={selectedCycle.basePriceCents} />
                    <AmountTile label="Excedente" value={selectedCycle.overageCents} />
                    <AmountTile label="Total da fatura" value={selectedCycle.totalInvoiceCents} tone="strong" />
                  </div>
                </section>

                <div className="grid gap-4 lg:grid-cols-2">
                  <UsageBarChart
                    cycle={selectedCycle}
                    icon={Bell}
                    resource="notifications"
                    title="Notificações"
                  />
                  <UsageBarChart
                    cycle={selectedCycle}
                    icon={WalletCards}
                    resource="pass_installs"
                    title="Instalações de cartão"
                  />
                </div>

                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-purple-600" />
                    <h3 className="text-base font-semibold text-slate-950">Faturas anteriores</h3>
                  </div>

                  {historicalCycles.length > 0 ? (
                    <div className="mt-4 grid gap-3">
                      {historicalCycles.map((cycle) => (
                        <HistoryItem
                          key={cycle.id}
                          cycle={cycle}
                          isSelected={selectedCycle.id === cycle.id}
                          onSelect={handleSelectCycle}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      Nenhuma fatura anterior encontrada.
                    </div>
                  )}
                </section>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                Nenhum ciclo de faturamento encontrado.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BillingDashboardDialog;
