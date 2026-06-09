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
import {
  clearExistingCustomerSignupContext,
  finalizeFreeTrialSignup,
  readExistingCustomerSignupContext,
} from '@/lib/signup';
import { useToast } from '@/components/ui/use-toast';

const AuthContext = createContext(null);
const VALID_ROLES = new Set(['superadmin', 'admin', 'establishment', 'customer']);
const FREE_TRIAL_PLAN_CODE = 'free_trial';
const FRIENDLY_SIGNUP_RATE_LIMIT_MESSAGE = 'Aguarde alguns minutos para tentar novamente';
const SIGNUP_PASSWORD_SETUP_REQUIRED_STORAGE_KEY = '__signup_password_setup_required';

function markSignupPasswordSetupRequired() {
  try {
    sessionStorage.setItem(SIGNUP_PASSWORD_SETUP_REQUIRED_STORAGE_KEY, '1');
  } catch (_) {}
}

function normalizeSignupErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  if (
    message.includes('email rate limit exceeded')
    || code === 'over_email_send_rate_limit'
  ) {
    return FRIENDLY_SIGNUP_RATE_LIMIT_MESSAGE;
  }

  return error?.message || 'Something went wrong';
}

function isEmailNotConfirmedError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  return code === 'email_not_confirmed' || message.includes('email not confirmed');
}

function isSignupFinalizeCallbackPath() {
  if (typeof window === 'undefined') return false;

  const p = window.location.pathname || '';
  const params = new URLSearchParams(window.location.search || '');
  return p === '/cadastro' && params.get('finalizar') === '1';
}

function normalizePlanCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function isAuthReturnUrl() {
  if (typeof window === 'undefined') return false;

  const authReturnTypes = new Set(['signup', 'magiclink', 'recovery', 'invite', 'email_change']);
  const searchParams = new URLSearchParams(window.location.search || '');
  const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  const hasAuthParams = (params) => (
    params.has('code') ||
    params.has('token_hash') ||
    params.has('access_token') ||
    params.has('refresh_token') ||
    authReturnTypes.has(params.get('type'))
  );

  return hasAuthParams(searchParams) || hasAuthParams(hashParams);
}

function canProbeSignupIntentOnPath(pathname) {
  if (typeof window === 'undefined') return false;

  const p = String(pathname || '');
  if (p === '/' || p === '/login' || p === '/cadastro') return true;

  if (p === '/auth/callback') {
    const params = new URLSearchParams(window.location.search || '');
    return !params.get('projectId');
  }

  return false;
}

