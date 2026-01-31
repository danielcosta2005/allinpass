import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Loader2 } from 'lucide-react';

const ProtectedLayout = () => {
  const { user, loading, initialized, role } = useAuth();
  const location = useLocation();

  // Enquanto o auth ainda não inicializou, evitamos redirects prematuros
  if (loading || !initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-indigo-50">
        <Loader2 className="animate-spin rounded-full h-12 w-12 text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Se existe user mas o role ainda não foi carregado, segura um pouco para não dar "nao-autorizado" indevido
  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-indigo-50">
        <Loader2 className="animate-spin rounded-full h-12 w-12 text-primary" />
      </div>
    );
  }

  const path = location.pathname;

  // Match por prefixo (ex: /admin, /admin/xxx)
  const rules = [
    { prefix: '/admin', roles: ['superadmin'] },
    { prefix: '/org', roles: ['establishment', 'customer'] },
  ];

  const rule = rules.find(r => path === r.prefix || path.startsWith(r.prefix + '/'));
  const allowedRoles = rule?.roles ?? ['superadmin', 'establishment', 'customer'];

  if (path !== '/' && !allowedRoles.includes(role)) {
    return <Navigate to="/nao-autorizado" replace />;
  }

  return <Outlet />;
};

export default ProtectedLayout;
