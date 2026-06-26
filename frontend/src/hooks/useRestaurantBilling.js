import { useCallback, useEffect, useState } from 'react';
import {
  finalizeBillingPlanChange,
  getBillingPlanName,
  getPendingBillingPlanChange,
  getBillingSubscriptionForAccess,
  getPlanChangeOptions,
  isBillingPastDue,
  isBillingSuspended,
  isTrialExpired as isTrialExpiredSubscription,
  startBillingPlanChange,
} from '@/lib/billing';
import { supabase } from '@/lib/supabaseClient';

const getBillingAccessState = (subscription) => {
  if (isTrialExpiredSubscription(subscription)) return 'trial_expired';
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
        ? `Seu plano atual continua ativo ate o fim do ciclo. O plano ${plan.name} sera aplicado automaticamente no proximo ciclo.`
        : 'Seu plano atual continua ativo ate o fim do ciclo. O novo plano sera aplicado automaticamente no proximo ciclo.',
    };
  }

  return {
    title: 'Plano atualizado',
    description: plan?.name
      ? `Seu projeto agora usa o plano ${plan.name}.`
      : 'A mudanca de plano foi aplicada ao projeto.',
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

  const billingAccessState = getBillingAccessState(billingSubscription);
  const isTrialExpired = billingAccessState === 'trial_expired';
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
      return data.subscription;
    } catch (error) {
      const message = error?.message || 'Nao foi possivel carregar o plano atual.';
      setBillingSubscription(null);
      setPlanChangeOptions([]);
      setMemberRole(null);
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
      })
      .catch((error) => {
        if (cancelled) return;
        setBillingSubscription(null);
        setPlanChangeOptions([]);
        setMemberRole(null);
        setBillingError(error?.message || 'Nao foi possivel carregar o plano atual.');
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
      .then(async (result) => {
        if (cancelled) return;
        await refreshBillingState();
        toast(getPlanChangeSuccessToast({ result }));
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

  return {
    billingSubscription,
    planChangeOptions,
    isTrialExpired,
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
    billingPlanName,
    handleStartPlanChange,
  };
}
