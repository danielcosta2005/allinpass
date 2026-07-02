import { useCallback, useEffect, useState } from 'react';
import {
  finalizeBillingPlanChange,
  getBillingPlanName,
  getPendingBillingPlanChange,
  getBillingSubscriptionForAccess,
  getPlanChangeOptions,
  isBillingCanceled,
  isBillingPastDue,
  isBillingSuspended,
  isTrialExpired as isTrialExpiredSubscription,
  reactivateBillingSubscription,
  scheduleBillingPlanCancellation,
  startBillingPaymentRecovery,
  startBillingPlanChange,
  undoBillingPlanCancellation,
} from '@/lib/billing';
import { supabase } from '@/lib/supabaseClient';

const getBillingAccessState = (subscription) => {
  if (isTrialExpiredSubscription(subscription)) return 'trial_expired';
  if (isBillingCanceled(subscription)) return 'canceled';
  if (isBillingSuspended(subscription)) return 'suspended';
  if (isBillingPastDue(subscription)) return 'past_due';
  if (subscription) return 'active';
  return 'missing';
};

const loadMemberRole = async ({ projectId, userId }) => {
  if (!projectId || !userId) return null;

  const { data, error } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role || null;
};

const loadBillingData = async ({ projectId, userId }) => {
  const [subscription, memberRole, pendingPlanChange] = await Promise.all([
    getBillingSubscriptionForAccess(projectId),
    loadMemberRole({ projectId, userId }),
    getPendingBillingPlanChange(projectId),
  ]);
  const planChangeOptions = await getPlanChangeOptions(subscription, undefined, pendingPlanChange);
  return { subscription, planChangeOptions, memberRole, pendingPlanChange };
};

const isScheduledPlanChangeResult = (result) =>
  Boolean(
    result?.scheduled
      || result?.effective_mode === 'next_cycle'
      || result?.result?.scheduled
      || result?.result?.effective_mode === 'next_cycle'
      || result?.result?.requested_effective_mode === 'next_cycle',
  );

const getPlanChangeSuccessToast = ({ plan, result }) => {
  if (plan?.changeKind === 'downgrade' || isScheduledPlanChangeResult(result)) {
    return {
      title: 'Downgrade agendado',
      description: plan?.name
        ? `Seu plano atual continua ativo até o fim do ciclo. O plano ${plan.name} será aplicado automaticamente no próximo ciclo.`
        : 'Seu plano atual continua ativo até o fim do ciclo. O novo plano será aplicado automaticamente no próximo ciclo.',
    };
  }

  return {
    title: 'Plano atualizado',
    description: plan?.name
      ? `Seu projeto agora usa o plano ${plan.name}.`
      : 'A mudança de plano foi aplicada ao projeto.',
  };
};

