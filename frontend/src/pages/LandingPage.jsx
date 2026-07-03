import React, { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  initPixelIfConsented,
  resetConsent,
  trackCustom,
  trackStandard,
} from '@/lib/metaPixel';
import ConsentBanner from '@/components/landing/ConsentBanner';
import PrivacyPolicyModal from '@/components/landing/PrivacyPolicyModal';
import { useToast } from '@/components/ui/use-toast';
import { resolveAffiliateRef } from '@/lib/affiliates';
import {
  Wallet,
  Smartphone,
  Bell,
  BarChart3,
  QrCode,
  Sparkles,
  ShieldCheck,
  Zap,
  Check,
  ArrowRight,
  ChevronDown,
  Apple,
  BadgePercent,
  Users,
  LogIn,
  LayoutDashboard,
  MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import {
  buildSignupPath,
  fetchSubscriptionPlans,
  formatAffiliateDiscountPercent,
  normalizeAffiliateRef,
  subscriptionPlans,
} from '@/lib/subscriptionPlans';
import PlanCard from '@/components/landing/PlanCard';

const SUPPORT_MESSAGE = 'Olá, preciso de suporte no Allin Pass.';
const SUPPORT_WHATSAPP_URL =
  import.meta.env.VITE_RESTAURANT_SUPPORT_WHATSAPP_URL ||
  `https://wa.me/?text=${encodeURIComponent(SUPPORT_MESSAGE)}`;

const LIMITED_FIRST_100_PROMOTION = {
  enabled: true,
  label: 'Promo limitada',
  discountLabel: '50% OFF',
  audienceLabel: '100 primeiros',
  originalPriceMultiplier: 1.5,
};

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] },
  }),
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const features = [
  {
    icon: Wallet,
    title: 'Apple Wallet & Google Wallet',
    description:
      'Seus cartões direto na carteira digital do cliente — sem necessidade de baixar aplicativo.',
  },
  {
    icon: Bell,
    title: 'Notificações push automáticas',
    description:
      'Avise sobre promoções, recompensas e novidades direto na tela de bloqueio do celular.',
  },
  {
    icon: BarChart3,
    title: 'Análises em tempo real',
    description:
      'Dashboards completos de visitas, recompensas, retenção e engajamento da sua base.',
  },
  {
    icon: QrCode,
    title: 'Check-in instantâneo',
    description:
      'Leitura de QR Code rápida para registrar visitas, validar recompensas e fidelizar clientes.',
  },
  {
    icon: ShieldCheck,
    title: 'Seguro e confiável',
    description:
      'Infraestrutura escalável com criptografia e conformidade com as melhores práticas de mercado.',
  },
  {
    icon: Sparkles,
    title: 'Personalização total',
    description:
      'Customize cores, logo, campos e regras dos seus cartões para refletir 100% da sua marca.',
  },
];

const steps = [
  {
    number: '01',
    title: 'Crie seu programa',
    description:
      'Configure seu cartão digital em minutos: cores, logo, campos e regras de recompensa.',
  },
  {
    number: '02',
    title: 'Compartilhe com seus clientes',
    description:
      'Distribua via QR Code, link ou nas redes sociais. O cliente adiciona à carteira em 2 toques.',
  },
  {
    number: '03',
    title: 'Engaje e fidelize',
    description:
      'Envie notificações, registre visitas e acompanhe o crescimento da sua base de fiéis.',
  },
];

const faqs = [
  {
    q: 'O que é a Allin Pass?',
    a: 'A Allin Pass é uma plataforma de fidelidade digital que permite ao seu negócio criar cartões que ficam direto na Apple Wallet e Google Wallet dos seus clientes, sem precisar de aplicativo próprio.',
  },
  {
    q: 'Funciona em iPhone e Android?',
    a: 'Sim! Os cartões são compatíveis com Apple Wallet (iPhone) e Google Wallet (Android), cobrindo praticamente 100% dos seus clientes.',
  },
  {
    q: 'Preciso de cartão de crédito para começar?',
    a: 'Você pode começar gratuitamente para testar a plataforma. O cartão só é solicitado quando você decidir ativar um plano pago.',
  },
  {
    q: 'Posso mudar de plano quando quiser?',
    a: 'Com certeza. Faça upgrade ou downgrade a qualquer momento direto no painel administrativo, sem multas ou burocracia.',
  },
  {
    q: 'Como funcionam as notificações?',
    a: 'As notificações são enviadas direto na tela de bloqueio do celular do cliente, sem precisar de app. Você pode automatizar campanhas ou disparar avisos manuais a qualquer momento.',
  },
];

