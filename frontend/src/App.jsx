import React, {useEffect} from 'react';
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
import MePage from '@/pages/MePage';
import PassPage from '@/pages/PassPage';
import ClaimThanks from "@/pages/ClaimThanks";
import LandingPage from '@/pages/LandingPage';


// ✅ NOVOS imports
import WalletClaimCard from '@/pages/WalletClaimCard';
import ClaimCallback from '@/pages/ClaimCallback';

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

      <Routes>
        {/* landing page pública (renderiza para visitantes; redireciona autenticados) */}
        <Route path="/" element={<LandingPage />} />

        <Route path="/login" element={!loading && user ? <Navigate to="/" replace /> : <Login />} />

        {/* callbacks existentes */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* ✅ claim flow público */}
        <Route path="/claim/:c" element={<WalletClaimCard />} />
        <Route path="/claim/callback" element={<ClaimCallback />} />

        {/* públicos existentes */}
        <Route path="/me" element={<MePage />} />
        <Route path="/c/:projectId/me" element={<MePage />} />
        <Route path="/:slug" element={<PassPage />} />

        <Route path="/nao-autorizado" element={<Unauthorized />} />
        <Route path="/thanks" element={<ClaimThanks />} />

        <Route element={<ProtectedLayout />}>
          <Route path="/admin" element={<SuperadminDashboard />} />
          <Route path="/org" element={<RestaurantDashboard />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>

      <Toaster />
    </>
  );
}
