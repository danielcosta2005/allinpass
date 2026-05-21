import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { LogOut, Users, Wallet, Settings, LayoutDashboard, Bell, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProjectsTab from '@/components/superadmin/ProjectsTab';
import MembersTab from '@/components/superadmin/MembersTab';
import WalletConfigTab from '@/components/superadmin/WalletConfigTab';
import CustomersTab from '@/components/superadmin/CustomersTab';
import DashboardTab from '@/components/superadmin/DashboardTab';
import NotificationsConfigTab from '@/components/superadmin/NotificationsConfigTab';
import AdminTab from '@/components/superadmin/AdminTab';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import {
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

    if (isSuperadmin) {
      tabs.push(
        { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, disabled: false },
        { value: 'admins', label: 'Admins', icon: ShieldCheck, disabled: false },
      );
    }

    tabs.push({ value: 'projects', label: 'Projetos', icon: Settings, disabled: false });

    return tabs;
  }, [isSuperadmin]);

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

    return tabs;
  }, [canManageSelectedProject, isSuperadmin, selectedProject]);

  const availableTabs = useMemo(() => {
    return [...mainTabs, ...projectTabs];
  }, [mainTabs, projectTabs]);

  const isProjectTabActive = useMemo(() => {
    return projectTabs.some((tab) => tab.value === activeTab);
  }, [projectTabs, activeTab]);

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

      <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-purple-50 via-white to-indigo-50">
        <nav className="bg-white/80 backdrop-blur-xl border-b border-purple-100 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-2 rounded-xl">
                  <Wallet className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
                    Allin Pass
                  </h1>
                  <p className="text-xs text-gray-600">Painel Administrativo</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="hidden text-right sm:block">
                  <p className="text-sm text-gray-600">{user?.email}</p>
                  <p className="text-xs font-medium text-purple-600">{isSuperadmin ? 'Superadmin' : 'Admin'}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="gap-2"
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

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 overflow-x-hidden">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
              <TabsList className="flex w-full flex-wrap justify-start gap-1 lg:w-auto">
                {mainTabs.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} className="gap-2" disabled={tab.disabled}>
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {selectedProject && isProjectTabActive && (
                <div className="space-y-0">
                  <TabsList className="flex w-full flex-wrap items-end justify-start gap-1 rounded-none bg-transparent p-0 text-gray-600">
                    {projectTabs.map((tab) => (
                      <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        disabled={tab.disabled}
                        className="gap-2 rounded-t-xl rounded-b-none border border-b border-gray-300 bg-gray-200/80 px-4 py-2 text-sm font-medium text-gray-600 shadow-none transition-colors duration-200 hover:bg-gray-100 hover:text-gray-800 data-[state=active]:-mb-px data-[state=active]:border-gray-300 data-[state=active]:border-b-white data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-none"
                      >
                        <tab.icon className="w-4 h-4" />
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  <div className="rounded-b-xl rounded-tr-xl border border-gray-300 bg-white p-4 sm:p-6">
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
                    {isSuperadmin && (
                      <TabsContent value="members" className="mt-0">
                        {selectedProject && <MembersTab projectId={selectedProject.id} />}
                      </TabsContent>
                    )}
                    {isSuperadmin && (
                      <TabsContent value="customers" className="mt-0">
                        {selectedProject && <CustomersTab projectId={selectedProject.id} />}
                      </TabsContent>
                    )}
                  </div>
                </div>
              )}

              {isSuperadmin && <TabsContent value="dashboard"><DashboardTab /></TabsContent>}
              {isSuperadmin && <TabsContent value="admins"><AdminTab /></TabsContent>}
              <TabsContent value="projects">
                <ProjectsTab
                  onSelectProject={handleSelectProject}
                  canManageProject={canManageProject}
                  canDeleteProjects={canDeleteProject(role)}
                />
              </TabsContent>
            </Tabs>
          </motion.div>
        </main>
      </div>
    </>
  );
};

export default SuperadminDashboard;
