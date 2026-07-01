import { trackStandard } from '@/lib/metaPixel';
import { subscriptionPlans } from '@/lib/subscriptionPlans';

const SIGNUP_PIXEL_EVENTS_STORAGE_KEY = '__allinpass_signup_pixel_events_v1';
const SIGNUP_PIXEL_EVENTS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const trackedEventsInMemory = new Set();

const isBrowser = () => typeof window !== 'undefined';

const normalizeCode = (value) =>
  String(value || '').trim().toLowerCase().replace(/-/g, '_');

const normalizeText = (value) => String(value || '').trim();

const readTrackedEventStore = () => {
  if (!isBrowser()) return {};

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SIGNUP_PIXEL_EVENTS_STORAGE_KEY) || '{}'
    );
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
};

const writeTrackedEventStore = (store) => {
  if (!isBrowser()) return;

  try {
    window.localStorage.setItem(SIGNUP_PIXEL_EVENTS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage can be unavailable or full; in-memory dedupe still applies.
  }
};

const pruneTrackedEventStore = (store, now) => {
  const nextStore = {};

  Object.entries(store).forEach(([key, timestamp]) => {
    const trackedAt = Number(timestamp || 0);
    if (
      key
      && Number.isFinite(trackedAt)
      && trackedAt > 0
      && now - trackedAt < SIGNUP_PIXEL_EVENTS_TTL_MS
    ) {
      nextStore[key] = trackedAt;
    }
  });

  return nextStore;
};

const hasTrackedEvent = (eventKey) => {
  if (!eventKey) return false;
  if (trackedEventsInMemory.has(eventKey)) return true;

  const now = Date.now();
  const store = pruneTrackedEventStore(readTrackedEventStore(), now);
  const trackedAt = Number(store[eventKey] || 0);

  if (trackedAt && now - trackedAt < SIGNUP_PIXEL_EVENTS_TTL_MS) {
    trackedEventsInMemory.add(eventKey);
    writeTrackedEventStore(store);
    return true;
  }

  writeTrackedEventStore(store);
  return false;
};

const rememberTrackedEvent = (eventKey) => {
  if (!eventKey) return;

  const now = Date.now();
  const store = pruneTrackedEventStore(readTrackedEventStore(), now);
  store[eventKey] = now;
  trackedEventsInMemory.add(eventKey);
  writeTrackedEventStore(store);
};

const buildEventKey = (eventName, {
  checkoutSessionId = '',
  providerCheckoutId = '',
  projectId = '',
  subscriptionId = '',
} = {}) => {
  const stableId = normalizeText(checkoutSessionId)
    || normalizeText(providerCheckoutId)
    || normalizeText(projectId)
    || normalizeText(subscriptionId);

  return stableId ? `${eventName}:${stableId}` : '';
};

const resolvePlan = ({
  plan,
  planCode,
  planName,
  value,
  valueCents,
  currency,
} = {}) => {
  const normalizedPlanCode = normalizeCode(plan?.code || planCode || 'free_trial');
  const fallbackPlan = subscriptionPlans.find((candidate) => (
    normalizeCode(candidate.code) === normalizedPlanCode
    || normalizeCode(candidate.key) === normalizedPlanCode
  ));
  const rawValue = valueCents !== undefined && valueCents !== null
    ? Number(valueCents) / 100
    : value;
  const numericValue = Number(
    rawValue !== undefined && rawValue !== null
      ? rawValue
      : plan?.price ?? fallbackPlan?.price ?? 0
  );

  return {
    planCode: normalizedPlanCode || 'free_trial',
    planName: normalizeText(plan?.name || planName || fallbackPlan?.name || 'Allin Pass'),
    value: Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0,
    currency: normalizeText(currency || 'BRL') || 'BRL',
  };
};

const trackOnce = (eventName, params, eventKey) => {
  if (hasTrackedEvent(eventKey)) return false;

  const tracked = trackStandard(eventName, params);
  if (tracked) rememberTrackedEvent(eventKey);

  return tracked;
};

export const trackSignupCompleted = ({
  source = 'signup',
  method = 'email',
  ...options
} = {}) => {
  const plan = resolvePlan(options);
  const eventKey = buildEventKey('CompleteRegistration', options);

  return trackOnce('CompleteRegistration', {
    content_name: plan.planName,
    content_ids: [plan.planCode],
    currency: plan.currency,
    plan_code: plan.planCode,
    plan_name: plan.planName,
    value: plan.value,
    registration_method: method,
    signup_flow: plan.planCode === 'free_trial' ? 'free_trial' : 'paid',
    source,
  }, eventKey);
};

export const trackSignupTrialStarted = ({
  source = 'signup',
  ...options
} = {}) => {
  const plan = resolvePlan(options);

  if (plan.planCode !== 'free_trial') return false;

  const eventKey = buildEventKey('StartTrial', options);

  return trackOnce('StartTrial', {
    value: 0,
    currency: plan.currency,
    content_name: plan.planName,
    content_ids: [plan.planCode],
    plan_code: plan.planCode,
    plan_name: plan.planName,
    source,
  }, eventKey);
};

export const trackSignupPaymentInfoAdded = ({
  source = 'signup',
  provider = 'asaas',
  ...options
} = {}) => {
  const plan = resolvePlan(options);

  if (plan.planCode === 'free_trial') return false;

  const eventKey = buildEventKey('AddPaymentInfo', options);

  return trackOnce('AddPaymentInfo', {
    value: plan.value,
    currency: plan.currency,
    content_name: plan.planName,
    content_ids: [plan.planCode],
    content_type: 'product',
    contents: [
      {
        id: plan.planCode,
        quantity: 1,
        item_price: plan.value,
      },
    ],
    plan_code: plan.planCode,
    plan_name: plan.planName,
    payment_provider: provider,
    source,
  }, eventKey);
};

export const trackSignupPurchaseCompleted = ({
  source = 'signup',
  ...options
} = {}) => {
  const plan = resolvePlan(options);

  if (plan.planCode === 'free_trial') return false;

  const eventKey = buildEventKey('Purchase', options);

  return trackOnce('Purchase', {
    value: plan.value,
    currency: plan.currency,
    content_name: plan.planName,
    content_ids: [plan.planCode],
    content_type: 'product',
    contents: [
      {
        id: plan.planCode,
        quantity: 1,
        item_price: plan.value,
      },
    ],
    num_items: 1,
    plan_code: plan.planCode,
    plan_name: plan.planName,
    source,
  }, eventKey);
};
