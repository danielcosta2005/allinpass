const GOOGLE_MAPS_API_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_KEY ?? '').trim();

let scriptLoadPromise = null;
let bootstrapInstalled = false;

function ensureBrowserEnvironment() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Google Maps JS API indisponivel fora do navegador.');
  }
}

function ensureApiKey() {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('VITE_GOOGLE_MAPS_KEY nao configurada.');
  }
}

function ensureBootstrap() {
  ensureBrowserEnvironment();
  ensureApiKey();

  if (window.google?.maps?.importLibrary && bootstrapInstalled) {
    return window.google.maps;
  }

  const googleNamespace = window.google || (window.google = {});
  const mapsNamespace = googleNamespace.maps || (googleNamespace.maps = {});

  if (typeof mapsNamespace.importLibrary === 'function' && bootstrapInstalled) {
    return mapsNamespace;
  }

  const requestedLibraries = new Set();
  const callbackName = '__allinpassGoogleMapsInit';
  let scriptEl = null;

  const startLoadingScript = () => {
    if (scriptLoadPromise) {
      return scriptLoadPromise;
    }

    scriptLoadPromise = new Promise((resolve, reject) => {
      scriptEl = document.createElement('script');

      const params = new URLSearchParams();
      params.set('key', GOOGLE_MAPS_API_KEY);
      params.set('v', 'weekly');
      params.set('language', 'pt-BR');
      params.set('region', 'BR');
      params.set('auth_referrer_policy', 'origin');
      params.set('libraries', Array.from(requestedLibraries).join(','));
      params.set('callback', `google.maps.${callbackName}`);

      mapsNamespace[callbackName] = () => {
        delete mapsNamespace[callbackName];
        bootstrapInstalled = true;
        resolve(window.google.maps);
      };

      scriptEl.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      scriptEl.async = true;
      scriptEl.defer = true;
      scriptEl.onerror = () => {
        delete mapsNamespace[callbackName];
        scriptLoadPromise = null;
        reject(new Error('Nao foi possivel carregar o Google Maps.'));
      };
      scriptEl.nonce = document.querySelector('script[nonce]')?.nonce || '';
      document.head.appendChild(scriptEl);
    });

    return scriptLoadPromise;
  };

  mapsNamespace.importLibrary = (library, ...rest) => {
    requestedLibraries.add(library);
    return startLoadingScript().then(() => window.google.maps.importLibrary(library, ...rest));
  };

  bootstrapInstalled = true;
  return mapsNamespace;
}

export async function loadGoogleMapsLibraries(libraries = []) {
  const maps = ensureBootstrap();
  const requested = Array.from(new Set((libraries.length ? libraries : ['maps']).filter(Boolean)));
  await Promise.all(requested.map((library) => maps.importLibrary(library)));
  return window.google.maps;
}

export function hasGoogleMapsClientKey() {
  return Boolean(GOOGLE_MAPS_API_KEY);
}
