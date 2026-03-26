import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent } from '@/components/ui/dialog';
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
  Info,
  MapPin,
  PlusCircle,
} from 'lucide-react';
import { QRCode } from 'react-qrcode-logo';
import GenerationResultModal from '@/components/superadmin/wallet/GenerationResultModal';
import LocationsTab from '@/components/superadmin/LocationsTab';
import { listPassLocationIds } from '@/lib/api';

const IMAGE_UPLOAD_RULES = {
  icon: {
    label: 'Icone Apple',
    helpTitle: 'Icone Apple',
    helpLines: ['Logo que aparece na notificação do seu passe', 'Obrigatorio: PNG', 'Proporcao recomendada: 1:1'],
    recommendedRatio: 1,
    recommendedRatioLabel: '1:1',
  },
  appleLogo: {
    label: 'Logo Apple',
    helpTitle: 'Logo Apple',
    helpLines: ['Obrigatório: PNG'],
  },
  googleLogo: {
    label: 'Logo Google',
    helpTitle: 'Logo Google',
    helpLines: ['Obrigatório: PNG', 'Proporção recomendada: 1:1'],
    recommendedRatio: 1,
    recommendedRatioLabel: '1:1',
  },
  appleStrip: {
    label: 'Apple Strip',
    helpTitle: 'Apple Strip',
    helpLines: ['Obrigatório: PNG', 'Altura máxima: 432px', 'Proporção recomendada: 2.6:1'],
  },
  googleHero: {
    label: 'Google Hero',
    helpTitle: 'Google Hero',
    helpLines: ['Obrigatório: PNG', 'Proporção recomendada: 3:1'],
    recommendedRatio: 3,
    recommendedRatioLabel: '3:1',
  },
};

const INITIAL_FORM_STATE = {
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
};

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

async function getFunctionAuthHeaders() {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const headers = {
    'Content-Type': 'application/json',
  };

  if (anonKey) {
    headers.apikey = anonKey;
  }

  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data?.session?.access_token;
    headers.Authorization = `Bearer ${accessToken || anonKey || ''}`;
  } catch {
    headers.Authorization = `Bearer ${anonKey || ''}`;
  }

  return headers;
}

