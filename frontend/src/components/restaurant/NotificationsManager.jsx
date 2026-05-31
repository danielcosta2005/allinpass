import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCcw,
  Ban,
  Repeat,
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

const WEEKDAY_SHORT = {
  1: "Seg",
  2: "Ter",
  3: "Qua",
  4: "Qui",
  5: "Sex",
  6: "Sáb",
  7: "Dom",
};

function getWeeklyRecurrence(campaign) {
  const rec = campaign?.trigger_config?.recurrence;
  if (!rec || rec.type !== "weekly") return null;

  const days = Array.isArray(rec.daysOfWeek)
    ? rec.daysOfWeek
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
      .sort((a, b) => a - b)
    : [];

  if (days.length === 0) return null;

  const timeOfDay = typeof rec.timeOfDay === "string" ? rec.timeOfDay : null;
  const timezone = typeof rec.timezone === "string" ? rec.timezone : null;

  return { days, timeOfDay, timezone };
}

function recurrenceBadgeLabel(campaign) {
  const rec = getWeeklyRecurrence(campaign);
  if (!rec) return null;

  const dayLabels = rec.days.map((d) => WEEKDAY_SHORT[d]).filter(Boolean);
  if (dayLabels.length === 0) return null;

  if (rec.timeOfDay) return `Semanal: ${dayLabels.join(", ")} às ${rec.timeOfDay}`;
  return `Semanal: ${dayLabels.join(", ")}`;
}

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

const STATUS_LABELS_PT = {
  scheduled: "Agendada",
  running: "Em andamento",
  active: "Ativa",
  queued: "Na fila",
  pending: "Pendente",
  processing: "Processando",
  rate_limited: "Limitado por taxa",
  sent: "Enviada",
  failed: "Falhou",
  partial_failed: "Parcialmente falhou",
  canceled: "Cancelada",
  skipped: "Ignorada",
};

