import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Users, Download, Loader2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { listCustomers } from '@/lib/api';

const CustomersTab = ({ projectId }) => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchCustomers = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await listCustomers(projectId);
      setCustomers(data);
    } catch (error) {
      toast({
        title: "Erro ao carregar clientes",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleExport = () => {
    if (customers.length === 0) {
      toast({ title: "Nenhum cliente para exportar." });
      return;
    }
    const headers = "id,google_sub,name,email,created_at,visits,pass_status\n";
    const csv = customers.map(c =>
      `${c.id},${c.google_sub},"${c.name || ''}","${c.email || ''}",${c.created_at},${c.visits},${c.pass_status || ''}`
    ).join("\n");

    const blob = new Blob([headers + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `customers_${projectId}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Exportação iniciada!" });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Clientes</h2>
        <Button onClick={handleExport} variant="outline" className="gap-2">
          <Download className="w-4 h-4" />
          Exportar CSV
        </Button>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-white rounded-2xl p-6 shadow-lg border border-purple-100"
      >
        <h3 className="text-lg font-bold mb-4">Lista de Clientes do Projeto</h3>
        {loading ? (
           <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : customers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3">Google Sub</th>
                  <th scope="col" className="px-6 py-3">Nome</th>
                  <th scope="col" className="px-6 py-3">Email</th>
                  <th scope="col" className="px-6 py-3 text-center">Visitas</th>
                  <th scope="col" className="px-6 py-3">Cadastro</th>
                  <th scope="col" className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {customers.map(customer => (
                  <tr key={customer.id} className="bg-white border-b">
                    <td className="px-6 py-4 font-mono">{customer.google_sub}</td>
                    <td className="px-6 py-4">{customer.name || '-'}</td>
                    <td className="px-6 py-4">{customer.email || '-'}</td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Star className="w-4 h-4 text-yellow-400" />
                        <span className="font-bold">{customer.visits}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">{new Date(customer.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4">
                        {customer.pass_status === 'installed' ? (
                          <div className="inline-flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-green-500" />
                            <span className="font-medium text-green-700">Adicionado</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-red-500" />
                            <span className="font-medium text-red-700">Removido</span>
                          </div>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Users className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2">Nenhum cliente cadastrado neste projeto ainda.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default CustomersTab;