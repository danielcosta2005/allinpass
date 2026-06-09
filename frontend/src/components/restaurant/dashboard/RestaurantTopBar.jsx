import React from 'react';
import { Loader2, LogOut, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';

function RestaurantTopBar({
  billingLoading,
  billingPlanName,
  onSignOut,
  projectId,
  signingOut,
  userEmail,
}) {
  return (
    <nav className="bg-white/80 backdrop-blur-xl border-b border-purple-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-2 rounded-xl">
              <Wallet className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
                Allin Pass
              </h1>
              <p className="hidden text-xs text-gray-600 sm:block">Painel do Projeto</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <div className="min-w-0 text-right">
              <p className="hidden max-w-[240px] truncate text-sm text-gray-600 sm:block">{userEmail}</p>
              <p
                aria-busy={billingLoading}
                className={`block max-w-[180px] truncate text-xs font-medium ${
                  projectId ? 'text-purple-600' : 'text-purple-400'
                }`}
              >
                {billingPlanName}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onSignOut}
              disabled={signingOut}
              className="gap-2 whitespace-nowrap"
            >
              {signingOut ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogOut className="w-4 h-4" />
              )}
              Sair
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}

export default RestaurantTopBar;
