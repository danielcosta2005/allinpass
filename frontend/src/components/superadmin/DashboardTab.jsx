import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowUpRight,
  Award,
  BarChart,
  Briefcase,
  CalendarClock,
  CreditCard,
  Info,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Users,
  WalletCards,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from '@/components/ui/use-toast';
import { getGlobalKpis, getGlobalKpisTimeseries } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatCurrencyFromCents, formatInteger, getSuperadminFinancialOverview } from '@/lib/superadminFinance';

const tooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.5rem',
  color: 'hsl(var(--popover-foreground))',
};

const compactFormatter = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const moneyAxisFormatter = (value) => compactFormatter.format(Number(value || 0));

const HELP_TEXT = {
  totalProjects: [
    'Quantidade total de projetos cadastrados na base administrativa.',
    'Fórmula: contagem de registros em projetos.',
  ],
  totalCustomers: [
    'Quantidade total de clientes vinculados aos projetos da plataforma.',
    'Fórmula: contagem de registros de clientes.',
  ],
  totalVisits: [
    'Quantidade acumulada de visitas e interações registradas no histórico operacional.',
    'Fórmula: contagem de registros de visitas.',
  ],
  rewardsDelivered: [
    'Total de recompensas efetivamente liberadas para clientes.',
    'Fórmula: contagem de eventos de recompensa desbloqueada.',
  ],
  activeRecurringRevenue: [
    'Receita recorrente mensal ativa é a mensalidade contratada das assinaturas pagas em estado ativo.',
    'Fórmula: soma do preço base mensal das assinaturas pagas ativas; períodos gratuitos, cancelados e expirados ficam fora.',
  ],
  potentialCycleRevenue: [
    'Receita potencial do ciclo estima o valor financeiro do ciclo atual.',
    'Fórmula: mensalidade contratada + receita excedente projetada.',
  ],
  projectedExcessRevenue: [
    'Receita excedente projetada é a cobrança variável do ciclo pelo uso acima da franquia contratada.',
    'Fórmula: excedente de instalações de cartão x valor unitário + excedente de notificações x valor unitário.',
  ],
  revenueAtRisk: [
    'Receita em risco estima valores com risco de não recebimento por atraso, suspensão ou outro alerta financeiro.',
    'Fórmula operacional: mensalidade contratada + receita excedente do ciclo para projetos em risco.',
  ],
  freePeriods: [
    'Períodos gratuitos ativos são contas em avaliação, sem receita recorrente reconhecida como assinatura paga.',
    'Fórmula: contagem de assinaturas em período gratuito.',
  ],
  paidSubscriptions: [
    'Assinaturas pagas ativas indicam projetos com contrato remunerado em situação ativa.',
    'Fórmula: contagem de assinaturas ativas com mensalidade maior que zero e plano diferente do período gratuito.',
  ],
  pendingPlanChanges: [
    'Alterações de plano pendentes indicam mudanças solicitadas, criadas ou pagas que ainda não foram aplicadas definitivamente.',
    'Fórmula: contagem de sessões de alteração de plano em aberto.',
  ],
  highRiskProjects: [
    'Projetos de alto risco agrupam contas com sinais financeiros críticos, como pagamento pendente, suspensão, período gratuito expirado ou ausência de assinatura.',
    'Fórmula: contagem de projetos classificados com severidade alta pela consulta administrativa.',
  ],
  globalActivity: [
    'Evolução mensal do uso operacional da plataforma.',
    'Fórmula: visitas e recompensas liberadas agrupadas por mês nos últimos 6 meses.',
  ],
  cycleFinancialComposition: [
    'Compara as principais parcelas financeiras do ciclo atual.',
    'Fórmula: receita recorrente ativa, receita excedente projetada e receita em risco, todas convertidas de centavos para reais.',
  ],
  subscriptionStatus: [
    'Mostra a distribuição administrativa da situação das assinaturas.',
    'Fórmula: contagem de projetos por status financeiro: pagas ativas, período gratuito, pagamento pendente, suspensas, expiradas e sem assinatura.',
  ],
  planDistribution: [
    'Mostra a concentração de projetos por plano contratado.',
    'Fórmula: contagem de projetos agrupados pelo plano financeiro atual.',
  ],
  riskDistribution: [
    'Resume a severidade do risco financeiro-operacional dos projetos.',
    'Fórmula: contagem de projetos por nível de risco alto, médio e baixo calculado no backend.',
  ],
  usagePressure: [
    'Lista os projetos que mais pressionam franquia e cobrança excedente.',
    'Fórmula de ordenação: maior percentual entre uso de cartões e notificações + parcela ponderada da receita excedente.',
  ],
};

