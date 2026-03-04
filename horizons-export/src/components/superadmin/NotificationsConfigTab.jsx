import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/components/ui/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { Loader2, Shield, Bell, RefreshCcw, Save, Infinity } from "lucide-react";

// -----------------------------
// Helpers de data (sem libs)
// -----------------------------
function toLocalDateTimeLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// Próximo "início de mês + 1 mês" (expira no início do próximo mês)
function computeNextMonthExpIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  // início do próximo mês
  const firstOfNextMonth = new Date(year, month + 1, 1, 0, 0, 0, 0);
  return firstOfNextMonth.toISOString();
}

export default function NotificationsConfigTab({ projectId }) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [row, setRow] = useState(null);

  // Form state
  const [isUnlimited, setIsUnlimited] = useState(true);
  const [limitValue, setLimitValue] = useState(""); // string para Input

  const expLabel = useMemo(() => toLocalDateTimeLabel(row?.notifications_exp), [row]);

  const remainingLabel = useMemo(() => {
    // Como você removeu a coluna notifications_remaining, calculamos aqui para exibir:
    if (!row) return "—";
    if (row.notifications_limit == null) return "Ilimitado";
    const remaining = Number(row.notifications_limit) - Number(row.recent_notifications_sent || 0);
    return Number.isFinite(remaining) ? String(remaining) : "—";
  }, [row]);

  async function ensureRowExists() {
    // Cria linha se não existir (sem depender de seed/trigger)
    const expIso = computeNextMonthExpIso();

    const { data: inserted, error: insErr } = await supabase
      .from("projects_notifications")
      .upsert(
        {
          project_id: projectId,
          notifications_limit: null, // ilimitado por padrão
          total_notifications_sent: 0,
          recent_notifications_sent: 0,
          notifications_exp: expIso,
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

    // Regra do requisito: ao mudar limit, atualiza notifications_exp
    // Interpretação prática: recomeça a janela a partir de agora -> expira no próximo mês (início do próximo mês)
    const newExpIso = computeNextMonthExpIso();

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("projects_notifications")
        .upsert(
          {
            project_id: projectId,
            notifications_limit: newLimit,
            notifications_exp: newExpIso,
            // Se você quiser também "zerar" a janela ao alterar limite, descomente:
            // recent_notifications_sent: 0,
          },
          { onConflict: "project_id" }
        )
        .select("*")
        .single();

      if (error) throw error;

      setRow(data);
      setIsUnlimited(data.notifications_limit == null);
      setLimitValue(data.notifications_limit == null ? "" : String(data.notifications_limit));

      toast({
        title: "Configuração salva",
        description: "Limite atualizado e janela reiniciada (notifications_exp atualizado).",
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

  const limitDisplay =
    row?.notifications_limit == null ? "Ilimitado" : String(row.notifications_limit ?? "—");

  return (
    <div className="p-6 bg-gradient-to-br from-gray-50 to-slate-50 rounded-lg shadow-inner border">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-3">
              <Shield className="text-purple-600" />
              Controle de Notificações
            </h2>
            <p className="text-gray-600 mt-1">
              Visualize o uso do projeto e defina o limite mensal (NULL = ilimitado).
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
          <div className="rounded-lg border bg-white p-6 shadow-sm flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-gray-700">Carregando configuração...</span>
          </div>
        ) : !projectId ? (
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <p className="text-gray-700">Selecione um projeto para configurar.</p>
          </div>
        ) : (
          <>
            {/* Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">Limite mensal</p>
                  <Infinity className="h-4 w-4 text-gray-400" />
                </div>
                <p className="text-2xl font-bold text-gray-900 mt-2">{limitDisplay}</p>
                <p className="text-xs text-gray-500 mt-1">
                  NULL = ilimitado (definido pelo superadmin)
                </p>
              </div>

              <div className="rounded-lg border bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">Notificações Enviadas</p>
                  <Bell className="h-4 w-4 text-gray-400" />
                </div>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {row?.recent_notifications_sent ?? 0}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Expira em: <span className="font-medium">{expLabel}</span>
                </p>
              </div>

              <div className="rounded-lg border bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">Total histórico</p>
                  <Bell className="h-4 w-4 text-gray-400" />
                </div>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {row?.total_notifications_sent ?? 0}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Restantes (calc): <span className="font-medium">{remainingLabel}</span>
                </p>
              </div>
            </div>

            {/* Form */}
            <div className="rounded-lg border bg-white p-6 shadow-sm space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Configurar limite</h3>
                <p className="text-sm text-gray-500">
                  Ao salvar, o <span className="font-medium">notifications_exp</span> será atualizado para reiniciar
                  a janela.
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
                  Limite mensal (X)
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
                <p className="text-xs text-gray-500">
                  Dica: defina 0 para bloquear envios. Ilimitado é NULL.
                </p>
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
    </div>
  );
}