const Logo = () => (
  <div className="flex items-center gap-2.5">
    <div className="relative">
      <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-2 rounded-xl shadow-lg shadow-purple-500/20">
        <Wallet className="w-5 h-5 text-white" strokeWidth={2.5} />
      </div>
    </div>
    <div className="flex flex-col leading-none">
      <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
        Allin Pass
      </span>
    </div>
  </div>
);

const FloatingContactButton = () => (
  <div className="group fixed bottom-5 right-5 z-40 flex items-center">
    <a
      href={SUPPORT_WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Abrir chat de suporte no WhatsApp"
      onClick={() => trackStandard('Contact', { source: 'landing_floating_whatsapp' })}
      className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/30 transition hover:from-purple-700 hover:to-indigo-700 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-purple-300"
    >
      <MessageCircle className="h-7 w-7" />
    </a>

    <div className="pointer-events-none absolute bottom-full right-0 z-50 mb-3 w-max rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-slate-900 shadow-xl opacity-0 transition duration-75 group-hover:opacity-100 group-focus-within:opacity-100">
      <p className="text-sm font-semibold">Fale conosco</p>
    </div>
  </div>
);

const Header = () => {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = [
    { href: '#recursos', label: 'Recursos' },
    { href: '#como-funciona', label: 'Como funciona' },
    { href: '#planos', label: 'Planos' },
    { href: '#faq', label: 'FAQ' },
  ];

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-purple-100/60"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Logo />

          <nav className="hidden md:flex items-center gap-8">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => trackCustom('LP_NavClick', { section: l.href.replace('#', ''), location: 'header_desktop' })}
                className="text-sm font-medium text-gray-600 hover:text-purple-600 transition-colors relative group"
              >
                {l.label}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gradient-to-r from-purple-600 to-indigo-600 transition-all duration-300 group-hover:w-full" />
              </a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            {user ? (
              <Link to="/app" onClick={() => trackCustom('LP_DashboardAccess', { source: 'header' })}>
                <Button className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-lg shadow-purple-500/20">
                  <LayoutDashboard className="w-4 h-4 mr-2" />
                  Acessar painel
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/login" onClick={() => trackCustom('LP_LoginClick', { source: 'header' })}>
                  <Button variant="ghost" className="text-gray-700 hover:text-purple-600 hover:bg-purple-50">
                    Entrar
                  </Button>
                </Link>
                <a href="#planos" onClick={() => trackStandard('Lead', { source: 'header' })}>
                  <Button className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-lg shadow-purple-500/20">
                    Começar agora
                  </Button>
                </a>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden p-2 text-gray-700"
            aria-label="Abrir menu"
          >
            <div className="space-y-1.5">
              <span className={`block w-6 h-0.5 bg-current transition-transform ${mobileOpen ? 'rotate-45 translate-y-2' : ''}`} />
              <span className={`block w-6 h-0.5 bg-current transition-opacity ${mobileOpen ? 'opacity-0' : ''}`} />
              <span className={`block w-6 h-0.5 bg-current transition-transform ${mobileOpen ? '-rotate-45 -translate-y-2' : ''}`} />
            </div>
          </button>
        </div>

        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="md:hidden overflow-hidden"
            >
              <div className="py-4 space-y-2 border-t border-purple-100">
                {links.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => {
                      trackCustom('LP_NavClick', { section: l.href.replace('#', ''), location: 'header_mobile' });
                      setMobileOpen(false);
                    }}
                    className="block px-2 py-2 text-sm font-medium text-gray-700 hover:text-purple-600 hover:bg-purple-50 rounded-lg"
                  >
                    {l.label}
                  </a>
                ))}
                <div className="pt-2 flex flex-col gap-2">
                  {user ? (
                    <Link
                      to="/app"
                      onClick={() => {
                        trackCustom('LP_DashboardAccess', { source: 'header_mobile' });
                        setMobileOpen(false);
                      }}
                    >
                      <Button className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
                        <LayoutDashboard className="w-4 h-4 mr-2" />
                        Acessar painel
                      </Button>
                    </Link>
                  ) : (
                    <>
                      <Link
                        to="/login"
                        onClick={() => {
                          trackCustom('LP_LoginClick', { source: 'header_mobile' });
                          setMobileOpen(false);
                        }}
                      >
                        <Button variant="outline" className="w-full">
                          <LogIn className="w-4 h-4 mr-2" />
                          Entrar
                        </Button>
                      </Link>
                      <a
                        href="#planos"
                        onClick={() => {
                          trackStandard('Lead', { source: 'header_mobile' });
                          setMobileOpen(false);
                        }}
                      >
                        <Button className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
                          Começar agora
                        </Button>
                      </a>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
};

const Hero = () => {
  const { user } = useAuth();

  return (
    <section className="relative overflow-hidden pt-16 pb-24 sm:pt-24 sm:pb-32">
      <div className="absolute inset-0 -z-10">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] blur-3xl"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(168,85,247,0.25) 0%, rgba(168,85,247,0.08) 40%, transparent 70%)',
          }}
        />
        <div className="absolute -top-20 -left-20 w-72 h-72 bg-purple-300/30 rounded-full blur-3xl animate-pulse" />
        <div
          className="absolute top-40 -right-20 w-96 h-96 bg-indigo-300/30 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: '1s' }}
        />
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div variants={stagger} initial="hidden" animate="show">
            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-50 border border-purple-100 text-purple-700 text-sm font-medium mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              Programa de fidelidade que cabe na carteira
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 leading-[1.15]"
            >
              Fidelize seus clientes
              <span className="block pb-3 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient">
                direto na carteira digital
              </span>
            </motion.h1>

            <motion.p variants={fadeUp} className="mt-6 text-lg text-gray-600 max-w-xl">
              Crie cartões digitais que ficam na Apple Wallet e Google Wallet do seu cliente.
              Envie notificações, acompanhe visitas e transforme clientes em fãs — Sem precisar de aplicativo!
            </motion.p>

            <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-3">
              {user ? (
                <Link to="/app" onClick={() => trackCustom('LP_DashboardAccess', { source: 'hero' })}>
                  <Button size="lg" className="h-12 px-6 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-xl shadow-purple-500/25">
                    <LayoutDashboard className="w-5 h-5 mr-2" />
                    Acessar painel
                  </Button>
                </Link>
              ) : (
                <a href="#planos" onClick={() => trackStandard('Lead', { source: 'hero' })}>
                  <Button size="lg" className="h-12 px-6 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-xl shadow-purple-500/25 group">
                    Começar agora
                    <ArrowRight className="w-5 h-5 ml-2 transition-transform group-hover:translate-x-1" />
                  </Button>
                </a>
              )}
              <a
                href="#como-funciona"
                onClick={() => trackCustom('LP_NavClick', { section: 'como-funciona', location: 'hero' })}
              >
                <Button size="lg" variant="outline" className="h-12 px-6 border-purple-200 text-purple-700 hover:bg-purple-50 hover:text-purple-700">
                  Ver como funciona
                </Button>
              </a>
            </motion.div>

            <motion.div variants={fadeUp} className="mt-10 flex items-center gap-6 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-purple-600" />
                Sem cartão de crédito
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-purple-600" />
                Setup em minutos
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="relative"
          >
            <HeroVisual />
          </motion.div>
        </div>

      </div>
    </section>
  );
};

