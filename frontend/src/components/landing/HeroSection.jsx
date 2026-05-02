import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, QrCode, Sparkles, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: 'easeOut' } },
};

const HeroSection = () => {
  return (
    <section
      id="topo"
      className="relative pt-28 md:pt-36 pb-20 md:pb-28 overflow-hidden"
    >
      <div
        className="pointer-events-none absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full opacity-30 blur-3xl"
        style={{
          background:
            'radial-gradient(circle at center, rgb(168 85 247) 0%, rgb(99 102 241) 60%, transparent 80%)',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-40 -left-32 w-[420px] h-[420px] rounded-full opacity-25 blur-3xl"
        style={{
          background:
            'radial-gradient(circle at center, rgb(192 132 252) 0%, rgb(129 140 248) 60%, transparent 80%)',
        }}
        aria-hidden
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="text-center lg:text-left"
          >
            <motion.div
              variants={itemVariants}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-50 border border-purple-100 text-purple-700 text-sm font-medium mb-6"
            >
              <Sparkles className="w-4 h-4" />
              <span>O futuro da comunicação digital</span>
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight text-gray-900"
            >
              Conecte, comunique e{' '}
              <span className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
                conquiste
              </span>{' '}
              quem importa.
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="mt-6 text-lg sm:text-xl text-gray-600 max-w-xl mx-auto lg:mx-0"
            >
              Transforme um simples QR Code em um canal direto com seu público. Sem app, sem complicação — direto na carteira digital do celular.
            </motion.p>

            <motion.div
              variants={itemVariants}
              className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start"
            >
              <Button
                type="button"
                size="lg"
                className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl transition-shadow group"
              >
                Começar agora
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
              </Button>
              <Button asChild variant="outline" size="lg" className="border-purple-200 text-purple-700 hover:bg-purple-50">
                <a href="#planos">Ver planos</a>
              </Button>
            </motion.div>

            <motion.div
              variants={itemVariants}
              className="mt-10 flex items-center gap-6 justify-center lg:justify-start text-sm text-gray-500"
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span>Funciona offline</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-500" />
                <span>Sem downloads</span>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500" />
                <span>Em segundos</span>
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut', delay: 0.2 }}
            className="relative flex justify-center"
          >
            <div className="relative w-full max-w-md">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-[2rem] blur-2xl opacity-30" aria-hidden />
              <div className="relative bg-gradient-to-br from-purple-600 to-indigo-700 rounded-[2rem] p-8 shadow-2xl text-white aspect-[5/6] flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="bg-white/20 backdrop-blur p-2 rounded-xl">
                      <Wallet className="w-5 h-5" />
                    </div>
                    <span className="font-semibold">Allin Pass</span>
                  </div>
                  <span className="text-xs uppercase tracking-wider opacity-80">Premium</span>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wider opacity-70 mb-1">Membro</div>
                  <div className="text-2xl font-bold">Sua marca</div>
                  <div className="text-sm opacity-80 mt-1">Cliente desde 2026</div>
                </div>

                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wider opacity-70 mb-1">Pontos</div>
                    <div className="text-3xl font-bold">2.480</div>
                  </div>
                  <div className="bg-white p-3 rounded-xl">
                    <QrCode className="w-14 h-14 text-purple-700" />
                  </div>
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, x: 20, y: -10 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ duration: 0.5, delay: 0.8 }}
                className="absolute -top-4 -right-4 bg-white rounded-2xl shadow-xl p-3 flex items-center gap-2 border border-purple-50"
              >
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-semibold text-gray-700">Notificação enviada</span>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
