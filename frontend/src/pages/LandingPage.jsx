import React, { useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import Header from '@/components/landing/Header';
import HeroSection from '@/components/landing/HeroSection';
import FeaturesSection from '@/components/landing/FeaturesSection';
import PricingSection from '@/components/landing/PricingSection';
import CtaSection from '@/components/landing/CtaSection';
import Footer from '@/components/landing/Footer';

const LandingPage = () => {
  const { user, role, loading, initialized } = useAuth();

  // Smooth scroll only on the landing page; restore default on unmount so other routes (admin/org)
  // don't get sluggish programmatic scrolls.
  useEffect(() => {
    const previous = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'smooth';
    return () => {
      document.documentElement.style.scrollBehavior = previous;
    };
  }, []);

  // Treat null role as "still resolving" to avoid flashing the landing for authenticated visitors.
  if (user && (loading || !initialized || !role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (user && role === 'superadmin') {
    return <Navigate to="/admin" replace />;
  }

  if (user && (role === 'establishment' || role === 'customer')) {
    return <Navigate to="/org" replace />;
  }

  if (user && role === 'unauthorized') {
    return <Navigate to="/nao-autorizado" replace />;
  }

  return (
    <>
      <Helmet>
        <title>Allin Pass — Conecte, comunique e conquiste</title>
        <meta
          name="description"
          content="Plataforma de comunicação multicanal via QR Code e carteira digital. Conecte, comunique e conquiste sua audiência."
        />
      </Helmet>

      <div className="bg-white text-gray-900 min-h-screen">
        <Header />
        <main>
          <HeroSection />
          <FeaturesSection />
          <PricingSection />
          <CtaSection />
        </main>
        <Footer />
      </div>
    </>
  );
};

export default LandingPage;
