import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ScannerTab from '@/components/restaurant/ScannerTab';
import KPIsTab from '@/components/restaurant/KPIsTab';
import CustomersTab from '@/components/superadmin/CustomersTab';
import MembersTab from '@/components/superadmin/MembersTab';
import VisitsTab from '@/components/restaurant/VisitsTab';
import NotificationsDashboard from '@/components/restaurant/NotificationsDashboard';
import RewardsTab from '@/components/restaurant/RewardsTab';
import RestaurantTopBar from '@/components/restaurant/dashboard/RestaurantTopBar';
import BillingPlanDialog from '@/components/restaurant/dashboard/BillingPlanDialog';
import NoProjectSignupState from '@/components/restaurant/dashboard/NoProjectSignupState';
import WalletConfigTab from '@/components/superadmin/WalletConfigTab';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { ALLOWED_TABS, DASHBOARD_TABS, SUPPORT_WHATSAPP_URL } from '@/constants/restaurantDashboard';
import { usePaidSignupRecovery } from '@/hooks/usePaidSignupRecovery';
import { useProjectName } from '@/hooks/useProjectName';
import { useRestaurantBilling } from '@/hooks/useRestaurantBilling';

const RestaurantDashboard = () => {
  const { user, projectId, signOut } = useAuth();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const { projectDisplayName, isProjectNameLoading } = useProjectName(projectId);

  const {
    billingSubscription,
    planChangeOptions,
    billingLoading,
    billingError,
    planChangeOpen,
    setPlanChangeOpen,
    billingActionPlanCode,
    billingPlanName,
    handleStartPlanChange,
  } = useRestaurantBilling({ projectId, toast });

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

  const handleTabChange = (value) => {
    setActiveTab(value);
    try {
      sessionStorage.setItem('restaurant_active_tab', value);
    } catch (_) {}
  };

  useEffect(() => {
    if (!ALLOWED_TABS.has(activeTab)) {
      setActiveTab('kpis');
      try {
        sessionStorage.setItem('restaurant_active_tab', 'kpis');
      } catch (_) {}
    }
  }, [activeTab]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);

    try {
      await signOut();
      try {
        sessionStorage.removeItem('restaurant_active_tab');
      } catch (_) {}
    } catch (e) {
      console.error('[logout] erro ao sair', e);
      toast({
        title: 'Nao foi possivel sair agora',
        description: 'Tente novamente. Se persistir, recarregue a pagina.',
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

      <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-purple-50 via-white to-indigo-50">
        <RestaurantTopBar
          billingLoading={billingLoading}
          billingPlanName={billingPlanName}
          onOpenPlanChange={() => setPlanChangeOpen(true)}
          onSignOut={handleSignOut}
          projectId={projectId}
          signingOut={signingOut}
          userEmail={user?.email}
        />

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

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 overflow-x-hidden">
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
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
                <h2 className="min-h-[1.75rem] text-xl font-bold leading-tight text-purple-700 sm:min-h-[2rem] sm:text-2xl">
                  {projectDisplayName ? (
                    projectDisplayName
                  ) : isProjectNameLoading ? (
                    <span
                      aria-label="Carregando nome do projeto"
                      className="inline-block h-7 w-52 animate-pulse rounded-md bg-purple-100 align-middle sm:h-8 sm:w-64"
                    />
                  ) : (
                    'Projeto'
                  )}
                </h2>

                <TabsList
                  aria-label="Navegacao do painel do projeto"
                  className="grid w-full grid-cols-2 gap-2 rounded-xl bg-slate-100/60 p-1.5 shadow-sm sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8"
                >
                  {DASHBOARD_TABS.map((tab) => (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="h-10 w-full gap-2 px-2 text-xs sm:px-3 sm:text-sm"
                    >
                      <tab.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{tab.label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="kpis">
                  <KPIsTab projectId={projectId} />
                </TabsContent>
                <TabsContent value="notifications">
                  <NotificationsDashboard projectId={projectId} />
                </TabsContent>
                <TabsContent value="scanner">
                  <ScannerTab projectId={projectId} />
                </TabsContent>
                <TabsContent value="wallet">
                  <WalletConfigTab projectId={projectId} />
                </TabsContent>
                <TabsContent value="rewards">
                  <RewardsTab projectId={projectId} />
                </TabsContent>
                <TabsContent value="customers">
                  <CustomersTab projectId={projectId} />
                </TabsContent>
                <TabsContent value="members">
                  <MembersTab projectId={projectId} />
                </TabsContent>
                <TabsContent value="visits">
                  <VisitsTab projectId={projectId} />
                </TabsContent>
              </Tabs>
            </motion.div>
          )}
        </main>

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

          <div className="pointer-events-none absolute bottom-full right-0 z-50 mb-3 w-56 rounded-xl border border-slate-200 bg-white p-3 text-left text-slate-900 shadow-xl opacity-0 transition duration-75 group-hover:opacity-100 group-focus-within:opacity-100">
            <p className="text-sm font-semibold">Suporte pelo WhatsApp</p>
            <p className="mt-1 text-xs text-slate-600">Precisa de ajuda? Fale com a nossa equipe!</p>
          </div>
        </div>
      </div>
    </>
  );
};

export default RestaurantDashboard;
