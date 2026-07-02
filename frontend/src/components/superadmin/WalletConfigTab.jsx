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
  Check,
  Link as LinkIcon,
  Settings,
  Download,
  Info,
  MapPin,
  Minus,
  Plus,
  PlusCircle,
  Edit3,
  Trash2,
  Palette,
  Image as ImageIcon,
  X,
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
    label: 'Ícone Apple',
    helpTitle: 'Ícone Apple',
    assetSpec: 'PNG · 87×87px',
    helpLines: ['Logo que aparece na notificação do seu cartão', 'Obrigatório: PNG', 'Proporção recomendada: 1:1'],
    recommendedRatio: 1,
    recommendedRatioLabel: '1:1',
  },
  appleLogo: {
    label: 'Logo Apple',
    helpTitle: 'Logo Apple',
    assetSpec: 'PNG · 160×50px',
    helpLines: ['Obrigatório: PNG', 'Tamanho recomendado: 160×50px'],
  },
  googleLogo: {
    label: 'Logo Google',
    helpTitle: 'Logo Google',
    assetSpec: 'PNG · 660×660px',
    helpLines: ['Obrigatório: PNG', 'Tamanho recomendado: 660×660px'],
    recommendedRatio: 1,
    recommendedRatioLabel: '1:1',
  },
  appleStrip: {
    label: 'Apple Strip',
    helpTitle: 'Apple Strip',
    assetSpec: 'PNG · 1125×432px',
    helpLines: ['Obrigatório: PNG', 'Tamanho recomendado: 1125×432px', 'Altura máxima: 432px'],
    recommendedRatio: 375 / 144,
    recommendedRatioLabel: '375:144',
  },
  googleHero: {
    label: 'Hero Google',
    helpTitle: 'Hero Google',
    assetSpec: 'PNG · 1032×336px',
    helpLines: ['Obrigatório: PNG', 'Tamanho recomendado: 1032×336px'],
    recommendedRatio: 3,
    recommendedRatioLabel: '3:1',
  },
};
const DEFAULT_EXPIRATION_MONTHS = 1;
const MIN_EXPIRATION_MONTHS = 1;
const MAX_EXPIRATION_MONTHS = 60;
const INTERNAL_PASS_FIELD_KEYS = new Set(['exp_date', 'expiration_months']);
const EDITOR_CARD_STYLE = {
  border: '0.5px solid var(--color-border-tertiary, hsl(var(--border)))',
  borderRadius: 'var(--border-radius-md, calc(var(--radius) - 2px))',
};
const ACTION_BUTTON_STYLE = {
  borderRadius: 'var(--border-radius-md, calc(var(--radius) - 2px))',
};