export function useRestaurantBilling({ projectId, toast, user }) {
  const [billingSubscription, setBillingSubscription] = useState(null);
  const [planChangeOptions, setPlanChangeOptions] = useState([]);
  const [memberRole, setMemberRole] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [planChangeOpen, setPlanChangeOpen] = useState(false);
  const [billingActionPlanCode, setBillingActionPlanCode] = useState('');
  const [planCancellationAction, setPlanCancellationAction] = useState('');
  const [billingReactivationAction, setBillingReactivationAction] = useState(false);
  const [billingPaymentRecoveryAction, setBillingPaymentRecoveryAction] = useState(false);
  const [pendingPlanChange, setPendingPlanChange] = useState(null);

  const billingAccessState = getBillingAccessState(billingSubscription);
  const isTrialExpired = billingAccessState === 'trial_expired';
  const isBillingCanceledState = billingAccessState === 'canceled';
  const isBillingSuspendedState = billingAccessState === 'suspended';
  const isBillingPastDueState = billingAccessState === 'past_due';
  const canManageBilling = memberRole === 'owner';
  const billingPlanName = billingLoading && !billingSubscription
    ? 'Carregando plano'
    : getBillingPlanName(billingSubscription);

  const refreshBillingState = useCallback(async () => {
    if (!projectId) {
      setBillingSubscription(null);
      setPlanChangeOptions([]);
      setMemberRole(null);
      setPendingPlanChange(null);
      setBillingError('');
      setBillingLoading(false);
      return null;
    }

    setBillingLoading(true);
    setBillingError('');

    try {
      const data = await loadBillingData({ projectId, userId: user?.id });
      setBillingSubscription(data.subscription);
      setPlanChangeOptions(data.planChangeOptions);
      setMemberRole(data.memberRole);
      setPendingPlanChange(data.pendingPlanChange);
      return data.subscription;
    } catch (error) {
      const message = error?.message || 'Não foi possível carregar o plano atual.';
      setBillingSubscription(null);
      setPlanChangeOptions([]);
      setMemberRole(null);
      setPendingPlanChange(null);
      setBillingError(message);
      return null;
    } finally {
      setBillingLoading(false);
    }
  }, [projectId, user?.id]);

  useEffect(() => {
    if (!projectId) {
      setBillingSubscription(null);
      setPlanChangeOptions([]);
      setMemberRole(null);
      setPendingPlanChange(null);
      setBillingError('');
      setBillingLoading(false);
      return undefined;
    }

    let cancelled = false;
    setBillingLoading(true);
    setBillingError('');

    loadBillingData({ projectId, userId: user?.id })
      .then((data) => {
        if (cancelled) return;
        setBillingSubscription(data.subscription);
        setPlanChangeOptions(data.planChangeOptions);
        setMemberRole(data.memberRole);
        setPendingPlanChange(data.pendingPlanChange);
      })
      .catch((error) => {
        if (cancelled) return;
        setBillingSubscription(null);
        setPlanChangeOptions([]);
        setMemberRole(null);
        setPendingPlanChange(null);
        setBillingError(error?.message || 'Não foi possível carregar o plano atual.');
      })
      .finally(() => {
        if (!cancelled) setBillingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, user?.id]);

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
        title: planChangeStatus === 'expired' ? 'Checkout expirado' : 'Mudança não concluída',
        description: 'Você pode abrir a seleção de planos e tentar novamente.',
        variant: planChangeStatus === 'expired' ? 'destructive' : undefined,
      });
      clearPlanChangeParams();
      return undefined;
    }

    let cancelled = false;
    setBillingActionPlanCode('finalize');

    finalizeBillingPlanChange({ planChangeSessionId })
      .then(async (result) => {
        if (cancelled) return;
        await refreshBillingState();
        toast(getPlanChangeSuccessToast({ result }));
      })
      .catch((error) => {
        if (cancelled) return;
        setBillingError(error?.message || 'Não foi possível finalizar a mudança de plano.');
        toast({
          title: 'Mudança pendente',
          description: error?.message || 'Aguarde a confirmação do pagamento e atualize o painel.',
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
      toast(getPlanChangeSuccessToast({ plan, result }));
    } catch (error) {
      const message = error?.message || 'Não foi possível iniciar a mudança de plano.';
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

  const handleSchedulePlanCancellation = useCallback(async () => {
    if (!projectId || !canManageBilling || planCancellationAction) return;

    setPlanCancellationAction('schedule');
    setBillingError('');

    try {
      const result = await scheduleBillingPlanCancellation({ projectId });
      await refreshBillingState();
      toast({
        title: result?.already_scheduled ? 'Cancelamento já agendado' : 'Cancelamento agendado',
        description: 'Seu plano continua ativo até o fim do período de cobrança.',
      });
    } catch (error) {
      const message = error?.message || 'Não foi possível agendar o cancelamento do plano.';
      setBillingError(message);
      toast({
        title: 'Erro ao cancelar plano',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setPlanCancellationAction('');
    }
  }, [canManageBilling, planCancellationAction, projectId, refreshBillingState, toast]);

  const handleUndoPlanCancellation = useCallback(async () => {
    if (!projectId || !canManageBilling || planCancellationAction) return;

    setPlanCancellationAction('undo');
    setBillingError('');

    try {
      await undoBillingPlanCancellation({ projectId });
      await refreshBillingState();
      toast({
        title: 'Assinatura mantida',
        description: 'O cancelamento agendado foi desfeito.',
      });
    } catch (error) {
      const message = error?.message || 'Não foi possível desfazer o cancelamento do plano.';
      setBillingError(message);
      toast({
        title: 'Erro ao manter assinatura',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setPlanCancellationAction('');
    }
  }, [canManageBilling, planCancellationAction, projectId, refreshBillingState, toast]);

  const handleReactivateBillingSubscription = useCallback(async () => {
    if (!projectId || !canManageBilling || billingReactivationAction) return;

    setBillingReactivationAction(true);
    setBillingError('');

    try {
      await reactivateBillingSubscription({ projectId });
      await refreshBillingState();
      toast({
        title: 'Assinatura reativada',
        description: 'Seu projeto voltou ao plano ativo e um novo ciclo de cobrança foi iniciado.',
      });
    } catch (error) {
      const message = error?.message || 'Não foi possível reativar a assinatura.';
      setBillingError(message);
      toast({
        title: 'Erro ao reativar assinatura',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setBillingReactivationAction(false);
    }
  }, [billingReactivationAction, canManageBilling, projectId, refreshBillingState, toast]);

  const handleStartBillingPaymentRecovery = useCallback(async () => {
    if (!projectId || !canManageBilling || billingPaymentRecoveryAction) return;

    setBillingPaymentRecoveryAction(true);
    setBillingError('');

    try {
      const result = await startBillingPaymentRecovery({ projectId });

      if (result?.already_paid) {
        await refreshBillingState();
        toast({
          title: 'Pagamento já identificado',
          description: 'Aguarde a confirmação do pagamento pelo Asaas e atualize o painel.',
        });
        return;
      }

      if (result?.invoice_url) {
        window.location.assign(result.invoice_url);
        return;
      }

      throw new Error('Não foi possível abrir a fatura pendente.');
    } catch (error) {
      const message = error?.message || 'Não foi possível iniciar a regularização do pagamento.';
      setBillingError(message);
      toast({
        title: 'Erro ao regularizar pagamento',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setBillingPaymentRecoveryAction(false);
    }
  }, [billingPaymentRecoveryAction, canManageBilling, projectId, refreshBillingState, toast]);

  return {
    billingSubscription,
    planChangeOptions,
    pendingPlanChange,
    isTrialExpired,
    isBillingCanceled: isBillingCanceledState,
    isBillingSuspended: isBillingSuspendedState,
    isBillingPastDue: isBillingPastDueState,
    billingAccessState,
    memberRole,
    canManageBilling,
    billingLoading,
    billingError,
    planChangeOpen,
    setPlanChangeOpen,
    billingActionPlanCode,
    planCancellationAction,
    billingReactivationAction,
    billingPaymentRecoveryAction,
    billingPlanName,
    handleStartPlanChange,
    handleSchedulePlanCancellation,
    handleUndoPlanCancellation,
    handleReactivateBillingSubscription,
    handleStartBillingPaymentRecovery,
  };
}
