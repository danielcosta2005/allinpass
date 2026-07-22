import { supabase } from '@/lib/supabaseClient';

export const DEFAULT_PLAN_KEY = 'starter';
export const AFFILIATE_DISCOUNT_BPS = 1000;

const AFFILIATE_REF_PATTERN = /^[a-z0-9][a-z0-9-]{4,39}$/;

export const normalizeAffiliateRef = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40);

  return AFFILIATE_REF_PATTERN.test(normalized) ? normalized : '';
};

const PLAN_ORDER = ['free_trial', 'starter', 'pro', 'premium'];

const PLAN_PRESENTATION_BY_CODE = {
  free_trial: {
    key: 'free-trial',
    type: 'trial',
    highlight: '7 dias grátis',
    cta: 'Começar Grátis',
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

const PLAN_DESCRIPTION_BY_CODE = {
  free_trial: 'Teste todos os recursos do AllinPass por 7 dias.',
  starter: 'Para quem está começando a fidelizar.',
  pro: 'O queridinho de quem quer crescer.',
  premium: 'Para operações de alto volume.',
};

const PLAN_STATIC_FEATURES_BY_CODE = {
  free_trial: [
    'Acesso completo a todos os recursos',
    'Notificações automatizadas',
    'Notificações por geolocalização',
    'Dashboards para análise de desempenho',
    'Onboarding guiado para primeiro uso',
    'Sem necessidade de cartão de crédito',
  ],
  starter: ['Acesso a todas as funcionalidades AllinPass'],
  pro: ['Acesso a todas as funcionalidades AllinPass'],
  premium: ['Acesso a todas as funcionalidades AllinPass'],
};

const toNumber = (value, defaultValue = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
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

export const getAffiliateDiscountBps = (affiliateOffer = null) => {
  if (!affiliateOffer?.valid) return 0;

  const discountBps = Math.trunc(toNumber(affiliateOffer.discountBps, AFFILIATE_DISCOUNT_BPS));
  return Math.min(10000, Math.max(0, discountBps));
};

export const calculateAffiliateFirstMonthPrice = (price, affiliateOffer = null) => {
  const normalizedPrice = Math.max(0, toNumber(price, 0));
  const discountBps = getAffiliateDiscountBps(affiliateOffer);

  if (discountBps <= 0) return normalizedPrice;

  return Math.max(0, normalizedPrice * (1 - discountBps / 10000));
};

export const formatAffiliateDiscountPercent = (affiliateOffer = null) => {
  const discountBps = getAffiliateDiscountBps(affiliateOffer);
  const discountPercent = discountBps / 100;
  const hasDecimal = !Number.isInteger(discountPercent);

  return discountPercent.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: hasDecimal ? 2 : 0,
  });
};

const formatIntegerBR = (value) =>
  Math.max(0, Number(value || 0)).toLocaleString('pt-BR', {
    maximumFractionDigits: 0,
  });

const formatCentsToBRL = (valueInCents) =>
  formatCurrencyBRL(Math.max(0, Number(valueInCents || 0)) / 100);

const buildPlanFeatures = ({
  code,
  type,
  trialDays,
  includedPassInstalls,
  includedNotificationSends,
  overagePassInstallCents,
  overageNotificationSentCents,
}) => {
  const staticFeatures = PLAN_STATIC_FEATURES_BY_CODE[code] || [];
  const features = [...staticFeatures];

  if (type === 'trial') {
    features.push(`Até ${formatIntegerBR(includedPassInstalls)} instalações de passe`);
    features.push(`Até ${formatIntegerBR(includedNotificationSends)} notificações no período de trial`);
  } else {
    features.push(`Até ${formatIntegerBR(includedPassInstalls)} instalações de passe/mês`);
    features.push(`${formatIntegerBR(includedNotificationSends)} notificações/mês`);
  }

  if (overagePassInstallCents > 0) {
    features.push(`Excedente: R$ ${formatCentsToBRL(overagePassInstallCents)} por instalação`);
  }

  if (overageNotificationSentCents > 0) {
    features.push(`Excedente: R$ ${formatCentsToBRL(overageNotificationSentCents)} por notificação enviada`);
  }

  return features;
};

const subscriptionPlanSeeds = [
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
  },
];

export const subscriptionPlans = subscriptionPlanSeeds.map((plan) => ({
  ...plan,
  features: buildPlanFeatures({
    code: plan.code,
    type: plan.type,
    trialDays: plan.trialDays || 0,
    includedPassInstalls: plan.limits?.passInstalls || 0,
    includedNotificationSends: plan.limits?.notifications || 0,
    overagePassInstallCents: plan.overage?.passInstallCents || 0,
    overageNotificationSentCents: plan.overage?.notificationSentCents || 0,
  }),
}));

const FALLBACK_BY_CODE = new Map(subscriptionPlans.map((plan) => [plan.code, plan]));

const mapBillingPlanToUiPlan = (billingPlan) => {
  if (!billingPlan?.code) return null;

  const fallback = FALLBACK_BY_CODE.get(billingPlan.code);
  const presentation = PLAN_PRESENTATION_BY_CODE[billingPlan.code] || {};
  const trialDays = Math.max(0, Math.trunc(toNumber(billingPlan.trial_days, fallback?.trialDays || 0)));
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
  const features = buildPlanFeatures({
    code: billingPlan.code,
    type,
    trialDays,
    includedPassInstalls,
    includedNotificationSends,
    overagePassInstallCents,
    overageNotificationSentCents,
  });

  return {
    ...fallback,
    key: presentation.key || fallback?.key || billingPlan.code,
    code: billingPlan.code,
    type,
    name: billingPlan.name || fallback?.name || billingPlan.code,
    description:
      PLAN_DESCRIPTION_BY_CODE[billingPlan.code] ||
      fallback?.description ||
      '',
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
        'code, name, billing_interval, base_price_cents, trial_days, included_pass_installs, included_notification_sends, overage_pass_install_cents, overage_notification_sent_cents, is_active'
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

export const buildSignupPath = (planKey, { promo = '', ref = '' } = {}) => {
  const params = new URLSearchParams({ plano: String(planKey || DEFAULT_PLAN_KEY) });
  const affiliateRef = normalizeAffiliateRef(promo || ref);
  if (affiliateRef) params.set('promo', affiliateRef);
  return `/cadastro?${params.toString()}`;
};
