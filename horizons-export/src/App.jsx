import React from 'react';
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
import MePage from '@/pages/MePage';
import PassPage from '@/pages/PassPage';

// ✅ NOVOS imports
import WalletClaimCard from '@/pages/WalletClaimCard';
import ClaimCallback from '@/pages/ClaimCallback';

const AuthRedirect = () => {
  const { role, loading, initialized, user } = useAuth();

  if (loading && !initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user && !loading) {
    return <Navigate to="/login" replace />;
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

  return (
    <>
      <Helmet>
        <title>Carteira 4.9 - Programa de Fidelidade Digital</title>
        <meta name="description" content="Sistema completo de fidelidade com Apple Wallet e Google Wallet" />
      </Helmet>

      <Routes>
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

        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<AuthRedirect />} />
          <Route path="/admin" element={<SuperadminDashboard />} />
          <Route path="/org" element={<RestaurantDashboard />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>

      <Toaster />
    </>
  );
}
