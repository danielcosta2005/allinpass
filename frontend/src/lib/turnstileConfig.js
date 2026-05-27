export const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function getTurnstileSiteKey(env = {}) {
  return String(env.VITE_TURNSTILE_SITE_KEY ?? '').trim();
}

export function shouldUseSignupCaptcha({ siteKey }) {
  return Boolean(String(siteKey ?? '').trim());
}
