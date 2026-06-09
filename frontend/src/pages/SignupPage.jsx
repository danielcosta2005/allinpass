import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Wallet,
} from 'lucide-react';
import {
  FREE_TRIAL_PLAN_CODE,
  FREE_TRIAL_PLAN_KEY,
  fetchSubscriptionPlans,
  getFreeTrialPlan,
  subscriptionPlans,
} from '@/lib/subscriptionPlans';
import {
  clearExistingCustomerSignupContext,
  finalizeSignup,
  isExistingCustomerSignupPasswordReady,
  precheckFreeTrialSignup,
  readExistingCustomerSignupContext,
  sendExistingCustomerSignupLink,
} from '@/lib/signup';
import {
  getTurnstileSiteKey,
  shouldUseSignupCaptcha,
} from '@/lib/turnstileConfig';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import PlanCard from '@/components/landing/PlanCard';
import CreatePasswordForm from './signup/CreatePasswordForm';
import SetPasswordForm from './signup/SetPasswordForm';
import SignupProgressSteps from './signup/SignupProgressSteps';
import StepOneSignupForm from './signup/StepOneSignupForm';
import {
  ConfirmEmailCard,
  FinalizingSignupCard,
  TrialSuccessCard,
} from './signup/SignupStatusCards';
import {
  EMAIL_REGEX,
  clearSignupPasswordSetupRequired,
  evaluatePassword,
  getPasswordError,
  isSignupPasswordSetupRequired,
  markSignupPasswordSetupRequired,
  normalizeSignupErrorMessage,
} from './signup/signupPageUtils';


function SignupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshAuthProfile, session: authSession } = useAuth();
  const { toast } = useToast();
  const finalizeFromRedirectRef = useRef(false);
  const [availablePlans, setAvailablePlans] = useState(subscriptionPlans);
  const [resolvedPlanCode, setResolvedPlanCode] = useState(FREE_TRIAL_PLAN_CODE);
  const existingCustomerSignupContext = readExistingCustomerSignupContext();
  const selectedPlanKey = FREE_TRIAL_PLAN_KEY;
  const shouldFinalizeFromRedirect = searchParams.get('finalizar') === '1';
  const shouldSetupPasswordFromRedirect = searchParams.get('passwordSetup') === '1';
  const selectedPlan = useMemo(
    () => getFreeTrialPlan(availablePlans),
    [availablePlans]
  );
  const totalSteps = 2;
  const shouldBlockFormForFinalize = shouldFinalizeFromRedirect;

  const [step, setStep] = useState(1);
  const [finishedFlow, setFinishedFlow] = useState('');
  const [confirmationFlow, setConfirmationFlow] = useState('signup');
  const [pendingNewSignup, setPendingNewSignup] = useState(null);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [signupLoading, setSignupLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [passwordSetupValue, setPasswordSetupValue] = useState('');
  const [passwordSetupConfirmationValue, setPasswordSetupConfirmationValue] = useState('');
  const [, setPasswordSetupTouched] = useState(false);
  const [, setPasswordSetupConfirmationTouched] = useState(false);
  const [passwordSetupLoading, setPasswordSetupLoading] = useState(false);
  const [passwordSetupError, setPasswordSetupError] = useState('');
  const [passwordSetupConfirmationError, setPasswordSetupConfirmationError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  const [showPasswordSetupConfirmation, setShowPasswordSetupConfirmation] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const turnstileResetRef = useRef(null);
  const [formData, setFormData] = useState({
    establishmentName: '',
    email: '',
    emailConfirmation: '',
    password: '',
    passwordConfirmation: '',
  });

  const turnstileSiteKey = useMemo(() => getTurnstileSiteKey(import.meta.env), []);
  const passwordState = useMemo(() => evaluatePassword(formData.password), [formData.password]);
  const passwordSetupState = useMemo(
    () => evaluatePassword(passwordSetupValue),
    [passwordSetupValue]
  );
  const signupCaptchaEnabled = useMemo(
    () => shouldUseSignupCaptcha({ siteKey: turnstileSiteKey }),
    [turnstileSiteKey]
  );

  const activeStep = finishedFlow === 'create-password' || finishedFlow === 'set-password'
    ? 2
    : finishedFlow
      ? totalSteps
      : step;

  const steps = ['Cadastro', 'Senha'];

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
  }) => {
    const result = await finalizeSignup({
      establishmentName,
      planCode: planCode || 'free_trial',
      dedupeKey: userId
        ? `signup-finalize:${userId}:${planCode || 'free_trial'}`
        : '',
    });

    await refreshAuthProfile();
    return result;
  }, [refreshAuthProfile]);

  const buildSignupEmailRedirectTo = useCallback((metadata = {}) => {
    const params = new URLSearchParams({
      plano: FREE_TRIAL_PLAN_KEY,
      planCode: FREE_TRIAL_PLAN_CODE,
    });
    const establishmentName = String(metadata.establishmentName || '').trim();
    const isExistingCustomer = metadata.existingCustomer === true;

    params.set('finalizar', '1');
    if (isExistingCustomer) params.set('existingCustomer', '1');
    if (establishmentName) params.set('establishmentName', establishmentName);

    return `${window.location.origin}/cadastro?${params.toString()}`;
  }, []);

  const handlePasswordSetupSubmit = async (event) => {
    event.preventDefault();
    setPasswordSetupTouched(true);
    setPasswordSetupConfirmationTouched(true);
    setPasswordSetupError('');
    setPasswordSetupConfirmationError('');

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

    if (!passwordSetupConfirmationValue) {
      setPasswordSetupConfirmationError('Confirme a senha para evitar erros de acesso.');
      return;
    }

    if (passwordSetupConfirmationValue !== passwordSetupValue) {
      setPasswordSetupConfirmationError('As senhas não conferem. Ajuste para continuar.');
      return;
    }

    setPasswordSetupLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password: passwordSetupValue });

      if (error) throw error;

      clearSignupPasswordSetupRequired();
      clearExistingCustomerSignupContext();
      setPasswordSetupValue('');
      setPasswordSetupConfirmationValue('');
      setPasswordSetupTouched(false);
      setPasswordSetupConfirmationTouched(false);
      setPasswordSetupError('');
      setPasswordSetupConfirmationError('');
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

    const nextErrors = {};
    const passwordError = getPasswordError(formData.password, passwordState);
    if (passwordError) {
      nextErrors.password = passwordError;
    }

    if (!formData.passwordConfirmation) {
      nextErrors.passwordConfirmation = 'Confirme a senha para evitar erros de acesso.';
    } else if (formData.passwordConfirmation !== formData.password) {
      nextErrors.passwordConfirmation = 'As senhas não conferem. Ajuste para continuar.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors((previous) => ({ ...previous, ...nextErrors }));
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
          description: 'Enviamos um link para finalizar seu Free Trial.',
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
      const message = 'Confirme a verificação antiabuso para iniciar o cadastro.';
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
      const planCode = FREE_TRIAL_PLAN_CODE;
      setResolvedPlanCode(String(planCode).trim().toLowerCase());
      const precheck = await precheckFreeTrialSignup({
        email: normalizedEmail,
        establishmentName,
        planCode,
        captchaToken: signupCaptchaEnabled ? captchaToken : '',
      });

      if (precheck.code === 'existing_customer') {
        const emailRedirectTo = buildSignupEmailRedirectTo({
          establishmentName,
          planCode,
          existingCustomer: true,
        });
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
          description: 'Enviamos um link de acesso para finalizar seu Free Trial.',
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
        passwordConfirmation: '',
      }));
      setTouched((previous) => ({ ...previous, password: false, passwordConfirmation: false }));
      setErrors((previous) => ({ ...previous, password: '', passwordConfirmation: '' }));
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
            planCode: FREE_TRIAL_PLAN_CODE,
            existingCustomer: true,
          }),
          establishmentName: formData.establishmentName.trim(),
          planCode: FREE_TRIAL_PLAN_CODE,
          planKey: selectedPlanKey,
        });
      } else {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: normalizedEmail,
          options: {
            emailRedirectTo: buildSignupEmailRedirectTo({
              establishmentName: formData.establishmentName.trim(),
              planCode: FREE_TRIAL_PLAN_CODE,
            }),
          },
        });

        if (error) throw error;
      }

      toast({
        title: 'E-mail reenviado',
        description: confirmationFlow === 'existing-customer'
          ? 'Enviamos um novo link de acesso para finalizar o Free Trial.'
          : 'Se a confirmação ainda estiver pendente, enviamos um novo link para finalizar o Free Trial.',
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

  const shouldShowError = (field) => Boolean(errors[field]) && (attemptedSubmit || touched[field]);

  const handleCreatePasswordBack = () => {
    setPendingNewSignup(null);
    setFinishedFlow('');
    setStep(1);
    setAttemptedSubmit(false);
    setSignupError('');
    setTouched((previous) => ({
      ...previous,
      password: false,
      passwordConfirmation: false,
    }));
    setErrors((previous) => ({
      ...previous,
      password: '',
      passwordConfirmation: '',
    }));
    setShowPassword(false);
    setShowPasswordConfirmation(false);
    setFormData((previous) => ({
      ...previous,
      password: '',
      passwordConfirmation: '',
    }));
  };

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
    if (resolvedPlanCode !== FREE_TRIAL_PLAN_CODE) {
      setResolvedPlanCode(FREE_TRIAL_PLAN_CODE);
    }
  }, [resolvedPlanCode]);

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
        const establishmentName = String(
          redirectEstablishmentName
            || user.user_metadata?.establishment_name
            || existingCustomerContext?.establishmentName
            || '',
        ).trim();
        const planCode = FREE_TRIAL_PLAN_CODE;

        setResolvedPlanCode(planCode);

        const result = await provisionSignup({
          establishmentName,
          planCode,
          userId: user.id,
        });
        const finalizedPlanCode = String(result?.plan?.code || planCode || '').trim().toLowerCase();
        if (finalizedPlanCode) {
          setResolvedPlanCode(finalizedPlanCode);
        }
        const finalizedEstablishmentName = establishmentName || result?.project?.name || '';
        const passwordSetupRequired = Boolean(result?.auth?.password_setup_required);
        const existingCustomerPasswordReadyBeforeFinalize = isExistingCustomerSignupPasswordReady({
          email: user.email,
          planCode: finalizedPlanCode || planCode,
        });
        setFormData((previous) => ({
          ...previous,
          establishmentName: finalizedEstablishmentName,
          email: user.email || previous.email,
          emailConfirmation: user.email || previous.emailConfirmation,
        }));

        if (passwordSetupRequired && !existingCustomerPasswordReadyBeforeFinalize) {
          markSignupPasswordSetupRequired();
          setFinishedFlow('set-password');
          return;
        }

        clearExistingCustomerSignupContext();
        clearSignupPasswordSetupRequired();
        setFinishedFlow('trial');
      } catch (error) {
        const message = error?.message || 'Não foi possível finalizar o cadastro.';
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
          content="Crie sua conta Allin Pass e ative seu Free Trial."
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
              Voltar ao Free Trial
            </Link>
          </div>
        </header>

        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="grid xl:grid-cols-[minmax(0,1fr)_340px] gap-8">
            <section className="bg-white border border-purple-100 rounded-3xl shadow-xl shadow-purple-500/5 p-6 sm:p-8">
              <div className="mb-7">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-purple-600 mb-2">
                  Cadastro guiado
                </p>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
                  Ative seu Free Trial em minutos
                </h1>
                <p className="text-sm sm:text-base text-slate-600 mt-2">
                  Você escolheu o plano <span className="font-semibold text-slate-900">{selectedPlan.name}</span>.
                </p>
              </div>

              <SignupProgressSteps
                activeStep={activeStep}
                finishedFlow={finishedFlow}
                steps={steps}
              />

              <AnimatePresence mode="wait">
                {!finishedFlow && shouldBlockFormForFinalize && (
                  <FinalizingSignupCard
                    signupError={signupError}
                    signupLoading={signupLoading}
                  />
                )}

                {!finishedFlow && !shouldBlockFormForFinalize && step === 1 && (
                  <StepOneSignupForm
                    captchaToken={captchaToken}
                    errors={errors}
                    formData={formData}
                    onCaptchaTokenChange={setCaptchaToken}
                    onFieldChange={setField}
                    onFieldTouched={setFieldTouched}
                    onSubmit={handleStepOneSubmit}
                    onTurnstileResetReady={(resetWidget) => {
                      turnstileResetRef.current = resetWidget;
                    }}
                    shouldShowError={shouldShowError}
                    signupCaptchaEnabled={signupCaptchaEnabled}
                    signupError={signupError}
                    signupLoading={signupLoading}
                    turnstileSiteKey={turnstileSiteKey}
                  />
                )}

                {finishedFlow === 'create-password' && (
                  <CreatePasswordForm
                    errors={errors}
                    formData={formData}
                    onBack={handleCreatePasswordBack}
                    onFieldChange={setField}
                    onFieldTouched={setFieldTouched}
                    onSubmit={handleCreatePasswordSubmit}
                    passwordState={passwordState}
                    shouldShowError={shouldShowError}
                    showPassword={showPassword}
                    showPasswordConfirmation={showPasswordConfirmation}
                    signupError={signupError}
                    signupLoading={signupLoading}
                    togglePasswordConfirmationVisibility={() => setShowPasswordConfirmation((visible) => !visible)}
                    togglePasswordVisibility={() => setShowPassword((visible) => !visible)}
                  />
                )}

                {finishedFlow === 'trial' && (
                  <TrialSuccessCard />
                )}

                {finishedFlow === 'set-password' && (
                  <SetPasswordForm
                    onPasswordConfirmationChange={(value) => {
                      setPasswordSetupConfirmationValue(value);
                      setPasswordSetupConfirmationError('');
                    }}
                    onPasswordConfirmationTouched={() => setPasswordSetupConfirmationTouched(true)}
                    onPasswordChange={(value) => {
                      setPasswordSetupValue(value);
                      setPasswordSetupError('');
                    }}
                    onPasswordTouched={() => setPasswordSetupTouched(true)}
                    onSubmit={handlePasswordSetupSubmit}
                    passwordSetupConfirmationError={passwordSetupConfirmationError}
                    passwordSetupConfirmationValue={passwordSetupConfirmationValue}
                    passwordSetupError={passwordSetupError}
                    passwordSetupLoading={passwordSetupLoading}
                    passwordSetupState={passwordSetupState}
                    passwordSetupValue={passwordSetupValue}
                    showPasswordSetupConfirmation={showPasswordSetupConfirmation}
                    showPasswordSetup={showPasswordSetup}
                    togglePasswordSetupConfirmationVisibility={() => setShowPasswordSetupConfirmation((visible) => !visible)}
                    togglePasswordSetupVisibility={() => setShowPasswordSetup((visible) => !visible)}
                  />
                )}

                {finishedFlow === 'confirm-email' && (
                  <ConfirmEmailCard
                    confirmationFlow={confirmationFlow}
                    formData={formData}
                    onResendConfirmationEmail={handleResendConfirmationEmail}
                    resendLoading={resendLoading}
                  />
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

