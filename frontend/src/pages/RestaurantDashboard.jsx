import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  BarChart3,
  Bell,
  Check,
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
  Star,
  Users,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  finalizeBillingPlanChange,
  getBillingPlanName,
  getCurrentBillingSubscription,
  getPlanChangeOptions,
  startBillingPlanChange,
} from '@/lib/billing';
import { finalizeSignup, getSignupStatus, startPaidSignupCheckout } from '@/lib/signup';
import { subscriptionPlans } from '@/lib/subscriptionPlans';

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

const formatCurrencyBRL = (value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const loadBillingData = async (projectId) => {
  const subscription = await getCurrentBillingSubscription(projectId);
  const planChangeOptions = await getPlanChangeOptions(subscription);
  return { subscription, planChangeOptions };
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

const getPlanCardTone = (plan) => {
  if (plan?.isCurrent) {
    return {
      wrapper: 'border-purple-300 bg-gradient-to-br from-purple-50 via-white to-indigo-50 shadow-lg shadow-purple-100/70',
      title: 'text-purple-950',
      description: 'text-purple-800/80',
      price: 'text-purple-950',
      muted: 'text-purple-700',
      checkBg: 'bg-purple-100',
      check: 'text-purple-700',
      button: 'border-purple-200 bg-white text-purple-700',
      badge: 'bg-purple-600 text-white',
      feature: 'text-gray-700',
    };
  }

  if (plan?.type === 'trial') {
    return {
      wrapper: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 shadow-lg shadow-emerald-100/70',
      title: 'text-emerald-950',
      description: 'text-emerald-800/80',
      price: 'text-emerald-950',
      muted: 'text-emerald-700',
      checkBg: 'bg-emerald-100',
      check: 'text-emerald-700',
      button: 'bg-emerald-600 text-white hover:bg-emerald-700',
      badge: 'bg-emerald-500 text-white',
      feature: 'text-gray-700',
    };
  }

  if (plan?.highlighted) {
    return {
      wrapper: 'border-transparent bg-gradient-to-br from-purple-600 to-indigo-700 text-white shadow-2xl shadow-purple-500/30',
      title: 'text-white',
      description: 'text-purple-100',
      price: 'text-white',
      muted: 'text-purple-200',
      checkBg: 'bg-white/20',
      check: 'text-white',
      button: 'bg-white text-purple-700 hover:bg-purple-50',
      badge: 'bg-gradient-to-r from-yellow-400 to-orange-400 text-yellow-950',
      feature: 'text-purple-50',
    };
  }

  return {
    wrapper: 'border-gray-200 bg-white shadow-sm hover:border-purple-200 hover:shadow-xl hover:shadow-purple-500/5',
    title: 'text-gray-900',
    description: 'text-gray-500',
    price: 'text-gray-900',
    muted: 'text-gray-500',
    checkBg: 'bg-purple-100',
    check: 'text-purple-600',
    button: 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700',
    badge: 'bg-gradient-to-r from-yellow-400 to-orange-400 text-yellow-950',
    feature: 'text-gray-700',
  };
};

const getPlanChangeHint = (plan) => {
  if (plan?.isCurrent) return 'Ativo agora';
  if (plan?.changeKind === 'downgrade') return 'Menor mensalidade';
  if (plan?.changeKind === 'upgrade') return 'Mais capacidade';
  if (plan?.changeKind === 'trial_conversion') return 'Ativacao paga';
  return 'Troca disponivel';
};

const BillingPlanChoiceCard = ({
  plan,
  busy,
  disabled,
  onSelect,
}) => {
  const tone = getPlanCardTone(plan);
  const badgeText = plan.isCurrent ? 'Plano atual' : plan.badge || plan.highlight;
  const isActionDisabled = disabled || !plan.isSelectable;
  const actionLabel = plan.actionLabel || (plan.changeKind === 'downgrade' ? 'Fazer downgrade' : 'Trocar plano');
  const hasZeroTrialPrice = plan.type === 'trial' && Number(plan.price || 0) <= 0;
  const priceLabel = hasZeroTrialPrice
    ? `${plan.trialDays || 7} dias`
    : formatCurrencyBRL(plan.price).replace(/^R\$\s?/, '');
  const suffixLabel = hasZeroTrialPrice ? 'gratis' : '/mes';

  return (
    <div className={`relative flex h-full min-h-[520px] flex-col rounded-2xl border p-6 transition-all duration-300 ${tone.wrapper}`}>
      {badgeText && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <div className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold shadow-lg ${tone.badge}`}>
            {!plan.isCurrent && plan.badge ? <Star className="h-3 w-3 fill-current" /> : null}
            {badgeText}
          </div>
        </div>
      )}

      <div className="mb-5">
        <p className={`mb-2 text-xs font-semibold uppercase ${tone.muted}`}>{getPlanChangeHint(plan)}</p>
        <h3 className={`text-xl font-bold ${tone.title}`}>{plan.name}</h3>
        <p className={`mt-2 min-h-[40px] text-sm ${tone.description}`}>{plan.description}</p>
      </div>

      <div className="mb-6">
        <div className="flex items-baseline gap-1">
          {!hasZeroTrialPrice ? <span className={`text-sm ${tone.muted}`}>R$</span> : null}
          <span className={`text-4xl font-bold ${tone.price}`}>{priceLabel}</span>
          <span className={`text-sm ${tone.muted}`}>{suffixLabel}</span>
        </div>
      </div>

      <ul className="mb-6 flex-1 space-y-3">
        {(plan.features || []).slice(0, 6).map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${tone.checkBg}`}>
              <Check className={`h-3 w-3 ${tone.check}`} strokeWidth={3} />
            </div>
            <span className={`text-sm ${tone.feature}`}>{feature}</span>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        onClick={() => onSelect(plan)}
        disabled={isActionDisabled}
        className={`min-h-12 w-full gap-2 whitespace-normal px-4 text-sm font-semibold ${tone.button}`}
        variant={plan.isCurrent ? 'outline' : 'default'}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : plan.isCurrent ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <CreditCard className="h-4 w-4" />
        )}
        {actionLabel}
      </Button>
    </div>
  );
};

