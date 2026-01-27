import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { ScanLine, Video, VideoOff, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import QrScanner from "qr-scanner";
import { supabase } from "@/lib/supabaseClient";

QrScanner.WORKER_PATH = new URL("qr-scanner/qr-scanner-worker.min.js", import.meta.url).toString();

// Aceita:
// - token puro (pass_token)
// - URL que contenha token em ?token=... ou ?t=... ou ?s=...
// - URL onde o último segmento do path seja o token
function extractPassToken(qrData) {
  const raw = String(qrData ?? "").trim();
  if (!raw) return null;

  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    return raw;
  }

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

  const onScan = useCallback(
    async (result) => {
      if (isProcessing) return;

      setIsProcessing(true);
      scanner?.stop();
      setIsScanning(false);

      try {
        const txt = normalizeScanResult(result);
        const passToken = extractPassToken(txt);

        setLastScanRaw(txt);
        setLastScanToken(passToken || "");

        console.info("[ScannerTab] QR lido:", { raw: txt, token: passToken });
        console.info("[ScannerTab] projectId enviado:", establishmentProjectId);

        if (!passToken) {
          throw new Error("QR Code inválido: não encontrei o token do passe.");
        }

        if (!establishmentProjectId) {
          throw new Error("ProjectId do estabelecimento não encontrado no painel.");
        }

        // sessão do staff
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error("Sessão expirada. Faça login novamente.");
        }

        const { data, error } = await supabase.functions.invoke("scanner-visit", {
          body: {
            projectId: establishmentProjectId,
            qrData: passToken,
          },
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (error) throw error;
        if (!data) throw new Error("Resposta vazia da Edge Function.");

        if (data.error) {
          // se backend mandar mismatch, mostrar informação útil
          if (data.error === "wrong_project") {
            throw new Error(
              `${data.message}\n\nEsperado: ${data.expected_project_id}\nRecebido: ${data.received_project_id}`
            );
          }
          throw new Error(data.message || data.error);
        }

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
    [establishmentProjectId, isProcessing, scanner]
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
    if (isScanning) {
      scanner.stop();
      setIsScanning(false);
    } else {
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
          <div
            className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white p-4 transition-opacity"
            style={{ opacity: isScanning ? 0 : 1 }}
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

            {!isProcessing && !scanResult && (
              <>
                <ScanLine className="w-16 h-16 text-purple-400 mb-4" />
                <p className="text-center">Aponte a câmera para o QR Code do cliente.</p>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <Button
            onClick={toggleScan}
            disabled={isProcessing}
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
