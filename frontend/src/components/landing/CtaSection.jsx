import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CtaSection = () => {
  return (
    <section id="contato" className="scroll-mt-24 py-20 md:py-28 px-4 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative max-w-6xl mx-auto rounded-3xl overflow-hidden bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-700 px-6 py-14 md:px-16 md:py-20 shadow-2xl"
      >
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.25) 0%, transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.18) 0%, transparent 50%)',
          }}
          aria-hidden
        />

        <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
          <div className="lg:col-span-2 text-center lg:text-left">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight">
              Pronto para transformar sua{' '}
              <span className="text-purple-200">comunicação?</span>
            </h2>
            <p className="mt-5 text-lg text-purple-100 max-w-2xl">
              Junte-se a empresas, governos e instituições que já estão presentes quando realmente importa. O futuro da comunicação começa agora.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 justify-center lg:justify-end">
            <Button
              type="button"
              size="lg"
              className="bg-white text-purple-700 hover:bg-purple-50 font-semibold shadow-lg hover:shadow-xl transition-shadow group"
            >
              Começar agora
              <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white font-semibold"
            >
              <a href="#planos">Ver planos</a>
            </Button>
          </div>
        </div>
      </motion.div>
    </section>
  );
};

export default CtaSection;