function centsToCurrencyValue(value) {
  const cents = Number(value || 0);
  return Number.isFinite(cents) ? cents / 100 : 0;
}

function getPercentValue(...values) {
  return Math.max(
    0,
    ...values.map((value) => {
      const parsed = Number(value || 0);
      return Number.isFinite(parsed) ? parsed : 0;
    }),
  );
}

function truncateLabel(value, maxLength = 18) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function HelpButton({ label = 'Como este indicador é calculado', content }) {
  const lines = Array.isArray(content) ? content : [content].filter(Boolean);
  if (lines.length === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:border-primary/40 hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1 text-xs leading-relaxed">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

const KpiCard = ({ title, value, icon: Icon, tone = 'primary', delay = 0, helper, help }) => {
  const toneClass = {
    amber: 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300',
    blue: 'bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300',
    emerald: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
    pink: 'bg-pink-500/10 text-pink-700 ring-pink-500/20 dark:text-pink-300',
    primary: 'bg-primary/10 text-primary ring-primary/20',
    purple: 'bg-purple-500/10 text-purple-700 ring-purple-500/20 dark:text-purple-300',
    rose: 'bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300',
    sky: 'bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300',
  }[tone] || 'bg-primary/10 text-primary ring-primary/20';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
            <HelpButton content={help} />
          </div>
          <p className="mt-2 truncate text-2xl font-bold tabular-nums text-foreground">{value}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {helper ? <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{helper}</p> : null}
    </motion.div>
  );
};

function SkeletonBlock({ className }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} />;
}

