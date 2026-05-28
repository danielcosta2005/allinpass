const PIXEL_ID = '1890317175016680';
const CONSENT_KEY = 'allinpass_cookie_consent';
const CONSENT_VERSION = 1;

const isBrowser = () => typeof window !== 'undefined';
const isFbqReady = () => isBrowser() && typeof window.fbq === 'function';

let pixelInitialized = false;
const listeners = new Set();
let memoryFallbackState = 'unset';

const readStorage = () => {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
};

const writeStorage = (value) => {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
    return true;
  } catch {
    return false;
  }
};

const removeStorage = () => {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // ignore
  }
};

export const getConsentState = () => {
  const raw = readStorage();
  if (!raw) return memoryFallbackState;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.state === 'accepted' || parsed?.state === 'rejected') {
      return parsed.state;
    }
    removeStorage();
    return memoryFallbackState;
  } catch {
    removeStorage();
    return memoryFallbackState;
  }
};

const persistConsent = (state) => {
  memoryFallbackState = state;
  writeStorage(
    JSON.stringify({
      state,
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString(),
    }),
  );
};

const notify = () => {
  const current = getConsentState();
  listeners.forEach((cb) => {
    try {
      cb(current);
    } catch {
      // listener errors must not break the helper
    }
  });
};

export const subscribeConsent = (cb) => {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const initPixel = () => {
  if (pixelInitialized) return;
  if (!isFbqReady()) return;
  try {
    window.fbq('init', PIXEL_ID);
    pixelInitialized = true;
  } catch {
    // pixel loader race or adblock — leave uninitialized
  }
};

export const initPixelIfConsented = () => {
  if (getConsentState() !== 'accepted') return;
  initPixel();
  if (!pixelInitialized) return;
  try {
    window.fbq('track', 'PageView');
  } catch {
    // see initPixel
  }
};

export const acceptConsent = () => {
  if (getConsentState() === 'accepted') return;
  persistConsent('accepted');
  initPixel();
  if (pixelInitialized) {
    try {
      window.fbq('track', 'PageView');
    } catch {
      // ignore
    }
  }
  notify();
};

export const rejectConsent = () => {
  if (getConsentState() === 'rejected') return;
  persistConsent('rejected');
  notify();
};

export const resetConsent = () => {
  memoryFallbackState = 'unset';
  removeStorage();
  notify();
};

const canTrack = () => isFbqReady() && pixelInitialized && getConsentState() === 'accepted';

export const trackStandard = (eventName, params) => {
  if (!canTrack()) return;
  try {
    if (params) {
      window.fbq('track', eventName, params);
    } else {
      window.fbq('track', eventName);
    }
  } catch {
    // pixel may be blocked or stub still loading — ignore silently
  }
};

export const trackCustom = (eventName, params) => {
  if (!canTrack()) return;
  try {
    if (params) {
      window.fbq('trackCustom', eventName, params);
    } else {
      window.fbq('trackCustom', eventName);
    }
  } catch {
    // see trackStandard
  }
};
