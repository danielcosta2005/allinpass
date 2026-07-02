import React, {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  CreditCard,
  Download,
  Info,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  WalletCards,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/use-toast';
import {
  buildFinancialProjectsCsv,
  downloadCsv,
  formatCurrencyFromCents,
  formatDate,
  formatDateTime,
  formatInteger,
  formatPercent,
  getDaysUntil,
  getSuperadminFinancialOverview,
  getSuperadminProjectFinancialDetail,
} from '@/lib/superadminFinance';
import { cn } from '@/lib/utils';

const STATUS_LABELS = {
  active: 'Ativa',
  applied: 'Aplicada',
  canceled: 'Cancelada',
  cancelled: 'Cancelada',
  created: 'Criada',
  draft: 'Rascunho',
  expired: 'Expirada',
  failed: 'Falhou',
  open: 'Aberto',
  overdue: 'Vencida',
  past_due: 'Pagamento pendente',
  paused: 'Pausada',
  paid: 'Pago',
  pending: 'Pendente',
  processing: 'Em processamento',
  sent: 'Enviada',
  suspended: 'Suspensa',
  superseded: 'Substituída',
  trialing: 'Período gratuito',
  sem_assinatura: 'Sem assinatura',
  void: 'Anulada',
};

const STATUS_STYLES = {
  active: 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-white',
  applied: 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-white',
  paid: 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-white',
  trialing: 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-white',
  sent: 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-white',
  past_due: 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500 dark:text-white',
  paused: 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500 dark:text-white',
  pending: 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500 dark:text-white',
  processing: 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500 dark:text-white',
  created: 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500 dark:text-white',
  suspended: 'border-rose-600 bg-rose-600 text-white dark:border-rose-500 dark:bg-rose-500 dark:text-white',
  expired: 'border-rose-600 bg-rose-600 text-white dark:border-rose-500 dark:bg-rose-500 dark:text-white',
  failed: 'border-rose-600 bg-rose-600 text-white dark:border-rose-500 dark:bg-rose-500 dark:text-white',
  overdue: 'border-rose-600 bg-rose-600 text-white dark:border-rose-500 dark:bg-rose-500 dark:text-white',
  sem_assinatura: 'border-rose-600 bg-rose-600 text-white dark:border-rose-500 dark:bg-rose-500 dark:text-white',
  canceled: 'border-slate-600 bg-slate-600 text-white dark:border-slate-500 dark:bg-slate-500 dark:text-white',
  cancelled: 'border-slate-600 bg-slate-600 text-white dark:border-slate-500 dark:bg-slate-500 dark:text-white',
  superseded: 'border-slate-600 bg-slate-600 text-white dark:border-slate-500 dark:bg-slate-500 dark:text-white',
  open: 'border-slate-600 bg-slate-600 text-white dark:border-slate-500 dark:bg-slate-500 dark:text-white',
  draft: 'border-slate-600 bg-slate-600 text-white dark:border-slate-500 dark:bg-slate-500 dark:text-white',
  void: 'border-slate-600 bg-slate-600 text-white dark:border-slate-500 dark:bg-slate-500 dark:text-white',
};

const RISK_LABELS = {
  limite_atingido: 'Limite atingido',
  mudanca_pendente: 'Mudança pendente',
  ok: 'OK',
  overage: 'Consumo excedente',
  pagamento_atrasado: 'Pagamento atrasado',
  sem_assinatura: 'Sem assinatura',
  sem_ciclo: 'Sem ciclo',
  suspensa: 'Suspensa',
  trial_expirado: 'Período gratuito expirado',
  trial_expirando: 'Período gratuito expirando',
};

const RISK_LEVEL_LABELS = {
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
};

const RISK_STYLES = {
  high: 'border-rose-600 bg-rose-600 text-white dark:border-rose-500 dark:bg-rose-500 dark:text-white',
  medium: 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500 dark:text-white',
  low: 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-white',
};

const CHANGE_LABELS = {
  cancellation: 'Cancelamento',
  downgrade: 'Redução de plano',
  plan_change: 'Alteração de plano',
  trial_conversion: 'Conversão do período gratuito',
  upgrade: 'Aumento de plano',
};

const EFFECTIVE_MODE_LABELS = {
  immediate: 'Imediata',
  next_cycle: 'Próximo ciclo',
};

const AUDIT_ACTION_LABELS = {
  delete: 'Exclusão',
  insert: 'Criação',
  sync_gateway: 'Sincronização com intermediador',
  update: 'Atualização',
};

const AUDIT_TARGET_LABELS = {
  billing_accounts: 'Conta de cobrança',
  billing_cycle_usage_summaries: 'Resumo de uso do ciclo',
  billing_invoices: 'Fatura',
  billing_invoice_items: 'Item de fatura',
  billing_plan_change_sessions: 'Alteração de plano',
  billing_subscriptions: 'Assinatura',
  billing_usage_events: 'Evento de uso',
};

const RISK_RANK = {
  high: 3,
  medium: 2,
  low: 1,
};

const SORT_DEFAULT = {
  key: 'situation',
  direction: 'desc',
};

const INITIAL_FILTERS = {
  search: '',
  plan: 'all',
  status: 'all',
  risk: 'all',
  quickView: 'all',
};

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const HELP_TEXT = {
  activeMonthlyRevenue: [
    'Receita recorrente mensal ativa é a mensalidade contratada das assinaturas pagas em estado ativo.',
    'Equivalente operacional ao MRR. Fórmula: soma do preço base mensal das assinaturas pagas ativas; períodos gratuitos, cancelados e expirados ficam fora.',
  ],
  projectedExcessRevenue: [
    'Receita excedente projetada é a cobrança variável do ciclo atual pelo uso acima da franquia contratada.',
    'Fórmula: excedente de instalações de cartão x valor unitário + excedente de notificações x valor unitário.',
  ],
  revenueAtRisk: [
    'Receita em risco estima valores que podem não ser recebidos por atraso, suspensão, ausência de assinatura ou outro alerta financeiro.',
    'Fórmula operacional: mensalidade contratada + cobrança excedente do ciclo para projetos classificados em risco.',
  ],
  freePeriods: [
    'Períodos gratuitos são contas em avaliação, sem receita recorrente reconhecida como assinatura paga.',
    'Expirados indicam projetos que passaram do prazo e precisam converter ou regularizar o plano.',
  ],
  usage: [
    'Percentual de uso compara consumo acumulado com a franquia contratada para o ciclo.',
    'Acima de 100% há consumo excedente quando o plano prevê cobrança.',
  ],
  cardInstalls: [
    'Instalações de cartão representam cartões digitais adicionados pelos clientes no ciclo.',
    'A barra mostra quantidade usada, franquia incluída e eventual excedente.',
  ],
  notifications: [
    'Notificações enviadas são mensagens efetivamente disparadas e contabilizadas no ciclo financeiro.',
    'A barra mostra consumo contra a franquia e quantidade excedente.',
  ],
  billingPeriod: [
    'Período de competência do ciclo atual da assinatura.',
    'Os valores de mensalidade, uso e excedente exibidos pertencem a esse intervalo de datas.',
  ],
  planAndStatus: [
    'Plano é o contrato comercial vigente do projeto; status é a situação financeira local da assinatura.',
    'Estados como pagamento pendente, suspensão e período gratuito expirado ajudam a priorizar cobrança e suporte.',
  ],
  risk: [
    'Risco financeiro-operacional resume sinais como atraso, suspensão, ausência de ciclo, limite atingido ou mudança pendente.',
    'A severidade vem calculada no backend; o frontend apenas apresenta a classificação.',
  ],
  pendingChange: [
    'Pendência indica alteração de plano solicitada, paga ou criada que ainda não foi aplicada definitivamente.',
    'A variação de receita compara a mensalidade do novo plano com a mensalidade atual.',
  ],
  paymentIntermediary: [
    'Intermediador de pagamento é o provedor externo que processa cobrança e assinatura, como Asaas ou Stripe.',
    'IDs do intermediador servem para conciliação entre o Allinpass e o provedor.',
  ],
  contractedMonthlyFee: [
    'Mensalidade contratada é o preço base do plano no ciclo, antes de cobranças excedentes.',
  ],
  potentialCycleRevenue: [
    'Receita potencial do ciclo soma mensalidade contratada e cobrança excedente projetada.',
    'É uma projeção operacional, não necessariamente receita faturada ou recebida.',
  ],
  paymentTolerance: [
    'Período de tolerância é o prazo extra antes de bloquear ou suspender uma assinatura em atraso.',
  ],
  providerId: [
    'ID é o identificador único usado pelo intermediador de pagamento para localizar cliente ou assinatura.',
  ],
};

function normalizeFilterValue(value) {
  return String(value || '').trim().toLowerCase();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getStatusLabel(value) {
  const key = normalizeFilterValue(value);
  return STATUS_LABELS[key] || value || 'Sem assinatura';
}

function getRiskLabel(value) {
  const key = normalizeFilterValue(value);
  return RISK_LABELS[key] || value || 'OK';
}

function getRiskLevelLabel(value) {
  const key = normalizeFilterValue(value);
  return RISK_LEVEL_LABELS[key] || 'Baixo';
}

function getChangeLabel(value) {
  const key = normalizeFilterValue(value);
  return CHANGE_LABELS[key] || value || 'Mudança';
}

function getEffectiveModeLabel(value) {
  const key = normalizeFilterValue(value);
  return EFFECTIVE_MODE_LABELS[key] || value || 'Modo não informado';
}

function getAuditActionLabel(value) {
  const key = normalizeFilterValue(value);
  return AUDIT_ACTION_LABELS[key] || value || 'Evento';
}

function getAuditTargetLabel(value) {
  const key = normalizeFilterValue(value);
  return AUDIT_TARGET_LABELS[key] || value || '-';
}

function getUsagePercent({ used, included, percent }) {
  const parsedPercent = Number(percent);
  if (Number.isFinite(parsedPercent)) return parsedPercent;

  const usedAmount = toNumber(used);
  const includedAmount = toNumber(included);
  if (includedAmount <= 0) return null;
  return (usedAmount * 100) / includedAmount;
}

function getUsageState(percent, overageQuantity) {
  if (percent === null || percent === undefined) return 'muted';
  const numericPercent = Number(percent || 0);
  if (Number(overageQuantity || 0) > 0 || numericPercent >= 100) return 'danger';
  if (numericPercent >= 80) return 'warning';
  return 'ok';
}

function getUsageFillClass(state) {
  if (state === 'danger') return 'bg-rose-500';
  if (state === 'warning') return 'bg-amber-500';
  if (state === 'ok') return 'bg-emerald-500';
  return 'bg-muted-foreground/40';
}

function getProjectRiskReasons(project) {
  return Array.isArray(project?.riskReasons) ? project.riskReasons.filter(Boolean) : [];
}

function getDaysSince(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function formatDays(value) {
  if (value === null || value === undefined) return '';
  if (value === 0) return 'hoje';
  if (Math.abs(value) === 1) return '1 dia';
  return `${Math.abs(value)} dias`;
}

function getTrialTiming(project) {
  const status = normalizeFilterValue(project?.subscriptionStatus);
  if (!project?.trialEndsAt || !['trialing', 'expired'].includes(status)) return '';

  const days = getDaysUntil(project.trialEndsAt);
  if (days === null) return '';
  if (days < 0) return `expirou há ${formatDays(days)}`;
  if (days === 0) return 'vence hoje';
  return `vence em ${formatDays(days)}`;
}

function getPrimaryRiskMessage(project) {
  const reasons = getProjectRiskReasons(project);
  if (reasons.length > 0) return reasons[0];

  const status = normalizeFilterValue(project?.subscriptionStatus || 'sem_assinatura');
  if (project?.delinquentSince) {
    const days = getDaysSince(project.delinquentSince);
    return days === null ? 'Pagamento atrasado' : `Pagamento atrasado há ${formatDays(days)}`;
  }
  if (status === 'trialing' || status === 'expired') {
    return getTrialTiming(project) || getStatusLabel(status);
  }

  const riskStatus = normalizeFilterValue(project?.riskStatus);
  if (riskStatus && riskStatus !== 'ok') return getRiskLabel(riskStatus);
  return 'Sem alerta financeiro';
}

function isTrialCritical(project) {
  const status = normalizeFilterValue(project?.subscriptionStatus);
  if (!['trialing', 'expired'].includes(status) || !project?.trialEndsAt) return false;
  const days = getDaysUntil(project.trialEndsAt);
  return days !== null && days <= 2;
}

function isActionRequired(project) {
  const status = normalizeFilterValue(project?.subscriptionStatus || 'sem_assinatura');
  const riskLevel = normalizeFilterValue(project?.riskLevel);
  return (
    ['high', 'medium'].includes(riskLevel)
    || ['past_due', 'suspended', 'expired', 'sem_assinatura'].includes(status)
    || Number(project?.totalOverageCents || 0) > 0
    || Boolean(project?.pendingPlanChangeId)
    || isTrialCritical(project)
  );
}

function getActionPriority(project) {
  const riskLevel = normalizeFilterValue(project?.riskLevel);
  const trialDays = project?.trialEndsAt ? getDaysUntil(project.trialEndsAt) : null;
  const trialUrgency = trialDays === null ? 0 : Math.max(0, 10 - trialDays);
  return (
    (RISK_RANK[riskLevel] || 1) * 100000000
    + Math.min(Number(project?.revenueAtRiskCents || 0), 99999999)
    + Math.min(Number(project?.totalOverageCents || 0), 9999999)
    + (Boolean(project?.pendingPlanChangeId) ? 500000 : 0)
    + (isTrialCritical(project) ? 250000 : 0)
    + trialUrgency
  );
}

function compareValues(left, right, direction) {
  const multiplier = direction === 'asc' ? 1 : -1;
  if (typeof left === 'string' || typeof right === 'string') {
    return String(left || '').localeCompare(String(right || ''), 'pt-BR') * multiplier;
  }
  return (Number(left || 0) - Number(right || 0)) * multiplier;
}

function getSortValue(project, key) {
  if (key === 'project') return project.projectName || project.billingEmail || project.projectId || '';
  if (key === 'situation') return getActionPriority(project);
  if (key === 'cycle') return new Date(project.currentPeriodEnd || project.trialEndsAt || 0).getTime();
  if (key === 'revenue') {
    return (
      Number(project.revenueAtRiskCents || 0) * 3
      + Number(project.totalOverageCents || 0) * 2
      + Number(project.mrrActiveCents || 0)
    );
  }
  if (key === 'pending') return project.pendingPlanChangeId ? new Date(project.pendingChangeCreatedAt || 0).getTime() || 1 : 0;
  return getActionPriority(project);
}

function sortProjects(projects, sort) {
  return [...projects].sort((left, right) => {
    const compared = compareValues(
      getSortValue(left, sort.key),
      getSortValue(right, sort.key),
      sort.direction,
    );
    if (compared !== 0) return compared;
    return String(left.projectName || '').localeCompare(String(right.projectName || ''), 'pt-BR');
  });
}

function formatSignedCurrencyFromCents(value) {
  const cents = Number(value || 0);
  if (!Number.isFinite(cents) || cents === 0) return formatCurrencyFromCents(0);
  const prefix = cents > 0 ? '+' : '-';
  return `${prefix}${formatCurrencyFromCents(Math.abs(cents))}`;
}

function StableSelect({
  value,
  onValueChange,
  children,
  ariaLabel,
  disabled = false,
  className,
}) {
  const optionItems = React.Children.toArray(children).filter(React.isValidElement);

  return (
    <Select value={String(value)} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger aria-label={ariaLabel} className={cn('min-w-0 max-w-full', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {optionItems.map((option) => (
          <SelectItem
            key={option.key || option.props.value}
            value={String(option.props.value)}
            disabled={option.props.disabled}
          >
            {option.props.children}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AnimatedButtonText({ children }) {
  return (
    <span className="inline-flex font-bold">
      {Array.from(children).map((letter, index) => (
        <span
          key={`${letter}-${index}`}
          className="transition-colors duration-150 group-hover:text-primary"
          style={{ transitionDelay: `${index * 18}ms` }}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}

function InfoTooltip({ label, children, side = 'top', align = 'center' }) {
  const lines = Array.isArray(children) ? children : [children];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={`Informações sobre ${label}`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} align={align} className="z-[240] max-w-xs space-y-1.5 px-3 py-2 text-xs leading-relaxed">
        {lines.map((line, index) => (
          <p key={`${label}-${index}`}>{line}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function LabelWithInfo({ label, info, className, side, align }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span>{label}</span>
      {info ? <InfoTooltip label={label} side={side} align={align}>{info}</InfoTooltip> : null}
    </span>
  );
}

function SortableHeader({ label, info, sortKey, sort, onSort, className }) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  const SortIcon = active && sort.direction === 'asc' ? ChevronUp : ChevronDown;

  return (
    <th scope="col" aria-sort={ariaSort} className={cn('px-4 py-3 font-semibold', className)}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-1 rounded-md px-1 text-left transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          onClick={() => onSort(sortKey)}
        >
          <span>{label}</span>
          <SortIcon className={cn('h-3.5 w-3.5', active ? 'opacity-100' : 'opacity-35')} />
        </button>
        {info ? <InfoTooltip label={label} side="bottom" align="start">{info}</InfoTooltip> : null}
      </div>
    </th>
  );
}

function TableHeader({ label, info, className = 'px-4 py-3 font-semibold' }) {
  return (
    <th scope="col" className={className}>
      <LabelWithInfo label={label} info={info} side="bottom" align="start" />
    </th>
  );
}

function StatusBadge({ value, compact = false }) {
  const normalized = normalizeFilterValue(value || 'sem_assinatura');
  const className = STATUS_STYLES[normalized] || 'border-slate-600 bg-slate-600 text-white dark:border-slate-500 dark:bg-slate-500 dark:text-white';

  return (
    <span className={cn('inline-flex items-center rounded border font-semibold', compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs', className)}>
      {getStatusLabel(value)}
    </span>
  );
}

function PlanPill({ value }) {
  if (!value) return null;

  return (
    <span className="inline-flex max-w-full items-center rounded bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
      <span className="truncate">{value}</span>
    </span>
  );
}

function RiskLevelPill({ level, compact = false }) {
  const normalizedLevel = normalizeFilterValue(level || 'low');
  const Icon = normalizedLevel === 'high' ? ShieldAlert : normalizedLevel === 'medium' ? AlertTriangle : WalletCards;
  const className = RISK_STYLES[normalizedLevel] || RISK_STYLES.low;

  return (
    <span className={cn('inline-flex items-center gap-1 rounded border font-semibold', compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs', className)}>
      <Icon className={cn(compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
      {getRiskLevelLabel(level)}
    </span>
  );
}

function RiskBadge({ level, status, compact = false }) {
  const normalizedLevel = normalizeFilterValue(level || 'low');
  const Icon = normalizedLevel === 'high' ? ShieldAlert : normalizedLevel === 'medium' ? AlertTriangle : WalletCards;
  const className = RISK_STYLES[normalizedLevel] || RISK_STYLES.low;

  return (
    <span className={cn('inline-flex items-center gap-1 rounded border font-semibold', compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs', className)}>
      <Icon className={cn(compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
      {getRiskLevelLabel(level)} · {getRiskLabel(status)}
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, helper, info, tone = 'default' }) {
  const toneClass = tone === 'danger'
    ? 'bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300'
    : tone === 'warning'
      ? 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300'
      : tone === 'success'
        ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300'
        : 'bg-primary/10 text-primary ring-primary/20';

  return (
    <div className="rounded-md border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <LabelWithInfo label={label} info={info} align="start" />
          </p>
          <p className="mt-2 truncate text-2xl font-bold tabular-nums text-foreground">{value}</p>
        </div>
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md ring-1', toneClass)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {helper ? <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{helper}</p> : null}
    </div>
  );
}

function FinancialKpiGrid({ kpis }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon={CreditCard}
        label="Receita recorrente mensal"
        value={formatCurrencyFromCents(kpis.mrrActiveCents)}
        helper={`${formatInteger(kpis.paidActiveProjects)} projetos pagos ativos`}
        info={HELP_TEXT.activeMonthlyRevenue}
        tone="success"
      />
      <KpiCard
        icon={ArrowUpRight}
        label="Receita excedente projetada"
        value={formatCurrencyFromCents(kpis.overageProjectedCents)}
        helper={`${formatInteger(kpis.projectsWithOverage)} projetos com consumo excedente`}
        info={HELP_TEXT.projectedExcessRevenue}
      />
      <KpiCard
        icon={ShieldAlert}
        label="Receita em risco"
        value={formatCurrencyFromCents(kpis.revenueAtRiskCents)}
        helper={`${formatInteger(kpis.pastDueProjects)} pendentes · ${formatInteger(kpis.suspendedProjects)} suspensos`}
        info={HELP_TEXT.revenueAtRisk}
        tone="danger"
      />
      <KpiCard
        icon={CalendarClock}
        label="Períodos gratuitos"
        value={formatInteger(kpis.activeTrials)}
        helper={`${formatInteger(kpis.expiredTrials)} expirados`}
        info={HELP_TEXT.freePeriods}
        tone="warning"
      />
    </div>
  );
}

function UsageBar({ label, used, included, percent, overageQuantity, info, compact = false }) {
  const includedAmount = toNumber(included);
  const usedAmount = toNumber(used);
  const numericPercent = getUsagePercent({ used: usedAmount, included: includedAmount, percent });
  const width = numericPercent === null ? 0 : Math.max(0, Math.min(numericPercent, 100));
  const state = getUsageState(numericPercent, Number(overageQuantity || 0));
  const fillClass = getUsageFillClass(state);
  const hasAllowance = includedAmount > 0;
  const ariaProps = hasAllowance
    ? {
        role: 'meter',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': Math.round(numericPercent || 0),
        'aria-label': `${label}: ${formatInteger(usedAmount)} de ${formatInteger(includedAmount)}`,
      }
    : { 'aria-label': `${label}: franquia não configurada` };

  return (
    <div className={cn('w-full min-w-0', compact ? 'space-y-1.5' : 'space-y-1')} {...ariaProps}>
      <div className={cn('flex items-start justify-between gap-2 text-xs', compact && 'leading-tight')}>
        <span className="min-w-0 font-medium text-foreground">
          <LabelWithInfo label={label} info={info} align="start" />
        </span>
        <span className="shrink-0 text-right font-semibold tabular-nums text-muted-foreground">
          {hasAllowance ? `${formatInteger(usedAmount)} / ${formatInteger(includedAmount)}` : 'sem franquia'}
        </span>
      </div>
      <div className={cn('rounded-sm bg-muted', compact ? 'h-1.5' : 'h-2')}>
        <div className={cn('rounded-sm transition-all', compact ? 'h-1.5' : 'h-2', fillClass)} style={{ width: `${width}%` }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{hasAllowance ? formatPercent(numericPercent) : '-'}</span>
        {Number(overageQuantity || 0) > 0 ? <span className="shrink-0">+{formatInteger(overageQuantity)} excedente</span> : <span className="shrink-0">sem excedente</span>}
      </div>
    </div>
  );
}

function ProjectUsageCell({ project }) {
  return (
    <div className="w-full min-w-0 space-y-3">
      <UsageBar
        label="Instalações de cartão"
        used={project.passInstallQuantity}
        included={project.includedPassInstalls}
        percent={project.passUsagePercent}
        overageQuantity={project.passInstallOverageQuantity}
        compact
      />
      <UsageBar
        label="Notificações"
        used={project.notificationSentQuantity}
        included={project.includedNotificationSends}
        percent={project.notificationUsagePercent}
        overageQuantity={project.notificationSentOverageQuantity}
        compact
      />
    </div>
  );
}

function MoneyLine({ label, value, tone = 'default' }) {
  const cents = Number(value || 0);
  const className = cents <= 0
    ? 'text-muted-foreground'
    : tone === 'danger'
      ? 'text-rose-700 dark:text-rose-300'
      : tone === 'warning'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-foreground';

  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-semibold tabular-nums', className)}>{formatCurrencyFromCents(cents)}</span>
    </div>
  );
}

function RevenueMetric({ label, value, tone = 'default' }) {
  const cents = Number(value || 0);
  const className = cents <= 0
    ? 'text-muted-foreground'
    : tone === 'danger'
      ? 'text-rose-700 dark:text-rose-300'
      : tone === 'warning'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-foreground';

  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 whitespace-nowrap text-sm font-bold tabular-nums', className)}>{formatCurrencyFromCents(cents)}</p>
    </div>
  );
}

function ProjectRevenueCell({ project }) {
  return (
    <div className="space-y-1.5">
      <MoneyLine label="Mensalidade" value={project.mrrActiveCents} />
      <MoneyLine label="Excedente" value={project.totalOverageCents} tone="warning" />
      <MoneyLine label="Em risco" value={project.revenueAtRiskCents} tone="danger" />
    </div>
  );
}

function ProjectPendingChangeInline({ project }) {
  if (!project.pendingPlanChangeId) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 rounded border border-amber-600 bg-amber-600 px-2 py-0.5 font-semibold text-white dark:border-amber-500 dark:bg-amber-500 dark:text-white">
        <Clock3 className="h-3 w-3" />
        {getChangeLabel(project.pendingChangeType)}
      </span>
      <span className="text-muted-foreground">{project.pendingPlanName || project.pendingPlanCode || 'Plano não informado'}</span>
      {project.pendingMrrDeltaCents !== null && project.pendingMrrDeltaCents !== undefined ? (
        <span className="font-semibold tabular-nums text-foreground">{formatSignedCurrencyFromCents(project.pendingMrrDeltaCents)} MRR</span>
      ) : null}
    </div>
  );
}

function ProjectSituationCell({ project, showPending = false }) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <RiskLevelPill level={project.riskLevel} compact />
        <p className="font-semibold leading-tight text-foreground">{getStatusLabel(project.subscriptionStatus || 'sem_assinatura')}</p>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{getPrimaryRiskMessage(project)}</p>
      {showPending ? <ProjectPendingChangeInline project={project} /> : null}
    </div>
  );
}

function ProjectCycleCell({ project }) {
  const trialTiming = getTrialTiming(project);
  const updatedAt = project.lastUsageEventAt ? formatDateTime(project.lastUsageEventAt) : '';

  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">{formatDate(project.currentPeriodStart)} - {formatDate(project.currentPeriodEnd)}</p>
      {trialTiming ? <p>Trial: {trialTiming}</p> : null}
      {updatedAt ? <p>Uso atualizado {updatedAt}</p> : null}
    </div>
  );
}

function ProjectCycleRevenueCell({ project }) {
  const trialTiming = getTrialTiming(project);
  const updatedAt = project.lastUsageEventAt ? formatDateTime(project.lastUsageEventAt) : '';

  return (
    <div className="w-full min-w-0 space-y-3">
      <div className="flex items-start gap-2.5">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
          <p className="truncate font-semibold tabular-nums text-foreground">{formatDate(project.currentPeriodStart)} - {formatDate(project.currentPeriodEnd)}</p>
          {trialTiming ? <p>Trial: {trialTiming}</p> : null}
          {updatedAt ? <p className="truncate">Atualizado {updatedAt}</p> : null}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-3 gap-2 rounded-md bg-muted/40 px-3 py-3">
        <RevenueMetric label="Mensal" value={project.mrrActiveCents} />
        <RevenueMetric label="Exced." value={project.totalOverageCents} tone="warning" />
        <RevenueMetric label="Risco" value={project.revenueAtRiskCents} tone="danger" />
      </div>
    </div>
  );
}

function ProjectPendingChangeCell({ project }) {
  if (!project.pendingPlanChangeId) {
    return <span className="text-xs text-muted-foreground">Sem pendência</span>;
  }

  return (
    <div className="space-y-1.5">
      <span className="inline-flex items-center gap-1 rounded border border-amber-600 bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white dark:border-amber-500 dark:bg-amber-500 dark:text-white">
        <Clock3 className="h-3.5 w-3.5" />
        {getChangeLabel(project.pendingChangeType)}
      </span>
      <p className="text-xs text-muted-foreground">{project.pendingPlanName || project.pendingPlanCode || 'Plano não informado'}</p>
      {project.pendingMrrDeltaCents !== null && project.pendingMrrDeltaCents !== undefined ? (
        <p className="text-xs font-semibold tabular-nums text-foreground">{formatSignedCurrencyFromCents(project.pendingMrrDeltaCents)} MRR</p>
      ) : null}
    </div>
  );
}

function EmptyState({ title, description }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-8 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function DetailRow({ label, value, info, copyValue }) {
  const displayValue = value || '-';

  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">
        <LabelWithInfo label={label} info={info} align="start" />
      </span>
      <span className="flex max-w-[62%] items-start justify-end gap-2 text-right text-sm font-semibold text-foreground">
        <span className="break-all">{displayValue}</span>
        {copyValue ? <CopyButton value={copyValue} label={label} /> : null}
      </span>
    </div>
  );
}

function DrawerMetric({ label, value, helper, info }) {
  const helperContent = typeof helper === 'string'
    ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    : helper
      ? <div className="mt-2">{helper}</div>
      : null;

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <LabelWithInfo label={label} info={info} align="start" />
      </p>
      <p className={cn('mt-1 text-lg font-bold tabular-nums', value === formatCurrencyFromCents(0) ? 'text-muted-foreground' : 'text-foreground')}>{value}</p>
      {helperContent}
    </div>
  );
}

function CopyButton({ value, label }) {
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      toast({ title: 'Copiado', description: `${label} copiado para a área de transferência.` });
    } catch (error) {
      toast({
        title: 'Não foi possível copiar',
        description: error.message || 'Copie manualmente o valor exibido.',
        variant: 'destructive',
      });
    }
  }, [label, value]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={handleCopy}
      aria-label={`Copiar ${label}`}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

function FinancialDrawerSkeleton() {
  return (
    <div className="space-y-4" aria-live="polite">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="rounded-md border border-border bg-card p-4">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-4 space-y-3">
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FinancialProjectDrawer({ open, onOpenChange, project }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchDetail = useCallback(async () => {
    if (!open || !project?.projectId) return;

    setLoading(true);
    setErrorMessage('');
    setDetail(null);
    try {
      const payload = await getSuperadminProjectFinancialDetail(project.projectId);
      setDetail(payload);
    } catch (error) {
      setErrorMessage(error.message || 'Não foi possível carregar o detalhe financeiro.');
    } finally {
      setLoading(false);
    }
  }, [open, project?.projectId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const selectedProject = detail?.project || project;
  const currentCycle = detail?.currentCycle || null;
  const cycles = detail?.cycles || [];
  const changes = detail?.planChanges || [];
  const auditLogs = detail?.auditLogs || [];
  const riskReasons = Array.isArray(detail?.risk?.reasons)
    ? detail.risk.reasons
    : getProjectRiskReasons(selectedProject);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-5xl grid-rows-none flex-col gap-0 overflow-hidden p-0 sm:rounded-lg">
        <DialogHeader className="sticky top-0 z-10 border-b border-border bg-card px-5 py-4 pr-12 text-left">
          <div className="space-y-2">
            <DialogTitle className="text-xl">{selectedProject?.projectName || 'Projeto'}</DialogTitle>
            <DialogDescription>
              Detalhamento financeiro centralizado, uso do ciclo, pendências e eventos recentes.
            </DialogDescription>
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge value={selectedProject?.subscriptionStatus || 'sem_assinatura'} />
              <RiskBadge level={selectedProject?.riskLevel} status={selectedProject?.riskStatus} />
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <FinancialDrawerSkeleton />
          ) : errorMessage ? (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300" role="alert">
              <p className="font-semibold">Erro ao carregar detalhe</p>
              <p className="mt-1">{errorMessage}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={fetchDetail}>
                Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <section className="grid gap-3 md:grid-cols-3">
                <DrawerMetric
                  label="Plano contratado"
                  value={selectedProject?.planName || 'Sem plano'}
                  helper={<StatusBadge value={selectedProject?.subscriptionStatus || 'sem_assinatura'} />}
                  info={HELP_TEXT.planAndStatus}
                />
                <DrawerMetric
                  label="Receita recorrente mensal"
                  value={formatCurrencyFromCents(selectedProject?.mrrActiveCents)}
                  helper="Mensalidade ativa contratada"
                  info={HELP_TEXT.activeMonthlyRevenue}
                />
                <DrawerMetric
                  label="Receita em risco"
                  value={formatCurrencyFromCents(selectedProject?.revenueAtRiskCents)}
                  helper={<RiskBadge level={selectedProject?.riskLevel} status={selectedProject?.riskStatus} />}
                  info={HELP_TEXT.revenueAtRisk}
                />
              </section>

              <section className="rounded-md border border-border bg-card p-4">
                <h3 className="text-base font-semibold text-foreground">Resumo da assinatura</h3>
                <div className="mt-3">
                  <DetailRow label="Período de competência" value={`${formatDate(selectedProject?.currentPeriodStart)} - ${formatDate(selectedProject?.currentPeriodEnd)}`} info={HELP_TEXT.billingPeriod} />
                  <DetailRow label="Período gratuito termina em" value={selectedProject?.trialEndsAt ? `${formatDate(selectedProject.trialEndsAt)} (${getTrialTiming(selectedProject) || '-'})` : '-'} info={HELP_TEXT.freePeriods} />
                  <DetailRow label="E-mail de cobrança" value={selectedProject?.billingEmail} />
                  <DetailRow label="Intermediador de pagamento" value={selectedProject?.subscriptionGatewayProvider || selectedProject?.billingGatewayProvider} info={HELP_TEXT.paymentIntermediary} />
                  <DetailRow label="ID da assinatura no intermediador" value={selectedProject?.gatewaySubscriptionId} copyValue={selectedProject?.gatewaySubscriptionId} info={HELP_TEXT.providerId} />
                  <DetailRow label="ID do cliente no intermediador" value={selectedProject?.gatewayCustomerId} copyValue={selectedProject?.gatewayCustomerId} info={HELP_TEXT.providerId} />
                </div>
              </section>

              <section className="rounded-md border border-border bg-card p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-base font-semibold text-foreground">
                    <LabelWithInfo label="Uso do ciclo atual" info={HELP_TEXT.usage} align="start" />
                  </h3>
                  <span className="text-xs font-medium text-muted-foreground">
                    {currentCycle?.lastUsageEventAt || selectedProject?.lastUsageEventAt
                      ? `Atualizado ${formatDateTime(currentCycle?.lastUsageEventAt || selectedProject?.lastUsageEventAt)}`
                      : 'Sem atualização de uso'}
                  </span>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <UsageBar
                    label="Instalações de cartão"
                    used={currentCycle?.passInstallQuantity ?? selectedProject?.passInstallQuantity}
                    included={currentCycle?.includedPassInstalls ?? selectedProject?.includedPassInstalls}
                    percent={selectedProject?.passUsagePercent}
                    overageQuantity={currentCycle?.passInstallOverageQuantity ?? selectedProject?.passInstallOverageQuantity}
                    info={HELP_TEXT.cardInstalls}
                  />
                  <UsageBar
                    label="Notificações"
                    used={currentCycle?.notificationSentQuantity ?? selectedProject?.notificationSentQuantity}
                    included={currentCycle?.includedNotificationSends ?? selectedProject?.includedNotificationSends}
                    percent={selectedProject?.notificationUsagePercent}
                    overageQuantity={currentCycle?.notificationSentOverageQuantity ?? selectedProject?.notificationSentOverageQuantity}
                    info={HELP_TEXT.notifications}
                  />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <DrawerMetric label="Mensalidade contratada" value={formatCurrencyFromCents(selectedProject?.basePriceCents)} info={HELP_TEXT.contractedMonthlyFee} />
                  <DrawerMetric label="Cobrança excedente" value={formatCurrencyFromCents(currentCycle?.totalOverageCents ?? selectedProject?.totalOverageCents)} info={HELP_TEXT.projectedExcessRevenue} />
                  <DrawerMetric label="Receita potencial do ciclo" value={formatCurrencyFromCents(selectedProject?.potentialCycleRevenueCents)} info={HELP_TEXT.potentialCycleRevenue} />
                </div>
              </section>

              <section className="rounded-md border border-border bg-card p-4">
                <h3 className="text-base font-semibold text-foreground">
                  <LabelWithInfo label="Risco financeiro-operacional" info={HELP_TEXT.risk} align="start" />
                </h3>
                {riskReasons.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {riskReasons.map((reason) => (
                      <div key={reason} className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-foreground">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        <span>{reason}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum risco financeiro relevante no momento.</p>
                )}
                <div className="mt-3">
                  <DetailRow label="Inadimplente desde" value={formatDateTime(selectedProject?.delinquentSince)} />
                  <DetailRow label="Fim do período de tolerância" value={formatDateTime(selectedProject?.graceEndsAt)} info={HELP_TEXT.paymentTolerance} />
                  <DetailRow label="Suspensa em" value={formatDateTime(selectedProject?.suspendedAt)} />
                  <DetailRow label="Última falha de pagamento" value={formatDateTime(selectedProject?.lastPaymentFailureAt)} />
                  <DetailRow label="Motivo" value={selectedProject?.delinquencyReason} />
                </div>
              </section>

              <section className="rounded-md border border-border bg-card p-4">
                <h3 className="text-base font-semibold text-foreground">Ciclos recentes</h3>
                {cycles.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum ciclo consolidado encontrado.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[42rem] text-left text-sm">
                      <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <TableHeader label="Período" info={HELP_TEXT.billingPeriod} className="py-2 pr-4 font-semibold" />
                          <TableHeader label="Uso" info={HELP_TEXT.usage} className="py-2 pr-4 font-semibold" />
                          <TableHeader label="Excedente" info={HELP_TEXT.projectedExcessRevenue} className="py-2 pr-4 font-semibold" />
                          <th scope="col" className="py-2 pr-4 font-semibold">Fatura</th>
                          <th scope="col" className="py-2 pr-0 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {cycles.map((cycle) => (
                          <tr key={cycle.usageSummaryId}>
                            <td className="py-3 pr-4 text-foreground">{formatDate(cycle.periodStart)} - {formatDate(cycle.periodEnd)}</td>
                            <td className="py-3 pr-4 text-muted-foreground">{formatInteger(cycle.passInstallQuantity)} cartões / {formatInteger(cycle.notificationSentQuantity)} notificações</td>
                            <td className="py-3 pr-4 font-semibold tabular-nums text-foreground">{formatCurrencyFromCents(cycle.totalOverageCents)}</td>
                            <td className="py-3 pr-4 text-muted-foreground">{cycle.invoiceNumber || '-'}</td>
                            <td className="py-3 pr-0"><StatusBadge value={cycle.collectionBatchStatus || cycle.invoiceStatus || (cycle.isCurrentCycle ? 'active' : 'open')} compact /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-md border border-border bg-card p-4">
                <h3 className="text-base font-semibold text-foreground">
                  <LabelWithInfo label="Alterações de plano" info={HELP_TEXT.pendingChange} align="start" />
                </h3>
                {changes.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Nenhuma alteração de plano recente.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {changes.map((change) => (
                      <div key={change.planChangeSessionId} className="rounded-md border border-border bg-background p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-foreground">{getChangeLabel(change.changeType)}</p>
                          <StatusBadge value={change.status} compact />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {change.previousPlanName || '-'} → {change.newPlanName || '-'} · {formatCurrencyFromCents(change.mrrDeltaCents)} de variação da receita mensal
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {getEffectiveModeLabel(change.effectiveMode)} · registrada em {formatDateTime(change.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-md border border-border bg-card p-4">
                <h3 className="text-base font-semibold text-foreground">Auditoria recente</h3>
                {auditLogs.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum evento de auditoria recente encontrado.</p>
                ) : (
                  <div className="mt-3 divide-y divide-border">
                    {auditLogs.map((log) => (
                      <div key={log.id} className="py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-foreground">{getAuditActionLabel(log.action)}</p>
                          <p className="text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</p>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{getAuditTargetLabel(log.targetTable)} · {log.targetId || '-'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FinancialQuickViews({ filters, counts, onChange }) {
  const options = [
    { value: 'all', label: 'Todos', count: counts.all },
    { value: 'action_required', label: 'Ação necessária', count: counts.actionRequired },
    { value: 'past_due', label: 'Pagamentos pendentes', count: counts.pastDue },
    { value: 'trials', label: 'Trials', count: counts.trials },
    { value: 'overage', label: 'Excedente', count: counts.overage },
    { value: 'pending', label: 'Mudanças pendentes', count: counts.pending },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md bg-muted/40 p-1" role="group" aria-label="Visões rápidas financeiras">
      {options.map((option) => {
        const selected = filters.quickView === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 shrink-0 gap-1.5 rounded px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-background/80 hover:text-foreground',
              selected && 'bg-background text-foreground ring-1 ring-border/60 hover:bg-background hover:text-foreground'
            )}
            onClick={() => onChange('quickView', option.value)}
            aria-pressed={selected}
          >
            {option.label}
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[11px] leading-none tabular-nums',
              selected ? 'bg-primary/10 text-primary' : 'bg-background/80 text-muted-foreground'
            )}>
              {formatInteger(option.count)}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function FinancialFilters({ filters, planOptions, onChange, onReset }) {
  const hasActiveFilters = Boolean(
    normalizeFilterValue(filters.search)
    || filters.plan !== 'all'
    || filters.status !== 'all'
    || filters.risk !== 'all'
    || filters.quickView !== 'all'
  );

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(18rem,1fr)_repeat(3,minmax(9.5rem,0.42fr))_auto]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(event) => onChange('search', event.target.value)}
          placeholder="Buscar por projeto, e-mail ou intermediador"
          className="h-9 bg-background pl-9"
          aria-label="Buscar por projeto, e-mail ou intermediador"
        />
      </div>
      <StableSelect
        value={filters.plan}
        onValueChange={(value) => onChange('plan', value)}
        ariaLabel="Filtrar por plano"
        className="h-9"
      >
        <option value="all">Todos os planos</option>
        {planOptions.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </StableSelect>
      <StableSelect
        value={filters.status}
        onValueChange={(value) => onChange('status', value)}
        ariaLabel="Filtrar por status"
        className="h-9"
      >
        <option value="all">Todos os status</option>
        <option value="active">Ativa</option>
        <option value="trialing">Período gratuito</option>
        <option value="past_due">Pagamento pendente</option>
        <option value="suspended">Suspensa</option>
        <option value="expired">Expirada</option>
        <option value="sem_assinatura">Sem assinatura</option>
      </StableSelect>
      <StableSelect
        value={filters.risk}
        onValueChange={(value) => onChange('risk', value)}
        ariaLabel="Filtrar por risco"
        className="h-9"
      >
        <option value="all">Todos os riscos</option>
        <option value="high">Alto</option>
        <option value="medium">Médio</option>
        <option value="low">Baixo</option>
      </StableSelect>
      <div className="flex min-h-9 items-center md:col-span-2 xl:col-span-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-full justify-center gap-1.5 px-2.5 text-xs text-muted-foreground transition-colors duration-150 sm:w-auto"
          onClick={onReset}
          disabled={!hasActiveFilters}
        >
          <X className="h-3.5 w-3.5" />
          Limpar
        </Button>
      </div>
    </div>
  );
}

function FinancialTableSkeleton() {
  return (
    <div className="divide-y divide-border" aria-live="polite">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="grid gap-5 bg-card px-6 py-5 lg:grid-cols-[1.35fr_1.2fr_1.45fr_1.25fr_0.7fr]">
          {Array.from({ length: 5 }).map((__, itemIndex) => (
            <div key={itemIndex} className="space-y-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const FinancialProjectRow = memo(function FinancialProjectRow({ project, onDetails }) {
  const cellClass = 'px-4 py-6 align-middle xl:px-5';
  const actionCellClass = 'px-4 py-6 align-middle text-center';

  return (
    <tr className="align-middle bg-card transition hover:bg-muted/30">
      <td className={cellClass}>
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-foreground">{project.projectName || '(Sem nome)'}</p>
          <p className="mt-2 truncate text-sm text-muted-foreground">{project.billingEmail || 'sem email de cobrança'}</p>
          <div className="mt-2">
            <PlanPill value={project.planName || 'Sem plano'} />
          </div>
        </div>
      </td>
      <td className={cellClass}>
        <ProjectSituationCell project={project} showPending />
      </td>
      <td className={cellClass}>
        <ProjectUsageCell project={project} />
      </td>
      <td className={cellClass}>
        <ProjectCycleRevenueCell project={project} />
      </td>
      <td className={actionCellClass}>
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="group mr-[5px] min-w-[6.75rem] whitespace-nowrap rounded px-3 transition hover:border-primary/60 hover:bg-primary/5 hover:text-foreground"
            onClick={() => onDetails(project.projectId)}
            aria-label={`Ver detalhes financeiros de ${project.projectName || 'projeto sem nome'}`}
          >
            <AnimatedButtonText>Detalhes</AnimatedButtonText>
            <ArrowUpRight className="ml-2 h-4 w-4 transition-colors delay-300 group-hover:text-primary" />
          </Button>
        </div>
      </td>
    </tr>
  );
});

function FinancialProjectCard({ project, onDetails }) {
  return (
    <article className="rounded-md border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{project.projectName || '(Sem nome)'}</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">{project.billingEmail || 'sem email de cobrança'}</p>
          <div className="mt-2">
            <PlanPill value={project.planName || 'Sem plano'} />
          </div>
        </div>
        <div className="flex shrink-0 justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="group rounded transition hover:border-primary/60 hover:bg-primary/5 hover:text-foreground"
            onClick={() => onDetails(project.projectId)}
            aria-label={`Ver detalhes financeiros de ${project.projectName || 'projeto sem nome'}`}
          >
            <AnimatedButtonText>Detalhes</AnimatedButtonText>
          </Button>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        <ProjectSituationCell project={project} />
        <ProjectCycleCell project={project} />
        <ProjectUsageCell project={project} />
        <ProjectRevenueCell project={project} />
        <ProjectPendingChangeCell project={project} />
      </div>
    </article>
  );
}

function FinancialProjectsTable({ projects, loading, sort, onSort, onDetails }) {
  if (loading) return <FinancialTableSkeleton />;

  if (projects.length === 0) {
    return (
      <div className="p-4">
        <EmptyState title="Nenhum projeto encontrado" description="Ajuste os filtros ou atualize os dados financeiros." />
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[1260px] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[18%]" />
            <col className="w-[22%]" />
            <col className="w-[28%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <SortableHeader label="Projeto" sortKey="project" sort={sort} onSort={onSort} className="px-4 xl:px-5" />
              <SortableHeader label="Situação" info={HELP_TEXT.risk} sortKey="situation" sort={sort} onSort={onSort} className="px-4 xl:px-5" />
              <TableHeader label="Consumo" info={HELP_TEXT.usage} className="px-4 py-3 font-semibold xl:px-5" />
              <SortableHeader label="Ciclo e Receita" info={HELP_TEXT.potentialCycleRevenue} sortKey="revenue" sort={sort} onSort={onSort} className="px-4 xl:px-5" />
              <th scope="col" className="px-4 py-3 text-center font-semibold">
                <span className="sr-only">Ação</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {projects.map((project) => (
              <FinancialProjectRow key={project.projectId} project={project} onDetails={onDetails} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 p-4 lg:hidden">
        {projects.map((project) => (
          <FinancialProjectCard key={project.projectId} project={project} onDetails={onDetails} />
        ))}
      </div>
    </>
  );
}

function PaginationControls({
  page,
  pageSize,
  pageCount,
  totalItems,
  onPageChange,
  onPageSizeChange,
}) {
  const firstItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(totalItems, page * pageSize);

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">
        Mostrando {formatInteger(firstItem)}-{formatInteger(lastItem)} de {formatInteger(totalItems)} projetos
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Linhas por página</span>
          <StableSelect
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
            ariaLabel="Linhas por página"
            className="h-9 w-[5.5rem]"
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={String(option)}>{option}</option>
            ))}
          </StableSelect>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            Anterior
          </Button>
          <span className="min-w-[5rem] text-center text-xs font-medium text-muted-foreground">
            {formatInteger(page)} / {formatInteger(pageCount)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}

function FinancialPlansTab() {
  const [overview, setOverview] = useState({ generatedAt: null, kpis: {}, projects: [] });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [sort, setSort] = useState(SORT_DEFAULT);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [drawerProjectId, setDrawerProjectId] = useState(null);
  const tableStartRef = useRef(null);
  const deferredSearch = useDeferredValue(filters.search);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await getSuperadminFinancialOverview();
      setOverview(payload);
    } catch (error) {
      toast({
        title: 'Erro ao carregar financeiro',
        description: error.message || 'Não foi possível buscar os dados financeiros.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const projects = overview.projects || [];
  const kpis = overview.kpis || {};

  const projectsById = useMemo(() => {
    const map = new Map();
    projects.forEach((project) => map.set(project.projectId, project));
    return map;
  }, [projects]);

  const drawerProject = drawerProjectId ? projectsById.get(drawerProjectId) || null : null;

  const planOptions = useMemo(() => {
    const names = new Map();
    projects.forEach((project) => {
      const key = project.planCode || project.planName;
      if (key) names.set(key, project.planName || project.planCode);
    });
    return [...names.entries()].sort((left, right) => left[1].localeCompare(right[1], 'pt-BR'));
  }, [projects]);

  const quickViewCounts = useMemo(() => {
    return projects.reduce((counts, project) => {
      const status = normalizeFilterValue(project.subscriptionStatus || 'sem_assinatura');
      counts.all += 1;
      if (isActionRequired(project)) counts.actionRequired += 1;
      if (status === 'past_due') counts.pastDue += 1;
      if (status === 'trialing' || status === 'expired') counts.trials += 1;
      if (Number(project.totalOverageCents || 0) > 0) counts.overage += 1;
      if (project.pendingPlanChangeId) counts.pending += 1;
      return counts;
    }, {
      all: 0,
      actionRequired: 0,
      pastDue: 0,
      trials: 0,
      overage: 0,
      pending: 0,
    });
  }, [projects]);

  const visibleProjects = useMemo(() => {
    const query = normalizeFilterValue(deferredSearch);

    const filtered = projects.filter((project) => {
      const searchable = [
        project.projectName,
        project.projectId,
        project.billingEmail,
        project.planName,
        project.planCode,
        project.gatewayCustomerId,
        project.gatewaySubscriptionId,
      ].map(normalizeFilterValue).join(' ');

      const status = normalizeFilterValue(project.subscriptionStatus || 'sem_assinatura');

      if (query && !searchable.includes(query)) return false;
      if (filters.plan !== 'all' && project.planCode !== filters.plan && project.planName !== filters.plan) return false;
      if (filters.status !== 'all' && status !== filters.status) return false;
      if (filters.risk !== 'all' && normalizeFilterValue(project.riskLevel) !== filters.risk) return false;
      if (filters.quickView === 'action_required' && !isActionRequired(project)) return false;
      if (filters.quickView === 'past_due' && status !== 'past_due') return false;
      if (filters.quickView === 'trials' && !['trialing', 'expired'].includes(status)) return false;
      if (filters.quickView === 'overage' && Number(project.totalOverageCents || 0) <= 0) return false;
      if (filters.quickView === 'pending' && !project.pendingPlanChangeId) return false;
      return true;
    });

    return sortProjects(filtered, sort);
  }, [
    deferredSearch,
    filters.plan,
    filters.quickView,
    filters.risk,
    filters.status,
    projects,
    sort,
  ]);

  const pageCount = Math.max(1, Math.ceil(visibleProjects.length / pageSize));
  const currentPage = Math.min(Math.max(page, 1), pageCount);

  const paginatedProjects = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return visibleProjects.slice(start, start + pageSize);
  }, [currentPage, pageSize, visibleProjects]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(current, 1), pageCount));
  }, [pageCount]);

  const handleExportCsv = useCallback(() => {
    const csv = buildFinancialProjectsCsv(visibleProjects);
    downloadCsv(`financeiro-superadmin-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }, [visibleProjects]);

  const handleFilterChange = useCallback((key, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const handleSort = useCallback((key) => {
    setPage(1);
    setSort((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'project' ? 'asc' : 'desc' };
    });
  }, []);

  const handleResetFilters = useCallback(() => {
    setPage(1);
    setFilters(INITIAL_FILTERS);
    setSort(SORT_DEFAULT);
  }, []);

  const handlePageSizeChange = useCallback((value) => {
    if (!PAGE_SIZE_OPTIONS.includes(value)) return;
    setPageSize(value);
    setPage(1);
  }, []);

  const scrollToTableStart = useCallback(() => {
    window.requestAnimationFrame(() => {
      tableStartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const handlePageChange = useCallback((value) => {
    setPage(Math.min(Math.max(value, 1), pageCount));
    scrollToTableStart();
  }, [pageCount, scrollToTableStart]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">Financeiro</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Acompanhamento financeiro por projeto, com priorização de inadimplência, excedente, uso de franquia, períodos gratuitos e alterações pendentes.
            </p>
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              Última atualização: {formatDateTime(overview.generatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleExportCsv} disabled={visibleProjects.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Exportar filtrados ({formatInteger(visibleProjects.length)})
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={fetchOverview} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Atualizar
            </Button>
          </div>
        </div>

        <FinancialKpiGrid kpis={kpis} />

        <div className="space-y-3 rounded-md border border-border/70 bg-card px-3 py-3 shadow-sm sm:px-4">
          <FinancialQuickViews filters={filters} counts={quickViewCounts} onChange={handleFilterChange} />
          <FinancialFilters
            filters={filters}
            planOptions={planOptions}
            onChange={handleFilterChange}
            onReset={handleResetFilters}
          />
        </div>

        <div ref={tableStartRef} className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-1 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-foreground">{formatInteger(visibleProjects.length)} projetos encontrados</p>
            <p className="text-xs text-muted-foreground">Ordenação inicial: maior risco financeiro e operacional</p>
          </div>
          <FinancialProjectsTable
            projects={paginatedProjects}
            loading={loading}
            sort={sort}
            onSort={handleSort}
            onDetails={setDrawerProjectId}
          />
          {!loading && visibleProjects.length > 0 ? (
            <PaginationControls
              page={currentPage}
              pageSize={pageSize}
              pageCount={pageCount}
              totalItems={visibleProjects.length}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : null}
        </div>

        <FinancialProjectDrawer
          open={Boolean(drawerProject)}
          onOpenChange={(open) => {
            if (!open) setDrawerProjectId(null);
          }}
          project={drawerProject}
        />
      </div>
    </TooltipProvider>
  );
}

export default FinancialPlansTab;