function toObject(v) {
  if (isObject(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeWalletDefaults(defaults = {}) {
  const incoming = toObject(defaults);
  const incomingImages = toObject(incoming.images);
  const legacyLogo = incomingImages.logo ?? '';

  return {
    ...incoming,
    images: {
      logo: incomingImages.logo ?? '',
      icon: incomingImages.icon ?? '',
      appleLogo: incomingImages.appleLogo ?? legacyLogo ?? '',
      googleLogo: incomingImages.googleLogo ?? legacyLogo ?? '',
      appleStrip: incomingImages.appleStrip ?? '',
      googleHero: incomingImages.googleHero ?? '',
    },
  };
}

function mergeWithInitial(defaults = {}) {
  const normalized = normalizeWalletDefaults(defaults);
  return {
    ...INITIAL_FORM_STATE,
    ...normalized,
    colors: {
      ...INITIAL_FORM_STATE.colors,
      ...toObject(normalized.colors),
    },
    images: {
      ...INITIAL_FORM_STATE.images,
      ...toObject(normalized.images),
    },
    dataFields: Array.isArray(normalized.dataFields) ? normalized.dataFields : [],
    sampleValues: toObject(normalized.sampleValues),
    qr_url: normalized.qr_url ?? '',
  };
}

function formatExpPreview(v) {
  if (!v) return 'XX/XX';
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return 'XX/XX';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  } catch {
    return 'XX/XX';
  }
}

function getAllowedQrHosts() {
  const rawHosts = import.meta.env.VITE_QR_ALLOWED_HOSTS || '';
  return new Set(
    rawHosts
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isSafeQrUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const isHttps = parsed.protocol === 'https:';
    const isLocalHttp = parsed.protocol === 'http:' && LOCAL_DEV_HOSTS.has(hostname);
    if (!isHttps && !isLocalHttp) return false;

    const allowedHosts = getAllowedQrHosts();
    if (allowedHosts.size > 0) return allowedHosts.has(hostname);

    if (typeof window === 'undefined') return isHttps || isLocalHttp;
    return parsed.origin === window.location.origin || LOCAL_DEV_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

function sanitizeFilenamePart(value) {
  const normalized = String(value ?? 'pass')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const safe = normalized
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  return safe || 'pass';
}

function isPngFile(file) {
  if (!file) return false;
  return file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
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
      reject(new Error('Não foi possível ler as dimensões da imagem.'));
    };

    image.src = objectUrl;
  });
}

function validateUploadByKey(uploadKey, width, height) {
  if (uploadKey === 'appleStrip' && height > 432) {
    return {
      valid: false,
      message: `Apple Strip invalida: ${width} x ${height}. Use PNG com altura maxima de 432px.`,
    };
  }

  const rule = IMAGE_UPLOAD_RULES[uploadKey];
  if (!rule?.recommendedRatio || !height) return { valid: true };

  const ratio = width / height;
  const ratioTolerance = 0.01;
  if (Math.abs(ratio - rule.recommendedRatio) > ratioTolerance) {
    return {
      valid: true,
      warning: `${rule.label}: proporção recomendada ${rule.recommendedRatioLabel}. Sua imagem está em ${ratio.toFixed(2)}:1.`,
    };
  }

  return { valid: true };
}

function formatPassCreatedAt(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildFieldsPayload(formState) {
  const sampleValues = toObject(formState.sampleValues);
  const fields = { ...sampleValues };
  if (formState.exp_date) fields.exp_date = formState.exp_date;
  return fields;
}

function buildDesignPayload(formState) {
  return {
    colors: toObject(formState.colors),
    images: normalizeWalletDefaults({ images: formState.images }).images,
    dataFields: Array.isArray(formState.dataFields) ? formState.dataFields : [],
  };
}

function passToFormState(pass, templateDefaults) {
  const defaults = mergeWithInitial(templateDefaults);
  const design = toObject(pass?.design);
  const fields = toObject(pass?.fields);

  const dataFields = Array.isArray(design.dataFields) && design.dataFields.length > 0
    ? design.dataFields
    : Object.keys(fields)
      .filter((key) => key !== 'exp_date')
      .map((key) => ({ key, label: key }));

  const sampleValues = {};
  Object.keys(fields).forEach((key) => {
    if (key === 'exp_date') return;
    sampleValues[key] = fields[key];
  });

  return {
    ...defaults,
    type: pass?.type || defaults.type,
    title: pass?.title || defaults.title,
    description: pass?.description || defaults.description,
    exp_date: fields.exp_date || defaults.exp_date || '',
    colors: {
      ...defaults.colors,
      ...toObject(design.colors),
    },
    images: {
      ...defaults.images,
      ...normalizeWalletDefaults({ images: design.images }).images,
    },
    dataFields,
    sampleValues,
    qr_url: pass?.qr_url || '',
  };
}

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
          aria-label={`Informacoes sobre ${rule.label}`}
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

const PassPreview = ({ formState, qrPreviewUrl }) => {
  const [platform, setPlatform] = useState('apple');
  const { title = 'Título do Passe', colors = {}, images = {}, dataFields = [], sampleValues = {}, exp_date } = formState;
  const { background = '#6c5ce7', text = '#ffffff', label = '#ffffff' } = colors;
  const { logo: legacyLogo, appleLogo, googleLogo, googleHero, appleStrip } = images;

  const logoUrl = platform === 'apple' ? (appleLogo || legacyLogo) : (googleLogo || legacyLogo);
  const pointsFieldKey = dataFields.find((f) => String(f?.key || '').toLowerCase().includes('points'))?.key;
  const pointsValue = pointsFieldKey ? (sampleValues[pointsFieldKey] || '123') : '123';
  const expText = `EXPIRA EM ${formatExpPreview(exp_date)}`;
  const qrValue = qrPreviewUrl || formState.qr_url || 'https://example.com';

  return (
    <div className="sticky top-24">
      <div style={{ backgroundColor: background }} className="w-full max-w-sm mx-auto rounded-2xl flex flex-col text-white shadow-2xl overflow-hidden">
        <div className="p-4 flex flex-col flex-1 min-h-[420px]">
          <header className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              {logoUrl ? <img src={logoUrl} alt="logo" className="w-10 h-10 rounded-full bg-white object-contain p-1" /> : <div className="w-10 h-10 rounded-full bg-white/20" />}
              <h3 style={{ color: text }} className="font-bold text-lg">{title}</h3>
            </div>
            <p style={{ color: label }} className="text-xs uppercase font-semibold">{expText}</p>
          </header>

          {platform === 'apple' && (
            appleStrip
              ? <div className="-mx-4 mb-4"><img src={appleStrip} alt="Apple Strip" className="w-full h-28 object-cover" /></div>
              : <div className="-mx-4 mb-4"><div className="w-full h-28 bg-white/15" /></div>
          )}

          <main className="flex-grow flex flex-col items-start justify-center text-left">
            <p style={{ color: label }} className="text-sm uppercase tracking-wider">Pontos</p>
            <p style={{ color: text }} className="text-4xl font-bold leading-none">{pointsValue}</p>
          </main>

          <footer className="mt-6 flex items-center justify-center">
            <div className="bg-white p-2 rounded-md"><QRCode value={qrValue} size={96} quietZone={0} bgColor="transparent" /></div>
          </footer>
        </div>

        {platform === 'google' && (
          googleHero ? <img src={googleHero} alt="Google Hero" className="w-full h-32 object-cover" /> : <div className="w-full h-32 bg-white/15" />
        )}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        <Button size="sm" variant={platform === 'apple' ? 'default' : 'secondary'} className="rounded-full gap-2" onClick={() => setPlatform('apple')}>
          <Apple className="w-4 h-4" /> Apple
        </Button>
        <Button size="sm" variant={platform === 'google' ? 'default' : 'secondary'} className="rounded-full gap-2" onClick={() => setPlatform('google')}>
          <Smartphone className="w-4 h-4" /> Google
        </Button>
      </div>
    </div>
  );
};

const PassesList = ({ passes, loading, onAction, selectedPassId, onSelectPass }) => {
  const { toast } = useToast();
  const [expandedPassId, setExpandedPassId] = useState(null);
  const qrContainerRefs = useRef({});

  const handleDownloadQr = (pass) => {
    const container = qrContainerRefs.current[pass.id];
    const canvas = container?.querySelector('canvas');
    if (!canvas) {
      toast({ title: 'QR code indisponível', variant: 'destructive' });
      return;
    }

    const fileName = `${sanitizeFilenamePart(pass.title)}-${sanitizeFilenamePart(pass.id)}.png`;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-900/50">
          <tr>
            <th className="p-3 text-left font-semibold">Título</th>
            <th className="p-3 text-left font-semibold">Tipo</th>
            <th className="p-3 text-left font-semibold">Status</th>
            <th className="p-3 text-left font-semibold">Criado em</th>
            <th className="p-3 text-center font-semibold">Ações</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan="5" className="text-center p-8"><Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" /></td></tr>}
          {!loading && passes.length === 0 && <tr><td colSpan="5" className="text-center p-8 text-gray-500">Nenhum passe emitido para este projeto.</td></tr>}
          {!loading && passes.map((pass) => {
            const isExpanded = expandedPassId === pass.id;
            const isSelected = selectedPassId === pass.id;
            const canUseQr = Boolean(pass.qr_url) && isSafeQrUrl(pass.qr_url);
            return (
              <React.Fragment key={pass.id}>
                <tr
                  onClick={() => onSelectPass?.(pass)}
                  className={`border-t dark:border-gray-800 transition-colors ${isSelected ? 'bg-indigo-50/80 dark:bg-indigo-900/30' : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/50'} ${onSelectPass ? 'cursor-pointer' : ''}`}
                >
                  <td className="p-3 font-medium">{pass.title}</td>
                  <td className="p-3">{pass.type}</td>
                  <td className="p-3"><span className="bg-green-100 text-green-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full dark:bg-green-900 dark:text-green-300">{pass.status || 'Ativo'}</span></td>
                  <td className="p-3 whitespace-nowrap">{formatPassCreatedAt(pass.created_at)}</td>
                  <td className="p-3">
                    <div className="flex justify-center gap-1">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onAction('copy', pass.qr_url); }} disabled={!canUseQr}><LinkIcon className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setExpandedPassId((curr) => (curr === pass.id ? null : pass.id)); }} disabled={!canUseQr}><QrCode className="w-4 h-4" /></Button>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-t dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30">
                    <td colSpan="5" className="p-4">
                      <div className="flex justify-center">
                        <div ref={(node) => { if (node) qrContainerRefs.current[pass.id] = node; else delete qrContainerRefs.current[pass.id]; }} className="flex flex-col items-center gap-3">
                          <div className="bg-white p-3 rounded-md border"><QRCode value={pass.qr_url} size={140} quietZone={0} bgColor="transparent" /></div>
                          <Button variant="outline" size="sm" onClick={() => handleDownloadQr(pass)}><Download className="w-4 h-4 mr-2" />Baixar QR Code</Button>
                        </div>
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
  const [isLocationsModalOpen, setIsLocationsModalOpen] = useState(false);
  const [projectSlug, setProjectSlug] = useState('');
  const [templateDefaults, setTemplateDefaults] = useState(mergeWithInitial());
  const [formState, setFormState] = useState(mergeWithInitial());
  const [selectedPass, setSelectedPass] = useState(null);
  const [selectedPassLocationIds, setSelectedPassLocationIds] = useState([]);
  const [draftLocationIds, setDraftLocationIds] = useState([]);
  const [passLocationsByPassId, setPassLocationsByPassId] = useState({});
  const [uploadingKey, setUploadingKey] = useState(null);
  const fileInputRef = useRef(null);

  const isEditingPass = Boolean(selectedPass?.id);
  const activeLocationIds = isEditingPass ? selectedPassLocationIds : draftLocationIds;

  const updateLocationSelection = useCallback((ids) => {
    const normalized = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
    if (isEditingPass && selectedPass?.id) {
      setSelectedPassLocationIds(normalized);
      setPassLocationsByPassId((prev) => ({ ...prev, [selectedPass.id]: normalized }));
      return;
    }
    setDraftLocationIds(normalized);
  }, [isEditingPass, selectedPass]);

  const fetchPasses = useCallback(async (pId) => {
    if (!pId) return;
    setLoadingPasses(true);
    try {
      const { data, error } = await supabase
        .from('passes')
        .select('id, project_id, type, title, description, status, qr_url, created_at, fields, design')
        .eq('project_id', pId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = data || [];
      setPasses(rows);

      const passIds = rows.map((row) => row.id).filter(Boolean);
      if (passIds.length > 0) {
        const { data: mappings, error: mappingsError } = await supabase
          .from('pass_locations')
          .select('pass_id, location_id')
          .eq('project_id', pId)
          .in('pass_id', passIds);

        if (mappingsError) throw mappingsError;
        const map = {};
        (mappings || []).forEach((row) => {
          if (!row.pass_id || !row.location_id) return;
          if (!Array.isArray(map[row.pass_id])) map[row.pass_id] = [];
          if (!map[row.pass_id].includes(row.location_id)) map[row.pass_id].push(row.location_id);
        });
        setPassLocationsByPassId(map);
      } else {
        setPassLocationsByPassId({});
      }
    } catch (error) {
      toast({ title: 'Erro ao buscar passes', description: error.message, variant: 'destructive' });
    } finally {
      setLoadingPasses(false);
    }
  }, [toast]);

  const loadWalletDefaults = useCallback(async (pId) => {
    setIsProcessing(true);
    try {
      const { data: projectData, error: projectError } = await supabase.from('projects').select('slug').eq('id', pId).single();
      if (projectError) throw projectError;
      setProjectSlug(projectData.slug || '');

      const fromProject = await supabase.from('wallet_templates').select('defaults').eq('project_id', pId).maybeSingle();
      let defaults = fromProject.data?.defaults;
      if (!defaults) {
        const { data: globalData, error: globalError } = await supabase.from('wallet_templates').select('defaults').is('project_id', null).single();
        if (globalError) throw globalError;
        defaults = globalData?.defaults ?? {};
      }

      const merged = mergeWithInitial(defaults);
      setTemplateDefaults(merged);
    } catch (error) {
      toast({ title: 'Erro ao carregar template', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!projectId) return;
    setSelectedPass(null);
    setSelectedPassLocationIds([]);
    setDraftLocationIds([]);
    setGenerationResult(null);
    loadWalletDefaults(projectId);
    fetchPasses(projectId);
  }, [projectId, loadWalletDefaults, fetchPasses]);

  useEffect(() => {
    if (!selectedPass) {
      setFormState(mergeWithInitial(templateDefaults));
    }
  }, [templateDefaults, selectedPass]);

  const handleFormChange = (path, value) => {
    setFormState((prev) => {
      const keys = path.split('.');
      const temp = JSON.parse(JSON.stringify(prev));
      let current = temp;
      for (let i = 0; i < keys.length - 1; i += 1) {
        if (current[keys[i]] === undefined) current[keys[i]] = {};
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return temp;
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
      toast({ title: 'Formato inválido', description: `O campo "${rule?.label ?? uploadingKey}" aceita apenas PNG.`, variant: 'destructive' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadingKey(null);
      return;
    }

    setIsProcessing(true);
    const path = `${projectId || 'temp'}/${uploadingKey}-${Date.now()}-${file.name}`;
    try {
      const dimensions = await getImageDimensions(file);
      const validation = validateUploadByKey(uploadingKey, dimensions.width, dimensions.height);
      if (!validation.valid) throw new Error(validation.message);

      const { error: uploadError } = await supabase.storage.from('pass-assets').upload(path, file, { upsert: true, contentType: 'image/png' });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('pass-assets').getPublicUrl(path);
      handleFormChange(`images.${uploadingKey}`, data.publicUrl);
      toast({ title: 'Upload com sucesso.' });
      if (validation.warning) toast({ title: 'Aviso de proporção', description: validation.warning });
    } catch (error) {
      toast({ title: 'Erro no upload', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
      setUploadingKey(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSelectPass = async (pass) => {
    if (!pass?.id) return;
    setGenerationResult(null);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    let resolvedPass = pass;
    if (pass.design === undefined || pass.fields === undefined) {
      try {
        const { data: passRow, error: passError } = await supabase
          .from('passes')
          .select('id, project_id, type, title, description, status, qr_url, created_at, fields, design')
          .eq('id', pass.id)
          .eq('project_id', projectId)
          .single();

        if (passError) throw passError;
        resolvedPass = { ...pass, ...(passRow || {}) };
      } catch (error) {
        toast({
          title: 'Erro ao carregar dados completos do passe',
          description: error.message,
          variant: 'destructive',
        });
      }
    }

    setSelectedPass(resolvedPass);
    setFormState(passToFormState(resolvedPass, templateDefaults));

    const cached = passLocationsByPassId[resolvedPass.id];
    if (Array.isArray(cached)) {
      setSelectedPassLocationIds(cached);
      return;
    }

    try {
      const ids = await listPassLocationIds(projectId, resolvedPass.id);
      setSelectedPassLocationIds(ids);
      setPassLocationsByPassId((prev) => ({ ...prev, [resolvedPass.id]: ids }));
    } catch (error) {
      toast({ title: 'Erro ao carregar localizações do passe', description: error.message, variant: 'destructive' });
      setSelectedPassLocationIds([]);
    }
  };

  const handleCreateNewPass = () => {
    setSelectedPass(null);
    setSelectedPassLocationIds([]);
    setDraftLocationIds([]);
    setGenerationResult(null);
    setFormState(mergeWithInitial(templateDefaults));
  };

  const handleGenerateLink = async () => {
    setIsProcessing(true);
    try {
      const design = buildDesignPayload(formState);
      const body = {
        project_id: projectId,
        project_slug: projectSlug,
        type: formState.type,
        title: formState.title,
        description: formState.description,
        fields: buildFieldsPayload(formState),
        colors: design.colors,
        images: design.images,
        location_ids: draftLocationIds,
        app_base_url: window.location.origin,
      };

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-pass`, {
        method: 'POST',
        mode: 'cors',
        headers: await getFunctionAuthHeaders(),
        body: JSON.stringify(body),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Falha na requisição: ${response.status}`);

      setFormState((prev) => ({ ...prev, qr_url: result.qr_url || prev.qr_url }));
      setGenerationResult(result);
      setIsModalOpen(true);
      await fetchPasses(projectId);
    } catch (error) {
      toast({ title: 'Erro ao gerar link', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveTemplate = async () => {
    setIsProcessing(true);
    try {
      const normalizedDefaultsToSave = normalizeWalletDefaults({ ...formState, qr_url: '' });
      const { error } = await supabase
        .from('wallet_templates')
        .upsert({ project_id: projectId, name: 'Template do Projeto', defaults: normalizedDefaultsToSave }, { onConflict: 'project_id' });

      if (error) throw error;
      setTemplateDefaults(mergeWithInitial(normalizedDefaultsToSave));
      toast({ title: 'Template do projeto salvo com sucesso.' });
    } catch (error) {
      toast({ title: 'Erro ao salvar template', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdatePass = async () => {
    if (!selectedPass?.id) return;
    const confirmed = window.confirm('Essas mudanças também irão alterar os passes que já estão na carteira dos clientes, deseja confirmar a operação?');
    if (!confirmed) return;

    setIsProcessing(true);
    try {
      const design = buildDesignPayload(formState);
      const body = {
        project_id: projectId,
        pass_id: selectedPass.id,
        pass_data: {
          pass_id: selectedPass.id,
          project_id: projectId,
          type: formState.type,
          title: formState.title,
          description: formState.description,
          exp_date: formState.exp_date || null,
          fields: buildFieldsPayload(formState),
          design,
          colors: design.colors,
          images: design.images,
          location_ids: selectedPassLocationIds,
        },
      };

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-pass`, {
        method: 'POST',
        mode: 'cors',
        headers: await getFunctionAuthHeaders(),
        body: JSON.stringify(body),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok === false) throw new Error(result?.message || result?.error || `Falha na requisição: ${response.status}`);

      const pushes = result?.pushes || {};
      const appleFailed = pushes?.apple?.failed ?? 0;
      const googleFailed = pushes?.google?.failed ?? 0;
      const hasPushFailures = appleFailed > 0 || googleFailed > 0;
      toast({
        title: hasPushFailures ? 'Passe atualizado com alertas.' : 'Passe atualizado com sucesso.',
        description: hasPushFailures ? `Push enviado para ${pushes.total_tokens ?? 0} token(s). Apple: ${pushes?.apple?.success ?? 0} ok, ${appleFailed} falhou. Google: ${pushes?.google?.success ?? 0} ok, ${googleFailed} falhou.` : `Atualizações enviadas para os clientes!`,
        variant: hasPushFailures ? 'destructive' : 'default',
      });

      setPassLocationsByPassId((prev) => ({ ...prev, [selectedPass.id]: selectedPassLocationIds }));
      await fetchPasses(projectId);

      const mergedPass = { ...selectedPass, ...(result?.pass || {}) };
      setSelectedPass(mergedPass);
      setFormState(passToFormState(mergedPass, templateDefaults));
    } catch (error) {
      toast({ title: 'Erro ao atualizar passe', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    if (isEditingPass) {
      await handleUpdatePass();
      return;
    }
    await handleSaveTemplate();
  };

  const handlePassesListAction = (action, url) => {
    if (!url) {
      toast({ title: 'Link indisponível', variant: 'destructive' });
      return;
    }
    if (action === 'copy') {
      navigator.clipboard.writeText(url);
      toast({ title: 'Link copiado.' });
      return;
    }
    window.open(url, '_blank');
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="w-full">
          {isEditingPass ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                <p className="text-sm font-medium">
                  Editando passe criado em {formatPassCreatedAt(selectedPass?.created_at)}.
                </p>
              </div>
              <div className="flex items-center gap-2 w-full">
                <Button size="sm" variant="outline" onClick={handleCreateNewPass} disabled={isProcessing}>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Criar novo passe
                </Button>
                <Button size="sm" onClick={onBack} variant="outline" className="ml-auto">Voltar aos Projetos</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-bold">Configuração da Wallet</h1>
              <Button onClick={onBack} variant="outline">Voltar aos Projetos</Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="space-y-4 p-4 border rounded-lg">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Settings className="w-5 h-5 text-purple-500" />
              {isEditingPass ? 'Design do Passe Selecionado' : 'Design do Passe (Template)'}
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
                  <Input value={formState.title} onChange={(e) => handleFormChange('title', e.target.value)} placeholder="Ex: Cartão Fidelidade" />
                </div>

                <div>
                  <Label>Descrição</Label>
                  <Textarea value={formState.description} onChange={(e) => handleFormChange('description', e.target.value)} placeholder="Ex: Complete 10 visitas e ganhe um café." />
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <ColorInput label="Fundo" value={formState.colors.background} onChange={(e) => handleFormChange('colors.background', e.target.value)} />
                  <ColorInput label="Rótulo" value={formState.colors.label} onChange={(e) => handleFormChange('colors.label', e.target.value)} />
                  <ColorInput label="Texto" value={formState.colors.text} onChange={(e) => handleFormChange('colors.text', e.target.value)} />
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <UploadButtonWithInfo uploadKey="appleLogo" onUpload={handleUploadClick} />
                  <UploadButtonWithInfo uploadKey="googleLogo" onUpload={handleUploadClick} />
                  <UploadButtonWithInfo uploadKey="appleStrip" onUpload={handleUploadClick} />
                  <UploadButtonWithInfo uploadKey="googleHero" onUpload={handleUploadClick} />
                  </div>
                  <div className="md:max-w-[calc(50%-0.375rem)]">
                    <UploadButtonWithInfo uploadKey="icon" onUpload={handleUploadClick} />
                  </div>
                </div>

                <Button type="button" variant="outline" className="w-full justify-start" onClick={() => setIsLocationsModalOpen(true)}>
                  <MapPin className="mr-2 h-4 w-4" />
                  Adicionar localização ({activeLocationIds.length} selecionada(s))
                </Button>

                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".png,image/png" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-4 py-6">
            <Button size="lg" onClick={handleSave} disabled={isProcessing} variant="outline">
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {isProcessing ? 'Salvando...' : 'Salvar alterações'}
            </Button>

            {!isEditingPass && (
              <Button size="lg" onClick={handleGenerateLink} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LinkIcon className="mr-2 h-4 w-4" />}
                {isProcessing ? 'Gerando...' : 'Gerar Link Único'}
              </Button>
            )}

          </div>

          <div className="space-y-4">
            <h2 className="font-semibold text-lg">Passes Emitidos para este Projeto</h2>
            <PassesList
              passes={passes}
              loading={loadingPasses}
              onAction={handlePassesListAction}
              selectedPassId={selectedPass?.id || null}
              onSelectPass={handleSelectPass}
            />
          </div>
        </div>

        <div className="lg:col-span-1">
          <PassPreview formState={formState} qrPreviewUrl={generationResult?.qr_url || formState.qr_url} />
        </div>
      </div>

      <Dialog open={isLocationsModalOpen} onOpenChange={setIsLocationsModalOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <LocationsTab
            projectId={projectId}
            selectionMode
            passId={isEditingPass ? selectedPass.id : null}
            selectedLocationIds={activeLocationIds}
            onSelectedLocationIdsChange={updateLocationSelection}
            onClose={() => setIsLocationsModalOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <GenerationResultModal isOpen={isModalOpen} setIsOpen={setIsModalOpen} result={generationResult} />
    </div>
  );
};

export default WalletConfigTab;
