import React from 'react';
import { Check, CheckCircle2, Clock3, CreditCard, Loader2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';

const formatCurrencyBRL = (value) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const getPlanCardTone = (plan) => {
  if (plan?.isCurrent) {
    return {
      wrapper: 'border-purple-300 bg-gradient-to-br from-purple-50 via-white to-indigo-50 shadow-lg shadow-purple-100/70 dark:from-primary/20 dark:via-card dark:to-indigo-950/40 dark:shadow-black/20',
      title: 'text-purple-950 dark:text-purple-100',
      description: 'text-purple-800/80 dark:text-purple-200/80',
      price: 'text-purple-950 dark:text-purple-100',
      muted: 'text-purple-700 dark:text-purple-200',
      checkBg: 'bg-purple-100 dark:bg-primary/20',
      check: 'text-purple-700 dark:text-primary',
      button: 'border-purple-200 bg-white text-purple-700 dark:border-primary/30 dark:bg-primary/10 dark:text-purple-100',
      badge: 'bg-purple-600 text-white',
      feature: 'text-gray-700 dark:text-muted-foreground',
    };
  }

  if (plan?.isPendingPlanChange) {
    return {
      wrapper: 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50 shadow-lg shadow-amber-100/70 dark:from-amber-500/15 dark:via-card dark:to-yellow-950/30 dark:shadow-black/20',
      title: 'text-amber-950 dark:text-amber-100',
      description: 'text-amber-800/80 dark:text-amber-200/80',
      price: 'text-amber-950 dark:text-amber-100',
      muted: 'text-amber-700 dark:text-amber-200',
      checkBg: 'bg-amber-100 dark:bg-amber-500/20',
      check: 'text-amber-700 dark:text-amber-300',
      button: 'border-amber-200 bg-white text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100',
      badge: 'bg-amber-500 text-white',
      feature: 'text-gray-700 dark:text-muted-foreground',
    };
  }

  if (plan?.type === 'trial') {
    return {
      wrapper: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 shadow-lg shadow-emerald-100/70 dark:from-emerald-500/15 dark:via-card dark:to-teal-950/30 dark:shadow-black/20',
      title: 'text-emerald-950 dark:text-emerald-100',
      description: 'text-emerald-800/80 dark:text-emerald-200/80',
      price: 'text-emerald-950 dark:text-emerald-100',
      muted: 'text-emerald-700 dark:text-emerald-200',
      checkBg: 'bg-emerald-100 dark:bg-emerald-500/20',
      check: 'text-emerald-700 dark:text-emerald-300',
      button: 'bg-emerald-600 text-white hover:bg-emerald-700',
      badge: 'bg-emerald-500 text-white',
      feature: 'text-gray-700 dark:text-muted-foreground',
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
    wrapper: 'border-border bg-card shadow-sm hover:border-primary/40 hover:shadow-xl hover:shadow-purple-500/5',
    title: 'text-foreground',
    description: 'text-muted-foreground',
    price: 'text-foreground',
    muted: 'text-muted-foreground',
    checkBg: 'bg-primary/10',
    check: 'text-primary',
    button: 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700',
    badge: 'bg-gradient-to-r from-yellow-400 to-orange-400 text-yellow-950',
    feature: 'text-muted-foreground',
  };
};

const getPlanChangeHint = (plan) => {
  if (plan?.isCurrent) return 'Ativo agora';
  if (plan?.isPendingPlanChange) return 'Agendado para proximo ciclo';
  if (plan?.changeKind === 'downgrade') return 'Menor mensalidade';
  if (plan?.changeKind === 'upgrade') return 'Mais capacidade';
  if (plan?.changeKind === 'trial_conversion') return 'Ativacao paga';
  return 'Troca disponivel';
};

function BillingPlanChoiceCard({
  plan,
  busy,
  disabled,
  onSelect,
}) {
  const tone = getPlanCardTone(plan);
  const badgeText = plan.isCurrent
    ? 'Plano atual'
    : plan.isPendingPlanChange
      ? 'Agendado'
      : plan.badge || plan.highlight;
  const isActionDisabled = disabled || !plan.isSelectable;
  const actionLabel = plan.actionLabel || (
    plan.isPendingPlanChange
      ? 'Downgrade ja agendado'
      : plan.changeKind === 'downgrade'
        ? 'Fazer downgrade'
        : 'Trocar plano'
  );
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
        ) : plan.isPendingPlanChange ? (
          <Clock3 className="h-4 w-4" />
        ) : plan.isCurrent ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <CreditCard className="h-4 w-4" />
        )}
        {actionLabel}
      </Button>
    </div>
  );
}

export default BillingPlanChoiceCard;
