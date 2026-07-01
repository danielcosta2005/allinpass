import React from 'react';
import { Link } from 'react-router-dom';
import { BadgePercent, Check, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  calculateAffiliateFirstMonthPrice,
  formatAffiliateDiscountPercent,
  formatCurrencyBRL,
  getAffiliateDiscountBps,
} from '@/lib/subscriptionPlans';

function PlanCard({ plan, ctaTo, showCta = true, className = '', onCtaClick, affiliateOffer = null }) {
  const affiliateDiscountBps = getAffiliateDiscountBps(affiliateOffer);
  const showAffiliateOffer = plan.type === 'paid' && affiliateDiscountBps > 0;
  const affiliateDiscountPercent = formatAffiliateDiscountPercent(affiliateOffer);
  const affiliateFirstMonthPrice = calculateAffiliateFirstMonthPrice(plan.price, affiliateOffer);

  return (
    <div
      className={`relative rounded-3xl p-8 transition-all duration-300 ${
        plan.type === 'trial'
          ? 'bg-gradient-to-br from-emerald-50 via-white to-teal-50 border border-emerald-200 shadow-lg shadow-emerald-100/70'
          : plan.highlighted
            ? 'bg-gradient-to-br from-purple-600 to-indigo-700 text-white shadow-2xl shadow-purple-500/30 scale-100 lg:scale-105'
            : 'bg-white border border-gray-200 hover:border-purple-200 hover:shadow-xl hover:shadow-purple-500/5'
      } ${className}`}
    >
      {(plan.badge || plan.highlight) && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <div
            className={`text-xs font-bold px-3 py-1 rounded-full shadow-lg flex items-center gap-1 ${
              plan.type === 'trial'
                ? 'bg-emerald-500 text-white'
                : 'bg-gradient-to-r from-yellow-400 to-orange-400 text-yellow-950'
            }`}
          >
            {plan.badge ? <Star className="w-3 h-3 fill-current" /> : null}
            {plan.badge || plan.highlight}
          </div>
        </div>
      )}

      <div className="mb-6">
        <h3
          className={`text-xl font-bold mb-2 ${
            plan.highlighted
              ? 'text-white'
              : plan.type === 'trial'
                ? 'text-emerald-900'
                : 'text-gray-900'
          }`}
        >
          {plan.name}
        </h3>
        <p
          className={`text-sm ${
            plan.highlighted
              ? 'text-purple-100'
              : plan.type === 'trial'
                ? 'text-emerald-800/90'
                : 'text-gray-500'
          }`}
        >
          {plan.description}
        </p>
      </div>

      <div className="mb-6">
        {plan.type === 'trial' ? (
          <div className="space-y-1">
            <p className="text-4xl font-bold text-emerald-900">{plan.trialDays || 7} dias</p>
            <p className="text-sm font-semibold text-emerald-700">grátis e sem cartão de crédito</p>
          </div>
        ) : showAffiliateOffer ? (
          <div className="space-y-3">
            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                plan.highlighted
                  ? 'bg-white text-purple-700'
                  : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              <BadgePercent className="h-3.5 w-3.5" />
              Condição especial aplicada
            </div>
            <div
              className={`border-t pt-3 ${
                plan.highlighted ? 'border-white/20' : 'border-emerald-100'
              }`}
            >
              <div
                className={`mb-1 flex flex-wrap items-center gap-2 text-sm ${
                  plan.highlighted ? 'text-purple-100' : 'text-gray-500'
                }`}
              >
                <span className="line-through decoration-2">
                  R$ {formatCurrencyBRL(plan.price)}/mês
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    plan.highlighted
                      ? 'bg-emerald-300 text-emerald-950'
                      : 'bg-emerald-600 text-white'
                  }`}
                >
                  -{affiliateDiscountPercent}%
                </span>
              </div>
              <div className="flex flex-wrap items-end gap-x-1 gap-y-0.5">
                <span className={`pb-1 text-sm ${plan.highlighted ? 'text-purple-100' : 'text-emerald-700'}`}>
                  R$
                </span>
                <span className={`text-5xl font-bold ${plan.highlighted ? 'text-white' : 'text-emerald-700'}`}>
                  {formatCurrencyBRL(affiliateFirstMonthPrice)}
                </span>
                <span className={`pb-1 text-sm font-semibold ${plan.highlighted ? 'text-purple-100' : 'text-emerald-800'}`}>
                  no primeiro mês
                </span>
              </div>
              <p className={`mt-1 text-xs ${plan.highlighted ? 'text-purple-100' : 'text-gray-500'}`}>
                Depois, R$ {formatCurrencyBRL(plan.price)}/mês.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className={`text-sm ${plan.highlighted ? 'text-purple-200' : 'text-gray-500'}`}>R$</span>
            <span className={`text-5xl font-bold ${plan.highlighted ? 'text-white' : 'text-gray-900'}`}>
              {formatCurrencyBRL(plan.price)}
            </span>
            <span className={`text-sm ${plan.highlighted ? 'text-purple-200' : 'text-gray-500'}`}>/mês</span>
          </div>
        )}
      </div>

      <ul className="space-y-3 mb-8">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <div
              className={`shrink-0 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center ${
                plan.highlighted ? 'bg-white/20' : plan.type === 'trial' ? 'bg-emerald-100' : 'bg-purple-100'
              }`}
            >
              <Check
                className={`w-3 h-3 ${
                  plan.highlighted ? 'text-white' : plan.type === 'trial' ? 'text-emerald-700' : 'text-purple-600'
                }`}
                strokeWidth={3}
              />
            </div>
            <span
              className={`text-sm ${
                plan.highlighted ? 'text-purple-50' : plan.type === 'trial' ? 'text-emerald-900/90' : 'text-gray-700'
              }`}
            >
              {feature}
            </span>
          </li>
        ))}
      </ul>

      {showCta && ctaTo ? (
        <Link to={ctaTo} className="block" onClick={onCtaClick}>
          <Button
            className={`w-full h-12 font-semibold ${
              plan.highlighted
                ? 'bg-white text-purple-700 hover:bg-purple-50'
                : plan.type === 'trial'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white'
            }`}
          >
            {plan.cta}
          </Button>
        </Link>
      ) : null}
    </div>
  );
}

export default PlanCard;

