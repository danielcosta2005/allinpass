import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bell,
  Clock,
  CreditCard,
  Gauge,
  Hash,
  Loader2,
  RefreshCcw,
  Save,
  Ticket,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  getProjectUsageLimits,
  updateProjectUsageLimits,
} from '@/lib/projectUsageLimits';

function formatInteger(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

function toDateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseLimitInput(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function UsageCard({ title, icon: Icon, metric }) {
  const included = metric?.included || 0;
  const used = metric?.used || 0;
  const remaining = metric?.remaining || 0;
  const usagePercent = metric?.usagePercent || 0;

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-md">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-2xl font-bold text-foreground">{formatInteger(used)}</p>
        <p className="text-sm font-semibold text-muted-foreground">
          {formatInteger(remaining)} restantes
        </p>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${usagePercent}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Limite atual: <span className="font-medium">{formatInteger(included)}</span>
      </p>
    </div>
  );
}

export default function UsageConfigTab({ projectId }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState(null);
  const [passLimitValue, setPassLimitValue] = useState('');
  const [notificationLimitValue, setNotificationLimitValue] = useState('');
  const [trialEndsAtValue, setTrialEndsAtValue] = useState('');

  const subscription = usage?.subscription || null;
  const passLimit = parseLimitInput(passLimitValue);
  const notificationLimit = parseLimitInput(notificationLimitValue);

  const periodLabel = useMemo(() => {
    const start = usage?.summary?.periodStart || subscription?.currentPeriodStart;
    const end = usage?.summary?.periodEnd || subscription?.currentPeriodEnd;
    if (!start && !end) return '-';
    return `${formatDateTime(start)} até ${formatDateTime(end)}`;
  }, [subscription, usage]);

  const hasChanges = useMemo(() => {
    if (!subscription) return false;
    return passLimitValue !== String(subscription.includedPassInstalls)
      || notificationLimitValue !== String(subscription.includedNotificationSends)
      || (subscription.isFreeTrial
        && trialEndsAtValue !== toDateTimeLocalValue(subscription.trialEndsAt));
  }, [notificationLimitValue, passLimitValue, subscription, trialEndsAtValue]);

  async function fetchUsage() {
    if (!projectId) return;

    setLoading(true);
    try {
      const data = await getProjectUsageLimits(projectId);
      setUsage(data);
      setPassLimitValue(String(data.subscription?.includedPassInstalls ?? 0));
      setNotificationLimitValue(String(data.subscription?.includedNotificationSends ?? 0));
      setTrialEndsAtValue(toDateTimeLocalValue(data.subscription?.trialEndsAt));
    } catch (err) {
      toast({
        title: 'Erro ao carregar usagem',
        description: err?.message || 'Falha inesperada',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleSave() {
    if (!projectId || !subscription?.id) {
      toast({
        title: 'Erro',
        description: 'Nenhuma assinatura ativa encontrada para este projeto.',
        variant: 'destructive',
      });
      return;
    }

    if (passLimit === null || notificationLimit === null) {
      toast({
        title: 'Valor inválido',
        description: 'Os limites devem ser inteiros maiores ou iguais a zero.',
        variant: 'destructive',
      });
      return;
    }

    const trialEndsAt = subscription.isFreeTrial
      ? fromDateTimeLocalValue(trialEndsAtValue)
      : null;

    if (subscription.isFreeTrial && !trialEndsAt) {
      toast({
        title: 'Período inválido',
        description: 'Informe uma data válida para estender o free trial.',
        variant: 'destructive',
      });
      return;
    }

    if (!hasChanges) {
      toast({
        title: 'Sem alterações',
        description: 'Altere pelo menos um limite ou o período antes de salvar.',
      });
      return;
    }

    setSaving(true);
    try {
      await updateProjectUsageLimits({
        projectId,
        subscriptionId: subscription.id,
        includedPassInstalls: passLimit,
        includedNotificationSends: notificationLimit,
        trialEndsAt,
      });
      await fetchUsage();

      toast({
        title: 'Limites atualizados',
        description: 'A assinatura do projeto foi atualizada.',
      });
    } catch (err) {
      toast({
        title: 'Erro ao salvar',
        description: err?.message || 'Falha inesperada',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-lg border border-border bg-gradient-to-br from-background to-muted p-6 shadow-inner"
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-3 text-3xl font-bold text-foreground">
              <Gauge className="text-primary" />
              Controle de Usagem
            </h2>
            <p className="mt-1 text-muted-foreground">
              Limites e consumo do ciclo atual.
            </p>
          </div>

          <Button
            variant="outline"
            onClick={fetchUsage}
            disabled={loading || saving || !projectId}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="mr-2 h-4 w-4" />
            )}
            Atualizar
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-6 shadow-md">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-muted-foreground">Carregando usagem...</span>
          </div>
        ) : !projectId ? (
          <div className="rounded-lg border border-border bg-card p-6 shadow-md">
            <p className="text-muted-foreground">Selecione um projeto.</p>
          </div>
        ) : !subscription ? (
          <div className="rounded-lg border border-border bg-card p-6 shadow-md">
            <p className="text-muted-foreground">Nenhuma assinatura ativa encontrada.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <UsageCard
                title="Instalações de passes"
                icon={Ticket}
                metric={usage?.passInstalls}
              />
              <UsageCard
                title="Notificações enviadas"
                icon={Bell}
                metric={usage?.notifications}
              />
              <div className="rounded-lg border border-border bg-card p-5 shadow-md">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-muted-foreground">Assinatura</p>
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-3 text-2xl font-bold text-foreground">
                  {subscription.plan?.name || 'Plano'}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Status: <span className="font-medium">{subscription.status || '-'}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Período: <span className="font-medium">{periodLabel}</span>
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-6 shadow-md">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pass-limit" className="text-sm font-medium">
                    Limite de instalações de passes
                  </Label>
                  <div className="relative max-w-sm">
                    <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="pass-limit"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={passLimitValue}
                      onChange={(event) => setPassLimitValue(event.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notification-limit" className="text-sm font-medium">
                    Limite de notificações
                  </Label>
                  <div className="relative max-w-sm">
                    <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="notification-limit"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={notificationLimitValue}
                      onChange={(event) => setNotificationLimitValue(event.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                {subscription.isFreeTrial ? (
                  <div className="space-y-2">
                    <Label htmlFor="trial-ends-at" className="text-sm font-medium">
                      Estender free trial
                    </Label>
                    <div className="relative max-w-sm">
                      <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="trial-ends-at"
                        type="datetime-local"
                        value={trialEndsAtValue}
                        onChange={(event) => setTrialEndsAtValue(event.target.value)}
                        className="pl-9"
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-6 flex justify-end">
                <Button onClick={handleSave} disabled={saving || loading || !hasChanges}>
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Salvar
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
