import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import DashboardShell from '@/components/dashboard/DashboardShell';
import ScannerTab from '@/components/restaurant/ScannerTab';
import KPIsTab from '@/components/restaurant/KPIsTab';
import CustomersTab from '@/components/superadmin/CustomersTab';
import MembersTab from '@/components/superadmin/MembersTab';
import VisitsTab from '@/components/restaurant/VisitsTab';
import NotificationsDashboard from '@/components/restaurant/NotificationsDashboard';
import RewardsTab from '@/components/restaurant/RewardsTab';
import BillingDashboardDialog from '@/components/restaurant/dashboard/BillingDashboardDialog';
import BillingPastDueNotice from '@/components/restaurant/dashboard/BillingPastDueNotice';
import BillingPlanDialog from '@/components/restaurant/dashboard/BillingPlanDialog';
import BillingSuspendedState from '@/components/restaurant/dashboard/BillingSuspendedState';
import NoProjectSignupState from '@/components/restaurant/dashboard/NoProjectSignupState';
import TrialExpiredBillingState from '@/components/restaurant/dashboard/TrialExpiredBillingState';
import WalletConfigTab from '@/components/superadmin/WalletConfigTab';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import {
  ALLOWED_TABS,
  DASHBOARD_TABS,
  NOTIFICATION_SUBTABS,
  REWARD_SUBTABS,
  SUPPORT_WHATSAPP_URL,
} from '@/constants/restaurantDashboard';
import { usePaidSignupRecovery } from '@/hooks/usePaidSignupRecovery';
import { useProjectName } from '@/hooks/useProjectName';
import { useRestaurantBilling } from '@/hooks/useRestaurantBilling';

