import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { History, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { listVisits } from '@/lib/api';

const VisitsTab = ({ projectId }) => {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchVisits = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await listVisits(projectId);
      setVisits(data);
    } catch (error) {
      toast({
        title: "Erro ao carregar visitas",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchVisits();
  }, [fetchVisits]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <h2 className="text-2xl font-bold">Histórico de Visitas</h2>

      <div className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl shadow-slate-950/5 dark:shadow-black/20">
        {loading ? (
           <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : visits.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-6 py-3">Data e Hora</th>
                  <th scope="col" className="px-6 py-3">Email do Cliente</th>
                  <th scope="col" className="px-6 py-3">Google Sub</th>
                </tr>
              </thead>
              <tbody>
                {visits.map(visit => (
                  <tr key={visit.id} className="border-b border-border bg-card">
                    <td className="px-6 py-4">
                      {new Date(visit.visited_at).toLocaleString('pt-BR', {
                        timeZone: 'America/Sao_Paulo',
                        dateStyle: 'short',
                        timeStyle: 'medium'
                      })}
                    </td>
                    <td className="px-6 py-4">{visit.customer_email || '-'}</td>
                    <td className="px-6 py-4 font-mono">{visit.customer_google_sub}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <History className="mx-auto h-12 w-12 text-muted-foreground/70" />
            <p className="mt-2">Nenhuma visita registrada neste projeto ainda.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default VisitsTab;
