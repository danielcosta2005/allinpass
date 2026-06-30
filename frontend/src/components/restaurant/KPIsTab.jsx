import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar as CalendarIcon,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getProjectAnalytics } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const periods = {
  '7d': { label: 'Últimos 7 dias' },
  '30d': { label: 'Últimos 30 dias' },
  '90d': { label: 'Último Trimestre' },
  '180d': { label: 'Último Semestre' },
  '365d': { label: 'Último Ano' },
};

const DOW_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const FREQUENCY_BUCKETS = [
  { key: '1', label: '1 visita' },
  { key: '2-3', label: '2-3 visitas' },
  { key: '4-9', label: '4-9 visitas' },
  { key: '10+', label: '10+ visitas' },
];
const FALLBACK_KPIS = {
  total_customers: 0,
  active_customers_period: 0,
  visits_in_period: 0,
  wallet_linked: 0,
  wallet_active_period: 0,
  rewards_unlocked_period: 0,
};
const EMPTY_ANALYTICS_DATA = {
  by_day_of_week: [],
  by_hour_of_day: [],
  visits_by_date: [],
  new_vs_returning_customers: [],
  visit_frequency_distribution: [],
  wallet_installs_by_date: [],
  wallet_removals_by_date: [],
};
const PERIOD_TO_DAYS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
};
const NUMBER_FORMATTER = new Intl.NumberFormat('pt-BR');
function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatInteger(value) {
  return NUMBER_FORMATTER.format(Math.round(normalizeNumber(value)));
}

function formatDateLabel(value) {
  const [year, month, day] = String(value || '').split('-');
  if (!year || !month || !day) return String(value || '');
  return `${day}/${month}`;
}

function getDateTicks(data) {
  const dates = normalizeArray(data).map((item) => item?.date).filter(Boolean);
  if (dates.length <= 10) return dates;

  const maxTicks = dates.length <= 31 ? 8 : dates.length <= 90 ? 10 : dates.length <= 180 ? 9 : 12;
  const step = Math.ceil((dates.length - 1) / Math.max(maxTicks - 1, 1));
  const ticks = dates.filter((_, index) => index % step === 0);
  const lastDate = dates[dates.length - 1];

  if (ticks[ticks.length - 1] !== lastDate) ticks.push(lastDate);
  return ticks;
}

function isPageVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.5rem',
  color: 'hsl(var(--popover-foreground))',
};

function getEntranceMotionProps(shouldAnimate, delay = 0.2) {
  if (!shouldAnimate) {
    return {
      initial: false,
      animate: { opacity: 1, y: 0 },
    };
  }

  return {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { delay },
  };
}

function normalizeKpis(rawKpis) {
  const kpis = rawKpis || {};
  return {
    total_customers: normalizeNumber(kpis.total_customers),
    active_customers_period: normalizeNumber(kpis.active_customers_period ?? kpis.active_customers),
    visits_in_period: normalizeNumber(kpis.visits_in_period ?? kpis.visits_this_cycle),
    wallet_linked: normalizeNumber(kpis.wallet_linked),
    wallet_active_period: normalizeNumber(kpis.wallet_active_period),
    rewards_unlocked_period: normalizeNumber(kpis.rewards_unlocked_period ?? kpis.rewards_unlocked),
  };
}

function normalizeDateSeries(rows, dateKeys, countKeys, label) {
  return normalizeArray(rows)
    .map((row) => {
      const date = dateKeys.map((key) => row?.[key]).find(Boolean);
      const count = countKeys.map((key) => row?.[key]).find((value) => value !== undefined && value !== null);
      return {
        date,
        name: formatDateLabel(date),
        [label]: normalizeNumber(count),
      };
    })
    .filter((row) => row.date);
}

function normalizeNewVsReturning(value) {
  if (Array.isArray(value)) {
    return value.map((row) => ({
      name: row?.name || row?.customer_type || row?.segment || 'Clientes',
      Clientes: normalizeNumber(row?.customer_count ?? row?.count ?? row?.value),
    }));
  }

  return [
    { name: 'Novos', Clientes: normalizeNumber(value?.new_customers ?? value?.new ?? value?.novos) },
    {
      name: 'Recorrentes',
      Clientes: normalizeNumber(value?.returning_customers ?? value?.returning ?? value?.recorrentes),
    },
  ];
}

