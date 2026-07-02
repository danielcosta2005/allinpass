import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Users, Wallet, Settings, LayoutDashboard, Bell, ShieldCheck, CreditCard } from 'lucide-react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import DashboardShell from '@/components/dashboard/DashboardShell';
import ProjectsTab from '@/components/superadmin/ProjectsTab';
import MembersTab from '@/components/superadmin/MembersTab';
import WalletConfigTab from '@/components/superadmin/WalletConfigTab';
import CustomersTab from '@/components/superadmin/CustomersTab';
import DashboardTab from '@/components/superadmin/DashboardTab';
import FinancialPlansTab from '@/components/superadmin/FinancialPlansTab';
import NotificationsConfigTab from '@/components/superadmin/NotificationsConfigTab';
import AdminTab from '@/components/superadmin/AdminTab';
import AffiliatesTab from '@/components/superadmin/AffiliatesTab';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import {
  canAccessAdminPanel,
  canDeleteProject,
  canGeneratePass,
  canManageProject as canManageProjectByRole,
  canSeeSuperadminTabs,
  getDefaultAdminTab,
} from '@/lib/adminPermissions';

const SuperadminDashboard = () => {
  const { user, role, signOut } = useAuth();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const isSuperadmin = canSeeSuperadminTabs(role);
  const canAccessKpiMembersAndCustomers = canAccessAdminPanel(role);
  const defaultTab = getDefaultAdminTab(role);

  const [selectedProject, setSelectedProject] = useState(() => {
    try {
      const savedProject = sessionStorage.getItem('superadmin_selected_project');
      return savedProject ? JSON.parse(savedProject) : null;
    } catch (_) {
      sessionStorage.removeItem('superadmin_selected_project');
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState(() => {
    try {
      return sessionStorage.getItem('superadmin_active_tab') || defaultTab;
    } catch (_) {
      return defaultTab;
    }
  });

  const canManageProject = useCallback((project) => {
    return canManageProjectByRole({ role, userId: user?.id, project });
  }, [role, user?.id]);

  const canManageSelectedProject = selectedProject
    ? canGeneratePass({ role, userId: user?.id, project: selectedProject })
    : false;

  const handleTabChange = (value) => {
    setActiveTab(value);
    try {
      sessionStorage.setItem('superadmin_active_tab', value);
    } catch (_) {}
  };

  const handleSelectProject = (project) => {
    if (!canManageProject(project)) {
      toast({
        title: 'Somente visualização',
        description: 'Admins só podem editar e gerar passes de projetos criados por eles.',
        variant: 'destructive',
      });
      return;
    }

    setSelectedProject(project);
    setActiveTab('wallet');

    try {
      sessionStorage.setItem('superadmin_selected_project', JSON.stringify(project));
      sessionStorage.setItem('superadmin_active_tab', 'wallet');
    } catch (_) {}
  };

  const handleBackToProjects = () => {
    setSelectedProject(null);
    setActiveTab('projects');
    try {
      sessionStorage.removeItem('superadmin_selected_project');
      sessionStorage.setItem('superadmin_active_tab', 'projects');
    } catch (_) {}
  };

  const handleDashboardHome = () => {
    setSelectedProject(null);
    setActiveTab(defaultTab);
    try {
      sessionStorage.removeItem('superadmin_selected_project');
      sessionStorage.setItem('superadmin_active_tab', defaultTab);
    } catch (_) {}
  };

  useEffect(() => {
    if (selectedProject && !canManageProject(selectedProject)) {
      setSelectedProject(null);
      try {
        sessionStorage.removeItem('superadmin_selected_project');
      } catch (_) {}
    }
  }, [selectedProject, canManageProject]);

  const mainTabs = useMemo(() => {
    const tabs = [];

    if (canAccessKpiMembersAndCustomers) {
      tabs.push(
        { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, disabled: false },
      );
    }

    if (isSuperadmin) {
      tabs.push(
        { value: 'financeiro', label: 'Financeiro', icon: CreditCard, disabled: false },
      );
    }

    if (canAccessKpiMembersAndCustomers) {
      tabs.push({ value: 'admins', label: 'Admins', icon: ShieldCheck, disabled: false });
    }

    if (isSuperadmin) {
      tabs.push({ value: 'affiliates', label: 'Afiliados', icon: Users, disabled: false });
    }

    tabs.push({ value: 'projects', label: 'Projetos', icon: Settings, disabled: false });

    return tabs;
  }, [canAccessKpiMembersAndCustomers, isSuperadmin]);

  const projectTabs = useMemo(() => {
    if (!selectedProject) {
      return [];
    }

    const tabs = [
      { value: 'wallet', label: 'Wallet', icon: Wallet, disabled: !canManageSelectedProject },
    ];

    if (isSuperadmin) {
      tabs.push(
        { value: 'notifications', label: 'Notificações', icon: Bell, disabled: false },
        { value: 'members', label: 'Membros', icon: Users, disabled: false },
        { value: 'customers', label: 'Clientes', icon: Users, disabled: false },
      );
    }

    if (!isSuperadmin && canAccessKpiMembersAndCustomers) {
      tabs.push(
        { value: 'members', label: 'Membros', icon: Users, disabled: false },
        { value: 'customers', label: 'Clientes', icon: Users, disabled: false },
      );
    }

    return tabs;
  }, [canAccessKpiMembersAndCustomers, canManageSelectedProject, isSuperadmin, selectedProject]);

  const availableTabs = useMemo(() => {
    return [...mainTabs, ...projectTabs];
  }, [mainTabs, projectTabs]);

  const adminNavGroups = useMemo(() => {
    return [
      { label: 'Global', items: mainTabs },
      selectedProject
        ? { label: selectedProject.name || 'Projeto selecionado', items: projectTabs }
        : null,
    ].filter(Boolean);
  }, [mainTabs, projectTabs, selectedProject]);

  const accountMenuProps = useMemo(() => ({
    onSignOut: handleSignOut,
    profileLabel: user?.email,
    profileMeta: isSuperadmin ? 'Superadmin' : 'Admin',
    showPlanChangeOption: false,
    signingOut,
    userEmail: user?.email,
  }), [handleSignOut, isSuperadmin, signingOut, user?.email]);

  useEffect(() => {
    const currentTab = availableTabs.find((tab) => tab.value === activeTab);
    if (!currentTab || currentTab.disabled) {
      const fallback = 'projects';
      setActiveTab(fallback);
      try {
        sessionStorage.setItem('superadmin_active_tab', fallback);
      } catch (_) {}
    }
  }, [availableTabs, activeTab]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);

    try {
      await signOut();
      try {
        sessionStorage.removeItem('superadmin_selected_project');
        sessionStorage.removeItem('superadmin_active_tab');
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
        <title>Painel Administrativo - Allin Pass</title>
        <meta name="description" content="Gerencie projetos, usuários e configurações do sistema" />
      </Helmet>

      <DashboardShell
        accountMenuProps={accountMenuProps}
        activeItem={activeTab}
        brandLabel="Allin Pass"
        brandMeta="Painel Administrativo"
        contentHeader={null}
        navGroups={adminNavGroups}
        onBrandClick={handleDashboardHome}
        onNavigate={handleTabChange}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
            <TabsContent value="wallet" className="mt-0">
              {selectedProject && canManageSelectedProject && (
                <WalletConfigTab projectId={selectedProject.id} onBack={handleBackToProjects} />
              )}
            </TabsContent>
            {isSuperadmin && (
              <TabsContent value="notifications" className="mt-0">
                {selectedProject && <NotificationsConfigTab projectId={selectedProject.id} />}
              </TabsContent>
            )}
            {canAccessKpiMembersAndCustomers && (
              <TabsContent value="members" className="mt-0">
                {selectedProject && <MembersTab projectId={selectedProject.id} canManageMembers={isSuperadmin} />}
              </TabsContent>
            )}
            {canAccessKpiMembersAndCustomers && (
              <TabsContent value="customers" className="mt-0">
                {selectedProject && <CustomersTab projectId={selectedProject.id} />}
              </TabsContent>
            )}
            {canAccessKpiMembersAndCustomers && (
              <TabsContent value="dashboard" className="mt-0">
                <DashboardTab showFinancialKpis={isSuperadmin} />
              </TabsContent>
            )}
            {isSuperadmin && (
              <TabsContent value="financeiro" className="mt-0">
                <FinancialPlansTab />
              </TabsContent>
            )}
            {canAccessKpiMembersAndCustomers && (
              <TabsContent value="admins" className="mt-0">
                <AdminTab />
              </TabsContent>
            )}
            {isSuperadmin && (
              <TabsContent value="affiliates" className="mt-0">
                <AffiliatesTab />
              </TabsContent>
            )}
            <TabsContent value="projects" className="mt-0">
              <ProjectsTab
                onSelectProject={handleSelectProject}
                canManageProject={canManageProject}
                canDeleteProjects={canDeleteProject(role)}
              />
            </TabsContent>
          </Tabs>
        </motion.div>
      </DashboardShell>
    </>
  );
};

export default SuperadminDashboard;
