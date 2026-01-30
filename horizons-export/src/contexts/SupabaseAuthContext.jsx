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

  // Proteções contra "desconectar toda hora" em falhas transitórias
  // - Se refresh falhar uma vez, pode ser rede. Se falhar repetidamente em pouco tempo, encerra.
  const REFRESH_FAIL_WINDOW_MS = 60_000;
  const REFRESH_FAIL_MAX = 2;

  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const clearAuthState = useCallback(() => {
    setUser(null);
    setSession(null);
    setRole(null);
    setProjectId(null);
  }, []);

  const forceLogout = useCallback(
    async (reason = 'Sua sessão expirou. Faça login novamente.') => {
      try {
        // Não depende de sessão server-side existir (evita o "session_id claim does not exist")
        await supabase.auth.signOut({ scope: 'local' });
      } catch (_) {
        // Mesmo que falhe, garantimos o reset local
      } finally {
        clearAuthState();

        // Limpa estados de UI que podem "prender" no dashboard
        try {
          sessionStorage.removeItem('superadmin_selected_project');
          sessionStorage.removeItem('superadmin_active_tab');
          sessionStorage.removeItem('restaurant_active_tab');
        } catch (_) {
          // ignore
        }

        setLoading(false);
        setInitialized(true);

        if (window.location.pathname !== '/login') {
          navigate('/login', { replace: true });
        }

      }
    },
    [clearAuthState, navigate, toast]
  );

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
    return p.startsWith('/claim') || p.startsWith('/auth/callback') || p === '/thanks';
  }, []);

  useEffect(() => {
    const publicPassRoutes =
      /^\/c\/[a-fA-F0-9-]+\/me|^\/me|^\/c\/[a-fA-F0-9-]+\/[a-fA-F0-9-]+|^\/auth\/callback|^\/claim|^\/thanks/;

    const handleAuthStateChange = async (event, currentSession) => {
      if (!initialized) setInitialized(true);

      // ✅ Quando o refresh do token falha, a sessão pode ficar "zumbi".
      // Tratamos de forma determinística.
      if (event === 'TOKEN_REFRESH_FAILED') {
        // Se estiver offline, pode ser falha de rede: não derruba na primeira.
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

        let failInfo = { count: 0, firstAt: Date.now() };
        try {
          const raw = sessionStorage.getItem('__auth_refresh_fail');
          if (raw) failInfo = JSON.parse(raw);
        } catch (_) {
          // ignore
        }

        const now = Date.now();
        const withinWindow = now - (failInfo.firstAt || now) <= REFRESH_FAIL_WINDOW_MS;
        const nextInfo = withinWindow
          ? { count: (failInfo.count || 0) + 1, firstAt: failInfo.firstAt || now }
          : { count: 1, firstAt: now };

        try {
          sessionStorage.setItem('__auth_refresh_fail', JSON.stringify(nextInfo));
        } catch (_) {
          // ignore
        }

        // Offline: avisa e deixa o app tentar recuperar quando a rede voltar.
        if (offline && nextInfo.count < REFRESH_FAIL_MAX) {
          toast({
            title: 'Sem conexão',
            description: 'Reconecte à internet para continuar logado.',
            variant: 'destructive',
          });
          setLoading(false);
          setInitialized(true);
          return;
        }

        // Repetiu dentro da janela: encerra.
        if (nextInfo.count >= REFRESH_FAIL_MAX) {
          try { sessionStorage.removeItem('__auth_refresh_fail'); } catch (_) {}
          await forceLogout('Sua sessão expirou. Faça login novamente.');
          return;
        }

        // Primeira falha (provável rede): não derruba ainda.
        toast({
          title: 'Problema ao manter a sessão',
          description: 'Tentando reconectar… se persistir, você será redirecionado para login.',
          variant: 'destructive',
        });

        setLoading(false);
        setInitialized(true);
        return;
      }

      const currentUser = currentSession?.user ?? null;

      setUser(currentUser);
      setSession(currentSession);

      if (currentUser) {
        // Reset do contador se a sessão está saudável novamente
        try { sessionStorage.removeItem('__auth_refresh_fail'); } catch (_) {}
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

        // ✅ Se não há usuário, não dependa do evento exato.
        if (!publicPassRoutes.test(location.pathname) && location.pathname !== '/login') {
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
        clearAuthState();
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
  }, [
    getProfileAndProject,
    navigate,
    location.pathname,
    initialized,
    isClaimOrCallbackPath,
    forceLogout,
    clearAuthState,
    toast,
  ]);

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

  const signOutUser = useCallback(async () => {
    await forceLogout('Você saiu da conta.');
  }, [forceLogout]);

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
  }), [user, session, loading, initialized, role, projectId, signUp, signIn, signOutUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