function getPendingFreeTrialSignup(currentUser) {
  const metadata = currentUser?.user_metadata || {};
  const appMetadata = currentUser?.app_metadata || {};
  const establishmentName = String(metadata.establishment_name || '').trim();
  const planCode = normalizePlanCode(metadata.plan_code || FREE_TRIAL_PLAN_CODE);
  const planKey = normalizePlanCode(metadata.plan_key || '');

  if (appMetadata.signup_project_id) {
    clearExistingCustomerSignupContext();
    return null;
  }

  if (
    establishmentName &&
    planCode === FREE_TRIAL_PLAN_CODE &&
    (!planKey || planKey === FREE_TRIAL_PLAN_CODE)
  ) {
    return { establishmentName, planCode };
  }

  const existingCustomerContext = readExistingCustomerSignupContext();
  if (!existingCustomerContext) return null;

  const currentUserEmail = String(currentUser?.email || '').trim().toLowerCase();
  if (!currentUserEmail || existingCustomerContext.email !== currentUserEmail) {
    clearExistingCustomerSignupContext();
    return null;
  }

  if (existingCustomerContext.planCode !== FREE_TRIAL_PLAN_CODE) return null;

  return {
    establishmentName: existingCustomerContext.establishmentName,
    planCode: existingCustomerContext.planCode,
  };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // Protection against transient refresh failures.
  const REFRESH_FAIL_WINDOW_MS = 60_000;
  const REFRESH_FAIL_MAX = 2;

  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  // Prevent concurrent logout requests.
  const logoutInFlightRef = useRef(false);
  const pathnameRef = useRef(location.pathname);

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

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

  // Remove Supabase token from local storage (hard local logout).
  const hardClearSupabaseStorage = useCallback(() => {
    try {
      const key = supabase?.auth?.storageKey;

      if (key) {
        localStorage.removeItem(key);
        return;
      }

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

  // Avoid hijacking public claim/callback flow.
  const isClaimOrCallbackPath = useCallback(() => {
    const p = window.location.pathname || '';

    if (isSignupFinalizeCallbackPath()) {
      return true;
    }

    return p.startsWith('/claim')
      || p.startsWith('/auth/callback')
      || p === '/cadastro'
      || p === '/reset-password'
      || p === '/thanks';
  }, []);

  // Only these routes strictly require auth.
  const isAuthRequiredPath = useCallback((pathname) => {
    const p = String(pathname || '');
    return p === '/app' || p.startsWith('/admin') || p.startsWith('/org');
  }, []);

  /**
   * Robust logout:
   * - Skip server logout if token is expired/almost expired (avoids 403 session_not_found)
   * - Always clear local state/storage and navigate
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
        const shouldSkipServerLogout = !currentSession || !expiresAt || expiresAt <= nowSec + 30;

        if (!shouldSkipServerLogout) {
          const { error } = await supabase.auth.signOut({ scope: 'local' });

          if (error) {
            const status = error?.status;
            const code = error?.code;
            const msg = String(error?.message ?? '').toLowerCase();

            const isSessionNotFound =
              status === 403 &&
              (code === 'session_not_found' ||
                (msg.includes('session') && msg.includes('does not exist')));

            if (!isSessionNotFound) {
              console.error('[auth] signOut error', error);
            }
          }
        }

        hardClearSupabaseStorage();
        clearAuthState();
        clearUiState();

        setLoading(false);
        setInitialized(true);

        if (window.location.pathname !== '/login') {
          navigate('/login', { replace: true });
        }

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
      setRole('unauthorized');
      setProjectId(null);
      return { role: 'unauthorized', projectId: null };
    }

    const currentRole = profile.role;
    if (!VALID_ROLES.has(currentRole)) {
      setRole('unauthorized');
      setProjectId(null);
      return { role: 'unauthorized', projectId: null };
    }
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

  const finalizePendingSignupSession = useCallback(async (
    currentUser,
    { allowBackendIntentFallback = false, suppressMissingIntentError = false } = {}
  ) => {
    const pendingSignup = getPendingFreeTrialSignup(currentUser) || (
      allowBackendIntentFallback
        ? { establishmentName: '', planCode: FREE_TRIAL_PLAN_CODE }
        : null
    );
    if (!pendingSignup) return null;

    try {
      const finalizeResult = await finalizeFreeTrialSignup({
        ...pendingSignup,
        dedupeKey: `free-trial:${currentUser.id}`,
      });
      const passwordSetupRequired = Boolean(finalizeResult?.auth?.password_setup_required);

      if (passwordSetupRequired) {
        markSignupPasswordSetupRequired();
      }

      clearExistingCustomerSignupContext();
      const profileState = await getProfileAndProject(currentUser);
      return {
        ...profileState,
        passwordSetupRequired,
      };
    } catch (error) {
      if (suppressMissingIntentError && error?.code === 'SIGNUP_FINALIZE_MISSING_ESTABLISHMENT_NAME') {
        return null;
      }

      console.error('[auth] signup-finalize auto recovery failed', error);
      toast({
        title: 'Erro ao finalizar cadastro',
        description: error?.message || 'Não foi possível finalizar o Free Trial automaticamente.',
        variant: 'destructive',
      });
      return null;
    }
  }, [getProfileAndProject, toast]);

  useEffect(() => {
    let cancelled = false;

    const handleAuthStateChange = async (event, currentSession) => {
      if (cancelled) return;

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
            description: 'Reconecte-se à internet para continuar logado.',
            variant: 'destructive',
          });
          setLoading(false);
          setInitialized(true);
          return;
        }

        if (nextInfo.count >= REFRESH_FAIL_MAX) {
          try {
            sessionStorage.removeItem('__auth_refresh_fail');
          } catch (_) {}
          await forceLogout('Sua sessão expirou. Faça login novamente.');
          return;
        }

        toast({
          title: 'Problema ao manter a sessão',
          description: 'Tentando reconectar... se persistir, você será redirecionado para login.',
          variant: 'destructive',
        });

        setLoading(false);
        setInitialized(true);
        return;
      }

      const currentUser = currentSession?.user ?? null;
      const currentPath = pathnameRef.current;

      setUser(currentUser);
      setSession(currentSession);

      if (currentUser) {
        const hasPendingSignup = Boolean(getPendingFreeTrialSignup(currentUser));
        const hasAuthReturn = isAuthReturnUrl();
        const canProbeBackendSignupIntent =
          (hasAuthReturn || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') &&
          canProbeSignupIntentOnPath(currentPath) &&
          !currentPath.startsWith('/claim') &&
          currentPath !== '/thanks';
        const shouldAllowAutoFinalizeOnCallbackPath =
          (hasPendingSignup || canProbeBackendSignupIntent) &&
          !isSignupFinalizeCallbackPath() &&
          (event === 'SIGNED_IN' || event === 'INITIAL_SESSION');

        if (isClaimOrCallbackPath() && !shouldAllowAutoFinalizeOnCallbackPath) {
          setLoading(false);
          setInitialized(true);
          return;
        }

        const shouldSyncRole =
          event === 'INITIAL_SESSION' ||
          !initialized ||
          !role ||
          role === 'unauthorized';

        if (shouldSyncRole) {
          setLoading(true);

          try {
            sessionStorage.removeItem('__auth_refresh_fail');
          } catch (_) {}

          let { role: newRole, projectId: newProjectId } = await getProfileAndProject(currentUser);
          if (cancelled) return;
          let didAutoFinalizeSignup = false;
          let passwordSetupRequired = false;
          const shouldProbeBackendSignupIntent =
            canProbeBackendSignupIntent &&
            !hasPendingSignup &&
            newRole === 'customer' &&
            !newProjectId;

          const shouldAutoFinalizeSignup =
            !isSignupFinalizeCallbackPath() &&
            (hasPendingSignup || shouldProbeBackendSignupIntent) &&
            (newRole === 'customer' || newRole === 'establishment') &&
            !newProjectId &&
            (event === 'SIGNED_IN' || event === 'INITIAL_SESSION');

          if (shouldAutoFinalizeSignup) {
            const finalizedState = await finalizePendingSignupSession(currentUser, {
              allowBackendIntentFallback: shouldProbeBackendSignupIntent,
              suppressMissingIntentError: shouldProbeBackendSignupIntent,
            });
            if (cancelled) return;

            if (finalizedState?.role) {
              newRole = finalizedState.role;
              newProjectId = finalizedState.projectId;
              didAutoFinalizeSignup = true;
            }

            if (finalizedState?.passwordSetupRequired) {
              passwordSetupRequired = true;
            }
          }

          if (passwordSetupRequired) {
            const alreadyOnPasswordSetup =
              currentPath === '/cadastro' &&
              new URLSearchParams(window.location.search || '').get('passwordSetup') === '1';

            if (!alreadyOnPasswordSetup) {
              const passwordSetupParams = new URLSearchParams(window.location.search || '');
              passwordSetupParams.set('finalizar', '1');
              passwordSetupParams.set('passwordSetup', '1');
              navigate(`/cadastro?${passwordSetupParams.toString()}`, { replace: true });
            }
          } else if (newRole === 'unauthorized') {
            const shouldRedirectToUnauthorized =
              currentPath === '/login' || isAuthRequiredPath(currentPath) || event === 'SIGNED_IN';
            if (shouldRedirectToUnauthorized) {
              navigate('/nao-autorizado', { replace: true });
            }
          } else if (event === 'SIGNED_IN' || didAutoFinalizeSignup) {
            const alreadyInAdmin = currentPath === '/admin' || currentPath.startsWith('/admin/');
            const alreadyInOrg = currentPath === '/org' || currentPath.startsWith('/org/');

            if ((newRole === 'superadmin' || newRole === 'admin') && !alreadyInAdmin) {
              navigate('/admin', { replace: true });
            } else if (
              (newRole === 'establishment' || newRole === 'customer') &&
              !alreadyInOrg
            ) {
              navigate('/org', { replace: true });
            }
          }
        }
      } else {
        setRole(null);
        setProjectId(null);

        if (isAuthRequiredPath(currentPath) && currentPath !== '/login') {
          navigate('/login', { replace: true });
        }
      }

      setLoading(false);
      setInitialized(true);
    };

    const checkInitialSession = async () => {
      setLoading(true);

      const {
        data: { session: initialSession },
        error,
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (error) {
        setLoading(false);
        setInitialized(true);
        return;
      }

      if (!initialSession) {
        clearAuthState();
        setLoading(false);
        setInitialized(true);

        const currentPath = pathnameRef.current;
        if (isAuthRequiredPath(currentPath) && currentPath !== '/login') {
          navigate('/login', { replace: true });
        }
        return;
      }

      await handleAuthStateChange('INITIAL_SESSION', initialSession);
    };

    checkInitialSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      void handleAuthStateChange(event, currentSession);
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [
    getProfileAndProject,
    finalizePendingSignupSession,
    navigate,
    isClaimOrCallbackPath,
    isAuthRequiredPath,
    forceLogout,
    clearAuthState,
    toast,
  ]);

  const signUp = useCallback(async (email, password, options) => {
    const { data, error } = await supabase.auth.signUp({ email, password, options });

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Sign up Failed',
        description: normalizeSignupErrorMessage(error),
      });
    }

    return { data, error };
  }, [toast]);

  const refreshAuthProfile = useCallback(async () => {
    const {
      data: { session: currentSession },
      error,
    } = await supabase.auth.getSession();

    if (error || !currentSession?.user) {
      clearAuthState();
      return { role: null, projectId: null };
    }

    setUser(currentSession.user);
    setSession(currentSession);

    return getProfileAndProject(currentSession.user);
  }, [clearAuthState, getProfileAndProject]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error && !isEmailNotConfirmedError(error)) {
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
    refreshAuthProfile,
  }), [user, session, loading, initialized, role, projectId, signUp, signIn, signOutUser, refreshAuthProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
