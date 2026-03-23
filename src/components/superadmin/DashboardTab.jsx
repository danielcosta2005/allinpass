import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Briefcase, Users, BarChart, Award, RefreshCw } from 'lucide-react';
import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from '@/components/ui/use-toast';
import { getGlobalKpis, getGlobalKpisTimeseries } from '@/lib/api';
import { Button } from '@/components/ui/button';

const KpiCard = ({ title, value, icon: Icon, color, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className="bg-white rounded-2xl p-6 shadow-lg border border-purple-100"
  >
    <div className="flex items-center justify-between">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <span className="text-3xl font-bold text-gray-800">{value}</span>
    </div>
    <p className="mt-4 text-md font-medium text-gray-600">{title}</p>
  </motion.div>
);

const DashboardTab = () => {
  const [kpis, setKpis] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [kpisData, timeseriesData] = await Promise.all([
        getGlobalKpis(),
        getGlobalKpisTimeseries(6)
      ]);
      setKpis(kpisData);
      const formattedTimeseries = timeseriesData.map(item => ({
        ...item,
        month: new Date(item.month).toLocaleString('default', { month: 'short', year: '2-digit' }),
      }));
      setTimeseries(formattedTimeseries);
    } catch (error) {
      toast({
        title: "Erro ao carregar KPIs",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard Global</h2>
          <p className="mt-1 text-lg text-gray-600">Uma visão geral de todo o sistema.</p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {kpis && (
          <>
            <KpiCard title="Total de Projetos" value={kpis.projects} icon={Briefcase} color="bg-purple-500" delay={0.1} />
            <KpiCard title="Total de Clientes" value={kpis.customers} icon={Users} color="bg-indigo-500" delay={0.2} />
            <KpiCard title="Total de Visitas" value={kpis.visits} icon={BarChart} color="bg-pink-500" delay={0.3} />
            <KpiCard title="Recompensas Entregues" value={kpis.rewards_unlocked} icon={Award} color="bg-green-500" delay={0.4} />
          </>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="bg-white rounded-2xl p-6 shadow-lg border border-purple-100"
      >
        <h3 className="text-lg font-bold mb-4">Atividade Global nos Últimos 6 Meses</h3>
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <RechartsBarChart data={timeseries} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '0.5rem' }} />
              <Legend />
              <Bar dataKey="visits" name="Visitas" fill="#8884d8" />
              <Bar dataKey="rewards" name="Recompensas" fill="#82ca9d" />
            </RechartsBarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    </div>
  );
};

export default DashboardTab;