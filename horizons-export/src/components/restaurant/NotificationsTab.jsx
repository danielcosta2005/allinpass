import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bell, Loader2, Send, Filter, RefreshCcw, CheckSquare, Square, Clock } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

const NotificationsTab = ({ projectId }) => {
  // =========================
  // Supabase client (front)
  // =========================
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const supabase = useMemo(() => {
    if (!supabaseUrl || !supabaseAnonKey) return null;
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }, [supabaseUrl, supabaseAnonKey]);

  const { toast } = useToast();

  // user_passes (fonte principal)
  const [rows, setRows] = useState([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);

  // visits summary: last visit per user_pass_id (within a window)
  const [lastVisitByUserPassId, setLastVisitByUserPassId] = useState(() => new Map());
  const [isLoadingVisits, setIsLoadingVisits] = useState(false);

  const [lastFetchAt, setLastFetchAt] = useState(null);

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

  async function getAuthHeader() {
    try {
      if (!supabase) return `Bearer ${supabaseAnonKey}`;
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      return token ? `Bearer ${token}` : `Bearer ${supabaseAnonKey}`;
    } catch {
      return `Bearer ${supabaseAnonKey}`;
    }
  }

  // =========================
  // Data loading
  // =========================
  async function fetchCustomersWithPass() {
    if (!supabase) {
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
            "pass_token",
            "pass_type",
            "metadata",
            "issued_at",
            "expires_at",
            "created_at",
            "install_status",
            "installed_at",
            "removed_at",
            "device_key",
            "google_object_id",
            "google_class_id",
            "pass_id",
            "passes(project_id)",
          ].join(",")
        )
        .eq("passes.project_id", projectId)
        .eq("install_status", "installed")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setRows(Array.isArray(data) ? data : []);
      setLastFetchAt(new Date());
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao carregar passes",
        description: err?.message || "Falha inesperada ao buscar user_passes + passes.project_id.",
      });
      setRows([]);
    } finally {
      setIsLoadingCustomers(false);
    }
  }

  async function fetchVisitsSummary() {
    if (!supabase) return;
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

  async function refreshAll() {
    await fetchCustomersWithPass();
    await fetchVisitsSummary();
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
  // Enqueue notifications
  // =========================
  async function handleEnqueue() {
    if (!message.trim()) {
      toast({ variant: "destructive", title: "Erro de Validação", description: "A mensagem não pode estar vazia." });
      return;
    }

    if (selectedCustomerIds.size === 0) {
      toast({ variant: "destructive", title: "Nada selecionado", description: "Selecione pelo menos 1 passe." });
      return;
    }

    let scheduledFor = null;
    if (sendMode === "schedule") {
      scheduledFor = localDateTimeToUtcIso(scheduledLocal);
      if (!scheduledFor) {
        toast({ variant: "destructive", title: "Agendamento inválido", description: "Selecione data e hora." });
        return;
      }
      if (new Date(scheduledFor).getTime() < Date.now() - 30_000) {
        toast({ variant: "destructive", title: "Agendamento no passado", description: "Escolha uma data/hora futura." });
        return;
      }
    }

    const functionsUrl =
      import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

    setIsSending(true);
    try {
      const authHeader = await getAuthHeader();

      const payload = {
        projectId,
        title: sendMode === "schedule" ? "Envio manual (agendado)" : "Envio manual",
        message: message.trim(),
        sendMode,
        scheduledFor,
        segment: {
          preset: segmentPreset,
          inactiveDays,
          expiringDays,
          searchText: searchText.trim() || null,
          ui: "NotificationsTab(user_passes)",
        },
        user_pass_ids: Array.from(selectedCustomerIds),
        channels: { apple: true, google: true },
      };

      const res = await fetch(`${functionsUrl}/notifications-enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) throw new Error(json?.error || "Falha ao enfileirar.");

      toast({
        title: sendMode === "schedule" ? "Agendado ✅" : "Enfileirado ✅",
        description: `Criados ${json?.jobs_created ?? 0} job(s). Ignorados (removed): ${json?.skipped?.removed ?? 0}.`,
      });
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

  const previewSelected = useMemo(() => {
    const selected = rows.filter((p) => selectedCustomerIds.has(p.id));
    return selected.slice(0, 5);
  }, [rows, selectedCustomerIds]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <div className="bg-white p-6 rounded-lg shadow-sm border space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Notificações Segmentadas</h2>
            <p className="text-gray-600 mt-1">
              Selecione clientes/passes manualmente ou use filtros para segmentar. Depois escreva a mensagem e envie!
            </p>
            {lastFetchAt && (
              <p className="text-xs text-gray-500 mt-2">
                Última atualização: {fmtDateTime(lastFetchAt)}
                {isLoadingVisits ? " • carregando visitas..." : ""}
              </p>
            )}
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
        <div className="border rounded-lg overflow-hidden">
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
                    const googleSub = getGoogleSub(meta);
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
                          <div className="text-xs text-gray-500">
                            sub: {String(googleSub || "").slice(0, 10)}… • id: {String(p?.id || "").slice(0, 8)}…
                          </div>
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
            <div className="p-4 rounded-lg border bg-gray-50">
              <div className="text-sm font-semibold text-gray-800 mb-1">Resumo do envio</div>
              <div className="text-sm text-gray-700">
                Selecionados: <span className="font-semibold">{selectedCount}</span>
              </div>
              <div className="text-xs text-gray-500 mt-2">
                <b>Dica:</b> use os filtros para auto-selecionar e depois revise a lista.
              </div>
            </div>

            {/* ✅ Agendamento agora perto do botão */}
            <div className="p-4 rounded-lg border bg-white space-y-3">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <Clock className="w-4 h-4" />
                  Agendamento
                </div>
                <span className="text-[11px] text-gray-500">
                  {sendMode === "schedule" ? "Agendado" : "Imediato"}
                </span>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={sendMode === "now" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => {
                    setSendMode("now");
                    setScheduledLocal(""); // evita “agendamento antigo” por acidente
                  }}
                >
                  Agora
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
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-600">Data e hora</label>
                    <Input
                      type="datetime-local"
                      value={scheduledLocal}
                      onChange={(e) => setScheduledLocal(e.target.value)}
                    />
                  </div>

                  <div className="text-xs text-gray-500">
                    Prévia:{" "}
                    <span className="text-gray-800 font-medium">
                      {scheduledLocal ? fmtDateTime(new Date(scheduledLocal)) : "-"}
                    </span>
                  </div>
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
                    (sendMode === "schedule" && !scheduledLocal)
                  }
                >
                  <Send className="w-4 h-4" />
                  Revisar e {sendMode === "schedule" ? "Agendar" : "Enfileirar"}
                </Button>
              </DialogTrigger>

              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    Confirmar {sendMode === "schedule" ? "agendamento" : "envio"}?
                  </DialogTitle>
                  <DialogDescription>
                    Você está prestes a {sendMode === "schedule" ? "agendar" : "enfileirar"} esta mensagem para{" "}
                    <b>{selectedCount}</b> passe(s), criando jobs Apple e Google.
                  </DialogDescription>
                </DialogHeader>

                <div className="my-4 space-y-3">
                  <div className="p-4 bg-gray-100 rounded-md border text-gray-800">
                    <div className="text-xs text-gray-500 mb-2">Mensagem</div>
                    <p className="whitespace-pre-wrap">{message}</p>
                  </div>

                  {sendMode === "schedule" && (
                    <div className="p-4 bg-white rounded-md border">
                      <div className="text-xs text-gray-500 mb-1">Agendado para</div>
                      <div className="text-sm font-semibold text-gray-800">
                        {scheduledLocal ? fmtDateTime(new Date(scheduledLocal)) : "-"}
                      </div>
                    </div>
                  )}

                  <div className="p-4 bg-white rounded-md border">
                    <div className="text-xs text-gray-500 mb-2">Amostra de selecionados (até 5)</div>
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
                      {selectedCount > 5 && (
                        <li className="text-gray-500">… e mais {selectedCount - 5}</li>
                      )}
                    </ul>
                  </div>
                </div>

                <DialogFooter>
                  <Button onClick={handleEnqueue} disabled={isSending} className="w-full">
                    {isSending ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Bell className="w-4 h-4 mr-2" />
                    )}
                    Confirmar e {sendMode === "schedule" ? "Agendar" : "Enfileirar"}
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
                else toast({ title: "Sem sugestão", description: "Selecione um filtro para sugerir uma mensagem." });
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