import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const getProjectNameCacheKey = (projectId) => `restaurant_project_name:${projectId}`;

export function useProjectName(projectId) {
  const [projectName, setProjectName] = useState('');
  const [isProjectNameLoading, setIsProjectNameLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadProjectName = async () => {
      if (!projectId) {
        setProjectName('');
        setIsProjectNameLoading(false);
        return;
      }

      const projectNameCacheKey = getProjectNameCacheKey(projectId);
      let hasCachedProjectName = false;
      try {
        const cachedProjectName = String(sessionStorage.getItem(projectNameCacheKey) || '').trim();
        if (cachedProjectName) {
          setProjectName(cachedProjectName);
          hasCachedProjectName = true;
        } else {
          setProjectName('');
        }
      } catch (_) {
        setProjectName('');
      }

      setIsProjectNameLoading(!hasCachedProjectName);

      const { data, error } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single();

      if (cancelled) return;

      if (error) {
        console.error('[restaurant-dashboard] erro ao carregar nome do projeto', error);
        setIsProjectNameLoading(false);
        return;
      }

      const nextProjectName = String(data?.name || '').trim();
      setProjectName(nextProjectName);
      setIsProjectNameLoading(false);
      try {
        if (nextProjectName) {
          sessionStorage.setItem(projectNameCacheKey, nextProjectName);
        } else {
          sessionStorage.removeItem(projectNameCacheKey);
        }
      } catch (_) {}
    };

    loadProjectName();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return {
    projectDisplayName: String(projectName || '').trim(),
    isProjectNameLoading,
  };
}
