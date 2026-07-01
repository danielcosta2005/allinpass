import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Apple,
  Smartphone,
  Upload,
  Link as LinkIcon,
  Save,
  Settings,
  Download,
  Info,
  MapPin,
  PlusCircle,
  Edit3,
  Trash2,
} from 'lucide-react';
import { QRCode } from 'react-qrcode-logo';
import GenerationResultModal from '@/components/superadmin/wallet/GenerationResultModal';
import LocationsTab from '@/components/superadmin/LocationsTab';
import { listPassLocationIds } from '@/lib/api';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import {
  getFunctionErrorMessage as getSharedFunctionErrorMessage,
  getFunctionErrorStatus,
  readFunctionErrorPayload as readSharedFunctionErrorPayload,
} from '@/lib/functionErrors';

const IMAGE_UPLOAD_RULES = {
  icon: {
    label: 'Icone Apple',
    helpTitle: 'Icone Apple',
    helpLines: ['Logo que aparece na notificação do seu cartão', 'Obrigatorio: PNG', 'Proporcao recomendada: 1:1'],
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
    helpLines: ['Obrigatório: PNG', 'Altura máxima: 432px', 'Proporção recomendada: 375:144'],
    recommendedRatio: 375 / 144,
    recommendedRatioLabel: '375:144',
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

const MAX_CAROUSEL_VISIBILITY = 2;
const HOVER_ACTION_BUTTON_CLASS = 'h-11 min-w-[132px] gap-2 rounded-xl px-4 text-sm font-semibold shadow-lg';

const LEGACY_GLOBAL_TITLE_VALUES = new Set([
  'cartao fidelidade global',
]);
const LEGACY_GLOBAL_DESCRIPTION_VALUES = new Set([
  'modelo global para fallback',
]);

const DELETED_PASS_STATUSES = new Set(['excluido', 'excluído', 'deleted', 'inactive', 'inativo']);

const WALLET_FUNCTION_ERROR_MESSAGES = {
  unauthorized: 'Sessão expirada ou inválida. Faça login novamente.',
  forbidden: 'Você não tem permissão para realizar esta ação.',
  bad_request: 'Revise os dados enviados e tente novamente.',
  not_found: 'Cartão não encontrado para este projeto.',
  invalid_location_ids: 'Uma ou mais localizações não pertencem ao projeto informado.',
  missing_app_base_url: 'Não foi possível montar o link do cartão. Recarregue a página e tente novamente.',
  missing_env: 'Configuração do servidor incompleta. Tente novamente mais tarde.',
  method_not_allowed: 'Método inválido para esta operação.',
  internal_error: 'Não foi possível concluir a operação. Tente novamente.',
};

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function normalizeErrorText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeStatusKey(status) {
  return normalizeErrorText(status);
}

function isDeletedPass(pass) {
  return Boolean(pass?.deleted_at) || DELETED_PASS_STATUSES.has(normalizeStatusKey(pass?.status));
}

function translatePassStatus(status) {
  const key = normalizeStatusKey(status);
  if (!key || key === 'ativo' || key === 'active') return 'Ativo';
  if (key === 'issued') return 'Emitido';
  if (DELETED_PASS_STATUSES.has(key)) return 'Excluído';
  return status;
}

function translateWalletError(error, fallback = 'Não foi possível concluir a operação. Tente novamente.') {
  const code = normalizeStatusKey(error?.error || error?.code);
  if (code && WALLET_FUNCTION_ERROR_MESSAGES[code]) {
    if (code === 'internal_error' || code === 'missing_env') {
      return WALLET_FUNCTION_ERROR_MESSAGES[code];
    }
    return error?.message || WALLET_FUNCTION_ERROR_MESSAGES[code];
  }

  const message = String(error?.message || '').trim();
  const normalizedMessage = normalizeErrorText(message);
  if (!message) return fallback;
  if (normalizedMessage.includes('failed to fetch')) return 'Falha de conexão. Verifique sua internet e tente novamente.';
  if (normalizedMessage.includes('non-2xx') || normalizedMessage.includes('edge function')) return fallback;
  if (normalizedMessage.includes('missing authorization')) return WALLET_FUNCTION_ERROR_MESSAGES.unauthorized;
  if (
    normalizedMessage.includes('permission denied') ||
    normalizedMessage.includes('forbidden') ||
    normalizedMessage.includes('row-level security') ||
    normalizedMessage.includes('new row violates')
  ) return WALLET_FUNCTION_ERROR_MESSAGES.forbidden;
  if (normalizedMessage.includes('duplicate key')) return 'Já existe um registro com estes dados.';
  return message;
}

function normalizeLocationIds(input) {
  if (!Array.isArray(input)) return [];
  const unique = new Set();

  input.forEach((item) => {
    const rawId =
      typeof item === 'string' || typeof item === 'number'
        ? item
        : isObject(item)
          ? item.id ?? item.location_id
          : null;

    const id = String(rawId ?? '').trim();
    if (id) unique.add(id);
  });

  return [...unique];
}

async function invokeWalletFunction(functionName, body) {
  // Keep auth/header handling inside the configured Supabase client.
  // This avoids fragile manual fetches when env URLs contain a trailing slash.
  const { data, error, response } = await supabase.functions.invoke(functionName, { body });

  if (error) {
    const payload = await readSharedFunctionErrorPayload(error, response);
    const message =
      getSharedFunctionErrorMessage(payload, '') ||
      translateWalletError(payload || error, `Falha ao chamar ${functionName}.`);
    const normalizedError = new Error(message);
    normalizedError.code = payload?.code || null;
    normalizedError.status = getFunctionErrorStatus(error, response);
    normalizedError.payload = payload || null;
    throw normalizedError;
  }

  if (data?.ok === false || data?.error) {
    throw new Error(translateWalletError(data, `Falha ao chamar ${functionName}.`));
  }

  return data;
}

async function readFunctionErrorPayload(error) {
  const source = error?.context?.response || error?.context;
  if (!source || typeof source.clone !== 'function') return null;

  try {
    return await source.clone().json();
  } catch (_) {
    try {
      return await source.clone().text();
    } catch {
      return null;
    }
  }
}

function getFunctionErrorMessage(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  return payload.message || payload.error || '';
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

function normalizeLegacyValue(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyProjectWalletDefaults(defaults = {}, projectName = '') {
  const normalized = normalizeWalletDefaults(defaults);
  const safeProjectName = String(projectName ?? '').trim();
  if (!safeProjectName) return normalized;

  const titleValue = normalizeLegacyValue(normalized.title);
  const descriptionValue = normalizeLegacyValue(normalized.description);
  const shouldReplaceTitle = !titleValue || LEGACY_GLOBAL_TITLE_VALUES.has(titleValue);
  const shouldReplaceDescription = !descriptionValue || LEGACY_GLOBAL_DESCRIPTION_VALUES.has(descriptionValue);
  const projectDescription = `Cartão de benefícios ${safeProjectName}`;

  return {
    ...normalized,
    title: shouldReplaceTitle ? safeProjectName : normalized.title,
    description: shouldReplaceDescription ? projectDescription : normalized.description,
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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function isPngFile(file) {
  if (!file || typeof file.slice !== 'function') return false;

  try {
    const headerBuffer = await file.slice(0, PNG_SIGNATURE.length).arrayBuffer();
    const header = new Uint8Array(headerBuffer);

    if (header.length !== PNG_SIGNATURE.length) return false;
    return PNG_SIGNATURE.every((byte, index) => header[index] === byte);
  } catch {
    return false;
  }
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
          className="inline-flex items-center justify-center p-1 text-muted-foreground transition hover:text-foreground"
          aria-label={`Informacoes sobre ${rule.label}`}
        >
          <Info className="h-4 w-4" />
        </button>
        <div className="pointer-events-none absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-border bg-popover p-3 text-left shadow-xl opacity-0 transition duration-75 group-hover:pointer-events-auto group-hover:opacity-100">
          <p className="mb-2 text-sm font-semibold text-popover-foreground">{rule.helpTitle}</p>
          <div className="space-y-1 text-xs text-muted-foreground">
            {rule.helpLines.map((line, index) => (
              <p key={`${uploadKey}-${index}`}>{line}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const PassPreview = ({
  formState,
  qrPreviewUrl,
  sticky = true,
  className = '',
  cardClassName = '',
  cardOverlay = null,
  showPlatformControls = true,
}) => {
  const [platform, setPlatform] = useState('apple');
  const { title = 'Título do Cartão', colors = {}, images = {}, dataFields = [], sampleValues = {}, exp_date } = formState;
  const { background = '#6c5ce7', text = '#ffffff', label = '#ffffff' } = colors;
  const { logo: legacyLogo, appleLogo, googleLogo, googleHero, appleStrip } = images;

  const logoUrl = platform === 'apple' ? (appleLogo || legacyLogo) : (googleLogo || legacyLogo);
  const pointsFieldKey = dataFields.find((f) => String(f?.key || '').toLowerCase().includes('points'))?.key;
  const pointsValue = pointsFieldKey ? (sampleValues[pointsFieldKey] || '123') : '123';
  const expText = `EXPIRA EM ${formatExpPreview(exp_date)}`;
  const qrValue = qrPreviewUrl || formState.qr_url || 'https://example.com';

  return (
    <div className={`${sticky ? 'sticky top-24' : ''} ${className}`.trim()}>
      <div className="relative group w-full max-w-sm mx-auto">
        <div style={{ backgroundColor: background }} className={`w-full rounded-2xl flex flex-col text-white shadow-2xl overflow-hidden ${cardClassName}`.trim()}>
          <div className="p-4 flex flex-col flex-1 min-h-[420px]">
            <header className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="logo"
                    className={platform === 'apple' ? 'max-h-10 max-w-10 object-contain' : 'w-10 h-10 rounded-full object-cover'}
                  />
                ) : <div className="w-10 h-10 rounded-full bg-white/20" />}
                <h3 style={{ color: text }} className="font-bold text-lg">{title}</h3>
              </div>
              <p style={{ color: label }} className="text-xs uppercase font-semibold">{expText}</p>
            </header>

            {platform === 'apple' && (
              appleStrip
                ? <div className="-mx-4 mb-4"><img src={appleStrip} alt="Apple Strip" className="w-full aspect-[375/144] object-cover" /></div>
                : <div className="-mx-4 mb-4"><div className="w-full aspect-[375/144] bg-white/15" /></div>
            )}

            <main className="flex-grow flex flex-col items-start justify-center text-left">
              <p style={{ color: label }} className="text-sm uppercase tracking-wider">Pontos</p>
              <p style={{ color: text }} className="text-4xl leading-none">{pointsValue}</p>
            </main>

            <footer className="mt-6 flex items-center justify-center">
              <div className={platform === 'google' ? 'bg-white p-5 rounded-2xl' : 'bg-white p-2 rounded-md'}>
                <QRCode value={qrValue} size={platform === 'google' ? 150 : 96} quietZone={0} bgColor="transparent" />
              </div>
            </footer>
          </div>

          {platform === 'google' && (
            googleHero ? <img src={googleHero} alt="Google Hero" className="w-full aspect-[3/1] object-cover" /> : <div className="w-full aspect-[3/1] bg-white/15" />
          )}
        </div>
        {cardOverlay}
      </div>

      {showPlatformControls && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button size="sm" variant={platform === 'apple' ? 'default' : 'secondary'} className="rounded-full gap-2" onClick={() => setPlatform('apple')}>
            <Apple className="w-4 h-4" /> Apple
          </Button>
          <Button size="sm" variant={platform === 'google' ? 'default' : 'secondary'} className="rounded-full gap-2" onClick={() => setPlatform('google')}>
            <Smartphone className="w-4 h-4" /> Google
          </Button>
        </div>
      )}
    </div>
  );
};

const PassInventory = ({
  passes,
  loading,
  templateDefaults,
  canManagePasses,
  onAction,
  onEditPass,
  onCreateNewPass,
  onDeletePass,
}) => {
  const { toast } = useToast();
  const [activeIndex, setActiveIndex] = useState(0);
  const qrContainerRef = useRef(null);

  useEffect(() => {
    setActiveIndex((current) => {
      if (passes.length === 0) return 0;
      return Math.min(current, passes.length - 1);
    });
  }, [passes.length]);

  const activePass = passes[activeIndex] || null;
  const hasQrUrl = Boolean(activePass?.qr_url);
  const canGoToPrevious = activeIndex > 0;
  const canGoToNext = activeIndex < passes.length - 1;

  const goToPass = (nextIndex) => {
    if (passes.length <= 1) return;
    const boundedIndex = Math.max(0, Math.min(nextIndex, passes.length - 1));
    setActiveIndex(boundedIndex);
  };

  const handleDownloadQr = (pass) => {
    const container = qrContainerRef.current;
    const canvas = container?.querySelector('canvas');
    if (!canvas) {
      toast({ title: 'QR code indisponivel', variant: 'destructive' });
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
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Meus cartões</h1>
        </div>
        {canManagePasses && (
          <Button onClick={onCreateNewPass} className="gap-2">
            <PlusCircle className="h-4 w-4" />
            Novo cartão
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex min-h-[520px] items-center justify-center rounded-lg border border-dashed">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && passes.length === 0 && (
        <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center">
          <p className="text-sm text-muted-foreground">
            {canManagePasses
              ? 'Crie o primeiro cartão para ele aparecer neste inventário.'
              : 'Nenhum cartão ativo foi criado para este projeto.'}
          </p>
          {canManagePasses && (
            <Button onClick={onCreateNewPass} className="mt-4 gap-2">
              <PlusCircle className="h-4 w-4" />
              Novo cartão
            </Button>
          )}
        </div>
      )}

      {!loading && activePass && (
        <div className="space-y-5">
          <div className="flex flex-col items-center text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <p className="text-lg font-semibold text-foreground">{activePass.title || 'Cartão sem titulo'}</p>
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-300">
                {translatePassStatus(activePass.status)}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Criado em {formatPassCreatedAt(activePass.created_at)}
            </p>
          </div>

          {passes.length > 1 && (
            <div className="flex justify-center gap-2">
              {passes.map((pass, index) => (
                <button
                  key={pass.id}
                  type="button"
                  onClick={() => goToPass(index)}
                  className={`h-2.5 rounded-full transition-all ${index === activeIndex ? 'w-8 bg-purple-600' : 'w-2.5 bg-slate-300 hover:bg-slate-400'}`}
                  aria-label={`Ir para cartão ${index + 1}`}
                />
              ))}
            </div>
          )}

          <div className="relative mx-auto flex min-h-[630px] w-full max-w-4xl items-center justify-center overflow-hidden px-10 sm:px-16">
            {canGoToPrevious && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute left-0 top-1/2 z-20 h-11 w-11 -translate-y-1/2 rounded-full bg-white/95 shadow-lg hover:bg-white"
                onClick={() => goToPass(activeIndex - 1)}
                aria-label="Cartão anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}

            <div className="relative h-[610px] w-full max-w-xl [perspective:900px] [transform-style:preserve-3d]">
              {passes.map((pass, index) => {
                const offset = activeIndex - index;
                const absOffset = Math.abs(offset);
                if (absOffset > MAX_CAROUSEL_VISIBILITY) return null;

                const normalizedOffset = offset / MAX_CAROUSEL_VISIBILITY;
                const normalizedAbsOffset = absOffset / MAX_CAROUSEL_VISIBILITY;
                const offsetDirection = Math.sign(offset);
                const isActive = index === activeIndex;
                const passHasQrUrl = Boolean(pass.qr_url);
                const hasHoverActions = isActive && (canManagePasses || passHasQrUrl);
                const passFormState = passToFormState(pass, templateDefaults);

                return (
                  <div
                    key={pass.id}
                    className="absolute inset-x-0 top-0 mx-auto w-full max-w-sm [transform-style:preserve-3d] transition-[filter,opacity,transform] duration-300 ease-out motion-reduce:transition-none"
                    style={{
                      transform: `rotateY(${normalizedOffset * 50}deg) scaleY(${1 + normalizedAbsOffset * -0.4}) translateZ(${-normalizedAbsOffset * 30}rem) translateX(${offsetDirection * -5}rem)`,
                      filter: `blur(${normalizedAbsOffset * 0.75}rem)`,
                      opacity: absOffset >= MAX_CAROUSEL_VISIBILITY ? 0 : 1,
                      pointerEvents: isActive ? 'auto' : 'none',
                      zIndex: passes.length - absOffset,
                    }}
                  >
                    <PassPreview
                      formState={passFormState}
                      qrPreviewUrl={pass.qr_url}
                      sticky={false}
                      showPlatformControls={isActive}
                      cardClassName={hasHoverActions ? 'transition duration-200 group-hover:grayscale group-hover:brightness-75' : ''}
                      cardOverlay={hasHoverActions ? (
                        <div className="pointer-events-none absolute inset-0 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                          <div className="pointer-events-auto absolute inset-x-5 top-1/2 flex -translate-y-1/2 flex-wrap items-center justify-center gap-2">
                            {passHasQrUrl && (
                              <>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className={`${HOVER_ACTION_BUTTON_CLASS} bg-white text-slate-900 hover:bg-slate-100`}
                                  onClick={() => onAction('copy', pass.qr_url)}
                                >
                                  <LinkIcon className="h-4 w-4" />
                                  Copiar link
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className={`${HOVER_ACTION_BUTTON_CLASS} bg-white text-slate-900 hover:bg-slate-100`}
                                  onClick={() => handleDownloadQr(pass)}
                                >
                                  <Download className="h-4 w-4" />
                                  Baixar QR
                                </Button>
                              </>
                            )}
                            {canManagePasses && (
                              <Button
                                type="button"
                                className={`${HOVER_ACTION_BUTTON_CLASS} bg-slate-900 text-white hover:bg-slate-800`}
                                onClick={() => onEditPass(pass)}
                              >
                                <Edit3 className="h-4 w-4" />
                                Editar
                              </Button>
                            )}
                          </div>
                          {canManagePasses && (
                            <div className="pointer-events-auto absolute inset-x-5 bottom-6 flex justify-center">
                              <Button
                                type="button"
                                variant="outline"
                                className={`${HOVER_ACTION_BUTTON_CLASS} border-red-600 bg-red-600 text-white hover:bg-red-700 hover:text-white`}
                                onClick={() => onDeletePass(pass)}
                              >
                                <Trash2 className="h-4 w-4" />
                                Excluir
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : null}
                    />
                  </div>
                );
              })}
            </div>

            {canGoToNext && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute right-0 top-1/2 z-20 h-11 w-11 -translate-y-1/2 rounded-full bg-white/95 shadow-lg hover:bg-white"
                onClick={() => goToPass(activeIndex + 1)}
                aria-label="Proximo cartão"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            )}
          </div>

          {hasQrUrl && (
            <div ref={qrContainerRef} className="absolute -left-[9999px] top-0">
              <QRCode value={activePass.qr_url} size={140} quietZone={0} bgColor="transparent" />
            </div>
          )}
        </div>
      )}
    </section>
  );
};

const PassEditorPanel = ({
  isEditingPass,
  readOnly = false,
  formState,
  activeLocationIds,
  isProcessing,
  fileInputRef,
  onFormChange,
  onUploadClick,
  onFileChange,
  onOpenLocations,
  onSave,
  onGenerateLink,
}) => (
  <div className="space-y-8">
    <div className="space-y-4 p-4 border rounded-lg">
      <h2 className="font-semibold text-lg flex items-center gap-2">
        <Settings className="w-5 h-5 text-purple-500" />
        {isEditingPass ? 'Editar cartão' : 'Novo cartão'}
      </h2>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <Label>Tipo</Label>
            <Select value={formState.type} onValueChange={(v) => onFormChange('type', v)} disabled={readOnly || isProcessing}>
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
            <Label>Titulo</Label>
            <Input value={formState.title} maxLength={16} onChange={(e) => onFormChange('title', e.target.value)} placeholder="Ex: Cartao" disabled={readOnly || isProcessing} />
            {String(formState.title || '').length >= 16 && (
              <p className="mt-1 text-xs text-amber-600">Limite de caracteres atingido.</p>
            )}
          </div>

          <div>
            <Label>Descricao</Label>
            <Textarea value={formState.description} onChange={(e) => onFormChange('description', e.target.value)} placeholder="Ex: Complete 10 visitas e ganhe um cafe." disabled={readOnly || isProcessing} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <ColorInput label="Fundo" value={formState.colors.background} onChange={(e) => onFormChange('colors.background', e.target.value)} disabled={readOnly || isProcessing} />
            <ColorInput label="Rotulo" value={formState.colors.label} onChange={(e) => onFormChange('colors.label', e.target.value)} disabled={readOnly || isProcessing} />
            <ColorInput label="Texto" value={formState.colors.text} onChange={(e) => onFormChange('colors.text', e.target.value)} disabled={readOnly || isProcessing} />
          </div>

          {!readOnly && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <UploadButtonWithInfo uploadKey="appleLogo" onUpload={onUploadClick} />
                <UploadButtonWithInfo uploadKey="googleLogo" onUpload={onUploadClick} />
                <UploadButtonWithInfo uploadKey="appleStrip" onUpload={onUploadClick} />
                <UploadButtonWithInfo uploadKey="googleHero" onUpload={onUploadClick} />
              </div>
              <div className="md:max-w-[calc(50%-0.375rem)]">
                <UploadButtonWithInfo uploadKey="icon" onUpload={onUploadClick} />
              </div>
            </div>
          )}

          {!readOnly && (
            <Button type="button" variant="outline" className="w-full justify-start" onClick={onOpenLocations}>
              <MapPin className="mr-2 h-4 w-4" />
              Adicionar localizacao ({activeLocationIds.length} {activeLocationIds.length === 1 ? 'selecionada' : 'selecionadas'})
            </Button>
          )}

          <input type="file" ref={fileInputRef} onChange={onFileChange} className="hidden" accept=".png,image/png" />
        </div>
      </div>
    </div>

    {!readOnly && (
      <div className="flex flex-wrap justify-center items-center gap-4 py-6">
        <Button size="lg" onClick={onSave} disabled={isProcessing} variant="outline">
          {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {isProcessing ? 'Salvando...' : 'Salvar alteracoes'}
        </Button>

        {!isEditingPass && (
          <Button size="lg" onClick={onGenerateLink} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LinkIcon className="mr-2 h-4 w-4" />}
            {isProcessing ? 'Gerando...' : 'Gerar Link Unico'}
          </Button>
        )}
      </div>
    )}
  </div>
);

const WalletConfigTab = ({ projectId, onBack }) => {
  const { toast } = useToast();
  const { user, role } = useAuth();
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
  const [walletView, setWalletView] = useState('inventory');
  const [selectedPassLocationIds, setSelectedPassLocationIds] = useState([]);
  const [draftLocationIds, setDraftLocationIds] = useState([]);
  const [passLocationsByPassId, setPassLocationsByPassId] = useState({});
  const [uploadingKey, setUploadingKey] = useState(null);
  const [projectMemberRole, setProjectMemberRole] = useState(null);
  const [passToDelete, setPassToDelete] = useState(null);
  const fileInputRef = useRef(null);

  const canManagePasses = role === 'superadmin' || role === 'admin' || projectMemberRole === 'owner';
  const isReadOnly = !canManagePasses;
  const isEditingPass = walletView === 'edit' && Boolean(selectedPass?.id);
  const isCreatingPass = walletView === 'new';
  const isEditorOpen = isEditingPass || isCreatingPass;
  const activeLocationIds = isEditingPass ? selectedPassLocationIds : draftLocationIds;
  const canGoBackToProjects = typeof onBack === 'function';

  const showManagePermissionToast = () => {
    toast({
      title: 'Acesso somente leitura',
      description: 'Funcionários podem apenas visualizar cartões. Peça a um gestor para alterar cartões.',
      variant: 'destructive',
    });
  };

  const updateLocationSelection = useCallback((ids) => {
    if (isReadOnly) return;
    const normalized = normalizeLocationIds(ids);
    if (isEditingPass && selectedPass?.id) {
      setSelectedPassLocationIds(normalized);
      setPassLocationsByPassId((prev) => ({ ...prev, [selectedPass.id]: normalized }));
      return;
    }
    setDraftLocationIds(normalized);
  }, [isEditingPass, isReadOnly, selectedPass]);

  useEffect(() => {
    let cancelled = false;
    setProjectMemberRole(null);

    if (!projectId || !user?.id) return undefined;

    async function loadProjectMemberRole() {
      const { data, error } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;
      setProjectMemberRole(error ? null : data?.role || null);
    }

    loadProjectMemberRole();

    return () => {
      cancelled = true;
    };
  }, [projectId, user?.id]);

  const fetchPasses = useCallback(async (pId) => {
    if (!pId) return;
    setLoadingPasses(true);
    try {
      const { data, error } = await supabase
        .from('passes')
        .select('id, project_id, type, title, description, status, qr_url, created_at, fields, design, deleted_at')
        .eq('project_id', pId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data || []).filter((row) => !isDeletedPass(row));
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
      toast({ title: 'Erro ao buscar cartões', description: error.message, variant: 'destructive' });
    } finally {
      setLoadingPasses(false);
    }
  }, [toast]);

  const loadWalletDefaults = useCallback(async (pId) => {
    setIsProcessing(true);
    try {
      const { data: projectData, error: projectError } = await supabase.from('projects').select('slug, name').eq('id', pId).single();
      if (projectError) throw projectError;
      setProjectSlug(projectData.slug || '');
      const projectDisplayName = String(projectData?.name ?? '').trim();

      const fromProject = await supabase.from('wallet_templates').select('defaults').eq('project_id', pId).maybeSingle();
      let defaults = fromProject.data?.defaults;
      if (!defaults) {
        const { data: globalData, error: globalError } = await supabase.from('wallet_templates').select('defaults').is('project_id', null).single();
        if (globalError) throw globalError;
        defaults = globalData?.defaults ?? {};
      }

      const merged = mergeWithInitial(applyProjectWalletDefaults(defaults, projectDisplayName));
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
    setWalletView('inventory');
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
    if (isReadOnly) return;

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
    if (!canManagePasses) {
      showManagePermissionToast();
      return;
    }

    setUploadingKey(key);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    if (!canManagePasses) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadingKey(null);
      showManagePermissionToast();
      return;
    }

    const file = event.target.files?.[0];
    if (!file || !uploadingKey) return;
    const rule = IMAGE_UPLOAD_RULES[uploadingKey];

    const isValidPng = await isPngFile(file);
    if (!isValidPng) {
      toast({ title: 'Formato inválido', description: `O campo "${rule?.label ?? uploadingKey}" aceita apenas PNG.`, variant: 'destructive' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadingKey(null);
      return;
    }

    setIsProcessing(true);
    const originalBaseName = sanitizeFilenamePart(file.name.replace(/\.[^.]+$/, '') || uploadingKey);
    const path = `${projectId || 'temp'}/${uploadingKey}-${Date.now()}-${originalBaseName}.png`;
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
    if (!canManagePasses) {
      showManagePermissionToast();
      return;
    }
    if (isDeletedPass(pass)) {
      toast({
        title: 'Cartão indisponível',
        description: 'Este cartão foi excluído e não pode ser editado.',
        variant: 'destructive',
      });
      return;
    }

    setGenerationResult(null);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    let resolvedPass = pass;
    if (pass.design === undefined || pass.fields === undefined) {
      try {
        const { data: passRow, error: passError } = await supabase
          .from('passes')
          .select('id, project_id, type, title, description, status, qr_url, created_at, fields, design, deleted_at')
          .eq('id', pass.id)
          .eq('project_id', projectId)
          .is('deleted_at', null)
          .single();

        if (passError) throw passError;
        resolvedPass = { ...pass, ...(passRow || {}) };
      } catch (error) {
        toast({
          title: 'Erro ao carregar dados completos do cartão',
          description: error.message,
          variant: 'destructive',
        });
      }
    }

    setSelectedPass(resolvedPass);
    setFormState(passToFormState(resolvedPass, templateDefaults));
    setWalletView('edit');

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
      toast({ title: 'Erro ao carregar localizações do cartão', description: error.message, variant: 'destructive' });
      setSelectedPassLocationIds([]);
    }
  };

  const handleCreateNewPass = () => {
    if (!canManagePasses) {
      showManagePermissionToast();
      return;
    }

    setSelectedPass(null);
    setWalletView('new');
    setSelectedPassLocationIds([]);
    setDraftLocationIds([]);
    setGenerationResult(null);
    setFormState(mergeWithInitial(templateDefaults));
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBackToPasses = () => {
    setSelectedPass(null);
    setWalletView('inventory');
    setSelectedPassLocationIds([]);
    setDraftLocationIds([]);
    setGenerationResult(null);
    setFormState(mergeWithInitial(templateDefaults));
  };

  const handleGenerateLink = async () => {
    if (!canManagePasses) {
      showManagePermissionToast();
      return;
    }

    setIsProcessing(true);
    try {
      const design = buildDesignPayload(formState);
      const normalizedLocationIds = normalizeLocationIds([
        ...activeLocationIds,
        ...draftLocationIds,
        ...selectedPassLocationIds,
      ]);
      const body = {
        project_id: projectId,
        project_slug: projectSlug,
        type: formState.type,
        title: formState.title,
        description: formState.description,
        fields: buildFieldsPayload(formState),
        colors: design.colors,
        images: design.images,
        location_ids: normalizedLocationIds,
        pass_data: { location_ids: normalizedLocationIds },
        app_base_url: window.location.origin,
      };

      const result = await invokeWalletFunction('create-pass', body);

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
    if (!canManagePasses) {
      showManagePermissionToast();
      return;
    }

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
    if (!canManagePasses) {
      showManagePermissionToast();
      return;
    }

    const confirmed = window.confirm('Essas mudanças também irão alterar os cartões que já estão na carteira dos clientes, deseja confirmar a operação?');
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

      const result = await invokeWalletFunction('update-pass', body);

      const sync = result?.sync || {};
      const queuedJobs = sync?.total_jobs ?? result?.pushes?.queued ?? 0;
      toast({
        title: 'Cartão atualizado com sucesso.',
        description: queuedJobs > 0
          ? 'Sincronização com as carteiras em andamento.'
          : 'Não havia carteiras instaladas para sincronizar.',
        variant: 'default',
      });

      setPassLocationsByPassId((prev) => ({ ...prev, [selectedPass.id]: selectedPassLocationIds }));
      await fetchPasses(projectId);

      const mergedPass = { ...selectedPass, ...(result?.pass || {}) };
      setSelectedPass(mergedPass);
      setFormState(passToFormState(mergedPass, templateDefaults));
    } catch (error) {
      toast({ title: 'Erro ao atualizar cartão', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!canManagePasses) {
      showManagePermissionToast();
      return;
    }

    if (isEditingPass) {
      await handleUpdatePass();
      return;
    }
    await handleSaveTemplate();
  };

  const handlePassesListAction = async (action, url) => {
    if (!url) {
      toast({ title: 'Link indisponível', variant: 'destructive' });
      return;
    }
    if (action === 'copy') {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          const textArea = document.createElement('textarea');
          textArea.value = url;
          textArea.setAttribute('readonly', '');
          textArea.style.position = 'fixed';
          textArea.style.opacity = '0';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
        toast({ title: 'Link copiado.' });
      } catch (error) {
        toast({ title: 'Erro ao copiar link', description: error.message, variant: 'destructive' });
      }
      return;
    }
    window.open(url, '_blank');
  };

  const handleDeletePassRequest = (pass) => {
    if (!pass?.id) return;
    if (!canManagePasses) {
      showManagePermissionToast();
      return;
    }

    setPassToDelete(pass);
  };

  const handleConfirmDeletePass = async () => {
    if (!passToDelete?.id) return;
    if (!canManagePasses) {
      setPassToDelete(null);
      showManagePermissionToast();
      return;
    }

    const deletingPass = passToDelete;
    setIsProcessing(true);
    try {
      await invokeWalletFunction('delete-pass', {
        project_id: projectId,
        pass_id: deletingPass.id,
      });

      toast({
        title: 'Cartão excluído',
        description: `${deletingPass.title || 'Cartão'} foi removido da operação.`,
      });
      setPassToDelete(null);

      if (selectedPass?.id === deletingPass.id) {
        handleBackToPasses();
      }

      await fetchPasses(projectId);
    } catch (error) {
      toast({
        title: 'Erro ao excluir cartão',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const deletePassDialog = (
    <AlertDialog
      open={!!passToDelete}
      onOpenChange={(open) => {
        if (!open && !isProcessing) setPassToDelete(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir cartão?</AlertDialogTitle>
          <AlertDialogDescription>
            O cartão "{passToDelete?.title || 'sem título'}" será removido da operação. Instalações e histórico permanecem preservados.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              handleConfirmDeletePass();
            }}
            disabled={isProcessing}
            className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
          >
            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (!isEditorOpen) {
    return (
      <div className="p-4 md:p-6 lg:p-8">
        {canGoBackToProjects && (
          <div className="mb-6 flex justify-start">
            <Button
              onClick={onBack}
              className="bg-purple-600 text-white hover:bg-purple-700 focus-visible:ring-purple-500"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Voltar aos Projetos
            </Button>
          </div>
        )}

        <PassInventory
          passes={passes}
          loading={loadingPasses}
          templateDefaults={templateDefaults}
          canManagePasses={canManagePasses}
          onAction={handlePassesListAction}
          onEditPass={handleSelectPass}
          onCreateNewPass={handleCreateNewPass}
          onDeletePass={handleDeletePassRequest}
        />

        <GenerationResultModal isOpen={isModalOpen} setIsOpen={setIsModalOpen} result={generationResult} />
        {deletePassDialog}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-6 space-y-3">
        {isEditingPass && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            <p className="text-sm font-medium">
              Editando cartão criado em {formatPassCreatedAt(selectedPass?.created_at)}.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">{isEditingPass ? 'Editar cartão' : 'Novo cartão'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isEditingPass ? 'Ajuste o cartão selecionado e salve as mudancas.' : 'Monte um novo cartão usando o template do projeto.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleBackToPasses} disabled={isProcessing}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Voltar para meus cartões
            </Button>
            {canGoBackToProjects && (
              <Button
                onClick={onBack}
                className="bg-purple-600 text-white hover:bg-purple-700 focus-visible:ring-purple-500"
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Voltar aos Projetos
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        <motion.div
          key={`${walletView}-editor`}
          initial={{ opacity: 0, x: -64 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="lg:col-span-2"
        >
          <PassEditorPanel
            isEditingPass={isEditingPass}
            readOnly={isReadOnly}
            formState={formState}
            activeLocationIds={activeLocationIds}
            isProcessing={isProcessing}
            fileInputRef={fileInputRef}
            onFormChange={handleFormChange}
            onUploadClick={handleUploadClick}
            onFileChange={handleFileChange}
            onOpenLocations={() => setIsLocationsModalOpen(true)}
            onSave={handleSave}
            onGenerateLink={handleGenerateLink}
          />
        </motion.div>

        <motion.div
          layoutId="wallet-pass-preview"
          initial={{ opacity: 0, x: -140 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.42, ease: 'easeOut' }}
          className="lg:col-span-1"
        >
          <PassPreview formState={formState} qrPreviewUrl={generationResult?.qr_url || formState.qr_url} />
        </motion.div>
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
            readOnly={isReadOnly}
          />
        </DialogContent>
      </Dialog>

      <GenerationResultModal isOpen={isModalOpen} setIsOpen={setIsModalOpen} result={generationResult} />
      {deletePassDialog}
    </div>
  );
};
export default WalletConfigTab;

