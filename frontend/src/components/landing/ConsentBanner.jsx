import React, { useEffect, useState } from 'react';
import { Cookie } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  acceptConsent,
  getConsentState,
  rejectConsent,
  subscribeConsent,
} from '@/lib/metaPixel';

function ConsentBanner({ onLearnMore }) {
  const [state, setState] = useState(getConsentState);

  useEffect(() => subscribeConsent(setState), []);

  if (state !== 'unset') return null;

  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      className="fixed bottom-0 inset-x-0 z-[100] border-t border-purple-200 bg-white/95 backdrop-blur-xl shadow-2xl shadow-purple-900/10"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
          <div className="flex items-start gap-3 flex-1">
            <div className="hidden sm:flex shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 items-center justify-center shadow-lg shadow-purple-500/20">
              <Cookie className="w-5 h-5 text-white" />
            </div>
            <div className="text-sm text-gray-700 leading-relaxed">
              <p className="font-semibold text-gray-900 mb-0.5">
                Usamos cookies pra mensurar campanhas
              </p>
              <p>
                Este site usa o Meta Pixel pra entender como você interage com a página
                e mensurar a eficácia das nossas campanhas de marketing.{' '}
                <button
                  type="button"
                  onClick={onLearnMore}
                  className="text-purple-700 hover:text-purple-800 font-medium underline underline-offset-2"
                >
                  Saiba mais
                </button>
                . Você pode mudar sua escolha a qualquer momento no link "Cookies" do rodapé.
              </p>
            </div>
          </div>

          <div className="flex flex-row gap-2 shrink-0 lg:items-center">
            <Button
              type="button"
              variant="outline"
              onClick={rejectConsent}
              className="flex-1 lg:flex-none h-10 px-5 border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Recusar
            </Button>
            <Button
              type="button"
              onClick={acceptConsent}
              className="flex-1 lg:flex-none h-10 px-5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-lg shadow-purple-500/20"
            >
              Aceitar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConsentBanner;
