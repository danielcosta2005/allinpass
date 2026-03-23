import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Download, Loader2, Star, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { listCustomers } from "@/lib/api";
import { supabase } from "@/lib/supabaseClient";

const CustomersTab = ({ projectId }) => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);

  // Linha expandida
  const [expandedCustomerId, setExpandedCustomerId] = useState(null);

  // Cache de passes por customerId
  const [passesByCustomerId, setPassesByCustomerId] = useState({});
  const [passesLoadingByCustomerId, setPassesLoadingByCustomerId] = useState({});

  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const fetchCustomers = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await listCustomers(projectId);
      setCustomers(Array.isArray(data) ? data : []);
    } catch (error) {
      toast({
        title: "Erro ao carregar clientes",
        description: error?.message || "Falha inesperada",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // Normaliza string p/ comparações
  const normEmail = (v) => String(v ?? "").trim().toLowerCase();

  // Extrai "points" com tolerância a lixo
  const extractPoints = (metadata) => {
    const raw = String(metadata?.points ?? metadata?.claim?.points ?? "").trim();
    if (!raw) return 0;
    if (!/^-?\d+$/.test(raw)) return 0;
    return Number(raw);
  };

  const formatDate = (iso) => {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString();
  };

  const formatDateTime = (iso) => {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString();
  };

  const fetchPassesForCustomer = useCallback(
    async (customer) => {
      if (!projectId) return;
      if (!customer?.id) return;

      // já carregado
      if (passesByCustomerId[customer.id]) return;

      if (!supabaseAnonKey) {
        toast({
          title: "Supabase não configurado",
          description: "Faltam VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY para carregar os passes.",
          variant: "destructive",
        });
        return;
      }

      setPassesLoadingByCustomerId((prev) => ({ ...prev, [customer.id]: true }));

      try {
        const email = normEmail(customer.email);
        const hasEmail = Boolean(email);

        // Vamos tentar buscar por email (principal) e, se não tiver email, por user_pass_id (fallback)
        // Observação: como o email está dentro do JSONB metadata, precisamos filtrar no client.
        // Por performance/segurança, o ideal é RPC/Edge function depois.
        let query = supabase
          .from("user_passes")
          .select(
            "id, pass_token, pass_type, metadata, issued_at, expires_at, created_at, pass_id, install_status, installed_at, install_platform, removed_at, device_key, project_id"
          )
          .eq("project_id", projectId);

        // Se não tiver email, tenta estreitar por user_pass_id (se existir)
        // Isso ajuda a não puxar “o mundo”.
        if (!hasEmail && customer.user_pass_id) {
          query = query.eq("id", customer.user_pass_id);
        }

        // Ordena mais útil p/ leitura
        query = query.order("issued_at", { ascending: false }).order("created_at", { ascending: false });

        const { data, error } = await query;

        if (error) throw error;

        let passes = Array.isArray(data) ? data : [];

        // Se tiver email, filtra client-side pelos campos possíveis no JSON
        if (hasEmail) {
          passes = passes.filter((p) => {
            const m = p?.metadata || {};
            const pe1 = normEmail(m.email);
            const pe2 = normEmail(m?.claim?.email);
            return pe1 === email || pe2 === email;
          });
        }

        setPassesByCustomerId((prev) => ({ ...prev, [customer.id]: passes }));
      } catch (error) {
        toast({
          title: "Erro ao carregar passes do cliente",
          description: error?.message || "Falha inesperada",
          variant: "destructive",
        });
        setPassesByCustomerId((prev) => ({ ...prev, [customer.id]: [] }));
      } finally {
        setPassesLoadingByCustomerId((prev) => ({ ...prev, [customer.id]: false }));
      }
    },
    [projectId, supabase, passesByCustomerId]
  );

  const toggleExpand = async (customer) => {
    const willExpand = expandedCustomerId !== customer.id;
    setExpandedCustomerId(willExpand ? customer.id : null);

    if (willExpand) {
      await fetchPassesForCustomer(customer);
    }
  };

  const handleExport = () => {
    if (customers.length === 0) {
      toast({ title: "Nenhum cliente para exportar." });
      return;
    }

    // ✅ remove pass_status do export, e renomeia "visits" mentalmente para total (mantém campo)
    const headers = "id,google_sub,name,email,created_at,visits\n";
    const csv = customers
      .map(
        (c) =>
          `${c.id},${c.google_sub},"${(c.name || "").replaceAll('"', '""')}","${(c.email || "").replaceAll(
            '"',
            '""'
          )}",${c.created_at},${c.visits ?? 0}`
      )
      .join("\n");

    const blob = new Blob([headers + csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `customers_${projectId}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast({ title: "Exportação iniciada!" });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Clientes</h2>
        <Button onClick={handleExport} variant="outline" className="gap-2">
          <Download className="w-4 h-4" />
          Exportar CSV
        </Button>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-xl border border-purple-100">
        <h3 className="text-lg font-bold mb-4">Lista de Clientes do Projeto</h3>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : customers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 w-10"></th>
                  <th scope="col" className="px-6 py-3">Google Sub</th>
                  <th scope="col" className="px-6 py-3">Nome</th>
                  <th scope="col" className="px-6 py-3">Email</th>
                  <th scope="col" className="px-6 py-3 text-center">Total de visitas</th>
                  <th scope="col" className="px-6 py-3">Cadastro</th>
                </tr>
              </thead>

              <tbody>
                {customers.map((customer) => {
                  const isExpanded = expandedCustomerId === customer.id;
                  const passes = passesByCustomerId[customer.id] || [];
                  const passesLoading = Boolean(passesLoadingByCustomerId[customer.id]);

                  return (
                    <React.Fragment key={customer.id}>
                      <tr
                        className={`bg-white border-b cursor-pointer hover:bg-gray-50 ${isExpanded ? "bg-gray-50" : ""}`}
                        onClick={() => toggleExpand(customer)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") toggleExpand(customer);
                        }}
                      >
                        <td className="px-4 py-4 text-gray-500">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </td>

                        <td className="px-6 py-4 font-mono">{customer.google_sub}</td>
                        <td className="px-6 py-4">{customer.name || "-"}</td>
                        <td className="px-6 py-4">{customer.email || "-"}</td>

                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Star className="w-4 h-4 text-yellow-400" />
                            <span className="font-bold">{customer.visits ?? 0}</span>
                          </div>
                        </td>

                        <td className="px-6 py-4">{formatDate(customer.created_at)}</td>
                      </tr>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.tr
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-gray-50"
                          >
                            <td colSpan={6} className="px-6 py-4">
                              <div className="rounded-xl border bg-white shadow-md">
                                <div className="flex items-center justify-between px-4 py-3 border-b">
                                  <div className="text-sm font-semibold">Passes do cliente</div>
                                  <div className="text-xs text-gray-500">
                                    {passesLoading ? "Carregando..." : `${passes.length} passe(s)`}
                                  </div>
                                </div>

                                {passesLoading ? (
                                  <div className="flex justify-center py-6">
                                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                  </div>
                                ) : passes.length > 0 ? (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-left">
                                      <thead className="text-[11px] text-gray-700 uppercase bg-gray-50">
                                        <tr>
                                          <th className="px-4 py-3">Pass type</th>
                                          <th className="px-4 py-3">Status</th>
                                          <th className="px-4 py-3">Platform</th>
                                          <th className="px-4 py-3 text-center">Pontos</th>
                                          <th className="px-4 py-3">Emissão</th>
                                          <th className="px-4 py-3">Expiração</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {passes.map((p) => {
                                          const points = extractPoints(p.metadata);
                                          const status = p.install_status || "-";
                                          const platform = p.install_platform || "-";
                                          const passType = p.pass_type || "-";

                                          const statusBadge =
                                            status === "installed"
                                              ? "bg-green-50 text-green-700 border-green-200"
                                              : status === "removed"
                                              ? "bg-red-50 text-red-700 border-red-200"
                                              : "bg-gray-50 text-gray-700 border-gray-200";

                                          return (
                                            <tr key={p.id} className="border-t">
                                              <td className="px-4 py-3 font-medium">{passType}</td>

                                              <td className="px-4 py-3">
                                                <span className={`inline-flex items-center px-2 py-1 rounded-full border ${statusBadge}`}>
                                                  {status}
                                                </span>
                                              </td>

                                              <td className="px-4 py-3">{platform}</td>

                                              <td className="px-4 py-3 text-center">
                                                <span className="font-semibold">{points}</span>
                                              </td>

                                              <td className="px-4 py-3">{formatDateTime(p.issued_at || p.created_at)}</td>
                                              <td className="px-4 py-3">{formatDateTime(p.expires_at)}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <div className="px-4 py-6 text-sm text-gray-500">
                                    Nenhum passe encontrado para este cliente.
                                  </div>
                                )}
                              </div>
                            </td>
                          </motion.tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Users className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2">Nenhum cliente cadastrado neste projeto ainda.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default CustomersTab;
