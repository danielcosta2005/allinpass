import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle,
  Gift,
  Loader2,
  Plus,
  Power,
  ScanLine,
  Video,
  VideoOff,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
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

function statusLabel(status) {
  return status === "active" ? "Ativa" : "Inativa";
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

  return body?.message || body?.error || fallback?.message || "Nao foi possivel contabilizar a recompensa.";
}

export default function RewardsTab({ projectId }) {
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

  const [name, setName] = useState("");
  const [pointsRequired, setPointsRequired] = useState(10);

  const [redeemingReward, setRedeemingReward] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const [scanResult, setScanResult] = useState(null);

  const activeRewards = useMemo(
    () => rewards.filter((reward) => reward.status === "active"),
    [rewards],
  );

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  async function fetchRewards() {
    if (!projectId) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("rewards")
        .select("id, project_id, name, points_required, status, created_at, updated_at")
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

  useEffect(() => {
    fetchRewards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    return () => {
      clearResetTimer();
      try {
        scannerRef.current?.destroy();
      } catch {}
    };
  }, [clearResetTimer]);

  function startCreate() {
    setName("");
    setPointsRequired(10);
    setIsCreating(true);
  }

  async function saveReward() {
    const finalName = name.trim();
    const finalPoints = Number(pointsRequired);

    if (!finalName) {
      toast({ variant: "destructive", title: "Nome obrigatorio" });
      return;
    }

    if (!Number.isInteger(finalPoints) || finalPoints <= 0) {
      toast({ variant: "destructive", title: "Pontos invalidos", description: "Informe um numero inteiro maior que zero." });
      return;
    }

    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from("rewards")
        .insert({
          project_id: projectId,
          name: finalName,
          points_required: finalPoints,
          status: "active",
        })
        .select("id, project_id, name, points_required, status, created_at, updated_at")
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
    if (!reward?.id) return;

    const nextStatus = reward.status === "active" ? "inactive" : "active";
    setUpdatingRewardId(reward.id);

    try {
      const { data, error } = await supabase
        .from("rewards")
        .update({ status: nextStatus })
        .eq("id", reward.id)
        .eq("project_id", projectId)
        .select("id, project_id, name, points_required, status, created_at, updated_at")
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
    const scanner = scannerRef.current;
    if (!scanner) return;

    try {
      await scanner.start();
      setIsScanning(true);
      setScanResult(null);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro na camera",
        description: "Nao foi possivel acessar a camera. Verifique as permissoes.",
      });
    }
  }, [toast]);

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
      const errorBody = await readFunctionErrorBody(error, response);
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
      toast({
        title: "Recompensa contabilizada",
        description: `${data.reward_name}: ${data.points_before} -> ${data.points_after} ponto(s).`,
      });
    } catch (err) {
      setScanResult({ success: false, error: err?.message || String(err) });
      toast({
        variant: "destructive",
        title: "Erro ao contabilizar recompensa",
        description: err?.message || String(err),
      });
    } finally {
      clearResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        setIsProcessingScan(false);
        setScanResult(null);
      }, 5000);
    }
  }, [callScannerReward, clearResetTimer, isProcessingScan, redeemingReward, stopScan, toast]);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!redeemingReward || !videoRef.current) return undefined;

    const scanner = new QrScanner(
      videoRef.current,
      (result) => onScanRef.current?.(result),
      { highlightScanRegion: true, highlightCodeOutline: true },
    );

    scannerRef.current = scanner;

    return () => {
      try {
        scanner.destroy();
      } catch {}
      scannerRef.current = null;
      setIsScanning(false);
    };
  }, [redeemingReward]);

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

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-2xl border border-purple-100 bg-white p-5 shadow-lg"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-indigo-600" />
              <h2 className="text-xl font-semibold text-gray-900">Recompensas</h2>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Configure beneficios por pontos e contabilize resgates pelo QR Code do cliente.
            </p>
          </div>

          <Button onClick={startCreate} className="gap-2" disabled={!projectId}>
            <Plus className="h-4 w-4" />
            Criar recompensa
          </Button>
        </div>
      </motion.div>

      {isCreating && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-purple-100 bg-white p-5 shadow-lg"
        >
          <h3 className="text-lg font-semibold text-gray-900">Nova recompensa</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_180px]">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Nome
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cafe gratis" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Pontos
              </label>
              <Input
                type="number"
                min={1}
                value={pointsRequired}
                onChange={(e) => setPointsRequired(Number(e.target.value))}
              />
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

      {redeemingReward && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-purple-100 bg-white p-5 shadow-lg"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Contabilizar recompensa</h3>
              <p className="mt-1 text-sm text-gray-600">
                {redeemingReward.name} - {redeemingReward.points_required} ponto(s)
              </p>
            </div>
            <Button variant="outline" onClick={closeRedeem} disabled={isProcessingScan}>
              Fechar
            </Button>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(280px,420px)_1fr]">
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-gray-900 shadow-inner">
              <video ref={videoRef} className="h-full w-full object-cover" />

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
                      Saldo: {scanResult.data.points_before} para {scanResult.data.points_after}
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

            <div>
              <Button
                onClick={toggleScan}
                disabled={isProcessingScan}
                className={`w-full gap-2 py-6 ${isScanning ? "bg-red-600 hover:bg-red-700" : "bg-gradient-to-r from-purple-600 to-indigo-600"}`}
              >
                {isScanning ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                {isScanning ? "Parar scanner" : "Iniciar scanner"}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {isLoading ? (
        <div className="rounded-2xl border border-purple-100 bg-white p-10 text-center shadow-lg">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
          <p className="mt-3 text-sm text-gray-600">Carregando recompensas...</p>
        </div>
      ) : rewards.length === 0 ? (
        <div className="rounded-2xl border border-purple-100 bg-white p-10 text-center shadow-lg">
          <Gift className="mx-auto h-10 w-10 text-gray-400" />
          <p className="mt-4 text-base font-medium text-gray-800">Voce ainda nao possui recompensas</p>
          <Button onClick={startCreate} className="mt-4 gap-2" disabled={!projectId}>
            <Plus className="h-4 w-4" />
            Criar recompensa
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="border-b text-left text-gray-600">
                <th className="px-4 py-3">Recompensa</th>
                <th className="px-4 py-3">Pontos</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rewards.map((reward) => {
                const isActive = reward.status === "active";
                return (
                  <tr key={reward.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{reward.name}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {reward.points_required} ponto(s)
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {statusLabel(reward.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleRewardStatus(reward)}
                          disabled={updatingRewardId === reward.id}
                          title={isActive ? "Desativar recompensa" : "Ativar recompensa"}
                        >
                          {updatingRewardId === reward.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => openRedeem(reward)}
                          disabled={!isActive}
                          className="gap-2"
                        >
                          <ScanLine className="h-4 w-4" />
                          Contabilizar
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {activeRewards.length === 0 ? (
            <div className="border-t bg-gray-50 px-4 py-3 text-sm text-gray-600">
              Todas as recompensas estao inativas.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