function DashboardSkeleton({ showFinancialKpis }) {
  const cardCount = showFinancialKpis ? 8 : 4;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-3">
          <SkeletonBlock className="h-8 w-64" />
          <SkeletonBlock className="h-5 w-80 max-w-full" />
        </div>
        <SkeletonBlock className="h-9 w-28" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: cardCount }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-3">
                <SkeletonBlock className="h-3 w-28" />
                <SkeletonBlock className="h-7 w-24" />
              </div>
              <SkeletonBlock className="h-10 w-10" />
            </div>
            <SkeletonBlock className="mt-4 h-3 w-36" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {Array.from({ length: showFinancialKpis ? 4 : 1 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <SkeletonBlock className="h-5 w-56" />
            <SkeletonBlock className="mt-2 h-4 w-72 max-w-full" />
            <SkeletonBlock className="mt-6 h-72 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartCard({ title, description, children, delay = 0, help }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm"
    >
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-foreground">{title}</h3>
          <HelpButton content={help} />
        </div>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="mt-4 h-80 w-full">
        {children}
      </div>
    </motion.section>
  );
}

function EmptyChart({ label = 'Sem dados suficientes para este gráfico.' }) {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function FinancialErrorNotice({ message }) {
  if (!message) return null;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
      <p className="font-semibold">Resumo financeiro indisponível</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}

const DashboardTab = ({ showFinancialKpis = false }) => {
  const [kpis, setKpis] = useState(null);
  const [financialOverview, setFinancialOverview] = useState(null);
  const [financialError, setFinancialError] = useState('');
  const [timeseries, setTimeseries] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFinancialError('');

    let financialRequest = Promise.resolve({ data: null, error: null });
    if (showFinancialKpis) {
      financialRequest = getSuperadminFinancialOverview()
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: null, error }));
    }

    try {
      const [kpisData, timeseriesData, financialResult] = await Promise.all([
        getGlobalKpis(),
        getGlobalKpisTimeseries(6),
        financialRequest,
      ]);

      setKpis(kpisData || {});
      setTimeseries((timeseriesData || []).map((item) => ({
        ...item,
        month: new Date(item.month).toLocaleString('pt-BR', { month: 'short', year: '2-digit' }),
      })));

      if (financialResult?.error) {
        setFinancialOverview(null);
        const message = financialResult.error.message || 'Não foi possível buscar os dados financeiros.';
        setFinancialError(message);
        toast({
          title: 'Erro ao carregar resumo financeiro',
          description: message,
          variant: 'destructive',
        });
      } else {
        setFinancialOverview(financialResult?.data || null);
      }
    } catch (error) {
      toast({
        title: 'Erro ao carregar KPIs',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [showFinancialKpis]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const financialKpis = financialOverview?.kpis || null;
  const financialProjects = financialOverview?.projects || [];

  const operationalCards = useMemo(() => ([
    { title: 'Projetos cadastrados', value: formatInteger(kpis?.projects), icon: Briefcase, tone: 'purple', helper: 'Carteira total de projetos na plataforma.', help: HELP_TEXT.totalProjects },
    { title: 'Clientes cadastrados', value: formatInteger(kpis?.customers), icon: Users, tone: 'blue', helper: 'Clientes únicos vinculados aos projetos.', help: HELP_TEXT.totalCustomers },
    { title: 'Visitas registradas', value: formatInteger(kpis?.visits), icon: BarChart, tone: 'pink', helper: 'Interações registradas no histórico global.', help: HELP_TEXT.totalVisits },
    { title: 'Benefícios concedidos', value: formatInteger(kpis?.rewards_unlocked), icon: Award, tone: 'emerald', helper: 'Recompensas efetivamente liberadas.', help: HELP_TEXT.rewardsDelivered },
  ]), [kpis]);

  const financialCards = useMemo(() => {
    if (!financialKpis) return [];

    return [
      {
        title: 'Receita recorrente ativa',
        value: formatCurrencyFromCents(financialKpis.mrrActiveCents),
        icon: CreditCard,
        tone: 'emerald',
        helper: `${formatInteger(financialKpis.paidActiveProjects)} assinaturas pagas ativas`,
        help: HELP_TEXT.activeRecurringRevenue,
      },
      {
        title: 'Receita potencial do ciclo',
        value: formatCurrencyFromCents(financialKpis.potentialCycleRevenueCents),
        icon: TrendingUp,
        tone: 'primary',
        helper: 'Mensalidade contratada somada à receita excedente projetada.',
        help: HELP_TEXT.potentialCycleRevenue,
      },
      {
        title: 'Receita excedente projetada',
        value: formatCurrencyFromCents(financialKpis.overageProjectedCents),
        icon: ArrowUpRight,
        tone: 'sky',
        helper: `${formatInteger(financialKpis.projectsWithOverage)} projetos com excedente`,
        help: HELP_TEXT.projectedExcessRevenue,
      },
      {
        title: 'Receita em risco',
        value: formatCurrencyFromCents(financialKpis.revenueAtRiskCents),
        icon: ShieldAlert,
        tone: 'rose',
        helper: `${formatInteger(financialKpis.pastDueProjects)} pendentes e ${formatInteger(financialKpis.suspendedProjects)} suspensos`,
        help: HELP_TEXT.revenueAtRisk,
      },
      {
        title: 'Períodos gratuitos ativos',
        value: formatInteger(financialKpis.activeTrials),
        icon: CalendarClock,
        tone: 'amber',
        helper: `${formatInteger(financialKpis.expiredTrials)} períodos gratuitos expirados`,
        help: HELP_TEXT.freePeriods,
      },
      {
        title: 'Assinaturas pagas',
        value: formatInteger(financialKpis.paidActiveProjects),
        icon: WalletCards,
        tone: 'emerald',
        helper: 'Projetos pagos em estado ativo.',
        help: HELP_TEXT.paidSubscriptions,
      },
      {
        title: 'Alterações de plano pendentes',
        value: formatInteger(financialKpis.pendingPlanChanges),
        icon: AlertTriangle,
        tone: 'amber',
        helper: 'Aumentos, reduções ou conversões ainda abertas.',
        help: HELP_TEXT.pendingPlanChanges,
      },
      {
        title: 'Projetos de alto risco',
        value: formatInteger(financialKpis.highRiskProjects),
        icon: ShieldAlert,
        tone: 'rose',
        helper: `${formatInteger(financialKpis.mediumRiskProjects)} em risco médio`,
        help: HELP_TEXT.highRiskProjects,
      },
    ];
  }, [financialKpis]);

  const financialCycleData = useMemo(() => {
    if (!financialKpis) return [];
    return [
      { name: 'Receita recorrente ativa', value: centsToCurrencyValue(financialKpis.mrrActiveCents), fill: '#059669' },
      { name: 'Receita excedente projetada', value: centsToCurrencyValue(financialKpis.overageProjectedCents), fill: '#0284c7' },
      { name: 'Receita em risco', value: centsToCurrencyValue(financialKpis.revenueAtRiskCents), fill: '#e11d48' },
    ];
  }, [financialKpis]);

  const subscriptionHealthData = useMemo(() => {
    if (!financialKpis) return [];
    const missingSubscription = financialProjects.filter((project) => !project.subscriptionId).length;
    return [
      { name: 'Pagas ativas', value: Number(financialKpis.paidActiveProjects || 0), fill: '#059669' },
      { name: 'Período gratuito', value: Number(financialKpis.activeTrials || 0), fill: '#d97706' },
      { name: 'Pagamento pendente', value: Number(financialKpis.pastDueProjects || 0), fill: '#f97316' },
      { name: 'Suspensas', value: Number(financialKpis.suspendedProjects || 0), fill: '#e11d48' },
      { name: 'Expiradas', value: Number(financialKpis.expiredTrials || 0), fill: '#7f1d1d' },
      { name: 'Sem assinatura', value: missingSubscription, fill: '#64748b' },
    ].filter((item) => item.value > 0);
  }, [financialKpis, financialProjects]);

  const planDistributionData = useMemo(() => {
    const counts = new Map();
    financialProjects.forEach((project) => {
      const label = project.planName || project.planCode || 'Sem plano';
      counts.set(label, (counts.get(label) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name))
      .slice(0, 8);
  }, [financialProjects]);

  const riskDistributionData = useMemo(() => {
    if (!financialKpis) return [];
    const high = Number(financialKpis.highRiskProjects || 0);
    const medium = Number(financialKpis.mediumRiskProjects || 0);
    const low = Math.max(0, Number(financialKpis.totalProjects || financialProjects.length || 0) - high - medium);

    return [
      { name: 'Alto', value: high, fill: '#e11d48' },
      { name: 'Médio', value: medium, fill: '#d97706' },
      { name: 'Baixo', value: low, fill: '#059669' },
    ].filter((item) => item.value > 0);
  }, [financialKpis, financialProjects.length]);

  const pressureData = useMemo(() => {
    return financialProjects
      .map((project) => {
        const usagePercent = getPercentValue(project.passUsagePercent, project.notificationUsagePercent);
        const overage = centsToCurrencyValue(project.totalOverageCents);
        const pressureScore = usagePercent + Math.min(overage / 10, 100);
        return {
          name: truncateLabel(project.projectName || project.projectId || 'Projeto'),
          usagePercent: Math.round(usagePercent),
          excessRevenue: overage,
          pressureScore,
        };
      })
      .filter((project) => project.usagePercent > 0 || project.excessRevenue > 0)
      .sort((left, right) => right.pressureScore - left.pressureScore)
      .slice(0, 5);
  }, [financialProjects]);

  if (loading) {
    return <DashboardSkeleton showFinancialKpis={showFinancialKpis} />;
  }

  return (
    <TooltipProvider>
      <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Painel Executivo Global</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Visão executiva de operação, engajamento e saúde financeira da aplicação.
          </p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="text-lg font-bold text-foreground">Operação</h3>
          <p className="text-sm text-muted-foreground">Base instalada, clientes, visitas e recompensas entregues.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {operationalCards.map((card, index) => (
            <KpiCard key={card.title} {...card} delay={0.08 * index} />
          ))}
        </div>
      </section>

      {showFinancialKpis && (
        <section className="space-y-3">
          <div>
            <h3 className="text-lg font-bold text-foreground">Resumo financeiro</h3>
            <p className="text-sm text-muted-foreground">Receita recorrente, receita excedente, períodos gratuitos, pendências e risco consolidado pela consulta administrativa.</p>
          </div>
          <FinancialErrorNotice message={financialError} />
          {financialKpis ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {financialCards.map((card, index) => (
                <KpiCard key={card.title} {...card} delay={0.08 * index} />
              ))}
            </div>
          ) : null}
        </section>
      )}

      <ChartCard
        title="Atividade Global nos Últimos 6 Meses"
        description="Visitas e recompensas desbloqueadas por mês."
        delay={0.1}
        help={HELP_TEXT.globalActivity}
      >
        {timeseries.length > 0 ? (
          <ResponsiveContainer>
            <AreaChart data={timeseries} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="visitsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="rewardsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16a34a" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={moneyAxisFormatter} />
              <RechartsTooltip contentStyle={tooltipStyle} formatter={(value) => formatInteger(value)} />
              <Legend />
              <Area type="monotone" dataKey="visits" name="Visitas" stroke="#2563eb" fill="url(#visitsGradient)" strokeWidth={2} />
              <Area type="monotone" dataKey="rewards" name="Recompensas" stroke="#16a34a" fill="url(#rewardsGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
      </ChartCard>

      {showFinancialKpis && financialKpis && (
        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard
            title="Composição financeira do ciclo"
            description="Comparação entre receita recorrente ativa, receita excedente projetada e receita em risco."
            delay={0.15}
            help={HELP_TEXT.cycleFinancialComposition}
          >
            <ResponsiveContainer>
              <RechartsBarChart data={financialCycleData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(value) => `R$ ${moneyAxisFormatter(value)}`} />
                <RechartsTooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrencyFromCents(Number(value || 0) * 100)} />
                <Bar dataKey="value" name="Valor" radius={[6, 6, 0, 0]}>
                  {financialCycleData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </RechartsBarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Situação das assinaturas"
            description="Distribuição de status financeiro dos projetos."
            delay={0.2}
            help={HELP_TEXT.subscriptionStatus}
          >
            {subscriptionHealthData.length > 0 ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={subscriptionHealthData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={70}
                    outerRadius={105}
                    paddingAngle={2}
                  >
                    {subscriptionHealthData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={tooltipStyle} formatter={(value) => formatInteger(value)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ChartCard>

          <ChartCard
            title="Distribuição por plano"
            description="Quantidade de projetos por plano financeiro."
            delay={0.25}
            help={HELP_TEXT.planDistribution}
          >
            {planDistributionData.length > 0 ? (
              <ResponsiveContainer>
                <RechartsBarChart data={planDistributionData} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={110} tickFormatter={(value) => truncateLabel(value, 16)} />
                  <RechartsTooltip contentStyle={tooltipStyle} formatter={(value) => formatInteger(value)} />
                  <Bar dataKey="value" name="Projetos" fill="#7c3aed" radius={[0, 6, 6, 0]} />
                </RechartsBarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ChartCard>

          <ChartCard
            title="Distribuição de risco"
            description="Projetos classificados por nível de risco financeiro."
            delay={0.3}
            help={HELP_TEXT.riskDistribution}
          >
            {riskDistributionData.length > 0 ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={riskDistributionData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={108}
                    label={({ name, value }) => `${name}: ${formatInteger(value)}`}
                  >
                    {riskDistributionData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={tooltipStyle} formatter={(value) => formatInteger(value)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ChartCard>

          <ChartCard
            title="5 principais projetos por pressão de uso e receita excedente"
            description="Projetos com maior combinação de consumo de franquia e excedente financeiro."
            delay={0.35}
            help={HELP_TEXT.usagePressure}
          >
            {pressureData.length > 0 ? (
              <ResponsiveContainer>
                <ComposedChart data={pressureData} margin={{ top: 10, right: 20, left: -5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" />
                  <YAxis yAxisId="money" tickFormatter={(value) => `R$ ${moneyAxisFormatter(value)}`} />
                  <YAxis yAxisId="usage" orientation="right" tickFormatter={(value) => `${value}%`} />
                  <RechartsTooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name) => {
                      if (name === 'Receita excedente') return formatCurrencyFromCents(Number(value || 0) * 100);
                      return `${formatInteger(value)}%`;
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="money" dataKey="excessRevenue" name="Receita excedente" fill="#0284c7" radius={[6, 6, 0, 0]} />
                  <Line yAxisId="usage" type="monotone" dataKey="usagePercent" name="Maior consumo" stroke="#e11d48" strokeWidth={2} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ChartCard>
        </div>
      )}
      </div>
    </TooltipProvider>
  );
};

export default DashboardTab;
