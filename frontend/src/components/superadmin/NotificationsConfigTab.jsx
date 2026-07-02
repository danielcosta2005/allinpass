import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { Loader2, Shield, Bell, RefreshCcw, Save, Infinity, Hash, Gauge, Lock } from "lucide-react";

// -----------------------------
// Helpers de data (sem libs)
// -----------------------------
function toLocalDateTimeLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

//Expira 30 dias depois do save
function computeRollingExpIso(days = 30) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export default function NotificationsConfigTab({ projectId }) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [row, setRow] = useState(null);

  // Form state
  const [isUnlimited, setIsUnlimited] = useState(true);
  const [limitValue, setLimitValue] = useState(""); // string para Input

  const expLabel = useMemo(
    () => toLocalDateTimeLabel(row?.notifications_exp),
    [row]
  );

  const createdAtLabel = useMemo(
    () => toLocalDateTimeLabel(row?.created_at),
    [row]
  );

  // Preferir coluna do banco (notifications_remaining). Se não existir, calcula.
  const remainingLabel = useMemo(() => {
    if (!row) return "—";

    // Se a coluna existir no row, usamos.
    if (row.notifications_remaining !== undefined && row.notifications_remaining !== null) {
      return String(row.notifications_remaining);
    }

    // Se for ilimitado
    if (row.notifications_limit == null) return "Ilimitado";

    const remaining =
      Number(row.notifications_limit) - Number(row.recent_notifications_sent || 0);
    return Number.isFinite(remaining) ? String(remaining) : "—";
  }, [row]);

  const limitDisplay = useMemo(() => {
    return row?.notifications_limit == null
      ? "Ilimitado"
      : String(row?.notifications_limit ?? "—");
  }, [row]);

  async function ensureRowExists() {
    // Cria linha se não existir (sem depender de seed/trigger)
    const expIso = computeRollingExpIso(30);

    const { data: inserted, error: insErr } = await supabase
      .from("projects_notifications")
      .upsert(
        {
          project_id: projectId,
          notifications_limit: null, // ilimitado por padrão
          total_notifications_sent: 0,
          recent_notifications_sent: 0,
          notifications_exp: expIso,
          created_at: new Date().toISOString(),
        },
        { onConflict: "project_id" }
      )
      .select("*")
      .single();

    if (insErr) throw insErr;
    return inserted;
  }

  async function fetchConfig() {
    if (!projectId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("projects_notifications")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle();

      if (error) throw error;

      const cfg = data ?? (await ensureRowExists());
      setRow(cfg);

      // Sync form state
      const unlimited = cfg.notifications_limit == null;
      setIsUnlimited(unlimited);
      setLimitValue(unlimited ? "" : String(cfg.notifications_limit));
    } catch (err) {
      toast({
        title: "Erro ao carregar configuração",
        description: err?.message || "Falha inesperada",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleSave() {
    if (!projectId) {
      toast({
        title: "Erro",
        description: "Nenhum projeto selecionado.",
        variant: "destructive",
      });
      return;
    }

    // Validação
    let newLimit = null; // null = ilimitado
    if (!isUnlimited) {
      const n = Number(limitValue);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        toast({
          title: "Valor inválido",
          description: "O limite deve ser um inteiro >= 0, ou marque 'Ilimitado'.",
          variant: "destructive",
        });
        return;
      }
      newLimit = n;
    }

    const currentLimit = row?.notifications_limit ?? null;
    const hasLimitChanged = currentLimit !== newLimit;

    if (!hasLimitChanged) {
      toast({
        title: "Sem alterações",
        description:
          "Nnhuma mudança feita, altere o limite mensal antes de clicar em salvar",
      });
      return;
    }

    // expira 30 dias depois
    const newExpIso = computeRollingExpIso(30);

    setSaving(true);
    try {
      const payload = {
        project_id: projectId,
        notifications_limit: newLimit,
        notifications_exp: newExpIso,

        // isso garante que "reiniciou a janela" de verdade
        recent_notifications_sent: 0,
      };

      const { data, error } = await supabase
        .from("projects_notifications")
        .upsert(payload, { onConflict: "project_id" })
        .select("*")
        .single();

      if (error) throw error;

      setRow(data);
      setIsUnlimited(data.notifications_limit == null);
      setLimitValue(data.notifications_limit == null ? "" : String(data.notifications_limit));

      // ✅ força UI a buscar do banco (útil se houver view/trigger/coluna gerada)
      await fetchConfig();

      toast({
        title: "Configuração salva",
        description: "Limite atualizado e janela reiniciada (contagem mensal zerada).",
      });
    } catch (err) {
      toast({
        title: "Erro ao salvar",
        description: err?.message || "Falha inesperada",
        variant: "destructive",
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
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <Shield className="text-purple-600" />
              Controle de Notificações
            </h2>
            <p className="text-muted-foreground mt-1">
              Visualize o uso do projeto e defina o limite mensal.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={fetchConfig}
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
        </div>

        {/* Body */}
        {loading ? (
          <div className="rounded-lg border border-border bg-card p-6 shadow-md flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-muted-foreground">Carregando configuração...</span>
          </div>
        ) : !projectId ? (
          <div className="rounded-lg border border-border bg-card p-6 shadow-md">
            <p className="text-muted-foreground">Selecione um projeto para configurar.</p>
          </div>
        ) : (
          <>
            {/* Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border border-border bg-card p-5 shadow-md">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Limite mensal</p>

                  {row?.notifications_limit == null ? (
                    <Infinity className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <p className="text-2xl font-bold text-foreground mt-2">{limitDisplay}</p>
                <p className="text-xs text-muted-foreground mt-1">Definido por um administrador</p>
              </div>

              <div className="rounded-lg border border-border bg-card p-5 shadow-md">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Notificações Enviadas</p>
                  <Bell className="h-4 w-4 text-muted-foreground" />
                </div>

                <p className="text-2xl font-bold text-foreground mt-2">
                  {row?.recent_notifications_sent ?? 0}{" "}
                  <span className="text-base font-semibold text-muted-foreground">
                    ({remainingLabel} restantes)
                  </span>
                </p>

                <p className="text-xs text-muted-foreground mt-1">
                  Reinicia em: <span className="font-medium">{expLabel}</span>
                </p>
              </div>

              <div className="rounded-lg border border-border bg-card p-5 shadow-md">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Total histórico</p>
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-2xl font-bold text-foreground mt-2">
                  {row?.total_notifications_sent ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Desde: <span className="font-medium">{createdAtLabel}</span>
                </p>
              </div>
            </div>

            {/* Form */}
            <div className="rounded-lg border border-border bg-card p-6 shadow-md space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Configurar limite</h3>
                <p className="text-sm text-muted-foreground">
                  Clique em "Salvar" após estabelecer o limite de notificações.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Checkbox
                  id="unlimited"
                  checked={isUnlimited}
                  onCheckedChange={(v) => {
                    const checked = Boolean(v);
                    setIsUnlimited(checked);
                    if (checked) setLimitValue("");
                  }}
                />
                <Label htmlFor="unlimited" className="text-sm font-medium">
                  Ilimitado
                </Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="limit" className="text-sm font-medium">
                  Limite mensal:
                </Label>
                <Input
                  id="limit"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={limitValue}
                  disabled={isUnlimited}
                  onChange={(e) => setLimitValue(e.target.value)}
                  placeholder={isUnlimited ? "Ilimitado" : "Ex: 500"}
                  className="max-w-sm"
                />
                <p className="text-xs text-muted-foreground">Estabeleça um limite para este projeto.</p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button onClick={handleSave} disabled={saving || loading}>
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
