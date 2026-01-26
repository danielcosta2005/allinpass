import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Loader2 } from 'lucide-react';

export default function AuthLogin() {
  const loc = useLocation();

  useEffect(() => {
    (async () => {
      const next = new URLSearchParams(loc.search).get('next') || '/';
      
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          scopes: 'openid email profile',
          queryParams: { 
            prompt: 'consent',
            access_type: 'offline',
          },
        },
      });
    })();
  }, [loc.search]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-purple-50 via-white to-indigo-50">
      <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
      <h1 className="text-xl font-semibold text-gray-700">Redirecionando para o Google…</h1>
    </div>
  );
}