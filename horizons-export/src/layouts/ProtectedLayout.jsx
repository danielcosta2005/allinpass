import React from 'react';
    import { Navigate, Outlet, useLocation } from 'react-router-dom';
    import { useAuth } from '@/contexts/SupabaseAuthContext';
    import { Loader2 } from 'lucide-react';

    const ProtectedLayout = () => {
      const { user, loading, role } = useAuth();
      const location = useLocation();

      if (loading) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-indigo-50">
            <Loader2 className="animate-spin rounded-full h-12 w-12 text-primary" />
          </div>
        );
      }

      if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />;
      }
      
      const path = location.pathname;
      const allowedRolesForPath = {
        '/admin': ['superadmin'],
        '/org': ['establishment', 'customer'],
      };

      const allowedRoles = allowedRolesForPath[path] || ['superadmin', 'establishment'];

      if (path !== '/' && !allowedRoles.includes(role)) {
        return <Navigate to="/nao-autorizado" replace />;
      }

      return <Outlet />;
    };

    export default ProtectedLayout;