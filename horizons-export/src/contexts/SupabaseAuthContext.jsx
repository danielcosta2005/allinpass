import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const getProfileAndProject = useCallback(async (currentUser) => {
    if (!currentUser) {
      setRole(null);
      setProjectId(null);
      return { role: null, projectId: null };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', currentUser.id)
      .single();

    if (profileError || !profile) {
      setRole(null);
      setProjectId(null);
      return { role: null, projectId: null };
    }

    const currentRole = profile.role;
    setRole(currentRole);

    if (currentRole === 'establishment') {
      const { data: member } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', currentUser.id)
        .limit(1)
        .single();

      const currentProjectId = member?.project_id || null;
      setProjectId(currentProjectId);
      return { role: currentRole, projectId: currentProjectId };
    }

    setProjectId(null);
    return { role: currentRole, projectId: null };
  }, []);

  // ✅ Não sequestrar fluxo público de claim/callback
  const isClaimOrCallbackPath = useCallback(() => {
    const p = window.location.pathname || '';
    return p.startsWith('/claim') || p.startsWith('/auth/callback');
  }, []);

  useEffect(() => {
    const publicPassRoutes =
      /^\/c\/[a-fA-F0-9-]+\/me|^\/me|^\/c\/[a-fA-F0-9-]+\/[a-fA-F0-9-]+|^\/auth\/callback|^\/claim/;

    const handleAuthStateChange = async (event, currentSession) => {
      if (!initialized) setInitialized(true);

      const currentUser = currentSession?.user ?? null;

      setUser(currentUser);
      setSession(currentSession);

      if (currentUser) {
        const { role: newRole } = await getProfileAndProject(currentUser);

        // ✅ CRÍTICO: se estiver em claim/callback, NÃO redireciona pro dashboard
        if (isClaimOrCallbackPath()) {
          setLoading(false);
          setInitialized(true);
          return;
        }

        if (event === 'SIGNED_IN') {
          if (newRole === 'superadmin') {
            navigate('/admin', { replace: true });
          } else if (newRole === 'establishment' || newRole === 'customer') {
            navigate('/org', { replace: true });
          }
        }
      } else {
        setRole(null);
        setProjectId(null);

        if (event === 'SIGNED_OUT' && !publicPassRoutes.test(location.pathname)) {
          navigate('/login', { replace: true });
        }
      }

      setLoading(false);
      setInitialized(true);
    };

    const checkInitialSession = async () => {
      setLoading(true);
      const { data: { session: initialSession }, error } = await supabase.auth.getSession();

      if (error) {
        setLoading(false);
        return;
      }

      if (!initialSession) {
        setUser(null);
        setSession(null);
        setRole(null);
        setProjectId(null);
        setLoading(false);

        if (!publicPassRoutes.test(location.pathname) && location.pathname !== '/login') {
          navigate('/login', { replace: true });
        }
        return;
      }

      await handleAuthStateChange('INITIAL_SESSION', initialSession);
    };

    checkInitialSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(handleAuthStateChange);

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [getProfileAndProject, navigate, location.pathname, initialized, isClaimOrCallbackPath]);

  const signUp = useCallback(async (email, password, options) => {
    const { error } = await supabase.auth.signUp({ email, password, options });

    if (error) {
      toast({
        variant: "destructive",
        title: "Sign up Failed",
        description: error.message || "Something went wrong",
      });
    }

    return { error };
  }, [toast]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast({
        variant: "destructive",
        title: "Sign in Failed",
        description: error.message || "Something went wrong",
      });
    }

    return { error };
  }, [toast]);

  const signOutUser = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({
        title: "Erro ao sair",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const value = useMemo(() => ({
    user,
    session,
    loading,
    initialized,
    role,
    projectId,
    signUp,
    signIn,
    signOut: signOutUser,
  }), [user, session, loading, initialized, role, projectId, signUp, signIn]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
