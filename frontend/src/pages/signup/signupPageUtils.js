import { subscriptionPlans } from '@/lib/subscriptionPlans';

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FRIENDLY_SIGNUP_RATE_LIMIT_MESSAGE = 'Aguarde alguns minutos para tentar novamente';
const SIGNUP_PASSWORD_SETUP_REQUIRED_STORAGE_KEY = '__signup_password_setup_required';

const PASSWORD_RULES = [
  { id: 'length', label: 'Pelo menos 10 caracteres', test: (value) => value.length >= 10 },
  { id: 'upper', label: 'Uma letra maiúscula', test: (value) => /[A-Z]/.test(value) },
  { id: 'lower', label: 'Uma letra minúscula', test: (value) => /[a-z]/.test(value) },
  { id: 'number', label: 'Um número', test: (value) => /\d/.test(value) },
  { id: 'symbol', label: 'Um símbolo especial', test: (value) => /[^A-Za-z0-9]/.test(value) },
];

export function evaluatePassword(password) {
  const checks = PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.test(password),
  }));
  const score = checks.filter((rule) => rule.met).length;
  const progress = Math.max(8, (score / PASSWORD_RULES.length) * 100);
  const strength =
    score <= 1
      ? { label: 'Muito fraca', textColor: 'text-rose-600', barColor: 'bg-rose-500' }
      : score <= 3
        ? { label: 'Em evolução', textColor: 'text-amber-600', barColor: 'bg-amber-500' }
        : { label: 'Forte', textColor: 'text-emerald-600', barColor: 'bg-emerald-500' };

  return {
    checks,
    score,
    progress,
    ...strength,
    isStrong: score >= 4,
  };
}

export function markSignupPasswordSetupRequired() {
  try {
    sessionStorage.setItem(SIGNUP_PASSWORD_SETUP_REQUIRED_STORAGE_KEY, '1');
  } catch (_) {}
}

export function clearSignupPasswordSetupRequired() {
  try {
    sessionStorage.removeItem(SIGNUP_PASSWORD_SETUP_REQUIRED_STORAGE_KEY);
  } catch (_) {}
}

export function isSignupPasswordSetupRequired() {
  try {
    return sessionStorage.getItem(SIGNUP_PASSWORD_SETUP_REQUIRED_STORAGE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

export function normalizeSignupErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  if (
    message.includes('email rate limit exceeded')
    || code === 'over_email_send_rate_limit'
  ) {
    return FRIENDLY_SIGNUP_RATE_LIMIT_MESSAGE;
  }

  return error?.message || 'Não foi possível iniciar o cadastro.';
}

export function getPasswordError(password, passwordState) {
  if (!password) {
    return 'Crie uma senha forte para proteger os dados da sua conta.';
  }

  if (!passwordState.isStrong) {
    const missingRules = passwordState.checks
      .filter((rule) => !rule.met)
      .map((rule) => rule.label.toLowerCase());
    return `Sua senha ainda precisa de: ${missingRules.join(', ')}.`;
  }

  return '';
}

export function findPlanKeyByCode(planCode, plans = subscriptionPlans) {
  const normalizedCode = String(planCode || '').trim().toLowerCase();
  if (!normalizedCode) return '';

  const matchedPlan = plans.find((plan) => String(plan?.code || '').trim().toLowerCase() === normalizedCode);
  return String(matchedPlan?.key || '').trim();
}
