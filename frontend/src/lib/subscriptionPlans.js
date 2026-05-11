import { supabase } from '@/lib/supabaseClient';

export const DEFAULT_PLAN_KEY = 'starter';

const PLAN_ORDER = ['free_trial', 'starter', 'pro', 'premium'];

const PLAN_PRESENTATION_BY_CODE = {
  free_trial: {
    key: 'free-trial',
    type: 'trial',
    highlight: '7 dias gratis',
    cta: 'Comecar Gratis',
  },
  starter: {
    key: 'starter',
    type: 'paid',
    cta: 'Assinar Starter',
  },
  pro: {
    key: 'pro',
    type: 'paid',
    badge: 'Mais popular',
    highlighted: true,
    cta: 'Assinar Pro',
  },
  premium: {
    key: 'premium',
    type: 'paid',
    cta: 'Assinar Premium',
  },
};

const toNumber = (value, defaultValue = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const normalizeFeatures = (value) => {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim().length > 0);
};

const getPlanSortIndex = (code) => {
  const index = PLAN_ORDER.indexOf(code);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

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
    highlight: '7 dias gratis',
    description: 'Teste todos os recursos do AllinPass por 7 dias.',
    trialDays: 7,
    price: 0,
    priceLabel: 'Gratis',
    cta: 'Comecar Gratis',
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
      'Notificacoes automatizadas',
      'Notificacoes por geolocalizacao',
      'Dashboards para analise de desempenho',
      'Ate 75 instalacoes de passe',
      'Ate 250 notificacoes no periodo de trial',
      'Onboarding guiado para primeiro uso',
      'Sem necessidade de cartao de credito',
    ],
  },
  {
    key: 'starter',
    code: 'starter',
    type: 'paid',
    name: 'Starter',
    description: 'Para quem esta comecando a fidelizar.',
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
      'Ate 300 instalacoes de passe/mes',
      '1.000 notificacoes/mes',
      'Excedente: R$ 0,08 por instalacao',
      'Excedente: R$ 0,02 por notificacao enviada',
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
      'Ate 1.500 instalacoes de passe/mes',
      '10.000 notificacoes/mes',
      'Excedente: R$ 0,04 por instalacao',
      'Excedente: R$ 0,01 por notificacao enviada',
    ],
  },
  {
    key: 'premium',
    code: 'premium',
    type: 'paid',
    name: 'Premium',
    description: 'Para operacoes de alto volume.',
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
      'Ate 8.000 instalacoes de passe/mes',
      '50.000 notificacoes/mes',
      'Excedente: R$ 0,03 por instalacao',
      'Excedente: R$ 0,01 por notificacao enviada',
    ],
  },
];

const FALLBACK_BY_CODE = new Map(subscriptionPlans.map((plan) => [plan.code, plan]));

const mapBillingPlanToUiPlan = (billingPlan) => {
  if (!billingPlan?.code) return null;

  const fallback = FALLBACK_BY_CODE.get(billingPlan.code);
  const presentation = PLAN_PRESENTATION_BY_CODE[billingPlan.code] || {};
  const trialDays = Math.max(0, Math.trunc(toNumber(billingPlan.trial_days, fallback?.trialDays || 0)));
  const featuresFromDb = normalizeFeatures(billingPlan.features);
  const basePriceCents = Math.max(
    0,
    Math.trunc(toNumber(billingPlan.base_price_cents, toNumber(fallback?.price) * 100))
  );
  const includedPassInstalls = Math.max(
    0,
    Math.trunc(toNumber(billingPlan.included_pass_installs, fallback?.limits?.passInstalls || 0))
  );
  const includedNotificationSends = Math.max(
    0,
    Math.trunc(toNumber(billingPlan.included_notification_sends, fallback?.limits?.notifications || 0))
  );
  const overagePassInstallCents = Math.max(
    0,
    Math.trunc(toNumber(billingPlan.overage_pass_install_cents, fallback?.overage?.passInstallCents || 0))
  );
  const overageNotificationSentCents = Math.max(
    0,
    Math.trunc(
      toNumber(
        billingPlan.overage_notification_sent_cents,
        fallback?.overage?.notificationSentCents || 0
      )
    )
  );

  const type = presentation.type || fallback?.type || (trialDays > 0 ? 'trial' : 'paid');
  const features = featuresFromDb.length > 0 ? featuresFromDb : fallback?.features || [];

  return {
    ...fallback,
    key: presentation.key || fallback?.key || billingPlan.code,
    code: billingPlan.code,
    type,
    name: billingPlan.name || fallback?.name || billingPlan.code,
    description: billingPlan.description || fallback?.description || '',
    highlight: presentation.highlight ?? fallback?.highlight,
    badge: presentation.badge ?? fallback?.badge,
    highlighted: presentation.highlighted ?? fallback?.highlighted,
    cta: presentation.cta || fallback?.cta || 'Assinar',
    trialDays,
    price: basePriceCents / 100,
    limits: {
      passInstalls: includedPassInstalls,
      notifications: includedNotificationSends,
    },
    overage: {
      passInstallCents: overagePassInstallCents,
      notificationSentCents: overageNotificationSentCents,
      chargingEnabled: overagePassInstallCents > 0 || overageNotificationSentCents > 0,
    },
    features,
  };
};

export const fetchSubscriptionPlans = async () => {
  try {
    const { data, error } = await supabase
      .from('billing_plans')
      .select(
        'code, name, description, billing_interval, base_price_cents, trial_days, included_pass_installs, included_notification_sends, overage_pass_install_cents, overage_notification_sent_cents, features, is_active'
      )
      .eq('is_active', true)
      .eq('billing_interval', 'monthly')
      .order('base_price_cents', { ascending: true });

    if (error || !Array.isArray(data) || data.length === 0) {
      return subscriptionPlans;
    }

    const normalized = data
      .map(mapBillingPlanToUiPlan)
      .filter(Boolean)
      .sort((a, b) => {
        const orderDelta = getPlanSortIndex(a.code) - getPlanSortIndex(b.code);
        if (orderDelta !== 0) return orderDelta;
        return toNumber(a.price) - toNumber(b.price);
      });

    return normalized.length > 0 ? normalized : subscriptionPlans;
  } catch {
    return subscriptionPlans;
  }
};

export const findPlanByKey = (planKey, plans = subscriptionPlans) =>
  plans.find((plan) => plan.key === planKey) ||
  plans.find((plan) => plan.key === DEFAULT_PLAN_KEY) ||
  plans[0] ||
  subscriptionPlans[0];

export const isPaidPlan = (plan) => plan?.type === 'paid';

export const buildSignupPath = (planKey) =>
  `/cadastro?plano=${encodeURIComponent(planKey)}`;
