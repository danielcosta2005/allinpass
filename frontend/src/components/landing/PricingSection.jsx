import React from 'react';
import { motion } from 'framer-motion';
import { Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const PLANS = [
  {
    name: 'Standard',
    price: 'R$ 99',
    period: '/mês',
    description: 'Ideal para pequenos negócios começando a se comunicar de forma inteligente.',
    features: [
      'Até 500 passes ativos',
      '2.000 notificações por mês',
      '1 campanha ativa',
      'Dashboard básico de engajamento',
    ],
    cta: 'Escolher plano',
    highlight: false,
  },
  {
    name: 'Pro',
    price: 'R$ 299',
    period: '/mês',
    description: 'Para empresas que querem escalar sua comunicação com inteligência e dados.',
    features: [
      'Até 5.000 passes ativos',
      '25.000 notificações por mês',
      'Campanhas ilimitadas',
      'Segmentação avançada de público',
      'Suporte prioritário',
    ],
    cta: 'Escolher plano',
    highlight: true,
    badge: 'Mais popular',
  },
  {
    name: 'Premium',
    price: 'Sob consulta',
    period: '',
    description: 'Para grandes operações, governos e instituições com demandas específicas.',
    features: [
      'Passes ilimitados',
      'Notificações ilimitadas',
      'Multiusuário com permissões',
      'Integração via API',
      'Gerente de conta dedicado',
    ],
    cta: 'Escolher plano',
    highlight: false,
  },
];

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: 'easeOut' } },
};

const PricingSection = () => {
  return (
    <section id="planos" className="scroll-mt-24 py-20 md:py-28 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-3xl mx-auto mb-14 md:mb-20"
        >
          <span className="inline-block px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold uppercase tracking-wider mb-4">
            Planos
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 tracking-tight">
            Escolha o plano que{' '}
            <span className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
              cresce com você
            </span>
          </h2>
          <p className="mt-5 text-lg text-gray-600">
            Planos pensados para cada estágio do seu negócio. Sem fidelidade, sem letras miúdas.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 items-stretch"
        >
          {PLANS.map((plan) => (
            <motion.div
              key={plan.name}
              variants={cardVariants}
              className={cn(
                'relative flex flex-col rounded-3xl p-8 transition-all',
                plan.highlight
                  ? 'bg-gradient-to-br from-purple-600 to-indigo-700 text-white shadow-2xl md:scale-105 ring-2 ring-purple-300/50'
                  : 'bg-white text-gray-900 border border-purple-100 shadow-sm hover:shadow-lg hover:border-purple-200'
              )}
            >
              {plan.badge && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1.5 bg-white text-purple-700 text-xs font-bold uppercase tracking-wider px-4 py-1.5 rounded-full shadow-lg">
                    <Sparkles className="w-3.5 h-3.5" />
                    {plan.badge}
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className={cn('text-2xl font-bold', plan.highlight ? 'text-white' : 'text-gray-900')}>
                  {plan.name}
                </h3>
                <p className={cn('mt-2 text-sm', plan.highlight ? 'text-purple-100' : 'text-gray-600')}>
                  {plan.description}
                </p>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className={cn('text-4xl font-bold', plan.highlight ? 'text-white' : 'text-gray-900')}>
                    {plan.price}
                  </span>
                  {plan.period && (
                    <span className={cn('text-base font-medium', plan.highlight ? 'text-purple-200' : 'text-gray-500')}>
                      {plan.period}
                    </span>
                  )}
                </div>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <span
                      className={cn(
                        'flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5',
                        plan.highlight ? 'bg-white/20' : 'bg-purple-100'
                      )}
                    >
                      <Check className={cn('w-3.5 h-3.5', plan.highlight ? 'text-white' : 'text-purple-700')} />
                    </span>
                    <span className={cn('text-sm leading-relaxed', plan.highlight ? 'text-purple-50' : 'text-gray-700')}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <Button
                type="button"
                size="lg"
                className={cn(
                  'w-full font-semibold',
                  plan.highlight
                    ? 'bg-white text-purple-700 hover:bg-purple-50'
                    : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white'
                )}
              >
                {plan.cta}
              </Button>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default PricingSection;
