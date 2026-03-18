import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2,
  Apple,
  Smartphone,
  Upload,
  Link as LinkIcon,
  Save,
  Settings,
  QrCode,
  Download,
  Info
} from 'lucide-react';
import GenerationResultModal from '@/components/superadmin/wallet/GenerationResultModal';
import { QRCode } from 'react-qrcode-logo';

const IMAGE_UPLOAD_RULES = {
  appleLogo: {
    label: 'Logo Apple',
    helpTitle: 'Logo Apple',
    helpLines: [
      'Obrigatório: PNG',
    ],
  },
  googleLogo: {
    label: 'Logo Google',
    helpTitle: 'Logo Google',
    helpLines: [
      'Obrigatório: PNG',
      'Proporção recomendada: 1:1',
    ],
    recommendedRatio: 1,
    recommendedRatioLabel: '1:1',
  },
  appleStrip: {
    label: 'Apple Strip',
    helpTitle: 'Apple Strip',
    helpLines: [
      'Obrigatório: PNG',
      'Altura máxima: 432px',
      'Proporção recomendada: 2.6:1',
    ],
  },
  googleHero: {
    label: 'Google Hero',
    helpTitle: 'Google Hero',
    helpLines: [
      'Obrigatório: PNG',
      'Proporção recomendada: 3:1',
    ],
    recommendedRatio: 3,
    recommendedRatioLabel: '3:1',
  },
};

const ColorInput = ({ label, ...props }) => (
  <div className="flex flex-col space-y-2">
    <Label className="text-sm font-medium">{label}</Label>
    <div className="relative">
      <Input
        type="color"
        {...props}
        className="p-0 h-10 w-full appearance-none border-none bg-transparent cursor-pointer"
      />
      <div
        className="absolute inset-0 rounded-md border pointer-events-none flex items-center justify-end px-2"
        style={{ backgroundColor: props.value }}
      >
        <span className="font-mono text-xs mix-blend-difference text-white">{props.value}</span>
      </div>
    </div>
  </div>
);

