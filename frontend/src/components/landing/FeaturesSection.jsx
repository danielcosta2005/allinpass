import React from 'react';
import { motion } from 'framer-motion';
import { Target, Users, Zap, BarChart3, WifiOff, Leaf } from 'lucide-react';

const FEATURES = [
  {
    icon: Target,
    title: 'Comunicação no momento certo',
    description: 'Atinja seu público com precisão. Mensagens personalizadas que chegam quando realmente importam.',
  },
  {
    icon: Users,
    title: 'Base que cresce todo dia',
    description: 'Cada interação vira cliente em segundos. Construa sua audiência sem fricção e sem cadastros longos.',
  },
  {
    icon: Zap,
    title: 'Notificações em segundos',
    description: 'Crie campanhas segmentadas e dispare comunicados para milhares de pessoas em poucos cliques.',
  },
  {
    icon: BarChart3,
    title: 'Dados em tempo real',
    description: 'Monitore o engajamento ao vivo. Decisões estratégicas com métricas precisas e validadas.',
  },
  {
    icon: WifiOff,
    title: 'Funciona offline',
    description: 'Comunique-se com seu público mesmo onde a internet não chega. Alcance contínuo e ininterrupto.',
  },
  {
    icon: Leaf,
    title: 'Mais alcance, menos custo',
    description: 'Reduza gastos com material físico enquanto multiplica a eficiência das suas campanhas.',
  },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.1 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

const FeaturesSection = () => {
  return (
    <section id="recursos" className="scroll-mt-24 py-20 md:py-28 bg-gradient-to-b from-white to-purple-50/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-3xl mx-auto mb-14 md:mb-20"
        >
          <span className="inline-block px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-semibold uppercase tracking-wider mb-4">
            Recursos
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 tracking-tight">
            Tudo que sua marca precisa para{' '}
            <span className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
              estar presente
            </span>
          </h2>
          <p className="mt-5 text-lg text-gray-600">
            Uma infraestrutura inteligente para empresas, governos e instituições que querem se comunicar com quem realmente importa.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <motion.div
              key={title}
              variants={cardVariants}
              whileHover={{ y: -4 }}
              className="group bg-white rounded-2xl p-7 border border-purple-100 shadow-sm hover:shadow-xl hover:border-purple-200 transition-all"
            >
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white mb-5 shadow-md group-hover:scale-110 transition-transform">
                <Icon className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
              <p className="text-gray-600 leading-relaxed">{description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default FeaturesSection;
