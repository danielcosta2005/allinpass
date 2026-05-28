import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  BarChart3,
  Bell,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Gift,
  History,
  Loader2,
  LogOut,
  MessageCircle,
  RefreshCw,
  ScanLine,
  Users,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ScannerTab from '@/components/restaurant/ScannerTab';
import KPIsTab from '@/components/restaurant/KPIsTab';
import CustomersTab from '@/components/superadmin/CustomersTab';
import VisitsTab from '@/components/restaurant/VisitsTab';
import NotificationsDashboard from '@/components/restaurant/NotificationsDashboard';
import RewardsTab from '@/components/restaurant/RewardsTab';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { finalizeSignup, getSignupStatus, startPaidSignupCheckout } from '@/lib/signup';
import { subscriptionPlans } from '@/lib/subscriptionPlans';

const SUPPORT_MESSAGE = 'Olá, preciso de suporte no Allin Pass.';
const SUPPORT_WHATSAPP_URL =
  import.meta.env.VITE_RESTAURANT_SUPPORT_WHATSAPP_URL ||
  `https://wa.me/?text=${encodeURIComponent(SUPPORT_MESSAGE)}`;

const PAID_SIGNUP_RECOVERY_STATES = new Set([
  'payment_pending',
  'payment_retry_available',
]);

const formatPlanName = (planCode) => {
  const normalizedPlanCode = String(planCode || '').trim().toLowerCase();
  if (!normalizedPlanCode) return 'plano selecionado';

  const plan = subscriptionPlans.find((candidate) => candidate.code === normalizedPlanCode);
  return plan?.name || normalizedPlanCode.replace(/_/g, ' ');
};

const getPaidSignupCardCopy = (signupState) => {
  if (signupState === 'payment_confirmed_finalization_pending') {
    return {
      icon: CheckCircle2,
      tone: 'emerald',
      eyebrow: 'Pagamento confirmado',
      title: 'Finalize a ativação da sua conta',
      description:
        'Recebemos a confirmação do pagamento. Falta apenas concluir a criação do projeto para liberar o painel.',
      actionLabel: 'Finalizar ativação',
    };
  }

  if (signupState === 'payment_retry_available') {
    return {
      icon: RefreshCw,
      tone: 'amber',
      eyebrow: 'Pagamento não concluído',
      title: 'Retome sua assinatura',
      description:
        'Sua conta foi criada, mas o pagamento ainda não ativou o plano. Gere um novo checkout seguro para continuar.',
      actionLabel: 'Continuar pagamento',
    };
  }

  return {
    icon: CreditCard,
    tone: 'blue',
    eyebrow: 'Pagamento pendente',
    title: 'Conclua o pagamento para liberar o painel',
    description:
      'Sua conta já existe no AllinPass. Agora falta concluir o checkout seguro do Asaas para ativar o projeto.',
    actionLabel: 'Continuar pagamento',
  };
};

const getToneClasses = (tone) => {
  if (tone === 'emerald') {
    return {
      wrapper: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      icon: 'bg-emerald-600 text-white',
      button: 'bg-emerald-600 hover:bg-emerald-700',
    };
  }

  if (tone === 'amber') {
    return {
      wrapper: 'border-amber-200 bg-amber-50 text-amber-900',
      icon: 'bg-amber-500 text-white',
      button: 'bg-amber-500 hover:bg-amber-600',
    };
  }

  return {
    wrapper: 'border-blue-200 bg-blue-50 text-blue-900',
    icon: 'bg-blue-600 text-white',
    button: 'bg-blue-600 hover:bg-blue-700',
  };
};