const HeroVisual = () => {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <motion.div
        animate={{ y: [0, -12, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        className="relative z-20 rounded-3xl bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-700 p-6 shadow-2xl shadow-purple-500/30"
      >
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-2">
            <div className="bg-white/20 backdrop-blur p-2 rounded-lg">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <span className="text-white/90 text-sm font-medium">Allin Pass</span>
          </div>
          <div className="bg-white/20 backdrop-blur px-2.5 py-1 rounded-full text-white/90 text-xs font-medium">
            Cliente VIP
          </div>
        </div>

        <div className="text-white">
          <p className="text-white/70 text-xs uppercase tracking-wider mb-1">Visitas</p>
          <p className="text-4xl font-bold mb-1">7 / 10</p>
          <p className="text-white/70 text-xs">Faltam 3 para um café grátis</p>
        </div>

        <div className="mt-5 mb-6">
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '70%' }}
              transition={{ duration: 1.4, delay: 0.5, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-white to-purple-200 rounded-full"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-5 border-t border-white/15">
          <div>
            <p className="text-white/60 text-[10px] uppercase tracking-wider">Membro desde</p>
            <p className="text-white text-sm font-medium">Jan 2026</p>
          </div>
          <div className="flex items-center justify-center w-12 h-12 bg-white rounded-lg">
            <QrCode className="w-7 h-7 text-purple-700" />
          </div>
        </div>
      </motion.div>

      <motion.div
        animate={{ y: [0, 8, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
        className="absolute -top-6 -right-2 sm:-right-8 z-30 bg-white rounded-2xl shadow-2xl shadow-purple-500/15 p-4 max-w-[220px] border border-purple-100"
      >
        <div className="flex items-start gap-3">
          <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-2 rounded-lg shrink-0">
            <Bell className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-900">Allin Pass</p>
            <p className="text-xs text-gray-600 mt-0.5">
              Sua próxima visita garante 20% off! 🎉
            </p>
          </div>
        </div>
      </motion.div>

      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute -bottom-4 -left-4 sm:-left-8 z-30 bg-white rounded-2xl shadow-2xl shadow-purple-500/15 p-3 border border-purple-100"
      >
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 border-2 border-white" />
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 border-2 border-white" />
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 border-2 border-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-900">+1.200</p>
            <p className="text-[10px] text-gray-500">novos clientes</p>
          </div>
        </div>
      </motion.div>

      <div className="absolute inset-0 -z-10 blur-3xl bg-gradient-to-br from-purple-400/30 to-indigo-400/30 rounded-full" />
    </div>
  );
};

const TrustBar = () => {
  return (
    <section className="border-y border-purple-100/60 bg-gradient-to-r from-purple-50/50 via-white to-indigo-50/50 py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-gray-500">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Apple className="w-5 h-5" />
            Apple Wallet
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wallet className="w-5 h-5" />
            Google Wallet
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Smartphone className="w-5 h-5" />
            iOS & Android
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Zap className="w-5 h-5" />
            Setup instantâneo
          </div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="w-5 h-5" />
            LGPD compliant
          </div>
        </div>
      </div>
    </section>
  );
};

const Features = () => {
  return (
    <section id="recursos" className="scroll-mt-20 py-24 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="max-w-2xl mx-auto text-center mb-16"
        >
          <motion.span variants={fadeUp} className="inline-block px-3 py-1 rounded-full bg-purple-50 text-purple-700 text-xs font-semibold tracking-wide uppercase mb-4">
            Recursos
          </motion.span>
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 tracking-tight">
            Tudo que você precisa para
            <span className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent"> fidelizar</span>
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-lg text-gray-600">
            Uma plataforma completa para criar, distribuir e engajar seus clientes
            com programas de fidelidade modernos.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-50px' }}
          variants={stagger}
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              variants={fadeUp}
              custom={i}
              whileHover={{ y: -6, transition: { duration: 0.2 } }}
              className="group relative bg-white rounded-2xl p-6 border border-gray-100 hover:border-purple-200 hover:shadow-xl hover:shadow-purple-500/5 transition-all duration-300"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-indigo-50 opacity-0 group-hover:opacity-100 rounded-2xl transition-opacity duration-300 -z-10" />
              <div className="inline-flex p-3 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/20 mb-4 group-hover:scale-110 transition-transform duration-300">
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{f.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{f.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

const HowItWorks = () => {
  return (
    <section id="como-funciona" className="scroll-mt-20 py-24 sm:py-32 bg-gradient-to-b from-white via-purple-50/30 to-white relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-purple-200/20 blur-3xl rounded-full" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="max-w-2xl mx-auto text-center mb-16"
        >
          <motion.span variants={fadeUp} className="inline-block px-3 py-1 rounded-full bg-purple-50 text-purple-700 text-xs font-semibold tracking-wide uppercase mb-4">
            Como funciona
          </motion.span>
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 tracking-tight">
            Seu programa pronto em
            <span className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent"> 3 passos</span>
          </motion.h2>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-50px' }}
          variants={stagger}
          className="grid md:grid-cols-3 gap-8 relative"
        >
          {steps.map((s, i) => (
            <motion.div
              key={s.number}
              variants={fadeUp}
              custom={i}
              className="relative bg-white rounded-2xl p-8 border border-purple-100 shadow-sm hover:shadow-xl hover:shadow-purple-500/10 transition-all duration-300"
            >
              <div className="text-6xl font-bold bg-gradient-to-br from-purple-200 to-indigo-200 bg-clip-text text-transparent mb-4">
                {s.number}
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{s.title}</h3>
              <p className="text-gray-600 leading-relaxed">{s.description}</p>

              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-12 -right-4 z-10">
                  <ArrowRight className="w-6 h-6 text-purple-300" />
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

const Pricing = ({ plans, affiliateOffer = null }) => {
  const affiliateRef = affiliateOffer?.valid ? affiliateOffer.code : '';
  const affiliateDiscountPercent = affiliateOffer?.valid
    ? formatAffiliateDiscountPercent(affiliateOffer)
    : '';

  return (
    <section id="planos" className="scroll-mt-20 py-24 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="max-w-2xl mx-auto text-center mb-16"
        >
          <motion.span variants={fadeUp} className="inline-block px-3 py-1 rounded-full bg-purple-50 text-purple-700 text-xs font-semibold tracking-wide uppercase mb-4">
            Planos
          </motion.span>
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 tracking-tight">
            Escolha o plano ideal para
            <span className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent"> seu negócio</span>
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-lg text-gray-600">
            Comece pequeno, escale quando quiser. Sem fidelidade, sem multas, sem surpresas.
          </motion.p>
          <motion.div
            variants={fadeUp}
            className="mt-5 inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 ring-1 ring-amber-200"
          >
            <BadgePercent className="h-4 w-4" />
            <span>
              {LIMITED_FIRST_100_PROMOTION.discountLabel} para os {LIMITED_FIRST_100_PROMOTION.audienceLabel}.
            </span>
          </motion.div>
          {affiliateOffer?.valid ? (
            <motion.div
              variants={fadeUp}
              className="mt-5 inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200"
            >
              <BadgePercent className="h-4 w-4" />
              <span>
                Condição especial aplicada: {affiliateDiscountPercent}% de desconto no primeiro mês pelo link de vendedor.
              </span>
            </motion.div>
          ) : null}
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-50px' }}
          variants={stagger}
          className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 max-w-7xl mx-auto"
        >
          {plans.map((p, i) => (
            <motion.div
              key={p.key}
              variants={fadeUp}
              custom={i}
              whileHover={{ y: -8, transition: { duration: 0.2 } }}
            >
              <PlanCard
                plan={p}
                ctaTo={buildSignupPath(p.key, { ref: affiliateRef })}
                affiliateOffer={p.type === 'paid' ? affiliateOffer : null}
                limitedPromotion={p.type === 'paid' ? LIMITED_FIRST_100_PROMOTION : null}
                onCtaClick={() => {
                  trackStandard('InitiateCheckout', {
                    value: Number(p.price) || 0,
                    currency: 'BRL',
                    content_name: p.name,
                    content_ids: [p.code],
                  });
                  trackCustom('LP_PlanCardCTA', {
                    plan_key: p.key,
                    plan_code: p.code,
                    plan_name: p.name,
                    plan_price: Number(p.price) || 0,
                    affiliate_ref_present: Boolean(affiliateRef),
                  });
                }}
              />
            </motion.div>
          ))}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-center text-sm text-gray-500 mt-10"
        >
          Precisa de algo customizado?{' '}
          <a
            href="#"
            onClick={() => trackStandard('Contact', { source: 'pricing_custom_plan' })}
            className="text-purple-600 hover:text-purple-700 font-medium underline-offset-4 hover:underline"
          >
            Fale com a gente
          </a>
        </motion.p>
      </div>
    </section>
  );
};

const FAQ = () => {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="scroll-mt-20 py-24 sm:py-32 bg-gradient-to-b from-white to-purple-50/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          variants={stagger}
          className="max-w-2xl mx-auto text-center mb-12"
        >
          <motion.span variants={fadeUp} className="inline-block px-3 py-1 rounded-full bg-purple-50 text-purple-700 text-xs font-semibold tracking-wide uppercase mb-4">
            FAQ
          </motion.span>
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 tracking-tight">
            Perguntas frequentes
          </motion.h2>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-50px' }}
          variants={stagger}
          className="max-w-3xl mx-auto space-y-3"
        >
          {faqs.map((f, i) => {
            const isOpen = open === i;
            return (
              <motion.div
                key={f.q}
                variants={fadeUp}
                custom={i}
                className={`bg-white rounded-2xl border transition-all duration-300 ${
                  isOpen ? 'border-purple-200 shadow-lg shadow-purple-500/5' : 'border-gray-100'
                }`}
              >
                <button
                  onClick={() => {
                    if (!isOpen) {
                      trackCustom('LP_FAQOpen', { question: f.q, position: i + 1 });
                    }
                    setOpen(isOpen ? -1 : i);
                  }}
                  className="w-full px-6 py-5 flex items-center justify-between text-left"
                  aria-expanded={isOpen}
                >
                  <span className={`font-semibold pr-6 ${isOpen ? 'text-purple-700' : 'text-gray-900'}`}>
                    {f.q}
                  </span>
                  <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.3 }}
                    className={`shrink-0 ${isOpen ? 'text-purple-600' : 'text-gray-400'}`}
                  >
                    <ChevronDown className="w-5 h-5" />
                  </motion.div>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 pb-5 text-gray-600 leading-relaxed">{f.a}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
};

const FinalCTA = () => {
  const { user } = useAuth();

  return (
    <section className="py-24 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-700 p-10 sm:p-16 text-center shadow-2xl shadow-purple-500/30"
        >
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-0 left-1/4 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-pink-300/20 rounded-full blur-3xl" />
          </div>

          <Users className="w-12 h-12 text-white/80 mx-auto mb-6" />
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight">
            Pronto para fidelizar
            <br />
            seus clientes?
          </h2>
          <p className="mt-4 text-lg text-purple-100 max-w-xl mx-auto">
            Junte-se a centenas de estabelecimentos que já transformaram clientes em fãs com a Allin Pass.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {user ? (
              <Link to="/app" onClick={() => trackCustom('LP_DashboardAccess', { source: 'final_cta' })}>
                <Button size="lg" className="h-12 px-7 bg-white text-purple-700 hover:bg-purple-50 font-semibold">
                  <LayoutDashboard className="w-5 h-5 mr-2" />
                  Acessar painel
                </Button>
              </Link>
            ) : (
              <>
                <a href="#planos" onClick={() => trackStandard('Lead', { source: 'final_cta' })}>
                  <Button size="lg" className="h-12 px-7 bg-white text-purple-700 hover:bg-purple-50 font-semibold group">
                    Começar agora
                    <ArrowRight className="w-5 h-5 ml-2 transition-transform group-hover:translate-x-1" />
                  </Button>
                </a>
                <Link to="/login" onClick={() => trackCustom('LP_LoginClick', { source: 'final_cta' })}>
                  <Button size="lg" variant="outline" className="h-12 px-7 bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white">
                    Entrar
                  </Button>
                </Link>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
};

const Footer = ({ onOpenPrivacy, onResetCookies }) => {
  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-4 text-sm text-gray-600 max-w-sm">
              Programa de fidelidade digital direto na carteira do seu cliente.
              Apple Wallet, Google Wallet e muito mais.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-4">Produto</h4>
            <ul className="space-y-2 text-sm text-gray-600">
              <li><a href="#recursos" className="hover:text-purple-600 transition-colors">Recursos</a></li>
              <li><a href="#planos" className="hover:text-purple-600 transition-colors">Planos</a></li>
              <li><a href="#como-funciona" className="hover:text-purple-600 transition-colors">Como funciona</a></li>
              <li><a href="#faq" className="hover:text-purple-600 transition-colors">FAQ</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-4">Conta</h4>
            <ul className="space-y-2 text-sm text-gray-600">
              <li><Link to="/login" className="hover:text-purple-600 transition-colors">Entrar</Link></li>
              <li><a href="#planos" className="hover:text-purple-600 transition-colors">Criar conta</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500">
            © {new Date().getFullYear()} Allin Pass. Todos os direitos reservados.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500">
            <a href="#" className="hover:text-purple-600 transition-colors">Termos</a>
            <button
              type="button"
              onClick={onOpenPrivacy}
              className="hover:text-purple-600 transition-colors"
            >
              Privacidade
            </button>
            <button
              type="button"
              onClick={onResetCookies}
              className="hover:text-purple-600 transition-colors"
            >
              Cookies
            </button>
            <a href="#" className="hover:text-purple-600 transition-colors">Contato</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

const LandingPage = () => {
  const [plans, setPlans] = useState(subscriptionPlans);
  const [affiliateOffer, setAffiliateOffer] = useState({ valid: false, code: '', discountBps: 0 });
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const viewContentFiredRef = useRef(false);
  const scrollMilestonesRef = useRef(new Set());
  const { toast } = useToast();

  useEffect(() => {
    initPixelIfConsented();
  }, []);

  useEffect(() => {
    let mounted = true;
    const rawRef = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('ref')
      : '';
    const normalizedRef = normalizeAffiliateRef(rawRef);

    if (!normalizedRef) {
      setAffiliateOffer({ valid: false, code: '', discountBps: 0 });
      return () => {
        mounted = false;
      };
    }

    const loadAffiliateOffer = async () => {
      const result = await resolveAffiliateRef(normalizedRef);
      if (!mounted) return;
      setAffiliateOffer(result?.valid ? result : { valid: false, code: '', discountBps: 0 });
    };

    loadAffiliateOffer();

    return () => {
      mounted = false;
    };
  }, []);

  const handleResetCookies = () => {
    resetConsent();
    toast({
      title: 'Preferências de cookies redefinidas',
      description: 'Faça uma nova escolha no banner que apareceu no rodapé.',
    });
  };

  useEffect(() => {
    let mounted = true;

    const loadPlans = async () => {
      const remotePlans = await fetchSubscriptionPlans();
      if (mounted && Array.isArray(remotePlans) && remotePlans.length > 0) {
        setPlans(remotePlans);
      }
    };

    loadPlans();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const target = document.getElementById('planos');
    if (!target || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !viewContentFiredRef.current) {
            viewContentFiredRef.current = true;
            trackStandard('ViewContent', {
              content_name: 'pricing_section',
              content_category: 'landing_page',
            });
            observer.disconnect();
          }
        });
      },
      { threshold: 0.1 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const milestones = [50, 90];

    const computeDepth = () => {
      const doc = document.documentElement;
      const scrollable = Math.max(doc.scrollHeight - doc.clientHeight, 1);
      return Math.min(100, Math.round((window.scrollY / scrollable) * 100));
    };

    const handleScroll = () => {
      const depth = computeDepth();
      milestones.forEach((mark) => {
        if (depth >= mark && !scrollMilestonesRef.current.has(mark)) {
          scrollMilestonesRef.current.add(mark);
          trackCustom('LP_ScrollDepth', { depth: mark });
        }
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <Helmet>
        <title>Allin Pass — Programa de fidelidade direto na carteira do seu cliente</title>
        <meta
          name="description"
          content="Crie cartões de fidelidade na Apple Wallet e Google Wallet, envie notificações e fidelize clientes com a Allin Pass."
        />
      </Helmet>

      <div className="min-h-screen bg-white text-gray-900 antialiased">
        <Header />
        <main>
          <Hero />
          <TrustBar />
          <Features />
          <HowItWorks />
          <Pricing plans={plans} affiliateOffer={affiliateOffer} />
          <FAQ />
          <FinalCTA />
        </main>
        <Footer
          onOpenPrivacy={() => setPrivacyOpen(true)}
          onResetCookies={handleResetCookies}
        />
        <FloatingContactButton />
        <ConsentBanner onLearnMore={() => setPrivacyOpen(true)} />
        <PrivacyPolicyModal open={privacyOpen} onOpenChange={setPrivacyOpen} />
      </div>
    </>
  );
};

export default LandingPage;

