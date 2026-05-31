import { useCallback, useEffect, useState } from 'react';
import {
  finalizeBillingPlanChange,
  getBillingPlanName,
  getCurrentBillingSubscription,
  getPlanChangeOptions,
  startBillingPlanChange,
} from '@/lib/billing';

const loadBillingData = async (projectId) => {
  const subscription = await getCurrentBillingSubscription(projectId);
  const planChangeOptions = await getPlanChangeOptions(subscription);
  return { subscription, planChangeOptions };
};

export function useRestaurantBilling({ projectId, toast }) {
  const [billingSubscription, setBillingSubscription] = useState(null);
  const [planChangeOptions, setPlanChangeOptions] = useState([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [planChangeOpen, setPlanChangeOpen] = useState(false);
  const [billingActionPlanCode, setBillingActionPlanCode] = useState('');

  const billingPlanName = billingLoading && !billingSubscription
    ? 'Carregando plano'
    : getBillingPlanName(billingSubscription);

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

  return {
    billingSubscription,
    planChangeOptions,
    billingLoading,
    billingError,
    planChangeOpen,
    setPlanChangeOpen,
    billingActionPlanCode,
    billingPlanName,
    handleStartPlanChange,
  };
}