const RestaurantDashboard = () => {
  const { user, projectId, signOut } = useAuth();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [billingSuspensionDismissed, setBillingSuspensionDismissed] = useState(false);
  const [billingDashboardOpen, setBillingDashboardOpen] = useState(false);
  const { projectDisplayName, isProjectNameLoading } = useProjectName(projectId);

  const {
    billingSubscription,
    planChangeOptions,
    pendingPlanChange,
    isTrialExpired,
    isBillingSuspended,
    isBillingPastDue,
    billingAccessState,
    memberRole,
    canManageBilling,
    billingLoading,
    billingError,
    planChangeOpen,
    setPlanChangeOpen,
    billingActionPlanCode,
    planCancellationAction,
    billingPlanName,
    handleStartPlanChange,
    handleSchedulePlanCancellation,
    handleUndoPlanCancellation,
  } = useRestaurantBilling({ projectId, toast, user });

  const {
    signupStatus,
    signupStatusLoading,
    signupStatusError,
    signupActionLoading,
    handleRefreshSignupStatus,
    handleContinuePayment,
    handleFinalizeActivation,
  } = usePaidSignupRecovery({ projectId, toast, user });

  const [activeTab, setActiveTab] = useState(() => {
    try {
      return sessionStorage.getItem('restaurant_active_tab') || 'kpis';
    } catch (_) {
      return 'kpis';
    }
  });

  const [activeNotificationTab, setActiveNotificationTab] = useState(() => {
    try {
      const savedTab = sessionStorage.getItem('restaurant_notifications_tab');
      return NOTIFICATION_SUBTABS.some((tab) => tab.value === savedTab) ? savedTab : NOTIFICATION_SUBTABS[0].value;
    } catch (_) {
      return NOTIFICATION_SUBTABS[0].value;
    }
  });

  const [activeRewardTab, setActiveRewardTab] = useState(() => {
    try {
      const savedTab = sessionStorage.getItem('restaurant_rewards_tab');
      return REWARD_SUBTABS.some((tab) => tab.value === savedTab) ? savedTab : REWARD_SUBTABS[0].value;
    } catch (_) {
      return REWARD_SUBTABS[0].value;
    }
  });

  const handleTabChange = (value) => {
    setActiveTab(value);
    try {
      sessionStorage.setItem('restaurant_active_tab', value);
    } catch (_) {}
  };

  const handleNotificationSubTabChange = (value) => {
    setActiveNotificationTab(value);
    try {
      sessionStorage.setItem('restaurant_notifications_tab', value);
    } catch (_) {}
  };

  const handleRewardSubTabChange = (value) => {
    setActiveRewardTab(value);
    try {
      sessionStorage.setItem('restaurant_rewards_tab', value);
    } catch (_) {}
  };

  const trialBillingBlocked = isTrialExpired && billingAccessState === 'trial_expired';
  const handleOpenPlanChange = () => {
    if (trialBillingBlocked && !canManageBilling) return;
    if (isBillingSuspended) return;
    setPlanChangeOpen(true);
  };

  useEffect(() => {
    if (!isBillingSuspended) setBillingSuspensionDismissed(false);
  }, [isBillingSuspended]);

  useEffect(() => {
    if (!ALLOWED_TABS.has(activeTab)) {
      setActiveTab('kpis');
      try {
        sessionStorage.setItem('restaurant_active_tab', 'kpis');
      } catch (_) {}
    }
  }, [activeTab]);

  const isPastDue = billingAccessState === 'past_due';
  const isSuspended = billingAccessState === 'suspended';
  const planLabel = isSuspended
    ? `${billingPlanName} - suspenso`
    : isPastDue
      ? `${billingPlanName} - pagamento pendente`
      : billingPlanName;

  const canSendNotifications = memberRole === 'owner';
  const notificationSubTabs = useMemo(() => {
    return canSendNotifications
      ? NOTIFICATION_SUBTABS
      : NOTIFICATION_SUBTABS.filter((tab) => tab.value !== 'send');
  }, [canSendNotifications]);
  const defaultNotificationTab = notificationSubTabs[0]?.value || 'manager';

  useEffect(() => {
    if (!notificationSubTabs.some((tab) => tab.value === activeNotificationTab)) {
      handleNotificationSubTabChange(defaultNotificationTab);
    }
  }, [activeNotificationTab, defaultNotificationTab, notificationSubTabs]);

  const navItems = useMemo(() => (
    DASHBOARD_TABS.map((tab) => {
      if (tab.value === 'notifications') {
        return { ...tab, children: notificationSubTabs };
      }

      return tab;
    })
  ), [notificationSubTabs]);

  const navGroups = useMemo(() => [
    {
      label: 'Projeto',
      items: navItems,
    },
  ], [navItems]);

  const activeSubItem = activeTab === 'notifications'
    ? activeNotificationTab
    : activeTab === 'rewards'
      ? activeRewardTab
      : null;

  const handleDashboardNavigate = (value, subValue) => {
    if (value === 'notifications') {
      if (!subValue) return;
      handleNotificationSubTabChange(subValue);
    }

    if (value === 'rewards') {
      if (!subValue) return;
      handleRewardSubTabChange(subValue);
    }

    handleTabChange(value);
  };

  const accountMenuProps = useMemo(() => ({
    billingOptionDisabled: !projectId || billingLoading,
    onOpenBilling: () => setBillingDashboardOpen(true),
    onOpenPlanChange: handleOpenPlanChange,
    onSignOut: handleSignOut,
    planChangeDisabled: !projectId || billingLoading || isSuspended,
    profileLabel: user?.email,
    profileMeta: planLabel,
    projectName: projectId
      ? projectDisplayName || (isProjectNameLoading ? 'Carregando projeto...' : 'Projeto')
      : null,
    showBillingOption: true,
    showPlanChangeOption: true,
    signingOut,
    userEmail: user?.email,
  }), [
    billingLoading,
    handleOpenPlanChange,
    isSuspended,
    planLabel,
    projectDisplayName,
    projectId,
    isProjectNameLoading,
    signingOut,
    user?.email,
  ]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);

    try {
      await signOut();
      try {
        sessionStorage.removeItem('restaurant_active_tab');
        sessionStorage.removeItem('restaurant_notifications_tab');
        sessionStorage.removeItem('restaurant_rewards_tab');
      } catch (_) {}
    } catch (e) {
      console.error('[logout] erro ao sair', e);
      toast({
        title: 'Não foi possível sair agora',
        description: 'Tente novamente. Se persistir, recarregue a página.',
        variant: 'destructive',
      });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>Painel do Estabelecimento - Allin Pass</title>
        <meta name="description" content="Gerencie seu programa de fidelidade" />
      </Helmet>

      <DashboardShell
        accountMenuProps={accountMenuProps}
        activeItem={activeTab}
        activeSubItem={activeSubItem}
        brandLabel="Allin Pass"
        contentHeader={null}
        navGroups={navGroups}
        onBrandClick={() => handleTabChange('kpis')}
        onNavigate={handleDashboardNavigate}
        statusNotice={isBillingSuspended && billingSuspensionDismissed
          ? 'Regularize a cobrança pendente para liberar as ações operacionais.'
          : null}
      >
        <BillingPlanDialog
          billingActionPlanCode={billingActionPlanCode}
          billingError={billingError}
          billingLoading={billingLoading}
          billingPlanName={billingPlanName}
          billingSubscription={billingSubscription}
          onOpenChange={setPlanChangeOpen}
          onStartPlanChange={handleStartPlanChange}
          open={planChangeOpen}
          planChangeOptions={planChangeOptions}
        />

        <BillingDashboardDialog
          canManageBilling={canManageBilling}
          onSchedulePlanCancellation={handleSchedulePlanCancellation}
          onOpenChange={setBillingDashboardOpen}
          onUndoPlanCancellation={handleUndoPlanCancellation}
          open={billingDashboardOpen}
          pendingPlanChange={pendingPlanChange}
          planCancellationAction={planCancellationAction}
          projectId={projectId}
        />

        {!projectId ? (
          <NoProjectSignupState
            actionLoading={signupActionLoading}
            onContinuePayment={handleContinuePayment}
            onFinalizeActivation={handleFinalizeActivation}
            onRefreshStatus={handleRefreshSignupStatus}
            status={signupStatus}
            statusError={signupStatusError}
            statusLoading={signupStatusLoading}
          />
        ) : trialBillingBlocked ? (
          <TrialExpiredBillingState
            billingError={billingError}
            billingLoading={billingLoading}
            canManageBilling={canManageBilling}
            onOpenPlanChange={handleOpenPlanChange}
            planChangeOptions={planChangeOptions}
          />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {isBillingPastDue ? (
              <BillingPastDueNotice subscription={billingSubscription} />
            ) : null}

            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
              <TabsContent value="kpis" className="mt-0">
                <KPIsTab projectId={projectId} />
              </TabsContent>
              <TabsContent value="notifications" className="mt-0">
                <NotificationsDashboard
                  activeTab={activeNotificationTab}
                  memberRole={billingLoading ? undefined : memberRole}
                  onTabChange={handleNotificationSubTabChange}
                  projectId={projectId}
                />
              </TabsContent>
              <TabsContent value="scanner" className="mt-0">
                <ScannerTab projectId={projectId} />
              </TabsContent>
              <TabsContent value="wallet" className="mt-0">
                <WalletConfigTab projectId={projectId} />
              </TabsContent>
              <TabsContent value="rewards" className="mt-0">
                <RewardsTab
                  activeTab={activeRewardTab}
                  onTabChange={handleRewardSubTabChange}
                  projectId={projectId}
                />
              </TabsContent>
              <TabsContent value="customers" className="mt-0">
                <CustomersTab projectId={projectId} />
              </TabsContent>
              <TabsContent value="members" className="mt-0">
                <MembersTab projectId={projectId} />
              </TabsContent>
              <TabsContent value="visits" className="mt-0">
                <VisitsTab projectId={projectId} />
              </TabsContent>
            </Tabs>
          </motion.div>
        )}

        {projectId && !trialBillingBlocked && isBillingSuspended && !billingSuspensionDismissed ? (
          <BillingSuspendedState
            billingError={billingError}
            onDismiss={() => setBillingSuspensionDismissed(true)}
            supportUrl={SUPPORT_WHATSAPP_URL}
          />
        ) : null}

        <div className="group fixed bottom-5 right-5 z-40 flex items-center">
          <a
            href={SUPPORT_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Abrir chat de suporte no WhatsApp"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30 transition hover:from-purple-700 hover:to-indigo-700 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-purple-300"
          >
            <MessageCircle className="h-7 w-7" />
          </a>

          <div className="pointer-events-none absolute bottom-full right-0 z-50 mb-3 w-56 rounded-xl border border-border bg-popover p-3 text-left text-popover-foreground shadow-xl opacity-0 transition duration-75 group-hover:opacity-100 group-focus-within:opacity-100">
            <p className="text-sm font-semibold">Suporte pelo WhatsApp</p>
            <p className="mt-1 text-xs text-muted-foreground">Precisa de ajuda? Fale com a nossa equipe!</p>
          </div>
        </div>
      </DashboardShell>
    </>
  );
};

export default RestaurantDashboard;
