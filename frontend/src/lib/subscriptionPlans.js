export const FREE_TRIAL_PLAN_CODE = 'free_trial';
export const FREE_TRIAL_PLAN_KEY = 'free-trial';
export const DEFAULT_PLAN_KEY = FREE_TRIAL_PLAN_KEY;

export const formatCurrencyBRL = (amount) =>
  Number(amount || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatIntegerBR = (value) =>
  Math.max(0, Number(value || 0)).toLocaleString('pt-BR', {
    maximumFractionDigits: 0,
  });

const freeTrialPlan = {
  key: FREE_TRIAL_PLAN_KEY,
  code: FREE_TRIAL_PLAN_CODE,
  type: 'trial',
  name: 'Free Trial',
  highlight: '7 dias grátis',
  description: 'Teste todos os recursos do AllinPass por 7 dias.',
  trialDays: 7,
  price: 0,
  priceLabel: 'Grátis',
  cta: 'Começar Grátis',
  limits: {
    passInstalls: 75,
    notifications: 250,
  },
  overage: {
    passInstallCents: 0,
    notificationSentCents: 0,
    chargingEnabled: false,
  },
};

const buildTrialFeatures = (plan) => [
  'Acesso completo a todos os recursos',
  'Notificações automatizadas',
  'Notificações por geolocalização',
  'Dashboards para análise de desempenho',
  'Onboarding guiado para primeiro uso',
  'Sem necessidade de cartão de crédito',
  `Até ${formatIntegerBR(plan.limits.passInstalls)} instalações de passe`,
  `Até ${formatIntegerBR(plan.limits.notifications)} notificações no período de trial`,
];

export const subscriptionPlans = [
  {
    ...freeTrialPlan,
    features: buildTrialFeatures(freeTrialPlan),
  },
];

export const fetchSubscriptionPlans = async () => subscriptionPlans;

export const isFreeTrialPlan = (plan) =>
  String(plan?.code || '').trim().toLowerCase() === FREE_TRIAL_PLAN_CODE ||
  plan?.type === 'trial';

export const getFreeTrialPlan = (plans = subscriptionPlans) => {
  const planList = Array.isArray(plans) ? plans : subscriptionPlans;

  return planList.find(isFreeTrialPlan) ||
    subscriptionPlans[0];
};

export const getPublicSignupPlans = (plans = subscriptionPlans) => {
  const freeTrial = getFreeTrialPlan(plans);
  return freeTrial ? [freeTrial] : [];
};

export const findPlanByKey = (planKey, plans = subscriptionPlans) =>
  plans.find((plan) => plan.key === planKey) ||
  plans.find((plan) => plan.key === DEFAULT_PLAN_KEY) ||
  subscriptionPlans[0];

export const buildSignupPath = () =>
  `/cadastro?plano=${encodeURIComponent(FREE_TRIAL_PLAN_KEY)}`;
