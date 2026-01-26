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
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Histórico de Visitas</h2>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-white rounded-2xl p-6 shadow-lg border border-purple-100"
      >
        {loading ? (
           <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : visits.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3">Data e Hora</th>
                  <th scope="col" className="px-6 py-3">Email do Cliente</th>
                  <th scope="col" className="px-6 py-3">Google Sub</th>
                </tr>
              </thead>
              <tbody>
                {visits.map(visit => (
                  <tr key={visit.id} className="bg-white border-b">
                    <td className="px-6 py-4">
                      {new Date(visit.visited_at).toLocaleString('pt-BR', {
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
          <div className="text-center py-8 text-gray-500">
            <History className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2">Nenhuma visita registrada neste projeto ainda.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default VisitsTab;