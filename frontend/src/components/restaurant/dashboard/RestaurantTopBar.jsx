import React from 'react';
import { AlertTriangle, Wallet } from 'lucide-react';
import AccountMenu from '@/components/app/AccountMenu';

function RestaurantTopBar({
  billingAccessState,
  billingLoading,
  billingPlanName,
  onOpenBilling,
  onOpenPlanChange,
  onSignOut,
  projectId,
  showSuspendedNotice = false,
  signingOut,
  userEmail,
}) {
  const isPastDue = billingAccessState === 'past_due';
  const isSuspended = billingAccessState === 'suspended';
  const planTone = isSuspended
    ? 'text-rose-600'
    : isPastDue
      ? 'text-amber-600'
      : 'text-purple-600';
  const planLabel = isSuspended
    ? `${billingPlanName} - suspenso`
    : isPastDue
      ? `${billingPlanName} - pagamento pendente`
      : billingPlanName;

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
              <p className={`max-w-[220px] truncate text-xs font-medium ${planTone}`}>
                {planLabel}
              </p>
            </div>
            <AccountMenu
              billingOptionDisabled={!projectId || billingLoading}
              onOpenBilling={onOpenBilling}
              onOpenPlanChange={onOpenPlanChange}
              onSignOut={onSignOut}
              planChangeDisabled={!projectId || billingLoading || isSuspended}
              profileLabel={userEmail}
              profileMeta={planLabel}
              showBillingOption
              showPlanChangeOption
              signingOut={signingOut}
              userEmail={userEmail}
            />
          </div>
        </div>
      </div>
      {isSuspended && showSuspendedNotice ? (
        <div className="border-t border-rose-100 bg-rose-50/95">
          <div className="mx-auto flex max-w-7xl items-start gap-2 px-4 py-2 text-xs text-rose-800 sm:px-6 sm:text-sm lg:px-8">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-rose-700" />
            <p>
              <span className="font-semibold">Assinatura suspensa.</span> Regularize a cobrança pendente para
              liberar as ações operacionais.
            </p>
          </div>
        </div>
      ) : null}
    </nav>
  );
}

export default RestaurantTopBar;