const UploadButtonWithInfo = ({ uploadKey, onUpload }) => {
  const rule = IMAGE_UPLOAD_RULES[uploadKey];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start whitespace-nowrap px-3"
        onClick={() => onUpload(uploadKey)}
      >
        <Upload className="mr-2 h-4 w-4 shrink-0" />
        <span className="truncate">{rule.label}</span>
      </Button>

      <div className="relative group flex items-center">
        <button
          type="button"
          className="inline-flex items-center justify-center p-1 text-slate-400 transition hover:text-slate-600"
          aria-label={`Informações sobre ${rule.label}`}
        >
          <Info className="h-4 w-4" />
        </button>

        <div className="pointer-events-none absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl opacity-0 transition duration-75 group-hover:pointer-events-auto group-hover:opacity-100">
          <p className="mb-2 text-sm font-semibold text-slate-900">{rule.helpTitle}</p>
          <div className="space-y-1 text-xs text-slate-600">
            {rule.helpLines.map((line, index) => (
              <p key={`${uploadKey}-${index}`}>{line}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

function formatExpPreview(v) {
  if (!v) return "XX/XX";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "XX/XX";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  } catch {
    return "XX/XX";
  }
}

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function getAllowedQrHosts() {
  const rawHosts = import.meta.env.VITE_QR_ALLOWED_HOSTS || "";
  return new Set(
    rawHosts
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isSafeQrUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const isHttps = parsed.protocol === "https:";
    const isLocalHttp = parsed.protocol === "http:" && LOCAL_DEV_HOSTS.has(hostname);

    if (!isHttps && !isLocalHttp) return false;

    const allowedHosts = getAllowedQrHosts();
    if (allowedHosts.size > 0) {
      return allowedHosts.has(hostname);
    }

    if (typeof window === "undefined") return isHttps || isLocalHttp;

    return parsed.origin === window.location.origin || LOCAL_DEV_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

function sanitizeFilenamePart(value) {
  const normalized = String(value ?? "pass")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const safe = normalized
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  return safe || "pass";
}

function isPngFile(file) {
  if (!file) return false;
  const mimeOk = file.type === "image/png";
  const nameOk = file.name.toLowerCase().endsWith(".png");
  return mimeOk || nameOk;
}

function getImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      URL.revokeObjectURL(objectUrl);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Não foi possível ler as dimensões da imagem."));
    };

    image.src = objectUrl;
  });
}

function normalizeWalletDefaults(defaults = {}) {
  const incomingImages = defaults?.images ?? {};
  const legacyLogo = incomingImages.logo ?? "";

  return {
    ...defaults,
    images: {
      logo: incomingImages.logo ?? "",
      icon: incomingImages.icon ?? "",
      appleLogo: incomingImages.appleLogo ?? legacyLogo ?? "",
      googleLogo: incomingImages.googleLogo ?? legacyLogo ?? "",
      appleStrip: incomingImages.appleStrip ?? "",
      googleHero: incomingImages.googleHero ?? "",
    },
  };
}

function validateAppleStripDimensions(width, height) {
  const maxHeight = 432;
  const recommendedRatio = 2.6;
  const ratioTolerance = 0.01;

  if (height > maxHeight) {
    return {
      valid: false,
      message: `Apple Strip inválida: ${width} × ${height}. Use PNG com altura máxima de 432px.`,
    };
  }

  const ratio = width / height;
  if (Math.abs(ratio - recommendedRatio) > ratioTolerance) {
    return {
      valid: true,
      warning: `Apple Strip enviada com proporção ${ratio.toFixed(2)}:1. O recomendado é 2.6:1. O upload foi aceito, mas pode haver corte ou ajuste visual.`,
    };
  }

  return { valid: true };
}

function validateRecommendedRatio(uploadKey, width, height) {
  const rule = IMAGE_UPLOAD_RULES[uploadKey];
  if (!rule?.recommendedRatio || !height) {
    return { valid: true };
  }

  const ratio = width / height;
  const ratioTolerance = 0.01;

  if (Math.abs(ratio - rule.recommendedRatio) > ratioTolerance) {
    return {
      valid: true,
      warning: `${rule.label}: a proporção recomendada é ${rule.recommendedRatioLabel}. Sua imagem está em ${ratio.toFixed(2)}:1. O upload foi aceito, mas pode haver corte ou ajuste visual.`,
    };
  }

  return { valid: true };
}

function validateUploadByKey(uploadKey, width, height) {
  if (uploadKey === "appleStrip") {
    return validateAppleStripDimensions(width, height);
  }

  if (uploadKey === "googleLogo" || uploadKey === "googleHero") {
    return validateRecommendedRatio(uploadKey, width, height);
  }

  return { valid: true };
}

const PassPreview = ({ formState, qrPreviewUrl }) => {
  const [platform, setPlatform] = useState('apple');
  const {
    title = 'Título do Passe',
    colors = {},
    images = {},
    dataFields = [],
    sampleValues = {},
    exp_date,
  } = formState;

  const { background = '#6c5ce7', text = '#ffffff', label = '#ffffff' } = colors;
  const {
    logo: legacyLogo,
    appleLogo,
    googleLogo,
    googleHero,
    appleStrip
  } = images;

  const logoUrl = platform === "apple"
    ? (appleLogo || legacyLogo)
    : (googleLogo || legacyLogo);

  const pointsFieldKey = dataFields.find(f => f.key.toLowerCase().includes('points'))?.key;
  const pointsValue = pointsFieldKey ? (sampleValues[pointsFieldKey] || '123') : '123';

  const expText = `EXPIRA EM ${formatExpPreview(exp_date)}`;
  const qrValue = qrPreviewUrl || formState.qr_url || "https://example.com";

  return (
    <div className="sticky top-24">
      <div
        style={{ backgroundColor: background }}
        className="w-full max-w-sm mx-auto rounded-2xl flex flex-col text-white shadow-2xl font-sans transition-colors duration-300 overflow-hidden"
      >
        <div className="p-4 flex flex-col flex-1 min-h-[420px]">
          <header className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="logo"
                  className="w-10 h-10 rounded-full bg-white object-contain p-1"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/20"></div>
              )}
              <h3 style={{ color: text }} className="font-bold text-lg">
                {title}
              </h3>
            </div>

            <p style={{ color: label }} className="text-xs uppercase font-semibold">
              {expText}
            </p>
          </header>

          {platform === "apple" && (
            appleStrip ? (
              <div className="-mx-4 mb-4">
                <img
                  src={appleStrip}
                  alt="Apple Strip"
                  className="w-full h-28 object-cover"
                />
              </div>
            ) : (
              <div className="-mx-4 mb-4">
                <div className="w-full h-28 bg-white/15" />
              </div>
            )
          )}

          <main className="flex-grow flex flex-col items-start justify-center text-left">
            <p style={{ color: label }} className="text-sm uppercase tracking-wider">
              Pontos
            </p>
            <p style={{ color: text }} className="text-4xl font-bold leading-none">
              {pointsValue}
            </p>
          </main>

          <footer className="mt-6 flex items-center justify-center">
            <div className="bg-white p-2 rounded-md">
              <QRCode
                value={qrValue}
                size={96}
                quietZone={0}
                bgColor="transparent"
              />
            </div>
          </footer>
        </div>

        {platform === "google" && (
          googleHero ? (
            <img
              src={googleHero}
              alt="Google Hero"
              className="w-full h-32 object-cover"
            />
          ) : (
            <div className="w-full h-32 bg-white/15"></div>
          )
        )}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        <Button
          size="sm"
          variant={platform === "apple" ? "default" : "secondary"}
          className="rounded-full gap-2"
          onClick={() => setPlatform("apple")}
        >
          <Apple className="w-4 h-4" /> Apple
        </Button>

        <Button
          size="sm"
          variant={platform === "google" ? "default" : "secondary"}
          className="rounded-full gap-2"
          onClick={() => setPlatform("google")}
        >
          <Smartphone className="w-4 h-4" /> Google
        </Button>
      </div>
    </div>
  );
};

