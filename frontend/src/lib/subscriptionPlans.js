export const DEFAULT_PLAN_KEY = 'starter';

export const formatCurrencyBRL = (amount) =>
  Number(amount || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const subscriptionPlans = [
  {
    key: 'free-trial',
    code: 'free_trial',
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
    features: [
      'Acesso completo a todos os recursos',
      'Notificações automatizadas',
      'Notificações por geolocalização',
      'Dashboards para análise de desempenho',
      'Até 75 instalações de passe',
      'Até 250 notificações no período de trial',
      'Onboarding guiado para primeiro uso',
      'Sem necessidade de cartão de crédito',
    ],
  },
  {
    key: 'starter',
    code: 'starter',
    type: 'paid',
    name: 'Starter',
    description: 'Para quem está começando a fidelizar.',
    price: 197.7,
    cta: 'Assinar Starter',
    limits: {
      passInstalls: 300,
      notifications: 1000,
    },
    overage: {
      passInstallCents: 8,
      notificationSentCents: 2,
      chargingEnabled: true,
    },
    features: [
      'Acesso a todas as funcionalidades AllinPass',
      'Até 300 instalações de passe/mês',
      '1.000 notificações/mês',
      'Excedente: R$ 0,08 por instalação',
      'Excedente: R$ 0,02 por notificação enviada',
    ],
  },
  {
    key: 'pro',
    code: 'pro',
    type: 'paid',
    name: 'Pro',
    description: 'O queridinho de quem quer crescer.',
    price: 297.7,
    cta: 'Assinar Pro',
    badge: 'Mais popular',
    highlighted: true,
    limits: {
      passInstalls: 1500,
      notifications: 10000,
    },
    overage: {
      passInstallCents: 4,
      notificationSentCents: 1,
      chargingEnabled: true,
    },
    features: [
      'Acesso a todas as funcionalidades AllinPass',
      'Até 1.500 instalações de passe/mês',
      '10.000 notificações/mês',
      'Excedente: R$ 0,04 por instalação',
      'Excedente: R$ 0,01 por notificação enviada',
    ],
  },
  {
    key: 'premium',
    code: 'premium',
    type: 'paid',
    name: 'Premium',
    description: 'Para operações de alto volume.',
    price: 397.7,
    cta: 'Assinar Premium',
    limits: {
      passInstalls: 8000,
      notifications: 50000,
    },
    overage: {
      passInstallCents: 3,
      notificationSentCents: 1,
      chargingEnabled: true,
    },
    features: [
      'Acesso a todas as funcionalidades AllinPass',
      'Até 8.000 instalações de passe/mês',
      '50.000 notificações/mês',
      'Excedente: R$ 0,03 por instalação',
      'Excedente: R$ 0,01 por notificação enviada',
    ],
  },
];

export const findPlanByKey = (planKey) =>
  subscriptionPlans.find((plan) => plan.key === planKey) ||
  subscriptionPlans.find((plan) => plan.key === DEFAULT_PLAN_KEY) ||
  subscriptionPlans[0];

export const isPaidPlan = (plan) => plan?.type === 'paid';

export const buildSignupPath = (planKey) =>
  `/cadastro?plano=${encodeURIComponent(planKey)}`;
