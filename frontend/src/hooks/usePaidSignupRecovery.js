import { useCallback, useEffect, useState } from 'react';
import { finalizeSignup, getSignupStatus, startPaidSignupCheckout } from '@/lib/signup';

export function usePaidSignupRecovery({
  projectId,
  toast,
  user,
}) {
  const [signupStatus, setSignupStatus] = useState(null);
  const [signupStatusLoading, setSignupStatusLoading] = useState(false);
  const [signupStatusError, setSignupStatusError] = useState('');
  const [signupActionLoading, setSignupActionLoading] = useState(false);

  const userMetadataPlanCode = user?.user_metadata?.plan_code || '';
  const userMetadataEstablishmentName = user?.user_metadata?.establishment_name || '';

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
        setSignupStatusError(error?.message || 'Nao foi possivel verificar o status da assinatura.');
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
      setSignupStatusError(error?.message || 'Nao foi possivel verificar o status da assinatura.');
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
        title: 'Nao foi possivel continuar',
        description: 'Nao encontramos os dados do plano pago para retomar o checkout.',
        variant: 'destructive',
      });
      return;
    }

    setSignupActionLoading(true);

    try {
      const checkout = await startPaidSignupCheckout({ establishmentName, planCode });
      window.location.assign(checkout.checkout_url);
    } catch (error) {
      const message = error?.message || 'Nao foi possivel iniciar o checkout.';
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
        title: 'Nao foi possivel finalizar',
        description: 'Nao encontramos a confirmacao de pagamento para ativar sua conta.',
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
      const message = error?.message || 'Nao foi possivel finalizar a ativacao.';
      setSignupStatusError(message);
      toast({
        title: 'Erro ao finalizar ativacao',
        description: message,
        variant: 'destructive',
      });
      setSignupActionLoading(false);
    }
  }, [resolvePendingSignupData, signupActionLoading, signupStatus?.checkoutSessionId, toast]);

  return {
    signupStatus,
    signupStatusLoading,
    signupStatusError,
    signupActionLoading,
    handleRefreshSignupStatus,
    handleContinuePayment,
    handleFinalizeActivation,
  };
}
