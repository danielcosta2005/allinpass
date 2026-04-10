import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '@/App';
import '@/index.css';
import { AuthProvider } from '@/contexts/SupabaseAuthContext';
import AppErrorBoundary from '@/components/app/AppErrorBoundary';

const MODULE_RELOAD_KEY = '__module_reload_last_attempt_at';
const MODULE_RELOAD_COOLDOWN_MS = 60_000;

function shouldHandleModuleError(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('failed to fetch dynamically imported module') ||
    text.includes('expected a javascript-or-wasm module script') ||
    text.includes('importing a module script failed') ||
    text.includes('loading chunk') ||
    text.includes('chunkloaderror')
  );
}

function extractErrorMessage(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value?.message === 'string') return value.message;
  return String(value);
}

function scheduleSafeReload() {
  try {
    const now = Date.now();
    const lastAttempt = Number(sessionStorage.getItem(MODULE_RELOAD_KEY) || 0);
    if (now - lastAttempt < MODULE_RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(MODULE_RELOAD_KEY, String(now));
  } catch (_) {
    // ignore
  }
  window.location.reload();
}

if (!window.__allinpassModuleErrorHandlersRegistered) {
  window.__allinpassModuleErrorHandlersRegistered = true;

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    scheduleSafeReload();
  });

  window.addEventListener('error', (event) => {
    const message = event?.message || event?.error?.message || '';
    if (shouldHandleModuleError(message)) {
      scheduleSafeReload();
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const message = extractErrorMessage(event?.reason);
    if (shouldHandleModuleError(message)) {
      scheduleSafeReload();
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
);