const RestaurantDashboard = () => {
  const { user, projectId, signOut } = useAuth();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [isProjectNameLoading, setIsProjectNameLoading] = useState(false);
  const [signupStatus, setSignupStatus] = useState(null);
  const [signupStatusLoading, setSignupStatusLoading] = useState(false);
  const [signupStatusError, setSignupStatusError] = useState('');
  const [signupActionLoading, setSignupActionLoading] = useState(false);
  const [billingSubscription, setBillingSubscription] = useState(null);
  const [planChangeOptions, setPlanChangeOptions] = useState([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [planChangeOpen, setPlanChangeOpen] = useState(false);
  const [billingActionPlanCode, setBillingActionPlanCode] = useState('');
  const userMetadataPlanCode = user?.user_metadata?.plan_code || '';
  const userMetadataEstablishmentName = user?.user_metadata?.establishment_name || '';
  const billingPlanName = billingLoading && !billingSubscription
    ? 'Carregando plano'
    : getBillingPlanName(billingSubscription);
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

  const refreshBillingState = useCallback(async () => {
    if (!projectId) {
      setBillingSubscription(null);
      setPlanChangeOptions([]);
      setBillingError('');
      setBillingLoading(false);
      return null;
    }

    setBillingLoading(true);
    setBillingError('');

    try {
      const data = await loadBillingData(projectId);
      setBillingSubscription(data.subscription);
      setPlanChangeOptions(data.planChangeOptions);
      return data.subscription;
    } catch (error) {
      const message = error?.message || 'Nao foi possivel carregar o plano atual.';
      setBillingSubscription(null);
      setPlanChangeOptions([]);
      setBillingError(message);
      return null;
    } finally {
      setBillingLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setBillingSubscription(null);
      setPlanChangeOptions([]);
      setBillingError('');
      setBillingLoading(false);
      return undefined;
    }

    let cancelled = false;
    setBillingLoading(true);
    setBillingError('');

    loadBillingData(projectId)
      .then((data) => {
        if (cancelled) return;
        setBillingSubscription(data.subscription);
        setPlanChangeOptions(data.planChangeOptions);
      })
      .catch((error) => {
        if (cancelled) return;
        setBillingSubscription(null);
        setPlanChangeOptions([]);
        setBillingError(error?.message || 'Nao foi possivel carregar o plano atual.');
      })
      .finally(() => {
        if (!cancelled) setBillingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || typeof window === 'undefined') return undefined;

    const params = new URLSearchParams(window.location.search || '');
    const planChangeStatus = params.get('planChange') || params.get('upgrade');
    const planChangeSessionId = String(params.get('planChangeSessionId') || '').trim();

    if (!planChangeStatus || !planChangeSessionId) return undefined;

    const clearPlanChangeParams = () => {
      const nextParams = new URLSearchParams(window.location.search || '');
      nextParams.delete('planChange');
      nextParams.delete('upgrade');
      nextParams.delete('planChangeSessionId');
      const nextSearch = nextParams.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', nextUrl);
    };

    if (planChangeStatus !== 'success') {
      toast({
        title: planChangeStatus === 'expired' ? 'Checkout expirado' : 'Mudanca nao concluida',
        description: 'Voce pode abrir a selecao de planos e tentar novamente.',
        variant: planChangeStatus === 'expired' ? 'destructive' : undefined,
      });
      clearPlanChangeParams();
      return undefined;
    }

    let cancelled = false;
    setBillingActionPlanCode('finalize');

    finalizeBillingPlanChange({ planChangeSessionId })
      .then(async () => {
        if (cancelled) return;
        await refreshBillingState();
        toast({
          title: 'Plano atualizado',
          description: 'A mudanca de plano foi aplicada ao projeto.',
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setBillingError(error?.message || 'Nao foi possivel finalizar a mudanca de plano.');
        toast({
          title: 'Mudanca pendente',
          description: error?.message || 'Aguarde a confirmacao do pagamento e atualize o painel.',
          variant: 'destructive',
        });
      })
      .finally(() => {
        if (!cancelled) setBillingActionPlanCode('');
        clearPlanChangeParams();
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshBillingState, toast]);

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

    getSignupStatus({ cacheKey: user.id })
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
      const status = await getSignupStatus({ force: true, cacheKey: user.id });
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

  const handleStartPlanChange = useCallback(async (plan) => {
    if (!projectId || !plan?.code || !plan?.isSelectable || billingActionPlanCode) return;

    setBillingActionPlanCode(plan.code);
    setBillingError('');

    try {
      const result = await startBillingPlanChange({
        projectId,
        planCode: plan.code,
      });

      if (result?.checkout_url) {
        window.location.assign(result.checkout_url);
        return;
      }

      await refreshBillingState();
      setPlanChangeOpen(false);
      toast({
        title: 'Plano atualizado',
        description: `Seu projeto agora usa o plano ${plan.name}.`,
      });
    } catch (error) {
      const message = error?.message || 'Nao foi possivel iniciar a mudanca de plano.';
      setBillingError(message);
      toast({
        title: 'Erro ao alterar plano',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setBillingActionPlanCode('');
    }
  }, [billingActionPlanCode, projectId, refreshBillingState, toast]);

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
                <div className="min-w-0 text-right">
                  <p className="hidden max-w-[240px] truncate text-sm text-gray-600 sm:block">{user?.email}</p>
                  <button
                    type="button"
                    onClick={() => setPlanChangeOpen(true)}
                    disabled={!projectId || billingLoading}
                    className="block max-w-[180px] truncate text-xs font-medium text-purple-600 transition-colors hover:text-purple-800 disabled:cursor-default disabled:text-purple-400"
                  >
                    {billingPlanName}
                  </button>
                </div>
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

        <Dialog open={planChangeOpen} onOpenChange={setPlanChangeOpen}>
          <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-6xl">
            <div className="bg-gradient-to-b from-white to-purple-50/40 px-5 py-8 sm:px-8">
              <DialogHeader className="mx-auto max-w-2xl text-center">
                <span className="mx-auto inline-flex rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold uppercase text-purple-700">
                  Planos
                </span>
                <DialogTitle className="mt-3 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                  Escolha seu plano
                </DialogTitle>
              <DialogDescription>
                {billingSubscription
                    ? `${billingPlanName} - ${formatCurrencyBRL(billingSubscription.basePriceCents / 100)}/mes`
                    : 'Carregando dados do plano.'}
              </DialogDescription>
              </DialogHeader>

              <div className="mt-8 space-y-6">
                {billingError && (
                  <div className="mx-auto flex max-w-3xl gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
                    <span>{billingError}</span>
                  </div>
                )}

                {billingLoading ? (
                  <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-md border border-purple-100 bg-purple-50 p-4 text-sm text-purple-700">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando planos
                  </div>
                ) : planChangeOptions.length > 0 ? (
                  <div className="flex flex-wrap justify-center gap-5">
                    {planChangeOptions.map((plan) => (
                      <div key={plan.code} className="w-full sm:w-[300px] xl:w-[260px]">
                        <BillingPlanChoiceCard
                          plan={plan}
                          busy={billingActionPlanCode === plan.code}
                          disabled={Boolean(billingActionPlanCode)}
                          onSelect={handleStartPlanChange}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                    Nao foi possivel carregar os planos disponiveis.
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

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
