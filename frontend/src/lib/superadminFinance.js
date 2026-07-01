import { supabase } from '@/lib/supabaseClient';

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const CSV_STATUS_LABELS = {
  active: 'Ativa',
  canceled: 'Cancelada',
  expired: 'Periodo gratuito expirado',
  past_due: 'Pagamento pendente',
  paused: 'Pausada',
  suspended: 'Suspensa',
  trialing: 'Periodo gratuito',
  sem_assinatura: 'Sem assinatura',
};

const CSV_RISK_LABELS = {
  limite_atingido: 'Limite atingido',
  mudanca_pendente: 'Alteracao pendente',
  ok: 'OK',
  overage: 'Consumo excedente',
  pagamento_atrasado: 'Pagamento atrasado',
  sem_assinatura: 'Sem assinatura',
  sem_ciclo: 'Sem ciclo',
  suspensa: 'Suspensa',
  trial_expirado: 'Periodo gratuito expirado',
  trial_expirando: 'Periodo gratuito expirando',
};

const CSV_CHANGE_LABELS = {
  downgrade: 'Reducao de plano',
  plan_change: 'Alteracao de plano',
  trial_conversion: 'Conversao do periodo gratuito',
  upgrade: 'Aumento de plano',
};

function normalizeLabelKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getCsvLabel(labels, value, fallback) {
  const key = normalizeLabelKey(value);
  return labels[key] || value || fallback;
}

function snakeToCamel(value) {
  return String(value).replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function camelize(value) {
  if (Array.isArray(value)) return value.map(camelize);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [snakeToCamel(key), camelize(entryValue)]),
  );
}

function unwrapRpcPayload(payload, functionName) {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return null;
    if (payload.length === 1) return unwrapRpcPayload(payload[0], functionName);
    return payload;
  }

  if (payload && typeof payload === 'object' && functionName && Object.prototype.hasOwnProperty.call(payload, functionName)) {
    return payload[functionName];
  }

  return payload;
}

function normalizeOverview(payload) {
  const normalized = camelize(payload || {});
  return {
    generatedAt: normalized.generatedAt || null,
    kpis: normalized.kpis || {},
    projects: Array.isArray(normalized.projects) ? normalized.projects : [],
  };
}

function normalizeDetail(payload) {
  const normalized = camelize(payload || {});
  return {
    generatedAt: normalized.generatedAt || null,
    project: normalized.project || null,
    subscription: normalized.subscription || null,
    currentCycle: normalized.currentCycle || null,
    cycles: Array.isArray(normalized.cycles) ? normalized.cycles : [],
    planChanges: Array.isArray(normalized.planChanges) ? normalized.planChanges : [],
    auditLogs: Array.isArray(normalized.auditLogs) ? normalized.auditLogs : [],
    risk: normalized.risk || null,
  };
}

export async function getSuperadminFinancialOverview() {
  const { data, error } = await supabase.rpc('get_superadmin_financial_plan_overview');
  if (error) throw error;
  return normalizeOverview(unwrapRpcPayload(data, 'get_superadmin_financial_plan_overview'));
}

export async function getSuperadminProjectFinancialDetail(projectId) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) throw new Error('Projeto obrigatorio.');

  const { data, error } = await supabase.rpc('get_superadmin_project_financial_detail', {
    p_project_id: normalizedProjectId,
  });

  if (error) throw error;
  return normalizeDetail(unwrapRpcPayload(data, 'get_superadmin_project_financial_detail'));
}

export function formatCurrencyFromCents(value) {
  const cents = Number(value || 0);
  return currencyFormatter.format(Number.isFinite(cents) ? cents / 100 : 0);
}

export function formatInteger(value) {
  const numberValue = Number(value || 0);
  return integerFormatter.format(Number.isFinite(numberValue) ? numberValue : 0);
}

export function formatPercent(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '-';
  return `${integerFormatter.format(Math.round(numberValue))}%`;
}

export function formatDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '-';
  return dateFormatter.format(date);
}

export function formatDateTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '-';
  return dateTimeFormatter.format(date);
}

export function getDaysUntil(value) {
  const target = new Date(value || '');
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - Date.now()) / 86400000);
}

function escapeCsvCell(value) {
  const stringValue = String(value ?? '');
  if (!/[",\n;]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

export function buildFinancialProjectsCsv(projects) {
  const rows = Array.isArray(projects) ? projects : [];
  const headers = [
    'Projeto',
    'Plano',
    'Status',
    'Risco',
    'Receita recorrente mensal ativa',
    'Receita excedente do ciclo',
    'Receita em risco',
    'Uso de instalacoes de cartao',
    'Uso de notificacoes',
    'Email de cobranca',
    'Intermediador de pagamento',
    'Inicio do periodo de competencia',
    'Fim do periodo de competencia',
    'Alteracao de plano pendente',
  ];

  const body = rows.map((project) => [
    project.projectName || project.projectId || '',
    project.planName || project.planCode || 'Sem plano',
    getCsvLabel(CSV_STATUS_LABELS, project.subscriptionStatus, 'Sem assinatura'),
    getCsvLabel(CSV_RISK_LABELS, project.riskStatus, 'OK'),
    formatCurrencyFromCents(project.mrrActiveCents),
    formatCurrencyFromCents(project.totalOverageCents),
    formatCurrencyFromCents(project.revenueAtRiskCents),
    `${formatInteger(project.passInstallQuantity)} / ${formatInteger(project.includedPassInstalls)}`,
    `${formatInteger(project.notificationSentQuantity)} / ${formatInteger(project.includedNotificationSends)}`,
    project.billingEmail || '',
    project.subscriptionGatewayProvider || project.billingGatewayProvider || '',
    formatDate(project.currentPeriodStart),
    formatDate(project.currentPeriodEnd),
    project.pendingChangeType ? `${getCsvLabel(CSV_CHANGE_LABELS, project.pendingChangeType, 'Alteracao de plano')} -> ${project.pendingPlanName || project.pendingPlanCode || ''}` : '',
  ]);

  return [headers, ...body]
    .map((row) => row.map(escapeCsvCell).join(';'))
    .join('\n');
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
