import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bell,
  Loader2,
  Send,
  Filter,
  RefreshCcw,
  CheckSquare,
  Square,
  Clock,
  Repeat,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

const RECURRENCE_TIMEZONE = "America/Sao_Paulo";

const WEEKDAY_OPTIONS = [
  { iso: 1, shortLabel: "S", shortName: "Seg", fullName: "Segunda-feira" },
  { iso: 2, shortLabel: "T", shortName: "Ter", fullName: "Terça-feira" },
  { iso: 3, shortLabel: "Q", shortName: "Qua", fullName: "Quarta-feira" },
  { iso: 4, shortLabel: "Q", shortName: "Qui", fullName: "Quinta-feira" },
  { iso: 5, shortLabel: "S", shortName: "Sex", fullName: "Sexta-feira" },
  { iso: 6, shortLabel: "S", shortName: "Sáb", fullName: "Sábado" },
  { iso: 7, shortLabel: "D", shortName: "Dom", fullName: "Domingo" },
];

const NotificationsTab = ({ projectId }) => {
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const { toast } = useToast();

  // user_passes (fonte principal)
  const [rows, setRows] = useState([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);

  // visits summary: last visit per user_pass_id (within a window)
  const [lastVisitByUserPassId, setLastVisitByUserPassId] = useState(() => new Map());
  const [isLoadingVisits, setIsLoadingVisits] = useState(false);

  const [lastFetchAt, setLastFetchAt] = useState(null);
  const [notificationsConfig, setNotificationsConfig] = useState(null);

  // filtros
  const [searchText, setSearchText] = useState("");
  const [segmentPreset, setSegmentPreset] = useState("none"); // none | expired | inactive | expiring_soon
  const [inactiveDays, setInactiveDays] = useState(30);
  const [expiringDays, setExpiringDays] = useState(7);

  // seleção (por user_passes.id)
  const [selectedCustomerIds, setSelectedCustomerIds] = useState(() => new Set());

  // mensagem
  const [message, setMessage] = useState("");
  const maxMessageLen = 200;

  // ✅ agendamento (agora fica na coluna do CTA)
  const [sendMode, setSendMode] = useState("now"); // now | schedule
  const [scheduledLocal, setScheduledLocal] = useState(""); // datetime-local string
  const [isRecurringWeekly, setIsRecurringWeekly] = useState(false);
  const [weeklyDays, setWeeklyDays] = useState([]);
  const [recurrenceTimeLocal, setRecurrenceTimeLocal] = useState("");

  const [isSending, setIsSending] = useState(false);

  // =========================
  // Helpers
  // =========================
  function toDate(v) {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function daysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - Number(days || 0));
    return d;
  }

  function daysFromNow(days) {
    const d = new Date();
    d.setDate(d.getDate() + Number(days || 0));
    return d;
  }

  function safeLower(v) {
    return typeof v === "string" ? v.toLowerCase() : "";
  }

  function safeNumber(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  }

  function fmtDate(v) {
    const d = toDate(v);
    if (!d) return "-";
    return d.toLocaleDateString("pt-BR");
  }

  function fmtDateTime(v) {
    const d = toDate(v);
    if (!d) return "-";
    return d.toLocaleString("pt-BR");
  }

  function buildSuggestedMessage(preset) {
    if (preset === "expired") {
      return "Seu passe expirou 😢 Queremos te ver de volta! Passe hoje no restaurante para reativar seus benefícios.";
    }
    if (preset === "inactive") {
      return "Sentimos sua falta! 😄 Faz tempo que você não faz uma visita. Hoje tem novidades esperando por você.";
    }
    if (preset === "expiring_soon") {
      return "Seu passe está prestes a expirar ⏳ Aproveite seus benefícios antes do prazo! Te esperamos hoje.";
    }
    return "";
  }

  function getClaim(meta) {
    if (!meta || typeof meta !== "object") return null;
    const claim = meta.claim;
    if (!claim || typeof claim !== "object") return null;
    return claim;
  }

  function getDisplayName(meta) {
    const claim = getClaim(meta);
    const name = claim?.name;
    return typeof name === "string" && name.trim() ? name.trim() : "(Sem nome)";
  }

  function getEmail(meta) {
    const claim = getClaim(meta);
    const email = claim?.email;
    return typeof email === "string" && email.trim() ? email.trim() : "-";
  }

  function getGoogleSub(meta) {
    const claim = getClaim(meta);
    const gs = claim?.google_sub;
    return typeof gs === "string" && gs.trim() ? gs.trim() : "";
  }

  function getPoints(meta) {
    if (!meta || typeof meta !== "object") return 0;
    const points = meta.points;
    return typeof points === "number" && Number.isFinite(points) ? points : 0;
  }

  // local datetime -> ISO UTC
  function localDateTimeToUtcIso(localStr) {
    if (!localStr || typeof localStr !== "string") return null;
    const d = new Date(localStr);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function getTimeOfDay(localStr) {
    if (!localStr || typeof localStr !== "string") return null;
    const match = localStr.match(/T(\d{2}:\d{2})/);
    return match?.[1] || null;
  }

  function anchorIsoForWeeklyRecurrence(timeOfDay) {
    if (!timeOfDay || typeof timeOfDay !== "string") return null;
    const [h, m] = timeOfDay.split(":").map((v) => Number(v));
    if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
    const base = new Date();
    base.setSeconds(0, 0);
    base.setHours(h, m, 0, 0);
    return base.toISOString();
  }

  function listWeekdayShortNames(days) {
    const sorted = [...new Set(days)].sort((a, b) => a - b);
    return sorted
      .map((iso) => WEEKDAY_OPTIONS.find((d) => d.iso === iso)?.shortName)
      .filter(Boolean);
  }

  function recurrenceSummary(days, timeOfDay) {
    const dayNames = listWeekdayShortNames(days);
    if (dayNames.length === 0) return "Selecione os dias da semana para repetir.";
    if (!timeOfDay) return `Repete: ${dayNames.join(", ")}`;
    return `Repete: ${dayNames.join(", ")} às ${timeOfDay}`;
  }

  function toggleWeeklyDay(isoDay) {
    setWeeklyDays((prev) => {
      if (prev.includes(isoDay)) return prev.filter((d) => d !== isoDay);
      return [...prev, isoDay].sort((a, b) => a - b);
    });
    setIsRecurringWeekly(true);
  }

  async function getAuthHeader() {
    try {
      if (!supabaseAnonKey) return '';
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      return token ? `Bearer ${token}` : `Bearer ${supabaseAnonKey}`;
    } catch {
      return supabaseAnonKey ? `Bearer ${supabaseAnonKey}` : '';
    }
  }

  // =========================
  // Data loading
  // =========================
  async function fetchCustomersWithPass() {
    if (!supabaseAnonKey) {
      toast({
        variant: "destructive",
        title: "Supabase não configurado",
        description: "Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.",
      });
      return;
    }
    if (!projectId) return;

    setIsLoadingCustomers(true);
    try {
      const { data, error } = await supabase
        .from("user_passes")
        .select(
          [
            "id",
            "project_id",
            "pass_token",
            "pass_type",
            "metadata",
            "issued_at",
            "expires_at",
            "created_at",
            "install_status",
            "install_platform",
            "installed_at",
            "removed_at",
            "device_key",
            "google_object_id",
            "google_class_id",
            "pass_id",
          ].join(",")
        )
        .eq("project_id", projectId)
        .eq("install_status", "installed")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setRows(Array.isArray(data) ? data : []);
      setLastFetchAt(new Date());
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao carregar passes",
        description: err?.message || "Falha inesperada ao buscar user_passes por project_id.",
      });
      setRows([]);
    } finally {
      setIsLoadingCustomers(false);
    }
  }

  async function fetchVisitsSummary() {
    if (!supabaseAnonKey) return;
    if (!projectId) return;

    const VISITS_LOOKBACK_DAYS = 365;
    const since = daysAgo(VISITS_LOOKBACK_DAYS).toISOString();

    setIsLoadingVisits(true);
    try {
      const { data, error } = await supabase
        .from("visits")
        .select("user_pass_id, created_at")
        .eq("project_id", projectId)
        .not("user_pass_id", "is", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10000);

      if (error) throw error;

      const map = new Map();
      for (const v of data || []) {
        const pid = v.user_pass_id;
        const createdAt = v.created_at;
        if (!pid || !createdAt) continue;
        if (!map.has(pid)) map.set(pid, createdAt);
      }

      setLastVisitByUserPassId(map);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao carregar visitas",
        description: err?.message || "Falha inesperada ao buscar visits.",
      });
      setLastVisitByUserPassId(new Map());
    } finally {
      setIsLoadingVisits(false);
    }
  }

  async function fetchNotificationsConfig() {
    if (!supabaseAnonKey || !projectId) return;

    try {
      const { data, error } = await supabase
        .from("projects_notifications")
        .select(
          "project_id, notifications_limit, recent_notifications_sent, notifications_remaining, notifications_exp",
        )
        .eq("project_id", projectId)
        .maybeSingle();

      if (error) throw error;
      setNotificationsConfig(data || null);
    } catch (err) {
      setNotificationsConfig(null);
      toast({
        variant: "destructive",
        title: "Erro ao carregar limite de notificacoes",
        description: err?.message || "Falha inesperada ao buscar notifications_remaining.",
      });
    }
  }

  async function refreshAll() {
    await Promise.all([fetchCustomersWithPass(), fetchVisitsSummary(), fetchNotificationsConfig()]);
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // =========================
  // Filtering (derived)
  // =========================
  const filteredRows = useMemo(() => {
    const now = new Date();
    const inactivityCutoff = daysAgo(inactiveDays);
    const expiringCutoff = daysFromNow(expiringDays);

    return (rows || []).filter((p) => {
      if (projectId && p?.project_id && String(p.project_id) !== String(projectId)) return false;
      if (safeLower(p?.install_status) === "removed") return false;

      const meta = p?.metadata ?? null;

      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        const hay =
          [
            getDisplayName(meta),
            getEmail(meta),
            getGoogleSub(meta),
            p?.pass_type,
            p?.pass_token,
            String(p?.id || ""),
          ]
            .map(safeLower)
            .join(" | ") || "";

        if (!hay.includes(q)) return false;
      }

      const expiresAt = toDate(p?.expires_at);

      if (segmentPreset === "expired") return expiresAt ? expiresAt < now : false;

      if (segmentPreset === "expiring_soon") {
        if (!expiresAt) return false;
        return expiresAt >= now && expiresAt <= expiringCutoff;
      }

      if (segmentPreset === "inactive") {
        const userPassId = p?.id;
        if (!userPassId) return true;

        const lastVisitIso = lastVisitByUserPassId.get(userPassId) || null;
        const lastVisitAt = toDate(lastVisitIso);

        if (!lastVisitAt) return true;
        return lastVisitAt < inactivityCutoff;
      }

      return true;
    });
  }, [rows, searchText, segmentPreset, inactiveDays, expiringDays, lastVisitByUserPassId]);

  const visibleCustomerIds = useMemo(() => new Set(filteredRows.map((p) => p.id)), [filteredRows]);

  const visibleSelectedCount = useMemo(() => {
    let n = 0;
    selectedCustomerIds.forEach((id) => {
      if (visibleCustomerIds.has(id)) n += 1;
    });
    return n;
  }, [selectedCustomerIds, visibleCustomerIds]);

  const allVisibleSelected = filteredRows.length > 0 && visibleSelectedCount === filteredRows.length;

  // =========================
  // Selection actions
  // =========================
  function toggleRow(passId) {
    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(passId)) next.delete(passId);
      else next.add(passId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filteredRows.forEach((p) => next.delete(p.id));
      else filteredRows.forEach((p) => next.add(p.id));
      return next;
    });
  }

  function clearSelection() {
    setSelectedCustomerIds(new Set());
  }

  function applyPreset(preset) {
    setSegmentPreset(preset);

    const suggested = buildSuggestedMessage(preset);
    if (suggested && (!message.trim() || message === buildSuggestedMessage(segmentPreset))) {
      setMessage(suggested);
    }

    setTimeout(() => {
      setSelectedCustomerIds(() => {
        const next = new Set();
        filteredRows.forEach((p) => next.add(p.id));
        return next;
      });
    }, 0);
  }

  // =========================
