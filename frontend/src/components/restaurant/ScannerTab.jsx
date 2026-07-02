import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ScanLine,
  Video,
  VideoOff,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  Gift,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import IosToggleGroup from "@/components/ui/ios-toggle-group";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import {
  getFunctionErrorMessage,
  readFunctionErrorPayload,
} from "@/lib/functionErrors";
import QrScanner from "@/lib/qrScanner";
import { supabase } from "@/lib/supabaseClient";

// Aceita token puro (pass_token) ou URL contendo token
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

function formatBRDateShort(iso) {
  if (!iso) return "--/--/----";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--/--/----";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
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

function normalizeScanResult(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  return result?.data || result?.rawValue || result?.text || "";
}

function getAvailableRewards(data) {
  if (Array.isArray(data?.rewards_available) && data.rewards_available.length > 0) {
    return data.rewards_available;
  }
  return data?.reward_available ? [data.reward_available] : [];
}

function formatRewardNames(rewards) {
  const names = rewards.map((reward) => reward?.name).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

const VALUE_PASS_AMOUNT_REQUIRED_MESSAGE =
  "Um passe do tipo Valor foi lido, mas nenhum valor válido foi informado. Ative o modo Valor, informe o valor a creditar e leia o passe novamente.";

function formatScannerVisitError(payload, fallback) {
  if (payload?.error === "wrong_project") {
    return `${payload.message}\n\nEsperado: ${payload.expected_project_id}\nRecebido: ${payload.received_project_id}`;
  }

  if (payload?.error === "invalid_amount") {
    return VALUE_PASS_AMOUNT_REQUIRED_MESSAGE;
  }

  return getFunctionErrorMessage(payload, fallback?.message || "Nao foi possivel registrar a visita.");
}

const ScannerTab = ({ projectId: establishmentProjectId }) => {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const resetTimerRef = useRef(null);

  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scannerMode, setScannerMode] = useState("loyalty");
  const [amountInput, setAmountInput] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearResetTimer();
    };
  }, [clearResetTimer]);

  const stopScan = useCallback(async () => {
    try {
      await scannerRef.current?.stop(); // aguarda parar de verdade
    } catch {}
    setIsScanning(false);
  }, []);

  const startScan = useCallback(async () => {
    const s = scannerRef.current;
    if (!s) return;

    try {
      await s.start();
      setIsScanning(true);
      setScanResult(null);
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro na Câmera",
        description: "Não foi possível acessar a câmera. Verifique as permissões.",
        variant: "destructive",
      });
    }
  }, []);

  const callScannerVisit = useCallback(async ({ projectId, passToken, confirm, challenge, amountCents }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");

    const { data, error, response } = await supabase.functions.invoke("scanner-visit", {
      body: {
        projectId,
        qrData: passToken,
        confirm: !!confirm,
        challenge: challenge || null,
        ...(amountCents ? { amount_cents: amountCents } : {}),
      },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (error) {
      const payload = await readFunctionErrorPayload(error, response);
      throw new Error(formatScannerVisitError(payload, error));
    }
    if (!data) throw new Error("Resposta vazia da Edge Function.");

    if (data.error) {
      throw new Error(formatScannerVisitError(data, { message: data.message || data.error }));
    }

    return data;
  }, []);

  const showVisitSuccessToast = useCallback((data, confirmed = false) => {
    const rewards = getAvailableRewards(data);
    const rewardNames = formatRewardNames(rewards);

    if (data.mode === "value") {
      toast({
        title: confirmed ? "Saldo creditado (confirmado)" : "Saldo creditado",
        description: `${formatCurrencyCents(data.amount_cents)} adicionados. Saldo atual: ${formatCurrencyCents(data.balance_cents)}${rewardNames ? `. Pode resgatar: ${rewardNames}.` : "."}`,
      });
      return;
    }

    if (rewardNames) {
      toast({
        title: confirmed ? "Recompensa liberada no scan confirmado!" : "Recompensa liberada!",
        description: `Cliente tem ${data.points} ponto(s) e pode resgatar: ${rewardNames}.`,
      });
      return;
    }

    const expFmt = formatBRDateShort(data.expires_at);
    const resetText = data.reset === true ? " (expirado -> reset + renovado)" : "";

    toast({
      title: confirmed ? "Visita registrada (confirmada)" : "Visita registrada!",
      description: `Agora: ${data.points} ponto(s). Expira em: ${expFmt}${resetText}`,
    });
  }, []);

  const onScan = useCallback(async (result) => {
    if (isProcessing) return;

    setIsProcessing(true);
    await stopScan();

    try {
      const txt = normalizeScanResult(result);
      const passToken = extractPassToken(txt);
      const amountCents = scannerMode === "value" ? parseCurrencyToCents(amountInput) : null;

      if (scannerMode === "value" && !amountCents) {
        throw new Error("Informe um valor maior que zero para creditar passes Valor.");
      }

      if (!passToken) throw new Error("QR Code inválido: não encontrei o token do passe.");
      if (!establishmentProjectId) throw new Error("ProjectId do estabelecimento não encontrado no painel.");

      const data = await callScannerVisit({
        projectId: establishmentProjectId,
        passToken,
        confirm: false,
        amountCents,
      });

      if (data.requires_confirmation) {
        setConfirmPayload({
          passToken,
          amountCents,
          challenge: data.challenge,
          seconds_since_last_scan: data.seconds_since_last_scan,
          last_scan_at: data.last_scan_at,
        });
        setConfirmOpen(true);

        toast({
          title: "Atenção ⚠️",
          description: `Este passe foi escaneado há pouco tempo (${Math.max(
            0,
            Number(data.seconds_since_last_scan || 0)
          )}s). Confirme para prosseguir.`,
        });

        return;
      }

      setScanResult({ success: true, data });

      showVisitSuccessToast(data);
    } catch (error) {
      setScanResult({ success: false, error: error?.message || String(error) });
      toast({
        title: "Erro ao Registrar Visita",
        description: error?.message || String(error),
        variant: "destructive",
      });
    } finally {
      clearResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        setIsProcessing(false);
        setScanResult(null);
      }, 5000);
    }
  }, [isProcessing, stopScan, establishmentProjectId, scannerMode, amountInput, callScannerVisit, clearResetTimer, showVisitSuccessToast]);

  // ✅ guarda sempre a versão mais recente do handler
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // ✅ cria o scanner uma única vez
  useEffect(() => {
    if (!videoRef.current) return;

    const qrScanner = new QrScanner(
      videoRef.current,
      (result) => onScanRef.current(result),
      { highlightScanRegion: true, highlightCodeOutline: true }
    );

    scannerRef.current = qrScanner;

    return () => {
      try {
        qrScanner.destroy();
      } catch {}
      scannerRef.current = null;
    };
  }, []);

  const toggleScan = async () => {
    if (confirmOpen) return;
    if (isScanning) await stopScan();
    else {
      const amountCents = scannerMode === "value" ? parseCurrencyToCents(amountInput) : null;

      if (scannerMode === "value" && !amountCents) {
        toast({
          title: "Informe o valor",
          description: "Digite um valor maior que zero antes de iniciar o scanner.",
          variant: "destructive",
        });
        return;
      }

      await startScan();
    }
  };

  const selectScannerMode = (nextMode) => {
    if (isScanning || isProcessing || confirmOpen) return;
    setScannerMode(nextMode);
  };

  // ✅ Ação do modal
  const handleConfirm = async (yes) => {
    const payload = confirmPayload;
    setConfirmOpen(false);
    setConfirmPayload(null);

    if (!yes) {
      toast({
        title: "Operação cancelada",
        description: "Ok — não registramos nada. Pode escanear novamente.",
      });
      setIsProcessing(false);
      startScan();
      return;
    }

    // Se "Sim": chama edge function com confirm + challenge
    setIsProcessing(true);
    try {
      const data = await callScannerVisit({
        projectId: establishmentProjectId,
        passToken: payload?.passToken,
        confirm: true,
        challenge: payload?.challenge,
        amountCents: payload?.amountCents,
      });

      setScanResult({ success: true, data });

      showVisitSuccessToast(data, true);
    } catch (error) {
      setScanResult({ success: false, error: error?.message || String(error) });
      toast({
        title: "Erro ao Confirmar",
        description: error?.message || String(error),
        variant: "destructive",
      });
    } finally {
      clearResetTimer();
      resetTimerRef.current = window.setTimeout(() => {
        setIsProcessing(false);
        setScanResult(null);
        startScan();
      }, 2000);
    }
  };

  const successRewards = scanResult?.success === true ? getAvailableRewards(scanResult.data) : [];
  const successRewardNames = formatRewardNames(successRewards);
  const successIsValue = scanResult?.success === true && scanResult.data?.mode === "value";
  const isValueMode = scannerMode === "value";
  const scannerControlsDisabled = isScanning || isProcessing || confirmOpen;
  const valueAmountCents = isValueMode ? parseCurrencyToCents(amountInput) : null;
  const valueAmountInvalid = isValueMode && amountInput.trim() !== "" && !valueAmountCents;
  const scannerModeOptions = [
    { value: "loyalty", label: "Fidelidade", icon: Gift },
    { value: "value", label: "Valor", icon: ScanLine },
  ];

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20"
      >
        <h2 className="text-2xl font-bold mb-6">Scanner de QR Code</h2>

        <div className="relative w-full aspect-square max-w-md mx-auto bg-gray-900 rounded-2xl overflow-hidden shadow-inner">
          <video ref={videoRef} className="w-full h-full object-cover" />

          {/* Overlay principal (igual ao seu, mas respeita confirmOpen) */}
          <div
            className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white p-4 transition-opacity"
            style={{ opacity: isScanning && !confirmOpen ? 0 : 1 }}
          >
            {isProcessing && !scanResult && <Loader2 className="w-16 h-16 animate-spin text-purple-400" />}

            {scanResult?.success === true && (
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-full text-center"
              >
                {successIsValue ? (
                  <div className="mx-auto flex max-w-xs flex-col items-center">
                    <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold">Saldo creditado!</h3>
                    <p className="text-lg">{formatCurrencyCents(scanResult.data.balance_cents)} no cartão.</p>
                    {successRewardNames ? (
                      <p className="mt-2 text-sm text-white/85">
                        Pode resgatar: {successRewardNames}.
                      </p>
                    ) : null}
                  </div>
                ) : successRewardNames ? (
                  <div className="mx-auto flex max-w-xs flex-col items-center">
                    <motion.div
                      initial={{ rotate: -8, scale: 0.8 }}
                      animate={{ rotate: [0, -6, 6, 0], scale: 1 }}
                      transition={{ duration: 0.75, ease: "easeOut" }}
                      className="relative mb-4 flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-rose-400 to-emerald-400 shadow-2xl shadow-amber-500/30"
                    >
                      <span className="absolute inset-2 rounded-full border border-white/60" />
                      <Gift className="relative z-10 h-16 w-16 text-white drop-shadow" />
                    </motion.div>
                    <h3 className="text-2xl font-bold leading-tight">Recompensa liberada!</h3>
                    <p className="mt-2 text-lg font-semibold leading-snug">{successRewardNames}</p>
                    <p className="mt-2 text-sm text-white/85">
                      Cliente tem {scanResult.data.points} ponto(s) e ja pode resgatar.
                    </p>
                  </div>
                ) : (
                  <>
                    <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold">Visita Registrada!</h3>
                    <p className="text-lg">{scanResult.data.points} ponto(s) no total.</p>
                  </>
                )}
              </motion.div>
            )}

            {scanResult?.success === false && (
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center"
              >
                <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
                <h3 className="text-2xl font-bold">Falha no Scan</h3>
                <p className="text-sm mt-2 whitespace-pre-line">{scanResult.error}</p>
              </motion.div>
            )}

            {!isProcessing && !scanResult && !confirmOpen && (
              <>
                <ScanLine className="w-16 h-16 text-purple-400 mb-4" />
                <p className="text-center">Aponte a câmera para o QR Code do cliente.</p>
              </>
            )}
          </div>

          {/* ✅ Modal de confirmação (overlay) */}
          {confirmOpen && (
            <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-2xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl">
                <div className="flex items-center gap-3 mb-3">
                  <AlertTriangle className="w-6 h-6 text-yellow-500" />
                  <h3 className="text-lg font-semibold">Passe escaneado recentemente</h3>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed">
                  Esse passe foi escaneado há{" "}
                  <b>{Math.max(0, Number(confirmPayload?.seconds_since_last_scan || 0))}s</b>.
                  <br />
                  Deseja prosseguir com a operação?
                </p>

                <div className="mt-4 flex gap-3">
                  <Button
                    onClick={() => handleConfirm(false)}
                    className="flex-1 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    disabled={isProcessing}
                  >
                    Não
                  </Button>
                  <Button
                    onClick={() => handleConfirm(true)}
                    className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600"
                    disabled={isProcessing}
                  >
                    Sim
                  </Button>
                </div>

                <p className="mt-3 text-[11px] text-muted-foreground break-all">
                  Token: {String(confirmPayload?.passToken || "").slice(0, 10)}…
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mx-auto mt-5 w-full max-w-md rounded-xl border border-border bg-muted/30 p-4">
          <IosToggleGroup
            value={scannerMode}
            options={scannerModeOptions}
            onValueChange={selectScannerMode}
            disabled={scannerControlsDisabled}
            ariaLabel="Modo do scanner"
            className="w-full"
          />

          {isValueMode ? (
            <div className="mt-4">
              <label
                htmlFor="scanner-amount-input"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Valor a creditar
              </label>
              <Input
                id="scanner-amount-input"
                inputMode="decimal"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                placeholder="0,00"
                disabled={scannerControlsDisabled}
                aria-invalid={valueAmountInvalid}
              />
              <p className={`mt-1 text-xs ${valueAmountInvalid ? "text-destructive" : "text-muted-foreground"}`}>
                {valueAmountInvalid
                  ? "Use um valor maior que zero no formato 12,34."
                  : "Informe o valor antes de iniciar o scanner."}
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex justify-center">
          <Button
            onClick={toggleScan}
            disabled={isProcessing || confirmOpen || (!isScanning && isValueMode && !valueAmountCents)}
            className={`w-full max-w-md gap-2 text-lg py-6 transition-all duration-300 ${
              isScanning ? "bg-red-600 hover:bg-red-700" : "bg-gradient-to-r from-purple-600 to-indigo-600"
            }`}
          >
            {isScanning ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
            {isScanning ? "Parar Scanner" : "Iniciar Scanner"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default ScannerTab;
