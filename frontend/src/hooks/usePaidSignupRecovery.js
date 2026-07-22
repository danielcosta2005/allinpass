import { useCallback, useEffect, useState } from 'react';
import {
  PAID_SIGNUP_FINALIZE_RETRY_DELAYS_MS,
  finalizeSignup,
  getSignupStatus,
  startPaidSignupCheckout,
} from '@/lib/signup';
import {
  trackSignupCompleted,
  trackSignupPaymentInfoAdded,
  trackSignupPurchaseCompleted,
} from '@/lib/signupPixelEvents';
import { normalizeAffiliateRef } from '@/lib/subscriptionPlans';

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
  const userMetadataAffiliateRef = user?.user_metadata?.affiliate_ref || '';

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
    const affiliateRef = normalizeAffiliateRef(
      signupStatus?.affiliateRef || userMetadataAffiliateRef || '',
    );

    return { planCode, establishmentName, affiliateRef };
  }, [
    signupStatus?.establishmentName,
    signupStatus?.affiliateRef,
    signupStatus?.planCode,
    userMetadataAffiliateRef,
    userMetadataEstablishmentName,
    userMetadataPlanCode,
  ]);

  const handleContinuePayment = useCallback(async () => {
    if (signupActionLoading) return;

    const { planCode, establishmentName, affiliateRef } = resolvePendingSignupData();
    const existingCheckoutUrl = String(signupStatus?.checkoutUrl || '').trim();
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
      if (existingCheckoutUrl) {
        trackSignupPaymentInfoAdded({
          source: 'org_paid_signup_recovery',
          planCode,
          checkoutSessionId: signupStatus?.checkoutSessionId,
          valueCents: signupStatus?.amount_cents,
          currency: signupStatus?.currency || 'BRL',
        });
        window.location.assign(existingCheckoutUrl);
        return;
      }

      const checkout = await startPaidSignupCheckout({ establishmentName, planCode, affiliateRef });
      trackSignupPaymentInfoAdded({
        source: 'org_paid_signup_recovery',
        planCode,
        checkoutSessionId: checkout.checkout_session_id,
        providerCheckoutId: checkout.provider_checkout_id,
        valueCents: signupStatus?.amount_cents,
        currency: signupStatus?.currency || 'BRL',
      });
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
  }, [
    resolvePendingSignupData,
    signupActionLoading,
    signupStatus?.amount_cents,
    signupStatus?.checkoutSessionId,
    signupStatus?.checkoutUrl,
    signupStatus?.currency,
    toast,
  ]);

  const handleFinalizeActivation = useCallback(async () => {
    if (signupActionLoading) return;

    const { planCode, establishmentName, affiliateRef } = resolvePendingSignupData();
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
      const result = await finalizeSignup({
        establishmentName,
        planCode,
        checkoutSessionId,
        affiliateRef,
        dedupeKey: `org-finalize:${planCode}:${checkoutSessionId}`,
        retryDelaysMs: PAID_SIGNUP_FINALIZE_RETRY_DELAYS_MS,
      });
      const trackingPayload = {
        source: 'org_paid_signup_recovery',
        planCode: result?.plan?.code || planCode,
        planName: result?.plan?.name,
        projectId: result?.project?.id,
        subscriptionId: result?.subscription?.id,
        checkoutSessionId: result?.checkout?.id || checkoutSessionId,
        valueCents: signupStatus?.amount_cents,
        currency: signupStatus?.currency || 'BRL',
      };

      trackSignupCompleted(trackingPayload);
      trackSignupPurchaseCompleted(trackingPayload);

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
  }, [
    resolvePendingSignupData,
    signupActionLoading,
    signupStatus?.amount_cents,
    signupStatus?.checkoutSessionId,
    signupStatus?.currency,
    toast,
  ]);

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