const NoProjectSignupState = ({
  actionLoading,
  onContinuePayment,
  onFinalizeActivation,
  onRefreshStatus,
  status,
  statusError,
  statusLoading,
}) => {
  if (statusLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-lg"
      >
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-purple-600" />
        <p className="mt-3 font-semibold text-slate-900">Verificando sua assinatura...</p>
        <p className="mt-1 text-sm text-slate-600">Estamos conferindo se existe pagamento pendente para sua conta.</p>
      </motion.div>
    );
  }

  if (statusError) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-900 shadow-lg"
      >
        <AlertCircle className="mx-auto h-8 w-8" />
        <p className="mt-3 font-bold">Não foi possível verificar sua assinatura</p>
        <p className="mt-1 text-sm">{statusError}</p>
        <Button
          type="button"
          variant="outline"
          onClick={onRefreshStatus}
          className="mt-5 border-red-200 bg-white text-red-700 hover:bg-red-100"
        >
          Tentar novamente
        </Button>
      </motion.div>
    );
  }

  const signupState = status?.signupState || 'no_project_no_signup_context';
  const canContinuePayment = PAID_SIGNUP_RECOVERY_STATES.has(signupState);
  const canFinalizeActivation = signupState === 'payment_confirmed_finalization_pending';

  if (canContinuePayment || canFinalizeActivation) {
    const copy = getPaidSignupCardCopy(signupState);
    const toneClasses = getToneClasses(copy.tone);
    const Icon = copy.icon;
    const planName = formatPlanName(status?.planCode);
    const handleAction = canFinalizeActivation ? onFinalizeActivation : onContinuePayment;

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-2xl border p-6 shadow-lg ${toneClasses.wrapper}`}
      >
        <div className="flex flex-col gap-5 text-left md:flex-row md:items-start md:justify-between">
          <div className="flex gap-4">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${toneClasses.icon}`}>
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em]">{copy.eyebrow}</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-950">{copy.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">{copy.description}</p>
              <div className="mt-4 rounded-xl border border-white/70 bg-white/70 p-3 text-sm text-slate-700">
                <span className="font-semibold text-slate-950">Plano:</span> {planName}
                {status?.checkoutStatus ? (
                  <span className="ml-3">
                    <span className="font-semibold text-slate-950">Status:</span> {status.checkoutStatus}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <Button
            type="button"
            onClick={handleAction}
            disabled={actionLoading}
            className={`min-w-[210px] gap-2 text-white ${toneClasses.button}`}
          >
            {actionLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : canFinalizeActivation ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            {copy.actionLabel}
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded-md shadow-lg"
    >
      <p className="font-bold">Atenção</p>
      <p>Seu usuário não está associado a nenhum projeto, fale com um administrador.</p>
    </motion.div>
  );
};

const RestaurantDashboard = () => {
  const { user, projectId, signOut } = useAuth();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [signupStatus, setSignupStatus] = useState(null);
  const [signupStatusLoading, setSignupStatusLoading] = useState(false);
  const [signupStatusError, setSignupStatusError] = useState('');
  const [signupActionLoading, setSignupActionLoading] = useState(false);
  const userMetadataPlanCode = user?.user_metadata?.plan_code || '';
  const userMetadataEstablishmentName = user?.user_metadata?.establishment_name || '';

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
    const allowedTabs = new Set(['kpis', 'scanner', 'customers', 'visits', 'notifications', 'rewards']);
    if (!allowedTabs.has(activeTab)) {
      setActiveTab('kpis');
      try {
        sessionStorage.setItem('restaurant_active_tab', 'kpis');
      } catch (_) {}
    }
  }, [activeTab]);

  useEffect(() => {
    if (projectId || !user?.id) {
      setSignupStatus(null);
      setSignupStatusError('');
      setSignupStatusLoading(false);
      return undefined;
    }

    let cancelled = false;
    setSignupStatusLoading(true);
    setSignupStatusError('');

    getSignupStatus()
      .then((status) => {
        if (cancelled) return;
        setSignupStatus(status);
      })
      .catch((error) => {
        if (cancelled) return;
        setSignupStatus(null);
        setSignupStatusError(error?.message || 'Não foi possível verificar o status da assinatura.');
      })
      .finally(() => {
        if (!cancelled) setSignupStatusLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, user?.id]);

  const handleRefreshSignupStatus = useCallback(async () => {
    if (projectId || !user?.id) return;

    setSignupStatusLoading(true);
    setSignupStatusError('');

    try {
      const status = await getSignupStatus();
      setSignupStatus(status);
    } catch (error) {
      setSignupStatus(null);
      setSignupStatusError(error?.message || 'Não foi possível verificar o status da assinatura.');
    } finally {
      setSignupStatusLoading(false);
    }
  }, [projectId, user?.id]);

  const resolvePendingSignupData = useCallback(() => {
    const planCode = String(
      signupStatus?.planCode || userMetadataPlanCode || '',
    ).trim().toLowerCase();
    const establishmentName = String(
      signupStatus?.establishmentName || userMetadataEstablishmentName || '',
    ).trim();

    return { planCode, establishmentName };
  }, [
    signupStatus?.establishmentName,
    signupStatus?.planCode,
    userMetadataEstablishmentName,
    userMetadataPlanCode,
  ]);

  const handleContinuePayment = useCallback(async () => {
    if (signupActionLoading) return;

    const { planCode, establishmentName } = resolvePendingSignupData();
    if (!planCode || planCode === 'free_trial' || !establishmentName) {
      toast({
        title: 'Não foi possível continuar',
        description: 'Não encontramos os dados do plano pago para retomar o checkout.',
        variant: 'destructive',
      });
      return;
    }

    setSignupActionLoading(true);

    try {
      const checkout = await startPaidSignupCheckout({ establishmentName, planCode });
      window.location.assign(checkout.checkout_url);
    } catch (error) {
      const message = error?.message || 'Não foi possível iniciar o checkout.';
      setSignupStatusError(message);
      toast({
        title: 'Erro ao abrir checkout',
        description: message,
        variant: 'destructive',
      });
      setSignupActionLoading(false);
    }
  }, [resolvePendingSignupData, signupActionLoading, toast]);

  const handleFinalizeActivation = useCallback(async () => {
    if (signupActionLoading) return;

    const { planCode, establishmentName } = resolvePendingSignupData();
    const checkoutSessionId = String(signupStatus?.checkoutSessionId || '').trim();

    if (!planCode || planCode === 'free_trial' || !establishmentName || !checkoutSessionId) {
      toast({
        title: 'Não foi possível finalizar',
        description: 'Não encontramos a confirmação de pagamento para ativar sua conta.',
        variant: 'destructive',
      });
      return;
    }

    setSignupActionLoading(true);

    try {
      await finalizeSignup({
        establishmentName,
        planCode,
        checkoutSessionId,
        dedupeKey: `org-finalize:${planCode}:${checkoutSessionId}`,
      });

      toast({
        title: 'Conta ativada',
        description: 'Seu projeto foi criado. Vamos recarregar o painel.',
      });
      window.location.assign('/org');
    } catch (error) {
      const message = error?.message || 'Não foi possível finalizar a ativação.';
      setSignupStatusError(message);
      toast({
        title: 'Erro ao finalizar ativação',
        description: message,
        variant: 'destructive',
      });
      setSignupActionLoading(false);
    }
  }, [resolvePendingSignupData, signupActionLoading, signupStatus?.checkoutSessionId, toast]);

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
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-2 rounded-xl">
                  <Wallet className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
                    Allin Pass
                  </h1>
                  <p className="text-xs text-gray-600">Painel do Projeto</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">{user?.email}</span>
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
                <TabsList className="flex w-full flex-wrap gap-2 lg:w-auto lg:inline-flex">
                  <TabsTrigger value="kpis" className="gap-2">
                    <BarChart3 className="w-4 h-4" />
                    KPIs
                  </TabsTrigger>
                  
                  <TabsTrigger value="scanner" className="gap-2">
                    <ScanLine className="w-4 h-4" />
                    Scanner
                  </TabsTrigger>
                  <TabsTrigger value="customers" className="gap-2">
                    <Users className="w-4 h-4" />
                    Clientes
                  </TabsTrigger>
                  <TabsTrigger value="visits" className="gap-2">
                    <History className="w-4 h-4" />
                    Visitas
                  </TabsTrigger>
                  <TabsTrigger value="notifications" className="gap-2">
                    <Bell className="w-4 h-4" />
                    Notificações
                  </TabsTrigger>
                  <TabsTrigger value="rewards" className="gap-2">
                    <Gift className="w-4 h-4" />
                    Recompensas
                  </TabsTrigger>
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

