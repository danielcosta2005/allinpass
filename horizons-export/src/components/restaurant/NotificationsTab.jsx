import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bell, Loader2, Send, Filter, RefreshCcw, CheckSquare, Square } from "lucide-react";
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

  // customers + user_passes
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

  // seleção
  const [selectedCustomerIds, setSelectedCustomerIds] = useState(() => new Set());

  // mensagem
  const [message, setMessage] = useState("");
  const maxMessageLen = 200;

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
        .from("customers")
        .select(
          [
            "id",
            "project_id",
            "google_sub",
            "name",
            "email",
            "job_tag",
            "created_at",
            "updated_at",
            "visits",
            "pass_status",
            "user_pass_id",
            "user_passes!customers_user_pass_id_fkey(id, pass_token, pass_type, metadata, issued_at, expires_at, install_status, installed_at, removed_at, device_key, google_object_id, google_class_id, pass_id, project_id)",
          ].join(",")
        )
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setRows(Array.isArray(data) ? data : []);
      setLastFetchAt(new Date());
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao carregar customers",
        description: err?.message || "Falha inesperada ao buscar customers + user_passes.",
      });
    } finally {
      setIsLoadingCustomers(false);
    }
  }

  async function fetchVisitsSummary() {
    if (!supabase) return;
    if (!projectId) return;

    // Janela para “última visita”: escolha pragmática para não puxar o histórico inteiro.
    // Você pode subir para 730 (2 anos) se quiser.
    const VISITS_LOOKBACK_DAYS = 365;
    const since = daysAgo(VISITS_LOOKBACK_DAYS).toISOString();

    setIsLoadingVisits(true);
    try {
      // A query busca visitas recentes e nós calculamos max(created_at) por user_pass_id no client.
      // ATENÇÃO: se o volume for gigante, vale evoluir pra RPC/view com MAX/GROUP BY.
      const { data, error } = await supabase
        .from("visits")
        .select("user_pass_id, created_at")
        .eq("project_id", projectId)
        .not("user_pass_id", "is", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10000); // guarda-corpo; dá pra paginar depois se precisar

      if (error) throw error;

      const map = new Map();
      for (const v of data || []) {
        const pid = v.user_pass_id;
        const createdAt = v.created_at;
        if (!pid || !createdAt) continue;

        // como veio order desc, o primeiro de cada pid já é o mais recente
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

    return (rows || []).filter((r) => {
      const c = r;
      const p = r?.user_passes || null;

      // busca textual (customers)
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        const hay =
          [
            c?.name,
            c?.email,
            c?.job_tag,
            c?.google_sub,
            String(c?.id || ""),
          ]
            .map(safeLower)
            .join(" | ") || "";

        if (!hay.includes(q)) return false;
      }

      const passStatus = safeLower(c?.pass_status);
      const expiresAt = toDate(p?.expires_at);

      if (segmentPreset === "expired") {
        const expiredByDate = expiresAt ? expiresAt < now : false;
        const expiredByStatus = passStatus === "expired";
        return expiredByDate || expiredByStatus;
      }

      if (segmentPreset === "expiring_soon") {
        if (!expiresAt) return false;
        return expiresAt >= now && expiresAt <= expiringCutoff;
      }

      if (segmentPreset === "inactive") {
        // Regra real: usa tabela visits (mapa lastVisitByUserPassId)
        // Se não tiver user_pass_id, tratamos como inativo (não dá pra correlacionar visitas).
        const userPassId = c?.user_pass_id;
        if (!userPassId) return true;

        const lastVisitIso = lastVisitByUserPassId.get(userPassId) || null;
        const lastVisitAt = toDate(lastVisitIso);

        // se não achou visita na janela, consideramos inativo (há muito tempo ou nunca visitou)
        if (!lastVisitAt) return true;

        return lastVisitAt < inactivityCutoff;
      }

      return true;
    });
  }, [rows, searchText, segmentPreset, inactiveDays, expiringDays, lastVisitByUserPassId]);

  const visibleCustomerIds = useMemo(() => new Set(filteredRows.map((r) => r.id)), [filteredRows]);

  const visibleSelectedCount = useMemo(() => {
    let n = 0;
    selectedCustomerIds.forEach((id) => {
      if (visibleCustomerIds.has(id)) n += 1;
    });
    return n;
  }, [selectedCustomerIds, visibleCustomerIds]);

  const allVisibleSelected =
    filteredRows.length > 0 && visibleSelectedCount === filteredRows.length;

  // =========================
  // Selection actions
  // =========================
  function toggleRow(customerId) {
    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedCustomerIds((prev) => {
      const next = new Set(prev);

      if (allVisibleSelected) {
        filteredRows.forEach((r) => next.delete(r.id));
      } else {
        filteredRows.forEach((r) => next.add(r.id));
      }
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

    // auto-seleção dos filtrados
    setTimeout(() => {
      setSelectedCustomerIds(() => {
        const next = new Set();
        filteredRows.forEach((r) => next.add(r.id));
        return next;
      });
    }, 0);
  }

  // =========================
  // Send segmented notifications
  // =========================
  async function handleSendSegmented() {
    if (!message.trim()) {
      toast({
        variant: "destructive",
        title: "Erro de Validação",
        description: "A mensagem não pode estar vazia.",
      });
      return;
    }

    if (selectedCustomerIds.size === 0) {
      toast({
        variant: "destructive",
        title: "Nada selecionado",
        description: "Selecione pelo menos 1 cliente para enviar a notificação.",
      });
      return;
    }

    const functionsUrl =
      import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

    const selected = rows.filter((r) => selectedCustomerIds.has(r.id));

    const targets = selected.map((r) => {
      const c = r;
      const p = r?.user_passes || null;

      return {
        customer_id: c.id,
        project_id: c.project_id,
        user_pass_id: c.user_pass_id,

        // customer info (logs)
        google_sub: c.google_sub,
        name: c.name ?? null,
        email: c.email ?? null,

        // pass info (back escolhe)
        pass_type: p?.pass_type ?? null,
        pass_token: p?.pass_token ?? null,
        device_key: p?.device_key ?? null,
        google_object_id: p?.google_object_id ?? null,
        google_class_id: p?.google_class_id ?? null,
        expires_at: p?.expires_at ?? null,
        install_status: p?.install_status ?? null,

        // para debug/observabilidade
        last_visit_at: c?.user_pass_id ? (lastVisitByUserPassId.get(c.user_pass_id) ?? null) : null,
      };
    });

    setIsSending(true);
    try {
      const authHeader = await getAuthHeader();

      const body = {
        projectId,
        message: message.trim(),
        segment: {
          preset: segmentPreset,
          inactiveDays,
          expiringDays,
          searchText: searchText.trim() || null,
        },
        targets,
      };

      const appleRes = await fetch(`${functionsUrl}/send-apple-segmented-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify(body),
      });
      const appleJson = await appleRes.json().catch(() => ({}));
      if (!appleRes.ok || appleJson?.error) {
        throw new Error(appleJson?.error || "Falha ao enviar notificação segmentada (Apple).");
      }

      const googleRes = await fetch(`${functionsUrl}/send-google-segmented-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify(body),
      });
      const googleJson = await googleRes.json().catch(() => ({}));
      if (!googleRes.ok || googleJson?.error) {
        throw new Error(googleJson?.error || "Falha ao enviar notificação segmentada (Google).");
      }

      toast({
        title: "Notificações enviadas!",
        description: `Mensagem enviada para ${selectedCustomerIds.size} cliente(s).`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao Enviar",
        description: err?.message || "Erro inesperado ao enviar notificações segmentadas.",
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
    const selected = rows.filter((r) => selectedCustomerIds.has(r.id));
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
              Selecione clientes manualmente ou use filtros para segmentar. Depois escreva a mensagem e envie!
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
            title="Recarregar customers + visits"
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
              placeholder="Buscar por nome, email, job_tag, google_sub ou ID..."
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
                  <th className="p-3">Visitas</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Última visita</th>
                  <th className="p-3">Expira em</th>
                  <th className="p-3">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {(isLoadingCustomers || isLoadingVisits) ? (
                  <tr>
                    <td className="p-6 text-center text-gray-500" colSpan={8}>
                      <div className="inline-flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Carregando {isLoadingCustomers ? "customers" : "visitas"}...
                      </div>
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td className="p-6 text-center text-gray-500" colSpan={8}>
                      Nenhum customer encontrado com os filtros atuais.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => {
                    const c = r;
                    const p = r?.user_passes || null;

                    const lastVisitIso = c?.user_pass_id ? (lastVisitByUserPassId.get(c.user_pass_id) ?? null) : null;

                    return (
                      <tr key={c.id} className="border-b last:border-b-0 hover:bg-gray-50">
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={selectedCustomerIds.has(c.id)}
                            onChange={() => toggleRow(c.id)}
                          />
                        </td>

                        <td className="p-3">
                          <div className="font-medium text-gray-900">{c?.name || "(Sem nome)"}</div>
                          <div className="text-xs text-gray-500">
                            sub: {String(c?.google_sub || "").slice(0, 10)}… • id: {String(c?.id || "").slice(0, 8)}…
                          </div>
                        </td>

                        <td className="p-3">{c?.email || "-"}</td>
                        <td className="p-3">{typeof c?.visits === "number" ? c.visits : "-"}</td>
                        <td className="p-3">{c?.pass_status || "-"}</td>
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

            <Dialog>
              <DialogTrigger asChild>
                <Button
                  size="lg"
                  className="w-full gap-2"
                  disabled={isSending || selectedCount === 0 || !message.trim()}
                >
                  <Send className="w-4 h-4" />
                  Revisar e Enviar
                </Button>
              </DialogTrigger>

              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirmar envio segmentado?</DialogTitle>
                  <DialogDescription>
                    Você está prestes a enviar esta mensagem para <b>{selectedCount}</b> cliente(s),
                    disparando Apple e Google.
                  </DialogDescription>
                </DialogHeader>

                <div className="my-4 space-y-3">
                  <div className="p-4 bg-gray-100 rounded-md border text-gray-800">
                    <div className="text-xs text-gray-500 mb-2">Mensagem</div>
                    <p className="whitespace-pre-wrap">{message}</p>
                  </div>

                  <div className="p-4 bg-white rounded-md border">
                    <div className="text-xs text-gray-500 mb-2">Amostra de selecionados (até 5)</div>
                    <ul className="text-sm text-gray-800 list-disc pl-5 space-y-1">
                      {previewSelected.map((r) => (
                        <li key={r.id}>
                          {r?.name || "(Sem nome)"}{" "}
                          <span className="text-gray-500">
                            ({r?.email || "sem email"}) • pass: {r?.user_passes?.pass_type || "-"}
                          </span>
                        </li>
                      ))}
                      {selectedCount > 5 && (
                        <li className="text-gray-500">… e mais {selectedCount - 5}</li>
                      )}
                    </ul>
                  </div>
                </div>

                <DialogFooter>
                  <Button onClick={handleSendSegmented} disabled={isSending} className="w-full">
                    {isSending ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Bell className="w-4 h-4 mr-2" />
                    )}
                    Confirmar e Enviar
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
