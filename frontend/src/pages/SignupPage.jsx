import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_PLAN_KEY,
  fetchSubscriptionPlans,
  findPlanByKey,
  formatCurrencyBRL,
  isPaidPlan,
  subscriptionPlans,
} from '@/lib/subscriptionPlans';
import {
  clearExistingCustomerSignupContext,
  finalizeSignup,
  precheckFreeTrialSignup,
  readExistingCustomerSignupContext,
  sendExistingCustomerSignupLink,
  startPaidSignupCheckout,
} from '@/lib/signup';
import {
  TURNSTILE_SCRIPT_SRC,
  getTurnstileSiteKey,
  shouldUseSignupCaptcha,
} from '@/lib/turnstileConfig';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import PlanCard from '@/components/landing/PlanCard';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let turnstileScriptPromise = null;
const FRIENDLY_SIGNUP_RATE_LIMIT_MESSAGE = 'Aguarde alguns minutos para tentar novamente';
const SIGNUP_PASSWORD_SETUP_REQUIRED_STORAGE_KEY = '__signup_password_setup_required';

const PASSWORD_RULES = [
  { id: 'length', label: 'Pelo menos 10 caracteres', test: (value) => value.length >= 10 },
  { id: 'upper', label: 'Uma letra maiúscula', test: (value) => /[A-Z]/.test(value) },
  { id: 'lower', label: 'Uma letra minúscula', test: (value) => /[a-z]/.test(value) },
  { id: 'number', label: 'Um número', test: (value) => /\d/.test(value) },
  { id: 'symbol', label: 'Um símbolo especial', test: (value) => /[^A-Za-z0-9]/.test(value) },
];

function evaluatePassword(password) {
  const checks = PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.test(password),
  }));
  const score = checks.filter((rule) => rule.met).length;
  const progress = Math.max(8, (score / PASSWORD_RULES.length) * 100);
  const strength =
    score <= 1
      ? { label: 'Muito fraca', textColor: 'text-rose-600', barColor: 'bg-rose-500' }
      : score <= 3
        ? { label: 'Em evolução', textColor: 'text-amber-600', barColor: 'bg-amber-500' }
        : { label: 'Forte', textColor: 'text-emerald-600', barColor: 'bg-emerald-500' };

  return {
    checks,
    score,
    progress,
    ...strength,
    isStrong: score >= 4,
  };
}

function markSignupPasswordSetupRequired() {
  try {
    sessionStorage.setItem(SIGNUP_PASSWORD_SETUP_REQUIRED_STORAGE_KEY, '1');
  } catch (_) {}
}

function clearSignupPasswordSetupRequired() {
  try {
    sessionStorage.removeItem(SIGNUP_PASSWORD_SETUP_REQUIRED_STORAGE_KEY);
  } catch (_) {}
}

function isSignupPasswordSetupRequired() {
  try {
    return sessionStorage.getItem(SIGNUP_PASSWORD_SETUP_REQUIRED_STORAGE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function loadTurnstileScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Turnstile indisponível fora do navegador.'));
  }

  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);

    const handleLoad = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }

      turnstileScriptPromise = null;
      reject(new Error('Turnstile carregou sem expor a API.'));
    };

    const handleError = () => {
      turnstileScriptPromise = null;
      reject(new Error('Não foi possível carregar o Turnstile.'));
    };

    if (existingScript) {
      existingScript.addEventListener('load', handleLoad, { once: true });
      existingScript.addEventListener('error', handleError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

function TurnstileWidget({ siteKey, onTokenChange, onResetReady }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const onResetReadyRef = useRef(onResetReady);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    onResetReadyRef.current = onResetReady;
  }, [onResetReady]);

  useEffect(() => {
    if (!siteKey) return undefined;

    let cancelled = false;
    setStatus('loading');
    onTokenChangeRef.current('');

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;

        try {
          if (widgetIdRef.current && typeof turnstile.remove === 'function') {
            turnstile.remove(widgetIdRef.current);
          }

          setStatus('pending');
          widgetIdRef.current = turnstile.render(containerRef.current, {
            sitekey: siteKey,
            action: 'signup_precheck',
            theme: 'light',
            callback: (token) => {
              setStatus('verified');
              onTokenChangeRef.current(String(token ?? '').trim());
            },
            'expired-callback': () => {
              setStatus('expired');
              onTokenChangeRef.current('');
            },
            'timeout-callback': () => {
              setStatus('expired');
              onTokenChangeRef.current('');
            },
            'error-callback': () => {
              setStatus('error');
              onTokenChangeRef.current('');
            },
          });

          onResetReadyRef.current(() => {
            if (!window.turnstile || !widgetIdRef.current) return;
            window.turnstile.reset(widgetIdRef.current);
            setStatus('pending');
            onTokenChangeRef.current('');
          });
        } catch (error) {
          console.error('Turnstile render error', error);
          setStatus('error');
          onTokenChangeRef.current('');
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Turnstile load error', error);
        setStatus('error');
        onTokenChangeRef.current('');
      });

    return () => {
      cancelled = true;
      onResetReadyRef.current(null);

      if (window.turnstile && widgetIdRef.current && typeof window.turnstile.remove === 'function') {
        window.turnstile.remove(widgetIdRef.current);
      }

      widgetIdRef.current = null;
    };
  }, [siteKey]);

  const statusMessage = {
    loading: 'Carregando verificação antiabuso...',
    pending: 'Confirme a verificação para continuar.',
    verified: 'Verificação concluída.',
    expired: 'A verificação expirou. Confirme novamente para continuar.',
    error: 'Não foi possível carregar a verificação. Recarregue a página e tente novamente.',
  }[status];

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div ref={containerRef} className="min-h-[70px] flex items-center justify-center" />
      <p
        className={`text-xs text-center ${
          status === 'error' || status === 'expired'
            ? 'text-rose-600'
            : status === 'verified'
              ? 'text-emerald-700'
              : 'text-slate-500'
        }`}
      >
        {statusMessage}
      </p>
    </div>
  );
}

function normalizeSignupErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  if (
    message.includes('email rate limit exceeded')
    || code === 'over_email_send_rate_limit'
  ) {
    return FRIENDLY_SIGNUP_RATE_LIMIT_MESSAGE;
  }

  return error?.message || 'Nao foi possivel iniciar o cadastro.';
}

function getPasswordError(password, passwordState) {
  if (!password) {
    return 'Crie uma senha forte para proteger os dados da sua conta.';
  }

  if (!passwordState.isStrong) {
    const missingRules = passwordState.checks
      .filter((rule) => !rule.met)
      .map((rule) => rule.label.toLowerCase());
    return `Sua senha ainda precisa de: ${missingRules.join(', ')}.`;
  }

  return '';
}

function findPlanKeyByCode(planCode, plans = subscriptionPlans) {
  const normalizedCode = String(planCode || '').trim().toLowerCase();
  if (!normalizedCode) return '';

  const matchedPlan = plans.find((plan) => String(plan?.code || '').trim().toLowerCase() === normalizedCode);
  return String(matchedPlan?.key || '').trim();
}

function SignupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshAuthProfile, session: authSession } = useAuth();
  const { toast } = useToast();
  const finalizeFromRedirectRef = useRef(false);
  const [availablePlans, setAvailablePlans] = useState(subscriptionPlans);
  const [resolvedPlanCode, setResolvedPlanCode] = useState(
    () => String(searchParams.get('planCode') || '').trim().toLowerCase()
  );
  const existingCustomerSignupContext = readExistingCustomerSignupContext();
  const contextPlanKey = String(existingCustomerSignupContext?.planKey || '').trim();
  const contextPlanCode = String(existingCustomerSignupContext?.planCode || '').trim().toLowerCase();
  const selectedPlanKey = useMemo(() => {
    const explicitPlanKey = String(searchParams.get('plano') || '').trim();
    if (explicitPlanKey) return explicitPlanKey;

    const planCodeFromUrl = String(searchParams.get('planCode') || '').trim().toLowerCase();
    const planKeyFromUrlCode = findPlanKeyByCode(planCodeFromUrl, availablePlans);
    if (planKeyFromUrlCode) return planKeyFromUrlCode;

    if (contextPlanKey) return contextPlanKey;

    const planKeyFromContextCode = findPlanKeyByCode(contextPlanCode, availablePlans);
    if (planKeyFromContextCode) return planKeyFromContextCode;

    const planKeyFromResolvedCode = findPlanKeyByCode(resolvedPlanCode, availablePlans);
    if (planKeyFromResolvedCode) return planKeyFromResolvedCode;

    const planCodeFromMetadata = String(authSession?.user?.user_metadata?.plan_code || '').trim().toLowerCase();
    const planKeyFromMetadataCode = findPlanKeyByCode(planCodeFromMetadata, availablePlans);
    if (planKeyFromMetadataCode) return planKeyFromMetadataCode;

    return DEFAULT_PLAN_KEY;
  }, [searchParams, availablePlans, contextPlanKey, contextPlanCode, resolvedPlanCode, authSession]);
  const shouldFinalizeFromRedirect = searchParams.get('finalizar') === '1';
  const shouldSetupPasswordFromRedirect = searchParams.get('passwordSetup') === '1';
  const selectedPlan = useMemo(
    () => findPlanByKey(selectedPlanKey, availablePlans),
    [availablePlans, selectedPlanKey]
  );
  const paidPlan = isPaidPlan(selectedPlan);
  const totalSteps = paidPlan ? 3 : 2;
  const checkoutStatusFromRedirect = String(searchParams.get('checkout') || '').trim().toLowerCase();
  const checkoutSessionIdFromRedirect = String(searchParams.get('checkoutSessionId') || '').trim();

  const [step, setStep] = useState(1);
  const [finishedFlow, setFinishedFlow] = useState('');
  const [confirmationFlow, setConfirmationFlow] = useState('signup');
  const [pendingNewSignup, setPendingNewSignup] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [signupLoading, setSignupLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [passwordSetupValue, setPasswordSetupValue] = useState('');
  const [passwordSetupTouched, setPasswordSetupTouched] = useState(false);
  const [passwordSetupLoading, setPasswordSetupLoading] = useState(false);
  const [passwordSetupError, setPasswordSetupError] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const turnstileResetRef = useRef(null);
  const [formData, setFormData] = useState({
    establishmentName: '',
    email: '',
    emailConfirmation: '',
    password: '',
  });

  const turnstileSiteKey = useMemo(() => getTurnstileSiteKey(import.meta.env), []);
  const passwordState = useMemo(() => evaluatePassword(formData.password), [formData.password]);
  const passwordSetupState = useMemo(
    () => evaluatePassword(passwordSetupValue),
    [passwordSetupValue]
  );
  const signupCaptchaEnabled = useMemo(
    () => shouldUseSignupCaptcha({ paidPlan, siteKey: turnstileSiteKey }),
    [paidPlan, turnstileSiteKey]
  );

  const activeStep = finishedFlow === 'create-password' || finishedFlow === 'set-password'
    ? 2
    : finishedFlow
      ? totalSteps
      : step;

  const steps = paidPlan ? ['Cadastro', 'Senha', 'Pagamento'] : ['Cadastro', 'Senha'];

  const setField = (field, value) => {
    setFormData((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: '' }));
  };

  const setFieldTouched = (field) => {
    setTouched((previous) => ({ ...previous, [field]: true }));
  };

  const validateStepOne = () => {
    const nextErrors = {};

    if (!formData.establishmentName.trim()) {
      nextErrors.establishmentName = 'Informe o nome do estabelecimento para continuar.';
    }

    if (!formData.email.trim()) {
      nextErrors.email = 'Informe um e-mail válido para acessar sua conta.';
    } else if (!EMAIL_REGEX.test(formData.email)) {
      nextErrors.email = 'Esse e-mail parece inválido. Verifique o formato.';
    }

    if (!formData.emailConfirmation.trim()) {
      nextErrors.emailConfirmation = 'Confirme o e-mail para evitar erros de acesso.';
    } else if (formData.emailConfirmation !== formData.email) {
      nextErrors.emailConfirmation = 'Os e-mails não conferem. Ajuste para continuar.';
    }

    return nextErrors;
  };

  const provisionSignup = useCallback(async ({
    establishmentName,
    planCode,
    userId,
    checkoutSessionId = '',
  }) => {
    const result = await finalizeSignup({
      establishmentName,
      planCode: planCode || 'free_trial',
      checkoutSessionId,
      dedupeKey: userId
        ? `signup-finalize:${userId}:${planCode || 'free_trial'}:${checkoutSessionId || 'free'}`
        : '',
    });

    await refreshAuthProfile();
    return result;
  }, [refreshAuthProfile]);

  const buildSignupEmailRedirectTo = useCallback((metadata = {}) => {
    const planCode = String(metadata.planCode || selectedPlan?.code || 'free_trial').trim().toLowerCase();
    const params = new URLSearchParams({
      plano: selectedPlanKey,
      planCode,
    });
    const establishmentName = String(metadata.establishmentName || '').trim();
    const isPaidEmailPlan = planCode && planCode !== 'free_trial';

    if (!isPaidEmailPlan) params.set('finalizar', '1');
    if (isPaidEmailPlan) params.set('checkout', 'pending');
    if (establishmentName) params.set('establishmentName', establishmentName);

    return `${window.location.origin}/cadastro?${params.toString()}`;
  }, [selectedPlan, selectedPlanKey]);

  const handlePasswordSetupSubmit = async (event) => {
    event.preventDefault();
    setPasswordSetupTouched(true);
    setPasswordSetupError('');

    if (!authSession?.user) {
      const message = 'Sua sessão expirou. Abra o magic link novamente para criar sua senha.';
      setPasswordSetupError(message);
      toast({
        title: 'Sessão expirada',
        description: message,
        variant: 'destructive',
      });
      return;
    }

    if (!passwordSetupValue) {
      setPasswordSetupError('Crie uma senha forte para acessar sua conta depois.');
      return;
    }

    if (!passwordSetupState.isStrong) {
      const missingRules = passwordSetupState.checks
        .filter((rule) => !rule.met)
        .map((rule) => rule.label.toLowerCase());
      setPasswordSetupError(`Sua senha ainda precisa de: ${missingRules.join(', ')}.`);
      return;
    }

    setPasswordSetupLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password: passwordSetupValue });

      if (error) throw error;

      clearSignupPasswordSetupRequired();
      setPasswordSetupValue('');
      setPasswordSetupTouched(false);
      setPasswordSetupError('');
      await refreshAuthProfile();
      toast({
        title: 'Senha criada',
        description: 'Agora você pode acessar sua conta com e-mail e senha.',
      });
      navigate('/org', { replace: true });
    } catch (error) {
      const message = error?.message || 'Não foi possível criar sua senha agora.';
      setPasswordSetupError(message);
      toast({
        title: 'Erro ao criar senha',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setPasswordSetupLoading(false);
    }
  };

  const handleCreatePasswordSubmit = async (event) => {
    event.preventDefault();
    setAttemptedSubmit(true);
    setSignupError('');

    const passwordError = getPasswordError(formData.password, passwordState);
    if (passwordError) {
      setErrors((previous) => ({ ...previous, password: passwordError }));
      return;
    }

    const signupContext = pendingNewSignup;
    if (!signupContext?.email || !signupContext?.establishmentName) {
      const message = 'Não foi possível recuperar os dados do cadastro. Revise o e-mail e tente novamente.';
      setSignupError(message);
      toast({
        title: 'Cadastro incompleto',
        description: message,
        variant: 'destructive',
      });
      setFinishedFlow('');
      setStep(1);
      return;
    }

    setSignupLoading(true);

    try {
      const signupPlanIsPaid = String(signupContext.planCode || '').trim().toLowerCase() !== 'free_trial';
      const emailRedirectTo = buildSignupEmailRedirectTo({
        establishmentName: signupContext.establishmentName,
        planCode: signupContext.planCode,
      });
      const { data, error } = await supabase.auth.signUp({
        email: signupContext.email,
        password: formData.password,
        options: {
          data: {
            establishment_name: signupContext.establishmentName,
            plan_code: signupContext.planCode,
            plan_key: selectedPlanKey,
          },
          emailRedirectTo,
        },
      });

      if (error) throw error;

      clearExistingCustomerSignupContext();
      setPendingNewSignup(null);

      if (!data?.session) {
        setConfirmationFlow('signup');
        setFinishedFlow('confirm-email');
        toast({
          title: 'Confirme seu e-mail',
          description: signupPlanIsPaid
            ? 'Enviamos um link para continuar sua assinatura.'
            : 'Enviamos um link para finalizar seu Free Trial.',
        });
        return;
      }

      if (signupPlanIsPaid) {
        await refreshAuthProfile();
        setStep(3);
        setFinishedFlow('');
        setCheckoutError('');
        toast({
          title: 'Conta criada',
          description: 'Agora siga para o checkout seguro do Asaas para ativar sua assinatura.',
        });
        return;
      }

      await provisionSignup({
        establishmentName: signupContext.establishmentName,
        planCode: signupContext.planCode,
        userId: data?.session?.user?.id || data?.user?.id,
      });
      setFinishedFlow('trial');
    } catch (error) {
      const message = normalizeSignupErrorMessage(error);
      setSignupError(message);
      toast({
        title: 'Erro no cadastro',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setSignupLoading(false);
    }
  };

  const handleStepOneSubmit = async (event) => {
    event.preventDefault();
    setAttemptedSubmit(true);
    setSignupError('');
    const nextErrors = validateStepOne();
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) return;

    if (signupCaptchaEnabled && !captchaToken) {
      const message = 'Confirme a verificacao antiabuso para iniciar o cadastro.';
      setSignupError(message);
      toast({
        title: 'Verificação pendente',
        description: message,
        variant: 'destructive',
      });
      return;
    }

    setSignupLoading(true);

    try {
      const establishmentName = formData.establishmentName.trim();
      const normalizedEmail = formData.email.trim().toLowerCase();
      const planCode = selectedPlan?.code || 'free_trial';
      setResolvedPlanCode(String(planCode).trim().toLowerCase());
      const precheck = await precheckFreeTrialSignup({
        email: normalizedEmail,
        establishmentName,
        planCode,
        captchaToken: signupCaptchaEnabled ? captchaToken : '',
      });

      if (precheck.code === 'existing_customer') {
        const emailRedirectTo = buildSignupEmailRedirectTo({ establishmentName, planCode });
        await sendExistingCustomerSignupLink({
          email: normalizedEmail,
          emailRedirectTo,
          establishmentName,
          planCode,
          planKey: selectedPlanKey,
        });

        setConfirmationFlow('existing-customer');
        setFinishedFlow('confirm-email');
        toast({
          title: 'Confira seu e-mail',
          description: paidPlan
            ? 'Enviamos um link de acesso para continuar sua assinatura.'
            : 'Enviamos um link de acesso para finalizar seu Free Trial.',
        });
        return;
      }

      if (!precheck.canProceed) {
        const message = precheck.message
          || 'Não foi possível iniciar o cadastro agora. Se você já possui conta, faça login ou tente novamente.';
        throw new Error(message);
      }

      setPendingNewSignup({
        establishmentName,
        email: normalizedEmail,
        planCode,
      });
      setFormData((previous) => ({
        ...previous,
        email: normalizedEmail,
        emailConfirmation: normalizedEmail,
        password: '',
      }));
      setTouched((previous) => ({ ...previous, password: false }));
      setErrors((previous) => ({ ...previous, password: '' }));
      setAttemptedSubmit(false);
      setFinishedFlow('create-password');
    } catch (error) {
      const message = normalizeSignupErrorMessage(error);
      setSignupError(message);
      toast({
        title: 'Erro no cadastro',
        description: message,
        variant: 'destructive',
      });
      turnstileResetRef.current?.();
    } finally {
      setSignupLoading(false);
    }
  };

  const handleResendConfirmationEmail = async () => {
    if (resendLoading) return;

    const normalizedEmail = formData.email.trim().toLowerCase();
    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      const message = 'Informe um e-mail válido para reenviar a confirmação.';
      setSignupError(message);
      toast({
        title: 'E-mail inválido',
        description: message,
        variant: 'destructive',
      });
      return;
    }

    setSignupError('');
    setResendLoading(true);

    try {
      if (confirmationFlow === 'existing-customer') {
        await sendExistingCustomerSignupLink({
          email: normalizedEmail,
          emailRedirectTo: buildSignupEmailRedirectTo({
            establishmentName: formData.establishmentName.trim(),
            planCode: selectedPlan?.code || 'free_trial',
          }),
          establishmentName: formData.establishmentName.trim(),
          planCode: selectedPlan?.code || 'free_trial',
          planKey: selectedPlanKey,
        });
      } else {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: normalizedEmail,
          options: {
            emailRedirectTo: buildSignupEmailRedirectTo({
              establishmentName: formData.establishmentName.trim(),
              planCode: selectedPlan?.code || 'free_trial',
            }),
          },
        });

        if (error) throw error;
      }

      toast({
        title: 'E-mail reenviado',
        description: confirmationFlow === 'existing-customer'
          ? paidPlan
            ? 'Enviamos um novo link de acesso para continuar sua assinatura.'
            : 'Enviamos um novo link de acesso para finalizar o Free Trial.'
          : paidPlan
            ? 'Se a confirmacao ainda estiver pendente, enviamos um novo link para continuar sua assinatura.'
            : 'Se a confirmacao ainda estiver pendente, enviamos um novo link para finalizar o Free Trial.',
      });
    } catch (error) {
      const message = normalizeSignupErrorMessage(error);
      setSignupError(message);
      toast({
        title: 'Não foi possível reenviar',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setResendLoading(false);
    }
  };

  const handlePaymentContinue = async () => {
    if (checkoutLoading) return;

    if (!authSession?.user) {
      setCheckoutError('Crie sua conta e confirme o e-mail antes de iniciar o checkout.');
      return;
    }

    setCheckoutError('');
    setCheckoutLoading(true);

    try {
      const establishmentName = String(
        formData.establishmentName
          || authSession.user.user_metadata?.establishment_name
          || '',
      ).trim();
      const planCode = String(selectedPlan?.code || resolvedPlanCode || '').trim().toLowerCase();

      if (!establishmentName) {
        throw new Error('Nao foi possivel identificar o nome do estabelecimento.');
      }

      if (!planCode || planCode === 'free_trial') {
        throw new Error('Selecione um plano pago para continuar.');
      }

      const checkout = await startPaidSignupCheckout({
        establishmentName,
        planCode,
      });

      window.location.assign(checkout.checkout_url);
    } catch (error) {
      const message = error?.message || 'Nao foi possivel iniciar o checkout do Asaas.';
      setCheckoutError(message);
      toast({
        title: 'Erro no checkout',
        description: message,
        variant: 'destructive',
      });
      setCheckoutLoading(false);
    }
  };

  const shouldShowError = (field) => Boolean(errors[field]) && (attemptedSubmit || touched[field]);

  useEffect(() => {
    if (!signupCaptchaEnabled) {
      setCaptchaToken('');
      turnstileResetRef.current = null;
    }
  }, [signupCaptchaEnabled]);

  useEffect(() => {
    let mounted = true;

    const loadPlans = async () => {
      const remotePlans = await fetchSubscriptionPlans();
      if (mounted && Array.isArray(remotePlans) && remotePlans.length > 0) {
        setAvailablePlans(remotePlans);
      }
    };

    loadPlans();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const user = authSession?.user ?? null;
    if (!user || shouldFinalizeFromRedirect) return;
    if (finishedFlow === 'paid' || finishedFlow === 'set-password') return;
    if (Boolean(user?.app_metadata?.signup_project_id)) return;

    const existingCustomerContext = readExistingCustomerSignupContext();
    const sessionEmail = String(user.email || '').trim().toLowerCase();
    const redirectEstablishmentName = String(searchParams.get('establishmentName') || '').trim();
    const redirectPlanCode = String(searchParams.get('planCode') || '').trim().toLowerCase();
    const metadataPlanCode = String(user.user_metadata?.plan_code || '').trim().toLowerCase();
    const planCode = String(
      redirectPlanCode
        || existingCustomerContext?.planCode
        || metadataPlanCode
        || resolvedPlanCode
        || '',
    ).trim().toLowerCase();

    if (!planCode || planCode === 'free_trial') return;

    const shouldResumePaidSignup =
      checkoutStatusFromRedirect === 'pending'
      || checkoutStatusFromRedirect === 'cancel'
      || checkoutStatusFromRedirect === 'expired'
      || existingCustomerContext?.email === sessionEmail
      || metadataPlanCode === planCode;

    if (!shouldResumePaidSignup) return;

    const establishmentName = String(
      redirectEstablishmentName
        || existingCustomerContext?.establishmentName
        || user.user_metadata?.establishment_name
        || formData.establishmentName
        || '',
    ).trim();

    setResolvedPlanCode(planCode);
    setFormData((previous) => ({
      ...previous,
      establishmentName: establishmentName || previous.establishmentName,
      email: user.email || previous.email,
      emailConfirmation: user.email || previous.emailConfirmation,
    }));
    setPendingNewSignup(null);
    setFinishedFlow('');
    setStep(3);

    if (checkoutStatusFromRedirect === 'cancel') {
      setCheckoutError('Checkout cancelado. Voce pode iniciar um novo checkout quando quiser.');
    } else if (checkoutStatusFromRedirect === 'expired') {
      setCheckoutError('Checkout expirado. Gere um novo link seguro para continuar.');
    } else {
      setCheckoutError('');
    }
  }, [
    authSession,
    checkoutStatusFromRedirect,
    finishedFlow,
    formData.establishmentName,
    resolvedPlanCode,
    searchParams,
    shouldFinalizeFromRedirect,
  ]);

  useEffect(() => {
    const session = authSession;
    const user = session?.user ?? null;
    const existingCustomerContext = readExistingCustomerSignupContext();
    const sessionEmail = String(user?.email || '').trim().toLowerCase();
    const hasSignupProjectId = Boolean(user?.app_metadata?.signup_project_id);
    const existingCustomerPlanCode = String(
      existingCustomerContext?.planCode || 'free_trial',
    ).trim().toLowerCase();
    const shouldFinalizeFromExistingCustomerContext =
      !shouldFinalizeFromRedirect &&
      !hasSignupProjectId &&
      Boolean(user) &&
      Boolean(existingCustomerContext) &&
      existingCustomerContext.email === sessionEmail &&
      existingCustomerPlanCode === 'free_trial';
    const shouldAttemptFinalize = shouldFinalizeFromRedirect || shouldFinalizeFromExistingCustomerContext;

    if (!shouldAttemptFinalize || finalizeFromRedirectRef.current || !user) return;

    setSignupLoading(true);
    setSignupError('');

    finalizeFromRedirectRef.current = true;

    const finalizePendingSignup = async () => {
      try {
        const redirectEstablishmentName = String(searchParams.get('establishmentName') || '').trim();
        const redirectPlanCode = String(searchParams.get('planCode') || '').trim();
        const establishmentName = String(
          user.user_metadata?.establishment_name
            || redirectEstablishmentName
            || existingCustomerContext?.establishmentName
            || '',
        ).trim();
        const planCode = String(
          user.user_metadata?.plan_code
            || redirectPlanCode
            || existingCustomerContext?.planCode
            || 'free_trial',
        );
        setResolvedPlanCode(String(planCode).trim().toLowerCase());

        const result = await provisionSignup({
          establishmentName,
          planCode,
          userId: user.id,
          checkoutSessionId: checkoutSessionIdFromRedirect,
        });
        const finalizedPlanCode = String(result?.plan?.code || planCode || '').trim().toLowerCase();
        if (finalizedPlanCode) {
          setResolvedPlanCode(finalizedPlanCode);
        }
        const finalizedEstablishmentName = establishmentName || result?.project?.name || '';
        const passwordSetupRequired = Boolean(result?.auth?.password_setup_required);
        clearExistingCustomerSignupContext();
        setFormData((previous) => ({
          ...previous,
          establishmentName: finalizedEstablishmentName,
          email: user.email || previous.email,
          emailConfirmation: user.email || previous.emailConfirmation,
        }));

        if (passwordSetupRequired) {
          markSignupPasswordSetupRequired();
          setFinishedFlow('set-password');
          return;
        }

        clearSignupPasswordSetupRequired();
        setFinishedFlow(finalizedPlanCode === 'free_trial' ? 'trial' : 'paid');
      } catch (error) {
        const message = error?.message || 'Nao foi possivel finalizar o cadastro.';
        setSignupError(message);
        toast({
          title: 'Erro ao finalizar cadastro',
          description: message,
          variant: 'destructive',
        });
      } finally {
        setSignupLoading(false);
      }
    };

    finalizePendingSignup();
  }, [
    authSession,
    checkoutSessionIdFromRedirect,
    provisionSignup,
    searchParams,
    shouldFinalizeFromRedirect,
    toast,
  ]);

  useEffect(() => {
    const user = authSession?.user ?? null;
    if (!user || finishedFlow === 'set-password') return;
    if (!shouldSetupPasswordFromRedirect && !isSignupPasswordSetupRequired()) return;

    setFormData((previous) => ({
      ...previous,
      email: user.email || previous.email,
      emailConfirmation: user.email || previous.emailConfirmation,
    }));
    setFinishedFlow('set-password');
  }, [authSession, finishedFlow, shouldSetupPasswordFromRedirect]);

  return (
    <>
      <Helmet>
        <title>Cadastro - Allin Pass</title>
        <meta
          name="description"
          content="Crie sua conta Allin Pass e avance no fluxo de contratação do plano escolhido."
        />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-purple-50/60 text-slate-900">
        <header className="border-b border-purple-100 bg-white/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-2 rounded-xl shadow-lg shadow-purple-500/20">
                <Wallet className="w-5 h-5 text-white" strokeWidth={2.5} />
              </div>
              <span className="text-lg font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
                Allin Pass
              </span>
            </div>

            <Link
              to="/#planos"
              className="inline-flex items-center gap-2 text-sm font-medium text-purple-700 hover:text-purple-800"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar aos planos
            </Link>
          </div>
        </header>

        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="grid xl:grid-cols-[minmax(0,1fr)_340px] gap-8">
            <section className="bg-white border border-purple-100 rounded-3xl shadow-xl shadow-purple-500/5 p-6 sm:p-8">
              <div className="mb-7">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-purple-600 mb-2">
                  Contratação guiada
                </p>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
                  {paidPlan ? 'Finalize seu cadastro e assinatura' : 'Ative seu Free Trial em minutos'}
                </h1>
                <p className="text-sm sm:text-base text-slate-600 mt-2">
                  Você escolheu o plano <span className="font-semibold text-slate-900">{selectedPlan.name}</span>.
                </p>
              </div>

              <div className="mb-8">
                <ol className={`grid grid-cols-1 ${paidPlan ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3`}>
                  {steps.map((stepLabel, index) => {
                    const position = index + 1;
                    const isPasswordStep =
                      finishedFlow === 'create-password' || finishedFlow === 'set-password';
                    const isWaitingEmailFlow = finishedFlow === 'confirm-email';
                    const isSuccessFlow = Boolean(finishedFlow) && !isPasswordStep && !isWaitingEmailFlow;
                    const done = activeStep > position || isSuccessFlow;
                    const current = (!finishedFlow || isPasswordStep) && activeStep === position;
                    return (
                      <li
                        key={stepLabel}
                        className={`rounded-2xl border p-3 transition-colors ${
                          done
                            ? 'border-emerald-200 bg-emerald-50'
                            : current
                              ? 'border-purple-200 bg-purple-50'
                              : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                              done
                                ? 'bg-emerald-500 text-white'
                                : current
                                  ? 'bg-purple-600 text-white'
                                  : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {done ? 'OK' : position}
                          </span>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-500">Etapa {position}</p>
                            <p className="font-semibold text-slate-900">{stepLabel}</p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <AnimatePresence mode="wait">
                {!finishedFlow && shouldFinalizeFromRedirect && (
                  <motion.div
                    key="finalizing-signup"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="rounded-2xl border border-purple-200 bg-purple-50 p-6"
                  >
                    {signupLoading ? (
                      <Loader2 className="w-10 h-10 text-purple-600 mb-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-10 h-10 text-rose-600 mb-4" />
                    )}
                    <h2 className="text-2xl font-bold text-slate-900">
                      {signupLoading
                        ? paidPlan ? 'Finalizando sua assinatura' : 'Finalizando seu Free Trial'
                        : 'Não foi possível finalizar automaticamente'}
                    </h2>
                    <p className="text-slate-700 mt-2">
                      {signupLoading
                        ? paidPlan
                          ? 'Estamos validando o pagamento no Asaas e criando seu acesso ao painel.'
                          : 'Estamos criando seu projeto, assinatura trial e acesso ao painel.'
                        : signupError || 'Entre novamente para continuar o provisionamento.'}
                    </p>
                    {!signupLoading && (
                      <div className="flex flex-wrap gap-3 mt-5">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => window.location.reload()}
                          className="border-purple-300 text-purple-800 hover:bg-purple-100"
                        >
                          Tentar novamente
                        </Button>
                        <Link to="/login">
                          <Button className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
                            Ir para login
                          </Button>
                        </Link>
                        <Link to="/#planos">
                          <Button variant="outline" className="border-purple-300 text-purple-800 hover:bg-purple-100">
                            Voltar aos planos
                          </Button>
                        </Link>
                      </div>
                    )}
                  </motion.div>
                )}

                {!finishedFlow && !shouldFinalizeFromRedirect && step === 1 && (
                  <motion.form
                    key="step-1"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    onSubmit={handleStepOneSubmit}
                    className="space-y-5"
                    noValidate
                  >
                    <div className="space-y-2">
                      <Label htmlFor="establishment-name">Nome do estabelecimento</Label>
                      <Input
                        id="establishment-name"
                        type="text"
                        className="h-12"
                        value={formData.establishmentName}
                        onChange={(event) => setField('establishmentName', event.target.value)}
                        onBlur={() => setFieldTouched('establishmentName')}
                        placeholder="Ex.: Padaria Bom Dia"
                        aria-invalid={shouldShowError('establishmentName')}
                      />
                      {shouldShowError('establishmentName') && (
                        <p className="text-sm text-rose-600">{errors.establishmentName}</p>
                      )}
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">E-mail</Label>
                        <Input
                          id="email"
                          type="email"
                          className="h-12"
                          value={formData.email}
                          onChange={(event) => setField('email', event.target.value)}
                          onBlur={() => setFieldTouched('email')}
                          placeholder="contato@empresa.com"
                          aria-invalid={shouldShowError('email')}
                        />
                        {shouldShowError('email') && (
                          <p className="text-sm text-rose-600">{errors.email}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="email-confirmation">Confirmação de e-mail</Label>
                        <Input
                          id="email-confirmation"
                          type="email"
                          className="h-12"
                          value={formData.emailConfirmation}
                          onChange={(event) => setField('emailConfirmation', event.target.value)}
                          onBlur={() => setFieldTouched('emailConfirmation')}
                          placeholder="repita seu e-mail"
                          aria-invalid={shouldShowError('emailConfirmation')}
                        />
                        {shouldShowError('emailConfirmation') && (
                          <p className="text-sm text-rose-600">{errors.emailConfirmation}</p>
                        )}
                      </div>
                    </div>

                    {signupCaptchaEnabled && (
                      <TurnstileWidget
                        siteKey={turnstileSiteKey}
                        onTokenChange={setCaptchaToken}
                        onResetReady={(resetWidget) => {
                          turnstileResetRef.current = resetWidget;
                        }}
                      />
                    )}

                    <Button
                      type="submit"
                      className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
                      disabled={signupLoading || (signupCaptchaEnabled && !captchaToken)}
                    >
                      {signupLoading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Iniciando...
                        </span>
                      ) : paidPlan ? 'Continuar para senha' : 'Continuar'}
                    </Button>
                    {signupError && (
                      <p className="text-sm text-rose-600 text-center">{signupError}</p>
                    )}
                  </motion.form>
                )}

                {!finishedFlow && step === 3 && paidPlan && (
                  <motion.div
                    key="step-3"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 via-white to-indigo-50 p-5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-purple-600 mb-2">
                        Resumo do plano selecionado
                      </p>
                      <div className="flex items-end justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-2xl font-bold text-slate-900">{selectedPlan.name}</p>
                          <p className="text-sm text-slate-600 mt-1">{selectedPlan.description}</p>
                        </div>
                        <p className="text-2xl font-bold text-purple-700">
                          R$ {formatCurrencyBRL(selectedPlan.price)}/mês
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
                      <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-purple-600" />
                        Checkout seguro via Asaas
                      </p>
                      <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                        Vamos criar uma sessao de checkout recorrente no Asaas para este plano.
                        Nenhum dado de cartao e coletado dentro do AllinPass.
                      </p>
                      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                        <Lock className="w-3.5 h-3.5" />
                        Voce sera redirecionado para o ambiente seguro do provedor.
                      </div>
                    </div>

                    {checkoutError && (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                        {checkoutError}
                      </div>
                    )}

                    <Button
                      type="button"
                      onClick={handlePaymentContinue}
                      disabled={checkoutLoading}
                      className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
                    >
                      {checkoutLoading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Abrindo checkout...
                        </span>
                      ) : 'Ir para checkout Asaas'}
                    </Button>
                  </motion.div>
                )}

                {finishedFlow === 'create-password' && (
                  <motion.form
                    key="create-password"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    onSubmit={handleCreatePasswordSubmit}
                    className="space-y-5"
                    noValidate
                  >
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                      <CheckCircle2 className="w-9 h-9 text-emerald-600 mb-3" />
                      <h2 className="text-2xl font-bold text-emerald-950">E-mail liberado</h2>
                      <p className="text-emerald-800 mt-2">
                        Agora crie a senha que você usará para entrar no painel do estabelecimento.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <Label htmlFor="password">Senha</Label>
                      <Input
                        id="password"
                        type="password"
                        className="h-12"
                        value={formData.password}
                        onChange={(event) => setField('password', event.target.value)}
                        onBlur={() => setFieldTouched('password')}
                        placeholder="Crie uma senha forte"
                        autoComplete="new-password"
                        aria-invalid={shouldShowError('password')}
                      />
                      {shouldShowError('password') && (
                        <p className="text-sm text-rose-600">{errors.password}</p>
                      )}

                      <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm font-semibold text-slate-700">Força da senha</p>
                          <p className={`text-sm font-semibold ${passwordState.textColor}`}>
                            {passwordState.label}
                          </p>
                        </div>

                        <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                          <motion.div
                            className={`h-full ${passwordState.barColor}`}
                            initial={false}
                            animate={{ width: `${passwordState.progress}%` }}
                            transition={{ duration: 0.35, ease: 'easeOut' }}
                          />
                        </div>

                        <ul className="mt-3 grid sm:grid-cols-2 gap-2">
                          {passwordState.checks.map((rule) => (
                            <li
                              key={rule.id}
                              className={`text-xs flex items-center gap-2 ${
                                rule.met ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${rule.met ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              {rule.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setPendingNewSignup(null);
                          setFinishedFlow('');
                          setStep(1);
                          setAttemptedSubmit(false);
                          setSignupError('');
                          setFormData((previous) => ({ ...previous, password: '' }));
                        }}
                        className="h-12 sm:w-40"
                      >
                        Voltar
                      </Button>
                      <Button
                        type="submit"
                        className="h-12 flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
                        disabled={signupLoading}
                      >
                        {signupLoading ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Criando conta...
                          </span>
                        ) : 'Criar conta'}
                      </Button>
                    </div>
                    {signupError && (
                      <p className="text-sm text-rose-600 text-center">{signupError}</p>
                    )}
                  </motion.form>
                )}

                {finishedFlow === 'trial' && (
                  <motion.div
                    key="success-trial"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6"
                  >
                    <CheckCircle2 className="w-10 h-10 text-emerald-600 mb-4" />
                    <h2 className="text-2xl font-bold text-emerald-900">Free Trial iniciado com sucesso</h2>
                    <p className="text-emerald-800 mt-2">
                      Seu acesso de 7 dias foi iniciado sem necessidade de cartão de crédito.
                    </p>
                    <div className="flex flex-wrap gap-3 mt-5">
                      <Link to="/org">
                        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
                          Acessar painel
                        </Button>
                      </Link>
                      <Link to="/#planos">
                        <Button variant="outline" className="border-emerald-300 text-emerald-800 hover:bg-emerald-100">
                          Voltar aos planos
                        </Button>
                      </Link>
                    </div>
                  </motion.div>
                )}

                {finishedFlow === 'set-password' && (
                  <motion.form
                    key="set-password"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    onSubmit={handlePasswordSetupSubmit}
                    className="space-y-5"
                    noValidate
                  >
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                      <CheckCircle2 className="w-9 h-9 text-emerald-600 mb-3" />
                      <h2 className="text-2xl font-bold text-emerald-950">E-mail confirmado</h2>
                      <p className="text-emerald-800 mt-2">
                        Agora crie a senha que você usará para entrar no painel do estabelecimento.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <Label htmlFor="password-setup">Senha</Label>
                      <Input
                        id="password-setup"
                        type="password"
                        className="h-12"
                        autoComplete="new-password"
                        value={passwordSetupValue}
                        onChange={(event) => {
                          setPasswordSetupValue(event.target.value);
                          setPasswordSetupError('');
                        }}
                        onBlur={() => setPasswordSetupTouched(true)}
                        aria-invalid={Boolean(passwordSetupError)}
                        placeholder="Crie uma senha forte"
                      />
                      {passwordSetupError && (
                        <p className="text-sm text-rose-600">{passwordSetupError}</p>
                      )}

                      <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm font-semibold text-slate-700">Força da senha</p>
                          <p className={`text-sm font-semibold ${passwordSetupState.textColor}`}>
                            {passwordSetupState.label}
                          </p>
                        </div>

                        <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                          <motion.div
                            className={`h-full ${passwordSetupState.barColor}`}
                            initial={false}
                            animate={{ width: `${passwordSetupState.progress}%` }}
                            transition={{ duration: 0.35, ease: 'easeOut' }}
                          />
                        </div>

                        <ul className="mt-3 grid sm:grid-cols-2 gap-2">
                          {passwordSetupState.checks.map((rule) => (
                            <li
                              key={rule.id}
                              className={`text-xs flex items-center gap-2 ${
                                rule.met ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${rule.met ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              {rule.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      disabled={passwordSetupLoading}
                      className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
                    >
                      {passwordSetupLoading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Criando senha...
                        </span>
                      ) : 'Criar senha e continuar'}
                    </Button>
                  </motion.form>
                )}

                {finishedFlow === 'confirm-email' && (
                  <motion.div
                    key="confirm-email"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-sky-200 bg-sky-50 p-6"
                  >
                    <CheckCircle2 className="w-10 h-10 text-sky-600 mb-4" />
                    <h2 className="text-2xl font-bold text-sky-950">
                      {confirmationFlow === 'existing-customer' ? 'Confira seu e-mail' : 'Confirme seu e-mail'}
                    </h2>
                    <p className="text-sky-900 mt-2">
                      {confirmationFlow === 'existing-customer'
                        ? paidPlan
                          ? `Enviamos um link de acesso para ${formData.email}. Abra o link para continuar a assinatura no checkout.`
                          : `Enviamos um link de acesso para ${formData.email}. Abra o link para finalizar o Free Trial e provisionar seu painel.`
                        : paidPlan
                          ? `Criamos sua conta no Supabase Auth. Abra o link enviado para ${formData.email} para continuar a assinatura no checkout. Não se esqueça de olhar o lixo eletrônico!`
                          : `Criamos sua conta no Supabase Auth. Abra o link enviado para ${formData.email} para finalizar o Free Trial e provisionar seu painel. Não se esqueça de olhar o lixo eletrônico!`}
                    </p>
                    <p className="text-sm text-sky-800 mt-3">
                      Se o link não chegou, você pode pedir um novo envio sem refazer o cadastro.
                    </p>
                    <div className="flex flex-wrap gap-3 mt-5">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleResendConfirmationEmail}
                        disabled={resendLoading}
                        className="border-sky-300 text-sky-900 hover:bg-sky-100"
                      >
                        {resendLoading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Reenviar e-mail
                      </Button>
                    </div>
                  </motion.div>
                )}

                {finishedFlow === 'paid' && (
                  <motion.div
                    key="success-paid"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-purple-200 bg-purple-50 p-6"
                  >
                    <CheckCircle2 className="w-10 h-10 text-purple-600 mb-4" />
                    <h2 className="text-2xl font-bold text-purple-900">Cadastro concluído</h2>
                    <p className="text-purple-800 mt-2">
                      Pagamento confirmado e acesso criado para o plano {selectedPlan.name}.
                      Voce ja pode acessar o painel do estabelecimento.
                    </p>
                    <div className="flex flex-wrap gap-3 mt-5">
                      <Link to="/org">
                        <Button className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
                          Acessar painel
                        </Button>
                      </Link>
                      <Link to="/#planos">
                        <Button variant="outline" className="border-purple-300 text-purple-800 hover:bg-purple-100">
                          Ver outros planos
                        </Button>
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <aside className="xl:sticky xl:top-24 h-fit">
              <PlanCard plan={selectedPlan} ctaTo={undefined} showCta={false} />
            </aside>
          </div>
        </main>
      </div>
    </>
  );
}

export default SignupPage;

