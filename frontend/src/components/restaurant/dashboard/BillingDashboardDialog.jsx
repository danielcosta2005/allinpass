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
import { Button } from '@/components/ui/button';
import { useBillingUsageDashboard } from '@/hooks/useBillingUsageDashboard';

const STATUS_TONE = {
  current: 'border-primary/20 bg-primary/10 text-primary',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  pending: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300',
  open: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300',
  draft: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300',
  past_due: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300',
  failed: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300',
  canceled: 'border-border bg-muted text-muted-foreground',
  refunded: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-300',
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
    <div className="rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
      <p className="font-semibold text-foreground">{row.name}</p>
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
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-purple-600 dark:text-primary" />
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatInteger(row?.total)} de {formatInteger(row?.allowance)} incluídos
          </p>
        </div>
        {row?.overageUsage > 0 ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300">
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

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
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
    ? 'border-primary/30 bg-primary/10 text-foreground'
    : 'border-border bg-card text-foreground';

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
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
          ? 'border-primary/40 bg-primary/10'
          : 'border-border bg-card hover:border-primary/30 hover:bg-accent/60'
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{formatPeriod(cycle)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-foreground">{formatCurrencyFromCents(cycle.totalInvoiceCents)}</p>
        <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${getStatusTone(cycle.status)}`}>
          {title.replace('Fatura ', '')}
        </span>
      </div>
    </button>
  );
}

function CancelPlanSection({
  action,
  canManageBilling,
  isBillingCanceled,
  onSchedulePlanCancellation,
  onUndoPlanCancellation,
  pendingPlanChange,
  subscription,
}) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  if (!canManageBilling || !subscription) return null;

  const isCancellationPending = pendingPlanChange?.changeType === 'cancellation';
  const hasOtherPendingChange = Boolean(
    pendingPlanChange
      && pendingPlanChange.effectiveMode === 'next_cycle'
      && pendingPlanChange.changeType !== 'cancellation',
  );
  const periodEndLabel = formatDate(pendingPlanChange?.currentPeriodEnd || subscription.currentPeriodEnd);
  const periodText = periodEndLabel || 'fim do período de cobrança';
  const isScheduling = action === 'schedule';
  const isUndoing = action === 'undo';
  const isBusy = Boolean(action);

  return (
    <>
      <section className="border-t border-border pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <h3 className="text-base font-semibold text-foreground">
              {isBillingCanceled ? 'Assinatura cancelada' : isCancellationPending ? 'Cancelamento agendado' : 'Cancelar plano'}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {isBillingCanceled
                ? 'Este plano já foi cancelado. Não há outro cancelamento para agendar.'
                : isCancellationPending
                  ? `Seu plano continua ativo até ${periodText}.`
                  : 'Se você cancelar, continuará com acesso total aos recursos do seu plano até o fim do período de cobrança.'}
            </p>
            {hasOtherPendingChange ? (
              <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                Existe uma mudança de plano agendada. Se confirmar o cancelamento, ela será substituída.
              </p>
            ) : null}
          </div>

          {isCancellationPending ? (
            <Button
              type="button"
              variant="outline"
              className="min-w-[132px] border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
              disabled={isBusy || isBillingCanceled}
              onClick={onUndoPlanCancellation}
            >
              {isUndoing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Manter assinatura
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="min-w-[132px] border-rose-500 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-400 dark:text-rose-300 dark:hover:bg-rose-500/10"
              disabled={isBusy || isBillingCanceled}
              onClick={() => setConfirmationOpen(true)}
            >
              {isScheduling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cancelar
            </Button>
          )}
        </div>
      </section>

      <AlertDialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar cancelamento</AlertDialogTitle>
            <AlertDialogDescription>
              O cancelamento será agendado para {periodText}. Até lá, o projeto continua com acesso aos recursos do plano atual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={isBusy || isBillingCanceled}
              onClick={onSchedulePlanCancellation}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {isScheduling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function BillingDashboardDialog({
  canManageBilling = false,
  isBillingCanceled = false,
  onOpenChange,
  onSchedulePlanCancellation,
  onUndoPlanCancellation,
  open,
  pendingPlanChange = null,
  planCancellationAction = '',
  projectId,
}) {
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
      <DialogContent className="max-h-[92vh] overflow-y-auto bg-card p-0 sm:max-w-6xl">
        <div ref={topRef} className="bg-gradient-to-b from-background to-primary/5 px-5 py-8 dark:from-card dark:to-background sm:px-8">
          <DialogHeader className="mx-auto max-w-3xl text-center">
            <span className="mx-auto inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase text-primary">
              Faturamento
            </span>
            <DialogTitle className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Uso e faturas
            </DialogTitle>
            <DialogDescription>
              Acompanhe assinatura, excedente e consumo por ciclo.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-8 space-y-6">
            {billingUsageError ? (
              <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                <div className="min-w-0">
                  <p>{billingUsageError}</p>
                  <button
                    type="button"
                    className="mt-2 inline-flex text-xs font-semibold text-rose-800 underline dark:text-rose-200"
                    onClick={refreshBillingUsageDashboard}
                  >
                    Tentar novamente
                  </button>
                </div>
              </div>
            ) : null}

            {billingUsageLoading ? (
              <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando faturamento
              </div>
            ) : selectedCycle ? (
              <>
                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusTone(selectedCycle.status)}`}>
                        {selectedCycleTitle}
                      </span>
                      <h2 className="mt-3 text-2xl font-bold text-foreground">
                        {formatCurrencyFromCents(selectedCycle.totalInvoiceCents)}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">{formatPeriod(selectedCycle)}</p>
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

                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-purple-600 dark:text-primary" />
                    <h3 className="text-base font-semibold text-foreground">Faturas anteriores</h3>
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
                    <div className="mt-4 rounded-md border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
                      Nenhuma fatura anterior encontrada.
                    </div>
                  )}
                </section>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-muted p-6 text-center text-sm text-muted-foreground">
                Nenhum ciclo de faturamento encontrado.
              </div>
            )}

            <CancelPlanSection
              action={planCancellationAction}
              canManageBilling={canManageBilling}
              isBillingCanceled={isBillingCanceled}
              onSchedulePlanCancellation={onSchedulePlanCancellation}
              onUndoPlanCancellation={onUndoPlanCancellation}
              pendingPlanChange={pendingPlanChange}
              subscription={billingUsageData.subscription}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BillingDashboardDialog;