// Enqueue notifications (via notifications-enqueue)
// =========================
async function handleEnqueue() {
  const functionsUrl =
    import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
  const isWeeklySchedule = sendMode === "schedule" && isRecurringWeekly;

  const user_pass_ids = allowedRows.map((p) => String(p?.id ?? "").trim()).filter(Boolean);

  if (user_pass_ids.length === 0) {
    toast({
      variant: "destructive",
      title: "Limite excedido",
      description: "Nao ha passes disponiveis para enfileirar no limite atual.",
    });
    return;
  }

  if (isWeeklySchedule && weeklyDays.length === 0) {
    toast({
      variant: "destructive",
      title: "Dias da repetição ausentes",
      description: "Selecione ao menos um dia da semana para ativar a recorrência.",
    });
    return;
  }

  const recurrence = isWeeklySchedule
    ? {
        type: "weekly",
        timezone: RECURRENCE_TIMEZONE,
        daysOfWeek: [...weeklyDays].sort((a, b) => a - b),
        timeOfDay: recurrenceTimeLocal || null,
      }
    : null;

  if (isWeeklySchedule && !recurrence?.timeOfDay) {
    toast({
      variant: "destructive",
      title: "Horario inválido",
      description: "Defina a hora para configurar a recorrência semanal.",
    });
    return;
  }

  const scheduledFor = sendMode !== "schedule"
    ? null
    : isWeeklySchedule
      ? anchorIsoForWeeklyRecurrence(recurrence?.timeOfDay)
      : localDateTimeToUtcIso(scheduledLocal);

  if (sendMode === "schedule" && !scheduledFor) {
    toast({
      variant: "destructive",
      title: "Agendamento inválido",
      description: isWeeklySchedule
        ? "Defina uma hora válida para os dias selecionados."
        : "Defina uma data e hora válida para o envio.",
    });
    return;
  }

  setIsSending(true);
  try {
    const authHeader = await getAuthHeader();

    const payload = {
      projectId,
      title: recurrence ? "Envio manual (recorrente semanal)" : sendMode === "schedule" ? "Envio manual (agendado)" : "Envio manual",
      message: message.trim(),
      sendMode,
      scheduledFor,
      recurrence,
      segment: {
        preset: segmentPreset,
        inactiveDays,
        expiringDays,
        searchText: searchText.trim() || null,
        ui: "NotificationsTab(user_passes)",
      },
      user_pass_ids,
      channels: { apple: true, google: true },
      data: {},
    };

    const res = await fetch(`${functionsUrl}/notifications-enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) throw new Error(json?.error || "Falha ao enfileirar notificação.");

    toast({
      title: recurrence ? "Recorrência ativada ✅" : sendMode === "schedule" ? "Agendado ✅" : "Enfileirado ✅",
      description: recurrence
        ? `${json?.note || "A campanha semanal foi salva."} Próxima ocorrência: ${
            json?.scheduled_for ? fmtDateTime(json.scheduled_for) : "-"
          }.`
        : isOverLimit
          ? `Criados ${json?.jobs_created ?? 0} job(s). Ignorados por limite: ${ignoredCount}.`
          : `Criados ${json?.jobs_created ?? 0} job(s).`,
    });

    if (sendMode === "schedule") {
      setScheduledLocal("");
      setRecurrenceTimeLocal("");
      setIsRecurringWeekly(false);
      setWeeklyDays([]);
    }
  } catch (err) {
    toast({
      variant: "destructive",
      title: "Erro ao Enfileirar",
      description: err?.message || "Erro inesperado.",
    });
  } finally {
    setIsSending(false);
  }
}

  // =========================
  // Preview selected
  // =========================
  const selectedCount = selectedCustomerIds.size;
  const selectedRows = useMemo(
    () => rows.filter((p) => selectedCustomerIds.has(p.id)),
    [rows, selectedCustomerIds]
  );

  const limitInfo = useMemo(() => {
    const limit = notificationsConfig?.notifications_limit;
    const isUnlimited = limit === null || limit === undefined;
    const remainingRaw = notificationsConfig?.notifications_remaining;
    const remainingFallback = safeNumber(limit) - safeNumber(notificationsConfig?.recent_notifications_sent);
    const remaining = isUnlimited ? null : Math.max(0, safeNumber(remainingRaw ?? remainingFallback));
    return { isUnlimited, remaining };
  }, [notificationsConfig]);

  const allowedCount = useMemo(() => {
    if (limitInfo.isUnlimited) return selectedCount;
    return Math.max(0, Math.min(selectedCount, limitInfo.remaining ?? 0));
  }, [limitInfo, selectedCount]);

  const ignoredCount = Math.max(0, selectedCount - allowedCount);
  const isOverLimit = ignoredCount > 0;
  const allowedRows = useMemo(() => selectedRows.slice(0, allowedCount), [selectedRows, allowedCount]);
  const ignoredRows = useMemo(() => selectedRows.slice(allowedCount), [selectedRows, allowedCount]);

  const previewSelected = useMemo(() => {
    return allowedRows.slice(0, 5);
  }, [allowedRows]);

  const previewIgnored = useMemo(() => {
    return ignoredRows.slice(0, 5);
  }, [ignoredRows]);

  const recurrenceTimeOfDay = recurrenceTimeLocal || null;
  const weeklySummaryLabel = recurrenceSummary(weeklyDays, recurrenceTimeOfDay);
  const isScheduledRecurring = sendMode === "schedule" && isRecurringWeekly;
  const isRecurringSelectionInvalid =
    sendMode === "schedule" && isRecurringWeekly && (weeklyDays.length === 0 || !recurrenceTimeOfDay);
  const schedulingStatusLabel =
    sendMode === "now" ? "Imediato" : isScheduledRecurring ? "Semanal" : "Data específica";
  const reviewActionLabel = isScheduledRecurring
    ? "Revisar e Ativar recorrência"
    : sendMode === "schedule"
      ? "Revisar e Agendar"
      : "Revisar e Enfileirar";
  const confirmActionLabel = isScheduledRecurring
    ? "Confirmar e Ativar recorrência"
    : sendMode === "schedule"
      ? "Confirmar e Agendar"
      : "Confirmar e Enfileirar";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="bg-white p-6 rounded-lg shadow-xl border space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Notificações Segmentadas</h2>
            <p className="text-gray-600 mt-1">
              Selecione clientes/passes manualmente ou use filtros para segmentar. Depois escreva a mensagem e envie!
            </p>
          </div>

          <Button
            variant="outline"
            className="gap-2"
            onClick={refreshAll}
            disabled={isLoadingCustomers || isLoadingVisits}
            title="Recarregar passes + visits"
          >
            {(isLoadingCustomers || isLoadingVisits) ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCcw className="w-4 h-4" />
            )}
            Atualizar
          </Button>
        </div>

        {/* Controles de filtro */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-5">
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Buscar por nome, email, google_sub, pass_token ou ID..."
            />
          </div>

          <div className="lg:col-span-7 flex flex-wrap gap-2 items-center">
            <Button
              type="button"
              variant={segmentPreset === "none" ? "default" : "outline"}
              className="gap-2"
              onClick={() => applyPreset("none")}
            >
              <Filter className="w-4 h-4" />
              Sem filtro
            </Button>

            <Button
              type="button"
              variant={segmentPreset === "expired" ? "default" : "outline"}
              onClick={() => applyPreset("expired")}
            >
              Passes expirados
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={segmentPreset === "inactive" ? "default" : "outline"}
                onClick={() => applyPreset("inactive")}
              >
                Sem visita
              </Button>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>≥</span>
                <Input
                  value={inactiveDays}
                  onChange={(e) => setInactiveDays(Number(e.target.value || 0))}
                  type="number"
                  min={1}
                  className="w-[90px]"
                />
                <span>dias</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={segmentPreset === "expiring_soon" ? "default" : "outline"}
                onClick={() => applyPreset("expiring_soon")}
              >
                Prestes a expirar
              </Button>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>≤</span>
                <Input
                  value={expiringDays}
                  onChange={(e) => setExpiringDays(Number(e.target.value || 0))}
                  type="number"
                  min={1}
                  className="w-[90px]"
                />
                <span>dias</span>
              </div>
            </div>
          </div>
        </div>

        {/* Seleção */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-700">
            <span className="font-semibold">{filteredRows.length}</span> resultado(s) visíveis •{" "}
            <span className="font-semibold">{selectedCount}</span> selecionado(s)
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={toggleSelectAllVisible}
              disabled={filteredRows.length === 0}
            >
              {allVisibleSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {allVisibleSelected ? "Desselecionar visíveis" : "Selecionar visíveis"}
            </Button>

            <Button variant="outline" onClick={clearSelection} disabled={selectedCount === 0}>
              Limpar seleção
            </Button>
          </div>
        </div>

        {/* Tabela */}
        <div className="border rounded-lg overflow-hidden shadow-md">
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b">
                <tr className="text-left">
                  <th className="p-3 w-[56px]">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      disabled={filteredRows.length === 0}
                    />
                  </th>
                  <th className="p-3">Cliente</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Pontos</th>
                  <th className="p-3">Última visita</th>
                  <th className="p-3">Expira em</th>
                  <th className="p-3">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {(isLoadingCustomers || isLoadingVisits) ? (
                  <tr>
                    <td className="p-6 text-center text-gray-500" colSpan={7}>
                      <div className="inline-flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Carregando {isLoadingCustomers ? "passes" : "visitas"}...
                      </div>
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td className="p-6 text-center text-gray-500" colSpan={7}>
                      Nenhum passe encontrado com os filtros atuais.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((p) => {
                    const meta = p?.metadata ?? null;
                    const name = getDisplayName(meta);
                    const email = getEmail(meta);
                    const points = getPoints(meta);
                    const lastVisitIso = lastVisitByUserPassId.get(p.id) ?? null;

                    return (
                      <tr key={p.id} className="border-b last:border-b-0 hover:bg-gray-50">
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={selectedCustomerIds.has(p.id)}
                            onChange={() => toggleRow(p.id)}
                          />
                        </td>

                        <td className="p-3">
                          <div className="font-medium text-gray-900">{name}</div>
                        </td>

                        <td className="p-3">{email}</td>
                        <td className="p-3">{points}</td>
                        <td className="p-3">{fmtDate(lastVisitIso)}</td>
                        <td className="p-3">{fmtDate(p?.expires_at)}</td>
                        <td className="p-3">{p?.pass_type || "-"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mensagem + envio */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-8 space-y-2">
            <label className="text-sm font-medium text-gray-800">Mensagem</label>
            <Textarea
              placeholder="Escreva sua mensagem aqui..."
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, maxMessageLen))}
              className="min-h-[120px] text-base"
              maxLength={maxMessageLen}
            />
            <div className="text-right text-xs text-gray-500">
              {message.length} / {maxMessageLen}
            </div>
          </div>

          <div className="lg:col-span-4 space-y-3">
            <div className="p-4 rounded-lg border bg-gray-50 shadow-md">
              <div className="text-sm font-semibold text-gray-800 mb-1">Resumo do envio</div>
              <div className="text-sm text-gray-700">
                Selecionados: <span className="font-semibold">{selectedCount}</span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                <b>Dica:</b> use os filtros para auto-selecionar e depois revise a lista.
              </div>
            </div>

            {/* ✅ Agendamento agora perto do botão */}
            <div className="p-4 rounded-lg border bg-white shadow-md space-y-3">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <Clock className="w-4 h-4" />
                  Agendamento
                </div>
                <span className="text-[11px] text-gray-500">{schedulingStatusLabel}</span>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={sendMode === "now" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => {
                    setSendMode("now");
                    setScheduledLocal(""); // evita “agendamento antigo” por acidente
                    setIsRecurringWeekly(false);
                    setWeeklyDays([]);
                  }}
                >
                  Envio imediato
                </Button>

                <Button
                  type="button"
                  variant={sendMode === "schedule" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setSendMode("schedule")}
                >
                  Agendar
                </Button>
              </div>

              {sendMode === "schedule" && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-600">Frequência do envio</label>
                    <div className="grid grid-cols-2 gap-2 rounded-lg border bg-gray-50 p-1">
                      <button
                        type="button"
                        className={`h-11 rounded-md px-3 text-sm font-medium transition ${
                          !isRecurringWeekly
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                        onClick={() => setIsRecurringWeekly(false)}
                      >
                        Data específica
                      </button>
                      <button
                        type="button"
                        className={`inline-flex h-11 items-center justify-center gap-1 rounded-md px-3 text-sm font-medium transition ${
                          isRecurringWeekly
                            ? "bg-white text-indigo-700 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                        onClick={() => {
                          setIsRecurringWeekly(true);
                          if (!recurrenceTimeLocal) {
                            setRecurrenceTimeLocal(getTimeOfDay(scheduledLocal) || "09:00");
                          }
                        }}
                      >
                        <Repeat className="h-4 w-4" />
                        Repetição semanal
                      </button>
                    </div>
                  </div>

                  {!isRecurringWeekly ? (
                    <div className="space-y-2">
                      <label className="text-xs text-gray-600">Data e hora do envio</label>
                      <Input
                        type="datetime-local"
                        value={scheduledLocal}
                        onChange={(e) => setScheduledLocal(e.target.value)}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-lg border bg-indigo-50/40 p-3">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-700">Dias da semana</label>
                        <div className="flex flex-nowrap items-center gap-1.5">
                          {WEEKDAY_OPTIONS.map((day) => {
                            const isActive = weeklyDays.includes(day.iso);
                            return (
                              <button
                                key={day.iso}
                                type="button"
                                aria-label={day.fullName}
                                aria-pressed={isActive}
                                className={`h-8 w-8 shrink-0 rounded-full border text-xs font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:h-9 sm:w-9 sm:text-sm ${
                                  isActive
                                    ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                                    : "border-gray-300 bg-white text-gray-700 hover:border-indigo-300 hover:text-indigo-700"
                                }`}
                                onClick={() => toggleWeeklyDay(day.iso)}
                              >
                                {day.shortLabel}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-700">Hora dos dias selecionados</label>
                        <Input
                          type="time"
                          step={300}
                          value={recurrenceTimeLocal}
                          onChange={(e) => setRecurrenceTimeLocal(e.target.value)}
                        />
                      </div>

                      <div
                        className={`rounded-md border px-3 py-2 text-xs ${
                          isRecurringSelectionInvalid
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-indigo-200 bg-white text-indigo-700"
                        }`}
                      >
                        {weeklySummaryLabel}
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-gray-500">
                    Prévia:{" "}
                    <span className="text-gray-800 font-medium">
                      {isRecurringWeekly
                        ? `${weeklySummaryLabel}${recurrenceTimeOfDay ? ` (${RECURRENCE_TIMEZONE})` : ""}`
                        : scheduledLocal
                          ? fmtDateTime(new Date(scheduledLocal))
                          : "-"}
                    </span>
                  </div>

                  {isRecurringSelectionInvalid && (
                    <p className="text-xs text-red-600">
                      Para repetição semanal, selecione dia(s) e defina a hora.
                    </p>
                  )}
                </div>
              )}
            </div>

            <Dialog>
              <DialogTrigger asChild>
                <Button
                  size="lg"
                  className="w-full gap-2"
                  disabled={
                    isSending ||
                    selectedCount === 0 ||
                    !message.trim() ||
                    (sendMode === "schedule" && !isRecurringWeekly && !scheduledLocal) ||
                    isRecurringSelectionInvalid
                  }
                >
                  <Send className="w-4 h-4" />
                  {reviewActionLabel}
                </Button>
              </DialogTrigger>

              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    Confirmar{" "}
                    {isScheduledRecurring
                      ? "recorrência semanal"
                      : sendMode === "schedule"
                        ? "agendamento"
                        : "envio"}
                    ?
                  </DialogTitle>
                  <DialogDescription>
                    {!isOverLimit ? (
                      <>
                        Você está prestes a{" "}
                        {isScheduledRecurring
                          ? "ativar uma recorrência semanal"
                          : sendMode === "schedule"
                            ? "agendar"
                            : "enfileirar"}{" "}
                        esta mensagem para <b>{selectedCount}</b> passe(s), criando jobs Apple e Google.
                      </>
                    ) : (
                      <span className="text-red-600 font-semibold">
                        Atenção: você está prestes a enfileirar esta mensagem para {selectedCount} passes,{" "}
                        {ignoredCount} serão ignorados (limite excedido).
                      </span>
                    )}
                  </DialogDescription>
                </DialogHeader>

                <div className="my-4 space-y-3">
                  <div className="p-4 bg-gray-100 rounded-md border text-gray-800">
                    <div className="text-xs text-gray-500 mb-2">Mensagem</div>
                    <p className="whitespace-pre-wrap">{message}</p>
                  </div>

                  {sendMode === "schedule" && (
                    <div className="p-4 bg-white rounded-md border">
                      {!isRecurringWeekly ? (
                        <>
                          <div className="text-xs text-gray-500 mb-1">Agendado para</div>
                          <div className="text-sm font-semibold text-gray-800">
                            {scheduledLocal ? fmtDateTime(new Date(scheduledLocal)) : "-"}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs text-gray-500 mb-1">Recorrência semanal</div>
                          <div className="text-sm font-semibold text-gray-800">
                            {weeklySummaryLabel}
                          </div>
                        </>
                      )}
                      {isRecurringWeekly && recurrenceTimeOfDay && (
                        <div className="text-xs text-indigo-700 mt-2">
                          Hora aplicada: {recurrenceTimeOfDay} ({RECURRENCE_TIMEZONE})
                        </div>
                      )}
                    </div>
                  )}

                  <div className="p-4 bg-green-50 rounded-md border border-green-200">
                    <div className="text-xs text-gray-500 mb-2">Amostra de selecionados</div>
                    <ul className="text-sm text-gray-800 list-disc pl-5 space-y-1">
                      {previewSelected.map((p) => {
                        const meta = p?.metadata ?? null;
                        return (
                          <li key={p.id}>
                            {getDisplayName(meta)}{" "}
                            <span className="text-gray-500">
                              ({getEmail(meta) || "sem email"}) • pass: {p?.pass_type || "-"}
                            </span>
                          </li>
                        );
                      })}
                      {allowedCount > 5 && (
                        <li className="text-gray-500">... e mais {allowedCount - 5}</li>
                      )}
                      {allowedCount === 0 && <li className="text-gray-500">Nenhum passe será enfileirado.</li>}
                    </ul>
                  </div>

                  {isOverLimit && (
                    <div className="p-4 bg-red-50 rounded-md border border-red-200">
                      <div className="text-xs text-red-700 mb-2">Amostra de ignorados</div>
                      <ul className="text-sm text-red-900 list-disc pl-5 space-y-1">
                        {previewIgnored.map((p) => {
                          const meta = p?.metadata ?? null;
                          return (
                            <li key={p.id}>
                              {getDisplayName(meta)}{" "}
                              <span className="text-red-700">
                                ({getEmail(meta) || "sem email"}) • pass: {p?.pass_type || "-"}
                              </span>
                            </li>
                          );
                        })}
                        {ignoredCount > 5 && (
                          <li className="text-red-700">... e mais {ignoredCount - 5}</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button onClick={handleEnqueue} disabled={isSending} className="w-full">
                    {isSending ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Bell className="w-4 h-4 mr-2" />
                    )}
                    {confirmActionLabel}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                const suggested = buildSuggestedMessage(segmentPreset);
                if (suggested) setMessage(suggested);
                else
                  toast({
                    title: "Sem sugestão",
                    description: "Selecione um filtro para sugerir uma mensagem.",
                  });
              }}
              disabled={segmentPreset === "none"}
            >
              Usar mensagem sugerida
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default NotificationsTab;