function normalizeFrequencyDistribution(rows) {
  const byBucket = new Map(
    normalizeArray(rows).map((row) => [
      String(row?.bucket_key ?? row?.bucket ?? row?.name ?? '').toLowerCase(),
      normalizeNumber(row?.customer_count ?? row?.count ?? row?.value),
    ]),
  );

  return FREQUENCY_BUCKETS.map(({ key, label }) => ({
    name: label,
    Clientes: byBucket.get(key.toLowerCase()) ?? byBucket.get(label.toLowerCase()) ?? 0,
  }));
}

function hasPositiveValue(data, dataKey) {
  return normalizeArray(data).some((item) => normalizeNumber(item?.[dataKey]) > 0);
}

function ChartEmptyState() {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-muted text-sm text-muted-foreground">
      Sem dados no período
    </div>
  );
}

function ChartShell({ title, hasData, height = 300, shouldAnimate = true, animationDelay = 0.2, children }) {
  return (
    <motion.div
      {...getEntranceMotionProps(shouldAnimate, animationDelay)}
      className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20"
    >
      <h3 className="text-lg font-bold mb-4">{title}</h3>
      <div style={{ width: '100%', height }}>
        {hasData ? children : <ChartEmptyState />}
      </div>
    </motion.div>
  );
}

function BarChartCard({ title, data, dataKey, name, fill = '#8884d8', shouldAnimate = true }) {
  const hasData = hasPositiveValue(data, dataKey);

  return (
    <ChartShell title={title} hasData={hasData} shouldAnimate={shouldAnimate}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" />
          <YAxis allowDecimals={false} />
          <Tooltip
            formatter={(value) => [formatInteger(value), name]}
            contentStyle={CHART_TOOLTIP_STYLE}
          />
          <Legend />
          <Bar dataKey={dataKey} name={name} fill={fill} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

function HorizontalBarChartCard({ title, data, dataKey, name, fill = '#7c3aed', yAxisWidth = 140, shouldAnimate = true }) {
  const hasData = hasPositiveValue(data, dataKey);

  return (
    <ChartShell title={title} hasData={hasData} shouldAnimate={shouldAnimate}>
      <ResponsiveContainer>
        <BarChart layout="vertical" data={data} margin={{ top: 5, right: 40, left: 12, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={yAxisWidth} />
          <Tooltip
            formatter={(value) => [formatInteger(value), name]}
            contentStyle={CHART_TOOLTIP_STYLE}
          />
          <Bar dataKey={dataKey} name={name} fill={fill} radius={[0, 6, 6, 0]}>
            <LabelList dataKey={dataKey} position="right" formatter={formatInteger} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

function LineChartCard({ title, data, dataKey, name, stroke = '#2563eb', height = 300, shouldAnimate = true }) {
  const hasData = hasPositiveValue(data, dataKey);
  const dateTicks = getDateTicks(data);

  return (
    <ChartShell title={title} hasData={hasData} height={height} shouldAnimate={shouldAnimate}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            ticks={dateTicks}
            interval={0}
            minTickGap={16}
            tickFormatter={formatDateLabel}
          />
          <YAxis allowDecimals={false} />
          <Tooltip
            labelFormatter={(_, payload) => formatDateLabel(payload?.[0]?.payload?.date)}
            formatter={(value) => [formatInteger(value), name]}
            contentStyle={CHART_TOOLTIP_STYLE}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey={dataKey}
            name={name}
            stroke={stroke}
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

function WalletLifecycleChartCard({ title, data, shouldAnimate = true }) {
  const hasData = hasPositiveValue(data, 'Instalações') || hasPositiveValue(data, 'Remoções');
  const dateTicks = getDateTicks(data);

  return (
    <ChartShell title={title} hasData={hasData} height={340} shouldAnimate={shouldAnimate}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            ticks={dateTicks}
            interval={0}
            minTickGap={16}
            tickFormatter={formatDateLabel}
          />
          <YAxis allowDecimals={false} />
          <Tooltip
            labelFormatter={(_, payload) => formatDateLabel(payload?.[0]?.payload?.date)}
            formatter={(value, name) => [formatInteger(value), name]}
            contentStyle={CHART_TOOLTIP_STYLE}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="Instalações"
            name="Instalações"
            stroke="#16a34a"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="Remoções"
            name="Remoções"
            stroke="#dc2626"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

function MetricCard({ card, index, shouldAnimate = true }) {
  const Icon = card.icon;

  return (
    <motion.div
      {...getEntranceMotionProps(shouldAnimate, index * 0.06)}
      className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20"
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`bg-gradient-to-br ${card.color} p-3 rounded-xl`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
      <h3 className="text-sm font-medium text-muted-foreground mb-1">{card.title}</h3>
      <p className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
        {card.value}
      </p>
      {card.helper ? <p className="text-xs text-muted-foreground mt-2">{card.helper}</p> : null}
    </motion.div>
  );
}

const KPIsTab = ({ projectId }) => {
  const [stats, setStats] = useState(FALLBACK_KPIS);
  const [analyticsData, setAnalyticsData] = useState(EMPTY_ANALYTICS_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [animateContent, setAnimateContent] = useState(true);
  const [period, setPeriod] = useState('30d');
  const hasFetchedRef = useRef(false);

  const getDateRange = useCallback(() => {
    const now = new Date();
    const start = new Date();
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const days = PERIOD_TO_DAYS[period] || PERIOD_TO_DAYS['30d'];
    start.setDate(now.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }, [period]);

  const fetchData = useCallback(async ({ animate = false, showBlockingLoader = false } = {}) => {
    if (!projectId) {
      setStats(FALLBACK_KPIS);
      setAnalyticsData(EMPTY_ANALYTICS_DATA);
      setLoading(false);
      setRefreshing(false);
      hasFetchedRef.current = false;
      return;
    }

    const shouldBlock = showBlockingLoader || !hasFetchedRef.current;
    setAnimateContent(Boolean(animate && isPageVisible()));

    if (shouldBlock) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const { start, end } = getDateRange();
      const data = await getProjectAnalytics(projectId, start, end);
      const normalizedKpis = normalizeKpis(data?.kpis);

      setStats(normalizedKpis);

      const dowData = DOW_NAMES.map((name, index) => {
        const item = data?.by_day_of_week?.find((day) => Number(day.day_of_week_num) === index);
        return { name, Visitas: normalizeNumber(item?.visit_count) };
      });

      const hodData = Array.from({ length: 24 }, (_, hour) => {
        const item = data?.by_hour_of_day?.find((hourData) => Number(hourData.hour_of_day) === hour);
        return { name: `${hour.toString().padStart(2, '0')}:00`, Visitas: normalizeNumber(item?.visit_count) };
      });

      setAnalyticsData({
        by_day_of_week: dowData,
        by_hour_of_day: hodData,
        visits_by_date: normalizeDateSeries(
          data?.visits_by_date,
          ['visit_date', 'date', 'metric_date'],
          ['visit_count', 'visits', 'count'],
          'Visitas',
        ),
        new_vs_returning_customers: normalizeNewVsReturning(data?.new_vs_returning_customers),
        visit_frequency_distribution: normalizeFrequencyDistribution(data?.visit_frequency_distribution),
        wallet_installs_by_date: normalizeDateSeries(
          data?.wallet_installs_by_date,
          ['install_date', 'date', 'metric_date'],
          ['install_count', 'wallet_installs', 'count'],
          'Instalações',
        ),
        wallet_removals_by_date: normalizeDateSeries(
          data?.wallet_removals_by_date,
          ['removal_date', 'date', 'metric_date'],
          ['removal_count', 'wallet_removals', 'count'],
          'Remoções',
        ),
      });
    } catch (error) {
      toast({
        title: 'Erro ao buscar estatísticas',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      hasFetchedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, getDateRange]);

  useEffect(() => {
    const isFirstFetch = !hasFetchedRef.current;
    fetchData({ animate: isFirstFetch, showBlockingLoader: isFirstFetch });
  }, [fetchData]);

  const handleRefresh = useCallback(() => {
    fetchData({ animate: true, showBlockingLoader: true });
  }, [fetchData]);

  const cards = useMemo(() => {
    return [
      {
        title: 'Clientes Totais do Projeto',
        value: formatInteger(stats.total_customers),
        icon: Users,
        color: 'from-slate-500 to-gray-600',
      },
      {
        title: 'Clientes Ativos no Período',
        value: formatInteger(stats.active_customers_period),
        icon: Users,
        color: 'from-blue-500 to-cyan-500',
      },
      {
        title: 'Total de Visitas no Período',
        value: formatInteger(stats.visits_in_period),
        icon: TrendingUp,
        color: 'from-orange-500 to-yellow-500',
      },
      {
        title: 'Cartões Adicionados no Período',
        value: formatInteger(stats.wallet_linked),
        icon: LinkIcon,
        color: 'from-purple-500 to-pink-500',
      },
      {
        title: 'Cartões Ativos no Período',
        value: formatInteger(stats.wallet_active_period),
        icon: Wallet,
        color: 'from-green-500 to-emerald-500',
      },
    ];
  }, [stats]);

  const funnelData = useMemo(
    () => [
      { name: 'Clientes totais', Quantidade: stats.total_customers },
      { name: 'Cartões adicionados no período', Quantidade: stats.wallet_linked },
      { name: 'Cartões ativos no período', Quantidade: stats.wallet_active_period },
      { name: 'Clientes ativos', Quantidade: stats.active_customers_period },
      { name: 'Visitas', Quantidade: stats.visits_in_period },
    ],
    [stats],
  );
  const walletLifecycleData = useMemo(() => {
    const installsByDate = new Map(
      normalizeArray(analyticsData.wallet_installs_by_date).map((item) => [item.date, normalizeNumber(item['Instalações'])]),
    );
    const removalsByDate = new Map(
      normalizeArray(analyticsData.wallet_removals_by_date).map((item) => [item.date, normalizeNumber(item['Remoções'])]),
    );

    const dateSet = new Set([...installsByDate.keys(), ...removalsByDate.keys()]);

    return Array.from(dateSet)
      .sort()
      .map((date) => ({
        date,
        name: formatDateLabel(date),
        Instalações: installsByDate.get(date) ?? 0,
        Remoções: removalsByDate.get(date) ?? 0,
      }));
  }, [analyticsData.wallet_installs_by_date, analyticsData.wallet_removals_by_date]);

  const isBusy = loading || refreshing;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h2 className="text-2xl font-bold">Indicadores de Performance</h2>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[220px]">
              <CalendarIcon className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Selecione o período" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(periods).map(([key, { label }]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleRefresh} variant="outline" size="sm" disabled={isBusy}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isBusy ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {cards.map((card, index) => (
              <MetricCard key={card.title} card={card} index={index} shouldAnimate={animateContent} />
            ))}
          </div>

          <LineChartCard
            title="Evolução de Visitas no Período"
            data={analyticsData.visits_by_date}
            dataKey="Visitas"
            name="Visitas"
            stroke="#2563eb"
            height={360}
            shouldAnimate={animateContent}
          />

          <WalletLifecycleChartCard
            title="Instalações x Remoções de Wallet"
            data={walletLifecycleData}
            shouldAnimate={animateContent}
          />

          <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
            <HorizontalBarChartCard
              title="Funil de Conversão"
              data={funnelData}
              dataKey="Quantidade"
              name="Quantidade"
              fill="#7c3aed"
              yAxisWidth={190}
              shouldAnimate={animateContent}
            />
            <BarChartCard
              title="Clientes Ativos no Período: Novos vs Recorrentes"
              data={analyticsData.new_vs_returning_customers}
              dataKey="Clientes"
              name="Clientes"
              fill="#0ea5e9"
              shouldAnimate={animateContent}
            />
          </div>

          <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
            <BarChartCard
              title="Distribuição de Frequência"
              data={analyticsData.visit_frequency_distribution}
              dataKey="Clientes"
              name="Clientes"
              fill="#14b8a6"
              shouldAnimate={animateContent}
            />
            <BarChartCard
              title="Visitas por Dia da Semana"
              data={analyticsData.by_day_of_week}
              dataKey="Visitas"
              name="Visitas"
              shouldAnimate={animateContent}
            />
          </div>

          <BarChartCard
            title="Visitas por Hora do Dia"
            data={analyticsData.by_hour_of_day}
            dataKey="Visitas"
            name="Visitas"
            shouldAnimate={animateContent}
          />
        </>
      )}
    </div>
  );
};

export default KPIsTab;
