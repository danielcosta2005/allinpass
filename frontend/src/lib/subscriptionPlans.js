export const DEFAULT_PLAN_KEY = 'starter';

export const subscriptionPlans = [
  {
    key: 'free-trial',
    type: 'trial',
    name: 'Free Trial',
    highlight: '7 dias grátis',
    description: 'Teste todos os recursos do AllinPass por 7 dias.',
    price: 0,
    priceLabel: 'Grátis',
    cta: 'Começar Grátis',
    features: [
      'Acesso completo a todos os recursos',
      'Sem necessidade de introduzir cartão de crédito',
      'Onboarding guiado para primeiro uso',
    ],
  },
  {
    key: 'starter',
    type: 'paid',
    name: 'Starter',
    description: 'Para quem está comecando a fidelizar.',
    price: 49,
    cta: 'Assinar Starter',
    features: [
      'Até 50 passes ativos',
      '200 notificações/mês',
      '1 design de passe',
      'Suporte por e-mail',
      'Análises basicas',
    ],
  },
  {
    key: 'pro',
    type: 'paid',
    name: 'Pro',
    description: 'O queridinho de quem quer crescer.',
    price: 149,
    cta: 'Assinar Pro',
    badge: 'Mais popular',
    highlighted: true,
    features: [
      'Até 500 passes ativos',
      '5.000 notificações/mês',
      '5 designs de passe',
      'Suporte prioritário',
      'Análises avançadas + KPIs',
      'Automações de notificação',
    ],
  },
  {
    key: 'premium',
    type: 'paid',
    name: 'Premium',
    description: 'Para operações de alto volume.',
    price: 399,
    cta: 'Assinar Premium',
    features: [
      'Passes ilimitados',
      'Notificações ilimitadas',
      'Designs ilimitados',
      'Suporte dedicado 24/7',
      'API completa + Webhooks',
      'Multi-localização',
      'Onboarding personalizado',
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
