import React, { useEffect, useMemo, useState } from 'react';
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
import NoProjectSignupState from '@/components/restaurant/dashboard/NoProjectSignupState';
import TrialExpiredBillingState from '@/components/restaurant/dashboard/TrialExpiredBillingState';
import WalletConfigTab from '@/components/superadmin/WalletConfigTab';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { ALLOWED_TABS, DASHBOARD_TABS, SUPPORT_WHATSAPP_URL } from '@/constants/restaurantDashboard';
import { usePaidSignupRecovery } from '@/hooks/usePaidSignupRecovery';
import { useProjectName } from '@/hooks/useProjectName';
import { useRestaurantBilling } from '@/hooks/useRestaurantBilling';
import {
  STAFF_MANAGEABLE_MEMBER_ROLES,
  canAccessRestaurantMembersTab,
  canManageStaffMembers,
} from '@/lib/adminPermissions';
import { supabase } from '@/lib/supabaseClient';

const RestaurantDashboard = () => {
  const { user, projectId, signOut } = useAuth();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [memberRole, setMemberRole] = useState(undefined);
  const { projectDisplayName, isProjectNameLoading } = useProjectName(projectId);
  const canSeeMembersTab = canAccessRestaurantMembersTab(memberRole);
  const canManageMembers = canManageStaffMembers({ memberRole });
  const dashboardTabs = useMemo(() => (
    DASHBOARD_TABS.filter((tab) => tab.value !== 'members' || canSeeMembersTab)
  ), [canSeeMembersTab]);
  const allowedTabs = useMemo(() => new Set(dashboardTabs.map((tab) => tab.value)), [dashboardTabs]);

  const {
    isTrialExpired,
    billingAccessState,
    billingLoading,
    billingError,
    billingPlanName,
  } = useRestaurantBilling({ projectId, toast, user });

  const {
    signupStatus,
    signupStatusLoading,
    signupStatusError,
    handleRefreshSignupStatus,
  } = usePaidSignupRecovery({ projectId, toast, user });

  const [activeTab, setActiveTab] = useState(() => {
    try {
      return sessionStorage.getItem('restaurant_active_tab') || 'kpis';
    } catch (_) {
      return 'kpis';
    }
  });

  const handleTabChange = (value) => {
    if (!allowedTabs.has(value)) return;
    setActiveTab(value);
    try {
      sessionStorage.setItem('restaurant_active_tab', value);
    } catch (_) {}
  };

  const billingBlocked = isTrialExpired && billingAccessState === 'trial_expired';

  useEffect(() => {
    if (memberRole === undefined && ALLOWED_TABS.has(activeTab)) return;
    if (!allowedTabs.has(activeTab)) {
      setActiveTab('kpis');
      try {
        sessionStorage.setItem('restaurant_active_tab', 'kpis');
      } catch (_) {}
    }
  }, [activeTab, allowedTabs, memberRole]);

  useEffect(() => {
    let cancelled = false;

    async function fetchMemberRole() {
      setMemberRole(undefined);

      if (!projectId || !user?.id) {
        setMemberRole(null);
        return;
      }

      const { data, error } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;
      setMemberRole(error ? null : data?.role || null);
    }

    fetchMemberRole();

    return () => {
      cancelled = true;
    };
  }, [projectId, user?.id]);

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
          onSignOut={handleSignOut}
          projectId={projectId}
          signingOut={signingOut}
          userEmail={user?.email}
        />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 overflow-x-hidden">
          {!projectId ? (
            <NoProjectSignupState
              onRefreshStatus={handleRefreshSignupStatus}
              status={signupStatus}
              statusError={signupStatusError}
              statusLoading={signupStatusLoading}
            />
          ) : billingBlocked ? (
            <TrialExpiredBillingState
              billingError={billingError}
              billingLoading={billingLoading}
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
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-100/60 py-1.5 px-4 shadow-sm"
                >
                  {dashboardTabs.map((tab) => (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="h-10 min-w-[8rem] flex-1 gap-2 px-2 text-xs sm:px-3 sm:text-sm lg:min-w-0 lg:flex-none"
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
                {canSeeMembersTab && (
                  <TabsContent value="members">
                    <MembersTab
                      projectId={projectId}
                      canCreateMembers={canManageMembers}
                      canEditMembers={canManageMembers}
                      canRemoveMembers={canManageMembers}
                      manageableRoles={STAFF_MANAGEABLE_MEMBER_ROLES}
                    />
                  </TabsContent>
                )}
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
