import React, { useEffect, useRef, useState } from 'react';

import { TURNSTILE_SCRIPT_SRC } from '@/lib/turnstileConfig';

let turnstileScriptPromise = null;

function loadTurnstileScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Turnstile indisponível fora do navegador.'));
  }

  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);

    const handleLoad = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }

      turnstileScriptPromise = null;
      reject(new Error('Turnstile carregou sem expor a API.'));
    };

    const handleError = () => {
      turnstileScriptPromise = null;
      reject(new Error('Não foi possível carregar o Turnstile.'));
    };

    if (existingScript) {
      existingScript.addEventListener('load', handleLoad, { once: true });
      existingScript.addEventListener('error', handleError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

function TurnstileWidget({ siteKey, onTokenChange, onResetReady }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const onResetReadyRef = useRef(onResetReady);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    onResetReadyRef.current = onResetReady;
  }, [onResetReady]);

  useEffect(() => {
    if (!siteKey) return undefined;

    let cancelled = false;
    setStatus('loading');
    onTokenChangeRef.current('');

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;

        try {
          if (widgetIdRef.current && typeof turnstile.remove === 'function') {
            turnstile.remove(widgetIdRef.current);
          }

          setStatus('pending');
          widgetIdRef.current = turnstile.render(containerRef.current, {
            sitekey: siteKey,
            action: 'signup_precheck',
            theme: 'light',
            callback: (token) => {
              setStatus('verified');
              onTokenChangeRef.current(String(token ?? '').trim());
            },
            'expired-callback': () => {
              setStatus('expired');
              onTokenChangeRef.current('');
            },
            'timeout-callback': () => {
              setStatus('expired');
              onTokenChangeRef.current('');
            },
            'error-callback': () => {
              setStatus('error');
              onTokenChangeRef.current('');
            },
          });

          onResetReadyRef.current(() => {
            if (!window.turnstile || !widgetIdRef.current) return;
            window.turnstile.reset(widgetIdRef.current);
            setStatus('pending');
            onTokenChangeRef.current('');
          });
        } catch (error) {
          console.error('Turnstile render error', error);
          setStatus('error');
          onTokenChangeRef.current('');
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Turnstile load error', error);
        setStatus('error');
        onTokenChangeRef.current('');
      });

    return () => {
      cancelled = true;
      onResetReadyRef.current(null);

      if (window.turnstile && widgetIdRef.current && typeof window.turnstile.remove === 'function') {
        window.turnstile.remove(widgetIdRef.current);
      }

      widgetIdRef.current = null;
    };
  }, [siteKey]);

  const statusMessage = {
    loading: 'Carregando verificação antiabuso...',
    pending: 'Confirme a verificação para continuar.',
    verified: 'Verificação concluída.',
    expired: 'A verificação expirou. Confirme novamente para continuar.',
    error: 'Não foi possível carregar a verificação. Recarregue a página e tente novamente.',
  }[status];

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div ref={containerRef} className="min-h-[70px] flex items-center justify-center" />
      <p
        className={`text-xs text-center ${
          status === 'error' || status === 'expired'
            ? 'text-rose-600'
            : status === 'verified'
              ? 'text-emerald-700'
              : 'text-slate-500'
        }`}
      >
        {statusMessage}
      </p>
    </div>
  );
}

export default TurnstileWidget;
