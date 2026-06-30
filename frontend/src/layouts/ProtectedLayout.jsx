import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Loader2 } from 'lucide-react';

const ProtectedLayout = () => {
  const { user, loading, initialized, role } = useAuth();
  const location = useLocation();

  let content;

  if (loading || !initialized) {
    content = (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-indigo-50 dark:from-background dark:via-background dark:to-secondary">
        <Loader2 className="animate-spin rounded-full h-12 w-12 text-primary" />
      </div>
    );
  } else if (!user) {
    content = <Navigate to="/login" state={{ from: location }} replace />;
  } else if (!role) {
    // Role still being resolved: avoid false unauthorized redirects.
    content = (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-indigo-50 dark:from-background dark:via-background dark:to-secondary">
        <Loader2 className="animate-spin rounded-full h-12 w-12 text-primary" />
      </div>
    );
  } else if (role === 'unauthorized') {
    content = <Navigate to="/nao-autorizado" replace />;
  } else {
    const path = location.pathname;

    const rules = [
      { prefix: '/admin', roles: ['superadmin', 'admin'] },
      { prefix: '/org', roles: ['establishment', 'customer'] },
    ];

    const rule = rules.find((r) => path === r.prefix || path.startsWith(r.prefix + '/'));
    const allowedRoles = rule?.roles ?? ['superadmin', 'admin', 'establishment', 'customer'];

    content = path !== '/' && !allowedRoles.includes(role)
      ? <Navigate to="/nao-autorizado" replace />
      : <Outlet />;
  }

  return (
    <ThemeProvider>
      {content}
    </ThemeProvider>
  );
};

export default ProtectedLayout;
