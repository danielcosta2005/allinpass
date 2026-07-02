import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle,
  Eye,
  Gift,
  Loader2,
  Plus,
  ScanLine,
  Video,
  VideoOff,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import {
  getFunctionErrorMessage,
  readFunctionErrorPayload,
} from "@/lib/functionErrors";
import QrScanner from "@/lib/qrScanner";
import { supabase } from "@/lib/supabaseClient";

function extractPassToken(qrData) {
  const raw = String(qrData ?? "").trim();
  if (!raw) return null;

  if (!raw.startsWith("http://") && !raw.startsWith("https://")) return raw;

  try {
    const u = new URL(raw);
    const sp = u.searchParams;
    const byQuery =
      sp.get("token") ||
      sp.get("t") ||
      sp.get("s") ||
      sp.get("pass_token") ||
      sp.get("pt");
    if (byQuery) return String(byQuery).trim();

    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
    return null;
  } catch {
    return raw;
  }
}

function normalizeScanResult(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  return result?.data || result?.rawValue || result?.text || "";
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      aria-pressed={checked}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-60 ${
        checked ? "bg-indigo-500" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function formatDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR");
}

function parseCurrencyToCents(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const normalized = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function formatCurrencyCents(cents) {
  const parsed = Number(cents);
  const normalizedCents = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(normalizedCents / 100);
}

function getRewardType(reward) {
  return reward?.reward_type === "value" ? "value" : "loyalty";
}

function formatRewardCost(reward) {
  if (getRewardType(reward) === "value") {
    return formatCurrencyCents(reward?.value_required_cents);
  }
  return `${reward?.points_required ?? 0} ponto(s)`;
}

function formatRedemptionBalance(redemption) {
  if (redemption?.reward_type === "value") {
    return `${formatCurrencyCents(redemption.value_before_cents)} -> ${formatCurrencyCents(redemption.value_after_cents)}`;
  }
  return `${redemption?.points_before ?? 0} -> ${redemption?.points_after ?? 0}`;
}

function normalizeCustomer(customer) {
  if (Array.isArray(customer)) return customer[0] || null;
  return customer || null;
}

function RedemptionsTable({ redemptions, isCompact = false }) {
  if (!redemptions?.length) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground">
        Nenhum resgate encontrado.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-muted text-xs uppercase text-muted-foreground">
          <tr>
            {!isCompact && <th className="px-4 py-3">Recompensa</th>}
            <th className="px-4 py-3">Cliente</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Data/Hora</th>
            <th className="px-4 py-3 text-center">Saldo/Pontos</th>
          </tr>
        </thead>
        <tbody>
          {redemptions.map((redemption) => {
            const customer = normalizeCustomer(redemption.customers);
            const customerName = customer?.name || "Cliente nÃ£o identificado";
            const customerEmail = customer?.email || "-";

            return (
              <tr key={redemption.id} className="border-t">
                {!isCompact && (
                  <td className="px-4 py-3 font-medium text-foreground">
                    {redemption.reward_name || "-"}
                  </td>
                )}
                <td className="px-4 py-3 text-foreground">{customerName}</td>
                <td className="px-4 py-3 text-muted-foreground">{customerEmail}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDateTime(redemption.created_at)}</td>
                <td className="px-4 py-3 text-center font-medium text-foreground">
                  {formatRedemptionBalance(redemption)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function readFunctionErrorBody(error, response) {
  const context = response || error?.context;
  if (!context || typeof context.clone !== "function") return null;

  try {
    const errorResponse = context.clone();
    const contentType = errorResponse.headers?.get?.("content-type") || "";

    if (contentType.includes("application/json")) {
      return await errorResponse.json();
    }

    const text = await errorResponse.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  } catch {
    return null;
  }
}

function formatScannerRewardError(body, fallback) {
  if (body?.error === "insufficient_points") {
    const points = Number(body.points);
    const pointsRequired = Number(body.points_required);
    const hasPointDetails = Number.isFinite(points) && Number.isFinite(pointsRequired);

    return hasPointDetails
      ? `Este passe nao tem pontos suficientes para esta recompensa. Saldo atual: ${points} ponto(s). Necessario: ${pointsRequired}.`
      : "Este passe nao tem pontos suficientes para esta recompensa.";
  }

  if (body?.error === "insufficient_balance") {
    return `Este passe nao tem saldo suficiente para esta recompensa. Saldo atual: ${formatCurrencyCents(body.balance_cents)}. Necessario: ${formatCurrencyCents(body.value_required_cents)}.`;
  }

  return getFunctionErrorMessage(body, fallback?.message || "Nao foi possivel resgatar a recompensa.");
}

export default function RewardsTab({ activeTab = "rewards", canManageRewards = true, onTabChange, projectId }) {
  const { toast } = useToast();
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const onScanRef = useRef(null);
  const resetTimerRef = useRef(null);

  const [rewards, setRewards] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingRewardId, setUpdatingRewardId] = useState(null);
  const activeSubTab = activeTab === "history" ? "history" : "rewards";

  const [name, setName] = useState("");
  const [rewardType, setRewardType] = useState("loyalty");
  const [pointsRequired, setPointsRequired] = useState(10);
  const [valueRequired, setValueRequired] = useState("");

  const [redeemingReward, setRedeemingReward] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [expandedRewardId, setExpandedRewardId] = useState(null);
  const [redemptionsByRewardId, setRedemptionsByRewardId] = useState({});
  const [redemptionsLoadingByRewardId, setRedemptionsLoadingByRewardId] = useState({});
  const [generalRedemptions, setGeneralRedemptions] = useState([]);
  const [isLoadingGeneralRedemptions, setIsLoadingGeneralRedemptions] = useState(false);
  const [hasLoadedGeneralRedemptions, setHasLoadedGeneralRedemptions] = useState(false);

  const activeRewards = useMemo(
    () => rewards.filter((reward) => reward.status === "active"),
    [rewards],
  );

  useEffect(() => {
    if (activeTab !== "rewards" && activeTab !== "history") {
      onTabChange?.("rewards");
    }
  }, [activeTab, onTabChange]);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const createScanner = useCallback(() => {
    if (scannerRef.current) return scannerRef.current;
    if (!videoRef.current) return null;

    const scanner = new QrScanner(
      videoRef.current,
      (result) => onScanRef.current?.(result),
      { highlightScanRegion: true, highlightCodeOutline: true },
    );

    scannerRef.current = scanner;
    return scanner;
  }, []);

  async function fetchRewards() {
    if (!projectId) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("rewards")
        .select("id, project_id, name, reward_type, points_required, value_required_cents, currency, status, created_at, updated_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRewards(Array.isArray(data) ? data : []);
    } catch (err) {
      setRewards([]);
      toast({
        variant: "destructive",
        title: "Erro ao carregar recompensas",
        description: err?.message || "Nao foi possivel buscar as recompensas.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  const fetchRedemptions = useCallback(async ({ rewardId, limit = 100 } = {}) => {
    if (!projectId) return [];

    let query = supabase
      .from("reward_redemptions")
      .select(
        "id, reward_id, reward_name, reward_type, customer_id, user_pass_id, points_spent, points_before, points_after, value_spent_cents, value_before_cents, value_after_cents, currency, notification_warning, created_at, customers(name, email)"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (rewardId) query = query.eq("reward_id", rewardId);

    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }, [projectId]);

  const fetchRewardRedemptions = useCallback(async (rewardId, { force = false } = {}) => {
    if (!rewardId) return;
    if (!force && redemptionsByRewardId[rewardId]) return;

    setRedemptionsLoadingByRewardId((prev) => ({ ...prev, [rewardId]: true }));
    try {
      const data = await fetchRedemptions({ rewardId, limit: 50 });
      setRedemptionsByRewardId((prev) => ({ ...prev, [rewardId]: data }));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao carregar resgates",
        description: err?.message || "Nao foi possivel buscar o historico desta recompensa.",
      });
      setRedemptionsByRewardId((prev) => ({ ...prev, [rewardId]: [] }));
    } finally {
      setRedemptionsLoadingByRewardId((prev) => ({ ...prev, [rewardId]: false }));
    }
  }, [fetchRedemptions, redemptionsByRewardId, toast]);

  const fetchGeneralRedemptions = useCallback(async ({ force = false } = {}) => {
    if (!projectId) return;
    if (!force && hasLoadedGeneralRedemptions) return;

    setIsLoadingGeneralRedemptions(true);
    try {
      const data = await fetchRedemptions({ limit: 100 });
      setGeneralRedemptions(data);
      setHasLoadedGeneralRedemptions(true);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao carregar historico",
        description: err?.message || "Nao foi possivel buscar o historico geral de resgates.",
      });
      setGeneralRedemptions([]);
    } finally {
      setIsLoadingGeneralRedemptions(false);
    }
  }, [fetchRedemptions, hasLoadedGeneralRedemptions, projectId, toast]);

  useEffect(() => {
    fetchRewards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    setExpandedRewardId(null);
    setRedemptionsByRewardId({});
    setRedemptionsLoadingByRewardId({});
    setGeneralRedemptions([]);
    setHasLoadedGeneralRedemptions(false);
  }, [projectId]);

  useEffect(() => {
    if (activeSubTab === "history") {
      fetchGeneralRedemptions();
    }
  }, [activeSubTab, fetchGeneralRedemptions]);

  useEffect(() => {
    return () => {
      clearResetTimer();
      try {
        scannerRef.current?.destroy();
      } catch {}
    };
  }, [clearResetTimer]);

  function startCreate() {
    if (!canManageRewards) return;
    setName("");
    setRewardType("loyalty");
    setPointsRequired(10);
    setValueRequired("");
    setIsCreating(true);
  }

  async function saveReward() {
    if (!canManageRewards) return;

    const finalName = name.trim();
    const finalPoints = Number(pointsRequired);
    const finalRewardType = rewardType === "value" ? "value" : "loyalty";
    const finalValueCents = parseCurrencyToCents(valueRequired);

    if (!finalName) {
      toast({ variant: "destructive", title: "Nome obrigatorio" });
      return;
    }

    if (finalRewardType === "loyalty" && (!Number.isInteger(finalPoints) || finalPoints <= 0)) {
      toast({ variant: "destructive", title: "Pontos invalidos", description: "Informe um numero inteiro maior que zero." });
      return;
    }

    if (finalRewardType === "value" && !finalValueCents) {
      toast({ variant: "destructive", title: "Valor invalido", description: "Informe um valor maior que zero, como 12,34." });
      return;
    }

    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from("rewards")
        .insert({
          project_id: projectId,
          name: finalName,
          reward_type: finalRewardType,
          points_required: finalRewardType === "loyalty" ? finalPoints : null,
          value_required_cents: finalRewardType === "value" ? finalValueCents : null,
          currency: "BRL",
          status: "active",
        })
        .select("id, project_id, name, reward_type, points_required, value_required_cents, currency, status, created_at, updated_at")
        .single();

      if (error) throw error;

      setRewards((prev) => [data, ...prev]);
      setIsCreating(false);
      toast({
        title: "Recompensa criada",
        description: "A recompensa ja pode ser contabilizada pelo scanner.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao criar recompensa",
        description: err?.message || "Nao foi possivel salvar a recompensa.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleRewardStatus(reward) {
    if (!canManageRewards || !reward?.id) return;

    const nextStatus = reward.status === "active" ? "inactive" : "active";
    setUpdatingRewardId(reward.id);

    try {
      const { data, error } = await supabase
        .from("rewards")
        .update({ status: nextStatus })
        .eq("id", reward.id)
        .eq("project_id", projectId)
        .select("id, project_id, name, reward_type, points_required, value_required_cents, currency, status, created_at, updated_at")
        .single();

      if (error) throw error;

      setRewards((prev) => prev.map((item) => (item.id === reward.id ? data : item)));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao atualizar recompensa",
        description: err?.message || "Nao foi possivel alterar o status.",
      });
    } finally {
      setUpdatingRewardId(null);
    }
  }

  const stopScan = useCallback(async () => {
    try {
      await scannerRef.current?.stop();
    } catch {}
    setIsScanning(false);
  }, []);

  const startScan = useCallback(async () => {
    let scanner = createScanner();

    if (!scanner) {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      scanner = createScanner();
    }

    if (!scanner) {
      toast({
        variant: "destructive",
        title: "Scanner indisponivel",
        description: "Nao foi possivel preparar o video do scanner. Feche e abra o resgate novamente.",
      });
      return;
    }

    try {
      await scanner.start();
      setIsScanning(true);
      setScanResult(null);
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Erro na camera",
        description: "Nao foi possivel acessar a camera. Verifique as permissoes.",
      });
    }
  }, [createScanner, toast]);

  const callScannerReward = useCallback(async ({ rewardId, passToken }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) throw new Error("Sessao expirada. Faca login novamente.");

    const { data, error, response } = await supabase.functions.invoke("scanner-reward", {
      body: {
        projectId,
        rewardId,
        qrData: passToken,
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (error) {
      const errorBody = await readFunctionErrorPayload(error, response);
      throw new Error(formatScannerRewardError(errorBody, error));
    }
    if (!data) throw new Error("Resposta vazia da Edge Function.");
    if (data.error) throw new Error(formatScannerRewardError(data));

    return data;
  }, [projectId]);

  const onScan = useCallback(async (result) => {
    if (isProcessingScan || !redeemingReward) return;

    setIsProcessingScan(true);
    await stopScan();

    try {
      const txt = normalizeScanResult(result);
      const passToken = extractPassToken(txt);

      if (!passToken) throw new Error("QR Code invalido: nao encontrei o token do passe.");

      const data = await callScannerReward({
        rewardId: redeemingReward.id,
        passToken,
      });

      setScanResult({ success: true, data });
      setRedemptionsByRewardId((prev) => {
        if (!redeemingReward?.id || !prev[redeemingReward.id]) return prev;
        const next = { ...prev };
        delete next[redeemingReward.id];
        return next;
      });
      setHasLoadedGeneralRedemptions(false);
      if (expandedRewardId === redeemingReward.id) {
        fetchRewardRedemptions(redeemingReward.id, { force: true });
      }
      if (activeSubTab === "history") {
        fetchGeneralRedemptions({ force: true });
      }
      toast({
        title: "Recompensa contabilizada",
        description: `${data.reward_name}: ${formatRedemptionBalance(data)}.`,
      });
    } catch (err) {
      setScanResult({ success: false, error: err?.message || String(err) });
      toast({
        variant: "destructive",
        title: "Erro ao resgatar recompensa",
        description: err?.message || String(err),
      });
    } finally {
      clearResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        setIsProcessingScan(false);
        setScanResult(null);
      }, 5000);
    }
  }, [
    activeSubTab,
    callScannerReward,
    clearResetTimer,
    expandedRewardId,
    fetchGeneralRedemptions,
    fetchRewardRedemptions,
    isProcessingScan,
    redeemingReward,
    stopScan,
    toast,
  ]);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!redeemingReward) return undefined;
    createScanner();

    return () => {
      const scanner = scannerRef.current;
      try {
        scanner?.destroy();
      } catch {}
      scannerRef.current = null;
      setIsScanning(false);
    };
  }, [createScanner, redeemingReward]);

  function openRedeem(reward) {
    clearResetTimer();
    setRedeemingReward(reward);
    setScanResult(null);
    setIsProcessingScan(false);
  }

  async function closeRedeem() {
    await stopScan();
    clearResetTimer();
    setRedeemingReward(null);
    setScanResult(null);
    setIsProcessingScan(false);
  }

  async function toggleScan() {
    if (isScanning) await stopScan();
    else await startScan();
  }

  async function toggleRewardRedemptions(rewardId) {
    const nextExpandedId = expandedRewardId === rewardId ? null : rewardId;
    setExpandedRewardId(nextExpandedId);

    if (nextExpandedId) {
      await fetchRewardRedemptions(nextExpandedId);
    }
  }

  return (
    <div className="space-y-4">

      {canManageRewards && isCreating && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20"
        >
          <h3 className="text-lg font-semibold text-foreground">Nova recompensa</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_170px_180px]">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Nome
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cafe gratis" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tipo
              </label>
              <select
                value={rewardType}
                onChange={(e) => setRewardType(e.target.value === "value" ? "value" : "loyalty")}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="loyalty">Fidelidade</option>
                <option value="value">Valor</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {rewardType === "value" ? "Valor" : "Pontos"}
              </label>
              {rewardType === "value" ? (
                <Input
                  inputMode="decimal"
                  value={valueRequired}
                  onChange={(e) => setValueRequired(e.target.value)}
                  placeholder="12,34"
                />
              ) : (
                <Input
                  type="number"
                  min={1}
                  value={pointsRequired}
                  onChange={(e) => setPointsRequired(Number(e.target.value))}
                />
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={saveReward} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar recompensa
            </Button>
            <Button variant="outline" onClick={() => setIsCreating(false)} disabled={isSaving}>
              Cancelar
            </Button>
          </div>
        </motion.div>
      )}

      <Dialog
        open={Boolean(redeemingReward)}
        onOpenChange={(open) => {
          if (!open) closeRedeem();
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-[520px] overflow-y-auto rounded-2xl border-border bg-card p-5 shadow-2xl">
          <DialogHeader className="pr-8">
            <DialogTitle>Resgatar recompensa</DialogTitle>
            <DialogDescription>
              {redeemingReward?.name} - {formatRewardCost(redeemingReward)}
            </DialogDescription>
          </DialogHeader>

          <div className="mx-auto w-full max-w-md">
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-gray-900 shadow-inner">
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />

              <div
                className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 p-4 text-center text-white transition-opacity"
                style={{ opacity: isScanning ? 0 : 1 }}
              >
                {isProcessingScan && <Loader2 className="h-14 w-14 animate-spin text-purple-300" />}

                {scanResult?.success === true && (
                  <>
                    <CheckCircle className="mb-3 h-14 w-14 text-green-400" />
                    <p className="text-xl font-semibold">Resgate contabilizado</p>
                    <p className="mt-1 text-sm">
                      Saldo: {formatRedemptionBalance(scanResult.data)}
                    </p>
                    {scanResult.data.notification_warning ? (
                      <p className="mt-2 text-xs text-yellow-200">Notificacao: {scanResult.data.notification_warning}</p>
                    ) : null}
                  </>
                )}

                {scanResult?.success === false && (
                  <>
                    <XCircle className="mb-3 h-14 w-14 text-red-400" />
                    <p className="text-xl font-semibold">Falha no resgate</p>
                    <p className="mt-1 whitespace-pre-line text-sm">{scanResult.error}</p>
                  </>
                )}

                {!isProcessingScan && !scanResult && (
                  <>
                    <ScanLine className="mb-3 h-14 w-14 text-purple-300" />
                    <p>Aponte a camera para o QR Code do cliente.</p>
                  </>
                )}
              </div>
            </div>

            <div className="mt-6">
              <Button
                onClick={toggleScan}
                disabled={isProcessingScan}
                className={`w-full gap-2 py-6 text-lg transition-all duration-300 ${
                  isScanning ? "bg-red-600 hover:bg-red-700" : "bg-gradient-to-r from-purple-600 to-indigo-600"
                }`}
              >
                {isScanning ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                {isScanning ? "Parar scanner" : "Iniciar scanner"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {activeSubTab === "rewards" ? (
        <div className="space-y-4">
          {isLoading ? (
            <div className="rounded-2xl border border-border bg-card p-10 text-center shadow-lg shadow-slate-950/5 dark:shadow-black/20">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
              <p className="mt-3 text-sm text-muted-foreground">Carregando recompensas...</p>
            </div>
          ) : rewards.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-10 text-center shadow-lg shadow-slate-950/5 dark:shadow-black/20">
              <Gift className="mx-auto h-10 w-10 text-muted-foreground/70" />
              <p className="mt-4 text-base font-medium text-foreground">Voce ainda nao possui recompensas</p>
              {canManageRewards ? (
                <Button onClick={startCreate} className="mt-4 gap-2" disabled={!projectId}>
                  <Plus className="h-4 w-4" />
                  Criar recompensa
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              {canManageRewards ? (
                <div className="flex justify-end border-b px-4 py-3">
                  <Button onClick={startCreate} className="gap-2" disabled={!projectId}>
                    <Plus className="h-4 w-4" />
                    Criar recompensa
                  </Button>
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted">
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-3">Recompensa</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Custo</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">
                      <div className="ml-auto w-[220px] text-center">Ações</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rewards.map((reward) => {
                    const isActive = reward.status === "active";
                    const isExpanded = expandedRewardId === reward.id;
                    const redemptions = redemptionsByRewardId[reward.id] || [];
                    const isLoadingRedemptions = Boolean(redemptionsLoadingByRewardId[reward.id]);

                    return (
                      <React.Fragment key={reward.id}>
                        <tr className="border-b last:border-b-0">
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{reward.name}</p>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {getRewardType(reward) === "value" ? "Valor" : "Fidelidade"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatRewardCost(reward)}
                          </td>
                          <td className="px-4 py-3">
                            {canManageRewards ? (
                              <div className="flex items-center gap-3">
                                <Toggle
                                  checked={isActive}
                                  disabled={updatingRewardId === reward.id}
                                  onChange={() => toggleRewardStatus(reward)}
                                />
                                <span className="text-xs font-medium text-muted-foreground">
                                  {isActive ? "On" : "Off"}
                                </span>
                                {updatingRewardId === reward.id && (
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                              </div>
                            ) : (
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                                {isActive ? "Ativa" : "Inativa"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <TooltipProvider delayDuration={75} skipDelayDuration={0}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => toggleRewardRedemptions(reward.id)}
                                      disabled={isLoadingRedemptions}
                                      aria-label="Visualizar resgates"
                                    >
                                      {isLoadingRedemptions ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Eye className={`h-4 w-4 ${isExpanded ? "text-indigo-600" : ""}`} />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    align="end"
                                    sideOffset={10}
                                    className="w-56 rounded-xl border border-border bg-popover p-3 text-left text-popover-foreground shadow-xl"
                                  >
                                    <p className="text-sm font-semibold">Visualizar resgates</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      Veja o historico desta recompensa.
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <Button
                                size="sm"
                                onClick={() => openRedeem(reward)}
                                disabled={!isActive}
                                className="gap-2"
                              >
                                <ScanLine className="h-4 w-4" />
                                Resgatar
                              </Button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded ? (
                          <tr className="border-b border-border bg-muted/50">
                            <td colSpan={5} className="px-4 py-4">
                              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                                <div className="flex items-center justify-between border-b px-4 py-3">
                                  <div className="text-sm font-semibold text-foreground">
                                    Historico de resgates
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {isLoadingRedemptions ? "Carregando..." : `${redemptions.length} resgate(s)`}
                                  </div>
                                </div>

                                {isLoadingRedemptions ? (
                                  <div className="flex justify-center py-6">
                                    <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                                  </div>
                                ) : (
                                  <RedemptionsTable redemptions={redemptions} isCompact />
                                )}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                </table>
              </div>

              {activeRewards.length === 0 ? (
                <div className="border-t border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
                  Todas as recompensas estao inativas.
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {activeSubTab === "history" ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">Historico geral de resgates</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Todos os resgates contabilizados pelo scanner neste projeto.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchGeneralRedemptions({ force: true })}
                disabled={isLoadingGeneralRedemptions || !projectId}
              >
                {isLoadingGeneralRedemptions ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Atualizar
              </Button>
            </div>

            {isLoadingGeneralRedemptions ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              </div>
            ) : (
              <RedemptionsTable redemptions={generalRedemptions} />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
