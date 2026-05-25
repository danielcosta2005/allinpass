import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import AuthCallback from '@/pages/AuthCallback';
import Unauthorized from '@/pages/Unauthorized';
import ProtectedLayout from '@/layouts/ProtectedLayout';
import Login from '@/pages/Login';
import SuperadminDashboard from '@/pages/SuperadminDashboard';
import RestaurantDashboard from '@/pages/RestaurantDashboard';
import NotFound from '@/pages/NotFound';
import { Toaster } from '@/components/ui/toaster';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Loader2 } from 'lucide-react';
import AuthProgressScreen from '@/components/app/AuthProgressScreen';
import HashScrollHandler from '@/components/app/HashScrollHandler';
import MePage from '@/pages/MePage';
import PassPage from '@/pages/PassPage';
import ClaimThanks from "@/pages/ClaimThanks";
import LandingPage from '@/pages/LandingPage';
import SignupPage from '@/pages/SignupPage';


// ✅ NOVOS imports
import WalletClaimCard from '@/pages/WalletClaimCard';
import ClaimCallback from '@/pages/ClaimCallback';

const AUTH_RETURN_TYPES = new Set([
  'signup',
  'magiclink',
  'recovery',
  'invite',
  'email_change',
]);

const hasAuthReturnParams = (params) => (
  params.has('code') ||
  params.has('token_hash') ||
  params.has('access_token') ||
  params.has('refresh_token') ||
  AUTH_RETURN_TYPES.has(params.get('type'))
);

const isAuthReturnUrl = () => {
  if (typeof window === 'undefined') return false;

  const searchParams = new URLSearchParams(window.location.search || '');
  const hash = String(window.location.hash || '').replace(/^#/, '');
  const hashParams = new URLSearchParams(hash);

  return hasAuthReturnParams(searchParams) || hasAuthReturnParams(hashParams);
};

const HomeRoute = () => {
  const { loading, initialized } = useAuth();
  const shouldShowAuthReturnProgress = isAuthReturnUrl();

  if (shouldShowAuthReturnProgress && (loading || !initialized)) {
    return <AuthProgressScreen />;
  }

  return <LandingPage />;
};

const AuthRedirect = () => {
  const { role, loading, initialized, user } = useAuth();

  if (loading || !initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user && !loading) {
    return <Navigate to="/login" replace />;
  }

  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (role === 'unauthorized') {
    return <Navigate to="/nao-autorizado" replace />;
  }

  if (role === 'superadmin') {
    return <Navigate to="/admin" replace />;
  }
  if (role === 'establishment' || role === 'customer') {
    return <Navigate to="/org" replace />;
  }

  return <Navigate to="/login" replace />;
};

export default function App() {
  const { user, loading } = useAuth();

  useEffect(() => {
    console.log("Build version:", import.meta.env.VITE_BUILD_VERSION);
  }, []);

  return (
    <>
      <Helmet>
        <title>Allin Pass - Programa de Fidelidade Digital</title>
        <meta name="description" content="Sistema completo de fidelidade com Apple Wallet e Google Wallet" />
      </Helmet>

      <HashScrollHandler />

      <Routes>
        {/* ✅ landing page pública */}
        <Route path="/" element={<HomeRoute />} />

        <Route path="/login" element={!loading && user ? <Navigate to="/app" replace /> : <Login />} />

        {/* callbacks existentes */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* ✅ claim flow público */}
        <Route path="/claim/:c" element={<WalletClaimCard />} />
        <Route path="/claim/callback" element={<ClaimCallback />} />

        {/* públicos existentes */}
        <Route path="/me" element={<MePage />} />
        <Route path="/c/:projectId/me" element={<MePage />} />

        <Route path="/nao-autorizado" element={<Unauthorized />} />
        <Route path="/thanks" element={<ClaimThanks />} />
        <Route path="/cadastro" element={<SignupPage />} />

        <Route element={<ProtectedLayout />}>
          <Route path="/app" element={<AuthRedirect />} />
          <Route path="/admin" element={<SuperadminDashboard />} />
          <Route path="/org" element={<RestaurantDashboard />} />
        </Route>

        {/* rota dinâmica de pass — mantida no final para não capturar /app, /admin, /login etc */}
        <Route path="/:slug" element={<PassPage />} />

        <Route path="*" element={<NotFound />} />
      </Routes>

      <Toaster />
    </>
  );
}