const PassesList = ({ passes, loading, onAction }) => {
  const { toast } = useToast();
  const [expandedPassId, setExpandedPassId] = useState(null);
  const qrContainerRefs = useRef({});

  const handleToggleQr = (passId) => {
    setExpandedPassId((current) => (current === passId ? null : passId));
  };

  const handleDownloadQr = (pass) => {
    if (!isSafeQrUrl(pass?.qr_url)) {
      toast({
        title: "URL de QR bloqueada",
        description: "Este link não está na allowlist de hosts permitidos.",
        variant: "destructive",
      });
      return;
    }

    const container = qrContainerRefs.current[pass.id];
    const canvas = container?.querySelector("canvas");

    if (!canvas) {
      toast({
        title: "QR code indisponível",
        description: "Não foi possível localizar o canvas para download.",
        variant: "destructive",
      });
      return;
    }

    const fileName = `${sanitizeFilenamePart(pass.title)}-${sanitizeFilenamePart(pass.id)}.png`;

    const triggerDownload = (href) => {
      const link = document.createElement("a");
      link.href = href;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast({ title: "QR code baixado com sucesso." });
    };

    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => {
        if (!blob) {
          toast({
            title: "Falha no download",
            description: "Não foi possível exportar o QR code em PNG.",
            variant: "destructive",
          });
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        triggerDownload(objectUrl);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }, "image/png");
      return;
    }

    try {
      const dataUrl = canvas.toDataURL("image/png");
      triggerDownload(dataUrl);
    } catch (error) {
      toast({
        title: "Falha no download",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-900/50">
          <tr>
            <th className="p-3 text-left font-semibold">Título</th>
            <th className="p-3 text-left font-semibold">Tipo</th>
            <th className="p-3 text-left font-semibold">Status</th>
            <th className="p-3 text-center font-semibold">Ações</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan="4" className="text-center p-8">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
              </td>
            </tr>
          )}
          {!loading && passes.length === 0 && (
            <tr>
              <td colSpan="4" className="text-center p-8 text-gray-500">
                Nenhum passe emitido para este projeto.
              </td>
            </tr>
          )}
          {!loading &&
            passes.map((pass) => {
              const isExpanded = expandedPassId === pass.id;
              const hasQr = Boolean(pass.qr_url);
              const isSafeQr = hasQr && isSafeQrUrl(pass.qr_url);
              const canUseQr = hasQr && isSafeQr;
              const copyButtonTitle = !hasQr
                ? "Link indisponível"
                : isSafeQr
                  ? "Copiar Link Único"
                  : "Link bloqueado por política de segurança";
              const qrButtonTitle = !hasQr
                ? "QR code indisponível"
                : isSafeQr
                  ? "Revelar QR Code"
                  : "QR bloqueado por política de segurança";

              return (
                <React.Fragment key={pass.id}>
                  <tr className="border-t dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                    <td className="p-3 font-medium">{pass.title}</td>
                    <td className="p-3">{pass.type}</td>
                    <td className="p-3">
                      <span className="bg-green-100 text-green-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full dark:bg-green-900 dark:text-green-300">
                        {pass.status || 'Ativo'}
                      </span>
                    </td>
                    <td className="p-3 flex justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onAction('copy', pass.qr_url)}
                        title={copyButtonTitle}
                        disabled={!canUseQr}
                      >
                        <LinkIcon className="w-4 h-4" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleQr(pass.id)}
                        title={qrButtonTitle}
                        disabled={!canUseQr}
                      >
                        <QrCode className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="border-t dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30">
                      <td colSpan="4" className="p-4">
                        <div className="flex justify-center">
                          {isSafeQr ? (
                            <div
                              ref={(node) => {
                                if (node) qrContainerRefs.current[pass.id] = node;
                                else delete qrContainerRefs.current[pass.id];
                              }}
                              className="flex flex-col items-center gap-3"
                            >
                              <div className="bg-white p-3 rounded-md border">
                                <QRCode value={pass.qr_url} size={140} quietZone={0} bgColor="transparent" />
                              </div>

                              <Button variant="outline" size="sm" onClick={() => handleDownloadQr(pass)}>
                                <Download className="w-4 h-4 mr-2" />
                                Baixar QR Code
                              </Button>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500">
                              QR code indisponível ou bloqueado por política de segurança.
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
        </tbody>
      </table>
    </div>
  );
};

const WalletConfigTab = ({ projectId, onBack }) => {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [passes, setPasses] = useState([]);
  const [loadingPasses, setLoadingPasses] = useState(false);
  const [generationResult, setGenerationResult] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projectSlug, setProjectSlug] = useState('');
  const [formState, setFormState] = useState({
    type: 'loyalty',
    title: '',
    description: '',
    exp_date: '',
    colors: { background: '#6c5ce7', label: '#ffffff', text: '#ffffff' },
    images: {
      logo: '',
      icon: '',
      appleLogo: '',
      googleLogo: '',
      googleHero: '',
      appleStrip: '',
    },
    dataFields: [],
    sampleValues: {},
    qr_url: '',
  });

  const fileInputRef = useRef(null);
  const [uploadingKey, setUploadingKey] = useState(null);

  const loadWalletDefaults = useCallback(async (pId) => {
    setIsProcessing(true);
    try {
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('slug')
        .eq('id', pId)
        .single();

      if (projectError) throw projectError;
      setProjectSlug(projectData.slug);

      const fromProject = pId
        ? await supabase
            .from('wallet_templates')
            .select('defaults')
            .eq('project_id', pId)
            .maybeSingle()
        : { data: null };

      if (fromProject.data?.defaults) {
        const normalizedDefaults = normalizeWalletDefaults(fromProject.data.defaults);

        setFormState(prev => ({
          ...prev,
          ...normalizedDefaults,
          colors: { ...prev.colors, ...(normalizedDefaults.colors ?? {}) },
          images: { ...prev.images, ...(normalizedDefaults.images ?? {}) },
        }));

        toast({ title: "Template do projeto carregado!" });
        return;
      }

      const { data: globalData, error: globalError } = await supabase
        .from('wallet_templates')
        .select('defaults')
        .is('project_id', null)
        .single();

      if (globalError) throw globalError;

      if (globalData?.defaults) {
        const normalizedDefaults = normalizeWalletDefaults(globalData.defaults);

        setFormState(prev => ({
          ...prev,
          ...normalizedDefaults,
          colors: { ...prev.colors, ...(normalizedDefaults.colors ?? {}) },
          images: { ...prev.images, ...(normalizedDefaults.images ?? {}) },
        }));

        toast({ title: "Template global carregado como fallback." });
      }
    } catch (error) {
      toast({
        title: 'Erro ao carregar template',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setIsProcessing(false);
    }
  }, [toast]);

  const fetchPasses = useCallback(async (pId) => {
    if (!pId) {
      setPasses([]);
      return;
    }

    setLoadingPasses(true);
    try {
      const { data, error } = await supabase
        .from('v_passes')
        .select('*')
        .eq('project_id', pId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPasses(data || []);
    } catch (error) {
      toast({
        title: 'Erro ao buscar passes',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoadingPasses(false);
    }
  }, [toast]);

  useEffect(() => {
    if (projectId) {
      loadWalletDefaults(projectId);
      fetchPasses(projectId);
    }
  }, [projectId, loadWalletDefaults, fetchPasses]);

  const handleFormChange = (path, value) => {
    setFormState(prev => {
      const keys = path.split('.');
      const tempState = JSON.parse(JSON.stringify(prev));
      let current = tempState;

      for (let i = 0; i < keys.length - 1; i++) {
        if (current[keys[i]] === undefined) current[keys[i]] = {};
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = value;
      return tempState;
    });
  };

  const handleUploadClick = (key) => {
    setUploadingKey(key);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !uploadingKey) return;

    const rule = IMAGE_UPLOAD_RULES[uploadingKey];

    if (!isPngFile(file)) {
      toast({
        title: "Formato inválido",
        description: `O campo "${rule?.label ?? uploadingKey}" aceita apenas arquivos PNG.`,
        variant: "destructive",
      });

      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadingKey(null);
      return;
    }

    setIsProcessing(true);
    const path = `${projectId || 'temp'}/${uploadingKey}-${Date.now()}-${file.name}`;

    try {
      let dimensions = null;

      try {
        dimensions = await getImageDimensions(file);
      } catch (dimensionError) {
        console.warn("Não foi possível ler dimensões da imagem:", dimensionError);
      }

      const validation = dimensions
        ? validateUploadByKey(uploadingKey, dimensions.width, dimensions.height)
        : { valid: true };

      if (!validation.valid) {
        toast({
          title: "Dimensões Inválidas",
          description: validation.message,
          variant: "destructive",
        });
        return;
      }

      const { error: uploadError } = await supabase.storage
        .from('pass-assets')
        .upload(path, file, {
          upsert: true,
          contentType: 'image/png',
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('pass-assets').getPublicUrl(path);
      handleFormChange(`images.${uploadingKey}`, data.publicUrl);

      toast({ title: "Upload com sucesso!" });

      if (validation.warning) {
        toast({
          title: "Formato recomendado diferente",
          description: validation.warning,
        });
      }
    } catch (error) {
      toast({
        title: "Erro no upload",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setUploadingKey(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleGenerateLink = async () => {
    setIsProcessing(true);
    try {
      const body = {
        project_id: projectId,
        project_slug: projectSlug,
        type: formState.type,
        title: formState.title,
        description: formState.description,
        fields: Object.fromEntries(
          formState.dataFields.map(f => [f.key, formState.sampleValues?.[f.key] ?? ''])
        ),
        app_base_url: window.location.origin,
      };

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-pass`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(body)
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Falha na requisição: ${response.status}`);

      setFormState(prev => ({ ...prev, qr_url: result.qr_url || prev.qr_url }));
      setGenerationResult(result);
      setIsModalOpen(true);
      fetchPasses(projectId);
    } catch (error) {
      toast({
        title: 'Erro ao gerar link',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveDefaults = async () => {
    setIsProcessing(true);
    try {
      const normalizedDefaultsToSave = normalizeWalletDefaults(formState);

      const { error } = await supabase
        .from('wallet_templates')
        .upsert(
          {
            project_id: projectId,
            name: 'Template do Projeto',
            defaults: normalizedDefaultsToSave,
          },
          { onConflict: 'project_id' }
        );

      if (error) throw error;
      toast({ title: "Template do projeto salvo com sucesso!" });
    } catch (error) {
      toast({
        title: 'Erro ao salvar template',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePassesListAction = (action, url) => {
    if (!url) {
      toast({ title: 'Link indisponível', variant: 'destructive' });
      return;
    }

    if (action === 'copy') {
      navigator.clipboard.writeText(url);
      toast({ title: "Link copiado!" });
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Configuração da Wallet</h1>
        <Button onClick={onBack} variant="outline">Voltar aos Projetos</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="space-y-4 p-4 border rounded-lg">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Settings className="w-5 h-5 text-purple-500" />Design do Passe
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <Label>Tipo</Label>
                  <Select value={formState.type} onValueChange={(v) => handleFormChange('type', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="loyalty">Loyalty</SelectItem>
                      <SelectItem value="offer">Offer</SelectItem>
                      <SelectItem value="event">Event</SelectItem>
                      <SelectItem value="generic">Generic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Título</Label>
                  <Input
                    value={formState.title}
                    onChange={e => handleFormChange('title', e.target.value)}
                    placeholder="Ex: Cartão Fidelidade"
                  />
                </div>

                <div>
                  <Label>Descrição</Label>
                  <Textarea
                    value={formState.description}
                    onChange={e => handleFormChange('description', e.target.value)}
                    placeholder="Ex: Complete 10 visitas e ganhe um café!"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <ColorInput
                    label="Fundo"
                    value={formState.colors.background}
                    onChange={e => handleFormChange('colors.background', e.target.value)}
                  />
                  <ColorInput
                    label="Rótulo"
                    value={formState.colors.label}
                    onChange={e => handleFormChange('colors.label', e.target.value)}
                  />
                  <ColorInput
                    label="Texto"
                    value={formState.colors.text}
                    onChange={e => handleFormChange('colors.text', e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <UploadButtonWithInfo
                    uploadKey="appleLogo"
                    onUpload={handleUploadClick}
                  />

                  <UploadButtonWithInfo
                    uploadKey="googleLogo"
                    onUpload={handleUploadClick}
                  />

                  <UploadButtonWithInfo
                    uploadKey="appleStrip"
                    onUpload={handleUploadClick}
                  />

                  <UploadButtonWithInfo
                    uploadKey="googleHero"
                    onUpload={handleUploadClick}
                  />
                </div>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  accept=".png,image/png"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-center items-center gap-4 py-6">
            <Button size="lg" onClick={handleSaveDefaults} disabled={isProcessing} variant="outline">
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {isProcessing ? 'Salvando...' : 'Salvar Alterações'}
            </Button>

            <Button size="lg" onClick={handleGenerateLink} disabled={isProcessing}>
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LinkIcon className="mr-2 h-4 w-4" />}
              {isProcessing ? 'Gerando...' : 'Gerar Link Único'}
            </Button>
          </div>
    
          <div className="space-y-4">
            <h2 className="font-semibold text-lg">Passes Emitidos para este Projeto</h2>
            <PassesList passes={passes} loading={loadingPasses} onAction={handlePassesListAction} />
          </div>
        </div>

        <div className="lg:col-span-1">
          <PassPreview formState={formState} qrPreviewUrl={generationResult?.qr_url} />
        </div>
      </div>

      <GenerationResultModal isOpen={isModalOpen} setIsOpen={setIsModalOpen} result={generationResult} />
    </div>
  );
};

export default WalletConfigTab;
