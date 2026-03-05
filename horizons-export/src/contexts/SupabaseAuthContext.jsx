import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
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

  // Proteções contra falhas transitórias de refresh
  const REFRESH_FAIL_WINDOW_MS = 60_000;
  const REFRESH_FAIL_MAX = 2;

  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  // ✅ Lock para evitar logout concorrente
  const logoutInFlightRef = useRef(false);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setSession(null);
    setRole(null);
    setProjectId(null);
  }, []);

  const clearUiState = useCallback(() => {
    try {
      sessionStorage.removeItem('superadmin_selected_project');
      sessionStorage.removeItem('superadmin_active_tab');
      sessionStorage.removeItem('restaurant_active_tab');
      sessionStorage.removeItem('__auth_refresh_fail');
    } catch (_) {
      // ignore
    }
  }, []);

  // ✅ Remove o token do Supabase do storage manualmente (hard logout local)
  const hardClearSupabaseStorage = useCallback(() => {
    try {
      // supabase-js v2 geralmente expõe isso
      const key = supabase?.auth?.storageKey;

      if (key) {
        localStorage.removeItem(key);
        return;
      }

      // fallback (bem comum): sb-<project-ref>-auth-token
      // tenta inferir do supabaseUrl (se o cliente expuser)
      const url = supabase?.supabaseUrl || '';
      const match = String(url).match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
      const projectRef = match?.[1];

      if (projectRef) {
        localStorage.removeItem(`sb-${projectRef}-auth-token`);
      }
    } catch (_) {
      // ignore
    }
  }, []);

  // ✅ Não sequestrar fluxo público de claim/callback
  const isClaimOrCallbackPath = useCallback(() => {
    const p = window.location.pathname || '';
    return p.startsWith('/claim') || p.startsWith('/auth/callback') || p === '/thanks';
  }, []);

  /**
   * ✅ Logout robusto:
   * - Se token estiver expirado/quase, NÃO chama /logout (evita 403 session_not_found)
   * - Sempre limpa local (storage + state + UI) e navega
   */
  const forceLogout = useCallback(
    async (reason = 'Sua sessão expirou. Faça login novamente.') => {
      if (logoutInFlightRef.current) return;
      logoutInFlightRef.current = true;

      try {
        let currentSession = null;

        try {
          const { data } = await supabase.auth.getSession();
          currentSession = data?.session ?? null;
        } catch (_) {
          currentSession = null;
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const expiresAt = Number(currentSession?.expires_at ?? 0);

        // Se estiver expirado ou muito perto (ex.: <= 30s), pular logout server-side pra evitar 403.
        const shouldSkipServerLogout = !currentSession || !expiresAt || expiresAt <= nowSec + 30;

        if (!shouldSkipServerLogout) {
          const { error } = await supabase.auth.signOut({ scope: 'local' });

          // session_not_found -> ok, a gente segue
          if (error) {
            const status = error?.status;
            const code = error?.code;
            const msg = String(error?.message ?? '').toLowerCase();

            const isSessionNotFound =
              status === 403 &&
              (code === 'session_not_found' ||
                (msg.includes('session') && msg.includes('does not exist')));

            if (!isSessionNotFound) {
              // erro real -> não trava logout local, só loga
              console.error('[auth] signOut error', error);
            }
          }
        }

        // ✅ Hard logout local SEMPRE
        hardClearSupabaseStorage();
        clearAuthState();
        clearUiState();

        setLoading(false);
        setInitialized(true);

        if (window.location.pathname !== '/login') {
          navigate('/login', { replace: true });
        }

        // opcional: toast só quando for manual
        if (reason === 'Você saiu da conta.') {
          toast({ title: 'Logout realizado', description: reason });
        }
      } finally {
        logoutInFlightRef.current = false;
      }
    },
    [clearAuthState, clearUiState, hardClearSupabaseStorage, navigate, toast]
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

  useEffect(() => {
    const publicPassRoutes =
      /^\/c\/[a-fA-F0-9-]+\/me|^\/me|^\/c\/[a-fA-F0-9-]+\/[a-fA-F0-9-]+|^\/auth\/callback|^\/claim|^\/thanks/;

    const handleAuthStateChange = async (event, currentSession) => {
      if (!initialized) setInitialized(true);

      if (event === 'TOKEN_REFRESH_FAILED') {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

        let failInfo = { count: 0, firstAt: Date.now() };
        try {
          const raw = sessionStorage.getItem('__auth_refresh_fail');
          if (raw) failInfo = JSON.parse(raw);
        } catch (_) {}

        const now = Date.now();
        const withinWindow = now - (failInfo.firstAt || now) <= REFRESH_FAIL_WINDOW_MS;
        const nextInfo = withinWindow
          ? { count: (failInfo.count || 0) + 1, firstAt: failInfo.firstAt || now }
          : { count: 1, firstAt: now };

        try {
          sessionStorage.setItem('__auth_refresh_fail', JSON.stringify(nextInfo));
        } catch (_) {}

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

        if (nextInfo.count >= REFRESH_FAIL_MAX) {
          try { sessionStorage.removeItem('__auth_refresh_fail'); } catch (_) {}
          await forceLogout('Sua sessão expirou. Faça login novamente.');
          return;
        }

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
        try { sessionStorage.removeItem('__auth_refresh_fail'); } catch (_) {}

        const { role: newRole } = await getProfileAndProject(currentUser);

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
        variant: 'destructive',
        title: 'Sign up Failed',
        description: error.message || 'Something went wrong',
      });
    }

    return { error };
  }, [toast]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Sign in Failed',
        description: error.message || 'Something went wrong',
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