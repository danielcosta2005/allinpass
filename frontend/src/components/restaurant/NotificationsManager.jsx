import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCcw,
} from "lucide-react";

// Se você ainda NÃO tem os componentes Card no seu projeto, troque por <div> como fallback.
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";

// Helpers
function formatDateTimeBR(value) {
  if (!value) return "-";
  const d = new Date(value);
  return d.toLocaleString("pt-BR");
}

function safeNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

// Fallback Card (se você não tiver shadcn Card ainda)
function Box({ className, children }) {
  return (
    <div className={cn("rounded-xl border bg-white text-gray-900 shadow-lg", className)}>
      {children}
    </div>
  );
}
function BoxHeader({ className, children }) {
  return <div className={cn("flex flex-col space-y-1.5 p-6 pb-2", className)}>{children}</div>;
}
function BoxTitle({ className, children }) {
  return <div className={cn("text-sm text-muted-foreground", className)}>{children}</div>;
}
function BoxContent({ className, children }) {
  return <div className={cn("p-6 pt-0", className)}>{children}</div>;
}

export default function NotificationsManager({
  projectId,
}) {
  const { toast } = useToast();

  const [loadingKpis, setLoadingKpis] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);

  const [kpis, setKpis] = useState(null);
  const [campaigns, setCampaigns] = useState([]);

  const [expandedId, setExpandedId] = useState(null);
  const [jobsByCampaign, setJobsByCampaign] = useState({});
  const [loadingJobsId, setLoadingJobsId] = useState(null);

  // =========================
  // Derived KPIs (usa coluna gerada do banco quando existe)
  // =========================
  const kpiView = useMemo(() => {
    const limit = kpis?.notifications_limit; // pode ser null (ilimitado) OU >= 0
    const total = safeNumber(kpis?.total_notifications_sent);
    const recent = safeNumber(kpis?.recent_notifications_sent);

    // notifications_remaining já existe no schema como generated column
    const remainingRaw = kpis?.notifications_remaining;

    const isUnlimited = limit === null;
    const limitNum = isUnlimited ? null : safeNumber(limit);

    const remaining =
      isUnlimited ? null : Math.max(0, safeNumber(remainingRaw ?? (limitNum - recent)));

    const usedPct =
      isUnlimited ? null : limitNum <= 0 ? 0 : Math.min(100, Math.round((recent / limitNum) * 100));

    return { isUnlimited, limitNum, total, recent, remaining, usedPct };
  }, [kpis]);

  // =========================
  // Loaders
  // =========================
  async function fetchKpis() {
    if (!projectId) return;

    setLoadingKpis(true);

    const { data, error } = await supabase
      .from("projects_notifications")
      .select(
        "project_id, notifications_limit, total_notifications_sent, recent_notifications_sent, notifications_remaining, notifications_exp, created_at",
      )
      .eq("project_id", projectId)
      .maybeSingle();

    setLoadingKpis(false);

    if (error) {
      toast({
        title: "Erro ao carregar KPIs",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setKpis(data || null);
  }

  async function fetchCampaigns() {
    if (!projectId) return;

    setLoadingCampaigns(true);

    // Schema real:
    // notifications: id, project_id, title, message, channels, trigger_type, trigger_config, status, created_at, scheduled_for, sent_at
    const { data, error } = await supabase
      .from("notifications")
      .select(
        "id, project_id, title, message, channels, trigger_type, trigger_config, status, created_at, scheduled_for, sent_at",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    setLoadingCampaigns(false);

    if (error) {
      toast({
        title: "Erro ao carregar campanhas",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setCampaigns(data || []);
  }

  async function fetchJobsForCampaign(notificationId) {
    if (!projectId) return;

    setLoadingJobsId(notificationId);

    // Filtra por project_id também (mais seguro e aproveita índice)
    const { data, error } = await supabase
      .from("notification_jobs")
      .select(
        "id, project_id, notification_id, status, platform, notification_type, title, body, scheduled_for, available_at, attempts, max_attempts, last_error, last_error_at, sent_at, created_at, updated_at",
      )
      .eq("project_id", projectId)
      .eq("notification_id", notificationId)
      .order("created_at", { ascending: false });

    setLoadingJobsId(null);

    if (error) {
      toast({
        title: "Erro ao carregar envios da campanha",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setJobsByCampaign((prev) => ({ ...prev, [notificationId]: data || [] }));
  }

  async function refreshAll() {
    await Promise.all([fetchKpis(), fetchCampaigns()]);
  }

  // =========================
  // Expand campaign
  // =========================
  async function toggleExpand(campaignId) {
    const willExpand = expandedId !== campaignId;
    setExpandedId(willExpand ? campaignId : null);

    if (willExpand && !jobsByCampaign[campaignId]) {
      await fetchJobsForCampaign(campaignId); 
    }
  }

  // =========================
  // Effects
  // =========================
  useEffect(() => {
    if (!projectId) return;
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // =========================
  // UI
  // =========================
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5" />
          <h2 className="text-xl font-semibold">Gerenciador de Notificações</h2>
        </div>

        <Button variant="outline" onClick={refreshAll}>
          <RefreshCcw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div className="h-full" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
        <Box className="h-full">
          <BoxHeader>
            <BoxTitle>Limite mensal</BoxTitle>
          </BoxHeader>
          <BoxContent>
            {loadingKpis ? (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando...
              </div>
            ) : (
              <div className="text-2xl font-bold">
                {kpiView.isUnlimited ? "Ilimitado" : kpiView.limitNum}
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-1">
              Expira em: {kpis?.notifications_exp ? formatDateTimeBR(kpis.notifications_exp) : "-"}
            </div>
          </BoxContent>
        </Box>
        </motion.div>

        <motion.div className="h-full" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Box className="h-full">
          <BoxHeader>
            <BoxTitle>Total enviado</BoxTitle>
          </BoxHeader>
          <BoxContent>
            {loadingKpis ? (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando...
              </div>
            ) : (
              <div className="text-2xl font-bold">{kpiView.total}</div>
            )}
          </BoxContent>
        </Box>
        </motion.div>

        <motion.div className="h-full" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Box className="h-full">
          <BoxHeader>
            <BoxTitle>Enviado no mês atual</BoxTitle>
          </BoxHeader>
          <BoxContent>
            {loadingKpis ? (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando...
              </div>
            ) : (
              <div className="text-2xl font-bold">{kpiView.recent}</div>
            )}

            {!loadingKpis && !kpiView.isUnlimited && (
              <div className="text-xs text-muted-foreground mt-1">Uso: {kpiView.usedPct}%</div>
            )}
          </BoxContent>
        </Box>
        </motion.div>

        <motion.div className="h-full" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Box className="h-full">
          <BoxHeader>
            <BoxTitle>Restante até o limite</BoxTitle>
          </BoxHeader>
          <BoxContent>
            {loadingKpis ? (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando...
              </div>
            ) : (
              <div className="text-2xl font-bold">{kpiView.isUnlimited ? "—" : kpiView.remaining}</div>
            )}
          </BoxContent>
        </Box>
        </motion.div>
      </div>

      {/* Campaigns table */}
      <Box>
        <BoxHeader className="pb-4">
          <div className="text-base font-semibold">Campanhas</div>
          <div className="text-xs text-muted-foreground">
            Clique para expandir e ver os envios
          </div>
        </BoxHeader>

        <BoxContent className="pt-0">
          {loadingCampaigns ? (
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando campanhas...
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhuma campanha encontrada.</div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2 w-10"></th>
                    <th className="py-2 pr-2">Campanha</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Criada em</th>
                    <th className="py-2 pr-2">Agendada para</th>
                    <th className="py-2 pr-2">Enviada em</th>
                  </tr>
                </thead>

                <tbody>
                  {campaigns.map((c) => {
                    const isExpanded = expandedId === c.id;
                    const jobs = jobsByCampaign[c.id] || [];

                    return (
                      <React.Fragment key={c.id}>
                        <tr className="border-b align-middle">
                          <td className="py-2 pr-2">
                            <Button variant="ghost" size="icon" onClick={() => toggleExpand(c.id)}>
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </Button>
                          </td>

                          <td className="py-2 pr-2">
                            <div>{c.message || "-"}</div>
                          </td>

                          <td className="py-2 pr-2">{c.status || "-"}</td>
                          <td className="py-2 pr-2">{formatDateTimeBR(c.created_at)}</td>
                          <td className="py-2 pr-2">{formatDateTimeBR(c.scheduled_for)}</td>
                          <td className="py-2 pr-2">{formatDateTimeBR(c.sent_at)}</td>

                        </tr>

                        {isExpanded && (
                          <tr className="border-b">
                            <td colSpan={6} className="py-3">
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="rounded-md border p-3"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-sm font-semibold">
                                    Envios 
                                  </div>

                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={loadingJobsId === c.id}
                                    onClick={() => fetchJobsForCampaign(c.id)}
                                  >
                                    {loadingJobsId === c.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                    ) : (
                                      <RefreshCcw className="w-4 h-4 mr-2" />
                                    )}
                                    Recarregar
                                  </Button>
                                </div>

                                {loadingJobsId === c.id ? (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Carregando envios...
                                  </div>
                                ) : jobs.length === 0 ? (
                                  <div className="text-sm text-muted-foreground">
                                    Nenhum envio encontrado para essa campanha.
                                  </div>
                                ) : (
                                  <div className="w-full overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-left border-b">
                                          <th className="py-2 pr-2">Status</th>
                                          <th className="py-2 pr-2">Plataforma</th>
                                          <th className="py-2 pr-2">Tipo</th>
                                          <th className="py-2 pr-2">Criado em</th>
                                          <th className="py-2 pr-2">Disponível em</th>
                                          <th className="py-2 pr-2">Agendado</th>
                                          <th className="py-2 pr-2">Enviado em</th>
                                          <th className="py-2 pr-2">Tentativas</th>
                                          <th className="py-2 pr-2">Erro</th>
                                        </tr>
                                      </thead>

                                      <tbody>
                                        {jobs.map((j) => (
                                          <tr key={j.id} className="border-b">
                                            <td className="py-2 pr-2">{j.status}</td>
                                            <td className="py-2 pr-2">{j.platform}</td>
                                            <td className="py-2 pr-2">{j.notification_type}</td>
                                            <td className="py-2 pr-2">{formatDateTimeBR(j.created_at)}</td>
                                            <td className="py-2 pr-2">{formatDateTimeBR(j.available_at)}</td>
                                            <td className="py-2 pr-2">{formatDateTimeBR(j.scheduled_for)}</td>
                                            <td className="py-2 pr-2">{formatDateTimeBR(j.sent_at)}</td>
                                            <td className="py-2 pr-2">
                                              {safeNumber(j.attempts)}/{safeNumber(j.max_attempts)}
                                            </td>
                                            <td className="py-2 pr-2">
                                              {j.last_error ? (
                                                <span className="text-red-600">{j.last_error}</span>
                                              ) : (
                                                "-"
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </BoxContent>
      </Box>
    </motion.div>
  );
}
