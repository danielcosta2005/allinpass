import { useCallback, useEffect, useState } from 'react';
import { getBillingUsageDashboard } from '@/lib/billingUsageDashboard';

export function useBillingUsageDashboard({ projectId, open }) {
  const [dashboardData, setDashboardData] = useState({
    cycles: [],
    currentCycleId: null,
    subscription: null,
  });
  const [billingUsageLoading, setBillingUsageLoading] = useState(false);
  const [billingUsageError, setBillingUsageError] = useState('');

  const refreshBillingUsageDashboard = useCallback(async () => {
    if (!projectId) {
      setDashboardData({ cycles: [], currentCycleId: null, subscription: null });
      setBillingUsageError('');
      setBillingUsageLoading(false);
      return null;
    }

    setBillingUsageLoading(true);
    setBillingUsageError('');

    try {
      const data = await getBillingUsageDashboard(projectId);
      setDashboardData(data);
      return data;
    } catch (error) {
      setDashboardData({ cycles: [], currentCycleId: null, subscription: null });
      setBillingUsageError(error?.message || 'Não foi possível carregar o faturamento.');
      return null;
    } finally {
      setBillingUsageLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open || !projectId) {
      setBillingUsageLoading(false);
      return undefined;
    }

    let cancelled = false;
    setBillingUsageLoading(true);
    setBillingUsageError('');

    getBillingUsageDashboard(projectId)
      .then((data) => {
        if (cancelled) return;
        setDashboardData(data);
      })
      .catch((error) => {
        if (cancelled) return;
        setDashboardData({ cycles: [], currentCycleId: null, subscription: null });
        setBillingUsageError(error?.message || 'Não foi possível carregar o faturamento.');
      })
      .finally(() => {
        if (!cancelled) setBillingUsageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  return {
    billingUsageData: dashboardData,
    billingUsageLoading,
    billingUsageError,
    refreshBillingUsageDashboard,
  };
}
