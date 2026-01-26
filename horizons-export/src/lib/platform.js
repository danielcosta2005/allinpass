export function getPlatform() {
  if (typeof window === "undefined") return { ios: false, android: false, desktop: true, ua: "" };
  const ua = navigator.userAgent || navigator.vendor || window.opera || "";
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  return { ios, android, desktop: !ios && !android, ua: String(ua) };
}

export function isInAppBrowser() {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  // instagram, tiktok, facebook app webviews
  return /(instagram|fbav|fb_iab|fban|tiktok)/i.test(ua);
}