import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { LogOut, ScanLine, BarChart3, Wallet, Users, History, Bell, Loader2, MessageCircle, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ScannerTab from '@/components/restaurant/ScannerTab';
import KPIsTab from '@/components/restaurant/KPIsTab';
import CustomersTab from '@/components/superadmin/CustomersTab';
import MembersTab from '@/components/superadmin/MembersTab';
import VisitsTab from '@/components/restaurant/VisitsTab';
import NotificationsDashboard from '@/components/restaurant/NotificationsDashboard';
import RewardsTab from '@/components/restaurant/RewardsTab';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';

const SUPPORT_MESSAGE = 'Olá, preciso de suporte no Allin Pass.';
const SUPPORT_WHATSAPP_URL =
  import.meta.env.VITE_RESTAURANT_SUPPORT_WHATSAPP_URL ||
  `https://wa.me/?text=${encodeURIComponent(SUPPORT_MESSAGE)}`;
const getProjectNameCacheKey = (projectId) => `restaurant_project_name:${projectId}`;
const DASHBOARD_TABS = [
  { value: 'kpis', label: 'KPIs', icon: BarChart3 },
  { value: 'scanner', label: 'Scanner', icon: ScanLine },
  { value: 'customers', label: 'Clientes', icon: Users },
  { value: 'members', label: 'Membros', icon: Users },
  { value: 'visits', label: 'Visitas', icon: History },
  { value: 'notifications', label: 'Notificações', icon: Bell },
  { value: 'rewards', label: 'Recompensas', icon: Gift },
];
const ALLOWED_TABS = new Set(DASHBOARD_TABS.map((tab) => tab.value));

const RestaurantDashboard = () => {
  const { user, projectId, signOut } = useAuth();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [isProjectNameLoading, setIsProjectNameLoading] = useState(false);
  const projectDisplayName = String(projectName || '').trim();

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

  useEffect(() => {
    let cancelled = false;

    const loadProjectName = async () => {
      if (!projectId) {
        setProjectName('');
        setIsProjectNameLoading(false);
        return;
      }

      const projectNameCacheKey = getProjectNameCacheKey(projectId);
      let hasCachedProjectName = false;
      try {
        const cachedProjectName = String(sessionStorage.getItem(projectNameCacheKey) || '').trim();
        if (cachedProjectName) {
          setProjectName(cachedProjectName);
          hasCachedProjectName = true;
        } else {
          setProjectName('');
        }
      } catch (_) {
        setProjectName('');
      }

      setIsProjectNameLoading(!hasCachedProjectName);

      const { data, error } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single();

      if (cancelled) return;

      if (error) {
        console.error('[restaurant-dashboard] erro ao carregar nome do projeto', error);
        setIsProjectNameLoading(false);
        return;
      }

      const nextProjectName = String(data?.name || '').trim();
      setProjectName(nextProjectName);
      setIsProjectNameLoading(false);
      try {
        if (nextProjectName) {
          sessionStorage.setItem(projectNameCacheKey, nextProjectName);
        } else {
          sessionStorage.removeItem(projectNameCacheKey);
        }
      } catch (_) {}
    };

    loadProjectName();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);

    try {
      await signOut();
      try { sessionStorage.removeItem('restaurant_active_tab'); } catch (_) {}
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

      <div className="min-h-screen overflow-x-hidden bg-gradient-to-br from-purple-50 via-white to-indigo-50">
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
                <span className="hidden max-w-[240px] truncate text-sm text-gray-600 sm:block">{user?.email}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSignOut}
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

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 overflow-x-hidden">
          {!projectId ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded-md shadow-lg"
            >
              <p className="font-bold">Atenção</p>
              <p>Seu usuário não está associado a nenhum projeto. Fale com o superadministrador.</p>
            </motion.div>
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
                  aria-label="Navegação do painel do projeto"
                  className="grid w-full grid-cols-2 gap-2 rounded-xl border border-slate-300 bg-slate-100/60 p-1.5 shadow-sm sm:grid-cols-3 xl:grid-cols-7"
                >
                  {DASHBOARD_TABS.map((tab) => (
                    <TabsTrigger key={tab.value} value={tab.value} className="h-10 w-full gap-2 px-2 text-xs sm:px-3 sm:text-sm">
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
