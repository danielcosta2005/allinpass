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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import QrScanner from "qr-scanner";
import { supabase } from "@/lib/supabaseClient";

QrScanner.WORKER_PATH = new URL("qr-scanner/qr-scanner-worker.min.js", import.meta.url).toString();

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

function normalizeScanResult(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  return result?.data || result?.rawValue || result?.text || "";
}

const ScannerTab = ({ projectId: establishmentProjectId }) => {
  const videoRef = useRef(null);
  const [scanner, setScanner] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanRaw, setLastScanRaw] = useState("");
  const [lastScanToken, setLastScanToken] = useState("");

  // ✅ Anti-replay UI state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState(null);
  // confirmPayload: { passToken, challenge, seconds_since_last_scan, last_scan_at }

  const stopScan = useCallback(() => {
    try {
      scanner?.stop();
    } catch {}
    setIsScanning(false);
  }, [scanner]);

  const startScan = useCallback(() => {
    if (!scanner) return;
    scanner
      .start()
      .then(() => {
        setIsScanning(true);
        setScanResult(null);
      })
      .catch((err) => {
        console.error(err);
        toast({
          title: "Erro na Câmera",
          description: "Não foi possível acessar a câmera. Verifique as permissões.",
          variant: "destructive",
        });
      });
  }, [scanner]);

  const callScannerVisit = useCallback(
    async ({ projectId, passToken, confirm, challenge }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");

      const { data, error } = await supabase.functions.invoke("scanner-visit", {
        body: {
          projectId,
          qrData: passToken,
          confirm: !!confirm,
          challenge: challenge || null,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) throw error;
      if (!data) throw new Error("Resposta vazia da Edge Function.");

      if (data.error) {
        if (data.error === "wrong_project") {
          throw new Error(
            `${data.message}\n\nEsperado: ${data.expected_project_id}\nRecebido: ${data.received_project_id}`
          );
        }
        throw new Error(data.message || data.error);
      }

      return data;
    },
    []
  );

  const onScan = useCallback(
    async (result) => {
      if (isProcessing) return;

      setIsProcessing(true);
      stopScan();

      try {
        const txt = normalizeScanResult(result);
        const passToken = extractPassToken(txt);

        setLastScanRaw(txt);
        setLastScanToken(passToken || "");

        console.info("[ScannerTab] QR lido:", { raw: txt, token: passToken });
        console.info("[ScannerTab] projectId enviado:", establishmentProjectId);

        if (!passToken) throw new Error("QR Code inválido: não encontrei o token do passe.");
        if (!establishmentProjectId) throw new Error("ProjectId do estabelecimento não encontrado no painel.");

        const data = await callScannerVisit({
          projectId: establishmentProjectId,
          passToken,
          confirm: false,
        });

        // ✅ Se backend pedir confirmação (scan recente)
        if (data.requires_confirmation) {
          setConfirmPayload({
            passToken,
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

        // ✅ Fluxo normal: registrado
        setScanResult({ success: true, data });

        const expFmt = formatBRDateShort(data.expires_at);
        const resetText = data.reset === true ? " (expirado → reset + renovado)" : "";

        toast({
          title: "Visita Registrada! 🎉",
          description: `Agora: ${data.points} ponto(s). Expira em: ${expFmt}${resetText}`,
        });
      } catch (error) {
        setScanResult({ success: false, error: error?.message || String(error) });
        toast({
          title: "Erro ao Registrar Visita",
          description: error?.message || String(error),
          variant: "destructive",
        });
      } finally {
        setTimeout(() => {
          setIsProcessing(false);
          setScanResult(null);
        }, 5000);
      }
    },
    [establishmentProjectId, isProcessing, stopScan, callScannerVisit]
  );

  useEffect(() => {
    if (videoRef.current && !scanner) {
      const qrScanner = new QrScanner(
        videoRef.current,
        (result) => onScan(result),
        { highlightScanRegion: true, highlightCodeOutline: true }
      );
      setScanner(qrScanner);
    }
    return () => {
      scanner?.destroy();
    };
  }, [onScan, scanner]);

  const toggleScan = () => {
    if (!scanner) return;
    if (confirmOpen) return; // evita ligar câmera enquanto o modal está aberto
    if (isScanning) stopScan();
    else startScan();
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
      });

      setScanResult({ success: true, data });

      const expFmt = formatBRDateShort(data.expires_at);
      const resetText = data.reset === true ? " (expirado → reset + renovado)" : "";

      toast({
        title: "Visita Registrada (confirmada) ✅",
        description: `Agora: ${data.points} ponto(s). Expira em: ${expFmt}${resetText}`,
      });
    } catch (error) {
      setScanResult({ success: false, error: error?.message || String(error) });
      toast({
        title: "Erro ao Confirmar",
        description: error?.message || String(error),
        variant: "destructive",
      });
    } finally {
      setTimeout(() => {
        setIsProcessing(false);
        setScanResult(null);
        startScan();
      }, 2000);
    }
  };

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl p-6 shadow-lg border border-purple-100"
      >
        <h2 className="text-2xl font-bold mb-6">Scanner de QR Code</h2>

        <div className="relative w-full aspect-square max-w-md mx-auto bg-gray-900 rounded-2xl overflow-hidden shadow-inner">
          <video ref={videoRef} className="w-full h-full object-cover" />

          {/* Overlay principal (igual ao seu, mas respeita confirmOpen) */}
          <div
            className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white p-4 transition-opacity"
            style={{ opacity: isScanning && !confirmOpen ? 0 : 1 }}
          >
            {isProcessing && <Loader2 className="w-16 h-16 animate-spin text-purple-400" />}

            {scanResult?.success === true && (
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center"
              >
                <CheckCircle className="w-16 h-16 text-green-400 mx-auto mb-4" />
                <h3 className="text-2xl font-bold">Visita Registrada!</h3>
                <p className="text-lg">{scanResult.data.points} ponto(s) no total.</p>
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
              <div className="w-full max-w-sm bg-white text-gray-900 rounded-2xl p-5 shadow-2xl border border-purple-100">
                <div className="flex items-center gap-3 mb-3">
                  <AlertTriangle className="w-6 h-6 text-yellow-500" />
                  <h3 className="text-lg font-semibold">Passe escaneado recentemente</h3>
                </div>

                <p className="text-sm text-gray-700 leading-relaxed">
                  Esse passe foi escaneado há{" "}
                  <b>{Math.max(0, Number(confirmPayload?.seconds_since_last_scan || 0))}s</b>.
                  <br />
                  Deseja prosseguir com a operação?
                </p>

                <div className="mt-4 flex gap-3">
                  <Button
                    onClick={() => handleConfirm(false)}
                    className="flex-1 bg-gray-200 text-gray-900 hover:bg-gray-300"
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

                <p className="mt-3 text-[11px] text-gray-500 break-all">
                  Token: {String(confirmPayload?.passToken || "").slice(0, 10)}…
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-center">
          <Button
            onClick={toggleScan}
            disabled={isProcessing || confirmOpen}
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