const INITIAL_FORM_STATE = {
  type: 'loyalty',
  title: '',
  description: '',
  exp_date: '',
  expiration_months: DEFAULT_EXPIRATION_MONTHS,
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

const PASS_TYPE_OPTIONS = [
  { value: 'loyalty', label: 'Fidelidade' },
  { value: 'value', label: 'Valor' },
];

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

function normalizePassType(value) {
  return String(value ?? '').trim().toLowerCase() === 'value' ? 'value' : 'loyalty';
}

function formatCurrencyCents(cents) {
  const parsed = Number(cents);
  const normalizedCents = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(normalizedCents / 100);
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

function omitInternalPassFields(values = {}) {
  const source = toObject(values);
  const cleaned = {};
  Object.keys(source).forEach((key) => {
    if (!INTERNAL_PASS_FIELD_KEYS.has(key)) cleaned[key] = source[key];
  });
  return cleaned;
}

function normalizeDataFields(fields = []) {
  if (!Array.isArray(fields)) return [];
  return fields.filter((field) => !INTERNAL_PASS_FIELD_KEYS.has(String(field?.key ?? '')));
}

function normalizeExpirationMonths(value, fallback = DEFAULT_EXPIRATION_MONTHS) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  const fallbackParsed = Number.parseInt(String(fallback ?? DEFAULT_EXPIRATION_MONTHS), 10);
  const base = Number.isFinite(parsed)
    ? parsed
    : Number.isFinite(fallbackParsed)
      ? fallbackParsed
      : DEFAULT_EXPIRATION_MONTHS;

  return Math.min(MAX_EXPIRATION_MONTHS, Math.max(MIN_EXPIRATION_MONTHS, base));
}

function addMonthsClamped(date, months) {
  const source = new Date(date);
  if (Number.isNaN(source.getTime())) return new Date();

  const monthOffset = normalizeExpirationMonths(months);
  const year = source.getFullYear();
  const month = source.getMonth() + monthOffset;
  const day = source.getDate();
  const daysInTargetMonth = new Date(year, month + 1, 0).getDate();
  const next = new Date(source.getTime());

  next.setFullYear(year, month, Math.min(day, daysInTargetMonth));
  return next;
}

function getEstimatedExpirationDate(expirationMonths) {
  return addMonthsClamped(new Date(), expirationMonths);
}

function mergeWithInitial(defaults = {}) {
  const normalized = normalizeWalletDefaults(defaults);
  const normalizedFields = toObject(normalized.fields);
  return {
    ...INITIAL_FORM_STATE,
    ...normalized,
    type: normalizePassType(normalized.type),
    colors: {
      ...INITIAL_FORM_STATE.colors,
      ...toObject(normalized.colors),
    },
    images: {
      ...INITIAL_FORM_STATE.images,
      ...toObject(normalized.images),
    },
    dataFields: normalizeDataFields(normalized.dataFields),
    sampleValues: omitInternalPassFields(normalized.sampleValues),
    qr_url: normalized.qr_url ?? '',
    expiration_months: normalizeExpirationMonths(
      normalized.expiration_months ?? normalizedFields.expiration_months,
      INITIAL_FORM_STATE.expiration_months,
    ),
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

function formatLocationCoordinate(value) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate.toFixed(6) : null;
}

function formatLocationCoordinates(location) {
  const lat = formatLocationCoordinate(location?.lat);
  const lng = formatLocationCoordinate(location?.lng ?? location?.long);
  return lat && lng ? `${lat}, ${lng}` : 'Coordenadas não definidas';
}

function getLocationDisplayName(location, fallback) {
  const label = String(location?.label ?? '').trim();
  if (label) return label;

  const address = String(location?.address ?? '').trim();
  return address || fallback;
}

function buildFieldsPayload(formState) {
  const sampleValues = omitInternalPassFields(formState.sampleValues);
  const fields = { ...sampleValues };
  if (formState.exp_date) fields.exp_date = formState.exp_date;
  fields.expiration_months = normalizeExpirationMonths(formState.expiration_months);
  return fields;
}

function buildDesignPayload(formState) {
  return {
    colors: toObject(formState.colors),
    images: normalizeWalletDefaults({ images: formState.images }).images,
    dataFields: normalizeDataFields(formState.dataFields),
  };
}

function passToFormState(pass, templateDefaults) {
  const defaults = mergeWithInitial(templateDefaults);
  const design = toObject(pass?.design);
  const fields = toObject(pass?.fields);

  const designDataFields = normalizeDataFields(design.dataFields);
  const dataFields = designDataFields.length > 0
    ? designDataFields
    : Object.keys(fields)
      .filter((key) => !INTERNAL_PASS_FIELD_KEYS.has(key))
      .map((key) => ({ key, label: key }));

  const sampleValues = {};
  Object.keys(fields).forEach((key) => {
    if (INTERNAL_PASS_FIELD_KEYS.has(key)) return;
    sampleValues[key] = fields[key];
  });

  return {
    ...defaults,
    type: normalizePassType(pass?.type || defaults.type),
    title: pass?.title || defaults.title,
    description: pass?.description || defaults.description,
    exp_date: fields.exp_date || defaults.exp_date || '',
    expiration_months: normalizeExpirationMonths(fields.expiration_months, defaults.expiration_months),
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

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

function isValidHexColor(value) {
  return HEX_COLOR_PATTERN.test(String(value ?? '').trim());
}

function getPreviewColor(value, fallback) {
  const normalized = String(value ?? '').trim();
  return isValidHexColor(normalized) ? normalized : fallback;
}

function validateEditorForm(values = {}) {
  const errors = {};
  const expirationRaw = String(values.expiration_months ?? '').trim();
  const expirationValue = Number.parseInt(expirationRaw, 10);

  if (!String(values.type ?? '').trim()) {
    errors.type = 'Selecione um tipo.';
  }

  if (!String(values.title ?? '').trim()) {
    errors.title = 'Informe o título do passe.';
  }

  if (!expirationRaw || !Number.isFinite(expirationValue)) {
    errors.expiration_months = 'Informe a validade.';
  } else if (expirationValue < MIN_EXPIRATION_MONTHS || expirationValue > MAX_EXPIRATION_MONTHS) {
    errors.expiration_months = `Use um valor entre ${MIN_EXPIRATION_MONTHS} e ${MAX_EXPIRATION_MONTHS}.`;
  }

  return errors;
}

const EditorSection = ({ icon: Icon, title, optional = false, children, onActivate, className = '', bodyClassName = '' }) => (
  <section
    className={`overflow-hidden bg-white shadow-sm ${className}`.trim()}
    style={EDITOR_CARD_STYLE}
    onFocusCapture={onActivate}
    onClickCapture={onActivate}
  >
    <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#534AB7]/10 text-[#534AB7]">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <h2 className="text-sm font-medium text-slate-900">{title}</h2>
      {optional && (
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">opcional</span>
      )}
    </header>
    <div className={`p-3 ${bodyClassName}`.trim()}>{children}</div>
  </section>
);

const ColorInput = ({ label, value, onChange, disabled }) => {
  const currentValue = value ?? '';
  const hasInvalidValue = Boolean(String(currentValue).trim()) && !isValidHexColor(currentValue);
  const swatchColor = getPreviewColor(currentValue, '#f8fafc');

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[12px] font-medium text-slate-700">{label}</Label>
      <div
        className={`flex h-8 items-center gap-2 rounded-md border bg-white px-2 transition ${hasInvalidValue ? 'border-red-300' : 'border-slate-200 focus-within:border-[#534AB7] focus-within:ring-1 focus-within:ring-[#534AB7]/30'}`}
      >
        <div
          className="h-4 w-4 shrink-0 rounded border border-slate-200 shadow-inner"
          style={{ backgroundColor: swatchColor }}
          aria-hidden="true"
        />
        <Input
          type="text"
          value={currentValue}
          onChange={onChange}
          disabled={disabled}
          spellCheck={false}
          aria-invalid={hasInvalidValue}
          placeholder="#534AB7"
          className="h-7 border-0 bg-transparent px-0 font-mono text-[12px] uppercase text-slate-900 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
    </div>
  );
};

const UploadButtonWithInfo = ({ uploadKey, value, onUpload, disabled = false, className = '' }) => {
  const rule = IMAGE_UPLOAD_RULES[uploadKey];
  const hasValue = Boolean(String(value ?? '').trim());
  const Icon = hasValue ? Check : Upload;

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      style={ACTION_BUTTON_STYLE}
      className={`h-auto min-h-[78px] w-full flex-col items-center justify-center gap-1.5 whitespace-normal px-[14px] py-[6px] text-center transition ${hasValue ? 'border border-[#534AB7] bg-[#534AB7]/5 text-[#534AB7] hover:bg-[#534AB7]/10' : 'border border-dashed border-slate-300 bg-white text-slate-700 hover:border-[#534AB7] hover:bg-purple-50/70'} ${className}`.trim()}
      onClick={() => onUpload(uploadKey)}
    >
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${hasValue ? 'bg-[#534AB7] text-white' : 'bg-slate-100 text-slate-500'}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="space-y-0.5">
        <span className="block text-[12px] font-semibold leading-tight">{rule.label}</span>
        <span className="block text-[10px] font-normal leading-tight text-slate-500">{rule.assetSpec}</span>
      </span>
    </Button>
  );
};

const UploadPlatformGroup = ({ icon: Icon, title, children }) => (
  <div className="space-y-2 bg-slate-50/60 p-2.5" style={EDITOR_CARD_STYLE}>
    <div className="flex items-center gap-2 text-slate-800">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#534AB7]/10 text-[#534AB7]">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <h3 className="text-[12px] font-medium">{title}</h3>
    </div>
    <div className="grid grid-cols-2 gap-2">{children}</div>
  </div>
);

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
  const {
    title = 'Título do Cartão',
    colors = {},
    images = {},
    dataFields = [],
    sampleValues = {},
    exp_date,
    expiration_months,
  } = formState;
  const { background = '#6c5ce7', text = '#ffffff', label = '#ffffff' } = colors;
  const backgroundColor = getPreviewColor(background, INITIAL_FORM_STATE.colors.background);
  const textColor = getPreviewColor(text, INITIAL_FORM_STATE.colors.text);
  const labelColor = getPreviewColor(label, INITIAL_FORM_STATE.colors.label);
  const displayTitle = String(title || '').trim() || 'Título do Cartão';
  const { logo: legacyLogo, appleLogo, googleLogo, googleHero, appleStrip } = images;

  const logoUrl = platform === 'apple' ? (appleLogo || legacyLogo) : (googleLogo || legacyLogo);
  const passType = normalizePassType(formState.type);
  const pointsFieldKey = dataFields.find((f) => String(f?.key || '').toLowerCase().includes('points'))?.key;
  const pointsValue = pointsFieldKey ? (sampleValues[pointsFieldKey] || '123') : '123';
  const balanceValue = formatCurrencyCents(sampleValues.balance_cents ?? 12345);
  const metricLabel = passType === 'value' ? 'Saldo' : 'Pontos';
  const metricValue = passType === 'value' ? balanceValue : pointsValue;
  const displayExpDate = exp_date || getEstimatedExpirationDate(expiration_months);
  const expText = `EXPIRA EM ${formatExpPreview(displayExpDate)}`;
  const uniqueLink = qrPreviewUrl || formState.qr_url || '';
  const qrValue = uniqueLink || 'https://example.com';

  const platformButtonClass = (targetPlatform) => (
    `h-auto gap-1.5 px-[14px] py-[6px] text-[12px] font-medium ${platform === targetPlatform ? 'bg-[#534AB7] text-white hover:bg-[#463e9f]' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`
  );

  return (
    <div className={`${sticky ? 'sticky top-0' : ''} ${className}`.trim()}>
      <div className="mx-auto mb-3 flex w-full max-w-[330px] items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase text-slate-400">Pré-visualização</p>
        {showPlatformControls && (
          <div className="inline-flex items-center rounded-md bg-slate-100 p-1">
            <Button
              type="button"
              variant="ghost"
              style={ACTION_BUTTON_STYLE}
              className={platformButtonClass('apple')}
              onClick={() => setPlatform('apple')}
              aria-pressed={platform === 'apple'}
            >
              <Apple className="h-3.5 w-3.5" />
              Apple
            </Button>
            <Button
              type="button"
              variant="ghost"
              style={ACTION_BUTTON_STYLE}
              className={platformButtonClass('google')}
              onClick={() => setPlatform('google')}
              aria-pressed={platform === 'google'}
            >
              <Smartphone className="h-3.5 w-3.5" />
              Google
            </Button>
          </div>
        )}
      </div>

      <div className="relative group mx-auto w-full max-w-[330px]">
        <div style={{ backgroundColor }} className={`w-full rounded-2xl flex flex-col text-white shadow-2xl overflow-hidden ${cardClassName}`.trim()}>
          <div className="flex min-h-[420px] flex-1 flex-col p-4">
            <header className="mb-4 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="logo"
                    className={platform === 'apple' ? 'max-h-10 max-w-10 shrink-0 object-contain' : 'h-10 w-10 shrink-0 rounded-full object-cover'}
                  />
                ) : <div className="h-10 w-10 shrink-0 rounded-full bg-white/20" />}
                <h3 style={{ color: textColor }} className="min-w-0 truncate text-lg font-bold">{displayTitle}</h3>
              </div>
              <p style={{ color: labelColor }} className="shrink-0 text-right text-[10px] font-semibold uppercase leading-tight">{expText}</p>
            </header>

            {platform === 'apple' && (
              appleStrip
                ? <div className="-mx-4 mb-4"><img src={appleStrip} alt="Apple Strip" className="aspect-[375/144] w-full object-cover" /></div>
                : <div className="-mx-4 mb-4"><div className="aspect-[375/144] w-full bg-white/15" /></div>
            )}

            <main className="flex flex-grow flex-col items-start justify-center text-left">
              <p style={{ color: labelColor }} className="text-[12px] uppercase tracking-wide">{metricLabel}</p>
              <p style={{ color: textColor }} className="text-4xl leading-none">{metricValue}</p>
            </main>

            <footer className="mt-6 flex items-center justify-center">
              <div className={platform === 'google' ? 'rounded-2xl bg-white p-4' : 'rounded-md bg-white p-2'}>
                <QRCode value={qrValue} size={platform === 'google' ? 136 : 96} quietZone={0} bgColor="transparent" />
              </div>
            </footer>
          </div>

          {platform === 'google' && (
            googleHero ? <img src={googleHero} alt="Google Hero" className="aspect-[3/1] w-full object-cover" /> : <div className="aspect-[3/1] w-full bg-white/15" />
          )}
        </div>
        {cardOverlay}
      </div>

      {uniqueLink && (
        <div
          className="mx-auto mt-3 max-w-[330px] px-3 py-2"
          style={{ ...EDITOR_CARD_STYLE, backgroundColor: 'var(--background-secondary, hsl(var(--secondary)))' }}
        >
          <p className="text-[10px] font-medium uppercase text-slate-500">Link único</p>
          <p className="truncate text-[12px] font-medium text-slate-800" title={uniqueLink}>{uniqueLink}</p>
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="space-y-3">
          <div className="flex flex-col items-center text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <p className="text-lg font-semibold text-foreground">{activePass.title || 'Cartão sem titulo'}</p>
              <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-300">
                {translatePassStatus(activePass.status)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
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
  readOnly = false,
  formState,
  activeLocationIds = [],
  locationsById = {},
  isProcessing,
  fileInputRef,
  validationErrors = {},
  setValidationErrors,
  onFormChange,
  onUploadClick,
  onFileChange,
  onOpenLocations,
  onLocationIdsChange,
  onStepChange,
}) => {
  const expirationMonthsValue = formState.expiration_months ?? '';
  const currentExpirationMonths = normalizeExpirationMonths(formState.expiration_months);
  const expirationControlDisabled = readOnly || isProcessing;
  const canDecreaseExpiration = currentExpirationMonths > MIN_EXPIRATION_MONTHS;
  const canIncreaseExpiration = currentExpirationMonths < MAX_EXPIRATION_MONTHS;
  const hasLocations = activeLocationIds.length > 0;

  const activateStep = (step) => {
    onStepChange?.(step);
  };

  const clearValidationError = (field) => {
    setValidationErrors?.((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleFieldChange = (path, value) => {
    onFormChange(path, value);
    if (path === 'type' || path === 'title' || path === 'expiration_months') {
      clearValidationError(path);
    }
  };

  const handleExpirationStep = (delta) => {
    if (expirationControlDisabled) return;
    handleFieldChange('expiration_months', normalizeExpirationMonths(currentExpirationMonths + delta));
  };

  const handleRemoveLocation = (locationId) => {
    if (readOnly || isProcessing) return;
    onLocationIdsChange?.(activeLocationIds.filter((id) => id !== locationId));
  };

  return (
    <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
      <div className="flex h-full flex-col gap-3">
        <EditorSection icon={Settings} title="Informações básicas" onActivate={() => activateStep('info')} className="min-h-[320px]" bodyClassName="min-h-[270px]">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium text-slate-700">
                Tipo <span className="text-[#534AB7]">*</span>
              </Label>
              <Select value={normalizePassType(formState.type)} onValueChange={(v) => handleFieldChange('type', normalizePassType(v))} disabled={readOnly || isProcessing}>
                <SelectTrigger className={validationErrors.type ? 'h-10 border-red-300 text-sm focus:ring-red-300' : 'h-10 text-sm'}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PASS_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {validationErrors.type && <p className="text-[10px] text-red-600">{validationErrors.type}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium text-slate-700">
                Título <span className="text-[#534AB7]">*</span>
              </Label>
              <Input
                value={formState.title}
                maxLength={16}
                onChange={(e) => handleFieldChange('title', e.target.value)}
                placeholder="Ex: Cartão"
                disabled={readOnly || isProcessing}
                className={validationErrors.title ? 'h-10 border-red-300 text-sm focus-visible:ring-red-300' : 'h-10 text-sm'}
              />
              {validationErrors.title && <p className="text-[10px] text-red-600">{validationErrors.title}</p>}
              {String(formState.title || '').length >= 16 && (
                <p className="text-[10px] text-amber-600">Limite de caracteres atingido.</p>
              )}
            </div>

            <div className="space-y-1 md:col-span-1">
              <div className="flex items-center gap-2">
                <Label className="text-[12px] font-medium text-slate-700">Descrição</Label>
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">opcional</span>
              </div>
              <Textarea
                value={formState.description}
                onChange={(e) => handleFieldChange('description', e.target.value)}
                placeholder="Ex: Complete 10 visitas e ganhe um café."
                disabled={readOnly || isProcessing}
                className="min-h-[96px] text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label className="block text-[12px] font-medium text-slate-700" htmlFor="wallet-expiration-months">
                Validade <span className="text-[#534AB7]">*</span>
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <div className={`inline-grid min-h-[30px] grid-cols-[30px_minmax(42px,54px)_30px] items-center overflow-hidden rounded-full border bg-white shadow-sm ${validationErrors.expiration_months ? 'border-red-300' : 'border-slate-200'}`}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-[30px] min-h-[30px] w-[30px] rounded-none bg-purple-100/80 p-0 text-purple-600 hover:bg-purple-200 hover:text-purple-700 focus-visible:ring-purple-300 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => handleExpirationStep(-1)}
                    disabled={expirationControlDisabled || !canDecreaseExpiration}
                    aria-label="Diminuir validade do passe"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <Input
                    id="wallet-expiration-months"
                    type="number"
                    min={MIN_EXPIRATION_MONTHS}
                    max={MAX_EXPIRATION_MONTHS}
                    step={1}
                    inputMode="numeric"
                    value={expirationMonthsValue}
                    onChange={(e) => handleFieldChange('expiration_months', e.target.value)}
                    onBlur={() => handleFieldChange('expiration_months', normalizeExpirationMonths(formState.expiration_months))}
                    disabled={expirationControlDisabled}
                    aria-label="Validade do passe em meses"
                    className="h-[30px] border-0 bg-white px-0 text-center text-[12px] font-semibold text-slate-900 shadow-none [appearance:textfield] focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-[30px] min-h-[30px] w-[30px] rounded-none bg-purple-100/80 p-0 text-purple-600 hover:bg-purple-200 hover:text-purple-700 focus-visible:ring-purple-300 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => handleExpirationStep(1)}
                    disabled={expirationControlDisabled || !canIncreaseExpiration}
                    aria-label="Aumentar validade do passe"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <span className="text-[11px] font-medium text-slate-500">mês · máx. 60</span>
              </div>
              {validationErrors.expiration_months && <p className="text-[10px] text-red-600">{validationErrors.expiration_months}</p>}
            </div>
          </div>
        </EditorSection>

        <EditorSection icon={MapPin} title="Localização" optional onActivate={() => activateStep('location')} className="flex-1">
          <div className="flex h-full flex-col gap-3">
            <div className="flex gap-2 rounded-md border border-purple-100 bg-purple-50/70 p-3 text-sm leading-snug text-slate-600">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#534AB7]" />
              <p>Adicione localizações para enviar notificações quando o portador estiver próximo ao estabelecimento.</p>
            </div>

            <div className="space-y-2">
              {hasLocations ? (
                [...activeLocationIds].reverse().map((locationId, index) => {
                  const location = locationsById[locationId];
                  const fallbackName = `Localização ${activeLocationIds.length - index}`;
                  const displayName = getLocationDisplayName(location, fallbackName);
                  const coordinates = formatLocationCoordinates(location);

                  return (
                    <div key={locationId} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-700">
                        <MapPin className="h-4 w-4 shrink-0 text-[#534AB7]" />
                        <div className="flex min-w-0 flex-1 items-end justify-between gap-3">
                          <p className="min-w-0 truncate leading-tight font-semibold text-slate-800">{displayName}</p>
                          <p className="shrink-0 truncate text-right font-mono text-[10px] leading-tight text-slate-400">{coordinates}</p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 p-0 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => handleRemoveLocation(locationId)}
                        disabled={readOnly || isProcessing}
                        aria-label={`Remover ${displayName}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })
              ) : (
                <p className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-500">Nenhuma localização adicionada.</p>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              style={ACTION_BUTTON_STYLE}
              className="mt-auto h-10 w-full justify-center gap-2 border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:border-[#534AB7] hover:bg-purple-50/70"
              onClick={onOpenLocations}
              disabled={readOnly || isProcessing}
            >
              <Plus className="h-4 w-4" />
              Adicionar localização
            </Button>
          </div>
        </EditorSection>
      </div>

      <EditorSection icon={Palette} title="Aparência" onActivate={() => activateStep('appearance')} className="h-full">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <ColorInput label="Fundo" value={formState.colors.background} onChange={(e) => handleFieldChange('colors.background', e.target.value)} disabled={readOnly || isProcessing} />
            <ColorInput label="Rótulo" value={formState.colors.label} onChange={(e) => handleFieldChange('colors.label', e.target.value)} disabled={readOnly || isProcessing} />
            <ColorInput label="Texto" value={formState.colors.text} onChange={(e) => handleFieldChange('colors.text', e.target.value)} disabled={readOnly || isProcessing} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-slate-400" />
              <Label className="text-[12px] font-medium text-slate-700">Imagens</Label>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">opcional</span>
            </div>

            <UploadPlatformGroup icon={Apple} title="Apple Wallet">
              <UploadButtonWithInfo uploadKey="appleLogo" value={formState.images.appleLogo} onUpload={onUploadClick} disabled={readOnly || isProcessing} />
              <UploadButtonWithInfo uploadKey="appleStrip" value={formState.images.appleStrip} onUpload={onUploadClick} disabled={readOnly || isProcessing} />
              <UploadButtonWithInfo uploadKey="icon" value={formState.images.icon} onUpload={onUploadClick} disabled={readOnly || isProcessing} className="col-span-full" />
            </UploadPlatformGroup>

            <UploadPlatformGroup icon={Smartphone} title="Google Wallet">
              <UploadButtonWithInfo uploadKey="googleLogo" value={formState.images.googleLogo} onUpload={onUploadClick} disabled={readOnly || isProcessing} />
              <UploadButtonWithInfo uploadKey="googleHero" value={formState.images.googleHero} onUpload={onUploadClick} disabled={readOnly || isProcessing} />
            </UploadPlatformGroup>
          </div>
        </div>
      </EditorSection>

      <input type="file" ref={fileInputRef} onChange={onFileChange} className="hidden" accept=".png,image/png" />
    </div>
  );
};
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
  const [locationsById, setLocationsById] = useState({});
  const [uploadingKey, setUploadingKey] = useState(null);
  const [projectMemberRole, setProjectMemberRole] = useState(null);
  const [passToDelete, setPassToDelete] = useState(null);
  const [currentStep, setCurrentStep] = useState('info');
  const [validationErrors, setValidationErrors] = useState({});
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [pendingAction, setPendingAction] = useState(null);
  const fileInputRef = useRef(null);

  const canManagePasses = role === 'superadmin' || role === 'admin' || projectMemberRole === 'owner';
  const isReadOnly = !canManagePasses;
  const isEditingPass = walletView === 'edit' && Boolean(selectedPass?.id);
  const isCreatingPass = walletView === 'new';
  const isEditorOpen = isEditingPass || isCreatingPass;
  const activeLocationIds = isEditingPass ? selectedPassLocationIds : draftLocationIds;
  const canGoBackToProjects = typeof onBack === 'function';

  const touchUpdatedAt = useCallback((value) => {
    const nextDate = value ? new Date(value) : new Date();
    setUpdatedAt(Number.isNaN(nextDate.getTime()) ? new Date() : nextDate);
  }, []);

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
        .select('id, project_id, type, title, description, status, qr_url, created_at, wallet_updated_at, fields, design, deleted_at')
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

  const loadLocationDetails = useCallback(async (pId) => {
    if (!pId) {
      setLocationsById({});
      return;
    }

    try {
      const { data, error } = await supabase
        .from('locations')
        .select('id, label, address, lat, lng')
        .eq('project_id', pId)
        .order('label');

      if (error) throw error;

      const nextMap = {};
      (data || []).forEach((location) => {
        if (location?.id) nextMap[location.id] = location;
      });
      setLocationsById(nextMap);
    } catch (error) {
      toast({ title: 'Erro ao carregar localizações', description: error.message, variant: 'destructive' });
    }
  }, [toast]);

  const loadWalletDefaults = useCallback(async (pId) => {
    setIsProcessing(true);
    try {
      const { data: projectData, error: projectError } = await supabase.from('projects').select('slug, name').eq('id', pId).single();
      if (projectError) throw projectError;
      setProjectSlug(projectData.slug || '');
      const projectDisplayName = String(projectData?.name ?? '').trim();

      const fromProject = await supabase.from('wallet_templates').select('defaults, updated_at').eq('project_id', pId).maybeSingle();
      let defaults = fromProject.data?.defaults;
      let defaultsUpdatedAt = fromProject.data?.updated_at;
      if (!defaults) {
        const { data: globalData, error: globalError } = await supabase.from('wallet_templates').select('defaults, updated_at').is('project_id', null).single();
        if (globalError) throw globalError;
        defaults = globalData?.defaults ?? {};
        defaultsUpdatedAt = globalData?.updated_at;
      }

      const merged = mergeWithInitial(applyProjectWalletDefaults(defaults, projectDisplayName));
      setTemplateDefaults(merged);
      touchUpdatedAt(defaultsUpdatedAt);
    } catch (error) {
      toast({ title: 'Erro ao carregar template', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  }, [toast, touchUpdatedAt]);
  useEffect(() => {
    if (!projectId) return;
    setSelectedPass(null);
    setWalletView('inventory');
    setSelectedPassLocationIds([]);
    setDraftLocationIds([]);
    setGenerationResult(null);
    setCurrentStep('info');
    setValidationErrors({});
    loadWalletDefaults(projectId);
    loadLocationDetails(projectId);
    fetchPasses(projectId);
  }, [projectId, loadWalletDefaults, loadLocationDetails, fetchPasses]);

  useEffect(() => {
    if (!selectedPass) {
      setFormState(mergeWithInitial(templateDefaults));
    }
  }, [templateDefaults, selectedPass]);

  useEffect(() => {
    if (!projectId || isLocationsModalOpen) return;
    loadLocationDetails(projectId);
  }, [projectId, isLocationsModalOpen, loadLocationDetails]);

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
      setCurrentStep('appearance');
      touchUpdatedAt();
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
          .select('id, project_id, type, title, description, status, qr_url, created_at, wallet_updated_at, fields, design, deleted_at')
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
    setCurrentStep('info');
    setValidationErrors({});
    touchUpdatedAt(resolvedPass.wallet_updated_at || resolvedPass.updated_at || resolvedPass.created_at);

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
    setCurrentStep('info');
    setValidationErrors({});
    setFormState(mergeWithInitial(templateDefaults));
    touchUpdatedAt();
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
    setCurrentStep('info');
    setValidationErrors({});
    setFormState(mergeWithInitial(templateDefaults));
    touchUpdatedAt();
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
        type: normalizePassType(formState.type),
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
      touchUpdatedAt();
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
      const savedAt = new Date().toISOString();
      const { data: savedTemplate, error } = await supabase
        .from('wallet_templates')
        .upsert({ project_id: projectId, name: 'Template do Projeto', defaults: normalizedDefaultsToSave, updated_at: savedAt }, { onConflict: 'project_id' })
        .select('updated_at')
        .single();

      if (error) throw error;
      setTemplateDefaults(mergeWithInitial(normalizedDefaultsToSave));
      touchUpdatedAt(savedTemplate?.updated_at || savedAt);
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
          type: normalizePassType(formState.type),
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
      touchUpdatedAt(mergedPass.wallet_updated_at || mergedPass.updated_at);
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

  const handleUnifiedBack = () => {
    if (isEditorOpen) {
      handleBackToPasses();
      return;
    }

    if (canGoBackToProjects) onBack();
  };

  const handleEditorAction = async (action) => {
    if (isReadOnly) {
      showManagePermissionToast();
      return;
    }

    if (action === 'generate' && isEditingPass) return;

    const nextErrors = validateEditorForm(formState);
    setValidationErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setCurrentStep('info');
      return;
    }

    setCurrentStep('publish');
    setPendingAction(action);
    try {
      if (action === 'save') {
        await handleSave();
        return;
      }

      await handleGenerateLink();
    } finally {
      setPendingAction(null);
    }
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
              type="button"
              variant="outline"
              onClick={handleUnifiedBack}
              style={ACTION_BUTTON_STYLE}
              className="h-auto px-[14px] py-[6px] text-[12px] font-medium"
            >
              ← Voltar
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

  const previewLink = generationResult?.qr_url || generationResult?.claim_url || formState.qr_url;
  const canGenerateLink = !isEditingPass && !isReadOnly;

  return (
    <div className="p-2 pb-0 md:p-3 md:pb-0 lg:p-4 lg:pb-0">
      <div className="mb-3 space-y-3">
        {isEditingPass && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <p className="text-[12px] font-medium">
              Editando cartão criado em {formatPassCreatedAt(selectedPass?.created_at)}.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{isEditingPass ? 'Editar cartão' : 'Novo cartão'}</h1>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {isEditingPass ? 'Ajuste o cartão selecionado e salve as mudancas.' : 'Monte um novo cartão usando o template do projeto.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={handleUnifiedBack}
              disabled={isProcessing}
              style={ACTION_BUTTON_STYLE}
              className="h-auto px-[14px] py-[6px] text-[12px] font-medium"
            >
              ← Voltar
            </Button>

          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,0.85fr)_330px] xl:grid-cols-[minmax(0,0.82fr)_minmax(0,0.82fr)_350px]">
        <motion.div
          key={`${walletView}-editor`}
          initial={{ opacity: 0, x: -64 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="lg:col-span-2"
        >
          <PassEditorPanel
            readOnly={isReadOnly}
            formState={formState}
            activeLocationIds={activeLocationIds}
            locationsById={locationsById}
            isProcessing={isProcessing}
            fileInputRef={fileInputRef}
            validationErrors={validationErrors}
            setValidationErrors={setValidationErrors}
            onFormChange={handleFormChange}
            onUploadClick={handleUploadClick}
            onFileChange={handleFileChange}
            onOpenLocations={() => {
              setCurrentStep('location');
              setIsLocationsModalOpen(true);
            }}
            onLocationIdsChange={updateLocationSelection}
            onStepChange={setCurrentStep}
          />
        </motion.div>

        <motion.div
          layoutId="wallet-pass-preview"
          initial={{ opacity: 0, x: -140 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.42, ease: 'easeOut' }}
          className="lg:col-span-1"
        >
          <PassPreview formState={formState} qrPreviewUrl={previewLink} />
        </motion.div>
      </div>

      <div className="sticky bottom-0 z-30 -mx-2 mt-4 border-t border-border bg-background/95 px-2 py-3 backdrop-blur md:-mx-3 md:px-3 lg:-mx-4 lg:px-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={handleUnifiedBack}
            disabled={isProcessing}
            style={ACTION_BUTTON_STYLE}
            className="h-auto justify-center px-[14px] py-[6px] text-[12px] font-medium sm:justify-start"
          >
            ← Voltar
          </Button>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleEditorAction('save')}
              disabled={isProcessing || isReadOnly}
              style={ACTION_BUTTON_STYLE}
              className="h-11 min-w-[150px] px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              {pendingAction === 'save' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar rascunho
            </Button>

            <Button
              type="button"
              onClick={() => handleEditorAction('generate')}
              disabled={isProcessing || !canGenerateLink}
              title={isEditingPass ? 'Disponível ao criar um novo cartão.' : undefined}
              style={ACTION_BUTTON_STYLE}
              className="h-11 min-w-[190px] gap-2 bg-[#534AB7] px-5 py-2 text-sm font-semibold text-white hover:bg-[#463e9f] focus-visible:ring-[#534AB7]"
            >
              {pendingAction === 'generate' && <Loader2 className="h-4 w-4 animate-spin" />}
              Gerar link único
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
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

