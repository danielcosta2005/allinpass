import React, {useState} from 'react';
    import { Helmet } from 'react-helmet';
    import { motion } from 'framer-motion';
    import { LogOut, QrCode, ScanLine, BarChart3, Wallet, Users, History, Bell } from 'lucide-react';
    import { Button } from '@/components/ui/button';
    import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
    import QRTab from '@/components/restaurant/QRTab';
    import ScannerTab from '@/components/restaurant/ScannerTab';
    import KPIsTab from '@/components/restaurant/KPIsTab';
    import CustomersTab from '@/components/superadmin/CustomersTab';
    import VisitsTab from '@/components/restaurant/VisitsTab';
    import NotificationsTab from '@/components/restaurant/NotificationsTab';
    import { useAuth } from '@/contexts/SupabaseAuthContext';

    const RestaurantDashboard = () => {
      const { user, projectId, signOut } = useAuth();

      const [activeTab, setActiveTab] = useState(() => {
        return sessionStorage.getItem('restaurant_active_tab') || 'kpis';
      });

      const handleTabChange = (value) => {
        setActiveTab(value);
        sessionStorage.setItem('restaurant_active_tab', value);
      }

      return (
        <>
          <Helmet>
            <title>Painel do Estabelecimento - Carteira 4.9</title>
            <meta name="description" content="Gerencie seu programa de fidelidade" />
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
                      <p className="text-xs text-gray-600">Painel do Projeto</p>
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
                    <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:w-auto lg:inline-grid">
                      <TabsTrigger value="kpis" className="gap-2">
                        <BarChart3 className="w-4 h-4" />
                        KPIs
                      </TabsTrigger>
                       <TabsTrigger value="notifications" className="gap-2">
                        <Bell className="w-4 h-4" />
                        Notificações
                      </TabsTrigger>
                      <TabsTrigger value="scanner" className="gap-2">
                        <ScanLine className="w-4 h-4" />
                        Scanner
                      </TabsTrigger>
                      <TabsTrigger value="qr" className="gap-2">
                        <QrCode className="w-4 h-4" />
                        Gerar QR
                      </TabsTrigger>
                      <TabsTrigger value="customers" className="gap-2">
                        <Users className="w-4 h-4" />
                        Clientes
                      </TabsTrigger>
                       <TabsTrigger value="visits" className="gap-2">
                        <History className="w-4 h-4" />
                        Visitas
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="kpis">
                      <KPIsTab projectId={projectId} />
                    </TabsContent>
                    <TabsContent value="notifications">
                        <NotificationsTab projectId={projectId} />
                    </TabsContent>
                    <TabsContent value="scanner">
                      <ScannerTab projectId={projectId} />
                    </TabsContent>
                    <TabsContent value="qr">
                      <QRTab projectId={projectId} />
                    </TabsContent>
                    <TabsContent value="customers">
                      <CustomersTab projectId={projectId} />
                    </TabsContent>
                    <TabsContent value="visits">
                      <VisitsTab projectId={projectId} />
                    </TabsContent>
                  </Tabs>
                </motion.div>
              )}
            </main>
          </div>
        </>
      );
    };

    export default RestaurantDashboard;
