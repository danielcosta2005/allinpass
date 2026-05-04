import React, { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Lock,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DEFAULT_PLAN_KEY, findPlanByKey, isPaidPlan } from '@/lib/subscriptionPlans';
import PlanCard from '@/components/landing/PlanCard';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_RULES = [
  { id: 'length', label: 'Pelo menos 10 caracteres', test: (value) => value.length >= 10 },
  { id: 'upper', label: 'Uma letra maiuscula', test: (value) => /[A-Z]/.test(value) },
  { id: 'lower', label: 'Uma letra minuscula', test: (value) => /[a-z]/.test(value) },
  { id: 'number', label: 'Um numero', test: (value) => /\d/.test(value) },
  { id: 'symbol', label: 'Um simbolo especial', test: (value) => /[^A-Za-z0-9]/.test(value) },
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

function SignupPage() {
  const [searchParams] = useSearchParams();
  const selectedPlanKey = searchParams.get('plano') || DEFAULT_PLAN_KEY;
  const selectedPlan = useMemo(() => findPlanByKey(selectedPlanKey), [selectedPlanKey]);
  const paidPlan = isPaidPlan(selectedPlan);
  const totalSteps = paidPlan ? 2 : 1;

  const [step, setStep] = useState(1);
  const [finishedFlow, setFinishedFlow] = useState('');
  const [acceptMockCheckout, setAcceptMockCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    establishmentName: '',
    email: '',
    emailConfirmation: '',
    password: '',
  });

  const passwordState = useMemo(() => evaluatePassword(formData.password), [formData.password]);

  const activeStep = finishedFlow ? totalSteps : step;

  const steps = paidPlan ? ['Cadastro', 'Pagamento'] : ['Cadastro'];

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
      nextErrors.emailConfirmation = 'Os e-mails nao conferem. Ajuste para continuar.';
    }

    if (!formData.password) {
      nextErrors.password = 'Crie uma senha forte para proteger os dados da sua conta.';
    } else if (!passwordState.isStrong) {
      const missingRules = passwordState.checks
        .filter((rule) => !rule.met)
        .map((rule) => rule.label.toLowerCase());
      nextErrors.password = `Sua senha ainda precisa de: ${missingRules.join(', ')}.`;
    }

    return nextErrors;
  };

  const handleStepOneSubmit = (event) => {
    event.preventDefault();
    setAttemptedSubmit(true);
    const nextErrors = validateStepOne();
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) return;

    if (!paidPlan) {
      setFinishedFlow('trial');
      return;
    }

    setStep(2);
  };

  const handlePaymentContinue = () => {
    if (!acceptMockCheckout) {
      setCheckoutError('Confirme que deseja seguir para o checkout seguro para concluir.');
      return;
    }

    setCheckoutError('');
    setFinishedFlow('paid');
  };

  const shouldShowError = (field) => Boolean(errors[field]) && (attemptedSubmit || touched[field]);

  return (
    <>
      <Helmet>
        <title>Cadastro - Allin Pass</title>
        <meta
          name="description"
          content="Crie sua conta Allin Pass e avance no fluxo de contratacao do plano escolhido."
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
                <ol className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {steps.map((stepLabel, index) => {
                    const position = index + 1;
                    const done = activeStep > position || Boolean(finishedFlow);
                    const current = !finishedFlow && activeStep === position;
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
                {!finishedFlow && step === 1 && (
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
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          className="h-12"
                          value={formData.email}
                          onChange={(event) => setField('email', event.target.value)}
                          onBlur={() => setFieldTouched('email')}
                          placeholder="voce@empresa.com"
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
                          placeholder="repita seu email"
                          aria-invalid={shouldShowError('emailConfirmation')}
                        />
                        {shouldShowError('emailConfirmation') && (
                          <p className="text-sm text-rose-600">{errors.emailConfirmation}</p>
                        )}
                      </div>
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

                    <Button
                      type="submit"
                      className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
                    >
                      {paidPlan ? 'Continuar para pagamento' : 'Iniciar Free Trial'}
                    </Button>
                  </motion.form>
                )}

                {!finishedFlow && step === 2 && paidPlan && (
                  <motion.div
                    key="step-2"
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
                        <p className="text-2xl font-bold text-purple-700">R$ {selectedPlan.price}/mês</p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
                      <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-purple-600" />
                        Checkout seguro (estrutura frontend)
                      </p>
                      <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                        Aqui será conectada a integração oficial com Stripe, Mercado Pago ou equivalente.
                        Nenhum dado de cartão é coletado manualmente nesta etapa.
                      </p>
                      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                        <Lock className="w-3.5 h-3.5" />
                        Placeholder preparado para provider PCI-compliant.
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="mock-checkout-confirm"
                        checked={acceptMockCheckout}
                        onCheckedChange={(checked) => {
                          setAcceptMockCheckout(Boolean(checked));
                          setCheckoutError('');
                        }}
                      />
                      <div>
                        <Label htmlFor="mock-checkout-confirm" className="text-sm leading-relaxed">
                          Confirmo que desejo prosseguir para o checkout seguro do provedor de pagamento.
                        </Label>
                        {checkoutError && (
                          <p className="text-sm text-rose-600 mt-1">{checkoutError}</p>
                        )}
                      </div>
                    </div>

                    <Button
                      type="button"
                      onClick={handlePaymentContinue}
                      className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
                    >
                      Concluir assinatura (simulacao)
                    </Button>
                  </motion.div>
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
                      <Link to="/login">
                        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
                          Entrar no painel
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

                {finishedFlow === 'paid' && (
                  <motion.div
                    key="success-paid"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-purple-200 bg-purple-50 p-6"
                  >
                    <CheckCircle2 className="w-10 h-10 text-purple-600 mb-4" />
                    <h2 className="text-2xl font-bold text-purple-900">Cadastro concluido</h2>
                    <p className="text-purple-800 mt-2">
                      Fluxo frontend finalizado com sucesso para o plano {selectedPlan.name}.
                      A etapa de pagamento real ficará conectada ao provider na implementação backend.
                    </p>
                    <div className="flex flex-wrap gap-3 mt-5">
                      <Link to="/login">
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
