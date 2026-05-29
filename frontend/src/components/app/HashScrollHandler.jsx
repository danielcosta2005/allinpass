import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

function HashScrollHandler() {
  const { hash, pathname } = useLocation();

  useEffect(() => {
    if (!hash) return undefined;

    const targetId = decodeURIComponent(hash.slice(1));
    if (!targetId) return undefined;

    const timeoutId = window.setTimeout(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [hash, pathname]);

  return null;
}

export default HashScrollHandler;
