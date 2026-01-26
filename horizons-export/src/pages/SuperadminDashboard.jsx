import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { LogOut, Users, MapPin, Wallet, Settings, LayoutDashboard, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProjectsTab from '@/components/superadmin/ProjectsTab';
import MembersTab from '@/components/superadmin/MembersTab';
import WalletConfigTab from '@/components/superadmin/WalletConfigTab';
import LocationsTab from '@/components/superadmin/LocationsTab';
import CustomersTab from '@/components/superadmin/CustomersTab';
import DashboardTab from '@/components/superadmin/DashboardTab';
import NotificationsConfigTab from '@/components/superadmin/NotificationsConfigTab';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const SuperadminDashboard = () => {
  const { user, signOut } = useAuth();
  const [selectedProject, setSelectedProject] = useState(() => {
    const savedProject = sessionStorage.getItem('superadmin_selected_project')
    return savedProject ? JSON.parse(savedProject) : null;
  });

  const [activeTab, setActiveTab] = useState(() => {
    return sessionStorage.getItem('superadmin_active_tab') || 'dashboard';
  });

  const handleTabChange = (value) => {
    setActiveTab(value);
    sessionStorage.setItem('superadmin_active_tab', value);
  }

  const handleSelectProject = (project) => {
    setSelectedProject(project);
    setActiveTab('wallet');

    sessionStorage.setItem('superadmin_selected_project', JSON.stringify(project));
    sessionStorage.setItem('superadmin_active_tab', 'wallet');
  };

  const handleBackToProjects = () => {
    setSelectedProject(null);
    setActiveTab('projects');
  };

  const TABS = [
    { value: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, disabled: false },
    { value: 'projects', label: 'Projetos', icon: Settings, disabled: false },
    { value: 'wallet', label: 'Wallet', icon: Wallet, disabled: !selectedProject },
    { value: 'notifications', label: 'Notificações', icon: Bell, disabled: !selectedProject },
    { value: 'members', label: 'Membros', icon: Users, disabled: !selectedProject },
    { value: 'locations', label: 'Locais', icon: MapPin, disabled: !selectedProject },
    { value: 'customers', label: 'Clientes', icon: Users, disabled: !selectedProject },
  ];

  return (
    <>
      <Helmet>
        <title>Painel Administrativo - Carteira 4.9</title>
        <meta name="description" content="Gerencie projetos, usuários e configurações do sistema" />
      </Helmet>
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-indigo-50">
        <nav className="bg-white/80 backdrop-blur-xl border-b border-purple-100 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-2 rounded-xl">
                  <Wallet className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
                    Carteira 4.9
                  </h1>
                  <p className="text-xs text-gray-600">Painel Administrativo</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">{user?.email}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={signOut}
                  className="gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sair
                </Button>
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
              <TabsList className="grid w-full grid-cols-3 sm:grid-cols-4 md:grid-cols-7 lg:w-auto lg:inline-grid">
                {TABS.map(tab => (
                  <TabsTrigger key={tab.value} value={tab.value} className="gap-2" disabled={tab.disabled}>
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="dashboard"><DashboardTab /></TabsContent>
              <TabsContent value="projects"><ProjectsTab onSelectProject={handleSelectProject} /></TabsContent>
              <TabsContent value="wallet">{selectedProject && <WalletConfigTab projectId={selectedProject.id} onBack={handleBackToProjects} />}</TabsContent>
              <TabsContent value="notifications">{selectedProject && <NotificationsConfigTab projectId={selectedProject.id} />}</TabsContent>
              <TabsContent value="members">{selectedProject && <MembersTab projectId={selectedProject.id} />}</TabsContent>
              <TabsContent value="locations">{selectedProject && <LocationsTab projectId={selectedProject.id} />}</TabsContent>
              <TabsContent value="customers">{selectedProject && <CustomersTab projectId={selectedProject.id} />}</TabsContent>
            </Tabs>
          </motion.div>
        </main>
      </div>
    </>
  );
};

export default SuperadminDashboard;