function normalizeStatusKey(status) {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

function translateStatusPt(status) {
  const key = normalizeStatusKey(status);
  if (!key) return "-";
  return STATUS_LABELS_PT[key] || status;
}

function statusBadgeClass(status) {
  const key = normalizeStatusKey(status);
  if (key === "sent" || key === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (key === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (key === "partial_failed" || key === "rate_limited") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (key === "processing" || key === "running") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (key === "canceled") {
    return "border-slate-200 bg-slate-100 text-slate-700";
  }
  return "border-indigo-200 bg-indigo-50 text-indigo-700";
}

function StatusBadge({ status }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        statusBadgeClass(status),
      )}
    >
      {translateStatusPt(status)}
    </span>
  );
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

export default function NotificationsManager({ projectId }) {
  const { toast } = useToast();

  const [loadingKpis, setLoadingKpis] = useState(true);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);

  const [kpis, setKpis] = useState(null);
  const [campaigns, setCampaigns] = useState([]);

  const [expandedId, setExpandedId] = useState(null);
  const [jobsByCampaign, setJobsByCampaign] = useState({});
  const [loadingJobsId, setLoadingJobsId] = useState(null);

  const [cancelingId, setCancelingId] = useState(null);

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
  // Cancel campaign: atualiza notification_jobs -> canceled
  // =========================
 async function cancelCampaign(campaign) {
 if (!projectId) return;

  const campaignId = campaign.id;
  const isRecurring = campaign.trigger_type === "recurring_weekly";

  // Regra para one-shot: "ainda não foi enviada" -> sent_at null
  if (!isRecurring && campaign.sent_at) {
    toast({
      title: "Campanha já enviada",
      description: "Não é possível cancelar uma campanha que já foi enviada.",
      variant: "destructive",
    });
    return;
  }

  setCancelingId(campaignId);

  // 1) Diagnóstico: quantos jobs existem e quais status (ajuda a debugar filtros/RLS)
  const { data: jobsSnapshot, error: snapErr } = await supabase
    .from("notification_jobs")
    .select("id,status", { count: "exact" })
    .eq("project_id", projectId)
    .eq("notification_id", campaignId);

  if (snapErr) {
    setCancelingId(null);
    toast({
      title: "Erro ao inspecionar jobs",
      description: snapErr.message,
      variant: "destructive",
    });
    return;
  }

  const totalJobs = jobsSnapshot?.length ?? 0;

  // Se não tem jobs, provavelmente notification_id não está sendo preenchido (ou ainda não foram enfileirados)
  if (totalJobs === 0 && !isRecurring) {
    setCancelingId(null);
    toast({
      title: "Nada para cancelar",
      description:
        "Não encontrei jobs dessa campanha. Verifique se notification_jobs.notification_id está sendo preenchido com notifications.id (ou se a campanha ainda não gerou jobs).",
      variant: "destructive",
    });
    return;
  }

  // 2) Cancela SOMENTE jobs pendentes (evita mexer em sent/failed)
  const cancelableStatuses = ["pending", "rate_limited"];
  // Se você quiser permitir cancelar processing também:
  // const cancelableStatuses = ["pending", "rate_limited", "processing"];

  const { data: updatedRows, error: updErr, count: updatedCount } = await supabase
    .from("notification_jobs")
    .update({ status: "canceled" })
    .eq("project_id", projectId)
    .eq("notification_id", campaignId)
    .in("status", cancelableStatuses)
    .select("id,status", { count: "exact" }); // <- essencial pra saber se alterou

  if (updErr) {
    setCancelingId(null);
    toast({
      title: "Erro ao cancelar envios",
      description: updErr.message,
      variant: "destructive",
    });
    return;
  }

  const changed = updatedCount ?? (updatedRows?.length ?? 0);

  // 3) Se não alterou nada, avisar o motivo provável
  if (changed === 0 && !isRecurring) {
    const statusCounts = jobsSnapshot.reduce((acc, j) => {
      acc[j.status] = (acc[j.status] || 0) + 1;
      return acc;
    }, {});

    setCancelingId(null);
    toast({ 
      title: "Nenhum job foi cancelado",
      description:
        `Encontrei ${totalJobs} jobs, mas 0 eram canceláveis. ` +
        `Status atuais: ${JSON.stringify(statusCounts)}. ` +
        `Pode ser filtro de status (ex.: estão 'processing') ou RLS bloqueando update.`,
      variant: "destructive",
    });
    return;
  }

  // 4) Marca a CAMPANHA como canceled também (na tabela notifications)
  const { error: notifErr } = await supabase
    .from("notifications")
    .update({ status: "canceled" })
    .eq("project_id", projectId)
    .eq("id", campaignId);

  setCancelingId(null);

  if (notifErr) {
    toast({
      title: "Envios cancelados, mas falhou atualizar campanha",
      description: notifErr.message,
      variant: "destructive",
    });
    // Mesmo com erro aqui, os jobs já foram cancelados, então apenas recarrega UI.
    if (expandedId === campaignId) {
      await fetchJobsForCampaign(campaignId);
    }
    await fetchCampaigns();
    return;
  }

  toast({
    title: isRecurring ? "Recorrência cancelada" : "Campanha cancelada",
    description: isRecurring
      ? `A recorrência foi interrompida e ${changed} envio(s) pendente(s) foram cancelados.`
      : `${changed} envios pendentes foram marcados como canceled e a campanha foi marcada como canceled.`,
  });

  // 5) Recarrega UI
  if (expandedId === campaignId) {
    await fetchJobsForCampaign(campaignId);
  }
  await fetchCampaigns();
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
                    <th className="py-2 pr-2 text-right">Ações</th>
                  </tr>
                </thead>

                <tbody>
                  {campaigns.map((c) => {
                    const isExpanded = expandedId === c.id;
                    const jobs = jobsByCampaign[c.id] || [];
                    const isRecurring = c.trigger_type === "recurring_weekly";
                    const isCancelable = isRecurring ? c.status !== "canceled" : !c.sent_at;
                    const recurringLabel = recurrenceBadgeLabel(c);

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
                            <div className="space-y-1">
                              <div>{c.message || "-"}</div>
                              {recurringLabel && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                                  <Repeat className="h-3 w-3" />
                                  {recurringLabel}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-2 pr-2">
                            <StatusBadge status={c.status} />
                          </td>
                          <td className="py-2 pr-2">{formatDateTimeBR(c.created_at)}</td>
                          <td className="py-2 pr-2">{formatDateTimeBR(c.scheduled_for)}</td>
                          <td className="py-2 pr-2">{formatDateTimeBR(c.sent_at)}</td>

                          <td className="py-2 pr-2 text-right">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={!isCancelable || cancelingId === c.id}
                              onClick={() => cancelCampaign(c)}
                            >
                              {cancelingId === c.id ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              ) : (
                                <Ban className="w-4 h-4 mr-2" />
                              )}
                              {isRecurring ? "Cancelar recorrência" : "Cancelar"}
                            </Button>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="border-b">
                            <td colSpan={7} className="py-3">
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="rounded-md border p-3"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-sm font-semibold">
                                    Envios
                                    {recurringLabel && (
                                      <div className="mt-1 text-[11px] font-medium text-indigo-700">
                                        {recurringLabel}
                                        {c?.trigger_config?.recurrence?.timezone
                                          ? ` (${c.trigger_config.recurrence.timezone})`
                                          : ""}
                                      </div>
                                    )}
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
                                    {isRecurring
                                      ? "Nenhum envio materializado ainda para esta recorrência."
                                      : "Nenhum envio encontrado para essa campanha."}
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
                                            <td className="py-2 pr-2">
                                              <StatusBadge status={j.status} />
                                            </td>
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
