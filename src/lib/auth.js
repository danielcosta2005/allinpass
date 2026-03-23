import { supabase } from '@/lib/supabaseClient';

const getBaseUrl = () => {
  return window.location.origin;
};

export const signInWithGoogle = (projectId) => {
  const redirectTo = `${getBaseUrl()}/auth/callback?projectId=${projectId}`;

  supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      scopes: 'openid profile email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
    },
  });
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Error signing out:', error);
  }
};