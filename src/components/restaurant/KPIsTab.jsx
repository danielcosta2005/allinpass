import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Users, TrendingUp, Award, Link as LinkIcon, Loader2, RefreshCw, Calendar as CalendarIcon } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getProjectAnalytics } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const periods = {
  '7d': { label: 'Últimos 7 dias' },
  '30d': { label: 'Últimos 30 dias' },
  'this_month': { label: 'Este Mês' },
  'last_month': { label: 'Mês Passado' },
};

const DOW_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const KPIsTab = ({ projectId }) => {
  const [stats, setStats] = useState({
    active_customers: 0,
    visits_this_cycle: 0,
    rewards_unlocked: 0,
    wallet_linked: 0,
  });
  const [analyticsData, setAnalyticsData] = useState({
    by_day_of_week: [],
    by_day_of_month: [],
    by_hour_of_day: [],
  });
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');

  const getDateRange = useCallback(() => {
    const now = new Date();
    let start = new Date();
    let end = new Date();
    end.setHours(23, 59, 59, 999); // End of today

    switch (period) {
      case '7d':
        start.setDate(now.getDate() - 6);
        break;
      case 'this_month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'last_month':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        end.setHours(23, 59, 59, 999);
        break;
      case '30d':
      default:
        start.setDate(now.getDate() - 29);
        break;
    }
    start.setHours(0, 0, 0, 0); // Start of the day
    return { start, end };
  }, [period]);

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      const data = await getProjectAnalytics(projectId, start, end);

      setStats(data.kpis || { active_customers: 0, visits_this_cycle: 0, rewards_unlocked: 0, wallet_linked: 0 });

      // Process analytics data
      const dowData = DOW_NAMES.map((name, index) => {
        const item = data.by_day_of_week?.find(d => d.day_of_week_num === index);
        return { name, Visitas: item?.visit_count || 0 };
      });
      
      const domData = Array.from({ length: 31 }, (_, i) => {
        const day = i + 1;
        const item = data.by_day_of_month?.find(d => d.day_of_month === day);
        return { name: day.toString(), Visitas: item?.visit_count || 0 };
      });

      const hodData = Array.from({ length: 24 }, (_, i) => {
        const hour = i;
        const item = data.by_hour_of_day?.find(d => d.hour_of_day === hour);
        return { name: `${hour.toString().padStart(2, '0')}:00`, Visitas: item?.visit_count || 0 };
      });

      setAnalyticsData({
        by_day_of_week: dowData,
        by_day_of_month: domData,
        by_hour_of_day: hodData,
      });

    } catch (error) {
      toast({
        title: "Erro ao buscar estatísticas",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, getDateRange, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  const cards = [
    { title: 'Clientes Ativos no Período', value: stats.active_customers, icon: Users, color: 'from-blue-500 to-cyan-500' },
    { title: 'Total de Visitas no Período', value: stats.visits_this_cycle, icon: TrendingUp, color: 'from-orange-500 to-yellow-500' },
    { title: 'Recompensas Entregues', value: stats.rewards_unlocked, icon: Award, color: 'from-green-500 to-emerald-500' },
    { title: 'Cartões na Wallet Adicionados', value: stats.wallet_linked, icon: LinkIcon, color: 'from-purple-500 to-pink-500' },
  ];

  const ChartCard = ({ title, data, dataKey, name }) => (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="bg-white rounded-2xl p-6 shadow-lg border border-purple-100"
    >
      <h3 className="text-lg font-bold mb-4">{title}</h3>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '0.5rem' }} />
            <Legend />
            <Bar dataKey={dataKey} name={name} fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h2 className="text-2xl font-bold">Indicadores de Performance</h2>
        <div className="flex items-center gap-2">
           <Select value={period} onValueChange={setPeriod}>
             <SelectTrigger className="w-[180px]">
               <CalendarIcon className="w-4 h-4 mr-2" />
               <SelectValue placeholder="Selecione o período" />
             </SelectTrigger>
             <SelectContent>
               {Object.entries(periods).map(([key, { label }]) => (
                 <SelectItem key={key} value={key}>{label}</SelectItem>
               ))}
             </SelectContent>
           </Select>
          <Button onClick={fetchData} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
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
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {cards.map((card, index) => (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="bg-white rounded-2xl p-6 shadow-lg border border-purple-100"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`bg-gradient-to-br ${card.color} p-3 rounded-xl`}>
                    <card.icon className="w-6 h-6 text-white" />
                  </div>
                </div>
                <h3 className="text-sm font-medium text-gray-600 mb-1">{card.title}</h3>
                <p className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
                  {card.value || 0}
                </p>
              </motion.div>
            ))}
          </div>

          <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
            <ChartCard title="Visitas por Dia da Semana" data={analyticsData.by_day_of_week} dataKey="Visitas" name="Visitas" />
            <ChartCard title="Visitas por Hora do Dia" data={analyticsData.by_hour_of_day} dataKey="Visitas" name="Visitas" />
          </div>

          <ChartCard title="Visitas por Dia do Mês" data={analyticsData.by_day_of_month} dataKey="Visitas" name="Visitas" />
        </>
      )}
    </div>
  );
};

export default KPIsTab;